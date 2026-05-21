// electron/intelligence/multibrain/sub-brains/recruiting/STARBrain.ts
// Detects STAR (Situation, Task, Action, Result) structure completeness.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { countPatterns, matchCountToConfidence, buildOutput } from '../helpers';

const SITUATION_PATTERNS: readonly RegExp[] = [
    /\bsituation\b/gi,
    /\bcontext was\b/gi,
    /\bbackground\b/gi,
    /\bat the time\b/gi,
    /\bwhen i was\b/gi,
    /\bthe problem was\b/gi,
    /\bwe were facing\b/gi,
];

const TASK_PATTERNS: readonly RegExp[] = [
    /\bmy task\b/gi,
    /\bmy role was\b/gi,
    /\bi was asked to\b/gi,
    /\bresponsible for\b/gi,
    /\bgoal was\b/gi,
    /\bobjective\b/gi,
    /\bcharged with\b/gi,
];

const ACTION_PATTERNS: readonly RegExp[] = [
    /\bi did\b/gi,
    /\bi implemented\b/gi,
    /\bi created\b/gi,
    /\bi set up\b/gi,
    /\bfirst.+then\b/gi,
    /\bmy approach\b/gi,
    /\bsteps i took\b/gi,
    /\bi started by\b/gi,
];

const RESULT_PATTERNS: readonly RegExp[] = [
    /\bresult\b/gi,
    /\boutcome\b/gi,
    /\b\d+%/gi,
    /\bimproved\b/gi,
    /\breduced\b/gi,
    /\bincreased\b/gi,
    /\bsaved\b/gi,
    /\blaunched\b/gi,
    /\bshipped\b/gi,
    /\bdelivered\b/gi,
];

export class STARBrain implements SubBrain {
    readonly id = 'recruiting_star';
    readonly name = 'STAR Brain';
    readonly weight = 0.7;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;

        const situation = countPatterns(text, SITUATION_PATTERNS);
        const task = countPatterns(text, TASK_PATTERNS);
        const action = countPatterns(text, ACTION_PATTERNS);
        const result = countPatterns(text, RESULT_PATTERNS);

        const components = [
            { name: 'Situation', count: situation },
            { name: 'Task', count: task },
            { name: 'Action', count: action },
            { name: 'Result', count: result },
        ];

        const present = components.filter(c => c.count > 0);
        const missing = components.filter(c => c.count === 0);
        const completeness = present.length / 4;

        const insights = [];

        if (present.length > 0) {
            insights.push({
                label: `STAR structure: ${present.length}/4 components present`,
                confidence: matchCountToConfidence(present.length),
                evidence: [],
                reasoning: [
                    `Present: ${present.map(c => c.name).join(', ')}`,
                    ...(missing.length > 0 ? [`Missing: ${missing.map(c => c.name).join(', ')}`] : []),
                    `Completeness: ${Math.round(completeness * 100)}%`,
                ],
                weight: 0.7,
            });
        }

        if (missing.length > 0 && present.length > 0) {
            insights.push({
                label: `STAR gap: missing ${missing.map(c => c.name).join(', ')}`,
                confidence: 0.4,
                evidence: [],
                reasoning: [
                    `Candidate provided ${present.length} of 4 STAR components`,
                    `Follow up on: ${missing.map(c => c.name).join(', ')}`,
                ],
                weight: 0.5,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
