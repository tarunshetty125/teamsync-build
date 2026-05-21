// electron/intelligence/multibrain/sub-brains/team-meeting/DecisionBrain.ts
// Detects decisions, agreements, approvals, and commitments in team meetings.
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// Decision Patterns
// ---------------------------------------------------------------------------

const DECISION_LANGUAGE: readonly RegExp[] = [
    /\bwe(?:'ll| will)\s+(?:go with|proceed|move forward|do)\b/gi,
    /\bdecided\s+(?:to|that|on)\b/gi,
    /\bgoing\s+with\b/gi,
    /\bplan\s+is\b/gi,
    /\blet(?:'s| us)\s+(?:do|go|proceed|move|ship|use)\b/gi,
    /\bagreed\s+(?:to|on|that)\b/gi,
    /\bwe(?:'re| are)\s+going\s+to\b/gi,
    /\bfinal\s+decision\b/gi,
];

const APPROVAL_LANGUAGE: readonly RegExp[] = [
    /\bapproved\b/gi,
    /\bsigned\s+off\b/gi,
    /\bgreen\s*light\b/gi,
    /\bgot\s+the\s+go[- ]ahead\b/gi,
    /\bthumb(?:s)?\s+up\b/gi,
    /\blooks?\s+good\b/gi,
    /\bno\s+objections?\b/gi,
];

const COMMITMENT_LANGUAGE: readonly RegExp[] = [
    /\bwe\s+commit\b/gi,
    /\bcommitting\s+to\b/gi,
    /\bwe(?:'re| are)\s+aligned\b/gi,
    /\beveryone\s+agrees?\b/gi,
    /\bconsensus\b/gi,
    /\bso\s+we(?:'re| are)\b/gi,
];

// ---------------------------------------------------------------------------
// DecisionBrain
// ---------------------------------------------------------------------------

export class DecisionBrain implements SubBrain {
    readonly id = 'team_meeting_decision';
    readonly name = 'Decision Brain';
    readonly weight = 0.9;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const categories = [
            { label: 'Decision Identified', patterns: DECISION_LANGUAGE, weight: 0.9 },
            { label: 'Approval detected', patterns: APPROVAL_LANGUAGE, weight: 0.8 },
            { label: 'Commitment detected', patterns: COMMITMENT_LANGUAGE, weight: 0.85 },
        ] as const;

        for (const category of categories) {
            const matches = findPatternMatches(text, category.patterns);
            if (matches.length > 0) {
                insights.push({
                    label: category.label,
                    confidence: matchCountToConfidence(matches.length),
                    evidence: matchesToEvidence(matches),
                    reasoning: [
                        `${matches.length} ${category.label.toLowerCase()} signal(s) found`,
                        `Strongest match: "${matches[0].label}"`,
                    ],
                    weight: category.weight,
                });
            }
        }

        return buildOutput(this.id, insights, startMs);
    }
}
