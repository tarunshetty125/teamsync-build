// electron/intelligence/brains/Brain.ts
// Brain interface — the core abstraction for domain-specific intelligence.
//
// Each Brain encapsulates:
//   1. Domain-specific prompt construction (what to tell the LLM)
//   2. Reasoning structure (how to organize the answer)
//   3. Output contract (what the response must contain)
//   4. Stream strategy (direct vs collect-and-validate)
//
// Brains are PURE LOGIC modules. They:
//   ✅ Return prompt instructions and output contracts
//   ✅ Read QuestionAnalysis, ContextBundle, and ResponseStrategy
//   ❌ Do NOT call LLM APIs
//   ❌ Do NOT hold state
//   ❌ Do NOT access SessionTracker directly
//   ❌ Do NOT emit events

import type { BrainId, StreamStrategy, SessionMode } from '../types';
import type { QuestionAnalysis } from '../QuestionAnalysis';
import type { ContextBundle } from '../ContextBundle';
import type { ResponseStrategy } from '../ResponseStrategy';
import type { PromptInstruction } from '../../ActionContextBuilder';

// ---------------------------------------------------------------------------
// BrainInput — everything a Brain needs to produce its output
// ---------------------------------------------------------------------------

/**
 * Input bundle passed to Brain.execute().
 * Assembled by the ReasoningPlanner from upstream pipeline stages.
 */
export interface BrainInput {
    /** Rich question classification from the QuestionUnderstandingEngine */
    analysis: QuestionAnalysis;

    /** Prioritized, token-budgeted context from the KnowledgeOrchestrator */
    context: ContextBundle;

    /** Response depth/tone/structure strategy from the ResponseStrategyCalculator */
    strategy: ResponseStrategy;

    /** Current session mode (user-selected) */
    sessionMode: SessionMode;

    /** Previous assistant answer — for follow-up/refinement continuity */
    previousAnswer?: string;

    /** User's explicit message (for manual_chat intent) */
    userMessage?: string;

    /** Image paths attached to the request */
    imagePaths?: string[];
}

// ---------------------------------------------------------------------------
// BrainOutput — what a Brain produces
// ---------------------------------------------------------------------------

/**
 * Output of Brain.execute(). Fed into the PromptAssembler.
 *
 * The Brain does NOT generate the final prompt string. It produces:
 *   - `instructions`: mode-specific prompt fragments to inject
 *   - `outputContract`: validation rules for the response
 *   - `streamStrategy`: whether to stream directly or collect-then-validate
 *   - `preferredModel`: optional model preference (e.g., Pro for deep coding)
 */
export interface BrainOutput {
    /** Prompt instructions specific to this brain's domain expertise */
    instructions: PromptInstruction[];

    /**
     * Output contract — a plain-text description of what the response MUST contain.
     * Used by the ActionOutputValidator to verify response quality.
     * Example for CodingBrain: "Response must contain at least one fenced code block"
     */
    outputContract: string;

    /**
     * Model preference. If set, the ModelRouter will prefer this model
     * for the request (e.g., 'gemini-pro' for deep coding problems).
     * If null, the ModelRouter uses the default model.
     */
    preferredModel?: string;

    /**
     * Stream strategy:
     *   'direct'           — tokens are emitted to the client as they arrive (lowest latency)
     *   'collect_validate' — full response is buffered, validated, then emitted
     *                        (used when output format enforcement is critical, e.g., code blocks)
     */
    streamStrategy: StreamStrategy;
}

// ---------------------------------------------------------------------------
// Brain interface
// ---------------------------------------------------------------------------

/**
 * A Brain is a domain-specific intelligence module that knows HOW to answer
 * questions in its category. It produces prompt instructions and output
 * contracts but never calls the LLM directly.
 *
 * Implementation pattern:
 * ```typescript
 * class CodingBrain implements Brain {
 *     readonly id = 'coding';
 *     readonly name = 'Coding Brain';
 *     readonly latencyTarget = 600;
 *
 *     execute(input: BrainInput): BrainOutput {
 *         return {
 *             instructions: [...],
 *             outputContract: 'Must contain fenced code block',
 *             streamStrategy: 'collect_validate',
 *         };
 *     }
 * }
 * ```
 */
export interface Brain {
    /** Unique identifier — matches a BrainId */
    readonly id: BrainId;

    /** Human-readable name for logging and metrics */
    readonly name: string;

    /** Target latency in ms — used for monitoring, not enforcement */
    readonly latencyTarget: number;

    /**
     * Execute the brain's reasoning logic.
     *
     * This is a SYNCHRONOUS, PURE function. It should:
     *   1. Read the input (analysis, context, strategy)
     *   2. Select appropriate prompt templates and instructions
     *   3. Return a BrainOutput with instructions and contracts
     *
     * It must NOT:
     *   - Make async calls
     *   - Access external state
     *   - Call LLM APIs
     *
     * @param input - All context needed for reasoning
     * @returns Prompt instructions and output contract
     */
    execute(input: BrainInput): BrainOutput;
}
