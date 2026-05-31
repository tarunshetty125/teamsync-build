export type UiProviderId =
    | 'teamsync'
    | 'gemini'
    | 'groq'
    | 'openai'
    | 'claude'
    | 'bedrock'
    | 'custom'
    | 'ollama'
    | 'unknown';

export type ModelProviderId = Exclude<UiProviderId, 'unknown'>;

export type ProviderModelAccessState =
    | 'available'
    | 'configured'
    | 'unknown'
    | 'fetch_error'
    | 'no_access';

export interface UiProviderModelMetadata {
    providerId: UiProviderId;
    providerLabel: string;
    providerShortLabel: string;
    modelId: string;
    displayName: string;
    region?: string;
    isBedrock: boolean;
    isGptOss: boolean;
    isVisionCapable: boolean;
    isTextOnly: boolean;
    capabilities: {
        text: boolean;
        vision: boolean;
    };
    accessState: ProviderModelAccessState;
    statusLabel: string;
    source?: 'standard' | 'dynamic' | 'preferred' | 'custom' | 'local' | 'runtime';
}

export const UI_PROVIDER_LABELS: Record<UiProviderId, string> = {
    teamsync: 'TeamSync',
    gemini: 'Gemini',
    groq: 'Groq',
    openai: 'OpenAI',
    claude: 'Claude',
    bedrock: 'Amazon Bedrock',
    custom: 'Custom Providers',
    ollama: 'Ollama / Local',
    unknown: 'Unknown Provider',
};

export const UI_PROVIDER_SHORT_LABELS: Record<UiProviderId, string> = {
    teamsync: 'TS',
    gemini: 'Gemini',
    groq: 'Groq',
    openai: 'OpenAI',
    claude: 'Claude',
    bedrock: 'AWS',
    custom: 'Custom',
    ollama: 'Local',
    unknown: 'Model',
};

const KNOWN_PROVIDER_IDS = new Set<UiProviderId>([
    'teamsync',
    'gemini',
    'groq',
    'openai',
    'claude',
    'bedrock',
    'custom',
    'ollama',
    'unknown',
]);

const BEDROCK_MODEL_PREFIX_PATTERN = /^(anthropic|amazon|meta|mistral|cohere|ai21|openai|us|eu|apac)\./i;

const TEXT_ONLY_CAPABILITIES = Object.freeze({ text: true, vision: false });
const MULTIMODAL_CAPABILITIES = Object.freeze({ text: true, vision: true });

