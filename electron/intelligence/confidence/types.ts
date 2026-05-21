// electron/intelligence/confidence/types.ts
// Types for the confidence scoring system.
// IMPORTANT: This file must have ZERO runtime dependencies.

// ---------------------------------------------------------------------------
// Confidence Factors
// ---------------------------------------------------------------------------

/**
 * A named contributing factor to a confidence score.
 * Positive contribution = boosting, negative = penalizing.
 */
export interface ConfidenceFactor {
    readonly name: string;
    readonly contribution: number;
    readonly description: string;
}

// ---------------------------------------------------------------------------
// Confidence Result
// ---------------------------------------------------------------------------

/**
 * The calibrated output of the confidence engine.
 */
export interface ConfidenceResult {
    /** Pre-calibration score (0.0–1.0) */
    readonly raw: number;
    /** Post-calibration score with Bayesian smoothing (0.0–1.0) */
    readonly calibrated: number;
    /** How the score was derived */
    readonly source: 'heuristic' | 'model' | 'ensemble';
    /** All contributing factors */
    readonly factors: readonly ConfidenceFactor[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Runtime-tunable configuration for confidence scoring.
 */
export interface ConfidenceConfig {
    /** Minimum confidence to surface an insight (default 0.3) */
    readonly defaultThreshold: number;
    /** Above this = "high confidence" tier (default 0.7) */
    readonly highConfidenceFloor: number;
    /** Bayesian prior for smoothing (default 0.5) */
    readonly bayesianPrior: number;
    /** Penalty multiplier per hallucination indicator (default 0.15) */
    readonly hallucinationPenalty: number;
}

// ---------------------------------------------------------------------------
// Threshold Filtering
// ---------------------------------------------------------------------------

/**
 * Output of threshold-based confidence filtering.
 */
export interface ConfidenceThresholdResult {
    readonly passed: boolean;
    readonly confidence: number;
    readonly threshold: number;
    readonly tier: 'high' | 'medium' | 'low';
}
