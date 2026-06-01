import { UI_PROVIDER_LABELS, type UiProviderId } from './providerModelMetadata';

export type ProviderHealthProviderId = 'bedrock' | 'groq' | 'gemini' | 'openai' | 'claude' | 'ollama';

export type ProviderHealthDiagnosticCategory =
    | 'not_configured'
    | 'configured'
    | 'ok'
    | 'checking'
    | 'connection_success'
    | 'connection_failed'
    | 'model_fetch_failed'
    | 'auth_failed'
    | 'auth_expired'
    | 'rate_limited'
    | 'provider_unavailable'
    | 'no_available_keys'
    | 'cooldown'
    | 'invalid_keys'
    | 'ollama_unavailable';

export interface ProviderHealthDiagnostic {
    category: ProviderHealthDiagnosticCategory;
    message: string;
    source?: string;
    at?: number;
}

export interface ProviderHealthEntry {
    provider: ProviderHealthProviderId;
    label: string;
    configured: boolean;
    reachable: boolean;
    authenticated: boolean;
    degraded: boolean;
    lastDiagnostic: ProviderHealthDiagnostic | null;
}

export interface ProviderHealthReadModel {
    providers: Record<ProviderHealthProviderId, ProviderHealthEntry>;
    orderedProviders: ProviderHealthEntry[];
    configuredCount: number;
    degradedCount: number;
    generatedAt: number;
}

export interface ProviderCredentialSignals {
    hasBedrockCredentials?: boolean;
    hasGroqKey?: boolean;
    hasGeminiKey?: boolean;
    hasOpenaiKey?: boolean;
    hasClaudeKey?: boolean;
}

export interface ProviderConnectionTestSignal {
    success: boolean;
    error?: string | null;
    checkedAt?: number;
    source?: string;
}

export interface ProviderModelFetchSignal {
    modelCount?: number;
    error?: string | null;
    checkedAt?: number;
    source?: string;
}

export interface ProviderGroqHealthSignal {
    totalKeys: number;
    availableKeys: number;
    exhaustedKeys: number;
    coolingDownKeys: number;
    invalidKeys: number;
}

export interface ProviderBedrockHealthSignal {
    modelCount?: number;
    authExpired?: boolean;
    error?: string | null;
    checkedAt?: number;
}

export interface ProviderOllamaHealthSignal {
    configured?: boolean;
    reachable?: boolean;
    status?: string | null;
    models?: string[];
    error?: string | null;
    checkedAt?: number;
}

export interface ProviderHealthReadModelInput {
    credentials?: ProviderCredentialSignals;
    connectionTests?: Partial<Record<ProviderHealthProviderId, ProviderConnectionTestSignal>>;
    modelFetches?: Partial<Record<ProviderHealthProviderId, ProviderModelFetchSignal>>;
    fetchErrors?: Partial<Record<ProviderHealthProviderId, string | null | undefined>>;
    diagnostics?: Partial<Record<ProviderHealthProviderId, ProviderHealthDiagnostic | null | undefined>>;
    groqHealth?: ProviderGroqHealthSignal | null;
    bedrock?: ProviderBedrockHealthSignal | null;
    ollama?: ProviderOllamaHealthSignal | null;
    now?: number;
}

const PROVIDERS: ProviderHealthProviderId[] = ['bedrock', 'groq', 'gemini', 'openai', 'claude', 'ollama'];

const CREDENTIAL_KEYS: Partial<Record<ProviderHealthProviderId, keyof ProviderCredentialSignals>> = {
    bedrock: 'hasBedrockCredentials',
    groq: 'hasGroqKey',
    gemini: 'hasGeminiKey',
    openai: 'hasOpenaiKey',
    claude: 'hasClaudeKey',
};

function providerLabel(provider: ProviderHealthProviderId): string {
    const uiProvider = provider === 'ollama' ? 'ollama' : provider;
    return UI_PROVIDER_LABELS[uiProvider as UiProviderId];
}

function diagnostic(
    category: ProviderHealthDiagnosticCategory,
    message: string,
    options: { source?: string; at?: number } = {},
): ProviderHealthDiagnostic {
    return {
        category,
        message,
        ...(options.source ? { source: options.source } : {}),
        ...(options.at ? { at: options.at } : {}),
    };
}

