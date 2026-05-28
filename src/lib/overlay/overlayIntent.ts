/**
 * Transcript intent classification for overlay copilot (shared V1/V2).
 * Regex-only — no LLM calls.
 */

export type DetectedQuestionType =
    | 'coding'
    | 'system_design'
    | 'behavioral'
    | 'follow_up'
    | 'salary'
    | 'general';

const REGEX_NORMALIZE_BROKEN = /(\w)\.\s+(\w)/;
const REGEX_NORMALIZE_FILLER = /\b(yeah|um|uh|uh+m|like|so|okay|ok|well|you know|i mean|basically|actually|right)\b/;
const REGEX_NORMALIZE_SPACE = /\s+/;

const REGEX_CODING_CORE = /(write code|write a? ?(?:function|program|method|class|script)|implement|how to code)/;
const REGEX_SYSTEM_DIRECT = /\b(system design|systems design|high[\s-]?level design|\bhld\b|low[\s-]?level design|\blld\b|design (?:a|an|the)\s+(?:system|backend|architecture|platform|service|app|api|database|cache|queue|notification|feed|timeline|search|payments?|booking|ride(?:-|\s)?sharing(?: platform)?|rideshare|url shortener|chat|messaging|social network|streaming|video|marketplace|e ?commerce|storage|distributed system)|(?:design|build|scale|architect)\s+(?:twitter|instagram|uber|netflix|youtube|whatsapp|slack|discord|flipkart|swiggy|zomato|amazon|paytm|upi|google drive|dropbox|stripe)(?:\s+(?:backend|system|architecture|platform|service|app))?|(?:design|build|architect)\s+(?:a |an |the )?(?:hld|lld|high[\s-]?level design|low[\s-]?level design)\s+(?:for|of)\s+(?:twitter|instagram|uber|netflix|youtube|whatsapp|slack|discord|flipkart|swiggy|zomato|amazon|paytm|upi|google drive|dropbox|stripe|system|backend|platform|service|app)|redesign (?:the )?(?:backend|system|architecture|platform|service|app)|architecture of (?:the )?(?:system|backend|platform|service|app|database)|build(?:ing)? (?:a|an|the)\s+(?:platform|system|backend|service|app|api|database|cache|queue|notification|feed|timeline|search|payments?|booking|ride(?:-|\s)?sharing(?: platform)?|rideshare|url shortener|chat|messaging|social network))\b/;
const REGEX_SYSTEM_REAL_WORLD_DIRECT = /\b(?:design|build|architect|scale|create)\s+(?:a |an |the )?(?:(?:hld|lld|llf|high[\s-]?level design|low[\s-]?level design)\s+(?:for|of)\s+)?(?:flipkart|shopify|amazon|ecommerce|e-commerce|marketplace|cart|checkout|payment gateway|payments?|wallet|upi|paytm|stripe|whatsapp|chat|messaging|real[\s-]?time chat|live chat|notification(?: system| service)?|news feed|feed system|timeline|instagram|twitter|x app|youtube|netflix|video streaming|streaming platform|uber|lyft|ride booking|ride sharing|rideshare|food delivery|swiggy|zomato|doordash|booking|ticket booking|ticketmaster|airbnb|hotel booking|search engine|recommendation(?: system)?|url shortener|rate limiter|web crawler|file storage|dropbox|google drive|google docs|collaborative editor|slack|discord)(?:\s+(?:backend|system|architecture|platform|service|app|hld|lld))?\b/;
const REGEX_SYSTEM_ARCH = /\b(backend|front ?end|service|services|distributed|microservice|api gateway|gateway|queue|message queue|event[-\s]?driven|cache|caching|redis|kafka|database|db|storage|partition|replication|shard(?:ing)?|load balanc(?:er|ing)|cdn|edge|availability|consistency|latency|throughput|qps|rps|slo|sla|index(?:es)?|read write|read\/write|pipeline|worker|job queue|cron|batch|stream(?:ing)?|pub ?sub|pubsub)\b/;
const REGEX_SYSTEM_SCALE = /\b(scale|scaling|scalable|millions?(?: of)? users?|billions?(?: of)? users?|100m users?|10m users?|users? at scale|traffic|spike|spikes|burst|high traffic|peak traffic|performance|bottleneck|concurren|throughput|latency|qps|rps|requests per second|low latency|high throughput|capacity|growth|high load|load spike|load test|sudden(?:ly)? (?:spike|traffic|load)|traffic surge|surge|fault toleran|redundan|high availability|\bha\b|\d+\s*(?:k|m|b|thousand|million|billion))\b/;
const REGEX_SYSTEM_FRAMING = /\b(suppose|imagine|let s say|lets say|what if|consider|assume|scenario|in production|real[-\s]?world|in the real world|if suddenly|suddenly|at scale|in practice|what would happen|what happens|how would(?: you| we| this| the system)?|walk me through (?:the )?(?:architecture|system|backend|design)|talk through (?:the )?(?:architecture|system|backend|design))\b/;
const REGEX_SYSTEM_REASONING = /\b(tradeoff|trade-?off|pros? and cons|optimiz|handle|redesign|architecture|improv|fail(?:ed|ure|s)?|failure|fallback|retry|retries|recover|recovery|failover|avoid downtime|downtime|single point of failure|consistency|availability|durability|reliability|fault toleran|resilien|degrad|graceful|circuit breaker|rate limit|idempotent|backoff|queueing|bottleneck)\b/;
const REGEX_NON_SYSTEM_DESIGN = /\b(singleton|factory|observer|strategy|decorator|adapter|prototype|builder|solid|oop|object oriented|design patterns?|class diagram|uml|inheritance|polymorphism|encapsulation|bfs|dfs|binary tree|tree traversal|traversal|dynamic programming|dp\b|algorithm|leetcode|database normalization|normalization|normal forms?|1nf|2nf|3nf)\b/;
const REGEX_BEHAVIORAL_CORE = /(tell me about a time|describe a situation|give me an example|share an experience|tell me about yourself|introduce yourself|walk me through (?:your )?(?:background|resume)|background|resume|personal experience|worked on|built|developed|impact|result|outcome)/;
const REGEX_CODING_STRONG = /(algorithm|debug this|snippet|boilerplate|optimize|refactor|array|linked list|tree|graph|stack|queue|hash ?map|binary search|dynamic programming|recursion|time complexity|space complexity)/;
const REGEX_BEHAVIORAL_STRONG = /(when have you|biggest challenge|how did you handle|conflict with|leadership|teamwork|failure|mistake|difficult decision|star method|tell me about|tell me about yourself|experience|challenge|conflict|pressure|strength|strengths|weakness|weaknesses|mentor|disagree|feedback|prioriti[zs]e|deadline|collaborate|accomplishment|introduce yourself|background|resume|project|projects|worked on|built|developed|owned|ownership|impact|result|results|outcome|outcomes|personal)/;
const REGEX_FOLLOW_UP_CORE = /(what happened next|then what|and after that|what.s next|how did that go|can you elaborate|tell me more|go deeper|expand on)/;
const REGEX_FOLLOW_UP_STRONG = /(follow.?up|continuation|building on|going back to|earlier you said|you mentioned)/;
const REGEX_CODING_BOOST = /(faster|efficient)/;
const REGEX_GENERAL_CORE = /(\bweather\b|\bforecast\b|\btime\b|\bdate\b|\bnews\b|\bcompany\b|\bproduct\b|\broadmap\b|\bstrategy\b|\bbusiness\b|\bmarket\b|\bindustry\b|\bcustomer\b|\bfeature\b|\bpolicy\b|\bprocess\b|\bmission\b|\bvision\b|\bgoal\b|\boverview\b|\bsummary\b)/;
const REGEX_GENERAL_STRONG = /(\bwhat(?:'s| is) the weather\b|\bcurrent time\b|\bwhat(?:'s| is) the date\b|\bproduct roadmap\b|\bcompany strategy\b|\bbusiness model\b|\bmarket size\b)/;

