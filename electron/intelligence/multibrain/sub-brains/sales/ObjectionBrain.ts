// electron/intelligence/multibrain/sub-brains/sales/ObjectionBrain.ts
// Detects customer objections: budget, timing, competitor, approval blockers.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

const BUDGET_OBJECTIONS: readonly RegExp[] = [
    /\btoo expensive\b/gi,
    /\bover budget\b/gi,
    /\bno budget\b/gi,
    /\bcan'?t afford\b/gi,
    /\bcost.?prohibitive\b/gi,
    /\bbudget freeze\b/gi,
    /\bnot in the budget\b/gi,
];

const TIMING_OBJECTIONS: readonly RegExp[] = [
    /\bnot now\b/gi,
    /\bmaybe later\b/gi,
    /\bnext quarter\b/gi,
    /\bnext year\b/gi,
    /\bnot a priority\b/gi,
    /\bnot the right time\b/gi,
    /\bcome back\b/gi,
    /\bhold off\b/gi,
    /\btoo early\b/gi,
];

const COMPETITOR_OBJECTIONS: readonly RegExp[] = [
    /\balready using\b/gi,
    /\bcurrent solution\b/gi,
    /\bswitching cost\b/gi,
    /\bmigration\b/gi,
    /\bwhy switch\b/gi,
    /\bhappy with\b/gi,
    /\block.?in\b/gi,
];

const APPROVAL_OBJECTIONS: readonly RegExp[] = [
    /\bneed approval\b/gi,
    /\bcheck with\b/gi,
    /\brun it by\b/gi,
    /\bmy boss\b/gi,
    /\bdecision maker\b/gi,
    /\bcommittee\b/gi,
    /\bprocurement\b/gi,
    /\blegal\b/gi,
    /\bcompliance\b/gi,
];

export class ObjectionBrain implements SubBrain {
    readonly id = 'sales_objection';
    readonly name = 'Objection Brain';
    readonly weight = 0.8;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const categories = [
            { label: 'Budget objection', patterns: BUDGET_OBJECTIONS, weight: 0.8 },
            { label: 'Timing objection', patterns: TIMING_OBJECTIONS, weight: 0.7 },
            { label: 'Competitor objection', patterns: COMPETITOR_OBJECTIONS, weight: 0.7 },
            { label: 'Approval blocker', patterns: APPROVAL_OBJECTIONS, weight: 0.6 },
        ] as const;

        for (const category of categories) {
            const matches = findPatternMatches(text, category.patterns);
            if (matches.length > 0) {
                insights.push({
                    label: category.label,
                    confidence: matchCountToConfidence(matches.length),
                    evidence: matchesToEvidence(matches),
                    reasoning: [
                        `${matches.length} signal(s) for ${category.label.toLowerCase()}`,
                        matches.slice(0, 2).map(m => `"${m.label}"`).join(', '),
                    ],
                    weight: category.weight,
                });
            }
        }

        return buildOutput(this.id, insights, startMs);
    }
}
