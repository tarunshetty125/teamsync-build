/**
 * Transcript intent classification for overlay copilot (shared V1/V2).
 * Regex-only — no LLM calls.
 */

import { normalizeSystemDesignEntityTypos } from './systemDesignEntityNormalizer.ts';

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

const CODING_LANGUAGE_PATTERN = '(?:c|cpp|c\\+\\+|c#|csharp|c\\s*sharp|java|python|py|javascript|java\\s*script|js|typescript|type\\s*script|ts|node(?:\\.js)?|node\\s*js|nodejs|go|golang|go\\s+lang|rust|ruby|kotlin|swift|scala|php|dart|r|matlab|sql|mysql|postgres|bash|shell|sh|powershell)';
const CODING_PLATFORM_PATTERN = '(?:leetcode|leet\\s*code|hackerrank|hacker\\s*rank|codeforces|code\\s*forces|codechef|code\\s*chef|atcoder|at\\s*coder|geeksforgeeks|geeks\\s*for\\s*geeks|gfg|interviewbit|interview\\s*bit|hacker\\s*earth|hackerearth|codewars|topcoder|top\\s*coder|neetcode|neet\\s*code)';
const CODING_DSA_TOPIC_PATTERN = '(?:arrays?|strings?|hash(?:ing|map|set)|hash\\s*(?:map|set)|two pointers?|sliding window|prefix sums?|sorting|greedy(?: algorithms?)?|recursion|backtracking|linked lists?|stacks?|queues?|monotonic stacks?|monotonic queues?|binary search|trees?|binary trees?|binary search trees?|\\bbst\\b|heaps?|priority queues?|tries?|graphs?|\\bbfs\\b|breadth first search|\\bdfs\\b|depth first search|topological sort|union find|disjoint set|\\bdsu\\b|shortest path(?: algorithms?)?|minimum spanning tree|\\bmst\\b|dynamic programming|\\bdp\\b|1d dynamic programming|2d dynamic programming|knapsack(?: dp)?|interval dp|bit manipulation|bitmasking|math|number theory|matrix|grid problems?|geometry|segment trees?|fenwick trees?|binary indexed trees?|\\bbit\\b|memoization|divide and conquer|simulation|string matching(?: algorithms?)?|game theory|reservoir sampling|randomized algorithms?|line sweep|computational geometry|coding design problems?|design (?:lru|lfu|hashmap|hash map|hashset|hash set|browser history|twitter|parking lot|snake game|file system))';
const CODING_INTERVIEW_VERB_PATTERN = '(?:can you|could you|please|now|next|let us|lets|let\\s*s|i want you to|we need to|you need to|try to|start|begin|go ahead and)?\\s*(?:write|code|implement|solve|program|complete|fill|debug|dry run|trace|optimize|return|print|find|calculate|compute|check|validate)';
const CODING_NAMED_PROBLEM_PATTERN = '(?:n\\s*queens?|queen(?:s)? problem|sudoku solver|rat in (?:a )?maze|word ladder|word break|word search|alien dictionary|course schedule|clone graph|number of islands?|rotting oranges?|surrounded regions|pacific atlantic|trapping rain water|container with most water|largest rectangle|daily temperatures|next greater element|stock span|lru cache|lfu cache|min stack|median finder|serialize deserialize|lowest common ancestor|diameter of binary tree|balanced binary tree|invert binary tree|kth largest|top k frequent|merge intervals|meeting rooms?|insert interval|coin change|house robber|climbing stairs|edit distance|longest common subsequence|longest increasing subsequence|maximum subarray|kadane|knapsack|partition equal subset|minimum window substring|longest substring|group anagrams|valid anagram|valid palindrome|permutations?|combinations?|subsets?|letter combinations|generate parentheses|combination sum|phone keypad|spiral matrix|set matrix zero(?:es)?|rotate image|search in rotated sorted array|find peak element|koko eating bananas|aggressive cows|painters partition|book allocation|wood cutting|minimize maximum|capacity to ship|gas station|jump game|merge k sorted lists?|reverse nodes? in k group|add two numbers|remove nth node|detect cycle|linked list cycle|reorder list|copy list with random pointer|sliding window maximum|minimum path sum|unique paths?|decode ways|regex matching|wildcard matching|kmp|rabin karp|z algorithm|dijkstra|bellman ford|floyd warshall|kruskal|prim(?:s)?|topological sort|union find|disjoint set|bipartite graph)';
const CODING_PROBLEM_TERM_PATTERN = `(?:${CODING_NAMED_PROBLEM_PATTERN}|${CODING_DSA_TOPIC_PATTERN}|two sum|valid parentheses?|merge sort|quick sort|heap sort|bubble sort|insertion sort|binary search|linked list|binary tree|tree traversal|graph traversal|sliding window|two pointers?|hash ?map|stack|queue|heap|trie|array|matrix|grid|string|substring|subarray|subsequence|palindrome|anagram|permutation|combination|duplicate|duplicates|fibonacci|factorial|prime|islands?|intervals?|rotated sorted|kth|median|longest|shortest|minimum|maximum|sum|product)`;
const REGEX_CODING_CORE = new RegExp(`(write (?:me\\s+)?(?:code|a? ?(?:function|program|method|class|script|solution)|the code)|give me (?:code|a solution|the solution|${CODING_LANGUAGE_PATTERN}\\s+solution)|create (?:a\\s+)?(?:function|program|method|class|script|solution)|implement|how to code|\\bdsa\\b|data structures? and algorithms?)`);
const REGEX_CODING_INTERVIEW_PHRASE = new RegExp(`\\b(?:${CODING_INTERVIEW_VERB_PATTERN})(?:\\s+(?:a|an|the|this|that|me|one|program|function|method|class|solution|code|logic|algorithm))*\\s+(?:${CODING_PROBLEM_TERM_PATTERN}|(?:in|using|with|for)\\s+${CODING_LANGUAGE_PATTERN}|${CODING_PLATFORM_PATTERN})\\b`);
const REGEX_CODING_NAMED_PROBLEM = new RegExp(`\\b${CODING_NAMED_PROBLEM_PATTERN}\\b`);
const REGEX_CODING_DSA_TOPIC = new RegExp(`\\b${CODING_DSA_TOPIC_PATTERN}\\b`);
const REGEX_CODING_PROBLEM_STATEMENT = /\b(given (?:an? )?(?:array|list|matrix|grid|string|tree|graph|integer|number|sequence|linked list)|return (?:the )?(?:index|indices|minimum|maximum|min|max|count|sum|length|boolean|true|false|array|list|string|number|node|root|path|answer)|input\s*:|output\s*:|constraints?\s*:|example\s*\d*\s*:|complete the function|function signature|driver code|stdin|stdout|standard input|standard output|test cases?|hidden tests?|all test cases|time limit|memory limit)\b/;
const REGEX_SYSTEM_DIRECT = /\b(system design|systems design|high[\s-]?level design|\bhld\b|low[\s-]?level design|\blld\b|design (?:a|an|the)\s+(?:system|backend|architecture|platform|service|app|api|database|cache|queue|notification|feed|timeline|search|payments?|booking|ride(?:-|\s)?sharing(?: platform)?|rideshare|url shortener|chat|messaging|social network|streaming|video|marketplace|e ?commerce|storage|distributed system)|(?:design|build|scale|architect)\s+(?:twitter|instagram|uber|netflix|youtube|whatsapp|slack|discord|flipkart|swiggy|zomato|amazon|paytm|upi|google drive|dropbox|stripe)(?:\s+(?:backend|system|architecture|platform|service|app))?|(?:design|build|architect)\s+(?:a |an |the )?(?:hld|lld|high[\s-]?level design|low[\s-]?level design)\s+(?:for|of)\s+(?:twitter|instagram|uber|netflix|youtube|whatsapp|slack|discord|flipkart|swiggy|zomato|amazon|paytm|upi|google drive|dropbox|stripe|system|backend|platform|service|app)|redesign (?:the )?(?:backend|system|architecture|platform|service|app)|architecture of (?:the )?(?:system|backend|platform|service|app|database)|build(?:ing)? (?:a|an|the)\s+(?:platform|system|backend|service|app|api|database|cache|queue|notification|feed|timeline|search|payments?|booking|ride(?:-|\s)?sharing(?: platform)?|rideshare|url shortener|chat|messaging|social network))\b/;
const REGEX_SYSTEM_REAL_WORLD_DIRECT = /\b(?:design|build|architect|scale|create)\s+(?:a |an |the )?(?:(?:hld|lld|llf|high[\s-]?level design|low[\s-]?level design)\s+(?:for|of)\s+)?(?:flipkart|shopify|amazon|ecommerce|e-commerce|marketplace|cart|checkout|payment gateway|payments?|wallet|upi|paytm|stripe|whatsapp|chat|messaging|real[\s-]?time chat|live chat|notification(?: system| service)?|news feed|feed system|timeline|instagram|twitter|x app|youtube|netflix|video streaming|streaming platform|uber|lyft|ride booking|ride sharing|rideshare|food delivery|swiggy|zomato|doordash|booking|ticket booking|ticketmaster|airbnb|hotel booking|search engine|recommendation(?: system)?|url shortener|rate limiter|web crawler|file storage|dropbox|google drive|google docs|collaborative editor|slack|discord)(?:\s+(?:backend|system|architecture|platform|service|app|hld|lld))?\b/;
const REGEX_SYSTEM_ARCH = /\b(backend|front ?end|service|services|distributed|microservice|api gateway|gateway|queue|message queue|event[-\s]?driven|cache|caching|redis|kafka|database|db|storage|partition|replication|shard(?:ing)?|load balanc(?:er|ing)|cdn|edge|availability|consistency|latency|throughput|qps|rps|slo|sla|index(?:es)?|read write|read\/write|pipeline|worker|job queue|cron|batch|stream(?:ing)?|pub ?sub|pubsub)\b/;
const REGEX_SYSTEM_SCALE = /\b(scale|scaling|scalable|millions?(?: of)? users?|billions?(?: of)? users?|100m users?|10m users?|users? at scale|traffic|spike|spikes|burst|high traffic|peak traffic|performance|bottleneck|concurren|throughput|latency|qps|rps|requests per second|low latency|high throughput|capacity|growth|high load|load spike|load test|sudden(?:ly)? (?:spike|traffic|load)|traffic surge|surge|fault toleran|redundan|high availability|\bha\b|\d+\s*(?:k|m|b|thousand|million|billion))\b/;
const REGEX_SYSTEM_FRAMING = /\b(suppose|imagine|let s say|lets say|what if|consider|assume|scenario|in production|real[-\s]?world|in the real world|if suddenly|suddenly|at scale|in practice|what would happen|what happens|how would(?: you| we| this| the system)?|walk me through (?:the )?(?:architecture|system|backend|design)|talk through (?:the )?(?:architecture|system|backend|design))\b/;
const REGEX_SYSTEM_REASONING = /\b(tradeoff|trade-?off|pros? and cons|optimiz|handle|redesign|architecture|improv|fail(?:ed|ure|s)?|failure|fallback|retry|retries|recover|recovery|failover|avoid downtime|downtime|single point of failure|consistency|availability|durability|reliability|fault toleran|resilien|degrad|graceful|circuit breaker|rate limit|idempotent|backoff|queueing|bottleneck)\b/;
const REGEX_NON_SYSTEM_DESIGN = /\b(singleton|factory|observer|strategy|decorator|adapter|prototype|builder|solid|oop|object oriented|design patterns?|class diagram|uml|inheritance|polymorphism|encapsulation|bfs|dfs|binary tree|tree traversal|traversal|dynamic programming|dp\b|algorithm|leetcode|database normalization|normalization|normal forms?|1nf|2nf|3nf)\b/;
const REGEX_BEHAVIORAL_CORE = /(tell me about a time|describe a situation|give me an example|share an experience|tell me about yourself|introduce yourself|walk me through (?:your )?(?:background|resume)|background|resume|personal experience|worked on|built|developed|impact|result|outcome)/;
const REGEX_CODING_STRONG = /(algorithm|dsa|data structures? and algorithms?|debug this|snippet|boilerplate|optimize|refactor|array|linked list|tree|graph|stack|queue|hash ?map|binary search|dynamic programming|recursion|time complexity|space complexity|merge sort|quick sort|heap sort|insertion sort|bubble sort|parentheses?|brackets?|segment tree|fenwick|bit manipulation|line sweep|game theory|reservoir sampling|computational geometry)/;
const REGEX_BEHAVIORAL_STRONG = /(when have you|biggest challenge|how did you handle|conflict with|leadership|teamwork|failure|mistake|difficult decision|star method|tell me about|tell me about yourself|experience|challenge|conflict|pressure|strength|strengths|weakness|weaknesses|mentor|disagree|feedback|prioriti[zs]e|deadline|collaborate|accomplishment|introduce yourself|background|resume|project|projects|worked on|built|developed|owned|ownership|impact|result|results|outcome|outcomes|personal)/;
const REGEX_FOLLOW_UP_CORE = /(what happened next|then what|and after that|what.s next|how did that go|can you elaborate|tell me more|go deeper|expand on)/;
const REGEX_FOLLOW_UP_STRONG = /(follow.?up|continuation|building on|going back to|earlier you said|you mentioned)/;
const REGEX_CODING_BOOST = /(faster|efficient)/;
const REGEX_GENERAL_CORE = /(\bweather\b|\bforecast\b|\btime\b|\bdate\b|\bnews\b|\bcompany\b|\bproduct\b|\broadmap\b|\bstrategy\b|\bbusiness\b|\bmarket\b|\bindustry\b|\bcustomer\b|\bfeature\b|\bpolicy\b|\bprocess\b|\bmission\b|\bvision\b|\bgoal\b|\boverview\b|\bsummary\b)/;
const REGEX_GENERAL_STRONG = /(\bwhat(?:'s| is) the weather\b|\bcurrent time\b|\bwhat(?:'s| is) the date\b|\bproduct roadmap\b|\bcompany strategy\b|\bbusiness model\b|\bmarket size\b)/;
const REGEX_CONCEPT_EXPLANATION = /^(?:explain|define|describe|summarize|compare|walk me through|tell me about)\b/;