const REGEX_SALARY_CORE = /(\bsalary\b|\bcompensation\b|\btotal\s*comp|\bnegotiat|\bctc\b|\bin[\s-]?hand\b|\blpa\b|\blakhs?\b|\bcrores?\b|\bper\s*annum|\btake\s*home|\bgross\s*(?:salary|pay|income)|\bnet\s*(?:salary|pay|income)|\bhike\b|\bincrement\b|\bappraisal\b)/;
const REGEX_SALARY_STRONG = /(\bpackage\b|\boffer\b|\bpay\s*(?:expect|scale|band|range|grade)|\bexpect.*(?:salary|pay|comp|ctc|lpa)|\bcurrent.*(?:salary|ctc|comp|lpa|package)|\bexpected.*(?:salary|ctc|comp|lpa|package)|\bhow much.*(?:pay|earn|make|want|expect|offer)|\bwhat.*(?:pay|earning|making|expect|offer)|\bcounter\s*offer|\bbase\s*(?:pay|salary)|\bstock\s*option|\bequity|\bsigning\s*bonus|\brsu|\bvesting|\bjoining\s*bonus|\bretention\s*bonus|\bvariable\s*(?:pay|comp)|\bfixed\s*(?:pay|comp)|\bnotice\s*period|\bbuyout|\brelocation|\bperks|\bbenefits|\bgratuity|\bprovident\s*fund|\bpf\b|\beps\b|\bhra\b)/;
const REGEX_SALARY_LOOSE = /(salary|compensation|comp|negotiate|negotiation|offer|package|pay|ctc|counter|bonus|equity|stock|vesting|raise|increment|hike|band|range|market rate|lpa|lakhs?|crores?|per annum|take home|gross|net|appraisal|promotion|onsite|offshore|billing|cost to company|hand salary|annual|monthly|stipend|allowance|reimbursement|insurance|medical|gratuity|notice period|buyout|retention|joining bonus|variable|fixed|base pay|relocation|perks|benefits|expected|current|offered|revised|breakup|structure|component|deduction)/;
const REGEX_SALARY_BOOST = /(money|paying|afford|expensive|budget|worth|value|deserve|fair|reasonable|competitive|market|industry|standard|benchmark|average|median|percentile)/;

