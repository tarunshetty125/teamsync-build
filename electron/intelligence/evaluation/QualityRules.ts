// electron/intelligence/evaluation/QualityRules.ts
// Domain-specific quality rules for the ResponseQualityEvaluator.
//
// Each rule checks whether a generated response contains an expected
// quality signal for its domain. Rules are deterministic regex/pattern
// checks — no LLM calls, no async, no provider dependencies.
//
// Rules are organized by BrainId so the evaluator only runs relevant
// checks for each domain.

import type { BrainId, ResponseDepth } from '../types';

// ---------------------------------------------------------------------------
// QualityIssue — a single quality problem detected in a response
// ---------------------------------------------------------------------------

export interface QualityIssue {
    /** Unique rule ID for debugging and metrics */
    readonly ruleId: string;
    /** Severity: how much this impacts answer quality */
    readonly severity: 'critical' | 'high' | 'medium' | 'low';
    /** Human-readable description of what's missing */
    readonly description: string;
    /** Suggestion for improvement (used in metrics/logging, not injected) */
    readonly suggestion: string;
    /** Weight for composite score calculation (0–1) */
    readonly weight: number;
}

// ---------------------------------------------------------------------------
// QualityRule — a single check that can detect a quality issue
// ---------------------------------------------------------------------------

export interface QualityRule {
    /** Unique rule ID */
    id: string;
    /** Which brain this rule applies to */
    brainId: BrainId | 'all';
    /** Minimum response depth for this rule to apply */
    minDepth?: ResponseDepth;
    /** Pattern that SHOULD be present — absence triggers the issue */
    expectedPattern: RegExp;
    /** The issue to report when the pattern is NOT found */
    issue: Omit<QualityIssue, 'ruleId'>;
}

// ---------------------------------------------------------------------------
// Depth ordering helper
// ---------------------------------------------------------------------------

const DEPTH_ORDER: Record<ResponseDepth, number> = {
    short: 0,
    medium: 1,
    deep: 2,
};

export function meetsMinDepth(actual: ResponseDepth, minRequired?: ResponseDepth): boolean {
    if (!minRequired) return true;
    return DEPTH_ORDER[actual] >= DEPTH_ORDER[minRequired];
}

// ---------------------------------------------------------------------------
// Quality Rules — organized by domain
// ---------------------------------------------------------------------------

