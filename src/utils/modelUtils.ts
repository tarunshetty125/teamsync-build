import {
    UI_PROVIDER_LABELS,
    UI_PROVIDER_SHORT_LABELS,
    formatOverlayModelDisplayName,
    prettifyModelId,
    resolveUiProviderId,
    type ModelProviderId,
} from '../lib/providers/providerModelMetadata';

export const STANDARD_CLOUD_MODELS: Record<string, {
    hasKeyCheck: (creds: any) => boolean;
    ids: string[];
    names: string[];
    descs: string[];
    pmKey: 'geminiPreferredModel' | 'openaiPreferredModel' | 'claudePreferredModel' | 'groqPreferredModel' | 'bedrockPreferredModel';
}> = {
    gemini: {
        hasKeyCheck: (creds) => !!creds?.hasGeminiKey,
        ids: ['gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview'],
        names: ['Gemini 3.1 Flash', 'Gemini 3.1 Pro'],
        descs: ['Fastest • Multimodal', 'Reasoning • High Quality'],
        pmKey: 'geminiPreferredModel'
    },
    openai: {
        hasKeyCheck: (creds) => !!creds?.hasOpenaiKey,
        ids: ['gpt-5.4'],
        names: ['GPT 5.4'],
        descs: ['OpenAI'],
        pmKey: 'openaiPreferredModel'
    },
    claude: {
        hasKeyCheck: (creds) => !!creds?.hasClaudeKey,
        ids: ['claude-sonnet-4-6'],
        names: ['Sonnet 4.6'],
        descs: ['Anthropic'],
        pmKey: 'claudePreferredModel'
    },
    groq: {
        hasKeyCheck: (creds) => !!creds?.hasGroqKey,
        ids: ['llama-3.3-70b-versatile'],
        names: ['Groq Llama 3.3'],
        descs: ['Ultra Fast'],
        pmKey: 'groqPreferredModel'
    },
    bedrock: {
        hasKeyCheck: (creds) => !!creds?.hasBedrockCredentials,
        ids: [],
        names: [],
        descs: ['Amazon Bedrock'],
        pmKey: 'bedrockPreferredModel'
    },
};

export const MODEL_PROVIDER_LABELS: Record<ModelProviderId, string> = {
    teamsync: UI_PROVIDER_LABELS.teamsync,
    gemini: UI_PROVIDER_LABELS.gemini,
    groq: UI_PROVIDER_LABELS.groq,
    openai: UI_PROVIDER_LABELS.openai,
    claude: UI_PROVIDER_LABELS.claude,
    bedrock: UI_PROVIDER_LABELS.bedrock,
    custom: UI_PROVIDER_LABELS.custom,
    ollama: UI_PROVIDER_LABELS.ollama,
};

export const MODEL_PROVIDER_SHORT_LABELS: Record<ModelProviderId, string> = {
    teamsync: UI_PROVIDER_SHORT_LABELS.teamsync,
    gemini: UI_PROVIDER_SHORT_LABELS.gemini,
    groq: UI_PROVIDER_SHORT_LABELS.groq,
    openai: UI_PROVIDER_SHORT_LABELS.openai,
    claude: UI_PROVIDER_SHORT_LABELS.claude,
    bedrock: UI_PROVIDER_SHORT_LABELS.bedrock,
    custom: UI_PROVIDER_SHORT_LABELS.custom,
    ollama: UI_PROVIDER_SHORT_LABELS.ollama,
};

export function getModelProviderId(model: string, explicitProvider?: string, type?: string): ModelProviderId {
    const provider = resolveUiProviderId(model, explicitProvider, type);
    return provider === 'unknown' ? 'custom' : provider;
}

/** Short label for overlay model picker (matches v1 overlay). */
export function getOverlayModelDisplayName(model: string): string {
    return formatOverlayModelDisplayName(model);
}

export { prettifyModelId };
export type { ModelProviderId };
