// electron/intelligence/multibrain/sub-brains/technical-interview/TechnicalDepthBrain.ts
// Detects depth of technical understanding in interview answers.
//
// Categories: surface | moderate | deep
// Conservative — never over-credits buzzword usage as deep understanding.
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// Deep Understanding Signals
// ---------------------------------------------------------------------------

const TRADEOFF_SIGNALS: readonly RegExp[] = [
    /\btradeoff\b/gi,
    /\btrade[- ]off\b/gi,
    /\bpros?\s+(?:and|\/)\s+cons?\b/gi,
    /\bon\s+the\s+other\s+hand\b/gi,
    /\bthe\s+downside\b/gi,
    /\bat\s+the\s+cost\s+of\b/gi,
    /\bversus\b/gi,
    /\bcompared\s+to\b/gi,
];

const EDGE_CASE_SIGNALS: readonly RegExp[] = [
    /\bedge\s+case\b/gi,
    /\bcorner\s+case\b/gi,
    /\bboundary\b/gi,
    /\bwhat\s+if\b/gi,
    /\bwhat\s+happens\s+when\b/gi,
    /\bempty\s+(?:array|list|string|input|set)\b/gi,
    /\bnull\s+(?:check|case|input|pointer)\b/gi,
    /\boverflow\b/gi,
    /\bunderflow\b/gi,
];

const FAILURE_MODE_SIGNALS: readonly RegExp[] = [
    /\bfailure\s+mode\b/gi,
    /\bfail(?:s|ure)?\s+(?:when|if|for)\b/gi,
    /\bworst[- ]case\b/gi,
    /\bdegenerate\s+case\b/gi,
    /\bbreak(?:s|ing)?\s+(?:when|if|for)\b/gi,
    /\bperformance\s+degra/gi,
    /\btimeout\b/gi,
];

const OPTIMIZATION_SIGNALS: readonly RegExp[] = [
    /\boptimiz/gi,
    /\bcan\s+be\s+improved\b/gi,
    /\bbetter\s+approach\b/gi,
    /\bmore\s+efficient\b/gi,
    /\breduce\s+(?:time|space|complexity)\b/gi,
    /\balternative\s+(?:approach|solution|method)\b/gi,
    /\bbrute\s*force\b/gi,
];

// Weak / surface-level signals
const SURFACE_SIGNALS: readonly RegExp[] = [
    /\bbasically\s+it(?:'s| is)\s+(?:a|just)\b/gi,
    /\bit(?:'s| is)\s+(?:used|designed)\s+(?:for|to)\b/gi,
    /\bfrom\s+what\s+i\s+(?:remember|recall)\b/gi,
    /\bi(?:'ve| have)\s+(?:heard|seen|read)\s+that\b/gi,
    /\bi\s+learned\s+(?:in|from)\b/gi,
];

const BUZZWORD_SIGNALS: readonly RegExp[] = [
    /\bleverag/gi,
    /\butiliz/gi,
    /\bsynerg/gi,
    /\brobust\b/gi,
    /\bscalable\s+solution\b/gi,
    /\bbest\s+practice\b/gi,
    /\bindustry\s+standard\b/gi,
];

// ---------------------------------------------------------------------------
// TechnicalDepthBrain
// ---------------------------------------------------------------------------

export class TechnicalDepthBrain implements SubBrain {
    readonly id = 'tech_interview_depth';
    readonly name = 'Technical Depth Brain';
    readonly weight = 0.8;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        // Deep signals
        const tradeoffMatches = findPatternMatches(text, TRADEOFF_SIGNALS);
        const edgeCaseMatches = findPatternMatches(text, EDGE_CASE_SIGNALS);
        const failureMatches = findPatternMatches(text, FAILURE_MODE_SIGNALS);
        const optimizationMatches = findPatternMatches(text, OPTIMIZATION_SIGNALS);

        const deepCount = tradeoffMatches.length + edgeCaseMatches.length + failureMatches.length + optimizationMatches.length;

        if (deepCount >= 3) {
            insights.push({
                label: 'Deep technical understanding',
                confidence: matchCountToConfidence(deepCount),
                evidence: matchesToEvidence([...tradeoffMatches, ...edgeCaseMatches, ...failureMatches, ...optimizationMatches]),
                reasoning: [
                    `depthLevel: deep (${deepCount} depth signal(s))`,
                    tradeoffMatches.length > 0 ? `Tradeoff reasoning: ${tradeoffMatches.length}` : '',
                    edgeCaseMatches.length > 0 ? `Edge cases: ${edgeCaseMatches.length}` : '',
                    failureMatches.length > 0 ? `Failure modes: ${failureMatches.length}` : '',
                    optimizationMatches.length > 0 ? `Optimization: ${optimizationMatches.length}` : '',
                ].filter(Boolean),
                weight: 0.85,
            });
        } else if (deepCount >= 1) {
            insights.push({
                label: 'Moderate technical depth',
                confidence: matchCountToConfidence(deepCount),
                evidence: matchesToEvidence([...tradeoffMatches, ...edgeCaseMatches, ...failureMatches, ...optimizationMatches]),
                reasoning: [
                    `depthLevel: moderate (${deepCount} depth signal(s))`,
                ],
                weight: 0.7,
            });
        }

        // Surface-level / weak signals
        const surfaceMatches = findPatternMatches(text, SURFACE_SIGNALS);
        const buzzwordMatches = findPatternMatches(text, BUZZWORD_SIGNALS);
        const shallowCount = surfaceMatches.length + buzzwordMatches.length;

        // Only flag shallow if there are few deep signals
        if (shallowCount >= 2 && deepCount <= 1) {
            insights.push({
                label: 'Surface-level explanation',
                confidence: matchCountToConfidence(shallowCount),
                evidence: matchesToEvidence([...surfaceMatches, ...buzzwordMatches]),
                reasoning: [
                    `depthLevel: surface (${shallowCount} surface signal(s), ${deepCount} depth signal(s))`,
                    buzzwordMatches.length > 0 ? `Buzzword usage without depth: ${buzzwordMatches.length}` : '',
                ].filter(Boolean),
                weight: 0.6,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
