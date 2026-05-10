// electron/intelligence/planning/PlanningEngine.ts
// Deterministic, synchronous planning engine that produces ReasoningPlans.
//
// The PlanningEngine reads:
//   - QuestionCategory (from QuestionUnderstandingV2)
//   - ResponseDepth (from ResponseDepthEstimator)
//   - Matched signals (from QuestionUnderstandingV2)
//   - Question text (normalized)
//
// And produces a ReasoningPlan that tells the Brain WHICH reasoning steps
// the answer should cover, in WHAT order.
//
// This is NOT chain-of-thought. This is NOT LLM planning.
// This is STRUCTURED RESPONSE PLANNING — deterministic, rule-based, <1ms.
//
// Constraints:
//   ✅ Synchronous
//   ✅ Deterministic
//   ✅ No provider calls
//   ✅ No async
//   ✅ No LLM orchestration
//   ❌ Does NOT generate answers
//   ❌ Does NOT modify streaming
//   ❌ Does NOT touch SessionTracker

import type { QuestionCategory, ResponseDepth, BrainId } from '../types';
import type { QuestionUnderstandingResult } from '../QuestionUnderstandingV2';
import type { ResponseDepthEstimate } from '../ResponseDepthEstimator';
import type { PlanStep, ReasoningPlan } from './ReasoningPlan';
import { createFallbackPlan } from './ReasoningPlan';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface PlanningInput {
    /** The raw question text */
    question: string;

    /** Category from QuestionUnderstandingV2 */
    category: QuestionCategory;

    /** Brain that will execute this plan */
    brainId: BrainId;

    /** Depth estimate from ResponseDepthEstimator */
    depthEstimate: ResponseDepthEstimate;

    /** Full QuestionUnderstandingV2 result (for matched signals) */
    questionUnderstanding: QuestionUnderstandingResult;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PlanRule {
    /** Unique rule ID for debugging */
    id: string;
    /** Weight — higher weight wins when multiple rules match */
    weight: number;
    /** Pattern to match against normalized question */
    pattern: RegExp;
    /** Steps to produce when this rule matches */
    steps: PlanStep[];
}

type CategoryRules = {
    [K in QuestionCategory]?: PlanRule[];
};

// ---------------------------------------------------------------------------
// Plan rules — organized by category
// ---------------------------------------------------------------------------

const CODING_RULES: PlanRule[] = [
    {
        id: 'coding.definition',
        weight: 3.0,
        pattern: /^(what is|what's|define|explain)\b.*\b(hash ?map|array|tree|graph|stack|queue|linked list|heap|set|trie)/i,
        steps: ['quick_definition', 'example'],
    },
    {
        id: 'coding.optimize',
        weight: 4.5,
        pattern: /\b(optimi[sz]e|optimization|improve performance|reduce complexity)\b/i,
        steps: ['algorithm', 'optimization', 'complexity_analysis', 'edge_cases'],
    },
    {
        id: 'coding.debug',
        weight: 4.0,
        pattern: /\b(debug|fix|bug|broken|not working|memory leak|root cause)\b/i,
        steps: ['core_explanation', 'optimization', 'edge_cases'],
    },
    {
        id: 'coding.algorithm_deep',
        weight: 3.8,
        pattern: /\b(implement|solve|algorithm|dynamic programming|binary search|sliding window|two pointers|dfs|bfs|recursion|greedy)\b/i,
        steps: ['algorithm', 'complexity_analysis', 'edge_cases', 'example'],
    },
    {
        id: 'coding.complexity',
        weight: 3.5,
        pattern: /\b(time complexity|space complexity|big o|complexity analysis|runtime)\b/i,
        steps: ['algorithm', 'complexity_analysis'],
    },
    {
        id: 'coding.compare',
        weight: 3.2,
        pattern: /\b(compare|versus|vs|difference between|when to use)\b/i,
        steps: ['quick_definition', 'comparison', 'tradeoffs', 'example'],
    },
    {
        id: 'coding.general',
        weight: 1.0,
        pattern: /./,
        steps: ['core_explanation', 'example'],
    },
];

const SYSTEM_DESIGN_RULES: PlanRule[] = [
    {
        id: 'system.full_design',
        weight: 5.0,
        pattern: /\bdesign\s+(?:(?:a|an|the)\s+)?(?:whatsapp|instagram|twitter|youtube|uber|notification|chat|feed|service|system|platform|api|messaging|url shortener|parking lot|rate limiter)\b/i,
        steps: ['requirements', 'scale_estimation', 'architecture', 'database', 'cache', 'tradeoffs', 'failure_handling', 'summary'],
    },
    {
        id: 'system.component_deep',
        weight: 4.0,
        pattern: /\b(explain|deep dive|how does)\b.*\b(cache|caching|redis|kafka|database|replication|sharding|load balanc|queue|pub.?sub)\b/i,
        steps: ['core_explanation', 'example', 'tradeoffs'],
    },
    {
        id: 'system.scale',
        weight: 4.2,
        pattern: /\b(scale|scalable|scaling|millions of users|high traffic|throughput)\b/i,
        steps: ['requirements', 'scale_estimation', 'architecture', 'tradeoffs'],
    },
    {
        id: 'system.tradeoffs',
        weight: 3.5,
        pattern: /\b(tradeoff|trade.off|pros and cons|advantages|disadvantages|when to use)\b/i,
        steps: ['core_explanation', 'comparison', 'tradeoffs'],
    },
    {
        id: 'system.general',
        weight: 1.0,
        pattern: /./,
        steps: ['core_explanation', 'architecture', 'tradeoffs'],
    },
];

const BEHAVIORAL_RULES: PlanRule[] = [
    {
        id: 'behavioral.star_prompt',
        weight: 5.0,
        pattern: /\b(tell me about a time|describe a situation|share an example|give me an example)\b/i,
        steps: ['star_situation', 'star_task', 'star_action', 'star_result'],
    },
    {
        id: 'behavioral.challenge',
        weight: 4.5,
        pattern: /\b(challenge|difficult|conflict|pressure|setback|obstacle)\b/i,
        steps: ['star_situation', 'star_task', 'star_action', 'star_result'],
    },
    {
        id: 'behavioral.failure',
        weight: 4.5,
        pattern: /\b(failure|mistake|went wrong|learned from)\b/i,
        steps: ['star_situation', 'star_task', 'star_action', 'star_result'],
    },
    {
        id: 'behavioral.leadership',
        weight: 4.5,
        pattern: /\b(leadership|lead|mentor|influence|initiative)\b/i,
        steps: ['star_situation', 'star_task', 'star_action', 'star_result'],
    },
    {
        id: 'behavioral.general',
        weight: 1.0,
        pattern: /./,
        steps: ['star_situation', 'star_action', 'star_result'],
    },
];

const RESUME_RULES: PlanRule[] = [
    {
        id: 'resume.project',
        weight: 4.5,
        pattern: /\b(your project|projects? you worked on|tell me about your project|walk me through)\b/i,
        steps: ['project_grounding', 'core_explanation', 'jd_alignment'],
    },
    {
        id: 'resume.experience',
        weight: 4.0,
        pattern: /\b(experience with|background in|what have you worked on|tech stack|current role|past role)\b/i,
        steps: ['project_grounding', 'core_explanation', 'jd_alignment'],
    },
    {
        id: 'resume.walkthrough',
        weight: 4.8,
        pattern: /\b(walk me through your resume|your resume|resume|background|introduce yourself)\b/i,
        steps: ['project_grounding', 'core_explanation', 'jd_alignment', 'summary'],
    },
    {
        id: 'resume.strengths',
        weight: 3.5,
        pattern: /\b(strength|weakness|why should we hire|why this role|why this company)\b/i,
        steps: ['project_grounding', 'jd_alignment'],
    },
    {
        id: 'resume.general',
        weight: 1.0,
        pattern: /./,
        steps: ['project_grounding', 'jd_alignment'],
    },
];

const GENERAL_RULES: PlanRule[] = [
    {
        id: 'general.definition',
        weight: 4.0,
        pattern: /^(what is|what's|what are|define)\b/i,
        steps: ['quick_definition', 'example'],
    },
    {
        id: 'general.explain',
        weight: 3.5,
        pattern: /\b(explain|how does|how do|why does|why do)\b/i,
        steps: ['core_explanation', 'example'],
    },
    {
        id: 'general.compare',
        weight: 3.8,
        pattern: /\b(compare|versus|vs|difference between)\b/i,
        steps: ['quick_definition', 'comparison', 'tradeoffs'],
    },
    {
        id: 'general.general',
        weight: 1.0,
        pattern: /./,
        steps: ['core_explanation', 'example'],
    },
];

const CATEGORY_RULES: CategoryRules = {
    coding: CODING_RULES,
    system_design: SYSTEM_DESIGN_RULES,
    behavioral: BEHAVIORAL_RULES,
    resume_jd: RESUME_RULES,
    general: GENERAL_RULES,
    follow_up: GENERAL_RULES,
    clarification: GENERAL_RULES,
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeQuestion(text: string): string {
    return text
        .toLowerCase()
        .replace(/(\w)\.\s+(\w)/g, '$1$2')
        .replace(/[^\w\s+./?-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ---------------------------------------------------------------------------
// Verbosity estimation
// ---------------------------------------------------------------------------

function estimateVerbosity(stepCount: number): ReasoningPlan['estimatedVerbosity'] {
    if (stepCount <= 2) return 'concise';
    if (stepCount <= 4) return 'moderate';
    return 'detailed';
}

// ---------------------------------------------------------------------------
// Confidence calculation
// ---------------------------------------------------------------------------

function calculateConfidence(
    matchedRule: PlanRule,
    depthEstimate: ResponseDepthEstimate,
    questionUnderstanding: QuestionUnderstandingResult,
): number {
    let confidence = 0.4;

    // Higher-weight rules get higher confidence
    confidence += Math.min(matchedRule.weight * 0.08, 0.35);

    // Cross-reference: if QuestionUnderstandingV2 was confident, boost plan confidence
    if (questionUnderstanding.confidence >= 0.8) {
        confidence += 0.1;
    } else if (questionUnderstanding.confidence >= 0.6) {
        confidence += 0.05;
    }

    // Cross-reference: if depth estimate aligns with step count, boost
    const stepCount = matchedRule.steps.length;
    const depthAligned =
        (depthEstimate.depth === 'short' && stepCount <= 2) ||
        (depthEstimate.depth === 'medium' && stepCount >= 2 && stepCount <= 4) ||
        (depthEstimate.depth === 'deep' && stepCount >= 4);
    if (depthAligned) {
        confidence += 0.08;
    }

    // Penalty for fallback rules (weight === 1.0)
    if (matchedRule.weight <= 1.0) {
        confidence -= 0.15;
    }

    // Penalty if question understanding used fallback
    if (questionUnderstanding.fallbackUsed) {
        confidence -= 0.1;
    }

    return Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
}

// ---------------------------------------------------------------------------
// Depth-aware step adjustment
// ---------------------------------------------------------------------------

/**
 * Trim or expand steps based on ResponseDepth.
 * For 'short' depth, collapse to the most essential steps.
 * For 'deep' depth, keep all steps (or add summary if missing).
 */
function adjustStepsForDepth(steps: PlanStep[], depth: ResponseDepth): PlanStep[] {
    if (depth === 'short') {
        // Keep at most 2 steps for short responses
        return steps.slice(0, 2);
    }

    if (depth === 'deep' && steps.length >= 4 && !steps.includes('summary')) {
        // For deep responses with 4+ steps, append summary if not already present
        return [...steps, 'summary'];
    }

    return steps;
}

// ---------------------------------------------------------------------------
// PlanningEngine — public API
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic ReasoningPlan for the given input.
 *
 * This function is:
 *   - Synchronous
 *   - Deterministic (same input → same output)
 *   - Realtime-safe (< 1ms on modern desktop CPU)
 *   - Side-effect-free
 *
 * If no confident plan can be produced, returns a safe fallback plan
 * that preserves current Brain behavior.
 */
export function planReasoning(input: PlanningInput): ReasoningPlan {
    const normalizedQuestion = normalizeQuestion(input.question);
    const rules = CATEGORY_RULES[input.category] ?? GENERAL_RULES;

    // Find the highest-weight matching rule
    let bestRule: PlanRule | null = null;

    for (const rule of rules) {
        if (!rule.pattern.test(normalizedQuestion)) {
            continue;
        }

        if (!bestRule || rule.weight > bestRule.weight) {
            bestRule = rule;
        }
    }

    // If no rule matched (shouldn't happen — each category has a catch-all)
    if (!bestRule) {
        return createFallbackPlan();
    }

    // Adjust steps based on depth
    const adjustedSteps = adjustStepsForDepth(bestRule.steps, input.depthEstimate.depth);

    // Calculate confidence
    const confidence = calculateConfidence(
        bestRule,
        input.depthEstimate,
        input.questionUnderstanding,
    );

    // Build reasoning string
    const signalSummary = input.questionUnderstanding.matchedSignals.length > 0
        ? ` from signals [${input.questionUnderstanding.matchedSignals.join(', ')}]`
        : '';
    const reasoning = `${input.category}:${bestRule.id} (depth=${input.depthEstimate.depth})${signalSummary}`;

    return {
        steps: adjustedSteps,
        confidence,
        reasoning,
        estimatedVerbosity: estimateVerbosity(adjustedSteps.length),
    };
}

/**
 * Check whether a plan has sufficient confidence for the Brain to use it.
 * If this returns false, the Brain should fall back to its default behavior.
 */
export function isPlanConfident(plan: ReasoningPlan): boolean {
    return plan.confidence >= 0.45;
}