export function prettifyModelId(id: string): string {
    if (!id) return '';
    return id.replace(/[-_/.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeModelId(modelId?: string): string {
    return (modelId || '').trim();
}

function stripBedrockScheme(modelId: string): string {
    return normalizeModelId(modelId).replace(/^bedrock:/i, '');
}

function normalizeBedrockModelId(modelId?: string): string {
    return stripBedrockScheme(modelId || '')
        .toLowerCase()
        .replace(/\//g, '.')
        .replace(/^us\./, '')
        .replace(/^eu\./, '')
        .replace(/^apac\./, '');
}

export function isBedrockModelIdLike(modelId?: string): boolean {
    const raw = normalizeModelId(modelId);
    const stripped = stripBedrockScheme(raw);
    const normalized = stripped.toLowerCase();
    if (!stripped) return false;
    return /^bedrock:/i.test(raw)
        || BEDROCK_MODEL_PREFIX_PATTERN.test(normalized)
        || normalized.startsWith('openai/gpt-oss-');
}

export function isBedrockGptOssUiModel(modelId?: string): boolean {
    return normalizeBedrockModelId(modelId).startsWith('openai.gpt-oss-');
}

function normalizeExplicitProvider(provider?: string, type?: string): UiProviderId | null {
    const raw = (provider || type || '').trim().toLowerCase();
    if (!raw) return null;
    if (raw === 'local') return 'ollama';
    if (raw === 'aws' || raw === 'amazon' || raw === 'amazon-bedrock') return 'bedrock';
    if (KNOWN_PROVIDER_IDS.has(raw as UiProviderId)) return raw as UiProviderId;
    return null;
}

export function resolveUiProviderId(modelId: string, explicitProvider?: string, type?: string): UiProviderId {
    const provider = normalizeExplicitProvider(explicitProvider, type);
    if (provider && provider !== 'unknown') return provider;

    const normalized = normalizeModelId(modelId).toLowerCase();
    if (!normalized) return 'custom';
    if (normalized === 'teamsync') return 'teamsync';
    if (normalized.startsWith('ollama-')) return 'ollama';
    if (isBedrockModelIdLike(normalized)) return 'bedrock';
    if (normalized.startsWith('gemini-') || normalized.startsWith('models/gemini-')) return 'gemini';
    if (normalized.startsWith('gpt-') || normalized.startsWith('o1') || normalized.startsWith('o3') || normalized.startsWith('o4') || normalized.startsWith('o5')) return 'openai';
    if (normalized.startsWith('claude-')) return 'claude';
    if (
        normalized.includes('llama')
        || normalized.includes('mixtral')
        || normalized.includes('gemma')
        || normalized.includes('deepseek')
        || normalized.includes('qwen')
    ) {
        return 'groq';
    }
    return 'custom';
}

function inferCapabilities(modelId: string, providerId: UiProviderId): { text: boolean; vision: boolean } {
    const normalized = normalizeModelId(modelId).toLowerCase();
    if (!normalized) return TEXT_ONLY_CAPABILITIES;
    if (normalized === 'teamsync') return MULTIMODAL_CAPABILITIES;
    if (isBedrockGptOssUiModel(normalized)) return TEXT_ONLY_CAPABILITIES;
    if (normalized.includes('gpt-oss')) return TEXT_ONLY_CAPABILITIES;

    if (
        providerId === 'bedrock'
        && (
            normalized.includes('anthropic.claude')
            || normalized.includes('amazon.nova-pro')
            || normalized.includes('amazon.nova-lite')
        )
    ) {
        return MULTIMODAL_CAPABILITIES;
    }
    if (providerId === 'claude' && normalized.startsWith('claude-')) return MULTIMODAL_CAPABILITIES;
    if (providerId === 'gemini' && (normalized.startsWith('gemini-') || normalized.startsWith('models/gemini-'))) {
        return MULTIMODAL_CAPABILITIES;
    }
    if (
        providerId === 'openai'
        && (
            normalized.includes('gpt-4o')
            || normalized.includes('gpt-4.1')
            || normalized.includes('gpt-5')
            || normalized.includes('omni')
        )
    ) {
        return MULTIMODAL_CAPABILITIES;
    }
    if (providerId === 'groq' && (normalized.includes('llama-4-scout') || normalized.includes('llama-4-maverick'))) {
        return MULTIMODAL_CAPABILITIES;
    }
    if (providerId === 'ollama' && /(?:llava|bakllava|vision|moondream|minicpm-v|qwen2(?:\.5)?-vl|qwen-vl)/i.test(normalized)) {
        return MULTIMODAL_CAPABILITIES;
    }

    return TEXT_ONLY_CAPABILITIES;
}

function resolveCapabilitiesFromModalities(
    inputModalities: string[] | undefined,
    fallback: { text: boolean; vision: boolean },
): { text: boolean; vision: boolean } {
    if (!inputModalities?.length) return fallback;
    const normalized = inputModalities.map((modality) => modality.toUpperCase());
    return {
        text: normalized.includes('TEXT') || normalized.includes('DOCUMENT') || normalized.length > 0,
        vision: normalized.includes('IMAGE'),
    };
}

function resolveStatusLabel(args: {
    providerId: UiProviderId;
    capabilities: { text: boolean; vision: boolean };
    accessState: ProviderModelAccessState;
    isGptOss: boolean;
}): string {
    if (args.accessState === 'fetch_error') return 'Fetch error';
    if (args.accessState === 'no_access') return 'No access';
    if (args.providerId === 'ollama') return 'Local';
    if (args.providerId === 'custom') return 'Custom';
    if (args.isGptOss) return 'GPT-OSS';
    return args.capabilities.vision ? 'Vision' : 'Text-only';
}

export function formatOverlayModelDisplayName(modelId: string): string {
    const model = normalizeModelId(modelId);
    if (!model) return 'Model';
    if (model.startsWith('ollama-')) return model.replace('ollama-', '');
    if (model === 'gemini-3.1-flash-lite-preview' || model === 'gemini-3-flash-preview') return 'Gemini 3.1 Flash';
    if (model === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
    if (model === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
    if (model === 'gpt-5.4') return 'GPT 5.4';
    if (model === 'claude-sonnet-4-6') return 'Sonnet 4.6';
    if (isBedrockModelIdLike(model)) return `Bedrock ${prettifyModelId(stripBedrockScheme(model))}`;
    return prettifyModelId(model);
}

export function getProviderModelMetadata(
    modelId: string,
    options: {
        explicitProvider?: string;
        type?: string;
        region?: string;
        inputModalities?: string[];
        accessState?: ProviderModelAccessState;
        source?: UiProviderModelMetadata['source'];
        displayName?: string;
    } = {},
): UiProviderModelMetadata {
    const normalizedModelId = normalizeModelId(modelId);
    const providerId = resolveUiProviderId(normalizedModelId, options.explicitProvider, options.type);
    const fallbackCapabilities = inferCapabilities(normalizedModelId, providerId);
    const capabilities = resolveCapabilitiesFromModalities(options.inputModalities, fallbackCapabilities);
    const accessState = options.accessState ?? (providerId === 'bedrock' ? 'unknown' : 'configured');
    const isGptOss = providerId === 'bedrock' && isBedrockGptOssUiModel(normalizedModelId);

    return {
        providerId,
        providerLabel: UI_PROVIDER_LABELS[providerId],
        providerShortLabel: UI_PROVIDER_SHORT_LABELS[providerId],
        modelId: normalizedModelId,
        displayName: options.displayName || formatOverlayModelDisplayName(normalizedModelId),
        region: options.region,
        isBedrock: providerId === 'bedrock',
        isGptOss,
        isVisionCapable: capabilities.vision,
        isTextOnly: capabilities.text && !capabilities.vision,
        capabilities,
        accessState,
        statusLabel: resolveStatusLabel({ providerId, capabilities, accessState, isGptOss }),
        source: options.source,
    };
}
