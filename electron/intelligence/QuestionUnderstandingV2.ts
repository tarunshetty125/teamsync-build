import {
    getQuestionResponseProfile,
    type SessionActionMode,
    type UnifiedActionIntent,
} from '../ActionContextBuilder';
import { profileToCategory } from './adapters';
import type { QuestionCategory } from './types';
import { normalizeQuestion } from './utils';

type ScoredCategory = Exclude<QuestionCategory, 'follow_up' | 'clarification' | 'general'>;

interface SignalRule {
    category: ScoredCategory;
    signal: string;
    weight: number;
    pattern: RegExp;
}

export interface QuestionUnderstandingResult {
    category: QuestionCategory;
    confidence: number;
    matchedSignals: string[];
    fallbackUsed: boolean;
}

const V2_SIGNAL_RULES: SignalRule[] = [
    { category: 'coding', signal: 'coding.optimize', weight: 2.4, pattern: /\b(optimi[sz]e|optimization|optimize|runtime|performance)\b/i },
    { category: 'coding', signal: 'coding.bugfix', weight: 3.2, pattern: /\b(fix(?: this)? bug|debug|bug|root cause|broken)\b/i },
    { category: 'coding', signal: 'coding.algorithm', weight: 2.8, pattern: /\b(algorithm|binary search|dynamic programming|hash map|two pointers|sliding window|dfs|bfs|recursion|greedy)\b/i },
    { category: 'coding', signal: 'coding.structure', weight: 2.1, pattern: /\b(matrix|traversal|array|string|tree|graph|linked list|heap|stack|queue)\b/i },
    { category: 'coding', signal: 'coding.complexity', weight: 2.6, pattern: /\b(time complexity|space complexity|big o|complexity)\b/i },
    { category: 'coding', signal: 'coding.implementation', weight: 2.0, pattern: /\b(implement|implementation|code|function|class|method)\b/i },

    { category: 'system_design', signal: 'system.design_prompt', weight: 3.2, pattern: /\bdesign\s+(?:(?:a|an|the)\s+)?(?:whatsapp|instagram|twitter|youtube|uber|notification|chat|feed|service|system|platform|api|messaging)\b/i },
    { category: 'system_design', signal: 'system.scale', weight: 2.8, pattern: /\b(scale|scalable|scaling|millions of users|high traffic)\b/i },
    { category: 'system_design', signal: 'system.architecture', weight: 2.7, pattern: /\b(system design|architecture|distributed|microservices|event driven|pub\/sub)\b/i },
    { category: 'system_design', signal: 'system.infrastructure', weight: 2.3, pattern: /\b(cache|database|load balanc(?:er|ing)|queue|replication|sharding|throughput|latency|availability|rate limit(?:ing)?)\b/i },
    { category: 'system_design', signal: 'system.product', weight: 2.2, pattern: /\b(whatsapp|instagram|twitter|youtube|uber)\b/i },
    { category: 'system_design', signal: 'system.notification', weight: 3.0, pattern: /\b(notification system|feed system|messaging system|chat system)\b/i },

    { category: 'behavioral', signal: 'behavioral.time_story', weight: 3.5, pattern: /\b(tell me about a time|describe a situation|share an example)\b/i },
    { category: 'behavioral', signal: 'behavioral.prompt', weight: 1.6, pattern: /\b(tell me about (?:a|an))\b/i },
    { category: 'behavioral', signal: 'behavioral.challenge', weight: 2.7, pattern: /\b(challenge|difficult teammate|team conflict|conflict|pressure)\b/i },
    { category: 'behavioral', signal: 'behavioral.failure', weight: 3.7, pattern: /\b(failure at work|failure|mistake|setback)\b/i },
    { category: 'behavioral', signal: 'behavioral.leadership', weight: 3.7, pattern: /\b(leadership example|leadership|mentor(?:ing)?|influence)\b/i },
    { category: 'behavioral', signal: 'behavioral.soft_skills', weight: 2.0, pattern: /\b(feedback|deadline|prioriti[sz]e|collaborat(?:e|ion))\b/i },

    { category: 'resume_jd', signal: 'resume.project', weight: 3.8, pattern: /\b(your project|projects? you worked on|worked on|tell me about your project)\b/i },
    { category: 'resume_jd', signal: 'resume.resume_walkthrough', weight: 4.0, pattern: /\b(walk me through your resume|your resume|resume|background)\b/i },
    { category: 'resume_jd', signal: 'resume.tech_stack', weight: 3.4, pattern: /\b(experience with (?:nodejs|node\.js|react|python|java|go|typescript|javascript|aws|docker|kubernetes))\b/i },
    { category: 'resume_jd', signal: 'resume.role_history', weight: 2.8, pattern: /\b(current role|past role|internship|job description|\bjd\b|tech stack)\b/i },
    { category: 'resume_jd', signal: 'resume.experience', weight: 2.2, pattern: /\b(experience with|background in|what have you worked on)\b/i },
];

