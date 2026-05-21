// electron/intelligence/confidence/ConfidenceNormalizer.ts
// Model confidence normalization utilities.
//
// Converts raw model outputs (logprobs, temperature-adjusted scores)
// into calibrated [0, 1] confidence values.
//
// All pure functions — no state, no side effects.

// ---------------------------------------------------------------------------
// Normalization Functions
// ---------------------------------------------------------------------------

/**
 * Map a log probability to [0, 1] using a sigmoid function.
 * logprob values are typically negative (e.g., -0.5 for high confidence).
 *
 * sigmoid(x) = 1 / (1 + exp(-x))
 *
 * We shift and scale so that:
 *   logprob = 0   → ~0.73 (high confidence)
 *   logprob = -1  → ~0.5  (moderate)
 *   logprob = -3  → ~0.18 (low)
 *   logprob = -5  → ~0.07 (very low)
 */
export function normalizeModelConfidence(logprob: number): number {
    // Shift logprob by +1 to center the sigmoid around typical values
    const shifted = logprob + 1;
    const value = 1 / (1 + Math.exp(-shifted));
    return clampConfidence(value);
}

/**
 * Adjust a raw confidence score based on LLM temperature.
 *
 * Higher temperature → more randomness → lower effective confidence.
 * At temperature 0, confidence is unchanged.
 * At temperature 1, confidence is reduced by ~30%.
 * At temperature 2, confidence is reduced by ~50%.
 *
 * Formula: adjusted = raw × (1 / (1 + temperature × 0.5))
 */
export function normalizeTemperatureAdjusted(raw: number, temperature: number): number {
    if (temperature <= 0) {
        return clampConfidence(raw);
    }
    const dampingFactor = 1 / (1 + temperature * 0.5);
    return clampConfidence(raw * dampingFactor);
}

/**
 * Clamp a value to [0.0, 1.0].
 */
export function clampConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}
