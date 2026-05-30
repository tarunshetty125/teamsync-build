/**
 * Generic detection for coding / DSA interview questions (any problem, not a name whitelist).
 * Used for output contracts, validation, and profile routing.
 */

const LANGUAGE_PATTERN = '(?:python|py|javascript|java\\s*script|js|typescript|type\\s*script|ts|node(?:\\.js)?|node\\s*js|nodejs|java|c|c\\+\\+|cpp|c#|csharp|c\\s*sharp|go|golang|go\\s+lang|rust|ruby|kotlin|swift|scala|php|dart|r|matlab|sql|mysql|postgres|bash|shell|sh|powershell)';
const PLATFORM_PATTERN = '(?:leetcode|leet\\s*code|hackerrank|hacker\\s*rank|codeforces|code\\s*forces|codechef|code\\s*chef|atcoder|at\\s*coder|geeksforgeeks|geeks\\s*for\\s*geeks|gfg|interviewbit|interview\\s*bit|hacker\\s*earth|hackerearth|codewars|topcoder|top\\s*coder|neetcode|neet\\s*code)';
const DSA_TOPIC_PATTERN = '(?:arrays?|strings?|hash(?:ing|map|set)|hash\\s*(?:map|set)|two pointers?|sliding window|prefix sums?|sorting|greedy(?: algorithms?)?|recursion|backtracking|linked lists?|stacks?|queues?|monotonic stacks?|monotonic queues?|binary search|trees?|binary trees?|binary search trees?|\\bbst\\b|heaps?|priority queues?|tries?|graphs?|\\bbfs\\b|breadth first search|\\bdfs\\b|depth first search|topological sort|union find|disjoint set|\\bdsu\\b|shortest path(?: algorithms?)?|minimum spanning tree|\\bmst\\b|dynamic programming|\\bdp\\b|1d dynamic programming|2d dynamic programming|knapsack(?: dp)?|interval dp|bit manipulation|bitmasking|math|number theory|matrix|grid problems?|geometry|segment trees?|fenwick trees?|binary indexed trees?|\\bbit\\b|memoization|divide and conquer|simulation|string matching(?: algorithms?)?|game theory|reservoir sampling|randomized algorithms?|line sweep|computational geometry|coding design problems?|design (?:lru|lfu|hashmap|hash map|hashset|hash set|browser history|twitter|parking lot|snake game|file system))';

const CODING_INTENT_RE = new RegExp(`\\b(code|coding|coder|programm(?:e|ing)|algorithm|dsa|data structures? and algorithms?|${PLATFORM_PATTERN}|implement(?:ation)?|debug(?:ging)?|refactor|optimize|optimi[sz]e|solution|pseudocode|dry[\\s-]?run|unit test|compile|syntax|runtime|big[\\s-]?o|time complexity|space complexity|o\\s*\\(\\s*n)`, 'i');