const MIN_OVERRIDE_SCORE = 3.5;
const MIN_OVERRIDE_MARGIN = 1.25;
const MIN_LEGACY_CONFIRM_SCORE = 2.5;

function clampConfidence(value: number): number {
    return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}



function scoreQuestion(question: string): Map<ScoredCategory, { score: number; matchedSignals: string[] }> {
    const scores = new Map<ScoredCategory, { score: number; matchedSignals: string[] }>();

    for (const rule of V2_SIGNAL_RULES) {
        if (!rule.pattern.test(question)) {
            continue;
        }

        const entry = scores.get(rule.category) ?? { score: 0, matchedSignals: [] };
        entry.score += rule.weight;
        entry.matchedSignals.push(rule.signal);
        scores.set(rule.category, entry);
    }

    return scores;
}

export function deriveQuestionUnderstandingV2(args: {
    question: string;
    intent: UnifiedActionIntent;
    mode: SessionActionMode;
}): QuestionUnderstandingResult {
    const legacyProfile = getQuestionResponseProfile(args.question, args.mode, args.intent);
    const legacyCategory = profileToCategory(legacyProfile);

    if (args.mode === 'coding' || args.mode === 'system_design' || args.mode === 'behavioral') {
        return {
            category: args.mode,
            confidence: 1,
            matchedSignals: [`mode:${args.mode}`],
            fallbackUsed: false,
        };
    }

    if (args.mode === 'follow_up') {
        return {
            category: 'follow_up',
            confidence: 1,
            matchedSignals: ['mode:follow_up'],
            fallbackUsed: false,
        };
    }

    const normalizedQuestion = normalizeQuestion(args.question);
    const scored = scoreQuestion(normalizedQuestion);
    const ranked = Array.from(scored.entries())
        .map(([category, data]) => ({ category, ...data }))
        .sort((left, right) => right.score - left.score);

    const top = ranked[0];
    const second = ranked[1];

    if (!top) {
        return {
            category: legacyCategory,
            confidence: legacyCategory === 'general' ? 0.5 : 0.7,
            matchedSignals: [],
            fallbackUsed: true,
        };
    }

    const margin = top.score - (second?.score ?? 0);
    const legacyConfirmed = legacyCategory === top.category && top.score >= MIN_LEGACY_CONFIRM_SCORE;
    const shouldOverrideLegacy = top.score >= MIN_OVERRIDE_SCORE && margin >= MIN_OVERRIDE_MARGIN;

    if (!shouldOverrideLegacy && !legacyConfirmed) {
        return {
            category: legacyCategory,
            confidence: legacyCategory === 'general' ? 0.5 : 0.7,
            matchedSignals: top.matchedSignals,
            fallbackUsed: true,
        };
    }

    return {
        category: top.category,
        confidence: clampConfidence(0.55 + (top.score * 0.06) + (margin * 0.05)),
        matchedSignals: top.matchedSignals,
        fallbackUsed: false,
    };
}
