// electron/intelligence/evaluation/ResponseQualityEvaluator.ts
// Deterministic, synchronous response quality evaluator.
//
// Runs AFTER a response is generated. Checks whether the response
// contains expected domain-quality signals based on the Brain, category,
// depth, and reasoning plan.
//
// This evaluator:
//   ✅ Is synchronous and deterministic
//   ✅ Uses regex/pattern matching only
//   ✅ Produces a quality score + issues + suggestions
//   ❌ Does NOT regenerate answers
//   ❌ Does NOT delay streaming
//   ❌ Does NOT call the LLM
//   ❌ Does NOT modify the response
//
// Overhead: < 1ms per evaluation.

import type { BrainId, QuestionCategory, ResponseDepth } from '../types';
import type { ReasoningPlan } from '../planning/ReasoningPlan';
import { planContains } from '../planning/ReasoningPlan';
import { type QualityIssue, type QualityRule, getRulesForBrain } from './QualityRules';

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface QualityEvaluationInput {
    /** The original question */
    question: string;

    /** Question category */
    category: QuestionCategory;

    /** Brain that produced the response */
    brainId: BrainId;

    /** Response depth used */
    responseDepth: ResponseDepth;

    /** Optional reasoning plan — enables plan-aware checks */
    reasoningPlan?: ReasoningPlan;

    /** The full generated response to evaluate */
    generatedResponse: string;
}

export interface QualityEvaluationResult {
    /** Composite quality score (0–1). Higher is better. */
    score: number;

    /** List of quality issues found */
    issues: QualityIssue[];

    /** Human-readable improvement suggestions */
    suggestions: string[];

    /** Confidence in the evaluation (0–1) */
    confidence: number;

    /** Number of rules checked */
    rulesChecked: number;

    /** Number of rules passed */
    rulesPassed: number;
}

// ---------------------------------------------------------------------------
// Plan-aware bonus rules
// ---------------------------------------------------------------------------

interface PlanAwareCheck {
    planStep: string;
    expectedPattern: RegExp;
    issue: Omit<QualityIssue, 'ruleId'>;
}

