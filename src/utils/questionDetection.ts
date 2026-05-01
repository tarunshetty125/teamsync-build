// ============================================================================
// Client-side question type detection — mirrors electron/llm/IntentClassifier.ts
// Pure regex, zero LLM cost, runs entirely in the renderer process.
// ============================================================================

export type QuestionType = 'concept' | 'coding' | 'system' | 'behavioral';

// ---------------------------------------------------------------------------
// Input Normalization — clean messy STT / OCR output before classification
// ---------------------------------------------------------------------------

function normalizeForDetection(text: string): string {
    let q = text.toLowerCase();
    // Fix broken OCR/speech: "polymor. phism" → "polymorphism"
    q = q.replace(/(\w)\.\s+(\w)/g, '$1$2');
    // Remove filler words
    q = q.replace(/\b(yeah|um|uh|uh+m|like|so|okay|ok|well|you know|i mean|basically|actually|right)\b/g, ' ');
    // Collapse whitespace
    q = q.replace(/\s+/g, ' ').trim();
    return q;
}

// ---------------------------------------------------------------------------
// Patterns (synced with IntentClassifier.ts)
// ---------------------------------------------------------------------------

const CODING_PATTERN = /\b(code|coding|implement|write a? ?(?:function|program|method|class|script)|write|function|program|algorithm|reverse|sort|array|linked list|tree|graph|stack|queue|hash ?map|hashmap|binary search|dynamic programming|recursion|recursive|iterate|loop|pointer|two pointer|sliding window|backtrack|greedy|bfs|dfs|matrix|string manipulation|big o|time complexity|space complexity|fibonacci|palindrome|anagram|substring|subarray|merge sort|quick sort|bubble sort|insertion sort|heap|trie|topological|shortest path|longest|maximum|minimum|sum of|product of|factorial|prime|duplicate|remove duplicates|rotate|swap|flatten|depth first|breadth first|in ?order|pre ?order|post ?order|level order|binary tree|balanced|search|find|count|print|return|output|class|method|object|string|number|integer|index|iterate|map|filter|reduce|callback|promise|async|await)\b/;

const SYSTEM_PATTERN = /\b(design|architect(?:ure)?|scalab(?:le|ility)|system design|microservices?|load balanc(?:er|ing)|database|distributed|caching|cache|cdn|replica(?:tion)?|partition(?:ing)?|sharding|message queue|api gateway|rate limit(?:ing)?|high availability|fault toleran(?:ce|t)|throughput|latency|cap theorem|event driven|monolith|horizontal scal(?:e|ing))\b/;

const BEHAVIORAL_PATTERN = /\b(tell me about|experience|challenge|conflict|pressure|teamwork|team work|project|handled|situation|strength|weakness|leader(?:ship)?|mentor|mistake|failure|difficult|disagree|feedback|prioriti[zs]e|deadline|collaborate|collaboration|proud of|accomplishment)\b/;

