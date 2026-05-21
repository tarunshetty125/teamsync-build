// electron/intelligence/memory/MemoryRetriever.ts
// Retrieval scoring for mode memory entries.
//
// Scoring formula:
//   finalScore = cosineSimilarity * 0.8 + recencyBoost * 0.2
//
// All pure functions. No side effects. No state.
// Does NOT call VectorStore directly — operates on pre-fetched scored chunks.

import type { MemoryEntry, MemoryQuery, ScoredMemory } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Decay half-life for recency boost (24 hours in ms) */
const RECENCY_HALF_LIFE_MS = 24 * 60 * 60 * 1000;

/** Default recency weight in the final score */
const DEFAULT_RECENCY_WEIGHT = 0.2;

/** Default similarity weight (1 - recencyWeight) */
const DEFAULT_SIMILARITY_WEIGHT = 0.8;

// ---------------------------------------------------------------------------
// Recency Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a recency boost for a memory entry.
 * Uses exponential decay with a 24-hour half-life.
 *
 * @param entryTimestamp - When the memory was created (unix ms)
 * @param nowMs - Current time (unix ms)
 * @returns Recency boost in [0.0, 1.0]
 */
export function computeRecencyBoost(entryTimestamp: number, nowMs: number): number {
    const ageMs = Math.max(0, nowMs - entryTimestamp);
    return Math.pow(0.5, ageMs / RECENCY_HALF_LIFE_MS);
}

// ---------------------------------------------------------------------------
// Final Score
// ---------------------------------------------------------------------------

/**
 * Compute the final retrieval score for a memory entry.
 *
 * finalScore = similarity * similarityWeight + recencyBoost * recencyWeight
 *
 * @param similarity - Cosine similarity from VectorStore (0.0–1.0)
 * @param recencyBoost - Recency boost (0.0–1.0)
 * @param recencyWeight - Weight for recency (0.0–1.0, default 0.2)
 */
export function computeFinalScore(
    similarity: number,
    recencyBoost: number,
    recencyWeight: number = DEFAULT_RECENCY_WEIGHT,
): number {
    const simWeight = 1.0 - recencyWeight;
    return similarity * simWeight + recencyBoost * recencyWeight;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Rank memory entries by final score.
 * Applies mode filtering, optional tag filtering, optional confidence filtering.
 * Returns top-K results sorted by descending finalScore.
 *
 * @param entries - All candidate memory entries
 * @param similarities - Cosine similarities aligned 1:1 with entries
 * @param query - Retrieval query parameters
 */
export function rankMemories(
    entries: readonly MemoryEntry[],
    similarities: readonly number[],
    query: MemoryQuery,
): ScoredMemory[] {
    const now = Date.now();
    const recencyWeight = query.recencyWeight ?? DEFAULT_RECENCY_WEIGHT;
    const minConfidence = query.minConfidence ?? 0;
    const queryTags = query.tags ? new Set(query.tags) : null;

    const scored: ScoredMemory[] = [];

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const similarity = similarities[i];

        // Mode filter
        if (entry.modeId !== query.modeId) continue;

        // Confidence filter
        if (entry.confidence < minConfidence) continue;

        // Tag filter (any match)
        if (queryTags && queryTags.size > 0) {
            const hasMatchingTag = entry.tags.some(tag => queryTags.has(tag));
            if (!hasMatchingTag) continue;
        }

        const recencyBoost = computeRecencyBoost(entry.timestamp, now);
        const finalScore = computeFinalScore(similarity, recencyBoost, recencyWeight);

        scored.push({
            entry,
            similarity,
            recencyBoost,
            finalScore,
        });
    }

    // Sort descending by finalScore (deterministic: tiebreak by timestamp desc)
    scored.sort((a, b) => {
        const scoreDiff = b.finalScore - a.finalScore;
        if (scoreDiff !== 0) return scoreDiff;
        return b.entry.timestamp - a.entry.timestamp;
    });

    return scored.slice(0, query.topK);
}
