// electron/intelligence/multibrain/sub-brains/team-meeting/ActionItemBrain.ts
// Detects tasks, follow-ups, and next steps in team meetings.
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// Action Item Patterns
// ---------------------------------------------------------------------------

const EXPLICIT_ACTION_ITEMS: readonly RegExp[] = [
    /\baction\s+item\b/gi,
    /\btodo\b/gi,
    /\bto[- ]do\b/gi,
    /\btakeaway\b/gi,
    /\bnext\s+step(?:s)?\b/gi,
    /\baction\s+point\b/gi,
];

const FOLLOW_UP_LANGUAGE: readonly RegExp[] = [
    /\bfollow\s+up\b/gi,
    /\bfollow[- ]up\b/gi,
    /\bcircle\s+back\b/gi,
    /\brevisit\b/gi,
    /\breconnect\b/gi,
    /\btouch\s+base\b/gi,
    /\bcheck\s+(?:in|back)\b/gi,
];

const TASK_LANGUAGE: readonly RegExp[] = [
    /\bneed\s+to\b/gi,
    /\bshould\b/gi,
    /\bwill\s+send\b/gi,
    /\bwill\s+(?:create|write|draft|prepare|set\s+up|schedule|file|open|submit)\b/gi,
    /\bplease\s+(?:send|create|share|update|review|check|look\s+into)\b/gi,
    /\blet(?:'s| us)\s+(?:schedule|set\s+up|plan|draft|create)\b/gi,
    /\binvestigate\b/gi,
    /\blook\s+into\b/gi,
];

const COMMITMENT_TO_ACT: readonly RegExp[] = [
    /\bi(?:'ll| will)\s+(?:send|share|update|create|schedule|prepare|draft|write|file|open)\b/gi,
    /\bwe(?:'ll| will)\s+(?:send|share|update|create|schedule|prepare|draft|write)\b/gi,
    /\bgoing\s+to\s+(?:send|share|update|create|schedule|prepare|draft)\b/gi,
];

// ---------------------------------------------------------------------------
// ActionItemBrain
// ---------------------------------------------------------------------------

export class ActionItemBrain implements SubBrain {
    readonly id = 'team_meeting_action_item';
    readonly name = 'Action Item Brain';
    readonly weight = 0.85;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const categories = [
            { label: 'Action Item', patterns: EXPLICIT_ACTION_ITEMS, weight: 0.9 },
            { label: 'Follow-up needed', patterns: FOLLOW_UP_LANGUAGE, weight: 0.8 },
            { label: 'Task identified', patterns: TASK_LANGUAGE, weight: 0.75 },
            { label: 'Commitment to act', patterns: COMMITMENT_TO_ACT, weight: 0.85 },
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
                        `Strongest: "${matches[0].label}"`,
                    ],
                    weight: category.weight,
                });
            }
        }

        return buildOutput(this.id, insights, startMs);
    }
}
