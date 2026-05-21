// electron/intelligence/multibrain/sub-brains/sales/CompetitorBrain.ts
// Detects named competitors, comparisons, and migration concerns.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

const COMPETITOR_NAMES: readonly RegExp[] = [
    /\bsalesforce\b/gi,
    /\bhubspot\b/gi,
    /\bzendesk\b/gi,
    /\bslack\b/gi,
    /\bzoom\b/gi,
    /\bmicrosoft\b/gi,
    /\bgoogle\b/gi,
    /\bamazon\b/gi,
    /\baws\b/gi,
    /\bazure\b/gi,
    /\bnotion\b/gi,
    /\basana\b/gi,
    /\bjira\b/gi,
    /\bconfluence\b/gi,
    /\bintercom\b/gi,
    /\bdrift\b/gi,
    /\bgong\b/gi,
    /\bclari\b/gi,
    /\boutreach\b/gi,
    /\bsalesloft\b/gi,
];

const COMPARISON_PATTERNS: readonly RegExp[] = [
    /\bhow.+(?:compare|differ|vs|versus)\b/gi,
    /\bbetter than\b/gi,
    /\bworse than\b/gi,
    /\badvantage over\b/gi,
    /\bwhy.+(?:not|instead)\b/gi,
    /\bwhat makes.+different\b/gi,
    /\bunique\b/gi,
];

const MIGRATION_PATTERNS: readonly RegExp[] = [
    /\bmigrat/gi,
    /\bswitch(?:ing)?\b/gi,
    /\btransition\b/gi,
    /\breplace\b/gi,
    /\bdata.+(?:export|import|transfer)\b/gi,
    /\bintegration.+existing\b/gi,
    /\block.?in\b/gi,
];

export class CompetitorBrain implements SubBrain {
    readonly id = 'sales_competitor';
    readonly name = 'Competitor Brain';
    readonly weight = 0.7;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const nameMatches = findPatternMatches(text, COMPETITOR_NAMES);
        const comparisonMatches = findPatternMatches(text, COMPARISON_PATTERNS);
        const migrationMatches = findPatternMatches(text, MIGRATION_PATTERNS);

        if (nameMatches.length > 0) {
            // Deduplicate competitor names
            const uniqueNames = [...new Set(nameMatches.map(m => m.label.toLowerCase()))];

            insights.push({
                label: `Competitor mentioned: ${uniqueNames.slice(0, 3).join(', ')}`,
                confidence: matchCountToConfidence(nameMatches.length),
                evidence: matchesToEvidence(nameMatches),
                reasoning: [
                    `${uniqueNames.length} unique competitor(s) referenced`,
                    'Prospect is evaluating alternatives',
                ],
                weight: 0.7,
            });
        }

        if (comparisonMatches.length > 0) {
            insights.push({
                label: 'Competitive comparison requested',
                confidence: matchCountToConfidence(comparisonMatches.length),
                evidence: matchesToEvidence(comparisonMatches),
                reasoning: [
                    `${comparisonMatches.length} comparison signal(s)`,
                    'Prospect wants to understand differentiation',
                ],
                weight: 0.7,
            });
        }

        if (migrationMatches.length > 0) {
            insights.push({
                label: 'Migration concern',
                confidence: matchCountToConfidence(migrationMatches.length) * 0.8,
                evidence: matchesToEvidence(migrationMatches),
                reasoning: [
                    `${migrationMatches.length} migration/switching signal(s)`,
                    'Prospect is evaluating effort to switch',
                ],
                weight: 0.6,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
