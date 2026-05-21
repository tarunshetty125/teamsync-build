// electron/intelligence/multibrain/sub-brains/team-meeting/DeadlineBrain.ts
// Detects dates, deadlines, and urgency in team meetings.
//
// IMPORTANT: Only detects EXPLICIT date/time mentions.
// No date hallucination — never infers dates not present in the text.
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// Deadline Patterns
// ---------------------------------------------------------------------------

const EXPLICIT_DATES: readonly RegExp[] = [
    /\bby\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\bby\s+(?:eod|eow|end\s+of\s+(?:day|week|month|quarter|year))\b/gi,
    /\btomorrow\b/gi,
    /\bnext\s+(?:week|monday|tuesday|wednesday|thursday|friday|sprint|month)\b/gi,
    /\bthis\s+(?:week|friday|sprint)\b/gi,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}\b/gi,
    /\b\d{1,2}\/\d{1,2}\b/gi,
    /\bq[1-4]\b/gi,
];

const DEADLINE_LANGUAGE: readonly RegExp[] = [
    /\bdeadline\b/gi,
    /\bdue\s+(?:date|by)\b/gi,
    /\bneed\s+(?:this|it|that)\s+by\b/gi,
    /\bmust\s+(?:be\s+)?(?:done|ready|finished|shipped|completed)\s+by\b/gi,
    /\btarget\s+date\b/gi,
    /\bship\s+(?:date|by)\b/gi,
    /\blaunch\s+(?:date|by|on)\b/gi,
];

const URGENCY_LANGUAGE: readonly RegExp[] = [
    /\basap\b/gi,
    /\burgent(?:ly)?\b/gi,
    /\bcritical\s+(?:path|deadline|timeline)\b/gi,
    /\btime[- ]sensitive\b/gi,
    /\bcan(?:'t|not)\s+wait\b/gi,
    /\bbefore\s+(?:launch|release|demo|review)\b/gi,
    /\bimmediately\b/gi,
    /\btight\s+(?:timeline|deadline|window)\b/gi,
];

// ---------------------------------------------------------------------------
// DeadlineBrain
// ---------------------------------------------------------------------------

export class DeadlineBrain implements SubBrain {
    readonly id = 'team_meeting_deadline';
    readonly name = 'Deadline Brain';
    readonly weight = 0.8;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const categories = [
            { label: 'Deadline mentioned', patterns: EXPLICIT_DATES, weight: 0.85 },
            { label: 'Deadline language detected', patterns: DEADLINE_LANGUAGE, weight: 0.8 },
            { label: 'Urgency detected', patterns: URGENCY_LANGUAGE, weight: 0.75 },
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
                        `Explicit mention: "${matches[0].label}"`,
                    ],
                    weight: category.weight,
                });
            }
        }

        return buildOutput(this.id, insights, startMs);
    }
}
