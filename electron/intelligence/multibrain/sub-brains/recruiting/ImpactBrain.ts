// electron/intelligence/multibrain/sub-brains/recruiting/ImpactBrain.ts
// Detects measurable outcomes, metrics, and business impact language.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

const METRIC_PATTERNS: readonly RegExp[] = [
    /\b\d+%/gi,
    /\b\d+x\b/gi,
    /\$\d+[kmb]?\b/gi,
    /\b\d+\s*(?:users|customers|requests|transactions)\b/gi,
    /\b\d+\s*(?:ms|seconds|minutes|hours)\b/gi,
];

const IMPACT_VERBS: readonly RegExp[] = [
    /\bimproved\b/gi,
    /\breduced\b/gi,
    /\bincreased\b/gi,
    /\bsaved\b/gi,
    /\boptimized\b/gi,
    /\baccelerated\b/gi,
    /\bscaled\b/gi,
    /\bautomated\b/gi,
    /\beliminated\b/gi,
    /\bstreamlined\b/gi,
];

const SCALE_INDICATORS: readonly RegExp[] = [
    /\bat scale\b/gi,
    /\bmillions?\b/gi,
    /\bthousands?\b/gi,
    /\bglobally\b/gi,
    /\bcompany.?wide\b/gi,
    /\borganization\b/gi,
    /\bproduction\b/gi,
    /\blatency\b/gi,
    /\bthroughput\b/gi,
    /\buptime\b/gi,
    /\brevenue\b/gi,
];

export class ImpactBrain implements SubBrain {
    readonly id = 'recruiting_impact';
    readonly name = 'Impact Brain';
    readonly weight = 0.8;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;

        const metricMatches = findPatternMatches(text, METRIC_PATTERNS);
        const verbMatches = findPatternMatches(text, IMPACT_VERBS);
        const scaleMatches = findPatternMatches(text, SCALE_INDICATORS);

        const hasMetrics = metricMatches.length > 0;
        const hasVerbs = verbMatches.length > 0;
        const hasScale = scaleMatches.length > 0;

        const insights = [];

        if (hasMetrics) {
            insights.push({
                label: 'Measurable outcomes cited',
                confidence: matchCountToConfidence(metricMatches.length),
                evidence: matchesToEvidence(metricMatches),
                reasoning: [
                    `${metricMatches.length} quantified metric(s) detected`,
                    metricMatches.slice(0, 3).map(m => `"${m.label}"`).join(', '),
                ],
                weight: 0.9,
            });
        }

        if (hasVerbs && !hasMetrics) {
            insights.push({
                label: 'Impact verbs without metrics',
                confidence: matchCountToConfidence(verbMatches.length) * 0.5,
                evidence: matchesToEvidence(verbMatches),
                reasoning: [
                    'Candidate uses impact language but lacks quantified evidence',
                    'Follow-up: ask for specific numbers or percentages',
                ],
                weight: 0.4,
            });
        }

        if (hasScale) {
            insights.push({
                label: 'Scale indicators present',
                confidence: matchCountToConfidence(scaleMatches.length) * 0.7,
                evidence: matchesToEvidence(scaleMatches),
                reasoning: [
                    `${scaleMatches.length} scale indicator(s): suggests work at significant scope`,
                ],
                weight: 0.6,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