const PLAN_AWARE_CHECKS: PlanAwareCheck[] = [
    {
        planStep: 'complexity_analysis',
        expectedPattern: /\b(O\(|time complexity|space complexity|big[- ]?o|runtime)\b/i,
        issue: {
            severity: 'high',
            description: 'Plan required complexity analysis but response lacks it',
            suggestion: 'Add Big-O time and space complexity analysis',
            weight: 0.20,
        },
    },
    {
        planStep: 'edge_cases',
        expectedPattern: /\b(edge case|empty|null|overflow|boundary|corner|special case)\b/i,
        issue: {
            severity: 'medium',
            description: 'Plan required edge cases but response lacks them',
            suggestion: 'Discuss at least one edge case or boundary condition',
            weight: 0.15,
        },
    },
    {
        planStep: 'tradeoffs',
        expectedPattern: /\b(tradeoff|trade[- ]?off|alternatively|drawback|downside|however|versus|vs)\b/i,
        issue: {
            severity: 'high',
            description: 'Plan required tradeoffs but response lacks them',
            suggestion: 'Call out design tradeoffs with at least one alternative',
            weight: 0.20,
        },
    },
    {
        planStep: 'scale_estimation',
        expectedPattern: /\b(QPS|throughput|latency|million|billion|scale|traffic|requests per second)\b/i,
        issue: {
            severity: 'medium',
            description: 'Plan required scale estimation but response lacks it',
            suggestion: 'Include concrete scale numbers (QPS, storage, latency targets)',
            weight: 0.15,
        },
    },
    {
        planStep: 'failure_handling',
        expectedPattern: /\b(failur|failover|recovery|retry|circuit break|timeout|fallback|graceful degradation|redundanc|replication)\b/i,
        issue: {
            severity: 'medium',
            description: 'Plan required failure handling but response lacks it',
            suggestion: 'Address failure modes and recovery strategies',
            weight: 0.15,
        },
    },
    {
        planStep: 'star_situation',
        expectedPattern: /\b(situation|context|background|project|team|at|when|while working)\b/i,
        issue: {
            severity: 'high',
            description: 'Plan required STAR situation but response lacks context grounding',
            suggestion: 'Start with a specific situation/project name',
            weight: 0.20,
        },
    },
    {
        planStep: 'star_result',
        expectedPattern: /\b(result|outcome|impact|improved|reduced|increased|delivered|achieved|shipped)\b/i,
        issue: {
            severity: 'high',
            description: 'Plan required STAR result but response lacks measurable outcome',
            suggestion: 'Include a measurable result (e.g., improved by X%, shipped Y weeks early)',
            weight: 0.20,
        },
    },
    {
        planStep: 'jd_alignment',
        expectedPattern: /\b(role|position|requirements|fit|align|match|qualification|responsibilities|skills)\b/i,
        issue: {
            severity: 'medium',
            description: 'Plan required JD alignment but response lacks role-fit framing',
            suggestion: 'Frame the answer in terms of the target role requirements',
            weight: 0.15,
        },
    },
    {
        planStep: 'project_grounding',
        expectedPattern: /\b(project|built|developed|implemented|designed|led|managed|shipped|deployed)\b/i,
        issue: {
            severity: 'high',
            description: 'Plan required project grounding but response lacks specific project reference',
            suggestion: 'Reference a specific project with concrete details',
            weight: 0.20,
        },
    },
];

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function clampScore(value: number): number {
    return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

/**
 * Evaluate the quality of a generated response.
 *
 * This function is:
 *   - Synchronous
 *   - Deterministic
 *   - Realtime-safe (< 1ms)
 *   - Side-effect-free
 *
 * It does NOT modify the response. It produces a quality report
 * that can be used for metrics, logging, or future improvement signals.
 */
export function evaluateResponseQuality(input: QualityEvaluationInput): QualityEvaluationResult {
    const issues: QualityIssue[] = [];
    const suggestions: string[] = [];
    let totalWeight = 0;
    let failedWeight = 0;

    // 1. Run domain-specific rules
    const rules = getRulesForBrain(input.brainId, input.responseDepth);
    let rulesChecked = 0;
    let rulesPassed = 0;

    for (const rule of rules) {
        rulesChecked++;
        totalWeight += rule.issue.weight;

        if (rule.expectedPattern.test(input.generatedResponse)) {
            rulesPassed++;
        } else {
            failedWeight += rule.issue.weight;
            issues.push({ ...rule.issue, ruleId: rule.id });
            suggestions.push(rule.issue.suggestion);
        }
    }

    // 2. Run plan-aware checks (if a confident plan is present)
    if (input.reasoningPlan && input.reasoningPlan.confidence >= 0.45) {
        for (const check of PLAN_AWARE_CHECKS) {
            if (!planContains(input.reasoningPlan, check.planStep as any)) {
                continue;
            }

            // Don't double-count if a base rule already caught this
            const alreadyCaught = issues.some((issue) =>
                issue.description.toLowerCase().includes(check.planStep.replace(/_/g, ' ')),
            );
            if (alreadyCaught) {
                continue;
            }

            rulesChecked++;
            totalWeight += check.issue.weight;

            if (check.expectedPattern.test(input.generatedResponse)) {
                rulesPassed++;
            } else {
                failedWeight += check.issue.weight;
                const ruleId = `plan.${check.planStep}_missing`;
                issues.push({ ...check.issue, ruleId });
                suggestions.push(check.issue.suggestion);
            }
        }
    }

    // 3. Calculate composite score
    const score = totalWeight > 0
        ? clampScore(1 - (failedWeight / totalWeight))
        : 1.0;

    // 4. Calculate confidence
    let confidence = 0.5;
    if (rulesChecked >= 3) confidence += 0.15;
    if (rulesChecked >= 5) confidence += 0.10;
    if (input.reasoningPlan && input.reasoningPlan.confidence >= 0.6) confidence += 0.10;
    if (input.generatedResponse.length > 200) confidence += 0.05;
    confidence = clampScore(confidence);

    return {
        score,
        issues,
        suggestions,
        confidence,
        rulesChecked,
        rulesPassed,
    };
}

/**
 * Check whether a quality evaluation result indicates acceptable quality.
 * Threshold is intentionally lenient to avoid false rejections.
 */
export function isQualityAcceptable(result: QualityEvaluationResult): boolean {
    return result.score >= 0.5;
}

/**
 * Get the most critical issue from an evaluation result.
 * Returns null if no issues were found.
 */
export function getMostCriticalIssue(result: QualityEvaluationResult): QualityIssue | null {
    if (result.issues.length === 0) return null;

    const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    return result.issues.reduce((worst, current) =>
        (severityOrder[current.severity] ?? 0) > (severityOrder[worst.severity] ?? 0) ? current : worst,
    );
}
