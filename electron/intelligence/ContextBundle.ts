// electron/intelligence/ContextBundle.ts
// Output type of the KnowledgeOrchestrator.
// Consumed by: ReasoningPlanner, Brain.execute(), PromptAssembler.
//
// Replaces the scattered context building currently split between:
//   - ActionContextBuilder.buildContextLayers()
//   - SessionTracker.getFormattedContext()
//   - LLMHelper.getKnowledgeOrchestrator()
//
// The ContextBundle is a prioritized, token-budgeted collection of context
// sources ready for prompt assembly.

import type { ContextSourceType, ProfilePolicy } from './types';

// ---------------------------------------------------------------------------
// ContextSource — a single unit of retrievable context
// ---------------------------------------------------------------------------

/**
 * Represents one context source (e.g., transcript window, RAG result, profile intelligence).
 * Sources are scored by relevance and freshness, then greedily packed into the token budget.
 */
export interface ContextSource {
    /** Unique identifier for this source (e.g., 'transcript_rolling', 'rag_live', 'profile_resume') */
    id: string;

    /** Source type — used for priority ordering per QuestionCategory */
    type: ContextSourceType;

    /** Display title for prompt serialization (e.g., "RECENT TRANSCRIPT", "RAG MEMORY (LIVE)") */
    title: string;

    /** The actual content string */
    content: string;

    /** Approximate token count of the content (1 token ≈ 3.5 chars) */
    approxTokens: number;

    /**
     * Relevance score (0-1) relative to the current question.
     * Computed by the ContextPrioritizer based on QuestionCategory.
     */
    relevanceScore: number;

    /**
     * Freshness score (0-1). Higher = more recent.
     * Ensures recent transcript is preferred over stale epoch summaries.
     */
    freshness: number;
}

// ---------------------------------------------------------------------------
// ContextBundle — the complete context package for one question
// ---------------------------------------------------------------------------

/**
 * The complete, prioritized context bundle for a single intelligence request.
 * Produced by the KnowledgeOrchestrator and consumed by the PromptAssembler.
 *
 * Invariants:
 *   - `sources` are ordered by effective priority (highest first)
 *   - `totalTokens` ≤ the token budget passed to the orchestrator
 *   - If `directResponse` is non-null, the pipeline should emit it directly
 *     without calling the LLM (used for intro question fast-path)
 */
export interface ContextBundle {
    /** Context sources ordered by priority (highest first) */
    sources: ContextSource[];

    /** Total token budget consumed by all sources */
    totalTokens: number;

    /** Whether profile intelligence was applied to this bundle */
    profileApplied: boolean;

    /** The profile policy that was resolved for this request */
    resolvedProfilePolicy: ProfilePolicy;

    /**
     * Direct response — bypasses the LLM entirely.
     * Set when the KnowledgeOrchestrator detects a question that can be
     * answered directly from cached knowledge (e.g., "Tell me about yourself"
     * with a pre-generated intro response, or negotiation live script).
     */
    directResponse?: string;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create an empty ContextBundle (no sources retrieved).
 * Used as a fallback when context retrieval fails or is skipped.
 */
export function createEmptyBundle(): ContextBundle {
    return {
        sources: [],
        totalTokens: 0,
        profileApplied: false,
        resolvedProfilePolicy: 'never',
    };
}
