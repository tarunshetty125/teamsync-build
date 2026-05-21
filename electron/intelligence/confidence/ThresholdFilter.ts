// electron/intelligence/confidence/ThresholdFilter.ts
// Threshold-based confidence filtering.
//
// Classifies confidence values into tiers (high/medium/low)
// and filters collections by minimum confidence threshold.
//
// All pure functions — no state, no side effects.

import type { ConfidenceConfig, ConfidenceThresholdResult } from './types';
import { DEFAULT_CONFIDENCE_CONFIG } from './ConfidenceEngine';

// ---------------------------------------------------------------------------
// Threshold Functions
// ---------------------------------------------------------------------------

/**
 * Evaluate a confidence value against thresholds.
 *
 * Tiers:
 *   high   — confidence >= highConfidenceFloor (default 0.7)
 *   medium — confidence >= defaultThreshold (default 0.3)
 *   low    — confidence < defaultThreshold
 */
export function filterByThreshold(
    confidence: number,
    config?: Partial<ConfidenceConfig>,
): ConfidenceThresholdResult {
    const merged = { ...DEFAULT_CONFIDENCE_CONFIG, ...config };

    let tier: ConfidenceThresholdResult['tier'];
    if (confidence >= merged.highConfidenceFloor) {
        tier = 'high';
    } else if (confidence >= merged.defaultThreshold) {
        tier = 'medium';
    } else {
        tier = 'low';
    }

    return {
        passed: confidence >= merged.defaultThreshold,
        confidence,
        threshold: merged.defaultThreshold,
        tier,
    };
}

/**
 * Filter a collection of items by confidence threshold.
 * Only items with `confidence >= defaultThreshold` are returned.
 */
export function filterResults<T extends { readonly confidence: number }>(
    items: readonly T[],
    config?: Partial<ConfidenceConfig>,
): T[] {
    const merged = { ...DEFAULT_CONFIDENCE_CONFIG, ...config };
    return items.filter(item => item.confidence >= merged.defaultThreshold);
}