const REGEX_SALARY_CORE = /(\bsalary\b|\bcompensation\b|\btotal\s*comp|\bnegotiat|\bctc\b|\bin[\s-]?hand\b|\blpa\b|\blakhs?\b|\bcrores?\b|\bper\s*annum|\btake\s*home|\bgross\s*(?:salary|pay|income)|\bnet\s*(?:salary|pay|income)|\bhike\b|\bincrement\b|\bappraisal\b)/;
const REGEX_SALARY_STRONG = /(\bpackage\b|\boffer\b|\bpay\s*(?:expect|scale|band|range|grade)|\bexpect.*(?:salary|pay|comp|ctc|lpa)|\bcurrent.*(?:salary|ctc|comp|lpa|package)|\bexpected.*(?:salary|ctc|comp|lpa|package)|\bhow much.*(?:pay|earn|make|want|expect|offer)|\bwhat.*(?:pay|earning|making|expect|offer)|\bcounter\s*offer|\bbase\s*(?:pay|salary)|\bstock\s*option|\bequity|\bsigning\s*bonus|\brsu|\bvesting|\bjoining\s*bonus|\bretention\s*bonus|\bvariable\s*(?:pay|comp)|\bfixed\s*(?:pay|comp)|\bnotice\s*period|\bbuyout|\brelocation|\bperks|\bbenefits|\bgratuity|\bprovident\s*fund|\bpf\b|\beps\b|\bhra\b)/;
const REGEX_SALARY_LOOSE = /(salary|compensation|comp|negotiate|negotiation|offer|package|pay|ctc|counter|bonus|equity|stock|vesting|raise|increment|hike|band|range|market rate|lpa|lakhs?|crores?|per annum|take home|gross|net|appraisal|promotion|onsite|offshore|billing|cost to company|hand salary|annual|monthly|stipend|allowance|reimbursement|insurance|medical|gratuity|notice period|buyout|retention|joining bonus|variable|fixed|base pay|relocation|perks|benefits|expected|current|offered|revised|breakup|structure|component|deduction)/;
const REGEX_SALARY_BOOST = /(money|paying|afford|expensive|budget|worth|value|deserve|fair|reasonable|competitive|market|industry|standard|benchmark|average|median|percentile)/;