function cleanMessage(value?: string | null): string {
    return typeof value === 'string' ? value.trim() : '';
}

function classifyFailure(message: string, fallback: ProviderHealthDiagnosticCategory = 'connection_failed'): ProviderHealthDiagnosticCategory {
    const normalized = message.toLowerCase();
    if (
        normalized.includes('expiredtoken')
        || normalized.includes('expired token')
        || normalized.includes('session expired')
        || normalized.includes('security token included in the request is expired')
        || normalized.includes('sso session')
    ) {
        return 'auth_expired';
    }
    if (
        normalized.includes('api key')
        || normalized.includes('unauthorized')
        || normalized.includes('forbidden')
        || normalized.includes('authentication')
        || normalized.includes('credential')
        || normalized.includes('access denied')
    ) {
        return 'auth_failed';
    }
    if (
        normalized.includes('rate limit')
        || normalized.includes('rate_limit')
        || normalized.includes('quota')
        || normalized.includes('too many requests')
        || normalized.includes('429')
    ) {
        return 'rate_limited';
    }
    if (
        normalized.includes('timeout')
        || normalized.includes('timed out')
        || normalized.includes('unavailable')
        || normalized.includes('network')
        || normalized.includes('fetch failed')
        || normalized.includes('econnrefused')
        || normalized.includes('econnreset')
    ) {
        return 'provider_unavailable';
    }
    return fallback;
}

function isAuthFailure(category: ProviderHealthDiagnosticCategory): boolean {
    return category === 'auth_failed' || category === 'auth_expired' || category === 'invalid_keys';
}

function isDegradedDiagnostic(category: ProviderHealthDiagnosticCategory): boolean {
    return !(
        category === 'ok'
        || category === 'configured'
        || category === 'connection_success'
        || category === 'checking'
    );
}

function configuredFromCredentials(provider: ProviderHealthProviderId, input: ProviderHealthReadModelInput): boolean {
    if (provider === 'ollama') {
        const status = cleanMessage(input.ollama?.status).toLowerCase();
        return Boolean(
            input.ollama?.configured
            || input.ollama?.reachable
            || (input.ollama?.models?.length ?? 0) > 0
            || status === 'detected'
            || status === 'checking'
            || status === 'fixing'
            || status === 'starting'
        );
    }

    if (provider === 'groq' && input.groqHealth && input.groqHealth.totalKeys > 0) {
        return true;
    }

    const key = CREDENTIAL_KEYS[provider];
    return key ? input.credentials?.[key] === true : false;
}

function readFetchSignal(provider: ProviderHealthProviderId, input: ProviderHealthReadModelInput): ProviderModelFetchSignal | undefined {
    const explicit = input.modelFetches?.[provider];
    const fetchError = cleanMessage(input.fetchErrors?.[provider]);
    const bedrockError = provider === 'bedrock' ? cleanMessage(input.bedrock?.error) : '';
    const bedrockModelCount = provider === 'bedrock' ? input.bedrock?.modelCount : undefined;

    if (explicit || fetchError || bedrockError || bedrockModelCount !== undefined) {
        return {
            ...(explicit ?? {}),
            ...(fetchError || bedrockError ? { error: fetchError || bedrockError } : {}),
            ...(bedrockModelCount !== undefined && explicit?.modelCount === undefined ? { modelCount: bedrockModelCount } : {}),
        };
    }

    return undefined;
}

function fromExternalDiagnostic(provider: ProviderHealthProviderId, input: ProviderHealthReadModelInput): ProviderHealthDiagnostic | null {
    const provided = input.diagnostics?.[provider];
    if (provided) return provided;

    if (provider === 'bedrock' && input.bedrock?.authExpired) {
        return diagnostic('auth_expired', 'AWS Bedrock session expired. Re-authentication is required.', {
            source: 'bedrock:reauthentication-required',
            at: input.bedrock.checkedAt,
        });
    }

    return null;
}

