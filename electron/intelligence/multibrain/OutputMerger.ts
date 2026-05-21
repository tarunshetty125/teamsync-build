// electron/intelligence/multibrain/OutputMerger.ts
// Weighted merge of sub-brain outputs into a unified insight set.
//
// Reuses the Phase 1 Confidence Engine for scoring — no duplicate logic.
// Deduplicates insights by label similarity, ranks by confidence,
// and filters by threshold.
//
// Usage:
//   const merged = OutputMerger.merge(executionResults);

import type {
    SubBrainExecutionResult,
    SubBrainInsight,
    MergedInsightSet,
} from './types';
import { computeConfidence } from '../confidence/ConfidenceEngine';
import { filterByThreshold } from '../confidence/ThresholdFilter';
import type { ConfidenceFactor } from '../confidence/types';

// ---------------------------------------------------------------------------
// OutputMerger
// ---------------------------------------------------------------------------

export class OutputMerger {
    /**
     * Merge results from multiple sub-brain executions.
     *
     * Pipeline:
     *   1. Collect insights from successful executions
     *   2. Weight by brain weight × insight weight × confidence
     *   3. Deduplicate by label similarity
     *   4. Filter by confidence threshold
     *   5. Sort by weighted confidence descending
     */
    static merge(
        results: readonly SubBrainExecutionResult[],
        config?: { confidenceThreshold?: number },
    ): MergedInsightSet {
        const threshold = config?.confidenceThreshold ?? 0.2;

        let totalExecutionMs = 0;
        let failureCount = 0;
        let brainCount = 0;
        const allInsights: Array<{ insight: SubBrainInsight; brainWeight: number }> = [];

        for (const result of results) {
            totalExecutionMs += result.executionMs;

            if (result.status !== 'success' || !result.output) {
                failureCount++;
                continue;
            }

            brainCount++;
            const brainWeight = this.getBrainWeight(result);

            for (const insight of result.output.insights) {
                allInsights.push({ insight, brainWeight });
            }
        }

        // Weight each insight using Phase 1 Confidence Engine
        const weighted = allInsights.map(({ insight, brainWeight }) => {
            const factors: ConfidenceFactor[] = [
                {
                    name: 'insight_confidence',
                    contribution: insight.confidence,
                    description: 'Raw insight confidence',
                },
                {
                    name: 'brain_weight',
                    contribution: brainWeight,
                    description: 'Sub-brain authority weight',
                },
                {
                    name: 'insight_weight',
                    contribution: insight.weight,
                    description: 'Insight contribution weight',
                },
            ];

            const scored = computeConfidence(factors);

            return {
                ...insight,
                confidence: scored.calibrated,
            };
        });

        // Deduplicate by label similarity
        const deduped = this.deduplicateInsights(weighted);

        // Filter by threshold
        const filtered = deduped.filter(insight => {
            const result = filterByThreshold(insight.confidence, {
                defaultThreshold: threshold,
            });
            return result.passed;
        });

        // Sort by confidence descending — deterministic stable sort
        filtered.sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));

        return {
            insights: filtered,
            brainCount,
            failureCount,
            totalExecutionMs: Math.round(totalExecutionMs * 100) / 100,
        };
    }

    /**
     * Deduplicate insights by normalized label.
     * Keeps the highest-confidence instance.
     */
    private static deduplicateInsights(insights: SubBrainInsight[]): SubBrainInsight[] {
        const seen = new Map<string, SubBrainInsight>();

        for (const insight of insights) {
            const key = insight.label.toLowerCase().trim().replace(/\s+/g, ' ');
            const existing = seen.get(key);

            if (!existing || insight.confidence > existing.confidence) {
                seen.set(key, insight);
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Extract brain weight from execution result.
     * Falls back to 0.5 if not determinable.
     */
    private static getBrainWeight(result: SubBrainExecutionResult): number {
        if (result.output && result.output.insights.length > 0) {
            return result.output.insights[0].weight;
        }
        return 0.5;
    }
}
