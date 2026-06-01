import { resolveUiProviderId } from '../../src/lib/providers/providerModelMetadata';
import { STANDARD_CLOUD_MODELS } from '../../src/utils/modelUtils';
import type { PreferredProvider } from '../../src/lib/personalization/preferences';

type CloudProviderPreference = 'gemini' | 'groq' | 'openai' | 'claude' | 'bedrock';

export interface PreferredProviderResolution {
    model: string;
    applied: boolean;
    providerPreference: PreferredProvider;
    reason:
        | 'auto'
        | 'explicit_model_override'
        | 'already_selected'
        | 'preferred_provider_model'
        | 'provider_default_model'
        | 'unsupported_provider_preference'
        | 'invalid_candidate';
}

export interface ResolvePreferredProviderModelArgs {
    currentModel: string;
    currentProvider?: string;
    preferredProvider: PreferredProvider;
    explicitModelOverride?: boolean;
    getPreferredModel?: (provider: CloudProviderPreference) => string | null | undefined;
}

const CLOUD_PROVIDERS = new Set<CloudProviderPreference>(['gemini', 'groq', 'openai', 'claude', 'bedrock']);

function isCloudProvider(provider: PreferredProvider): provider is CloudProviderPreference {
    return CLOUD_PROVIDERS.has(provider as CloudProviderPreference);
}

function resolveCandidateModel(
    provider: PreferredProvider,
    getPreferredModel?: ResolvePreferredProviderModelArgs['getPreferredModel'],
): { model: string | null; reason: PreferredProviderResolution['reason'] } {
    if (provider === 'teamsync') {
        return { model: 'teamsync', reason: 'provider_default_model' };
    }

    if (!isCloudProvider(provider)) {
        return { model: null, reason: 'unsupported_provider_preference' };
    }

    const preferredModel = getPreferredModel?.(provider)?.trim();
    if (preferredModel) {
        return { model: preferredModel, reason: 'preferred_provider_model' };
    }

    const defaultModel = STANDARD_CLOUD_MODELS[provider]?.ids[0];
    return defaultModel
        ? { model: defaultModel, reason: 'provider_default_model' }
        : { model: null, reason: 'unsupported_provider_preference' };
}

export function resolveModelForPreferredProvider(
    args: ResolvePreferredProviderModelArgs,
): PreferredProviderResolution {
    const currentModel = args.currentModel.trim();
    const currentProvider = resolveUiProviderId(currentModel, args.currentProvider);

    if (args.preferredProvider === 'auto') {
        return {
            model: currentModel,
            applied: false,
            providerPreference: args.preferredProvider,
            reason: 'auto',
        };
    }

    if (args.explicitModelOverride) {
        return {
            model: currentModel,
            applied: false,
            providerPreference: args.preferredProvider,
            reason: 'explicit_model_override',
        };
    }

    if (currentProvider === args.preferredProvider) {
        return {
            model: currentModel,
            applied: false,
            providerPreference: args.preferredProvider,
            reason: 'already_selected',
        };
    }

    const candidate = resolveCandidateModel(args.preferredProvider, args.getPreferredModel);
    if (!candidate.model) {
        return {
            model: currentModel,
            applied: false,
            providerPreference: args.preferredProvider,
            reason: candidate.reason,
        };
    }

    const candidateProvider = resolveUiProviderId(
        candidate.model,
        args.preferredProvider === 'bedrock' ? 'bedrock' : undefined,
    );
    if (candidateProvider !== args.preferredProvider) {
        return {
            model: currentModel,
            applied: false,
            providerPreference: args.preferredProvider,
            reason: 'invalid_candidate',
        };
    }

    return {
        model: candidate.model,
        applied: true,
        providerPreference: args.preferredProvider,
        reason: candidate.reason,
    };
}
