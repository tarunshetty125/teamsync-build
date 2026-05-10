// electron/intelligence/ResponseStrategy.ts
// Configuration object that controls answer depth, length, tone, and structure.
// Produced by the ResponseStrategyCalculator, consumed by Brain modules.
//
// Currently, response depth is controlled only by prompt instructions
// ("2 to 4 bullets", "moderate length"). This type makes depth a first-class
// decision with explicit inputs and overrides.

import type { ResponseDepth, ResponseTone, StreamStrategy } from './types';

// ---------------------------------------------------------------------------
// ResponseStrategy — how to shape the answer
// ---------------------------------------------------------------------------

/**
 * Controls the structural properties of the generated response.
 *
 * Each Brain reads this strategy to adjust its prompt template:
 *   - depth         → controls bullet count and word count ranges
 *   - tone          → controls language register
 *   - includeCode   → whether a code block is expected
 *   - includeMeta   → whether complexity analysis or tradeoffs are expected
 *
 * The ResponseStrategyCalculator produces this from signals like:
 *   question complexity, interruption risk, session depth, follow-up likelihood.
 */
export interface ResponseStrategy {
    /** Overall response depth — primary control for answer length */
    depth: ResponseDepth;

    /** Language register for the response */
    tone: ResponseTone;

    /** Maximum word count for the response */
    maxWords: number;

    /**
     * Range of bullet points to use [min, max].
     * E.g., [2, 4] means "use 2 to 4 bullet points".
     */
    bulletRange: [number, number];

    /** How the streaming engine should deliver tokens */
    streamStrategy: StreamStrategy;

    /** Whether a fenced code block is expected in the output */
    includeCodeBlock: boolean;

    /** Whether complexity/tradeoff analysis is expected (time + space) */
    includeComplexity: boolean;
}

/**
 * Type alias for depth-preset constants (used by PromptAssembler imports).
 */
export type DepthPreset = ResponseStrategy;

// ---------------------------------------------------------------------------
// Depth presets
// ---------------------------------------------------------------------------

/**
 * Pre-defined strategy presets for each depth level.
 * Brains may override specific fields based on their domain requirements.
 */
export const DEPTH_PRESETS: Record<ResponseDepth, ResponseStrategy> = {
    short: {
        depth: 'short',
        tone: 'conversational',
        maxWords: 120,
        bulletRange: [1, 2],
        streamStrategy: 'direct',
        includeCodeBlock: false,
        includeComplexity: false,
    },
    medium: {
        depth: 'medium',
        tone: 'conversational',
        maxWords: 250,
        bulletRange: [2, 4],
        streamStrategy: 'direct',
        includeCodeBlock: false,
        includeComplexity: false,
    },
    deep: {
        depth: 'deep',
        tone: 'technical',
        maxWords: 500,
        bulletRange: [4, 6],
        streamStrategy: 'direct',
        includeCodeBlock: false,
        includeComplexity: false,
    },
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a ResponseStrategy with sensible defaults, overridable per-field.
 */
export function createStrategy(
    depth: ResponseDepth,
    overrides?: Partial<ResponseStrategy>,
): ResponseStrategy {
    return {
        ...DEPTH_PRESETS[depth],
        ...overrides,
    };
}

/**
 * Create the default strategy for a given depth level.
 * Shorthand for `createStrategy(depth)` with no overrides.
 */
export function defaultStrategy(depth: ResponseDepth = 'medium'): ResponseStrategy {
    return { ...DEPTH_PRESETS[depth] };
}
