const BEDROCK_MODEL_PREFIXES = [
    'anthropic.',
    'amazon.',
    'meta.',
    'mistral.',
    'cohere.',
    'ai21.',
    'openai.',
    'us.',
    'eu.',
    'apac.',
];

function stripBedrockScheme(modelId: string): string {
    return (modelId || '').trim().replace(/^bedrock:/i, '');
}

function toBedrockAliasKey(modelId: string): string {
    const normalized = stripBedrockScheme(modelId).toLowerCase().replace(/\//g, '.');
    if (normalized.startsWith('openai.gpt-oss-')) {
        return normalized.replace(/-\d+:\d+$/, '');
    }
    return normalized;
}

export function isBedrockModelId(modelId: string, preferredModel?: string): boolean {
    const stripped = stripBedrockScheme(modelId);
    const normalized = stripped.toLowerCase();

    if (!stripped) return false;
    if (/^bedrock:/i.test((modelId || '').trim())) return true;
    if (BEDROCK_MODEL_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true;
    if (normalized.startsWith('openai/gpt-oss-')) return true;
    if (preferredModel && toBedrockAliasKey(stripped) === toBedrockAliasKey(preferredModel)) return true;

    return false;
}

export function resolveBedrockModelId(modelId: string | undefined, preferredModel?: string): string | undefined {
    const candidate = stripBedrockScheme(modelId || '');
    if (!candidate) return preferredModel;

    if (preferredModel && toBedrockAliasKey(candidate) === toBedrockAliasKey(preferredModel)) {
        return stripBedrockScheme(preferredModel);
    }

    if (candidate.toLowerCase().startsWith('openai/gpt-oss-')) {
        return preferredModel ? stripBedrockScheme(preferredModel) : candidate.replace('/', '.');
    }

    return candidate;
}

function normalizedBedrockModelId(modelId: string): string {
    return toBedrockAliasKey(modelId)
        .replace(/^us\./, '')
        .replace(/^eu\./, '')
        .replace(/^apac\./, '');
}

export function isBedrockGptOssModel(modelId?: string): boolean {
    if (!modelId) return false;
    return normalizedBedrockModelId(modelId).startsWith('openai.gpt-oss-');
}

export function getBedrockVisionModelRank(modelId: string): number {
    const normalized = normalizedBedrockModelId(modelId);

    if (normalized.includes('anthropic.claude') && normalized.includes('sonnet')) {
        return 0;
    }

    if (normalized.includes('amazon.nova-pro')) {
        return 1;
    }

    if (normalized.includes('amazon.nova-lite')) {
        return 2;
    }

    return Number.POSITIVE_INFINITY;
}

function supportsBedrockImageInput(model: { inputModalities?: string[] }): boolean {
    if (!model.inputModalities?.length) return true;
    return model.inputModalities.some(modality => modality.toUpperCase() === 'IMAGE');
}

export function resolveBedrockVisionModel(models: Array<{ id: string; label?: string; inputModalities?: string[] }>): string | undefined {
    const ranked = models
        .map(model => ({
            ...model,
            rank: getBedrockVisionModelRank(model.id),
        }))
        .filter(model => Number.isFinite(model.rank) && supportsBedrockImageInput(model))
        .sort((a, b) => a.rank - b.rank || (a.label || a.id).localeCompare(b.label || b.id));

    return ranked[0]?.id;
}
