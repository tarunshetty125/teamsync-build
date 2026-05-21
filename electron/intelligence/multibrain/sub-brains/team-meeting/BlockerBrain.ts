// electron/intelligence/multibrain/sub-brains/team-meeting/BlockerBrain.ts
// Detects blockers, risks, dependencies, and waiting states in team meetings.
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// Blocker Patterns
// ---------------------------------------------------------------------------

const BLOCKED_LANGUAGE: readonly RegExp[] = [
    /\bblocked\s+(?:on|by)\b/gi,
    /\bblocking\b/gi,
    /\bcan(?:'t|not)\s+(?:proceed|continue|move|start)\b/gi,
    /\bstuck\s+(?:on|at|with)\b/gi,
    /\bimpasse\b/gi,
    /\bno\s+progress\b/gi,
];

const WAITING_LANGUAGE: readonly RegExp[] = [
    /\bwaiting\s+(?:on|for)\b/gi,
    /\bpending\b/gi,
    /\bhold(?:ing)?\s+(?:on|off|up)\b/gi,
    /\bneed(?:s|ing)?\s+(?:approval|sign[- ]?off|review|access|input)\b/gi,
    /\buntil\s+(?:we|they|it)\b/gi,
];

const DEPENDENCY_LANGUAGE: readonly RegExp[] = [
    /\bdepend(?:s|ency|encies|ent)\b/gi,
    /\bprerequisite\b/gi,
    /\bupstream\b/gi,
    /\bdownstream\b/gi,
    /\bneeds?\s+to\s+be\s+(?:done|finished|ready|completed)\s+(?:before|first)\b/gi,
];

const RISK_LANGUAGE: readonly RegExp[] = [
    /\brisk(?:s|y)?\b/gi,
    /\bconcern(?:s|ed)?\b/gi,
    /\bworri(?:ed|es|some)\b/gi,
    /\bmight\s+(?:slip|miss|fail|break)\b/gi,
    /\bscope\s+creep\b/gi,
    /\bunderestimate\b/gi,
    /\bfallback\b/gi,
];

// ---------------------------------------------------------------------------
// BlockerBrain
// ---------------------------------------------------------------------------

export class BlockerBrain implements SubBrain {
    readonly id = 'team_meeting_blocker';
    readonly name = 'Blocker Brain';
    readonly weight = 0.9;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const categories = [
            { label: 'Blocker Identified', patterns: BLOCKED_LANGUAGE, weight: 0.9, severity: 'critical' },
            { label: 'Waiting state detected', patterns: WAITING_LANGUAGE, weight: 0.85, severity: 'warning' },
            { label: 'Dependency flagged', patterns: DEPENDENCY_LANGUAGE, weight: 0.8, severity: 'warning' },
            { label: 'Risk flagged', patterns: RISK_LANGUAGE, weight: 0.7, severity: 'info' },
        ] as const;

        for (const category of categories) {
            const matches = findPatternMatches(text, category.patterns);
            if (matches.length > 0) {
                insights.push({
                    label: category.label,
                    confidence: matchCountToConfidence(matches.length),
                    evidence: matchesToEvidence(matches),
                    reasoning: [
                        `${matches.length} ${category.label.toLowerCase()} signal(s)`,
                        `Severity: ${category.severity}`,
                    ],
                    weight: category.weight,
                });
            }
        }

        return buildOutput(this.id, insights, startMs);
    }
}
