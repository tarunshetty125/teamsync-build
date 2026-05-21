// electron/intelligence/adaptive/ModeConfidenceEngine.ts
// Exponential moving average (EMA) smoothing for mode confidence scores.
//
// Prevents confidence oscillation by smoothing raw classifier output
// over a configurable window. Stateful — holds the previous smoothed state.
//
// Usage:
//   const engine = new ModeConfidenceEngine(5);
//   const smoothed = engine.update(rawScores);  // first call = raw passthrough
//   const smoothed2 = engine.update(rawScores2); // second call = EMA applied

import type { ModeTemplateId } from '../../../src/lib/modes/types';
import type { ModeConfidenceScore } from './types';

// ---------------------------------------------------------------------------
// ModeConfidenceEngine
// ---------------------------------------------------------------------------

export class ModeConfidenceEngine {
    private readonly alpha: number;
    private previousScores: Map<ModeTemplateId, ModeConfidenceScore> | null = null;

    /**
     * @param windowSize EMA window size (default 5). Larger = more smoothing.
     */
    constructor(windowSize: number = 5) {
        // EMA alpha: 2 / (windowSize + 1)
        this.alpha = 2 / (windowSize + 1);
    }

    /**
     * Apply EMA smoothing to new raw scores.
     *
     * On the first call (no previous state), returns scores unchanged.
     * On subsequent calls, applies: smoothed = alpha × current + (1 - alpha) × previous
     */
    update(scores: readonly ModeConfidenceScore[]): ModeConfidenceScore[] {
        if (this.previousScores === null) {
            // First call — store and return as-is
            this.previousScores = new Map();
            for (const score of scores) {
                this.previousScores.set(score.modeId, score);
            }
            return [...scores];
        }

        const smoothed: ModeConfidenceScore[] = [];

        for (const score of scores) {
            const prev = this.previousScores.get(score.modeId);
            const prevConfidence = prev?.confidence ?? score.confidence;

            const smoothedConfidence = this.alpha * score.confidence + (1 - this.alpha) * prevConfidence;

            const smoothedScore: ModeConfidenceScore = {
                modeId: score.modeId,
                confidence: smoothedConfidence,
                signalCount: score.signalCount,
                topKeywords: score.topKeywords,
            };

            smoothed.push(smoothedScore);
            this.previousScores.set(score.modeId, smoothedScore);
        }

        // Sort by confidence descending
        smoothed.sort((a, b) => b.confidence - a.confidence);
        return smoothed;
    }

    /**
     * Get the latest smoothed scores without providing new input.
     */
    getSmoothed(): ModeConfidenceScore[] {
        if (!this.previousScores) return [];
        return Array.from(this.previousScores.values())
            .sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Clear all state.
     */
    reset(): void {
        this.previousScores = null;
    }
}
