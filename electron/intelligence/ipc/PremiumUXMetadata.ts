// electron/intelligence/ipc/PremiumUXMetadata.ts
// Utility for building premium UX metadata from current intelligence state.
//
// Pure function — no state, no side effects, no IPC.
// Called by the intelligence pipeline to annotate responses with
// metadata that the renderer can use for enhanced UI.
//
// Not capability-gated itself — callers gate by checking the relevant
// capability before attaching metadata to responses.

import type { PremiumUXMetadata } from './types';
import { IntelligenceEventBus } from '../timeline/IntelligenceEventBus';

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build premium UX metadata from current intelligence state.
 *
 * @param params - Current state inputs
 * @returns PremiumUXMetadata object ready for IPC attachment
 */
export function buildPremiumUXMetadata(params: {
    readonly confidence: number;
    readonly modeRecommendation: string | null;
    readonly multiBrainActive: boolean;
    readonly memoryHits: number;
}): PremiumUXMetadata {
    const signalStrength: PremiumUXMetadata['signalStrength'] =
        params.confidence >= 0.8 ? 'strong' :
        params.confidence >= 0.5 ? 'moderate' :
        'weak';

    // Get timeline count from existing EventBus singleton
    let timelineCount = 0;
    try {
        timelineCount = IntelligenceEventBus.getInstance().getStats().total;
    } catch {
        // EventBus not initialized yet — safe default
    }

    return {
        confidence: params.confidence,
        signalStrength,
        modeRecommendation: params.modeRecommendation,
        timelineCount,
        multiBrainActive: params.multiBrainActive,
        memoryHits: params.memoryHits,
    };
}
