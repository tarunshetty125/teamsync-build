// electron/intelligence/multibrain/sub-brains/technical-interview/CorrectnessBrain.ts
// Detects answer correctness signals in technical interviews.
//
// SAFETY: This brain is CONSERVATIVE by design.
//   - Never claims "incorrect" unless confidence >= 0.85
//   - Prefers "partially_correct" or "uncertain" over wrong accusation
//   - False negatives are acceptable; false positives are dangerous
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// Correctness Signal Patterns
// ---------------------------------------------------------------------------

/** Strong positive correctness signals — technical rigor */
const STRONG_POSITIVE: readonly RegExp[] = [
    /\bbig[- ]?o\s*\(\s*[nlogkm\d\s*^]+\s*\)/gi,
    /\btime\s+complexity\b/gi,
    /\bspace\s+complexity\b/gi,
    /\btradeoff\b/gi,
    /\btrade[- ]off\b/gi,
    /\bedge\s+case\b/gi,
    /\bboundary\s+condition\b/gi,
    /\bbase\s+case\b/gi,
    /\brecurrence\s+relation\b/gi,
    /\bamortized\b/gi,
    /\binvariant\b/gi,
];

/** Accurate algorithm/DS terminology */
const CORRECT_TERMINOLOGY: readonly RegExp[] = [
    /\bbinary\s+search\b/gi,
    /\bdynamic\s+programming\b/gi,
    /\bbfs\b/gi,
    /\bdfs\b/gi,
    /\bhash\s*(?:map|table|set)\b/gi,
    /\bheap\b/gi,
    /\btrie\b/gi,
    /\bgraph\b/gi,
    /\blinked\s+list\b/gi,
    /\bstack\b/gi,
    /\bqueue\b/gi,
    /\bsliding\s+window\b/gi,
    /\btwo\s+pointer\b/gi,
    /\bgreedy\b/gi,
    /\bdivide\s+and\s+conquer\b/gi,
    /\bbacktracking\b/gi,
    /\bmemoization\b/gi,
    /\btopological\s+sort\b/gi,
];

/** Negative signals — potential incorrectness indicators */
const CONTRADICTION_SIGNALS: readonly RegExp[] = [
    /\bwait\s*,?\s*(?:no|actually|never\s*mind)\b/gi,
    /\bthat(?:'s| is)\s+(?:wrong|incorrect|not right)\b/gi,
    /\bi\s+(?:meant|mean)\b/gi,
    /\bsorry\s*,?\s*(?:let me|I meant)\b/gi,
    /\bactually\s*,?\s*(?:no|the opposite|it(?:'s| is))\b/gi,
];

/** Incorrect terminology or impossible claims */
const INCORRECT_SIGNALS: readonly RegExp[] = [
    /\bo\(1\)\s+(?:for|to)\s+sort/gi,
    /\bsort\s+in\s+o\(1\)/gi,
    /\blinear\s+time\s+sort\s+(?:for|of)\s+(?:any|all|general)/gi,
    /\bO\(n\)\s+(?:for|comparison)\s+sort/gi,
];

/** Uncertainty indicators */
const UNCERTAINTY_SIGNALS: readonly RegExp[] = [
    /\bi\s+think\b/gi,
    /\bmaybe\b/gi,
    /\bprobably\b/gi,
    /\bnot\s+sure\b/gi,
    /\bi\s+guess\b/gi,
    /\bI\s+believe\b/gi,
    /\bif\s+i(?:'m| am)\s+not\s+(?:wrong|mistaken)\b/gi,
    /\bcould\s+be\b/gi,
];

// ---------------------------------------------------------------------------
// CorrectnessBrain
// ---------------------------------------------------------------------------

export class CorrectnessBrain implements SubBrain {
    readonly id = 'tech_interview_correctness';
    readonly name = 'Correctness Brain';
    readonly weight = 0.9;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        // Strong positive correctness signals
        const positiveMatches = findPatternMatches(text, STRONG_POSITIVE);
        const terminologyMatches = findPatternMatches(text, CORRECT_TERMINOLOGY);
        const totalPositive = positiveMatches.length + terminologyMatches.length;

        if (totalPositive > 0) {
            const confidence = matchCountToConfidence(totalPositive);
            insights.push({
                label: 'Correct technical reasoning',
                confidence,
                evidence: matchesToEvidence([...positiveMatches, ...terminologyMatches]),
                reasoning: [
                    `${positiveMatches.length} rigor signal(s), ${terminologyMatches.length} terminology signal(s)`,
                    totalPositive >= 3 ? 'correctnessLevel: correct' : 'correctnessLevel: partially_correct',
                ],
                weight: 0.85,
            });
        }

        // Contradiction signals
        const contradictionMatches = findPatternMatches(text, CONTRADICTION_SIGNALS);
        if (contradictionMatches.length > 0) {
            insights.push({
                label: 'Self-correction detected',
                confidence: matchCountToConfidence(contradictionMatches.length),
                evidence: matchesToEvidence(contradictionMatches),
                reasoning: [
                    `${contradictionMatches.length} self-correction signal(s)`,
                    'correctnessLevel: partially_correct',
                    'Note: self-correction may indicate awareness, not necessarily error',
                ],
                weight: 0.6,
            });
        }

        // Incorrect signals — ONLY flag with high confidence
        const incorrectMatches = findPatternMatches(text, INCORRECT_SIGNALS);
        if (incorrectMatches.length > 0) {
            const confidence = matchCountToConfidence(incorrectMatches.length);
            // SAFETY: Only label as incorrect when confidence is very high
            const level = confidence >= 0.85 ? 'incorrect' : 'possible concern';
            insights.push({
                label: confidence >= 0.85 ? 'Likely incorrect claim' : 'Possible correctness concern',
                confidence,
                evidence: matchesToEvidence(incorrectMatches),
                reasoning: [
                    `${incorrectMatches.length} potential incorrectness signal(s)`,
                    `correctnessLevel: ${level}`,
                ],
                weight: 0.9,
            });
        }

        // Uncertainty signals
        const uncertaintyMatches = findPatternMatches(text, UNCERTAINTY_SIGNALS);
        if (uncertaintyMatches.length >= 2) {
            insights.push({
                label: 'Uncertain reasoning',
                confidence: matchCountToConfidence(uncertaintyMatches.length),
                evidence: matchesToEvidence(uncertaintyMatches),
                reasoning: [
                    `${uncertaintyMatches.length} uncertainty signal(s)`,
                    'correctnessLevel: uncertain',
                ],
                weight: 0.5,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