const CONCEPT_PATTERN = /\b(what is|what's|what are|explain|define|definition|how does|how do|describe|difference between|differences between|compare|meaning of|purpose of|why do we use|when to use|when should|types of|advantages of|disadvantages of)\b/;

const INDIRECT_PATTERN = /\b(can you walk me through|walk me through|how would you approach|how would you go about|what happens when|what would happen if|talk me through|take me through|step me through|could you explain)\b/;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectQuestionType(text: string): QuestionType {
    const q = normalizeForDetection(text);
    if (!q) return 'concept';

    // Priority: coding > system > behavioral > concept > indirect
    if (CODING_PATTERN.test(q)) return 'coding';
    if (SYSTEM_PATTERN.test(q)) return 'system';
    if (BEHAVIORAL_PATTERN.test(q)) return 'behavioral';
    if (CONCEPT_PATTERN.test(q)) return 'concept';
    if (INDIRECT_PATTERN.test(q)) return 'concept';

    return 'concept';
}

// ---------------------------------------------------------------------------
// Action Maps — context-aware suggestion buttons per question type
// ---------------------------------------------------------------------------

export interface SuggestionAction {
    label: string;
    icon: string;       // emoji icon for the button
    prompt: string;      // source label passed to requestSingleResponse
}

const CODING_ACTIONS: SuggestionAction[] = [
    { label: 'Code Solution', icon: '💻', prompt: 'Code Hint' },
    { label: 'Explain Approach', icon: '📖', prompt: 'What to Answer' },
    { label: 'Optimize', icon: '⚡', prompt: 'Clarify' },
    { label: 'Edge Cases', icon: '🔍', prompt: 'Follow Up Questions' },
];

const SYSTEM_ACTIONS: SuggestionAction[] = [
    { label: 'Design Answer', icon: '🏗', prompt: 'What to Answer' },
    { label: 'Tradeoffs', icon: '⚖️', prompt: 'Clarify' },
    { label: 'Scale It', icon: '📈', prompt: 'Brainstorm' },
    { label: 'Diagram', icon: '🗺', prompt: 'Follow Up Questions' },
];

const BEHAVIORAL_ACTIONS: SuggestionAction[] = [
    { label: 'Strong Answer', icon: '🎯', prompt: 'What to Answer' },
    { label: 'STAR Format', icon: '⭐', prompt: 'Clarify' },
    { label: 'Follow-up', icon: '➡️', prompt: 'Follow Up Questions' },
    { label: 'Improve', icon: '✨', prompt: 'Brainstorm' },
];

const CONCEPT_ACTIONS: SuggestionAction[] = [
    { label: 'Explain', icon: '💡', prompt: 'What to Answer' },
    { label: 'Examples', icon: '📝', prompt: 'Clarify' },
    { label: 'Compare', icon: '🔄', prompt: 'Brainstorm' },
    { label: 'Deep Dive', icon: '🔬', prompt: 'Follow Up Questions' },
];

const ACTION_MAP: Record<QuestionType, SuggestionAction[]> = {
    coding: CODING_ACTIONS,
    system: SYSTEM_ACTIONS,
    behavioral: BEHAVIORAL_ACTIONS,
    concept: CONCEPT_ACTIONS,
};

export function getSuggestionActions(type: QuestionType): SuggestionAction[] {
    return ACTION_MAP[type] ?? CONCEPT_ACTIONS;
}

// ---------------------------------------------------------------------------
// Smart Recommendation — keyword-based highlighting of the best action
// Returns the index of the recommended action within the action array.
// ---------------------------------------------------------------------------

interface SmartRule {
    pattern: RegExp;
    /** Label of the action to highlight (must match a label in the type's action set) */
    targetLabel: string;
}

const SMART_RULES_BY_TYPE: Record<QuestionType, SmartRule[]> = {
    coding: [
        { pattern: /\b(optimiz|improv|faster|efficient|better|refactor|clean)/, targetLabel: 'Optimize' },
        { pattern: /\b(edge case|corner case|boundar|overflow|null|empty|error)/, targetLabel: 'Edge Cases' },
        { pattern: /\b(explain|why|how does|approach|logic|intuition|walk.*through)/, targetLabel: 'Explain Approach' },
    ],
    system: [
        { pattern: /\b(tradeoff|trade-off|pros? and cons|advantage|disadvantage|comparison)/, targetLabel: 'Tradeoffs' },
        { pattern: /\b(scal|million|billion|traffic|throughput|concurren)/, targetLabel: 'Scale It' },
        { pattern: /\b(diagram|draw|flow|architect|component|visual)/, targetLabel: 'Diagram' },
    ],
    behavioral: [
        { pattern: /\b(star|structur|situation|task|action|result)/, targetLabel: 'STAR Format' },
        { pattern: /\b(follow.?up|next|then what|what happened)/, targetLabel: 'Follow-up' },
        { pattern: /\b(improv|better|stronger|rephrase|polish)/, targetLabel: 'Improve' },
    ],
    concept: [
        { pattern: /\b(example|instance|use case|real.?world|practical)/, targetLabel: 'Examples' },
        { pattern: /\b(compar|differ|vs\.?|versus|distinction)/, targetLabel: 'Compare' },
        { pattern: /\b(deep|detail|elaborate|more|further|advanced)/, targetLabel: 'Deep Dive' },
    ],
};

/**
 * Returns the index of the recommended action for the given question type & text.
 * Uses lightweight keyword matching — no LLM calls.
 * Falls back to index 0 (the default primary action) if no keyword matches.
 */
export function getRecommendedIndex(type: QuestionType, text: string): number {
    const q = text.toLowerCase().trim();
    if (!q) return 0;

    const rules = SMART_RULES_BY_TYPE[type];
    if (!rules) return 0;

    const actions = ACTION_MAP[type] ?? CONCEPT_ACTIONS;

    for (const rule of rules) {
        if (rule.pattern.test(q)) {
            const idx = actions.findIndex(a => a.label === rule.targetLabel);
            if (idx !== -1) return idx;
        }
    }

    return 0; // Default: highlight first action
}
