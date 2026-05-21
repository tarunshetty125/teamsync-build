// electron/intelligence/multibrain/sub-brains/sales/BuyingSignalBrain.ts
// Detects positive buying signals: urgency, implementation Qs, pricing interest.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

const URGENCY_SIGNALS: readonly RegExp[] = [
    /\bhow soon\b/gi,
    /\bwhen can we\b/gi,
    /\bneed this by\b/gi,
    /\bthis quarter\b/gi,
    /\bthis month\b/gi,
    /\basap\b/gi,
    /\bright away\b/gi,
];

const IMPLEMENTATION_SIGNALS: readonly RegExp[] = [
    /\bhow does it work\b/gi,
    /\bintegrat/gi,
    /\bonboarding\b/gi,
    /\bimplementation\b/gi,
    /\brollout\b/gi,
    /\bdeployment\b/gi,
    /\bhow long.+set up\b/gi,
    /\bapi\b/gi,
    /\bsso\b/gi,
];

const PRICING_INTEREST: readonly RegExp[] = [
    /\bhow much\b/gi,
    /\bpricing\b/gi,
    /\bpackag/gi,
    /\bper seat\b/gi,
    /\bper user\b/gi,
    /\bannual\b/gi,
    /\bmonthly\b/gi,
    /\binvoic/gi,
];

const STAKEHOLDER_SIGNALS: readonly RegExp[] = [
    /\bshow.+(?:team|boss|cto|vp|head)\b/gi,
    /\bbring in\b/gi,
    /\bloop in\b/gi,
    /\bget.+involved\b/gi,
    /\bintroduc/gi,
    /\bset up.+call\b/gi,
];

const COMMITMENT_SIGNALS: readonly RegExp[] = [
    /\bnext step\b/gi,
    /\bmove forward\b/gi,
    /\bproposal\b/gi,
    /\bpilot\b/gi,
    /\btrial\b/gi,
    /\bpoc\b/gi,
    /\bsend over\b/gi,
    /\bsign\b/gi,
    /\bcontract\b/gi,
];

export class BuyingSignalBrain implements SubBrain {
    readonly id = 'sales_buying_signal';
    readonly name = 'Buying Signal Brain';
    readonly weight = 0.9;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const categories = [
            { label: 'Urgency signal', patterns: URGENCY_SIGNALS, weight: 0.8 },
            { label: 'Implementation interest', patterns: IMPLEMENTATION_SIGNALS, weight: 0.7 },
            { label: 'Pricing interest', patterns: PRICING_INTEREST, weight: 0.7 },
            { label: 'Stakeholder expansion', patterns: STAKEHOLDER_SIGNALS, weight: 0.8 },
            { label: 'Commitment signal', patterns: COMMITMENT_SIGNALS, weight: 0.9 },
        ] as const;

        for (const category of categories) {
            const matches = findPatternMatches(text, category.patterns);
            if (matches.length > 0) {
                insights.push({
                    label: category.label,
                    confidence: matchCountToConfidence(matches.length),
                    evidence: matchesToEvidence(matches),
                    reasoning: [
                        `${matches.length} buying signal(s) for ${category.label.toLowerCase()}`,
                    ],
                    weight: category.weight,
                });
            }
        }

        return buildOutput(this.id, insights, startMs);
    }
}
