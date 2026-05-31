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

export const prettifyModelId = (id: string): string => {
    if (!id) return '';
    return id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

export type ModelProviderId =
    | 'teamsync'
    | 'gemini'
    | 'groq'
    | 'openai'
    | 'claude'
    | 'bedrock'
    | 'custom'
    | 'ollama';

export const MODEL_PROVIDER_LABELS: Record<ModelProviderId, string> = {
    teamsync: 'TeamSync',
    gemini: 'Gemini',
    groq: 'Groq',
    openai: 'OpenAI',
    claude: 'Claude',
    bedrock: 'Amazon Bedrock',
    custom: 'Custom Providers',
    ollama: 'Ollama / Local',
};

export const MODEL_PROVIDER_SHORT_LABELS: Record<ModelProviderId, string> = {
    teamsync: 'TS',
    gemini: 'Gemini',
    groq: 'Groq',
    openai: 'OpenAI',
    claude: 'Claude',
    bedrock: 'AWS',
    custom: 'Custom',
    ollama: 'Local',
};

export function getModelProviderId(model: string, explicitProvider?: string, type?: string): ModelProviderId {
    const provider = explicitProvider || type;
    if (provider === 'teamsync' || provider === 'gemini' || provider === 'groq' || provider === 'openai' || provider === 'claude' || provider === 'bedrock' || provider === 'custom' || provider === 'ollama') {
        return provider;
    }
    if (provider === 'local') return 'ollama';

    const normalized = model.toLowerCase();
    if (!normalized) return 'custom';
    if (normalized === 'teamsync') return 'teamsync';
    if (normalized.startsWith('ollama-')) return 'ollama';
    if (normalized.startsWith('gemini-')) return 'gemini';
    if (normalized.startsWith('gpt-') || normalized.startsWith('o1') || normalized.startsWith('o3') || normalized.startsWith('o4') || normalized.startsWith('o5')) return 'openai';
    if (normalized.startsWith('claude-')) return 'claude';
    if (normalized.includes('llama') || normalized.includes('mixtral') || normalized.includes('deepseek') || normalized.includes('qwen')) return 'groq';
    if (/^(anthropic|amazon|meta|mistral|cohere|ai21|openai|us|eu|apac)\./.test(normalized) || normalized.startsWith('openai/gpt-oss-')) return 'bedrock';
    return 'custom';
}

/** Short label for overlay model picker (matches v1 overlay). */
export function getOverlayModelDisplayName(model: string): string {
    if (!model) return 'Model';
    if (model.startsWith('ollama-')) return model.replace('ollama-', '');
    if (model === 'gemini-3.1-flash-lite-preview' || model === 'gemini-3-flash-preview') return 'Gemini 3.1 Flash';
    if (model === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
    if (model === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
    if (model === 'gpt-5.4') return 'GPT 5.4';
    if (model === 'claude-sonnet-4-6') return 'Sonnet 4.6';
    if (/^(anthropic|amazon|meta|mistral|cohere|ai21|openai|us|eu|apac)\./.test(model) || model.startsWith('openai/gpt-oss-')) return `Bedrock ${prettifyModelId(model)}`;
    return prettifyModelId(model);
}
