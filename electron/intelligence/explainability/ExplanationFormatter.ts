// electron/intelligence/explainability/ExplanationFormatter.ts
// String formatting for explanations.
//
// Two modes:
//   compact  — single-line summary for logs and telemetry
//   expanded — multi-line detail for diagnostics
//
// No UI. No renderer. String output only.
// Pure functions, no state.

import type { Explanation } from './types';

// ---------------------------------------------------------------------------
// Compact Format
// ---------------------------------------------------------------------------

/**
 * Format an explanation as a compact single-line string.
 *
 * Example output:
 *   "Strong ownership signal [84%] — 2 factors, 0 concerns"
 */
export function formatCompact(explanation: Explanation): string {
    const pct = Math.round(explanation.score * 100);
    const factorCount = explanation.factors.length;
    const concernCount = explanation.concerns.length;

    return `${explanation.summary} [${pct}%] — ${factorCount} factor${factorCount !== 1 ? 's' : ''}, ${concernCount} concern${concernCount !== 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Expanded Format
// ---------------------------------------------------------------------------

/**
 * Format an explanation as a multi-line detailed string.
 *
 * Example output:
 *   Strong ownership signal [84%]
 *   Source: recruiting_ownership
 *   Factors:
 *     + confidence: High confidence signal based on strong pattern matches (+0.30)
 *     + evidence_depth: 2 supporting evidence quotes extracted (+0.20)
 *   Concerns:
 *     - Single reasoning factor — may benefit from corroboration
 */
export function formatExpanded(explanation: Explanation): string {
    const lines: string[] = [];
    const pct = Math.round(explanation.score * 100);

    lines.push(`${explanation.summary} [${pct}%]`);
    lines.push(`Source: ${explanation.sourceBrain}`);

    // Factors
    if (explanation.factors.length > 0) {
        lines.push('Factors:');
        for (const factor of explanation.factors) {
            const sign = factor.contribution >= 0 ? '+' : '';
            const icon = factor.impact === 'positive' ? '+' :
                         factor.impact === 'negative' ? '-' : '~';
            lines.push(`  ${icon} ${factor.name}: ${factor.detail} (${sign}${factor.contribution.toFixed(2)})`);
        }
    }

    // Concerns
    if (explanation.concerns.length > 0) {
        lines.push('Concerns:');
        for (const concern of explanation.concerns) {
            lines.push(`  - ${concern}`);
        }
    }

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Batch Formatting
// ---------------------------------------------------------------------------

/**
 * Format multiple explanations.
 *
 * @param mode - 'compact' or 'expanded'
 */
export function formatAll(
    explanations: readonly Explanation[],
    mode: 'compact' | 'expanded',
): string {
    const formatter = mode === 'compact' ? formatCompact : formatExpanded;
    const separator = mode === 'compact' ? '\n' : '\n\n';
    return explanations.map(formatter).join(separator);
}
