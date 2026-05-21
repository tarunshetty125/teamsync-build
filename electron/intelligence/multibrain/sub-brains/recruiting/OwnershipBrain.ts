// electron/intelligence/multibrain/sub-brains/recruiting/OwnershipBrain.ts
// Detects ownership language vs. deflection in candidate responses.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

const STRONG_OWNERSHIP: readonly RegExp[] = [
    /\bi built\b/gi,
    /\bi led\b/gi,
    /\bi owned\b/gi,
    /\bi designed\b/gi,
    /\bi architected\b/gi,
    /\bi decided\b/gi,
    /\bi drove\b/gi,
    /\bi was responsible\b/gi,
    /\bi took initiative\b/gi,
    /\bi started\b/gi,
    /\bi shipped\b/gi,
    /\bi delivered\b/gi,
    /\bmy decision\b/gi,
    /\bi proposed\b/gi,
    /\bi championed\b/gi,
];

const WEAK_OWNERSHIP: readonly RegExp[] = [
    /\bwe did\b/gi,
    /\bthe team handled\b/gi,
    /\bwe all\b/gi,
    /\beveryone worked\b/gi,
    /\bit was a team\b/gi,
    /\bhelped with\b/gi,
    /\bworked on\b/gi,
    /\bwas involved\b/gi,
    /\bcontributed to\b/gi,
];

export class OwnershipBrain implements SubBrain {
    readonly id = 'recruiting_ownership';
    readonly name = 'Ownership Brain';
    readonly weight = 0.8;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;

        const strongMatches = findPatternMatches(text, STRONG_OWNERSHIP);
        const weakMatches = findPatternMatches(text, WEAK_OWNERSHIP);

        const strongCount = strongMatches.length;
        const weakCount = weakMatches.length;

        const insights = [];

        if (strongCount > 0) {
            insights.push({
                label: 'Strong ownership language',
                confidence: matchCountToConfidence(strongCount),
                evidence: matchesToEvidence(strongMatches),
                reasoning: [
                    `Detected ${strongCount} first-person ownership signal(s)`,
                    strongMatches.slice(0, 3).map(m => `"${m.label}"`).join(', '),
                ],
                weight: 0.8,
            });
        }

        if (weakCount > 0) {
            insights.push({
                label: 'Weak ownership — deflection to team',
                confidence: matchCountToConfidence(weakCount) * 0.7,
                evidence: matchesToEvidence(weakMatches),
                reasoning: [
                    `Detected ${weakCount} deflection pattern(s)`,
                    'Candidate uses collective language instead of first-person accountability',
                ],
                weight: 0.6,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
