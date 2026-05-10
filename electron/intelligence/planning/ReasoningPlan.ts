// electron/intelligence/planning/ReasoningPlan.ts
// Type contracts for the Brain Planning Layer V1.
//
// A ReasoningPlan is a deterministic, lightweight struct that describes
// WHICH reasoning steps an answer should cover, in WHAT order.
//
// Plans are produced by the PlanningEngine and consumed by Brain.execute().
// They guide response structure — they do NOT generate answers.
//
// IMPORTANT: This file must have ZERO runtime dependencies.
// It is a pure type definition module.

// ---------------------------------------------------------------------------
// PlanStep — atomic reasoning step
// ---------------------------------------------------------------------------

/**
 * A single reasoning step that may appear in a response plan.
 *
 * Each step represents a logical section the LLM should cover.
 * Steps are domain-agnostic identifiers — the Brain maps them to
 * actual prompt instructions.
 *
 * Categories:
 *   - General:      quick_definition, core_explanation, comparison, example, summary
 *   - Coding:       algorithm, optimization, complexity_analysis, edge_cases
 *   - System Design: requirements, scale_estimation, architecture, database, cache,
 *                     tradeoffs, failure_handling
 *   - Behavioral:   star_situation, star_task, star_action, star_result
 *   - Resume:       project_grounding, jd_alignment
 */
export type PlanStep =
    | 'quick_definition'
    | 'core_explanation'
    | 'comparison'
    | 'example'
    | 'algorithm'
    | 'optimization'
    | 'complexity_analysis'
    | 'edge_cases'
    | 'requirements'
    | 'scale_estimation'
    | 'architecture'
    | 'database'
    | 'cache'
    | 'tradeoffs'
    | 'failure_handling'
    | 'star_situation'
    | 'star_task'
    | 'star_action'
    | 'star_result'
    | 'project_grounding'
    | 'jd_alignment'
    | 'summary';

// ---------------------------------------------------------------------------
// ReasoningPlan — the output of PlanningEngine.plan()
// ---------------------------------------------------------------------------

/**
 * A deterministic reasoning plan produced by the PlanningEngine.
 *
 * This struct is passed into BrainInput so that Brain.execute() can
 * adapt its prompt instructions based on the planned reasoning steps.
 *
 * If the PlanningEngine cannot produce a confident plan, it returns
 * a safe fallback plan that preserves current behavior.
 */
export interface ReasoningPlan {
    /**
     * Ordered list of reasoning steps the response should cover.
     * The Brain may map each step to a specific prompt instruction.
     * Order matters — steps should appear in the response in this sequence.
     */
    readonly steps: readonly PlanStep[];

    /**
     * Confidence in the plan (0–1).
     * If confidence is low, the Brain should fall back to its default behavior.
     */
    readonly confidence: number;

    /**
     * Short human-readable reasoning string for debugging/metrics.
     * Example: "coding:algorithm+optimization from signals [coding.optimize, coding.structure]"
     */
    readonly reasoning: string;

    /**
     * Estimated verbosity level derived from the plan step count.
     * Brains can use this to cross-check against ResponseStrategy.depth.
     *   - 'concise':  1-2 steps (quick definition, example)
     *   - 'moderate': 3-4 steps (explanation + tradeoffs + example)
     *   - 'detailed': 5+ steps  (full system design walkthrough)
     */
    readonly estimatedVerbosity: 'concise' | 'moderate' | 'detailed';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a plan contains a specific step.
 * Convenience function for Brain implementations.
 */
export function planContains(plan: ReasoningPlan, step: PlanStep): boolean {
    return plan.steps.includes(step);
}

/**
 * Check whether a plan contains ANY of the given steps.
 */
export function planContainsAny(plan: ReasoningPlan, steps: PlanStep[]): boolean {
    return steps.some((step) => plan.steps.includes(step));
}

/**
 * Check whether a plan contains ALL of the given steps.
 */
export function planContainsAll(plan: ReasoningPlan, steps: PlanStep[]): boolean {
    return steps.every((step) => plan.steps.includes(step));
}

/**
 * Create a safe fallback plan with minimal steps.
 * Used when the PlanningEngine cannot confidently classify a question.
 */
export function createFallbackPlan(): ReasoningPlan {
    return {
        steps: ['core_explanation', 'example'],
        confidence: 0.3,
        reasoning: 'fallback:unknown_question',
        estimatedVerbosity: 'concise',
    };
}
