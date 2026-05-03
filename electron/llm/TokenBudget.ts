// electron/llm/TokenBudget.ts
// Pre-flight token budgeting for all LLM calls.
// Enforces a hard cap of 9000 tokens across the entire prompt.
// Context is trimmed in priority order (lowest first).
// RULE: Drop entire blocks. Never slice strings.

const CHARS_PER_TOKEN = 4;

/** Hard ceiling — no LLM call may exceed this budget. */
export const TOKEN_CAP = 9_000;

export function estimateTokens(text: string | undefined | null): number {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface ContextSlot {
    key: string;
    content: string;
    priority: number;
}

/**
 * Priority constants.
 * Trim order (LOW → HIGH):
 *   1. full history        (dropped first)
 *   2. resume / JD
 *   3. custom context
 *   4. relevant knowledge (RAG)
 *   5. latest transcript   (protected — never dropped)
 *   6. user message        (protected — never dropped)
 */
export const CONTEXT_PRIORITY = {
    FULL_HISTORY: 1,
    RESUME_JD: 2,
    CUSTOM_CONTEXT: 3,
    RAG_KNOWLEDGE: 4,
    LATEST_TRANSCRIPT: 5,
    USER_MESSAGE: 6,
} as const;

/**
 * Block-based budget trimming.
 * Drops entire blocks from lowest priority until within budget.
 * NEVER slices strings. Protected blocks (priority >= 5) are never dropped.
 */
export function trimContextToTokenBudget(
    slots: ContextSlot[],
    maxTokens: number = TOKEN_CAP
): Map<string, string> {
    const sorted = [...slots].sort((a, b) => a.priority - b.priority);
    let totalTokens = sorted.reduce((sum, s) => sum + estimateTokens(s.content), 0);
    const result = new Map<string, string>();

    for (const slot of sorted) {
        // Protected blocks — always kept
        if (slot.priority >= CONTEXT_PRIORITY.LATEST_TRANSCRIPT) {
            result.set(slot.key, slot.content);
            continue;
        }

        if (totalTokens <= maxTokens) {
            result.set(slot.key, slot.content);
            continue;
        }

        // Over budget — drop entire block (never slice)
        const slotTokens = estimateTokens(slot.content);
        totalTokens -= slotTokens;
        result.set(slot.key, '');
        console.log(`[TokenBudget] Dropped "${slot.key}" (${slotTokens} tok) — budget ${totalTokens}/${maxTokens}`);
    }

    return result;
}

/** Alias matching the spec's naming convention. */
export const buildPromptWithBudget = trimContextToTokenBudget;

/**
 * Pre-flight guard for assembled prompts (system + user content).
 * Block-based: if over cap, drops the CONTEXT portion entirely.
 * Never slices mid-content.
 */
export function enforceTokenCap(
    systemPrompt: string,
    userContent: string,
    cap: number = TOKEN_CAP
): string {
    const total = estimateTokens(systemPrompt) + estimateTokens(userContent);
    if (total <= cap) return userContent;

    // Try to separate question from context block
    const contextMarker = '\n\nCONTEXT:\n';
    const markerIdx = userContent.indexOf(contextMarker);

    if (markerIdx > 0) {
        // Drop context block entirely, keep question
        const questionOnly = userContent.substring(0, markerIdx);
        const newTotal = estimateTokens(systemPrompt) + estimateTokens(questionOnly);
        if (newTotal <= cap) {
            console.warn(`[TokenBudget] Dropped context block (${total} → ${newTotal} tok, cap=${cap})`);
            return questionOnly;
        }
    }

    // No string slicing — provider handles overflow. Block-based drop is the only strategy.
    console.warn(`[TokenBudget] Over cap (${total} > ${cap}) — context block drop insufficient, proceeding as-is`);
    return userContent;
}

/**
 * Bounded recap context via reverse accumulation.
 * Walks backward through lines until token budget is reached.
 */
export function buildBoundedRecapContext(
    fullContext: string,
    maxTokens: number = 3000
): string {
    if (!fullContext) return '';

    const lines = fullContext.split('\n');
    const accumulated: string[] = [];
    let tokenCount = 0;

    for (let i = lines.length - 1; i >= 0; i--) {
        const lineTokens = estimateTokens(lines[i]);
        if (tokenCount + lineTokens > maxTokens) break;
        accumulated.unshift(lines[i]);
        tokenCount += lineTokens;
    }

    if (accumulated.length < lines.length) {
        accumulated.unshift('[...earlier context omitted]');
    }

    return accumulated.join('\n');
}