const DSA_VOCAB_RE = /\b(arrays?|matrix|matrices|grid|grids|strings?|substring|subarray|linked\s*lists?|binary\s*trees?|bst|graphs?|nodes?|edges?|heaps?|priority\s*queues?|stacks?|queues?|hash\s*maps?|hash\s*sets?|dictionar(?:y|ies)|tries?|union[\s-]?find|dynamic\s*programming|\bdp\b|memoiz(?:e|ation)|recurs(?:ion|ive)|iterative|two\s*pointers?|sliding\s*windows?|dfs|bfs|dijkstra|bellman|floyd|topological|binary\s*search|merge\s*(?:sort|k|intervals)?|quick\s*sort|greedy|backtrack(?:ing)?|bit\s*masks?|xors?|palindromes?|anagrams?|permutations?|combinations?|subsets?|knapsack|intervals?|prefix\s*sums?|suffix(?:es)?|monotonic|cycles?|paths?|shortest|longest|minimum|maximum|medians?|kth|in[\s-]?order|pre[\s-]?order|post[\s-]?order|parentheses?|brackets?|sorted|sorting|rotat(?:e|ion)|inverts?|revers(?:e|al)|insert|deletes?|search(?:es|ing)?|travers(?:e|al)|islands?|prerequisite|dependencies|dependency|stock|sudoku|ladder|robots?|paths?|windows?|substring|subsequence)/i;
const DSA_TOPIC_RE = new RegExp(`\\b${DSA_TOPIC_PATTERN}\\b`, 'i');
const NAMED_DSA_PROBLEM_RE = /\b(n\s*queens?|queen(?:s)? problem|sudoku solver|rat in (?:a )?maze|word ladder|word break|word search|alien dictionary|course schedule|clone graph|number of islands?|rotting oranges?|surrounded regions|pacific atlantic|trapping rain water|container with most water|largest rectangle|daily temperatures|next greater element|stock span|lru cache|lfu cache|min stack|median finder|serialize deserialize|lowest common ancestor|diameter of binary tree|balanced binary tree|invert binary tree|kth largest|top k frequent|merge intervals|meeting rooms?|insert interval|coin change|house robber|climbing stairs|edit distance|longest common subsequence|longest increasing subsequence|maximum subarray|kadane|knapsack|partition equal subset|minimum window substring|longest substring|group anagrams|valid anagram|valid palindrome|permutations?|combinations?|subsets?|letter combinations|generate parentheses|combination sum|phone keypad|spiral matrix|set matrix zero(?:es)?|rotate image|search in rotated sorted array|find peak element|koko eating bananas|aggressive cows|painters partition|book allocation|wood cutting|minimize maximum|capacity to ship|gas station|jump game|merge k sorted lists?|reverse nodes? in k group|add two numbers|remove nth node|detect cycle|linked list cycle|reorder list|copy list with random pointer|sliding window maximum|minimum path sum|unique paths?|decode ways|regex matching|wildcard matching|kmp|rabin karp|z algorithm|dijkstra|bellman ford|floyd warshall|kruskal|prim(?:s)?|topological sort|union find|disjoint set|bipartite graph)\b/i;
const CODING_INTERVIEW_PHRASE_RE = new RegExp(`\\b(?:can you|could you|please|now|next|let us|lets|let\\s*s|i want you to|we need to|you need to|try to|start|begin|go ahead and)?\\s*(?:write|code|implement|solve|program|complete|fill|debug|dry run|trace|optimize|return|print|find|calculate|compute|check|validate)(?:\\s+(?:a|an|the|this|that|me|one|program|function|method|class|solution|code|logic|algorithm))*\\s+(?:${LANGUAGE_PATTERN}|${PLATFORM_PATTERN}|arrays?|matrix|grid|string|linked\\s*list|tree|graph|stack|queue|hash\\s*map|binary\\s*search|merge\\s*sort|quick\\s*sort|two\\s*sum|valid\\s*parentheses?|palindrome|anagram|substring|subarray|subsequence|duplicate|fibonacci|factorial|prime|islands?|intervals?|kth|median|longest|shortest|minimum|maximum|sum|product)\\b`, 'i');

const LANG_RE = new RegExp(`\\b${LANGUAGE_PATTERN}\\b`, 'i');
const PLATFORM_RE = new RegExp(`\\b${PLATFORM_PATTERN}\\b`, 'i');

const PROBLEM_STATEMENT_RE = [
    /\bgiven\s+(?:an?\s+)?(?:array|list|matrix|grid|string|tree|graph|integer|number|linked|sequence|set|map|dictionary|input)/i,
    /\breturn\s+(?:the\s+)?(?:all\s+)?(?:possible\s+)?(?:indices?|index|minimum|maximum|min|max|count|sum|length|boolean|true|false|list|array|string|number|void|node|root|path|ways|answer)/i,
    /\b(?:input|output|constraints?|examples?)\s*:/i,
    /\bexample\s+\d+\s*:/i,
    /\byou\s+may\s+assume\b/i,
    /\b(?:note|follow[\s-]?up)\s*:/i,
    /\b(?:can you|could you|please|now|next|start|begin|go ahead and)\s+(?:write|code|implement|solve|program|complete|fill|debug|return|print|find|calculate|compute|check|validate)\b/i,
    /\bwrite\s+(?:me\s+)?(?:a\s+)?(?:function|program|method|class|algorithm|routine|procedure|solution|code)\b/i,
    new RegExp(`\\bgive\\s+me\\s+(?:a\\s+)?(?:${LANGUAGE_PATTERN}\\s+)?(?:function|program|method|class|algorithm|routine|procedure|solution|code)\\b`, 'i'),
    /\bcreate\s+(?:a\s+)?(?:function|program|method|class|algorithm|routine|procedure|solution|code)\b/i,
    /\b(?:solve|find|determine|compute|calculate|design)\s+(?:the\s+)?(?:minimum|maximum|shortest|longest|smallest|largest|number\s+of|count\s+of)/i,
    /\b(?:int(?:eger)?|float|double|bool(?:ean)?|string|char|long|void)\[\]/i,
    /\b\d+\s*<=\s*[\w.]+\s*<=\s*\d+/,
    /\bnums\b|\bstrs\b|\btarget\b|\bk\b\s*[=:]/i,
    /\bclass\s+solution\b/i,
    /\b(?:complete the function|function signature|driver code|stdin|stdout|standard input|standard output|test cases?|hidden tests?|all test cases|time limit|memory limit)\b/i,
];

