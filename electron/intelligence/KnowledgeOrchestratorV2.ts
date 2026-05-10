// electron/intelligence/KnowledgeOrchestratorV2.ts
// Centralized, priority-scored context retrieval engine.
//
// This module replaces the scattered context building currently split between:
//   - ActionContextBuilder.buildContext() — prompt assembly + context layers
//   - SessionTracker.getFormattedContext() — transcript windowing
//   - LLMHelper.getKnowledgeOrchestrator() — profile intelligence
//
// The V2 orchestrator provides a SINGLE entry point for context retrieval:
//   retrieveContext(params) → ContextBundle
//
// Migration strategy (Strangler Fig):
//   Phase 3a: V2 wraps the existing buildContext() via the adapter layer
//   Phase 3b: V2 replaces buildContext() internals with ContextPrioritizer
//   Phase 3c: ActionContextBuilder becomes a thin PromptAssembler

import { SessionTracker } from '../SessionTracker';
import {
    buildContext,
    buildBaseContext,
    buildTranscriptContext,
    buildProfileContext,
    buildIntentPrompt,
    buildModeContext,
    type BuildContextArgs,
    type BuiltActionContext,
    type BuiltContextLayers,
    type UnifiedActionIntent,
    type ActionRagContext,
    type ProfilePreference,
    type SessionActionMode,
    type PromptObject,
} from '../ActionContextBuilder';
import type { ScreenContentMode } from '../llm/ScreenScanLLM';
import type { QuestionAnalysis } from './QuestionAnalysis';
import type { ContextBundle, ContextSource } from './ContextBundle';
import { createEmptyBundle } from './ContextBundle';
import { prioritizeSources, packIntoBudget } from './ContextPrioritizer';
import { builtLayersToContextBundle } from './adapters';

// ---------------------------------------------------------------------------
// KnowledgeOrchestrator interface (for dependency injection)
// ---------------------------------------------------------------------------

/**
 * Interface for the knowledge orchestrator (profile intelligence provider).
 * Matches the existing KnowledgeOrchestratorLike shape from ActionContextBuilder.
 */
export interface KnowledgeOrchestratorLike {
    isKnowledgeMode?: () => boolean;
    processQuestion?: (question: string) => Promise<any>;
}

// ---------------------------------------------------------------------------
// RetrieveContextParams — input to the orchestrator
// ---------------------------------------------------------------------------

export interface RetrieveContextParams {
    /** Rich question classification from QuestionUnderstandingEngine */
    analysis: QuestionAnalysis;

    /** Session state (transcript, assistant history, context items) */
    session: SessionTracker;

    /** Action intent (drives policy resolution) */
    intent: UnifiedActionIntent;

    /** Session mode (user-selected) */
    mode: SessionActionMode;

    /** Profile intelligence provider */
    profile?: KnowledgeOrchestratorLike | null;

    /** User's explicit message (for manual_chat) */
    message?: string;

    /** Image paths attached to the request */
    imagePaths?: string[];

    /** Profile preference override */
    profilePreference?: ProfilePreference;

    /** Additional context string */
    additionalContext?: string;

    /** RAG context */
    rag?: ActionRagContext | null;

    /** Whether to include mode custom context (reference files, etc.) */
    includeModeCustomContext?: boolean;

    /** Screen scan content mode (for screen_scan intent) */
    screenScanMode?: ScreenContentMode;

    /** Total token budget for all context sources */
    tokenBudget?: number;
}

// ---------------------------------------------------------------------------
// KnowledgeOrchestratorV2
// ---------------------------------------------------------------------------

/**
 * V2 Knowledge Orchestrator — centralized, priority-scored context retrieval.
 *
 * Two modes of operation:
 *
 * **Legacy mode** (default, Phase 3a):
 *   Delegates to the existing `buildContext()` in ActionContextBuilder,
 *   then wraps the output in a ContextBundle via the adapter layer.
 *   This preserves 100% backward compatibility.
 *
 * **Priority mode** (Phase 3b, feature-flagged):
 *   Builds context sources independently, scores them with ContextPrioritizer,
 *   and packs them into the token budget greedily.
 *   This mode is strictly better but requires validation before full rollout.
 */
export class KnowledgeOrchestratorV2 {
    /**
     * Feature flag: when true, uses the new priority-scored context retrieval.
     * When false, delegates to the legacy buildContext() path.
     * Set via environment variable or runtime configuration.
     */
    private usePriorityMode: boolean;

    constructor(options?: { usePriorityMode?: boolean }) {
        this.usePriorityMode = options?.usePriorityMode ?? false;
        console.log(`[KnowledgeOrchestratorV2] Initialized (priorityMode=${this.usePriorityMode})`);
    }

