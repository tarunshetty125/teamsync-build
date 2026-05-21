// electron/intelligence/multibrain/runSubBrains.ts
// Shared utility for running sub-brains synchronously, merging results,
// and appending high-confidence insights as PromptInstructions.
//
// Used by all Brain implementations that have registered sub-brains.
//
// Rules:
//   - Capability-gated via 'multiBrain'
//   - Sync execution with per-brain try/catch isolation
//   - Failure-safe: individual sub-brain errors never propagate
//   - Prompt-bloat-safe: only top MAX_PROMPT_INSIGHTS above threshold injected
//
// Phase 6 enhancements (behind feature flags):
//   - promptOptimization: compresses insight labels, enforces mode budgets
//   - latencyOptimization: tracks sub-brain execution latency

import type { BrainInput, BrainOutput } from '../brains/Brain';
import type { PromptInstruction } from '../../ActionContextBuilder';
import type { SubBrainInput, SubBrainExecutionResult, MergedInsightSet } from './types';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';
import { OutputMerger } from './OutputMerger';
import { createSubBrainRegistry } from './createMultiBrainLayer';
import { MultiBrainTelemetry } from './MultiBrainTelemetry';
import { ModeMemoryManager } from '../memory/ModeMemoryManager';
import { ExplainabilityIPC } from '../ipc/ExplainabilityIPC';
import { LatencyTracker } from '../LatencyTracker';
import { compressInsightLabel } from '../prompt/SignalCompressor';
import { BrainQualityScorer } from './BrainQualityScorer';
import { getModeBudget, isInsightPriority, estimateInsightTokens } from '../prompt/ModePromptBudget';

// ---------------------------------------------------------------------------
// Lazy-initialized shared registry
// ---------------------------------------------------------------------------

let _subBrainRegistry: ReturnType<typeof createSubBrainRegistry> | null = null;

function getSubBrainRegistry(): ReturnType<typeof createSubBrainRegistry> {
    if (!_subBrainRegistry) {
        _subBrainRegistry = createSubBrainRegistry();
    }
    return _subBrainRegistry;
}

// ---------------------------------------------------------------------------
// Input builder
// ---------------------------------------------------------------------------

/**
 * Build SubBrainInput from the parent Brain's heuristic text.
 */