/** Loose STT-friendly signals — one hit is enough to nudge classification. */
const REGEX_CODING_LOOSE = /(write code|coding question|data struct|hash ?map|binary|recursion|iterate|loop|array|string|sort|search|tree|graph|stack|queue|leetcode|big o|runtime|implement|algorithm|solve)/;
const REGEX_BEHAVIORAL_LOOSE = /(tell me about|your experience|a time when|situation|on your team|leadership|conflict|challenge|project|worked on|background|resume|impact|outcome|failure|mistake|collaborat|deadline|priorit|why should we|why do you want|where do you see|what motivates|what drives|strengths?|weakness|hobbies|interests|culture|values|team|manager|supervisor|company|organization|role|position|opportunity|growth|career|passion|personality|work.?life|balance|remote|hybrid|flexible|environment)/;
const REGEX_FOLLOW_UP_LOOSE = /(follow up|go deeper|more detail|elaborate|expand on|what about|you mentioned|earlier you|continue from|clarify that|repeat that)/;
const REGEX_GENERAL_LOOSE = /(weather|forecast|today|tomorrow|time|date|news|company|product|roadmap|strategy|business|market|industry|customer|feature|policy|process|overview|summary)/;


/** Classification tuned for messy live speech — prefer catching intent over precision. */
const MIN_PRIMARY_SCORE = 2;
const SWITCH_THRESHOLD = 2;
const STRONG_SIGNAL_SCORE = 3;
const SYSTEM_SIGNAL_MIN_BUCKETS = 2;
const SYSTEM_SIGNAL_MIN_SCORE = 3;
const SYSTEM_FAST_SWITCH_SCORE = 5;

