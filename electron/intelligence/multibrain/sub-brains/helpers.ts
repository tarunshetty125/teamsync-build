// electron/intelligence/multibrain/sub-brains/helpers.ts
// Shared helpers for sub-brain implementations.
// Keeps sub-brain files small and DRY.

import type { Evidence } from '../../evidence/types';
import type { SubBrainInsight, SubBrainOutput } from '../types';

// ---------------------------------------------------------------------------
// Pattern Matching
// ---------------------------------------------------------------------------

export interface PatternMatch {
    readonly pattern: RegExp;
    readonly label: string;
    readonly quote: string;
    readonly index: number;
}

/**
 * Count regex matches in text, returning match details.
 */
export function findPatternMatches(text: string, patterns: readonly RegExp[]): PatternMatch[] {
    const matches: PatternMatch[] = [];

    for (const pattern of patterns) {
        const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        let match: RegExpExecArray | null;

        while ((match = globalPattern.exec(text)) !== null) {
            // Extract surrounding context (up to 80 chars each side)
            const start = Math.max(0, match.index - 80);
            const end = Math.min(text.length, match.index + match[0].length + 80);
            const quote = text.slice(start, end).trim();

            matches.push({
                pattern,
                label: match[0],
                quote,
                index: match.index,
            });
        }
    }

    return matches;
}

/**
 * Count total matches for a set of patterns.
 */
export function countPatterns(text: string, patterns: readonly RegExp[]): number {
    return patterns.reduce((count, pattern) => {
        const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        const matches = text.match(globalPattern);
        return count + (matches?.length ?? 0);
    }, 0);
}

// ---------------------------------------------------------------------------
// Evidence Building
// ---------------------------------------------------------------------------

/**
 * Convert pattern matches into Evidence items.
 */
export function matchesToEvidence(
    matches: readonly PatternMatch[],
    source: 'transcript' = 'transcript',
    maxItems: number = 3,
): Evidence[] {
    return matches.slice(0, maxItems).map(match => ({
        quote: match.quote,
        speaker: '',
        timestamp: Date.now(),
        confidence: 0.7,
        source,
    }));
}

// ---------------------------------------------------------------------------
// Output Building
// ---------------------------------------------------------------------------

/**
 * Build a SubBrainOutput from insights.
 */
export function buildOutput(id: string, insights: SubBrainInsight[], startMs: number): SubBrainOutput {
    return {
        id,
        insights,
        executionMs: Math.round((performance.now() - startMs) * 100) / 100,
    };
}

/**
 * Compute a simple confidence score from match counts.
 * Maps: 0 matches → 0, 1 → 0.3, 2 → 0.5, 3 → 0.65, 4+ → 0.8
 */
export function matchCountToConfidence(count: number): number {
    if (count <= 0) return 0;
    if (count === 1) return 0.3;
    if (count === 2) return 0.5;
    if (count === 3) return 0.65;
    return Math.min(0.95, 0.8 + count * 0.02);
}
