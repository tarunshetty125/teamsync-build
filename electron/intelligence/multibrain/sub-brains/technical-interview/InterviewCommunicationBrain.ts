// electron/intelligence/multibrain/sub-brains/technical-interview/InterviewCommunicationBrain.ts
// Detects explanation quality and communication patterns in technical interviews.
//
// Categories: poor | moderate | strong
// Conservative scoring — only flags poor communication with strong evidence.
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// Communication Signal Patterns
// ---------------------------------------------------------------------------

/** Positive — structured, clear communication */
const STRUCTURED_SIGNALS: readonly RegExp[] = [
    /\bstep\s+(?:\d|one|two|three)\b/gi,
    /\bfirst(?:ly)?\b.*\bthen\b/gi,
    /\blet\s+me\s+(?:walk|explain|break|go)\s+(?:through|down|over)\b/gi,
    /\bfor\s+example\b/gi,
    /\bto\s+(?:illustrate|clarify|elaborate)\b/gi,
    /\bin\s+other\s+words\b/gi,
    /\bthe\s+(?:key|main|important)\s+(?:point|thing|idea)\b/gi,
    /\bso\s+(?:essentially|basically|in\s+short)\b/gi,
];

const EXAMPLE_SIGNALS: readonly RegExp[] = [
    /\bfor\s+(?:instance|example)\b/gi,
    /\bsuch\s+as\b/gi,
    /\blike\s+(?:when|if|a)\b/gi,
    /\bconsider\s+(?:a|the|this)\b/gi,
    /\bimagine\b/gi,
    /\bsay\s+we\s+have\b/gi,
    /\blet(?:'s| us)\s+say\b/gi,
];

/** Negative — disorganized communication */
const RAMBLING_SIGNALS: readonly RegExp[] = [
    /\banyway(?:s)?\b/gi,
    /\bwhere\s+was\s+I\b/gi,
    /\bgoing\s+back\s+to\b/gi,
    /\bsorry\s*,?\s*(?:what|where|I)\b/gi,
    /\bI\s+(?:lost|forgot)\s+(?:my|the)\b/gi,
    /\bwait\s*,?\s*(?:what|no|actually)\b/gi,
];

const REPETITION_SIGNALS: readonly RegExp[] = [
    /\bas\s+I\s+(?:said|mentioned)\b/gi,
    /\blike\s+I\s+said\b/gi,
    /\bagain\b/gi,
    /\bto\s+repeat\b/gi,
];

const UNCLEAR_SIGNALS: readonly RegExp[] = [
    /\bit(?:'s| is)\s+(?:complicated|complex|hard\s+to\s+explain)\b/gi,
    /\bI\s+(?:can(?:'t|not)|don(?:'t|t))\s+(?:explain|describe|articulate)\b/gi,
    /\bI(?:'m| am)\s+not\s+(?:explaining|saying)\s+(?:this|it)\s+(?:well|right)\b/gi,
    /\bdoes\s+that\s+make\s+sense\b/gi,
];

// ---------------------------------------------------------------------------
// InterviewCommunicationBrain
// ---------------------------------------------------------------------------

export class InterviewCommunicationBrain implements SubBrain {
    readonly id = 'tech_interview_communication';
    readonly name = 'Interview Communication Brain';
    readonly weight = 0.6;  // Lower weight — communication != knowledge
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        // Positive signals
        const structuredMatches = findPatternMatches(text, STRUCTURED_SIGNALS);
        const exampleMatches = findPatternMatches(text, EXAMPLE_SIGNALS);
        const positiveCount = structuredMatches.length + exampleMatches.length;

        // Negative signals
        const ramblingMatches = findPatternMatches(text, RAMBLING_SIGNALS);
        const repetitionMatches = findPatternMatches(text, REPETITION_SIGNALS);
        const unclearMatches = findPatternMatches(text, UNCLEAR_SIGNALS);
        const negativeCount = ramblingMatches.length + repetitionMatches.length + unclearMatches.length;

        // Strong communication — clear, structured, uses examples
        if (positiveCount >= 3 && positiveCount > negativeCount * 2) {
            insights.push({
                label: 'Strong explanation quality',
                confidence: matchCountToConfidence(positiveCount),
                evidence: matchesToEvidence([...structuredMatches, ...exampleMatches]),
                reasoning: [
                    `communicationLevel: strong (${positiveCount} positive vs ${negativeCount} negative)`,
                    structuredMatches.length > 0 ? `Structured thinking: ${structuredMatches.length}` : '',
                    exampleMatches.length > 0 ? `Examples used: ${exampleMatches.length}` : '',
                ].filter(Boolean),
                weight: 0.65,
            });
        }

        // Poor communication — only flag with strong evidence
        if (negativeCount >= 3 && negativeCount > positiveCount) {
            insights.push({
                label: 'Communication clarity concern',
                confidence: matchCountToConfidence(negativeCount),
                evidence: matchesToEvidence([...ramblingMatches, ...repetitionMatches, ...unclearMatches]),
                reasoning: [
                    `communicationLevel: poor (${negativeCount} negative vs ${positiveCount} positive)`,
                    'Note: communication difficulty may be due to question complexity, not ability',
                ],
                weight: 0.5,
            });
        }

        // Moderate — mixed signals
        if (positiveCount >= 2 && negativeCount >= 1 && insights.length === 0) {
            insights.push({
                label: 'Moderate explanation quality',
                confidence: matchCountToConfidence(positiveCount + negativeCount),
                evidence: matchesToEvidence([...structuredMatches.slice(0, 1), ...ramblingMatches.slice(0, 1)]),
                reasoning: [
                    `communicationLevel: moderate (${positiveCount} positive, ${negativeCount} negative)`,
                ],
                weight: 0.5,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
