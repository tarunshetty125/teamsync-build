import type { PromptObject } from './ActionContextBuilder';

export interface EnforceTokenBudgetArgs {
    prompt: PromptObject;
    maxTokens: number;
}

export interface EnforcedTokenBudgetResult {
    prompt: PromptObject;
    approxTokens: number;
    transcriptTokens: number;
    profileTokens: number;
    ragTokens: number;
    supplementalTokens: number;
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
}

function trimFromEndByLines(text: string, maxTokens: number): string {
    if (!text.trim() || maxTokens <= 0) return '';
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    let tokens = 0;
    const kept: string[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const lineTokens = estimateTokens(line);
        if (tokens + lineTokens > maxTokens) break;
        kept.unshift(line);
        tokens += lineTokens;
    }
    return kept.join('\n');
}

function trimFromStartByLines(text: string, maxTokens: number): string {
    if (!text.trim() || maxTokens <= 0) return '';
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    let tokens = 0;
    const kept: string[] = [];
    for (const line of lines) {
        const lineTokens = estimateTokens(line);
        if (tokens + lineTokens > maxTokens) break;
        kept.push(line);
        tokens += lineTokens;
    }
    return kept.join('\n');
}

function fixedPromptTokens(prompt: PromptObject): number {
    const instructionTokens = prompt.instructions.reduce((sum, section) => {
        return sum + estimateTokens(`## ${section.title}\n${section.content}`);
    }, 0);
    return instructionTokens + estimateTokens(`[USER QUESTION]\n${prompt.question}`);
}

function withSupplemental(prompt: PromptObject, content: string): PromptObject {
    if (!prompt.supplemental) return prompt;
    return {
        ...prompt,
        supplemental: {
            ...prompt.supplemental,
            content: content.trim(),
            approxTokens: estimateTokens(content.trim()),
        },
    };
}

function withRag(prompt: PromptObject, content: string): PromptObject {
    if (!prompt.rag) return prompt;
    return {
        ...prompt,
        rag: {
            ...prompt.rag,
            content: content.trim(),
            approxTokens: estimateTokens(content.trim()),
        },
    };
}

function withTranscript(prompt: PromptObject, content: string): PromptObject {
    return {
        ...prompt,
        transcript: {
            ...prompt.transcript,
            content: content.trim() || '[TRANSCRIPT OMITTED DUE TO TOKEN BUDGET]',
            approxTokens: estimateTokens(content.trim() || '[TRANSCRIPT OMITTED DUE TO TOKEN BUDGET]'),
        },
    };
}

function withProfile(prompt: PromptObject, content: string): PromptObject {
    if (!prompt.profile) return prompt;
    return {
        ...prompt,
        profile: {
            ...prompt.profile,
            context: content.trim(),
            approxTokens: estimateTokens(content.trim()),
        },
    };
}

export function enforceTokenBudget({
    prompt,
    maxTokens,
}: EnforceTokenBudgetArgs): EnforcedTokenBudgetResult {
    const fixedTokens = fixedPromptTokens(prompt);
    if (fixedTokens >= maxTokens) {
        const promptWithoutContext = withSupplemental(
            withRag(
                withProfile(
                    withTranscript(prompt, ''),
                    ''
                ),
                ''
            ),
            ''
        );
        return {
            prompt: promptWithoutContext,
            approxTokens: fixedTokens,
            transcriptTokens: promptWithoutContext.transcript.approxTokens,
            profileTokens: promptWithoutContext.profile?.approxTokens ?? 0,
            ragTokens: promptWithoutContext.rag?.approxTokens ?? 0,
            supplementalTokens: promptWithoutContext.supplemental?.approxTokens ?? 0,
        };
    }

    const availableContextTokens = maxTokens - fixedTokens;
    let nextPrompt = prompt;
    let transcriptContent = prompt.transcript.content;
    let profileContent = prompt.profile?.context ?? '';
    let ragContent = prompt.rag?.content ?? '';
    let supplementalContent = prompt.supplemental?.content ?? '';

    let transcriptTokens = estimateTokens(transcriptContent);
    let profileTokens = estimateTokens(profileContent);
    let ragTokens = estimateTokens(ragContent);
    let supplementalTokens = estimateTokens(supplementalContent);

    if (transcriptTokens + profileTokens + ragTokens + supplementalTokens > availableContextTokens) {
        const transcriptBudget = Math.max(0, availableContextTokens - profileTokens - ragTokens - supplementalTokens);
        transcriptContent = trimFromEndByLines(transcriptContent, transcriptBudget);
        nextPrompt = withTranscript(nextPrompt, transcriptContent);
        transcriptTokens = nextPrompt.transcript.approxTokens;
    }

    if (transcriptTokens + profileTokens + ragTokens + supplementalTokens > availableContextTokens) {
        const profileBudget = Math.max(0, availableContextTokens - transcriptTokens - ragTokens - supplementalTokens);
        profileContent = trimFromStartByLines(profileContent, profileBudget);
        nextPrompt = withProfile(nextPrompt, profileContent);
        profileTokens = nextPrompt.profile?.approxTokens ?? 0;
    }

    if (transcriptTokens + profileTokens + ragTokens + supplementalTokens > availableContextTokens) {
        const ragBudget = Math.max(0, availableContextTokens - transcriptTokens - profileTokens - supplementalTokens);
        ragContent = trimFromStartByLines(ragContent, ragBudget);
        nextPrompt = withRag(nextPrompt, ragContent);
        ragTokens = nextPrompt.rag?.approxTokens ?? 0;
    }

    if (transcriptTokens + profileTokens + ragTokens + supplementalTokens > availableContextTokens) {
        const supplementalBudget = Math.max(0, availableContextTokens - transcriptTokens - profileTokens - ragTokens);
        supplementalContent = trimFromStartByLines(supplementalContent, supplementalBudget);
        nextPrompt = withSupplemental(nextPrompt, supplementalContent);
        supplementalTokens = nextPrompt.supplemental?.approxTokens ?? 0;
    }

    if (transcriptTokens + profileTokens + ragTokens + supplementalTokens > availableContextTokens) {
        transcriptContent = trimFromEndByLines(
            nextPrompt.transcript.content,
            Math.max(0, availableContextTokens - profileTokens - ragTokens - supplementalTokens)
        );
        nextPrompt = withTranscript(nextPrompt, transcriptContent);
        transcriptTokens = nextPrompt.transcript.approxTokens;
    }

    return {
        prompt: nextPrompt,
        approxTokens: fixedTokens + transcriptTokens + profileTokens + ragTokens + supplementalTokens,
        transcriptTokens,
        profileTokens,
        ragTokens,
        supplementalTokens,
    };
}
