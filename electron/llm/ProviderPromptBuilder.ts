import {
    serializePromptObject,
    type PromptObject,
    type SerializedPrompt,
} from '../ActionContextBuilder';
import { isBedrockModelId } from './BedrockModelIds';

export type RuntimeProvider = 'ollama' | 'gemini' | 'custom' | 'bedrock' | 'openai' | 'claude' | 'groq' | 'teamsync' | string;
export type ProviderPromptFamily = 'groq' | 'bedrock' | 'claude' | 'gemini' | 'ollama' | 'openai' | 'custom';

export interface ProviderPromptBuildArgs {
    prompt: PromptObject;
    provider: RuntimeProvider;
    model: string;
    isSystemDesign?: boolean;
}

export interface ProviderPrompt extends SerializedPrompt {
    providerFamily: ProviderPromptFamily;
    maxInputTokens: number;
    maxOutputTokens?: number;
}

const TOKEN_CHARS = 3.5;
const INPUT_BUDGETS: Record<ProviderPromptFamily, number> = {
    groq: 3600,
    bedrock: 6000,
    claude: 8000,
    gemini: 6500,
    ollama: 1800,
    openai: 8000,
    custom: 6000,
};

const OUTPUT_BUDGETS: Record<ProviderPromptFamily, number> = {
    groq: 3072,
    bedrock: 4096,
    claude: 6400,
    gemini: 4096,
    ollama: 1536,
    openai: 4096,
    custom: 4096,
};

function estimateTokens(text: string): number {
    return Math.ceil((text || '').length / TOKEN_CHARS);
}

function resolveProviderFamily(provider: RuntimeProvider, model: string): ProviderPromptFamily {
    const normalized = (model || '').toLowerCase();
    if (provider === 'ollama' || normalized.startsWith('ollama-')) return 'ollama';
    if (provider === 'bedrock' || isBedrockModelId(normalized)) return 'bedrock';
    if (normalized.startsWith('claude-')) return 'claude';
    if (normalized.startsWith('gpt-') || normalized.startsWith('o1-') || normalized.startsWith('o3-') || normalized.includes('openai')) return 'openai';
    if (normalized.startsWith('llama-') || normalized.startsWith('mixtral-') || normalized.startsWith('gemma-') || normalized.startsWith('meta-llama/') || normalized.startsWith('qwen/')) return 'groq';
    if (provider === 'custom') return 'custom';
    return 'gemini';
}

function appendSystemProfile(systemPrompt: string, family: ProviderPromptFamily, isSystemDesign: boolean): string {
    const base = systemPrompt.trim();
    const profile = (() => {
        switch (family) {
            case 'groq':
                return '## GROQ REALTIME PROFILE\nUse compact reasoning. Prefer the shortest correct answer. Avoid restating context.';
            case 'bedrock':
                return [
                    '## BEDROCK GPT-OSS REASONING PROFILE',
                    'Use richer reasoning than realtime providers, but stay within the moderate token budget.',
                    'Prefer explicit assumptions, tradeoffs, and grounded conclusions.',
                    isSystemDesign
                        ? 'For system design, strengthen requirements, architecture, data flow, scaling limits, failure modes, and tradeoffs.'
                        : 'For general answers, reason clearly without verbose chain-of-thought.',
                ].join('\n');
            case 'claude':
                return '## CLAUDE STRUCTURED PROFILE\nUse structured prompting, clear sections, and precise constraints. Keep the final answer polished.';
            case 'gemini':
                return '## GEMINI CONCISE PROFILE\nUse concise synthesis. Prioritize the latest user question and relevant context.';
            case 'ollama':
                return '## OLLAMA LOCAL PROFILE\nUse a compact local-model prompt. Keep instructions simple and minimize context dependence.';
            case 'openai':
                return '## OPENAI REASONING PROFILE\nUse balanced reasoning, concise structure, and direct answers.';
            case 'custom':
                return '## CUSTOM PROVIDER PROFILE\nUse a broadly compatible cloud-model prompt with explicit output constraints.';
        }
    })();
    return [base, profile].filter(Boolean).join('\n\n');
}

function truncateContextToBudget(systemPrompt: string, context: string, question: string, maxInputTokens: number): string {
    const reserved = estimateTokens(systemPrompt) + estimateTokens(question) + 320;
    const contextBudget = Math.max(500, maxInputTokens - reserved);
    if (estimateTokens(context) <= contextBudget) return context;

    const maxChars = Math.max(1000, Math.floor(contextBudget * TOKEN_CHARS));
    return `[...context truncated for provider token budget...]\n${context.slice(-maxChars).trim()}`;
}

export function buildProviderPrompt(args: ProviderPromptBuildArgs): ProviderPrompt {
    const family = resolveProviderFamily(args.provider, args.model);
    const serialized = serializePromptObject(args.prompt);
    const maxInputTokens = INPUT_BUDGETS[family];
    const baseOutputTokens = OUTPUT_BUDGETS[family];
    const maxOutputTokens = family === 'bedrock' && args.isSystemDesign
        ? 6144
        : baseOutputTokens;

    const systemPrompt = appendSystemProfile(serialized.systemPrompt, family, args.isSystemDesign === true);
    const context = truncateContextToBudget(systemPrompt, serialized.context, args.prompt.question, maxInputTokens);
    const finalPrompt = [
        systemPrompt ? `[SYSTEM PROMPT]\n${systemPrompt}` : '',
        context ? `[CONTEXT]\n${context}` : '',
        `[USER QUESTION]\n${args.prompt.question}`,
    ].filter(Boolean).join('\n\n');

    return {
        systemPrompt,
        context,
        finalPrompt,
        providerFamily: family,
        maxInputTokens,
        maxOutputTokens,
    };
}
