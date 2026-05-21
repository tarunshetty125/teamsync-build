// electron/intelligence/multibrain/sub-brains/technical-interview/InterviewConfidenceBrain.ts
// Detects communication confidence in technical interview answers.
//
// IMPORTANT: Confidence ≠ correctness.
// A hesitant candidate may be correct. A confident candidate may be wrong.
// This brain ONLY measures communication confidence, not answer quality.
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// Confidence Signal Patterns
// ---------------------------------------------------------------------------

/** Hesitation signals — lower communication confidence */
const HESITATION_SIGNALS: readonly RegExp[] = [
    /\bum+\b/gi,
    /\buh+\b/gi,
    /\bmaybe\b/gi,
    /\bi\s+think\b/gi,
    /\bsort\s+of\b/gi,
    /\bkind\s+of\b/gi,
    /\bnot\s+sure\b/gi,
    /\bi\s+guess\b/gi,
    /\bpossibly\b/gi,
    /\bprobably\b/gi,
    /\bi\s+don(?:'t|t)\s+(?:know|remember)\b/gi,
    /\blet\s+me\s+think\b/gi,
    /\bhmm+\b/gi,
];

/** Strong conviction signals — higher communication confidence */
const CONVICTION_SIGNALS: readonly RegExp[] = [
    /\bdefinitely\b/gi,
    /\bcertainly\b/gi,
    /\bthe\s+reason\s+is\b/gi,
    /\bbecause\b/gi,
    /\bspecifically\b/gi,
    /\bthe\s+key\s+(?:point|thing|insight)\b/gi,
    /\bI(?:'m| am)\s+confident\b/gi,
    /\bwithout\s+a\s+doubt\b/gi,
    /\bclearly\b/gi,
    /\bthe\s+answer\s+is\b/gi,
    /\bthis\s+works?\s+because\b/gi,
    /\bthis\s+ensures?\b/gi,
];

/** Structured thinking signals — organized communication */
const STRUCTURED_THINKING: readonly RegExp[] = [
    /\bfirst\b/gi,
    /\bsecond\b/gi,
    /\bthird\b/gi,
    /\bthen\b/gi,
    /\bnext\b/gi,
    /\bfinally\b/gi,
    /\bstep\s+\d\b/gi,
    /\bto\s+summarize\b/gi,
    /\bso\s+overall\b/gi,
    /\bin\s+summary\b/gi,
];

// ---------------------------------------------------------------------------
// InterviewConfidenceBrain
// ---------------------------------------------------------------------------

export class InterviewConfidenceBrain implements SubBrain {
    readonly id = 'tech_interview_confidence';
    readonly name = 'Interview Confidence Brain';
    readonly weight = 0.6;  // Lower weight — confidence ≠ correctness
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const hesitationMatches = findPatternMatches(text, HESITATION_SIGNALS);
        const convictionMatches = findPatternMatches(text, CONVICTION_SIGNALS);
        const structuredMatches = findPatternMatches(text, STRUCTURED_THINKING);

        const hesitationCount = hesitationMatches.length;
        const convictionCount = convictionMatches.length + structuredMatches.length;

        // High hesitation, low conviction → flag
        if (hesitationCount >= 3 && hesitationCount > convictionCount) {
            insights.push({
                label: 'Low communication confidence',
                confidence: matchCountToConfidence(hesitationCount),
                evidence: matchesToEvidence(hesitationMatches),
                reasoning: [
                    `confidenceLevel: low (${hesitationCount} hesitation vs ${convictionCount} conviction)`,
                    'Note: low confidence does NOT mean incorrect answer',
                ],
                weight: 0.5,
            });
        }

        // High conviction, low hesitation → note
        if (convictionCount >= 3 && convictionCount > hesitationCount) {
            insights.push({
                label: 'Strong communication confidence',
                confidence: matchCountToConfidence(convictionCount),
                evidence: matchesToEvidence([...convictionMatches, ...structuredMatches]),
                reasoning: [
                    `confidenceLevel: strong (${convictionCount} conviction vs ${hesitationCount} hesitation)`,
                    'Note: high confidence does NOT mean correct answer',
                ],
                weight: 0.55,
            });
        }

        // Mixed signals — moderate
        if (hesitationCount >= 2 && convictionCount >= 2 && insights.length === 0) {
            insights.push({
                label: 'Mixed communication confidence',
                confidence: matchCountToConfidence(hesitationCount + convictionCount),
                evidence: matchesToEvidence([...hesitationMatches.slice(0, 2), ...convictionMatches.slice(0, 1)]),
                reasoning: [
                    `confidenceLevel: moderate (${hesitationCount} hesitation, ${convictionCount} conviction)`,
                ],
                weight: 0.45,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
