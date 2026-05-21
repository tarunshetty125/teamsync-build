// electron/intelligence/multibrain/sub-brains/sales/UrgencyBrain.ts
// Detects deadlines, timing sensitivity, and purchase urgency.

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

const DEADLINE_PATTERNS: readonly RegExp[] = [
    /\bby (?:end of |eod|eow|eom)/gi,
    /\bby (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\bby (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi,
    /\bdeadline\b/gi,
    /\bdue date\b/gi,
    /\bbefore.+launch\b/gi,
    /\bbefore.+go.?live\b/gi,
];

const TIMING_PATTERNS: readonly RegExp[] = [
    /\bthis quarter\b/gi,
    /\bthis month\b/gi,
    /\bthis week\b/gi,
    /\bnext quarter\b/gi,
    /\bq[1-4]\b/gi,
    /\bfiscal year\b/gi,
    /\bbudget cycle\b/gi,
    /\brenewal\b/gi,
];

const URGENCY_LANGUAGE: readonly RegExp[] = [
    /\burgent\b/gi,
    /\basap\b/gi,
    /\bimmediately\b/gi,
    /\bcan'?t wait\b/gi,
    /\btime.?sensitive\b/gi,
    /\bblocking\b/gi,
    /\bcritical path\b/gi,
    /\brunning out of time\b/gi,
];

export class UrgencyBrain implements SubBrain {
    readonly id = 'sales_urgency';
    readonly name = 'Urgency Brain';
    readonly weight = 0.7;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const deadlineMatches = findPatternMatches(text, DEADLINE_PATTERNS);
        const timingMatches = findPatternMatches(text, TIMING_PATTERNS);
        const urgencyMatches = findPatternMatches(text, URGENCY_LANGUAGE);

        const totalSignals = deadlineMatches.length + timingMatches.length + urgencyMatches.length;

        if (urgencyMatches.length > 0) {
            insights.push({
                label: 'High urgency language',
                confidence: matchCountToConfidence(urgencyMatches.length),
                evidence: matchesToEvidence(urgencyMatches),
                reasoning: [
                    `${urgencyMatches.length} urgency signal(s)`,
                    'Prospect has strong time pressure',
                ],
                weight: 0.8,
            });
        }

        if (deadlineMatches.length > 0) {
            insights.push({
                label: 'Specific deadline mentioned',
                confidence: matchCountToConfidence(deadlineMatches.length),
                evidence: matchesToEvidence(deadlineMatches),
                reasoning: [
                    `${deadlineMatches.length} deadline reference(s)`,
                ],
                weight: 0.7,
            });
        }

        if (timingMatches.length > 0 && urgencyMatches.length === 0) {
            insights.push({
                label: 'Timeline awareness',
                confidence: matchCountToConfidence(timingMatches.length) * 0.6,
                evidence: matchesToEvidence(timingMatches),
                reasoning: [
                    `${timingMatches.length} timing reference(s)`,
                    'Prospect is thinking about timing but no strong urgency',
                ],
                weight: 0.5,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
