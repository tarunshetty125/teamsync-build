// electron/intelligence/multibrain/sub-brains/recruiting/RedFlagBrain.ts
// Detects soft red flags: blame-shifting, vague answers, contradictions.
// Low-confidence signals only — not over-aggressive.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

const BLAME_PATTERNS: readonly RegExp[] = [
    /\bnot my fault\b/gi,
    /\bthey didn'?t\b/gi,
    /\bmy manager\b/gi,
    /\bother team\b/gi,
    /\bwas blocked by them\b/gi,
    /\bthey should have\b/gi,
    /\bno one told me\b/gi,
    /\bi wasn'?t given\b/gi,
    /\black of support\b/gi,
];

const VAGUE_PATTERNS: readonly RegExp[] = [
    /\bkind of\b/gi,
    /\bsort of\b/gi,
    /\bstuff\b/gi,
    /\bthings\b/gi,
    /\bvarious\b/gi,
    /\bi guess\b/gi,
    /\bmaybe\b/gi,
    /\bi think so\b/gi,
    /\bnot really sure\b/gi,
    /\bi don'?t remember\b/gi,
];

const CONTRADICTION_PATTERNS: readonly RegExp[] = [
    /\bactually.+i mean\b/gi,
    /\bwell.+not exactly\b/gi,
    /\bi said.+but\b/gi,
    /\bthat'?s not what i meant\b/gi,
];

export class RedFlagBrain implements SubBrain {
    readonly id = 'recruiting_red_flag';
    readonly name = 'Red Flag Brain';
    readonly weight = 0.5; // Lower weight — soft signals
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;

        const blameMatches = findPatternMatches(text, BLAME_PATTERNS);
        const vagueMatches = findPatternMatches(text, VAGUE_PATTERNS);
        const contradictionMatches = findPatternMatches(text, CONTRADICTION_PATTERNS);

        const insights = [];

        if (blameMatches.length > 0) {
            insights.push({
                label: 'Blame-shifting language detected',
                // Deliberately conservative — cap at 0.6
                confidence: Math.min(0.6, matchCountToConfidence(blameMatches.length)),
                evidence: matchesToEvidence(blameMatches),
                reasoning: [
                    `${blameMatches.length} blame-shifting pattern(s) detected`,
                    'Candidate deflects responsibility to others',
                ],
                weight: 0.5,
            });
        }

        if (vagueMatches.length >= 2) {
            // Only flag if 2+ vague patterns — single "kind of" is normal speech
            insights.push({
                label: 'Vague or low-specificity language',
                confidence: Math.min(0.5, matchCountToConfidence(vagueMatches.length) * 0.6),
                evidence: matchesToEvidence(vagueMatches),
                reasoning: [
                    `${vagueMatches.length} vague language pattern(s)`,
                    'High vagueness may indicate lack of depth or rehearsed answers',
                ],
                weight: 0.4,
            });
        }

        if (contradictionMatches.length > 0) {
            insights.push({
                label: 'Possible self-contradiction',
                confidence: Math.min(0.4, matchCountToConfidence(contradictionMatches.length) * 0.5),
                evidence: matchesToEvidence(contradictionMatches),
                reasoning: [
                    `${contradictionMatches.length} contradiction indicator(s)`,
                    'May indicate uncertainty or inconsistent story',
                ],
                weight: 0.3,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
