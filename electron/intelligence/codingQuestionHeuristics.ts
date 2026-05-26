/**
 * Generic detection for coding / DSA interview questions (any problem, not a name whitelist).
 * Used for output contracts, validation, and profile routing.
 */

const CODING_INTENT_RE = /\b(code|coding|coder|programm(?:e|ing)|algorithm|leetcode|hackerrank|codewars|geeksforgeeks|interviewbit|hacker\s*earth|implement(?:ation)?|debug(?:ging)?|refactor|optimize|optimi[sz]e|solution|pseudocode|dry[\s-]?run|unit test|compile|syntax|runtime|big[\s-]?o|time complexity|space complexity|o\s*\(\s*n)/i;

const DSA_VOCAB_RE = /\b(arrays?|matrix|matrices|grid|grids|strings?|substring|subarray|linked\s*lists?|binary\s*trees?|bst|graphs?|nodes?|edges?|heaps?|priority\s*queues?|stacks?|queues?|hash\s*maps?|hash\s*sets?|dictionar(?:y|ies)|tries?|union[\s-]?find|dynamic\s*programming|\bdp\b|memoiz(?:e|ation)|recurs(?:ion|ive)|iterative|two\s*pointers?|sliding\s*windows?|dfs|bfs|dijkstra|bellman|floyd|topological|binary\s*search|merge\s*(?:sort|k|intervals)?|quick\s*sort|greedy|backtrack(?:ing)?|bit\s*masks?|xors?|palindromes?|anagrams?|permutations?|combinations?|subsets?|knapsack|intervals?|prefix\s*sums?|suffix(?:es)?|monotonic|cycles?|paths?|shortest|longest|minimum|maximum|medians?|kth|in[\s-]?order|pre[\s-]?order|post[\s-]?order|parentheses?|brackets?|sorted|sorting|rotat(?:e|ion)|inverts?|revers(?:e|al)|insert|deletes?|search(?:es|ing)?|travers(?:e|al)|islands?|prerequisite|dependencies|dependency|stock|sudoku|ladder|robots?|paths?|windows?|substring|subsequence)/i;

const LANG_RE = /\b(python|javascript|typescript|java|c\+\+|cpp|c#|csharp|golang|go\s+lang|rust|ruby|kotlin|swift|scala|php)\b/i;

const PROBLEM_STATEMENT_RE = [
    /\bgiven\s+(?:an?\s+)?(?:array|list|matrix|grid|string|tree|graph|integer|number|linked|sequence|set|map|dictionary|input)/i,
    /\breturn\s+(?:the\s+)?(?:all\s+)?(?:possible\s+)?(?:indices?|index|minimum|maximum|min|max|count|sum|length|boolean|true|false|list|array|string|number|void|node|root|path|ways|answer)/i,
    /\b(?:input|output|constraints?|examples?)\s*:/i,
    /\bexample\s+\d+\s*:/i,
    /\byou\s+may\s+assume\b/i,
    /\b(?:note|follow[\s-]?up)\s*:/i,
    /\bwrite\s+(?:a\s+)?(?:function|program|method|class|algorithm|routine|procedure)\b/i,
    /\b(?:solve|find|determine|compute|calculate|design)\s+(?:the\s+)?(?:minimum|maximum|shortest|longest|smallest|largest|number\s+of|count\s+of)/i,
    /\b(?:int(?:eger)?|float|double|bool(?:ean)?|string|char|long|void)\[\]/i,
    /\b\d+\s*<=\s*[\w.]+\s*<=\s*\d+/,
    /\bnums\b|\bstrs\b|\btarget\b|\bk\b\s*[=:]/i,
    /\bclass\s+solution\b/i,
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

    if (CODING_INTENT_RE.test(q) || DSA_VOCAB_RE.test(q)) {
        return true;
    }

    if (LANG_RE.test(q) && /\b(write|implement|solve|function|class|code)\b/i.test(q)) {
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
    if (wordCount <= 24 && /\b(solve|implement|code|write|find)\b/i.test(q) && DSA_VOCAB_RE.test(q)) {
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