function buildSubBrainInput(input: BrainInput, modeId: string): SubBrainInput {
    const raw = [
        input.userMessage,
        input.previousAnswer,
        input.analysis.answerShape,
        ...input.context.sources.slice(0, 5).map((source) => source.content),
    ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
        .slice(0, 12000);

    const normalized = raw
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    return {
        rawText: raw,
        normalizedText: normalized,
        modeId,
    };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max insights injected into the prompt — high-signal only */
const MAX_PROMPT_INSIGHTS = 2;
/** Minimum confidence for an insight to be injected into the prompt */
const PROMPT_CONFIDENCE_THRESHOLD = 0.75;
/** OutputMerger threshold — only quality insights survive merge */
const MERGE_CONFIDENCE_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Insight formatting
// ---------------------------------------------------------------------------

/**
 * Format the strongest merged insights as a PromptInstruction.
 *
 * Only injects the top MAX_PROMPT_INSIGHTS insights above
 * PROMPT_CONFIDENCE_THRESHOLD into the prompt. All remaining insights
 * stay as internal metadata (logged, not injected).
 *
 * When promptOptimization is enabled:
 *   - Compresses insight labels (dictionary-based, readable)
 *   - Prioritizes mode-relevant insights
 *   - Enforces token budget (+12% max growth)
 *
 * Returns null if no insights meet the threshold.
 */
function mergedInsightsToInstruction(
    merged: MergedInsightSet,
    key: string,
    title: string,
    modeId: string,
): PromptInstruction | null {
    // Filter to high-confidence only, already sorted by OutputMerger
    const eligible = merged.insights.filter(i => i.confidence >= PROMPT_CONFIDENCE_THRESHOLD);

    if (eligible.length === 0) return null;

    const usePromptOpt = CapabilityRegistry.getInstance().isEnabled('promptOptimization');

    let topInsights = eligible;

    // --- Phase 6: Mode-aware prioritization ---
    if (usePromptOpt) {
        const budget = getModeBudget(modeId);

        // Sort by mode priority (priority insights first, then by confidence)
        topInsights = [...eligible].sort((a, b) => {
            const aCompressed = compressInsightLabel(a.label);
            const bCompressed = compressInsightLabel(b.label);
            const aPriority = isInsightPriority(aCompressed, budget) ? 1 : 0;
            const bPriority = isInsightPriority(bCompressed, budget) ? 1 : 0;
            if (aPriority !== bPriority) return bPriority - aPriority;
            return b.confidence - a.confidence;
        });
    }

    topInsights = topInsights.slice(0, MAX_PROMPT_INSIGHTS);

    // --- Format lines ---
    const lines = topInsights.map(insight => {
        const label = usePromptOpt ? compressInsightLabel(insight.label) : insight.label;
        const conf = Math.round(insight.confidence * 100);
        const reasonStr = insight.reasoning.length > 0 ? ` (${insight.reasoning[0]})` : '';
        return `• ${label} [${conf}%]${reasonStr}`;
    });

    // --- Phase 6: Token budget enforcement ---
    if (usePromptOpt) {
        const budget = getModeBudget(modeId);
        const content = lines.join('\n');
        const tokens = estimateInsightTokens(content);
        if (tokens > budget.maxInsightTokens) {
            // Truncate to budget (remove reasoning to fit)
            const truncated = topInsights.slice(0, MAX_PROMPT_INSIGHTS).map(insight => {
                const label = compressInsightLabel(insight.label);
                const conf = Math.round(insight.confidence * 100);
                return `• ${label} [${conf}%]`;
            });
            return {
                key,
                title,
                content: truncated.join('\n'),
            };
        }
    }

    return {
        key,
        title,
        content: lines.join('\n'),
    };
}

// ---------------------------------------------------------------------------
// runSubBrains
// ---------------------------------------------------------------------------

/**
 * Run sub-brains synchronously for a mode, merge, and append
 * high-confidence insights as a PromptInstruction.
 *
 * Execution: sync for-loop with per-brain try/catch isolation.
 * Sub-brains are deterministic heuristics (<2ms each) — no async needed.
 *
 * Capability-gated: returns output unchanged if multiBrain is disabled.
 * Failure-safe: individual sub-brain errors never propagate.
 */
export function runSubBrains(
    modeId: string,
    input: BrainInput,
    output: BrainOutput,
    instructionKey: string,
    instructionTitle: string,
    logPrefix: string,
): BrainOutput {
    if (!CapabilityRegistry.getInstance().isEnabled('multiBrain')) {
        return output;
    }

    try {
        const registry = getSubBrainRegistry();
        if (!registry.hasBrains(modeId)) return output;

        const subInput = buildSubBrainInput(input, modeId);
        const brains = registry.getBrains(modeId);

        // --- Latency tracking: start ---
        LatencyTracker.getInstance().start('subBrains');

        // Sync execution with per-brain failure isolation
        const results: SubBrainExecutionResult[] = [];
        for (const brain of brains) {
            const startMs = performance.now();
            try {
                const brainOutput = brain.execute(subInput);
                results.push({
                    brainId: brain.id,
                    status: 'success',
                    output: brainOutput,
                    executionMs: Math.round((performance.now() - startMs) * 100) / 100,
                });
            } catch (err: unknown) {
                results.push({
                    brainId: brain.id,
                    status: 'failure',
                    error: err instanceof Error ? err.message : String(err),
                    executionMs: Math.round((performance.now() - startMs) * 100) / 100,
                });
            }
        }

        // --- Latency tracking: end ---
        LatencyTracker.getInstance().end('subBrains');

        // --- Prompt injection (with prompt optimization if enabled) ---
        LatencyTracker.getInstance().start('promptInjection');
        const merged = OutputMerger.merge(results, { confidenceThreshold: MERGE_CONFIDENCE_THRESHOLD });
        const instruction = mergedInsightsToInstruction(merged, instructionKey, instructionTitle, modeId);
        LatencyTracker.getInstance().end('promptInjection');

        // --- Telemetry (capability-gated, non-blocking, silent) ---
        if (CapabilityRegistry.getInstance().isEnabled('multiBrainTelemetry')) {
            queueMicrotask(() => {
                try {
                    MultiBrainTelemetry.getInstance().recordBatch(results);
                } catch { /* telemetry failure is non-fatal */ }
                // Quality scoring (pull-based, persists to electron-store with 2s debounce)
                if (CapabilityRegistry.getInstance().isEnabled('brainQualityScoring')) {
                    try {
                        BrainQualityScorer.getInstance().getReport();
                    } catch { /* quality scoring failure is non-fatal */ }
                }
            });
        }

        // --- Memory persistence (non-blocking, silent) ---
        // ModeMemoryManager.saveMemory() gates on 'modeMemory' capability
        // and enforces MIN_PERSIST_CONFIDENCE internally.
        if (merged.insights.length > 0) {
            queueMicrotask(() => {
                LatencyTracker.getInstance().start('memoryRetrieval');
                try {
                    const memory = ModeMemoryManager.getInstance();
                    for (const insight of merged.insights) {
                        memory.saveMemory({
                            modeId,
                            sourceBrain: instructionKey,
                            label: insight.label,
                            content: insight.reasoning.join('; '),
                            confidence: insight.confidence,
                            tags: [modeId],
                        });
                    }
                } catch { /* memory failure is non-fatal */ }
                LatencyTracker.getInstance().end('memoryRetrieval');
            });
        }

        // --- Explainability surface (capability-gated, non-blocking, silent) ---
        if (merged.insights.length > 0) {
            queueMicrotask(() => {
                LatencyTracker.getInstance().start('explainability');
                try {
                    ExplainabilityIPC.getInstance().explainInsights(merged.insights, instructionKey);
                } catch { /* explainability failure is non-fatal */ }
                LatencyTracker.getInstance().end('explainability');
            });
        }

        // Log all insights (including those below prompt threshold) for diagnostics
        if (merged.insights.length > 0) {
            console.log(
                `[${logPrefix}] Multi-brain: ${merged.brainCount} brains, ` +
                `${merged.insights.length} total insights, ` +
                `${instruction ? 'injecting top signals' : 'no signals above prompt threshold'}, ` +
                `${merged.totalExecutionMs}ms`,
            );
        }

        if (!instruction) return output;

        return {
            ...output,
            instructions: [...output.instructions, instruction],
        };
    } catch {
        // Multi-brain failure is completely silent — base output is unchanged
        return output;
    }
}
