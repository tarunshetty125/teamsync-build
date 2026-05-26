/**
 * Transcript intent classification for overlay copilot (shared V1/V2).
 * Regex-only — no LLM calls.
 */

export type DetectedQuestionType =
    | 'coding'
    | 'system_design'
    | 'behavioral'
    | 'follow_up'
    | 'general';

const REGEX_NORMALIZE_BROKEN = /(\w)\.\s+(\w)/;
const REGEX_NORMALIZE_FILLER = /\b(yeah|um|uh|uh+m|like|so|okay|ok|well|you know|i mean|basically|actually|right)\b/;
const REGEX_NORMALIZE_SPACE = /\s+/;

const REGEX_CODING_CORE = /(write code|write a? ?(?:function|program|method|class|script)|implement|how to code)/;
const REGEX_SYSTEM_CORE = /(system design|design a|architecture|database schema|api design)/;
const REGEX_BEHAVIORAL_CORE = /(tell me about a time|describe a situation|give me an example|share an experience|tell me about yourself|introduce yourself|walk me through (?:your )?(?:background|resume)|background|resume|personal experience|worked on|built|developed|impact|result|outcome)/;
const REGEX_CODING_STRONG = /(algorithm|debug this|snippet|boilerplate|optimize|refactor|array|linked list|tree|graph|stack|queue|hash ?map|binary search|dynamic programming|recursion|time complexity|space complexity)/;
const REGEX_SYSTEM_STRONG = /(scalab|microservice|load balanc|distributed|high availability|caching strategy|caching|cache|cdn|message queue|rate limit|sharding|replication|partition|cap theorem|event driven|monolith|horizontal scal|fault toleran|throughput|latency|handle more users|high traffic|load)/;
const REGEX_BEHAVIORAL_STRONG = /(when have you|biggest challenge|how did you handle|conflict with|leadership|teamwork|failure|mistake|difficult decision|star method|tell me about|tell me about yourself|experience|challenge|conflict|pressure|strength|strengths|weakness|weaknesses|mentor|disagree|feedback|prioriti[zs]e|deadline|collaborate|accomplishment|introduce yourself|background|resume|project|projects|worked on|built|developed|owned|ownership|impact|result|results|outcome|outcomes|personal)/;
const REGEX_FOLLOW_UP_CORE = /(what happened next|then what|and after that|what.s next|how did that go|can you elaborate|tell me more|go deeper|expand on)/;
const REGEX_FOLLOW_UP_STRONG = /(follow.?up|continuation|building on|going back to|earlier you said|you mentioned)/;
const REGEX_CODING_BOOST = /(faster|efficient)/;
const REGEX_SYSTEM_BOOST = /(tradeoff|trade-off|pros? and cons|downsides|advantages|disadvantages)/;

/** Loose STT-friendly signals — one hit is enough to nudge classification. */
const REGEX_CODING_LOOSE = /(write code|coding question|data struct|hash ?map|binary|recursion|iterate|loop|array|string|sort|search|tree|graph|stack|queue|leetcode|big o|runtime|implement|algorithm|solve)/;
const REGEX_SYSTEM_LOOSE = /(system design|design (?:this|a|the)|architect|scal(e|ing|ability)|microservice|database|api|backend|frontend|storage|traffic|users|requests|shard|replicat|cache|cdn|queue|load|latency|throughput|high availability|distributed|monolith)/;
const REGEX_BEHAVIORAL_LOOSE = /(tell me about|your experience|a time when|situation|on your team|leadership|conflict|challenge|project|worked on|background|resume|impact|outcome|failure|mistake|collaborat|deadline|priorit)/;
const REGEX_FOLLOW_UP_LOOSE = /(follow up|go deeper|more detail|elaborate|expand on|what about|you mentioned|earlier you|continue from|clarify that|repeat that)/;

/** Classification tuned for messy live speech — prefer catching intent over precision. */
const MIN_PRIMARY_SCORE = 1;
const SWITCH_THRESHOLD = 1;
const STRONG_SIGNAL_SCORE = 2;

export function normalizeTranscript(text: string): string {
    let t = text.toLowerCase();
    t = t.replace(new RegExp(REGEX_NORMALIZE_BROKEN.source, 'g'), '$1$2');
    t = t.replace(/[\u201C\u201D\u2018\u2019]/g, '"');
    t = t.replace(/[\u2013\u2014]/g, '-');
    t = t.replace(/[^a-z0-9\s\-?:/]/g, ' ');
    t = t.replace(new RegExp(REGEX_NORMALIZE_FILLER.source, 'gi'), ' ');
    t = t.replace(new RegExp(REGEX_NORMALIZE_SPACE.source, 'g'), ' ').trim();
    return t;
}

