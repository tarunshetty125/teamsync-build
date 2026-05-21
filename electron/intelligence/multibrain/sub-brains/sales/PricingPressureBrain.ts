// electron/intelligence/multibrain/sub-brains/sales/PricingPressureBrain.ts
// Detects discount requests, pricing pressure, and negotiation language.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

const DISCOUNT_PATTERNS: readonly RegExp[] = [
    /\bdiscount\b/gi,
    /\blower.+price\b/gi,
    /\bbetter.+deal\b/gi,
    /\breduc.+cost\b/gi,
    /\bflex.+pric/gi,
    /\bwilling to negotiate\b/gi,
    /\bbest price\b/gi,
    /\bbudget.+tight\b/gi,
];

const NEGOTIATION_PATTERNS: readonly RegExp[] = [
    /\bwhat if we\b/gi,
    /\bcan you do\b/gi,
    /\bany room\b/gi,
    /\bflexib/gi,
    /\bconcession\b/gi,
    /\bcounteroff/gi,
    /\bmeet.+halfway\b/gi,
    /\bmatch.+price\b/gi,
];

const COMPARISON_PRICING: readonly RegExp[] = [
    /\bcheaper\b/gi,
    /\bless expensive\b/gi,
    /\bmore affordable\b/gi,
    /\b(?:competitor|other).+(?:price|cost)\b/gi,
    /\bfree tier\b/gi,
    /\bopen source\b/gi,
];

export class PricingPressureBrain implements SubBrain {
    readonly id = 'sales_pricing_pressure';
    readonly name = 'Pricing Pressure Brain';
    readonly weight = 0.7;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const discountMatches = findPatternMatches(text, DISCOUNT_PATTERNS);
        const negotiationMatches = findPatternMatches(text, NEGOTIATION_PATTERNS);
        const comparisonMatches = findPatternMatches(text, COMPARISON_PRICING);

        if (discountMatches.length > 0) {
            insights.push({
                label: 'Discount request detected',
                confidence: matchCountToConfidence(discountMatches.length),
                evidence: matchesToEvidence(discountMatches),
                reasoning: [
                    `${discountMatches.length} discount signal(s)`,
                    'Prospect is actively seeking price reduction',
                ],
                weight: 0.8,
            });
        }

        if (negotiationMatches.length > 0) {
            insights.push({
                label: 'Negotiation language',
                confidence: matchCountToConfidence(negotiationMatches.length) * 0.8,
                evidence: matchesToEvidence(negotiationMatches),
                reasoning: [
                    `${negotiationMatches.length} negotiation indicator(s)`,
                    'Prospect is in deal-making mode',
                ],
                weight: 0.7,
            });
        }

        if (comparisonMatches.length > 0) {
            insights.push({
                label: 'Competitive pricing comparison',
                confidence: matchCountToConfidence(comparisonMatches.length) * 0.7,
                evidence: matchesToEvidence(comparisonMatches),
                reasoning: [
                    `${comparisonMatches.length} competitive pricing reference(s)`,
                ],
                weight: 0.6,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