function buildBaseProviderHealth(provider: ProviderHealthProviderId, input: ProviderHealthReadModelInput): ProviderHealthEntry {
    const configured = configuredFromCredentials(provider, input);
    const externalDiagnostic = fromExternalDiagnostic(provider, input);
    const connection = input.connectionTests?.[provider];
    const fetchSignal = readFetchSignal(provider, input);
    const modelCount = fetchSignal?.modelCount ?? 0;

    if (!configured) {
        return {
            provider,
            label: providerLabel(provider),
            configured: false,
            reachable: false,
            authenticated: false,
            degraded: false,
            lastDiagnostic: diagnostic('not_configured', `${providerLabel(provider)} is not configured.`, { source: 'provider-health' }),
        };
    }

    const externalCategory = externalDiagnostic?.category;
    if (externalDiagnostic && externalCategory && isDegradedDiagnostic(externalCategory)) {
        return {
            provider,
            label: providerLabel(provider),
            configured: true,
            reachable: false,
            authenticated: !isAuthFailure(externalCategory),
            degraded: true,
            lastDiagnostic: externalDiagnostic,
        };
    }

    if (connection) {
        if (connection.success) {
            return {
                provider,
                label: providerLabel(provider),
                configured: true,
                reachable: true,
                authenticated: true,
                degraded: false,
                lastDiagnostic: diagnostic('connection_success', `${providerLabel(provider)} connection check succeeded.`, {
                    source: connection.source ?? 'test-llm-connection',
                    at: connection.checkedAt,
                }),
            };
        }

        const message = cleanMessage(connection.error) || `${providerLabel(provider)} connection check failed.`;
        const category = classifyFailure(message);
        return {
            provider,
            label: providerLabel(provider),
            configured: true,
            reachable: false,
            authenticated: !isAuthFailure(category),
            degraded: true,
            lastDiagnostic: diagnostic(category, message, {
                source: connection.source ?? 'test-llm-connection',
                at: connection.checkedAt,
            }),
        };
    }

    if (fetchSignal?.error) {
        const category = classifyFailure(fetchSignal.error, 'model_fetch_failed');
        return {
            provider,
            label: providerLabel(provider),
            configured: true,
            reachable: false,
            authenticated: !isAuthFailure(category),
            degraded: true,
            lastDiagnostic: diagnostic(category === 'connection_failed' ? 'model_fetch_failed' : category, fetchSignal.error, {
                source: fetchSignal.source ?? 'fetch-provider-models',
                at: fetchSignal.checkedAt,
            }),
        };
    }

    if (modelCount > 0) {
        return {
            provider,
            label: providerLabel(provider),
            configured: true,
            reachable: true,
            authenticated: true,
            degraded: false,
            lastDiagnostic: diagnostic('ok', `${providerLabel(provider)} model discovery returned ${modelCount} model${modelCount === 1 ? '' : 's'}.`, {
                source: fetchSignal?.source ?? 'fetch-provider-models',
                at: fetchSignal?.checkedAt,
            }),
        };
    }

    return {
        provider,
        label: providerLabel(provider),
        configured: true,
        reachable: true,
        authenticated: true,
        degraded: false,
        lastDiagnostic: externalDiagnostic ?? diagnostic('configured', `${providerLabel(provider)} is configured; no degraded health signal is present.`, {
            source: 'provider-health',
        }),
    };
}

function buildGroqHealth(input: ProviderHealthReadModelInput): ProviderHealthEntry {
    const base = buildBaseProviderHealth('groq', input);
    const health = input.groqHealth;

    if (!base.configured || !health) return base;

    if (health.totalKeys <= 0) {
        return {
            ...base,
            reachable: false,
            authenticated: false,
            degraded: true,
            lastDiagnostic: diagnostic('no_available_keys', 'Groq has no runtime keys available.', { source: 'groq-vault:get-health' }),
        };
    }

    if (health.availableKeys <= 0) {
        const allInvalid = health.invalidKeys >= health.totalKeys;
        const category = allInvalid
            ? 'invalid_keys'
            : health.coolingDownKeys > 0
                ? 'cooldown'
                : 'no_available_keys';
        const message = allInvalid
            ? 'All Groq keys are invalid or unavailable.'
            : health.coolingDownKeys > 0
                ? 'All available Groq keys are cooling down.'
                : 'No Groq keys are currently available.';

        return {
            ...base,
            reachable: false,
            authenticated: !allInvalid,
            degraded: true,
            lastDiagnostic: diagnostic(category, message, { source: 'groq-vault:get-health' }),
        };
    }

    if (health.invalidKeys > 0 || health.exhaustedKeys > 0 || health.coolingDownKeys > 0) {
        const parts = [
            health.invalidKeys > 0 ? `${health.invalidKeys} invalid` : '',
            health.exhaustedKeys > 0 ? `${health.exhaustedKeys} exhausted` : '',
            health.coolingDownKeys > 0 ? `${health.coolingDownKeys} cooling down` : '',
        ].filter(Boolean);

        return {
            ...base,
            reachable: true,
            authenticated: true,
            degraded: true,
            lastDiagnostic: diagnostic(
                health.invalidKeys > 0 ? 'invalid_keys' : health.coolingDownKeys > 0 ? 'cooldown' : 'rate_limited',
                `Groq is partially degraded: ${parts.join(', ')}.`,
                { source: 'groq-vault:get-health' },
            ),
        };
    }

    return {
        ...base,
        reachable: true,
        authenticated: true,
        degraded: false,
        lastDiagnostic: diagnostic('ok', `Groq has ${health.availableKeys} available key${health.availableKeys === 1 ? '' : 's'}.`, {
            source: 'groq-vault:get-health',
        }),
    };
}

