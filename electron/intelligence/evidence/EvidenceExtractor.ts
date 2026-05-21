// electron/intelligence/evidence/EvidenceExtractor.ts
// Transcript quote extraction with keyword-based relevance scoring.
//
// Pure functions — no state, no side effects.
// Does NOT import from SessionTracker to avoid circular dependencies.
// Uses a locally-defined minimal interface for structured segments.
//
// Usage:
//   const evidence = extractEvidence({
//       transcript: '[INTERVIEWER]: Tell me about your system design experience...',
//       keywords: ['system design', 'architecture', 'scalability'],
//   });

import type { Evidence, EvidenceExtractionConfig } from './types';

// ---------------------------------------------------------------------------
// Local Types (avoids importing from SessionTracker)
// ---------------------------------------------------------------------------

/** Minimal transcript segment interface — compatible with SessionTracker segments */
export interface TranscriptSegmentLike {
    readonly speaker: string;
    readonly text: string;
    readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

const DEFAULT_EXTRACTION_CONFIG: Readonly<EvidenceExtractionConfig> = {
    maxQuotes: 5,
    minQuoteLength: 10,
    maxQuoteLength: 500,
    relevanceThreshold: 0.1,
};

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Extract evidence from a formatted transcript string.
 *
 * Expects lines in the format: `[SPEAKER]: text`
 * (This is the format produced by SessionTracker.getFormattedContext)
 */
export function extractEvidence(params: {
    readonly transcript: string;
    readonly keywords: readonly string[];
    readonly config?: Partial<EvidenceExtractionConfig>;
}): Evidence[] {
    const config = { ...DEFAULT_EXTRACTION_CONFIG, ...params.config };
    const lines = params.transcript.split('\n').filter(Boolean);
    const scored: Array<{ evidence: Evidence; score: number }> = [];

    for (const line of lines) {
        const parsed = parseTranscriptLine(line);
        if (!parsed) continue;

        const { speaker, text } = parsed;

        if (text.length < config.minQuoteLength) continue;

        const score = computeKeywordOverlap(text, params.keywords);
        if (score < config.relevanceThreshold) continue;

        const quote = text.length > config.maxQuoteLength
            ? text.slice(0, config.maxQuoteLength) + '…'
            : text;

        scored.push({
            evidence: {
                quote,
                speaker,
                timestamp: Date.now(),
                confidence: score,
                source: 'transcript',
            },
            score,
        });
    }

    // Sort by relevance descending, take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, config.maxQuotes).map(s => s.evidence);
}

/**
 * Extract evidence from structured transcript segments.
 *
 * Works with objects that have { speaker, text, timestamp } fields.
 * Compatible with SessionTracker.TranscriptSegment without importing it.
 */
export function extractEvidenceFromSegments(
    segments: readonly TranscriptSegmentLike[],
    keywords: readonly string[],
    config?: Partial<EvidenceExtractionConfig>,
): Evidence[] {
    const merged = { ...DEFAULT_EXTRACTION_CONFIG, ...config };
    const scored: Array<{ evidence: Evidence; score: number }> = [];

    for (const segment of segments) {
        const text = segment.text.trim();

        if (text.length < merged.minQuoteLength) continue;

        const score = computeKeywordOverlap(text, keywords);
        if (score < merged.relevanceThreshold) continue;

        const quote = text.length > merged.maxQuoteLength
            ? text.slice(0, merged.maxQuoteLength) + '…'
            : text;

        scored.push({
            evidence: {
                quote,
                speaker: segment.speaker,
                timestamp: segment.timestamp,
                confidence: score,
                source: 'transcript',
            },
            score,
        });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, merged.maxQuotes).map(s => s.evidence);
}

/**
 * Compute keyword overlap score between text and a set of keywords.
 *
 * Returns a value in [0, 1]:
 *   0 = no keywords found
 *   1 = all keywords found
 */
export function computeKeywordOverlap(
    text: string,
    keywords: readonly string[],
): number {
    if (keywords.length === 0) return 0;

    const normalizedText = text.toLowerCase();
    let matchCount = 0;

    for (const keyword of keywords) {
        if (normalizedText.includes(keyword.toLowerCase())) {
            matchCount++;
        }
    }

    return matchCount / keywords.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a transcript line in format `[SPEAKER]: text`
 */
function parseTranscriptLine(line: string): { speaker: string; text: string } | null {
    const match = line.match(/^\[([^\]]+)\]:\s*(.+)$/);
    if (!match) return null;

    return {
        speaker: match[1].trim(),
        text: match[2].trim(),
    };
}
