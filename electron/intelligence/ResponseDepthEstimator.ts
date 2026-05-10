import type { SessionActionMode, UnifiedActionIntent } from '../ActionContextBuilder';
import type { QuestionUnderstandingResult } from './QuestionUnderstandingV2';
import type { QuestionCategory, ResponseDepth } from './types';
import { normalizeQuestion } from './utils';

interface DepthRule {
    depth: ResponseDepth;
    signal: string;
    weight: number;
    pattern: RegExp;
}

export interface ResponseDepthEstimate {
    depth: ResponseDepth;
    confidence: number;
    matchedSignals: string[];
    reasoning: string;
}

const DEPTH_RULES: DepthRule[] = [
    { depth: 'short', signal: 'short.definition', weight: 3.5, pattern: /^(what is|what's|define)\b/i },
    { depth: 'short', signal: 'short.quick_explain', weight: 2.0, pattern: /^(who is|when is|where is)\b/i },
    { depth: 'short', signal: 'short.quick_question', weight: 1.8, pattern: /^\w+(?:\s+\w+){0,3}\??$/i },

    { depth: 'medium', signal: 'medium.explain', weight: 2.6, pattern: /\b(explain|jwt authentication|authentication|walk me through|compare|versus|vs)\b/i },
    { depth: 'medium', signal: 'medium.coding_reasoning', weight: 2.3, pattern: /\b(optimi[sz]e|debug|fix|bug|binary search|spiral matrix|complexity)\b/i },
    { depth: 'medium', signal: 'medium.how_why', weight: 1.8, pattern: /\b(how|why)\b/i },

    { depth: 'deep', signal: 'deep.design', weight: 3.8, pattern: /\b(design|architecture|system design)\b/i },
    { depth: 'deep', signal: 'deep.scale', weight: 3.0, pattern: /\b(scale|scalable|scaling|millions of users|distributed|tradeoffs?)\b/i },
    { depth: 'deep', signal: 'deep.open_ended', weight: 2.8, pattern: /^(how would you|walk me through|design)\b/i },
    { depth: 'deep', signal: 'deep.large_system', weight: 3.2, pattern: /\b(instagram|whatsapp|notification system|failure handling|load balancing|database|cache)\b/i },
];

function clampConfidence(value: number): number {
    return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}



function initializeScores(category: QuestionCategory): Record<ResponseDepth, { score: number; matchedSignals: string[] }> {
    const base = {
        short: { score: 0, matchedSignals: [] as string[] },
        medium: { score: 0, matchedSignals: [] as string[] },
        deep: { score: 0, matchedSignals: [] as string[] },
    };

    switch (category) {
        case 'coding':
            base.medium.score += 2.2;
            base.medium.matchedSignals.push('prior:coding_medium');
            break;
        case 'behavioral':
            base.medium.score += 2.4;
            base.medium.matchedSignals.push('prior:behavioral_medium');
            break;
        case 'resume_jd':
            base.medium.score += 2.4;
            base.medium.matchedSignals.push('prior:resume_medium');
            break;
        case 'system_design':
            base.deep.score += 2.8;
            base.deep.matchedSignals.push('prior:system_design_deep');
            base.medium.score += 1.4;
            break;
        case 'follow_up':
            base.medium.score += 1.8;
            base.medium.matchedSignals.push('prior:follow_up_medium');
            break;
        case 'clarification':
            base.short.score += 2.8;
            base.short.matchedSignals.push('prior:clarification_short');
            break;
        case 'general':
        default:
            base.short.score += 1.2;
            base.medium.score += 1.0;
            break;
    }

    return base;
}

export function estimateResponseDepth(args: {
    question: string;
    category: QuestionCategory;
    sessionMode: SessionActionMode;
    intent: UnifiedActionIntent;
    questionUnderstandingResult: QuestionUnderstandingResult;
}): ResponseDepthEstimate {
    const normalizedQuestion = normalizeQuestion(args.question);
    const scores = initializeScores(args.category);

    for (const rule of DEPTH_RULES) {
        if (!rule.pattern.test(normalizedQuestion)) {
            continue;
        }

        scores[rule.depth].score += rule.weight;
        scores[rule.depth].matchedSignals.push(rule.signal);
    }

    if (args.questionUnderstandingResult.matchedSignals.some((signal) => signal.startsWith('system.'))) {
        scores.deep.score += 1.2;
        scores.deep.matchedSignals.push('semantic:system_signals');
    }

    if (args.questionUnderstandingResult.matchedSignals.some((signal) => signal.startsWith('coding.'))) {
        scores.medium.score += 1.0;
        scores.medium.matchedSignals.push('semantic:coding_signals');
        if (args.questionUnderstandingResult.matchedSignals.some((signal) => /optimize|complexity|bugfix/.test(signal))) {
            scores.deep.score += 0.8;
            scores.deep.matchedSignals.push('semantic:coding_complexity');
        }
    }

    if (args.questionUnderstandingResult.matchedSignals.some((signal) => signal.startsWith('behavioral.'))) {
        scores.medium.score += 0.8;
        scores.medium.matchedSignals.push('semantic:behavioral_signals');
    }

    if (args.intent === 'system_design_tradeoffs') {
        scores.deep.score += 2.2;
        scores.deep.matchedSignals.push('intent:system_design_tradeoffs');
    }

    if (args.intent === 'clarify' || args.intent === 'follow_up_questions') {
        scores.short.score += 2.5;
        scores.short.matchedSignals.push(`intent:${args.intent}`);
    }

    const ranked = Object.entries(scores)
        .map(([depth, data]) => ({ depth: depth as ResponseDepth, ...data }))
        .sort((left, right) => right.score - left.score);

    const top = ranked[0];
    const second = ranked[1];
    const margin = top.score - (second?.score ?? 0);

    const depth = top.depth;
    const confidence = clampConfidence(0.45 + (Math.min(top.score, 8) * 0.05) + (Math.min(margin, 4) * 0.06));
    const reasoning = `Selected ${depth} depth from category=${args.category}, topScore=${top.score.toFixed(2)}, margin=${margin.toFixed(2)}`;

    return {
        depth,
        confidence,
        matchedSignals: top.matchedSignals,
        reasoning,
    };
}
