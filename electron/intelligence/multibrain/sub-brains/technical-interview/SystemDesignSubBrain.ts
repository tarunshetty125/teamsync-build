// electron/intelligence/multibrain/sub-brains/technical-interview/SystemDesignSubBrain.ts
// Detects system design reasoning quality in technical interviews.
//
// Categories: basic | moderate | strong
// Conservative — high confidence only. No hallucinated architecture skill.
//
// Contract:
//   ✅ Pure regex + heuristics only
//   ✅ Synchronous execution (<2ms target)
//   ✅ Returns SubBrainOutput with evidence
//   ❌ No LLM calls, no network, no async

import type { SubBrain, SubBrainInput, SubBrainOutput } from '../../types';
import { findPatternMatches, matchesToEvidence, matchCountToConfidence, buildOutput } from '../helpers';

// ---------------------------------------------------------------------------
// System Design Signal Patterns
// ---------------------------------------------------------------------------

/** Core system design concepts */
const SCALABILITY_SIGNALS: readonly RegExp[] = [
    /\bscalability\b/gi,
    /\bhorizontal\s+scal/gi,
    /\bvertical\s+scal/gi,
    /\bshard(?:ing|ed|s)?\b/gi,
    /\bpartition(?:ing|ed|s)?\b/gi,
    /\breplication\b/gi,
    /\bload\s+balanc/gi,
    /\bauto[- ]?scal/gi,
];

const DATA_LAYER_SIGNALS: readonly RegExp[] = [
    /\bdatabase\b/gi,
    /\bsql\b/gi,
    /\bnosql\b/gi,
    /\bcach(?:e|ing)\b/gi,
    /\bredis\b/gi,
    /\bmemcache\b/gi,
    /\bcdn\b/gi,
    /\bindexing\b/gi,
    /\bdenormali[zs]/gi,
    /\bnormali[zs]/gi,
    /\bschema\b/gi,
];

const ARCHITECTURE_SIGNALS: readonly RegExp[] = [
    /\bmicroservice\b/gi,
    /\bmonolith\b/gi,
    /\bapi\s+gateway\b/gi,
    /\bservice\s+mesh\b/gi,
    /\bmessage\s+queue\b/gi,
    /\bkafka\b/gi,
    /\brabbitmq\b/gi,
    /\bevent[- ]driven\b/gi,
    /\bpub[- ]?sub\b/gi,
    /\bcqrs\b/gi,
    /\bevent\s+sourcing\b/gi,
];

const RELIABILITY_SIGNALS: readonly RegExp[] = [
    /\bavailability\b/gi,
    /\bconsistency\b/gi,
    /\bcap\s+theorem\b/gi,
    /\bfault\s+toleran/gi,
    /\bredundancy\b/gi,
    /\bfailover\b/gi,
    /\bcircuit\s+breaker\b/gi,
    /\bretry\b/gi,
    /\bidempoten/gi,
    /\blatency\b/gi,
    /\bthroughput\b/gi,
    /\bsla\b/gi,
    /\buptime\b/gi,
];

const ESTIMATION_SIGNALS: readonly RegExp[] = [
    /\bback[- ]?of[- ]?(?:the[- ])?envelope\b/gi,
    /\bqps\b/gi,
    /\brequests?\s+per\s+second\b/gi,
    /\btps\b/gi,
    /\bbandwidth\b/gi,
    /\bstorage\s+(?:estimate|requirement|capacity)\b/gi,
    /\b\d+\s*(?:tb|gb|mb|kb)\b/gi,
    /\b\d+\s*(?:million|billion|thousand)\s+(?:users?|requests?|records?)\b/gi,
];

// ---------------------------------------------------------------------------
// SystemDesignSubBrain
// ---------------------------------------------------------------------------

export class SystemDesignSubBrain implements SubBrain {
    readonly id = 'tech_interview_system_design';
    readonly name = 'System Design Sub-Brain';
    readonly weight = 0.8;
    readonly timeoutMs = 50;

    execute(input: SubBrainInput): SubBrainOutput {
        const startMs = performance.now();
        const text = input.normalizedText;
        const insights = [];

        const scalabilityMatches = findPatternMatches(text, SCALABILITY_SIGNALS);
        const dataMatches = findPatternMatches(text, DATA_LAYER_SIGNALS);
        const archMatches = findPatternMatches(text, ARCHITECTURE_SIGNALS);
        const reliabilityMatches = findPatternMatches(text, RELIABILITY_SIGNALS);
        const estimationMatches = findPatternMatches(text, ESTIMATION_SIGNALS);

        // Count distinct categories touched
        const categoriesHit = [
            scalabilityMatches.length > 0,
            dataMatches.length > 0,
            archMatches.length > 0,
            reliabilityMatches.length > 0,
            estimationMatches.length > 0,
        ].filter(Boolean).length;

        const totalMatches = scalabilityMatches.length + dataMatches.length + archMatches.length
            + reliabilityMatches.length + estimationMatches.length;

        const allMatches = [
            ...scalabilityMatches, ...dataMatches, ...archMatches,
            ...reliabilityMatches, ...estimationMatches,
        ];

        if (categoriesHit >= 4) {
            insights.push({
                label: 'Strong system design reasoning',
                confidence: matchCountToConfidence(totalMatches),
                evidence: matchesToEvidence(allMatches),
                reasoning: [
                    `designLevel: strong (${categoriesHit} categories, ${totalMatches} signals)`,
                    scalabilityMatches.length > 0 ? `Scalability: ${scalabilityMatches.length}` : '',
                    dataMatches.length > 0 ? `Data layer: ${dataMatches.length}` : '',
                    archMatches.length > 0 ? `Architecture: ${archMatches.length}` : '',
                    reliabilityMatches.length > 0 ? `Reliability: ${reliabilityMatches.length}` : '',
                    estimationMatches.length > 0 ? `Estimation: ${estimationMatches.length}` : '',
                ].filter(Boolean),
                weight: 0.85,
            });
        } else if (categoriesHit >= 2) {
            insights.push({
                label: 'Moderate system design reasoning',
                confidence: matchCountToConfidence(totalMatches),
                evidence: matchesToEvidence(allMatches),
                reasoning: [
                    `designLevel: moderate (${categoriesHit} categories, ${totalMatches} signals)`,
                ],
                weight: 0.7,
            });
        } else if (categoriesHit === 1 && totalMatches >= 2) {
            insights.push({
                label: 'Basic system design reasoning',
                confidence: matchCountToConfidence(totalMatches),
                evidence: matchesToEvidence(allMatches),
                reasoning: [
                    `designLevel: basic (${categoriesHit} category, ${totalMatches} signals)`,
                ],
                weight: 0.55,
            });
        }

        return buildOutput(this.id, insights, startMs);
    }
}