const SIGNATURE_RE = /\b(?:def|async\s+def)\s+\w+\s*\(|function\s+\w+\s*\(|(?:public|private|protected|static)\s+[\w<>,\s]+\s+\w+\s*\(|const\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/;

const CODE_FENCE_RE = /```[\s\S]*?```/;

function countMatches(text: string, patterns: RegExp[]): number {
    return patterns.reduce((n, re) => (re.test(text) ? n + 1 : n), 0);
}

const NON_CODING_SHORT_RE = /\b(tell me about|yourself|weakness|strengths?|experience|salary|negotiat|conflict|leadership|why (?:this|you|us)|walk me through your resume|greatest achievement|teamwork|behavioral)\b/i;
const SYSTEM_DESIGN_SHORT_RE = /\b(system design|design (?:a |an |the )?(?:url|api|chat|feed|instagram|twitter|uber|netflix|youtube|whatsapp|notification|messaging|platform|service|system))\b/i;
const GENERAL_QUESTION_SHORT_RE = /^\s*(?:what|who|when|where|why|how)\s+(?:is|are|was|were|do|does|did|can|could|should|would)\b/i;

/** LeetCode-style short titles: "two sum", "trapping rain water", "clone graph". */
function looksLikeShortCodingProblemTitle(text: string): boolean {
    const q = text.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 12) return false;
    if (q.includes('?')) return false;
    if (NON_CODING_SHORT_RE.test(q) || SYSTEM_DESIGN_SHORT_RE.test(q) || GENERAL_QUESTION_SHORT_RE.test(q)) {
        return false;
    }
    return true;
}

/**
 * True when the text is likely any coding / DSA interview question
 * (pasted problem, verbal ask, or implementation request).
 */
export function looksLikeCodingInterviewQuestion(text: string): boolean {
    const q = text.trim();
    if (!q) return false;

    if (CODING_INTENT_RE.test(q) || DSA_VOCAB_RE.test(q) || DSA_TOPIC_RE.test(q) || NAMED_DSA_PROBLEM_RE.test(q) || CODING_INTERVIEW_PHRASE_RE.test(q)) {
        return true;
    }

    if (LANG_RE.test(q) && /\b(write|implement|solve|function|class|code|program|solution|give me|create|answer)\b/i.test(q)) {
        return true;
    }

    if (PLATFORM_RE.test(q) && /\b(write|implement|solve|code|program|solution|answer|submit|accepted)\b/i.test(q)) {
        return true;
    }

    if (CODE_FENCE_RE.test(q) || SIGNATURE_RE.test(q)) {
        return true;
    }

    const statementHits = countMatches(q, PROBLEM_STATEMENT_RE);
    if (statementHits >= 2) {
        return true;
    }

    // Long pasted problem blocks often hit one signal + length
    const wordCount = q.split(/\s+/).filter(Boolean).length;
    if (statementHits >= 1 && wordCount >= 25) {
        return true;
    }

    // Short explicit asks: "solve merge intervals", "reverse linked list", etc.
    if (wordCount <= 24 && /\b(solve|implement|code|write|find|give me|create)\b/i.test(q) && DSA_VOCAB_RE.test(q)) {
        return true;
    }

    // Manual / chat style: "how would you solve X" with technical noun
    if (/\bhow\s+(?:would|do|can)\s+(?:i|you)\s+(?:solve|implement|approach|code)\b/i.test(q) && DSA_VOCAB_RE.test(q)) {
        return true;
    }

    if (looksLikeShortCodingProblemTitle(q)) {
        return true;
    }

    return false;
}
