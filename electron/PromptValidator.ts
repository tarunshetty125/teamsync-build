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

    const failures = Object.entries(result)
        .filter(([, passed]) => !passed)
        .map(([key]) => key);

    if (failures.length > 0) {
        throw new Error(`[PromptValidator] Invalid prompt: ${failures.join(', ')}`);
    }

    return result;
}

export function validatePrompt(prompt: PromptObject, options?: { maxTokens?: number }): PromptValidationResult {
    return validatePromptObject(prompt, options);
}
