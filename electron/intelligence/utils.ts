// electron/intelligence/utils.ts
// Shared utility functions for the intelligence pipeline.
//
// Extracted from QuestionUnderstandingV2, ResponseDepthEstimator, and
// ContextPriorityEngine to eliminate code duplication (audit finding H4).

import { normalizeSystemDesignEntityTypos } from '../../src/lib/overlay/systemDesignEntityNormalizer';

/**
 * Normalize a question string for pattern matching.
 * Lowercases, collapses abbreviation periods, strips special chars,
 * and normalizes whitespace.
 */
export function normalizeQuestion(text: string): string {
    const normalized = text
        .toLowerCase()
        .replace(/(\w)\.\s+(\w)/g, '$1$2')
        .replace(/[^\w\s+./?-]/g, ' ');

    return normalizeSystemDesignEntityTypos(normalized, { casing: 'lower' })
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Clamp a numeric value to [0, 1] and round to 2 decimal places.
 * Used for confidence scoring across the pipeline.
 */
export function clampConfidence(value: number): number {
    return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}