export const QUALITY_RULES: QualityRule[] = [
    // ===== CODING =====
    {
        id: 'coding.complexity_missing',
        brainId: 'coding',
        minDepth: 'medium',
        expectedPattern: /\b(O\(|time complexity|space complexity|big[- ]?o|runtime|linear|logarithmic|quadratic|constant|exponential)\b/i,
        issue: {
            severity: 'high',
            description: 'Response missing complexity analysis',
            suggestion: 'Add time and space complexity (e.g., O(n log n))',
            weight: 0.25,
        },
    },
    {
        id: 'coding.edge_cases_missing',
        brainId: 'coding',
        minDepth: 'medium',
        expectedPattern: /\b(edge case|empty|null|overflow|boundary|corner case|special case|negative|zero|single element)\b/i,
        issue: {
            severity: 'medium',
            description: 'Response missing edge case discussion',
            suggestion: 'Mention at least one edge case or boundary condition',
            weight: 0.15,
        },
    },
    {
        id: 'coding.approach_missing',
        brainId: 'coding',
        minDepth: 'medium',
        expectedPattern: /\b(approach|algorithm|strategy|technique|method|solution|steps?)\b/i,
        issue: {
            severity: 'high',
            description: 'Response missing clear approach description',
            suggestion: 'Name the approach or algorithm being used',
            weight: 0.20,
        },
    },

    // ===== BEHAVIORAL =====
    {
        id: 'behavioral.first_person_missing',
        brainId: 'behavioral',
        expectedPattern: /\b(I |I'[dvm]|my |we |our )\b/i,
        issue: {
            severity: 'critical',
            description: 'Response not in first person',
            suggestion: 'Use first person (I, we) — the user will say this aloud',
            weight: 0.30,
        },
    },
    {
        id: 'behavioral.star_situation_missing',
        brainId: 'behavioral',
        minDepth: 'medium',
        expectedPattern: /\b(situation|context|background|project|team|at|when|while working)\b/i,
        issue: {
            severity: 'high',
            description: 'Response missing situation/context (STAR)',
            suggestion: 'Ground the story with a specific situation or project name',
            weight: 0.20,
        },
    },
    {
        id: 'behavioral.result_missing',
        brainId: 'behavioral',
        minDepth: 'medium',
        expectedPattern: /\b(result|outcome|impact|improved|reduced|increased|delivered|achieved|shipped|launched|saved|grew|revenue|users|performance)\b/i,
        issue: {
            severity: 'high',
            description: 'Response missing measurable result (STAR)',
            suggestion: 'Include a measurable outcome (e.g., improved by 30%, shipped 2 weeks early)',
            weight: 0.25,
        },
    },

    // ===== SYSTEM DESIGN =====
    {
        id: 'system_design.tradeoffs_missing',
        brainId: 'system_design',
        minDepth: 'medium',
        expectedPattern: /\b(tradeoff|trade[- ]?off|alternatively|on the other hand|drawback|downside|however|versus|vs|pros?|cons?)\b/i,
        issue: {
            severity: 'critical',
            description: 'Response missing tradeoff analysis',
            suggestion: 'Call out at least one design tradeoff with alternatives',
            weight: 0.25,
        },
    },
    {
        id: 'system_design.scalability_missing',
        brainId: 'system_design',
        minDepth: 'medium',
        expectedPattern: /\b(scal|QPS|throughput|latency|users|traffic|requests per second|million|billion|partition|shard|replica|load balanc)\b/i,
        issue: {
            severity: 'high',
            description: 'Response missing scalability reasoning',
            suggestion: 'Include scale estimates or scalability strategy',
            weight: 0.20,
        },
    },
    {
        id: 'system_design.components_missing',
        brainId: 'system_design',
        minDepth: 'medium',
        expectedPattern: /\b(database|cache|queue|API|service|server|client|gateway|storage|CDN|Redis|Kafka|Postgres|MySQL|MongoDB|DynamoDB|S3)\b/i,
        issue: {
            severity: 'high',
            description: 'Response missing concrete system components',
            suggestion: 'Name specific technologies or components (e.g., Redis, Kafka, PostgreSQL)',
            weight: 0.15,
        },
    },

    // ===== RESUME =====
    {
        id: 'resume.first_person_missing',
        brainId: 'resume',
        expectedPattern: /\b(I |I'[dvm]|my |we |our )\b/i,
        issue: {
            severity: 'critical',
            description: 'Response not in first person',
            suggestion: 'Use first person — the user will say this as their own answer',
            weight: 0.30,
        },
    },
    {
        id: 'resume.grounding_missing',
        brainId: 'resume',
        minDepth: 'medium',
        expectedPattern: /\b(project|team|built|developed|implemented|designed|led|managed|shipped|deployed|experience|role|intern|engineer)\b/i,
        issue: {
            severity: 'high',
            description: 'Response not grounded in specific experience',
            suggestion: 'Reference a specific project, role, or achievement',
            weight: 0.25,
        },
    },

    // ===== GENERAL (applies to all) =====
    {
        id: 'general.empty_response',
        brainId: 'all',
        expectedPattern: /(?:\S.*){20}/s,
        issue: {
            severity: 'critical',
            description: 'Response is empty or trivially short',
            suggestion: 'Provide a substantive answer',
            weight: 0.50,
        },
    },
];

/**
 * Get rules applicable to a specific brain and depth.
 */
export function getRulesForBrain(brainId: BrainId, depth: ResponseDepth): QualityRule[] {
    return QUALITY_RULES.filter((rule) => {
        const brainMatch = rule.brainId === brainId || rule.brainId === 'all';
        const depthMatch = meetsMinDepth(depth, rule.minDepth);
        return brainMatch && depthMatch;
    });
}
