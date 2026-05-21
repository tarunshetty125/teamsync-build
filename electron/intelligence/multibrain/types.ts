// electron/intelligence/multibrain/types.ts
// Types for the multi-brain parallel execution system.
//
// IMPORTANT: This file must have ZERO runtime dependencies
// except for re-exported Phase 1 types.

import type { Evidence } from '../evidence/types';

// ---------------------------------------------------------------------------
// SubBrain Input
// ---------------------------------------------------------------------------

/**
 * Input passed to each sub-brain for analysis.
 * Derived from the parent Brain's HeuristicText — lightweight, no LLM context.
 */
export interface SubBrainInput {
    /** Raw concatenated text from transcript + user message + context */
    readonly rawText: string;
    /** Lowercased, whitespace-normalized version of rawText */
    readonly normalizedText: string;
    /** Current mode ID (e.g., 'recruiting', 'sales') */
    readonly modeId: string;
}

// ---------------------------------------------------------------------------
// SubBrain Output
// ---------------------------------------------------------------------------

/**
 * A single insight produced by a sub-brain.
 * Every insight MUST have confidence + evidence + reasoning.
 */
export interface SubBrainInsight {
    /** Human-readable label (e.g., "Strong ownership language") */
    readonly label: string;
    /** Calibrated confidence (0.0–1.0) */
    readonly confidence: number;
    /** Transcript evidence supporting this insight (Phase 1 Evidence type) */
    readonly evidence: readonly Evidence[];
    /** Step-by-step reasoning for transparency */
    readonly reasoning: readonly string[];
    /** Contribution weight for merge (0.0–1.0) */
    readonly weight: number;
}

/**
 * Full output from a single sub-brain execution.
 */
export interface SubBrainOutput {
    /** Sub-brain ID that produced this output */
    readonly id: string;
    /** Insights extracted */
    readonly insights: readonly SubBrainInsight[];
    /** Execution time in ms */
    readonly executionMs: number;
}

// ---------------------------------------------------------------------------
// SubBrain Interface
// ---------------------------------------------------------------------------

/**
 * A sub-brain is a narrowly-scoped, synchronous, deterministic analyzer.
 *
 * Contract:
 *   ✅ Pure logic — regex + heuristics only
 *   ✅ Synchronous execution (<2ms target)
 *   ✅ Returns SubBrainOutput with evidence
 *   ❌ No LLM calls
 *   ❌ No network I/O
 *   ❌ No async operations
 *   ❌ No external state
 */
export interface SubBrain {
    /** Unique identifier */
    readonly id: string;
    /** Human-readable name for logging */
    readonly name: string;
    /** Default merge weight (0.0–1.0) — higher = more influence on merged output */
    readonly weight: number;
    /** Per-brain timeout in ms (safety net) */
    readonly timeoutMs: number;
    /** Execute analysis on the input text */
    execute(input: SubBrainInput): SubBrainOutput;
}

// ---------------------------------------------------------------------------
// Merged Output
// ---------------------------------------------------------------------------

/**
 * Result of merging multiple sub-brain outputs.
 */
export interface MergedInsightSet {
    /** Deduplicated, confidence-ranked insights */
    readonly insights: readonly SubBrainInsight[];
    /** How many sub-brains contributed */
    readonly brainCount: number;
    /** How many sub-brains failed (timed out or threw) */
    readonly failureCount: number;
    /** Total execution time across all sub-brains */
    readonly totalExecutionMs: number;
}

// ---------------------------------------------------------------------------
// Executor Types
// ---------------------------------------------------------------------------

/** Result of a single sub-brain execution attempt */
export interface SubBrainExecutionResult {
    readonly brainId: string;
    readonly status: 'success' | 'failure' | 'timeout';
    readonly output?: SubBrainOutput;
    readonly error?: string;
    readonly executionMs: number;
}
