// electron/intelligence/explainability/ExplainabilityEngine.ts
// Produces human-readable explanations for sub-brain insights.
//
// Every insight can answer: "Why did this happen?"
//
// Requirements:
//   - Deterministic
//   - Pure functions (no side effects, no state)
//   - No LLM calls — heuristic-based only
//   - Testable
//
// Gated by CapabilityRegistry('explainability').

import type { Explanation, ExplanationFactor } from './types';
import type { SubBrainInsight } from '../multibrain/types';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum confidence to produce an explanation (below this = not worth explaining) */
const MIN_EXPLAIN_CONFIDENCE = 0.2;

// ---------------------------------------------------------------------------
// Factor Derivation
// ---------------------------------------------------------------------------

/**
 * Derive explanation factors from an insight's evidence and reasoning.
 * Pure function — deterministic output for identical input.
 */
function deriveFactors(insight: SubBrainInsight): ExplanationFactor[] {
    const factors: ExplanationFactor[] = [];

    // Factor 1: Confidence level
    if (insight.confidence >= 0.8) {
        factors.push({
            name: 'confidence',
            impact: 'positive',
            detail: 'High confidence signal based on strong pattern matches',
            contribution: 0.3,
        });
    } else if (insight.confidence >= 0.5) {
        factors.push({
            name: 'confidence',
            impact: 'neutral',
            detail: 'Moderate confidence — some supporting patterns detected',
            contribution: 0.1,
        });
    } else {
        factors.push({
            name: 'confidence',
            impact: 'negative',
            detail: 'Low confidence — weak or ambiguous signals',
            contribution: -0.1,
        });
    }

    // Factor 2: Evidence depth
    if (insight.evidence && insight.evidence.length > 0) {
        const evidenceCount = insight.evidence.length;
        factors.push({
            name: 'evidence_depth',
            impact: evidenceCount >= 2 ? 'positive' : 'neutral',
            detail: `${evidenceCount} supporting evidence quote${evidenceCount > 1 ? 's' : ''} extracted`,
            contribution: Math.min(0.3, evidenceCount * 0.1),
        });
    }

    // Factor 3: Reasoning chain
    if (insight.reasoning && insight.reasoning.length > 0) {
        factors.push({
            name: 'reasoning',
            impact: 'positive',
            detail: insight.reasoning[0],
            contribution: 0.2,
        });

        // Additional reasoning steps add diminishing value
        if (insight.reasoning.length > 1) {
            factors.push({
                name: 'multi_factor',
                impact: 'positive',
                detail: `${insight.reasoning.length} independent reasoning chains converged`,
                contribution: 0.1,
            });
        }
    }

    return factors;
}

// ---------------------------------------------------------------------------
// Concern Detection
// ---------------------------------------------------------------------------

/**
 * Detect concerns or caveats about an insight.
 */
function detectConcerns(insight: SubBrainInsight): string[] {
    const concerns: string[] = [];

    // Low confidence
    if (insight.confidence < 0.4) {
        concerns.push('Low confidence — treat as tentative signal');
    }

    // No evidence
    if (!insight.evidence || insight.evidence.length === 0) {
        concerns.push('No direct transcript evidence — based on heuristic patterns only');
    }

    // Single reasoning chain
    if (!insight.reasoning || insight.reasoning.length <= 1) {
        concerns.push('Single reasoning factor — may benefit from corroboration');
    }

    return concerns;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an explanation for a single sub-brain insight.
 *
 * Returns null if:
 *   - Explainability capability is disabled
 *   - Insight confidence is below minimum threshold
 */
export function explain(
    insight: SubBrainInsight,
    sourceBrain: string,
): Explanation | null {
    if (!CapabilityRegistry.getInstance().isEnabled('explainability')) {
        return null;
    }

    if (insight.confidence < MIN_EXPLAIN_CONFIDENCE) {
        return null;
    }

    const factors = deriveFactors(insight);
    const concerns = detectConcerns(insight);

    return {
        summary: insight.label,
        score: insight.confidence,
        factors,
        concerns,
        sourceBrain,
    };
}

/**
 * Generate explanations for multiple insights.
 * Filters out nulls (below threshold or disabled).
 * Returns sorted by score descending.
 */
export function explainAll(
    insights: readonly SubBrainInsight[],
    sourceBrain: string,
): Explanation[] {
    return insights
        .map(insight => explain(insight, sourceBrain))
        .filter((e): e is Explanation => e !== null)
        .sort((a, b) => b.score - a.score);
}
