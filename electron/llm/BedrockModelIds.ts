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