    /**
     * Toggle priority mode at runtime (for A/B testing).
     */
    setPriorityMode(enabled: boolean): void {
        this.usePriorityMode = enabled;
        console.log(`[KnowledgeOrchestratorV2] Priority mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }

    // -----------------------------------------------------------------------
    // Primary API
    // -----------------------------------------------------------------------

    /**
     * Retrieve and prioritize all relevant context for a question.
     *
     * This is the SINGLE entry point for all context retrieval in the new pipeline.
     * Downstream consumers (PromptAssembler, Brain) should depend on this method,
     * never on ActionContextBuilder.buildContext() directly.
     *
     * @returns ContextBundle — prioritized, token-budgeted collection of sources
     */
    async retrieveContext(params: RetrieveContextParams): Promise<ContextBundle> {
        if (this.usePriorityMode) {
            return this.retrieveWithPriority(params);
        }
        return this.retrieveWithLegacy(params);
    }

    // -----------------------------------------------------------------------
    // Legacy mode (Phase 3a) — wraps existing buildContext()
    // -----------------------------------------------------------------------

    private async retrieveWithLegacy(params: RetrieveContextParams): Promise<ContextBundle> {
        try {
            const args: BuildContextArgs = {
                session: params.session,
                intent: params.intent,
                mode: params.mode,
                profile: params.profile,
                message: params.message,
                imagePaths: params.imagePaths,
                profilePreference: params.profilePreference,
                additionalContext: params.additionalContext,
                rag: params.rag,
                includeModeCustomContext: params.includeModeCustomContext,
                screenScanMode: params.screenScanMode,
            };

            const result: BuiltActionContext = await buildContext(args);
            const bundle = builtLayersToContextBundle(result.layers);

            return bundle;
        } catch (error: any) {
            console.error('[KnowledgeOrchestratorV2] Legacy context retrieval failed:', error?.message);
            return createEmptyBundle();
        }
    }

    // -----------------------------------------------------------------------
    // Priority mode (Phase 3b) — independent source scoring
    // -----------------------------------------------------------------------

    private async retrieveWithPriority(params: RetrieveContextParams): Promise<ContextBundle> {
        const tokenBudget = params.tokenBudget ?? 4000; // default ~4000 tokens for context
        const sources: ContextSource[] = [];

        try {
            // 1. Transcript source
            const transcriptSection = buildTranscriptContext(
                params.session,
                params.intent,
                params.message || params.analysis.answerShape,
                params.mode,
            );

            if (transcriptSection.content && transcriptSection.content !== '[NO TRANSCRIPT AVAILABLE]') {
                sources.push({
                    id: `transcript_${transcriptSection.strategy}`,
                    type: 'transcript',
                    title: transcriptSection.title,
                    content: transcriptSection.content,
                    approxTokens: transcriptSection.approxTokens,
                    relevanceScore: 1.0,
                    freshness: 1.0,
                });
            }

            // 2. Profile intelligence source
            const profileResult = await buildProfileContext(
                params.intent,
                params.profile,
                params.message || '',
                params.profilePreference,
            );

            let directResponse: string | undefined;

            if (profileResult.directResponse) {
                directResponse = profileResult.directResponse;
            } else if (profileResult.profile?.used && profileResult.profile.context) {
                sources.push({
                    id: 'profile_intelligence',
                    type: 'profile_intelligence',
                    title: profileResult.profile.title,
                    content: profileResult.profile.context,
                    approxTokens: profileResult.profile.approxTokens,
                    relevanceScore: params.analysis.category === 'resume_jd' ? 1.0 : 0.7,
                    freshness: 0.5,
                });
            }

            // 3. RAG source
            if (params.rag?.content) {
                sources.push({
                    id: `rag_${params.rag.scope}`,
                    type: 'rag_memory',
                    title: params.rag.title || `RAG MEMORY (${params.rag.scope.toUpperCase()})`,
                    content: params.rag.content,
                    approxTokens: Math.ceil(params.rag.content.length / 3.5),
                    relevanceScore: 0.7,
                    freshness: params.rag.scope === 'live' ? 0.9 : 0.6,
                });
            }

            // 4. Additional context source
            if (params.additionalContext?.trim()) {
                sources.push({
                    id: 'supplemental',
                    type: 'supplemental',
                    title: 'SUPPLEMENTAL CONTEXT',
                    content: params.additionalContext.trim(),
                    approxTokens: Math.ceil(params.additionalContext.length / 3.5),
                    relevanceScore: 0.6,
                    freshness: 0.9,
                });
            }

            // 5. Mode custom context (reference files, etc.)
            if (params.includeModeCustomContext !== false) {
                const modeInstructions = buildModeContext(params.mode, {
                    includeModeCustomContext: params.includeModeCustomContext,
                });
                const modeCustom = modeInstructions.find(i => i.key === 'active_mode_context');
                if (modeCustom?.content) {
                    sources.push({
                        id: 'mode_custom_context',
                        type: 'mode_custom',
                        title: 'MODE CONTEXT',
                        content: modeCustom.content,
                        approxTokens: Math.ceil(modeCustom.content.length / 3.5),
                        relevanceScore: 0.5,
                        freshness: 0.3,
                    });
                }
            }

            // 6. Prioritize and pack
            const prioritized = prioritizeSources(sources, params.analysis.category);
            const { included, totalTokens, dropped } = packIntoBudget(prioritized, tokenBudget);

            if (dropped.length > 0) {
                console.log(`[KnowledgeOrchestratorV2] Dropped ${dropped.length} sources due to token budget:`,
                    dropped.map(s => `${s.id}(${s.approxTokens}tok)`).join(', '));
            }

            return {
                sources: included,
                totalTokens,
                profileApplied: profileResult.profile?.used ?? false,
                resolvedProfilePolicy: profileResult.profile?.policy ?? 'never',
                directResponse,
            };
        } catch (error: any) {
            console.error('[KnowledgeOrchestratorV2] Priority context retrieval failed:', error?.message);
            return createEmptyBundle();
        }
    }

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------

    /**
     * Get a debug summary of how context was built for a request.
     * Useful for comparing legacy vs priority mode output.
     */
    getModeSummary(): string {
        return `KnowledgeOrchestratorV2 (mode=${this.usePriorityMode ? 'priority' : 'legacy'})`;
    }
}