function buildOllamaHealth(input: ProviderHealthReadModelInput): ProviderHealthEntry {
    const configured = configuredFromCredentials('ollama', input);
    const signal = input.ollama;
    const status = cleanMessage(signal?.status).toLowerCase();
    const modelCount = signal?.models?.length ?? 0;
    const explicitReachable = signal?.reachable;
    const error = cleanMessage(signal?.error);

    if (!configured) {
        return {
            provider: 'ollama',
            label: providerLabel('ollama'),
            configured: false,
            reachable: false,
            authenticated: false,
            degraded: false,
            lastDiagnostic: diagnostic('not_configured', 'Ollama is not configured or no local models were detected.', {
                source: 'ollama',
                at: signal?.checkedAt,
            }),
        };
    }

    if (error || status === 'not-found' || status === 'error') {
        return {
            provider: 'ollama',
            label: providerLabel('ollama'),
            configured: true,
            reachable: false,
            authenticated: false,
            degraded: true,
            lastDiagnostic: diagnostic('ollama_unavailable', error || 'Ollama is configured but not reachable.', {
                source: 'ollama',
                at: signal?.checkedAt,
            }),
        };
    }

    if (status === 'checking' || status === 'fixing' || status === 'starting') {
        return {
            provider: 'ollama',
            label: providerLabel('ollama'),
            configured: true,
            reachable: explicitReachable === true,
            authenticated: explicitReachable === true,
            degraded: false,
            lastDiagnostic: diagnostic('checking', 'Ollama availability check is in progress.', {
                source: 'ollama',
                at: signal?.checkedAt,
            }),
        };
    }

    if (explicitReachable === true || status === 'detected' || modelCount > 0) {
        return {
            provider: 'ollama',
            label: providerLabel('ollama'),
            configured: true,
            reachable: true,
            authenticated: true,
            degraded: false,
            lastDiagnostic: diagnostic('ok', modelCount > 0
                ? `Ollama detected ${modelCount} local model${modelCount === 1 ? '' : 's'}.`
                : 'Ollama is reachable.', {
                source: 'ollama',
                at: signal?.checkedAt,
            }),
        };
    }

    return {
        provider: 'ollama',
        label: providerLabel('ollama'),
        configured: true,
        reachable: false,
        authenticated: false,
        degraded: false,
        lastDiagnostic: diagnostic('checking', 'Ollama is configured; no reachability result is available yet.', {
            source: 'ollama',
            at: signal?.checkedAt,
        }),
    };
}

export function buildProviderHealthReadModel(input: ProviderHealthReadModelInput = {}): ProviderHealthReadModel {
    const orderedProviders = PROVIDERS.map((provider) => {
        if (provider === 'groq') return buildGroqHealth(input);
        if (provider === 'ollama') return buildOllamaHealth(input);
        return buildBaseProviderHealth(provider, input);
    });
    const providers = Object.fromEntries(
        orderedProviders.map((entry) => [entry.provider, entry]),
    ) as Record<ProviderHealthProviderId, ProviderHealthEntry>;

    return {
        providers,
        orderedProviders,
        configuredCount: orderedProviders.filter((entry) => entry.configured).length,
        degradedCount: orderedProviders.filter((entry) => entry.degraded).length,
        generatedAt: input.now ?? Date.now(),
    };
}
