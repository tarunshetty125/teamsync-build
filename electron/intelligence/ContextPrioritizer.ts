// electron/intelligence/ContextPrioritizer.ts
// Priority-scores context sources based on the QuestionCategory.
//
// Currently, context priority in ActionContextBuilder is implicit — baked into
// the serialization order (RAG → Supplemental → Profile → Transcript).
// This module makes priority a first-class, configurable decision.
//
// Each QuestionCategory has its own priority ranking for context source types.
// The ContextPrioritizer scores sources and returns them sorted by effective priority.

import type { QuestionCategory, ContextSourceType } from './types';
import type { ContextSource } from './ContextBundle';

// ---------------------------------------------------------------------------
// Priority Tables
// ---------------------------------------------------------------------------

/**
 * Priority rank per source type per category.
 * Lower number = higher priority (1 = highest).
 *
 * These tables encode the domain knowledge:
 *   - Coding questions: screen/images > transcript > previous answers > RAG > profile
 *   - Behavioral questions: transcript > profile > previous answers > RAG > screen
 *   - System design: transcript > previous answers > RAG > screen > profile
 *   - Resume/JD: profile > transcript > RAG > previous answers > screen
 *   - General: transcript > profile > RAG > previous answers > screen
 *   - Follow-up/clarification: transcript always first, previous answers second
 */
const PRIORITY_TABLES: Record<QuestionCategory, Record<ContextSourceType, number>> = {
    coding: {
        screen_content: 1,
        transcript: 2,
        session_memory: 3,
        rag_memory: 4,
        supplemental: 5,
        profile_intelligence: 6,
        mode_custom: 7,
    },
    behavioral: {
        transcript: 1,
        profile_intelligence: 2,
        session_memory: 3,
        rag_memory: 4,
        supplemental: 5,
        screen_content: 6,
        mode_custom: 7,
    },
    system_design: {
        transcript: 1,
        session_memory: 2,
        rag_memory: 3,
        screen_content: 4,
        supplemental: 5,
        profile_intelligence: 6,
        mode_custom: 7,
    },
    resume_jd: {
        profile_intelligence: 1,
        transcript: 2,
        rag_memory: 3,
        session_memory: 4,
        supplemental: 5,
        screen_content: 6,
        mode_custom: 7,
    },
    follow_up: {
        transcript: 1,
        session_memory: 2,
        profile_intelligence: 3,
        rag_memory: 4,
        supplemental: 5,
        screen_content: 6,
        mode_custom: 7,
    },
    clarification: {
        transcript: 1,
        session_memory: 2,
        supplemental: 3,
        rag_memory: 4,
        profile_intelligence: 5,
        screen_content: 6,
        mode_custom: 7,
    },
    general: {
        transcript: 1,
        profile_intelligence: 2,
        rag_memory: 3,
        session_memory: 4,
        supplemental: 5,
        screen_content: 6,
        mode_custom: 7,
    },
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Compute the effective priority score for a context source.
 *
 * Formula: effectiveScore = relevanceScore * 0.6 + freshness * 0.4
 *
 * The relevance score is derived from the priority table:
 *   rank 1 → relevance 1.0
 *   rank 7 → relevance 0.14
 *   General formula: relevance = 1 / rank
 *
 * Higher effectiveScore = higher priority.
 */
function computeEffectiveScore(
    source: ContextSource,
    category: QuestionCategory,
): number {
    const priorityTable = PRIORITY_TABLES[category] ?? PRIORITY_TABLES.general;
    const rank = priorityTable[source.type] ?? 7;
    const baseRelevance = 1 / rank;

    // Combine base relevance with the source's own relevance and freshness scores
    const relevance = (baseRelevance * 0.5) + (source.relevanceScore * 0.5);
    return relevance * 0.6 + source.freshness * 0.4;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sort context sources by priority for a given question category.
 *
 * Returns a new array sorted by effective priority (highest first).
 * Does NOT modify the input array.
 *
 * @param sources - Unordered context sources
 * @param category - The question category driving priority
 * @returns Sorted array (highest priority first)
 */
export function prioritizeSources(
    sources: ContextSource[],
    category: QuestionCategory,
): ContextSource[] {
    return [...sources].sort((a, b) => {
        const scoreA = computeEffectiveScore(a, category);
        const scoreB = computeEffectiveScore(b, category);
        return scoreB - scoreA; // descending — highest score first
    });
}

/**
 * Greedily pack context sources into a token budget.
 *
 * Takes a priority-sorted array of sources and includes them one by one
 * until the budget is exceeded. The last source that would overflow is
 * excluded (never truncated — truncation is done upstream by transcript windowing).
 *
 * Invariant: transcript is NEVER dropped, even if it exceeds the budget alone.
 *
 * @param sources - Priority-sorted context sources (highest first)
 * @param tokenBudget - Maximum total tokens to include
 * @returns Object with included sources and total tokens consumed
 */
export function packIntoBudget(
    sources: ContextSource[],
    tokenBudget: number,
): { included: ContextSource[]; totalTokens: number; dropped: ContextSource[] } {
    const included: ContextSource[] = [];
    const dropped: ContextSource[] = [];
    let totalTokens = 0;

    for (const source of sources) {
        // Transcript is NEVER dropped — it is the foundation of every response
        if (source.type === 'transcript') {
            included.push(source);
            totalTokens += source.approxTokens;
            continue;
        }

        if (totalTokens + source.approxTokens <= tokenBudget) {
            included.push(source);
            totalTokens += source.approxTokens;
        } else {
            dropped.push(source);
        }
    }

    return { included, totalTokens, dropped };
}

/**
 * Get the priority table for a given category (for debugging/logging).
 */
export function getPriorityTable(
    category: QuestionCategory,
): Record<ContextSourceType, number> {
    return { ...(PRIORITY_TABLES[category] ?? PRIORITY_TABLES.general) };
}