/** Loose STT-friendly signals — one hit is enough to nudge classification. */
const REGEX_CODING_LOOSE = new RegExp(`(write (?:me\\s+)?(?:code|a? ?(?:function|program|method|class|script|solution)|the code)|give me (?:code|a solution|the solution|${CODING_LANGUAGE_PATTERN}\\s+solution)|create (?:a\\s+)?(?:function|program|method|class|script|solution)|coding question|dsa|data struct|${CODING_DSA_TOPIC_PATTERN}|${CODING_PLATFORM_PATTERN}|big o|runtime|implement|algorithm|solve|(?:in|using|with|for)\\s+(?:${CODING_LANGUAGE_PATTERN})(?:\\b|$)|${CODING_PLATFORM_PATTERN}\\s+(?:style|solution|answer|problem))`);
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
        .replace(/\breal time\b/g, 'real-time');
    t = normalizeSystemDesignEntityTypos(t, { casing: 'lower' });
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
    if (
        REGEX_CONCEPT_EXPLANATION.test(t)
        && !REGEX_CODING_CORE.test(t)
        && !REGEX_CODING_INTERVIEW_PHRASE.test(t)
        && !REGEX_CODING_NAMED_PROBLEM.test(t)
        && !REGEX_CODING_PROBLEM_STATEMENT.test(t)
        && !REGEX_SYSTEM_DIRECT.test(t)
        && !REGEX_SYSTEM_REAL_WORLD_DIRECT.test(t)
    ) {
        return { nextType: 'general' };
    }

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
    scores.coding += cap(REGEX_CODING_INTERVIEW_PHRASE) * 3;
    scores.coding += cap(REGEX_CODING_NAMED_PROBLEM) * 3;
    scores.coding += cap(REGEX_CODING_DSA_TOPIC) * 2;
    scores.coding += cap(REGEX_CODING_PROBLEM_STATEMENT) * 2;
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

export function detectRealtimeMode(
    input: string,
    currentType: DetectedQuestionType = 'general',
    lastStrongType: DetectedQuestionType = 'general',
): { nextType: DetectedQuestionType; nextStrong?: DetectedQuestionType } {
    return detectQuestionType(input, currentType, lastStrongType);
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
