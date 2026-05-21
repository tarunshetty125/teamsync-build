// electron/intelligence/multibrain/sub-brains/team-meeting/OwnerBrain.ts
// Detects ownership and responsibility assignments in team meetings.
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// Owner Patterns
// ---------------------------------------------------------------------------

const SELF_OWNERSHIP: readonly RegExp[] = [
    /\bi(?:'ll| will)\s+(?:handle|take|own|do|manage|lead|cover)\b/gi,
    /\bi(?:'ll| will)\s+take\s+care\s+of\b/gi,
    /\bi(?:'m| am)\s+(?:on it|responsible|handling)\b/gi,
    /\bleave\s+(?:it|that)\s+(?:to|with)\s+me\b/gi,
    /\bi(?:'ve| have)\s+got\s+(?:it|this|that)\b/gi,
];

const ASSIGNED_OWNERSHIP: readonly RegExp[] = [
    /\b[A-Z][a-z]+\s+(?:will|can|should)\s+(?:handle|take|own|lead|manage|cover)\b/g,
    /\bassigned\s+to\b/gi,
    /\bcan\s+you\s+(?:own|handle|take|lead|manage)\b/gi,
    /\byou(?:'re| are)\s+(?:on|owning|handling|leading)\b/gi,
    /\b(?:that|this)\s+(?:is|goes)\s+to\b/gi,
];

const DELEGATION_LANGUAGE: readonly RegExp[] = [
    /\bplease\s+(?:take|handle|own|lead|manage)\b/gi,
    /\bwho(?:'s| is)\s+(?:taking|handling|owning)\b/gi,
    /\bwho\s+(?:owns?|handles?)\b/gi,
    /\bresponsib(?:le|ility)\b/gi,
    /\bpoint\s+person\b/gi,
    /\bdri\b/gi,
];

// ---------------------------------------------------------------------------
// OwnerBrain
// ---------------------------------------------------------------------------

export class OwnerBrain implements SubBrain {
    readonly id = 'team_meeting_owner';
    readonly name = 'Owner Brain';
    readonly weight = 0.85;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const insights = [];

        // Self-ownership uses normalized text
        const selfMatches = findPatternMatches(input.normalizedText, SELF_OWNERSHIP);
        if (selfMatches.length > 0) {
            insights.push({
                label: 'Owner Identified',
                confidence: matchCountToConfidence(selfMatches.length),
                evidence: matchesToEvidence(selfMatches),
                reasoning: [
                    `${selfMatches.length} self-ownership signal(s)`,
                    `Strongest: "${selfMatches[0].label}"`,
                ],
                weight: 0.85,
            });
        }

        // Assigned ownership uses raw text (needs capitalized names)
        const assignedMatches = findPatternMatches(input.rawText, ASSIGNED_OWNERSHIP);
        if (assignedMatches.length > 0) {
            insights.push({
                label: 'Owner Identified',
                confidence: matchCountToConfidence(assignedMatches.length),
                evidence: matchesToEvidence(assignedMatches),
                reasoning: [
                    `${assignedMatches.length} assigned-ownership signal(s)`,
                    `Strongest: "${assignedMatches[0].label}"`,
                ],
                weight: 0.85,
            });
        }

        // Delegation language uses normalized text
        const delegationMatches = findPatternMatches(input.normalizedText, DELEGATION_LANGUAGE);
        if (delegationMatches.length > 0) {
            insights.push({
                label: 'Ownership discussion',
                confidence: matchCountToConfidence(delegationMatches.length),
                evidence: matchesToEvidence(delegationMatches),
                reasoning: [
                    `${delegationMatches.length} delegation/ownership-question signal(s)`,
                ],
                weight: 0.7,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
