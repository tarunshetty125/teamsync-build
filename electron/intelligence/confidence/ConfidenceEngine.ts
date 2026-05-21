// electron/intelligence/confidence/ConfidenceEngine.ts
// Probabilistic confidence scoring with Bayesian smoothing.
//
// Pure functions — no state, no side effects, no external dependencies.
// Designed to be composed with domain-specific factor generators.
//
// Usage:
//   const factors = [
//       { name: 'keyword_match', contribution: 0.8, description: 'Strong keyword overlap' },
//       { name: 'star_structure', contribution: 0.6, description: 'STAR pattern detected' },
//   ];
//   const result = computeConfidence(factors);
//   // result.calibrated → 0.62 (smoothed)

import type { ConfidenceFactor, ConfidenceResult, ConfidenceConfig } from './types';

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIDENCE_CONFIG: Readonly<ConfidenceConfig> = {
    defaultThreshold: 0.3,
    highConfidenceFloor: 0.7,
    bayesianPrior: 0.5,
    hallucinationPenalty: 0.15,
};

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Compute confidence from a set of contributing factors.
 *
 * Raw score = average of positive contributions, penalized by negative ones.
 * Calibrated score = Bayesian smoothing of raw score.
 *
 * Bayesian formula: calibrated = (raw × n + prior × k) / (n + k)
 * where n = factor count, k = prior strength (fixed at 2).
 */
export function computeConfidence(
    factors: readonly ConfidenceFactor[],
    config?: Partial<ConfidenceConfig>,
): ConfidenceResult {
    const merged = { ...DEFAULT_CONFIDENCE_CONFIG, ...config };

    if (factors.length === 0) {
        return {
            raw: 0,
            calibrated: merged.bayesianPrior * 0.5, // weak prior when no evidence
            source: 'heuristic',
            factors: [],
        };
    }

    // Compute raw score: weighted average of contributions, clamped to [0, 1]
    const totalContribution = factors.reduce((sum, f) => sum + f.contribution, 0);
    const rawUnclamped = totalContribution / factors.length;
    const raw = clamp(rawUnclamped, 0, 1);

    // Bayesian smoothing: pull toward prior when evidence is sparse
    const n = factors.length;
    const k = 2; // prior strength — small so real evidence dominates quickly
    const calibrated = clamp((raw * n + merged.bayesianPrior * k) / (n + k), 0, 1);

    return {
        raw,
        calibrated,
        source: 'heuristic',
        factors,
    };
}

/**
 * Apply a hallucination penalty to a confidence result.
 *
 * Each hallucination indicator reduces the calibrated score
 * by `hallucinationPenalty` (default 0.15). The result is clamped to 0.
 *
 * A new 'hallucination_penalty' factor is appended to the factors list.
 */
export function applyHallucinationPenalty(
    result: ConfidenceResult,
    hallucinationCount: number,
    config?: Partial<ConfidenceConfig>,
): ConfidenceResult {
    if (hallucinationCount <= 0) {
        return result;
    }

    const merged = { ...DEFAULT_CONFIDENCE_CONFIG, ...config };
    const penalty = hallucinationCount * merged.hallucinationPenalty;
    const adjusted = clamp(result.calibrated - penalty, 0, 1);

    const penaltyFactor: ConfidenceFactor = {
        name: 'hallucination_penalty',
        contribution: -penalty,
        description: `${hallucinationCount} hallucination indicator(s) detected`,
    };

    return {
        raw: result.raw,
        calibrated: adjusted,
        source: result.source,
        factors: [...result.factors, penaltyFactor],
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
