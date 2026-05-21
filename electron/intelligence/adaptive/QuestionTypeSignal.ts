// electron/intelligence/adaptive/QuestionTypeSignal.ts
// Classifies question types for mode prediction.
//
// Pure function — no state, no side effects, no external dependencies.
// Detects: STAR questions, coding challenges, system design prompts,
// pricing objections, meeting coordination, lecture explanations.
//
// Regex-only. No LLM.
//
// Contract:
//   ✅ Pure function
//   ✅ Deterministic
//   ✅ <1ms execution
//   ❌ No LLM, no network, no async

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface QuestionTypeResult {
    readonly types: readonly QuestionTypeHit[];
    readonly strongest: QuestionTypeHit | null;
}

export interface QuestionTypeHit {
    readonly type: string;
    readonly hitCount: number;
    readonly confidence: number;
    readonly modeHint: string;
}

// ---------------------------------------------------------------------------
// Question Type Patterns
// ---------------------------------------------------------------------------

interface QuestionTypePattern {
    type: string;
    modeHint: string;
    patterns: readonly RegExp[];
}

const QUESTION_TYPES: readonly QuestionTypePattern[] = [
    {
        type: 'star_question',
        modeHint: 'recruiting',
        patterns: [
            /\btell\s+me\s+about\s+a\s+time\b/gi,
            /\bgive\s+(?:me\s+)?an?\s+example\s+(?:of|when)\b/gi,
            /\bdescribe\s+a\s+(?:situation|time|challenge)\b/gi,
            /\bhow\s+(?:did|would)\s+you\s+(?:handle|deal|manage|approach)\b/gi,
            /\bwalk\s+me\s+through\b/gi,
            /\bwhat\s+(?:was|were)\s+(?:your|the)\s+(?:biggest|greatest|most)\b/gi,
        ],
    },
    {
        type: 'coding_challenge',
        modeHint: 'technical-interview',
        patterns: [
            /\bimplement\b/gi,
            /\bwrite\s+(?:a\s+)?(?:function|method|algorithm|code|program)\b/gi,
            /\bsolve\b/gi,
            /\bfind\s+(?:the|all|a)\b.*\b(?:in|from)\s+(?:an?\s+)?(?:array|list|tree|graph|string)\b/gi,
            /\bgiven\s+(?:an?\s+)?(?:array|list|tree|graph|string|matrix|grid)\b/gi,
            /\boptimal\s+(?:solution|approach|algorithm)\b/gi,
            /\btime\s+(?:and\s+space\s+)?complexity\b/gi,
        ],
    },
    {
        type: 'system_design',
        modeHint: 'technical-interview',
        patterns: [
            /\bdesign\s+(?:a|an|the)\b/gi,
            /\bhow\s+would\s+you\s+(?:design|build|architect|scale)\b/gi,
            /\bscale\s+(?:to|for)\s+(?:millions|billions)\b/gi,
            /\bwhat\s+(?:database|cache|queue)\s+would\s+you\b/gi,
            /\bhigh[- ]level\s+(?:design|architecture)\b/gi,
        ],
    },
    {
        type: 'pricing_objection',
        modeHint: 'sales',
        patterns: [
            /\btoo\s+expensive\b/gi,
            /\bprice\s+(?:is|seems)\b/gi,
            /\bbudget\s+(?:concern|constraint|limitation)\b/gi,
            /\bcompetitor\s+(?:is|offers?|charges?)\b/gi,
            /\bdiscount\b/gi,
            /\bcost\s+(?:too|really)\b/gi,
        ],
    },
    {
        type: 'meeting_coordination',
        modeHint: 'team-meet',
        patterns: [
            /\baction\s+item\b/gi,
            /\bwho(?:'s| is)\s+(?:owning|handling|taking)\b/gi,
            /\bnext\s+step\b/gi,
            /\bfollow\s+up\b/gi,
            /\bstatus\s+(?:update|check)\b/gi,
            /\bblocked\s+(?:on|by)\b/gi,
            /\bdeadline\b/gi,
        ],
    },
    {
        type: 'lecture_explanation',
        modeHint: 'lecture',
        patterns: [
            /\bexplain\s+(?:the|this|how|what|why)\b/gi,
            /\bwhat\s+(?:is|are|does)\s+(?:the|a|an)\b/gi,
            /\bdefine\b/gi,
            /\bwhat(?:'s| is)\s+the\s+difference\s+between\b/gi,
            /\bcan\s+you\s+(?:explain|clarify|elaborate)\b/gi,
        ],
    },
];

// ---------------------------------------------------------------------------
// classifyQuestionType
// ---------------------------------------------------------------------------

/**
 * Classify question types present in the text.
 *
 * Returns all detected types with hit counts and mode hints,
 * sorted by hit count descending.
 */
export function classifyQuestionType(text: string): QuestionTypeResult {
    const normalized = text.toLowerCase();
    const types: QuestionTypeHit[] = [];

    for (const questionType of QUESTION_TYPES) {
        let hitCount = 0;
        for (const pattern of questionType.patterns) {
            const re = new RegExp(pattern.source, pattern.flags);
            const matches = normalized.match(re);
            hitCount += matches?.length ?? 0;
        }

        if (hitCount > 0) {
            types.push({
                type: questionType.type,
                hitCount,
                confidence: Math.min(1, hitCount / 5), // 5+ hits = full confidence
                modeHint: questionType.modeHint,
            });
        }
    }

    types.sort((a, b) => b.hitCount - a.hitCount);

    return {
        types,
        strongest: types[0] ?? null,
    };
}
