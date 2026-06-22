// electron/knowledge/llmUtils.ts
// Shared utilities for LLM interactions — JSON parsing, timeout, retry

const DEFAULT_LLM_TIMEOUT_MS = 30000;

function stripMarkdownFences(raw: string): string {
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/^~~~(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/```$/i, '');
    cleaned = cleaned.replace(/~~~$/i, '');
    return cleaned.trim();
}

function extractBalancedJsonBlock(raw: string, openChar: '{' | '[', closeChar: '}' | ']'): string | null {
    const cleaned = stripMarkdownFences(raw);
    const start = cleaned.indexOf(openChar);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < cleaned.length; index++) {
        const char = cleaned[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === openChar) {
            depth += 1;
        } else if (char === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return cleaned.slice(start, index + 1);
            }
        }
    }

    return null;
}

function repairJsonString(raw: string): string {
    return raw
        .replace(/^\uFEFF/, '')
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'");
}

function extractRegexJsonObjectCandidate(raw: string): string | null {
    const cleaned = stripMarkdownFences(raw);
    const match = cleaned.match(/\{[\s\S]*\}/);
    return match ? match[0].trim() : null;
}

/**
 * Extract a JSON array from an LLM response string.
 * Handles markdown fences (```json, ~~~json), preamble text, and trailing content.
 */
export function extractJSONArray<T = any>(raw: string): T[] {
    const block = extractBalancedJsonBlock(raw, '[', ']');
    if (block) {
        return JSON.parse(repairJsonString(block));
    }
    throw new Error(`No JSON array found in LLM response (${raw.length} chars)`);
}

/**
 * Extract a JSON object from an LLM response string.
 */
export function extractJSONObject<T = any>(raw: string): T {
    const block = extractBalancedJsonBlock(raw, '{', '}');
    if (block) {
        return JSON.parse(repairJsonString(block));
    }
    throw new Error(`No JSON object found in LLM response (${raw.length} chars)`);
}

export function safeParseJSONObject<T = any>(raw: string): { value: T | null; jsonText: string | null; error: Error | null } {
    try {
        const balancedJsonText = extractBalancedJsonBlock(raw, '{', '}');
        const regexJsonText = balancedJsonText ? null : extractRegexJsonObjectCandidate(raw);
        const directJsonText = stripMarkdownFences(raw);
        const jsonText = balancedJsonText || regexJsonText || directJsonText;
        const repairedJsonText = repairJsonString(jsonText);
        const parsedValue = JSON.parse(repairedJsonText) as T;

        return {
            value: parsedValue,
            jsonText: repairedJsonText,
            error: null,
        };
    } catch (error: any) {
        const balancedJsonText = extractBalancedJsonBlock(raw, '{', '}');
        const regexJsonText = balancedJsonText ? null : extractRegexJsonObjectCandidate(raw);
        return {
            value: null,
            jsonText: balancedJsonText || regexJsonText || stripMarkdownFences(raw) || null,
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}

/**
 * Call an LLM function with a timeout.
 * Prevents pipeline hangs when LLM is slow or rate-limited.
 */
export async function callWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS
): Promise<T> {
    return Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`LLM call timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

/**
 * Call an LLM function with timeout and 1 retry.
 */
export async function callWithRetry<T>(
    fn: () => Promise<T>,
    timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS
): Promise<T> {
    try {
        return await callWithTimeout(fn, timeoutMs);
    } catch (firstError: any) {
        console.warn(`[llmUtils] First attempt failed: ${firstError.message}. Retrying...`);
        // Wait 1s before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await callWithTimeout(fn, timeoutMs);
    }
}
