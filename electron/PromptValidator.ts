import type { PromptObject } from './ActionContextBuilder';

export interface PromptValidationResult {
    hasIntent: boolean;
    hasMode: boolean;
    questionExists: boolean;
    transcriptNotEmpty: boolean;
    noDuplicateSections: boolean;
    withinTokenBudget: boolean;
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

export function validatePromptObject(
    prompt: PromptObject,
    options?: { maxTokens?: number }
): PromptValidationResult {
    const keys = prompt.instructions.map((section) => section.key);
    const estimatedTokens = estimateTokens(JSON.stringify(prompt));
    const result: PromptValidationResult = {
        hasIntent: Boolean(prompt.intent),
        hasMode: Boolean(prompt.mode),
        questionExists: Boolean(prompt.question?.trim()),
        transcriptNotEmpty: Boolean(prompt.transcript.content.trim()),
        noDuplicateSections: new Set(keys).size === keys.length,
        withinTokenBudget: options?.maxTokens ? estimatedTokens <= options.maxTokens : true,
    };

    // Separate hard failures (missing required fields) from soft failures (token budget).
    // Token budget overflow is non-fatal: the TokenBudgetEnforcer already trimmed what it
    // could, and LLMs handle moderate overflows gracefully. Throwing here would crash the
    // entire action pipeline and return a hardcoded fallback template to the user.
    const softFailures = ['withinTokenBudget'];
    const hardFailures = Object.entries(result)
        .filter(([key, passed]) => !passed && !softFailures.includes(key))
        .map(([key]) => key);
    const warnFailures = Object.entries(result)
        .filter(([key, passed]) => !passed && softFailures.includes(key))
        .map(([key]) => key);

    if (warnFailures.length > 0) {
        console.warn(`[PromptValidator] Soft validation warning (non-fatal): ${warnFailures.join(', ')} — prompt may be oversized but will proceed to LLM`);
    }

    if (hardFailures.length > 0) {
        throw new Error(`[PromptValidator] Invalid prompt: ${hardFailures.join(', ')}`);
    }

    return result;
}

export function validatePrompt(prompt: PromptObject, options?: { maxTokens?: number }): PromptValidationResult {
    return validatePromptObject(prompt, options);
}