export function detectQuestionType(
    text: string,
    currentType: DetectedQuestionType,
    _lastStrongType: DetectedQuestionType,
): { nextType: DetectedQuestionType; nextStrong?: DetectedQuestionType } {
    if (/tell me about yourself|introduce yourself/i.test(text)) {
        return { nextType: 'behavioral', nextStrong: 'behavioral' };
    }

    const t = normalizeTranscript(text);
    const scores: Record<DetectedQuestionType, number> = {
        coding: 0,
        system_design: 0,
        behavioral: 0,
        follow_up: 0,
        general: 0,
    };

    const cap = (regex: RegExp) => {
        let count = 0;
        for (const _ of t.matchAll(new RegExp(regex.source, 'gi'))) {
            if (++count >= 3) break;
        }
        return count;
    };

    scores.coding += cap(REGEX_CODING_CORE) * 3;
    scores.system_design += cap(REGEX_SYSTEM_CORE) * 3;
    scores.behavioral += cap(REGEX_BEHAVIORAL_CORE) * 3;
    scores.coding += cap(REGEX_CODING_STRONG) * 2;
    scores.system_design += cap(REGEX_SYSTEM_STRONG) * 2;
    scores.behavioral += cap(REGEX_BEHAVIORAL_STRONG) * 2;
    scores.coding += cap(REGEX_CODING_BOOST);
    scores.system_design += cap(REGEX_SYSTEM_BOOST);
    scores.follow_up += cap(REGEX_FOLLOW_UP_CORE) * 3;
    scores.follow_up += cap(REGEX_FOLLOW_UP_STRONG) * 2;

    if (REGEX_CODING_LOOSE.test(t)) scores.coding += 2;
    if (REGEX_SYSTEM_LOOSE.test(t)) scores.system_design += 2;
    if (REGEX_BEHAVIORAL_LOOSE.test(t)) scores.behavioral += 2;
    if (REGEX_FOLLOW_UP_LOOSE.test(t)) scores.follow_up += 2;

    const wordCount = t.split(/\s+/).filter((w: string) => w.length > 0).length;
    if (scores.general >= scores.follow_up && wordCount <= 12 && wordCount >= 2) {
        scores.follow_up = Math.max(scores.follow_up, 2);
    }

    if (currentType !== 'general') {
        scores[currentType] += 1;
    }

    const entries = (Object.entries(scores) as [DetectedQuestionType, number][])
        .filter(([type]) => type !== 'general')
        .sort((a, b) => b[1] - a[1]);

    const [primary, primaryScore] = entries[0];
    const [, secondScore] = entries[1] || [null, 0];

    if (primaryScore < MIN_PRIMARY_SCORE) {
        return { nextType: 'general' };
    }

    const nextStrong = primaryScore >= STRONG_SIGNAL_SCORE ? primary : undefined;
    if (primary !== currentType && currentType !== 'general' && (primaryScore - secondScore) < SWITCH_THRESHOLD) {
        return { nextType: currentType, nextStrong };
    }

    return { nextType: primary, nextStrong };
}

export type IntentState = {
    detectedType: DetectedQuestionType;
    lastStrongType: DetectedQuestionType;
    lastStrongAt: number;
    seq: number;
};

export type IntentAction =
    | { type: 'EVALUATE'; combinedText: string; now: number; seq: number }
    | { type: 'RESET' };

export function intentReducer(state: IntentState, action: IntentAction): IntentState {
    switch (action.type) {
        case 'RESET':
            return {
                detectedType: 'general',
                lastStrongType: 'general',
                lastStrongAt: 0,
                seq: 0,
            };

        case 'EVALUATE': {
            if (action.seq < state.seq) return state;
            if (!action.combinedText || action.combinedText.length < 3) return state;

            const { nextType, nextStrong } = detectQuestionType(
                action.combinedText,
                state.detectedType,
                state.lastStrongType,
            );

            let newLastStrongType = nextStrong ?? state.lastStrongType;
            let newLastStrongAt = nextStrong ? action.now : state.lastStrongAt;

            if (!nextStrong) {
                const elapsed = action.now - state.lastStrongAt;
                if (elapsed > 6000 && state.lastStrongType !== 'general') {
                    newLastStrongType = 'general';
                }
            }

            if (
                state.detectedType === nextType &&
                state.lastStrongType === newLastStrongType &&
                state.lastStrongAt === newLastStrongAt
            ) {
                return { ...state, seq: action.seq };
            }

            return {
                detectedType: nextType,
                lastStrongType: newLastStrongType,
                lastStrongAt: newLastStrongAt,
                seq: action.seq,
            };
        }

        default:
            return state;
    }
}
