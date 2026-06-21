import {
    serializePromptObject,
    type PromptObject,
    type SerializedPrompt,
} from '../ActionContextBuilder';
import { isBedrockModelId } from './BedrockModelIds';
import { BedrockCapabilityRegistry, type BedrockPromptProfile } from '../services/BedrockCapabilityRegistry';

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
                return resolveBedrockPromptProfile(isSystemDesign);
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

    // For Bedrock: resolve dynamic token budgets from the capability registry
    const { maxInputTokens, maxOutputTokens } = resolveTokenBudgets(family, args.model, args.isSystemDesign);

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

/**
 * Resolve token budgets for a provider + model combination.
 * For Bedrock: uses capability registry per-model limits.
 * For other providers: uses static defaults.
 */
function resolveTokenBudgets(
    family: ProviderPromptFamily,
    model: string,
    isSystemDesign?: boolean,
): { maxInputTokens: number; maxOutputTokens: number } {
    if (family === 'bedrock') {
        const registry = BedrockCapabilityRegistry.getActive();
        if (registry?.isPopulated()) {
            // Use per-model limits from registry
            // Scale input budget to 80% of model max to leave room for system prompt
            const modelMaxInput = registry.getMaxInputTokens(model);
            const modelMaxOutput = registry.getMaxOutputTokens(model);
            return {
                maxInputTokens: Math.min(modelMaxInput, Math.floor(modelMaxInput * 0.8)),
                maxOutputTokens: isSystemDesign
                    ? Math.min(modelMaxOutput, 8192)
                    : Math.min(modelMaxOutput, 8192),
            };
        }
    }
    const baseOutputTokens = OUTPUT_BUDGETS[family];
    return {
        maxInputTokens: INPUT_BUDGETS[family],
        maxOutputTokens: family === 'bedrock' && isSystemDesign ? 6144 : baseOutputTokens,
    };
}

// ── Bedrock Model-Family-Aware Prompt Profiles ─────────────────────────────

const BEDROCK_PROMPT_PROFILES: Record<BedrockPromptProfile, (isSystemDesign: boolean) => string> = {
    claude: (isSystemDesign) => [
        '## BEDROCK CLAUDE REASONING PROFILE',
        'Use structured prompting with clear sections. Leverage extended thinking for complex problems.',
        isSystemDesign
            ? 'For system design: strengthen requirements, architecture, data flow, scaling limits, failure modes, and tradeoffs.'
            : 'For general answers: reason clearly, use precise constraints, keep the final answer polished.',
    ].join('\n'),

    nova: (isSystemDesign) => [
        '## BEDROCK NOVA PROFILE',
        'Use concise, direct reasoning. Nova models work best with explicit instructions and clear output formats.',
        isSystemDesign
            ? 'For system design: focus on architecture decisions, tradeoffs, and concrete recommendations.'
            : 'For general answers: prefer the shortest correct answer with key supporting points.',
    ].join('\n'),

    llama: (isSystemDesign) => [
        '## BEDROCK LLAMA PROFILE',
        'Use balanced reasoning. Provide grounded conclusions with explicit assumptions.',
        isSystemDesign
            ? 'For system design: cover requirements, architecture, scaling, and failure modes.'
            : 'For general answers: reason clearly without verbose chain-of-thought.',
    ].join('\n'),

    'gpt-oss': (isSystemDesign) => [
        '## BEDROCK GPT-OSS REASONING PROFILE',
        'Use richer reasoning than realtime providers, but stay within the moderate token budget.',
        'Prefer explicit assumptions, tradeoffs, and grounded conclusions.',
        isSystemDesign
            ? 'For system design: strengthen requirements, architecture, data flow, scaling limits, failure modes, and tradeoffs.'
            : 'For general answers: reason clearly without verbose chain-of-thought.',
    ].join('\n'),

    generic: (isSystemDesign) => [
        '## BEDROCK MODEL PROFILE',
        'Use balanced reasoning with clear structure and direct answers.',
        isSystemDesign
            ? 'For system design: focus on architecture, tradeoffs, and concrete recommendations.'
            : 'For general answers: provide concise, well-grounded responses.',
    ].join('\n'),
};

function resolveBedrockPromptProfile(isSystemDesign: boolean): string {
    // Try to resolve from the capability registry using the current model
    // Since we don't have the model ID here, fall back to the last known active registry
    const registry = BedrockCapabilityRegistry.getActive();
    // Default to generic if no registry available
    return BEDROCK_PROMPT_PROFILES.generic(isSystemDesign);
}

/**
 * Resolve a Bedrock prompt profile for a specific model ID.
 * This is the model-aware version that should be preferred when model ID is available.
 */
export function getBedrockPromptProfileForModel(modelId: string, isSystemDesign: boolean): string {
    const registry = BedrockCapabilityRegistry.getActive();
    const profile = registry?.getPromptProfile(modelId) || 'generic';
    return BEDROCK_PROMPT_PROFILES[profile](isSystemDesign);
}
