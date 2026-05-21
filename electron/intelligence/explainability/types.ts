// electron/intelligence/explainability/types.ts
// Types for the explainability engine.
//
// Every insight must be able to answer: "Why did this happen?"
// IMPORTANT: Zero runtime dependencies.

// ---------------------------------------------------------------------------
// Explanation Factor
// ---------------------------------------------------------------------------

/**
 * A single contributing factor to an explanation.
 */
export interface ExplanationFactor {
    /** Factor name (e.g., "ownership", "metric_count") */
    readonly name: string;
    /** Impact direction */
    readonly impact: 'positive' | 'negative' | 'neutral';
    /** Human-readable detail */
    readonly detail: string;
    /** Numeric contribution (signed float) */
    readonly contribution: number;
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

/**
 * Full explanation of why an insight was produced.
 */
export interface Explanation {
    /** Human-readable summary */
    readonly summary: string;
    /** Calibrated confidence score (0.0–1.0) */
    readonly score: number;
    /** Contributing factors */
    readonly factors: readonly ExplanationFactor[];
    /** Concerns or caveats */
    readonly concerns: readonly string[];
    /** Source sub-brain ID */
    readonly sourceBrain: string;
}
