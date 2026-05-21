// electron/intelligence/multibrain/sub-brains/recruiting/CommunicationBrain.ts
// Detects communication quality: clarity, structure, conciseness, confidence.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { countPatterns, matchCountToConfidence, buildOutput } from '../helpers';

const STRUCTURE_PATTERNS: readonly RegExp[] = [
    /\bfirst\b/gi,
    /\bsecond\b/gi,
    /\bthird\b/gi,
    /\bfinally\b/gi,
    /\bin summary\b/gi,
    /\bto summarize\b/gi,
    /\bthe key\b/gi,
    /\bmy approach\b/gi,
    /\bstep \d+\b/gi,
];

const CONFIDENCE_PATTERNS: readonly RegExp[] = [
    /\bi believe\b/gi,
    /\bi'm confident\b/gi,
    /\bi know\b/gi,
    /\bin my experience\b/gi,
    /\bi've seen\b/gi,
    /\bi've found\b/gi,
];

const RAMBLING_INDICATORS: readonly RegExp[] = [
    /\banyway\b/gi,
    /\bso yeah\b/gi,
    /\blike i said\b/gi,
    /\bgoing back to\b/gi,
    /\bwhat was the question\b/gi,
    /\bi'm rambling\b/gi,
    /\blong story short\b/gi,
    /\bsorry.+tangent\b/gi,
];

const FILLER_PATTERNS: readonly RegExp[] = [
    /\bum+\b/gi,
    /\buh+\b/gi,
    /\byou know\b/gi,
    /\blike,?\s/gi,
    /\bbasically\b/gi,
];

export class CommunicationBrain implements SubBrain {
    readonly id = 'recruiting_communication';
    readonly name = 'Communication Brain';
    readonly weight = 0.5;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;

        const structureCount = countPatterns(text, STRUCTURE_PATTERNS);
        const confidenceCount = countPatterns(text, CONFIDENCE_PATTERNS);
        const ramblingCount = countPatterns(text, RAMBLING_INDICATORS);
        const fillerCount = countPatterns(text, FILLER_PATTERNS);

        // Approximate sentence count for density analysis
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
        const avgSentenceLength = sentences.length > 0
            ? text.length / sentences.length
            : text.length;
        const isConcise = avgSentenceLength < 150;

        const insights = [];

        if (structureCount >= 2) {
            insights.push({
                label: 'Structured communication',
                confidence: matchCountToConfidence(structureCount) * 0.8,
                evidence: [],
                reasoning: [
                    `${structureCount} structural marker(s) detected`,
                    'Candidate organizes thoughts clearly',
                ],
                weight: 0.5,
            });
        }

        if (confidenceCount >= 1) {
            insights.push({
                label: 'Confident language',
                confidence: matchCountToConfidence(confidenceCount) * 0.7,
                evidence: [],
                reasoning: [
                    `${confidenceCount} confidence signal(s)`,
                ],
                weight: 0.4,
            });
        }

        if (ramblingCount >= 2) {
            insights.push({
                label: 'Rambling or unfocused response',
                confidence: Math.min(0.5, matchCountToConfidence(ramblingCount) * 0.5),
                evidence: [],
                reasoning: [
                    `${ramblingCount} rambling indicator(s)`,
                    'Candidate may struggle with concise communication',
                ],
                weight: 0.4,
            });
        }

        if (fillerCount >= 4) {
            // Only flag excessive filler — some is normal
            insights.push({
                label: 'Excessive filler language',
                confidence: Math.min(0.4, matchCountToConfidence(fillerCount) * 0.3),
                evidence: [],
                reasoning: [
                    `${fillerCount} filler word(s) detected`,
                    'May indicate nervousness or lack of preparation',
                ],
                weight: 0.3,
            });
        }

        if (isConcise && sentences.length >= 3 && structureCount >= 1) {
            insights.push({
                label: 'Clear and concise communication',
                confidence: 0.6,
                evidence: [],
                reasoning: [
                    `${sentences.length} sentences, avg length ${Math.round(avgSentenceLength)} chars`,
                    'Good information density without rambling',
                ],
                weight: 0.5,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