type SystemSignalScore = {
    score: number;
    bucketHits: number;
    strong: boolean;
    directHits: number;
    archHits: number;
    scaleHits: number;
    framingHits: number;
    reasoningHits: number;
};

export function normalizeTranscript(text: string): string {
    let t = text.toLowerCase();
    t = t.replace(new RegExp(REGEX_NORMALIZE_BROKEN.source, 'g'), '$1$2');
    t = t
        .replace(/\bllf\b/g, 'lld')
        .replace(/\bflip\s*krat\b|\bflipcart\b|\bfilpkart\b|\bflipkartt\b/g, 'flipkart')
        .replace(/\bwhat\s*s?app\b|\bwatsapp\b|\bwhatsap\b/g, 'whatsapp')
        .replace(/\binsta\s*gram\b|\binstgram\b/g, 'instagram')
        .replace(/\bnetflx\b|\bnetflex\b/g, 'netflix')
        .replace(/\byoutub\b/g, 'youtube')
        .replace(/\bswigy\b/g, 'swiggy')
        .replace(/\bzomatto\b/g, 'zomato')
        .replace(/\breal time\b/g, 'real-time');
    t = t.replace(/[\u201C\u201D\u2018\u2019]/g, '"');
    t = t.replace(/[\u2013\u2014]/g, '-');
    t = t.replace(/[^a-z0-9\s\-?:/]/g, ' ');
    t = t.replace(new RegExp(REGEX_NORMALIZE_FILLER.source, 'gi'), ' ');
    t = t.replace(new RegExp(REGEX_NORMALIZE_SPACE.source, 'g'), ' ').trim();
    return t;
}

function scoreSystemDesignSignals(cap: (regex: RegExp) => number): SystemSignalScore {
    const directHits = cap(REGEX_SYSTEM_DIRECT) + cap(REGEX_SYSTEM_REAL_WORLD_DIRECT);
    const archHits = cap(REGEX_SYSTEM_ARCH);
    const scaleHits = cap(REGEX_SYSTEM_SCALE);
    const framingHits = cap(REGEX_SYSTEM_FRAMING);
    const reasoningHits = cap(REGEX_SYSTEM_REASONING);

    const bucketHits = [directHits, archHits, scaleHits, framingHits, reasoningHits].filter((v) => v > 0).length;
    const score =
        directHits * 4
        + archHits * 2
        + scaleHits * 2
        + reasoningHits * 1.5
        + framingHits;
    const strong =
        directHits > 0
        || (archHits > 0 && scaleHits > 0 && reasoningHits > 0)
        || (archHits >= 2 && (framingHits > 0 || reasoningHits > 0))
        || (archHits > 0 && reasoningHits >= 2);

    return {
        score,
        bucketHits,
        strong,
        directHits,
        archHits,
        scaleHits,
        framingHits,
        reasoningHits,
    };
}

