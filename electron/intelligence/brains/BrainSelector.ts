// electron/intelligence/brains/BrainSelector.ts
// Maps QuestionCategory → BrainId → Brain instance.
//
// The BrainSelector is the routing layer between the QuestionUnderstandingEngine
// and the Brain implementations. It:
//   1. Maps a QuestionCategory to a BrainId
//   2. Looks up the Brain instance from the BrainRegistry
//   3. Falls back to GeneralBrain if anything fails
//
// This module NEVER throws. If selection fails, it returns GeneralBrain.

import type { QuestionCategory, BrainId } from '../types';
import type { QuestionAnalysis } from '../QuestionAnalysis';
import type { Brain } from './Brain';
import { BrainRegistry } from './BrainRegistry';

/** Set to true for verbose brain selection logging (dev only) */
const VERBOSE = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

// ---------------------------------------------------------------------------
// Category → BrainId mapping
// ---------------------------------------------------------------------------

/**
 * Static mapping from QuestionCategory to BrainId.
 *
 * This is the SINGLE source of truth for brain routing.
 * When a new category or brain is added, update this map.
 */
const CATEGORY_TO_BRAIN: Record<QuestionCategory, BrainId> = {
    coding: 'coding',
    behavioral: 'behavioral',
    system_design: 'system_design',
    resume_jd: 'resume',
    follow_up: 'general',       // follow-ups use the general brain (context-aware)
    clarification: 'general',   // clarifications use the general brain
    general: 'general',
};

// ---------------------------------------------------------------------------
// BrainSelector
// ---------------------------------------------------------------------------

export class BrainSelector {
    private registry: BrainRegistry;
    private fallbackBrainId: BrainId = 'general';

    constructor(registry: BrainRegistry) {
        this.registry = registry;
    }

    /**
     * Select the best Brain for a given QuestionAnalysis.
     *
     * Selection logic:
     *   1. If this is an explicit screen scan request → screen_analysis
     *   2. Map the analysis.category to a BrainId via the static table
     *   3. Look up the Brain in the registry
     *   4. If not found → fallback to GeneralBrain
     *
     * This method NEVER throws. If anything fails, it returns GeneralBrain.
     *
     * @param analysis - Rich question classification
     * @param options - Optional overrides
     * @returns The selected Brain instance (never null)
     */
    select(
        analysis: QuestionAnalysis,
        options?: {
            /** Force a specific brain ID (bypasses category mapping) */
            forceBrainId?: BrainId;
            /** Reserved for future image-aware routing. Currently unused. */
            hasImages?: boolean;
            /** Whether this is a screen scan request */
            isScreenScan?: boolean;
        },
    ): Brain {
        try {
            // 1. Forced brain ID (for testing or explicit overrides)
            if (options?.forceBrainId) {
                const forced = this.registry.get(options.forceBrainId);
                if (forced) {
                    if (VERBOSE) console.log(`[BrainSelector] Forced brain: ${options.forceBrainId}`);
                    return forced;
                }
                console.warn(`[BrainSelector] Forced brain '${options.forceBrainId}' not found, falling back`);
            }

            // 2. Screen scan override
            if (options?.isScreenScan) {
                const screenBrain = this.registry.get('screen_analysis');
                if (screenBrain) {
                    if (VERBOSE) console.log(`[BrainSelector] Screen scan request → screen_analysis`);
                    return screenBrain;
                }
            }

            // 3. Standard category-based selection
            const brainId = CATEGORY_TO_BRAIN[analysis.category] ?? this.fallbackBrainId;
            const brain = this.registry.get(brainId);

            if (brain) {
                if (VERBOSE) console.log(`[BrainSelector] ${analysis.category} → ${brainId} (confidence: ${analysis.confidence.toFixed(2)})`);
                return brain;
            }

            // 4. BrainId resolved but not registered — log and fallback
            console.warn(`[BrainSelector] Brain '${brainId}' not registered, falling back to '${this.fallbackBrainId}'`);
        } catch (error: any) {
            console.error(`[BrainSelector] Selection failed: ${error?.message}. Using fallback.`);
        }

        // 5. Absolute fallback — GeneralBrain must always be registered
        const fallback = this.registry.get(this.fallbackBrainId);
        if (!fallback) {
            // This should never happen in production — GeneralBrain is registered at boot
            throw new Error(`[BrainSelector] CRITICAL: Fallback brain '${this.fallbackBrainId}' is not registered`);
        }
        return fallback;
    }

    /**
     * Get the BrainId that would be selected for a category (without lookup).
     * Useful for logging and metrics.
     */
    getBrainIdForCategory(category: QuestionCategory): BrainId {
        return CATEGORY_TO_BRAIN[category] ?? this.fallbackBrainId;
    }

    /**
     * Get the full category → brainId mapping (for debugging).
     */
    getCategoryMap(): Record<QuestionCategory, BrainId> {
        return { ...CATEGORY_TO_BRAIN };
    }
}