export function isSalaryRelatedText(text: string): boolean {
    const normalized = normalizeTranscript(text);
    if (!normalized || normalized.length < 5) return false;
    return (
        REGEX_SALARY_CORE.test(normalized)
        || REGEX_SALARY_STRONG.test(normalized)
        || REGEX_SALARY_LOOSE.test(normalized)
    );
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
        salary: 0,
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
    scores.behavioral += cap(REGEX_BEHAVIORAL_CORE) * 3;
    scores.coding += cap(REGEX_CODING_STRONG) * 2;
    scores.behavioral += cap(REGEX_BEHAVIORAL_STRONG) * 2;
    scores.coding += cap(REGEX_CODING_BOOST);
    scores.general += cap(REGEX_GENERAL_CORE) * 2;
    scores.general += cap(REGEX_GENERAL_STRONG) * 3;
    scores.follow_up += cap(REGEX_FOLLOW_UP_CORE) * 3;
    scores.follow_up += cap(REGEX_FOLLOW_UP_STRONG) * 2;
    scores.salary += cap(REGEX_SALARY_CORE) * 3;
    scores.salary += cap(REGEX_SALARY_STRONG) * 2;
    scores.salary += cap(REGEX_SALARY_BOOST);

    if (REGEX_CODING_LOOSE.test(t)) scores.coding += 2;
    if (REGEX_BEHAVIORAL_LOOSE.test(t)) scores.behavioral += 2;
    if (REGEX_FOLLOW_UP_LOOSE.test(t)) scores.follow_up += 2;
    if (REGEX_SALARY_LOOSE.test(t)) scores.salary += 2;
    if (REGEX_GENERAL_LOOSE.test(t)) scores.general += 2;

    const systemSignals = scoreSystemDesignSignals(cap);
    const systemSignalDensity =
        systemSignals.directHits
        + systemSignals.archHits
        + systemSignals.scaleHits
        + systemSignals.framingHits
        + systemSignals.reasoningHits;
    const meetsSystemGate =
        systemSignals.strong
        || systemSignals.bucketHits >= SYSTEM_SIGNAL_MIN_BUCKETS
        || (systemSignalDensity >= 3 && (systemSignals.archHits > 0 || systemSignals.scaleHits > 0));
    if (meetsSystemGate && systemSignals.score >= SYSTEM_SIGNAL_MIN_SCORE) {
        scores.system_design += systemSignals.score;
    } else {
        scores.system_design += Math.min(systemSignals.score, 0.5);
    }

    const hasNonSystemDesignSignal = REGEX_NON_SYSTEM_DESIGN.test(t);
    if (
        hasNonSystemDesignSignal
        && systemSignals.directHits === 0
        && systemSignals.scaleHits === 0
        && systemSignals.reasoningHits === 0
    ) {
        scores.system_design = 0;
    } else if (hasNonSystemDesignSignal && !systemSignals.strong && systemSignals.bucketHits < SYSTEM_SIGNAL_MIN_BUCKETS) {
        scores.system_design = Math.max(0, scores.system_design - 2);
    }

    const wordCount = t.split(/\s+/).filter((w: string) => w.length > 0).length;
    if (scores.general >= scores.follow_up && wordCount <= 8 && wordCount >= 2) {
        scores.follow_up = Math.max(scores.follow_up, 2);
    }

    const rawScores = { ...scores };

    if (currentType !== 'general') {
        scores[currentType] += 0.5;
    }

    const entries = (Object.entries(scores) as [DetectedQuestionType, number][])
        .sort((a, b) => b[1] - a[1]);

    const [primary, primaryScore] = entries[0];
    const [, secondScore] = entries[1] || [null, 0];

    if (primaryScore < MIN_PRIMARY_SCORE) {
        return { nextType: 'general' };
    }

    const nextStrong =
        primary !== 'general' && primaryScore >= STRONG_SIGNAL_SCORE
            ? primary
            : undefined;
    const hasCurrentDirectSignal =
        currentType !== 'general' && rawScores[currentType] > 0;
    const isOnlyPersistenceKeepingCurrent =
        currentType !== 'general'
        && !hasCurrentDirectSignal
        && scores[currentType] <= 0.5;

    if (primary === 'general' && (rawScores.general >= MIN_PRIMARY_SCORE || isOnlyPersistenceKeepingCurrent)) {
        return { nextType: 'general' };
    }

    if (
        primary !== currentType
        && primary === 'system_design'
        && rawScores.system_design >= SYSTEM_FAST_SWITCH_SCORE
    ) {
        return { nextType: 'system_design', nextStrong };
    }

    if (primary !== currentType && currentType !== 'general' && (primaryScore - secondScore) < SWITCH_THRESHOLD) {
        if (
            isOnlyPersistenceKeepingCurrent
            && primary !== 'coding'
            && primary !== 'system_design'
            && primary !== 'behavioral'
            && primary !== 'salary'
        ) {
            return { nextType: 'general' };
        }
        // Hysteresis: only switch if the primary intent beats the secondary cleanly
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
            if (!action.combinedText || action.combinedText.length < 5) return state;

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
