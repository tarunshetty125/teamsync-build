/**
 * BedrockCapabilityRegistry — Metadata-driven model capability storage.
 *
 * Replaces all hardcoded model checks (isBedrockVisionModel, getBedrockVisionModelRank,
 * BEDROCK_MAX_OUTPUT_TOKENS, etc.) with a single registry populated from
 * ListFoundationModels API responses.
 *
 * Design principles:
 *   1. Capabilities (vision, streaming, modalities) are ALWAYS derived from API metadata.
 *      Never from string matching on model IDs.
 *   2. Token limits use provider-family prefix lookup because AWS does NOT expose them
 *      via ListFoundationModels. This is the ONLY acceptable use of prefix matching.
 *   3. The registry is a process-level singleton keyed by region.
 *   4. All consumers (ModelCapabilities, BedrockVisionAdapter, ProviderPromptBuilder,
 *      LLMHelper) query this registry instead of implementing their own model checks.
 */

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Provider family — resolved from the AWS model ID prefix structure.
 * Used ONLY for prompt profile selection and token budget defaults.
 */
export type BedrockProviderFamily =
    | 'claude'
    | 'nova'
    | 'titan'
    | 'llama'
    | 'gpt-oss'
    | 'mistral'
    | 'cohere'
    | 'ai21'
    | 'deepseek'
    | 'unknown';

/**
 * Prompt profile — determines system prompt augmentation strategy.
 * Mapped from provider family.
 */
export type BedrockPromptProfile =
    | 'claude'
    | 'nova'
    | 'llama'
    | 'gpt-oss'
    | 'generic';

/**
 * Full capability record for a single Bedrock model.
 * Populated from ListFoundationModels API response + provider family defaults.
 */
export interface BedrockModelCapability {
    /** Foundation model ID (e.g., "anthropic.claude-sonnet-4-20260514-v1:0") */
    id: string;
    /** Human-readable model name (e.g., "Claude Sonnet 4") */
    name: string;
    /** AWS provider name (e.g., "Anthropic", "Amazon", "Meta") */
    providerName: string;
    /** Resolved provider family for prompt/token defaults */
    providerFamily: BedrockProviderFamily;
    /** Input modalities from API (e.g., ['TEXT', 'IMAGE']) */
    inputModalities: string[];
    /** Output modalities from API (e.g., ['TEXT']) */
    outputModalities: string[];
    /** Whether the model supports response streaming */
    streaming: boolean;
    /** Whether the model accepts image input — derived from inputModalities */
    vision: boolean;
    /** Maximum input tokens (from provider family defaults) */
    maxInputTokens: number;
    /** Maximum output tokens (from provider family defaults) */
    maxOutputTokens: number;
    /** Lifecycle status: ACTIVE, LEGACY, DEPRECATED */
    lifecycle: string;
    /** Supported inference types: ON_DEMAND, PROVISIONED */
    inferenceTypes: string[];
    /** Prompt profile for system prompt augmentation */
    promptProfile: BedrockPromptProfile;
    /** Whether this entry came from a foundation model or inference profile */
    source: 'foundation' | 'inference_profile';
    /** Inference profile ID, if one maps to this model */
    inferenceProfileId?: string;
}

// ─── Token Limits ────────────────────────────────────────────────────────
//
// AWS does NOT expose token limits in ListFoundationModels.
// These are resolved from the provider family prefix of the model ID,
// which is a stable structural property of the AWS model ID format.
//
// Updated to reflect 2026 model capabilities.

const PROVIDER_TOKEN_LIMITS: Record<BedrockProviderFamily, { maxInput: number; maxOutput: number }> = {
    claude:    { maxInput: 200_000, maxOutput: 64_000 },
    nova:      { maxInput: 300_000, maxOutput: 5_120 },
    titan:     { maxInput: 8_192,   maxOutput: 8_192 },
    llama:     { maxInput: 128_000, maxOutput: 8_192 },
    'gpt-oss': { maxInput: 128_000, maxOutput: 16_384 },
    mistral:   { maxInput: 32_000,  maxOutput: 8_192 },
    cohere:    { maxInput: 128_000, maxOutput: 4_096 },
    ai21:      { maxInput: 8_192,   maxOutput: 8_192 },
    deepseek:  { maxInput: 128_000, maxOutput: 8_192 },
    unknown:   { maxInput: 128_000, maxOutput: 8_192 },
};

// ─── Prompt Profile Mapping ──────────────────────────────────────────────

const FAMILY_TO_PROMPT_PROFILE: Record<BedrockProviderFamily, BedrockPromptProfile> = {
    claude:    'claude',
    nova:      'nova',
    titan:     'generic',
    llama:     'llama',
    'gpt-oss': 'gpt-oss',
    mistral:   'generic',
    cohere:    'generic',
    ai21:      'generic',
    deepseek:  'generic',
    unknown:   'generic',
};

// ─── Provider Family Resolution ──────────────────────────────────────────
//
// Uses the AWS model ID prefix structure. All Bedrock model IDs follow the
// pattern: <provider>.<model-variant>-<version>
// Inference profile IDs prepend a region prefix: <region>.<provider>.<model>

const REGION_PREFIXES = /^(?:us|eu|apac|ap|me|af|sa|ca)\./;

/**
 * Resolve provider family from a Bedrock model ID.
 * Strips region prefixes from inference profile IDs before matching.
 */
export function resolveProviderFamily(modelId: string): BedrockProviderFamily {
    const normalized = modelId.toLowerCase().replace(REGION_PREFIXES, '');

    if (normalized.startsWith('anthropic.claude') || normalized.startsWith('anthropic.')) return 'claude';
    if (normalized.startsWith('amazon.nova'))  return 'nova';
    if (normalized.startsWith('amazon.titan')) return 'titan';
    if (normalized.startsWith('meta.llama'))   return 'llama';
    if (normalized.startsWith('openai.gpt-oss')) return 'gpt-oss';
    if (normalized.startsWith('mistral.'))     return 'mistral';
    if (normalized.startsWith('cohere.'))      return 'cohere';
    if (normalized.startsWith('ai21.'))        return 'ai21';
    if (normalized.startsWith('deepseek.'))    return 'deepseek';
    return 'unknown';
}

// ─── Registry ────────────────────────────────────────────────────────────

/**
 * Module-level singleton instance per region.
 * Keyed by region so multiple BedrockClient instances for different regions
 * can share their respective model metadata.
 */
const registries = new Map<string, BedrockCapabilityRegistry>();

export class BedrockCapabilityRegistry {
    private readonly models = new Map<string, BedrockModelCapability>();
    private readonly region: string;
    private populatedAt: number = 0;

    private constructor(region: string) {
        this.region = region;
    }

    /**
     * Get or create the singleton registry for a given region.
     */
    static forRegion(region: string): BedrockCapabilityRegistry {
        const key = region.toLowerCase().trim();
        let registry = registries.get(key);
        if (!registry) {
            registry = new BedrockCapabilityRegistry(key);
            registries.set(key, registry);
        }
        return registry;
    }

    /**
     * Look up the first registry that has been populated (for cross-module access
     * when the exact region is not known). Returns null if no registry is populated.
     */
    static getActive(): BedrockCapabilityRegistry | null {
        for (const registry of registries.values()) {
            if (registry.populatedAt > 0) return registry;
        }
        return null;
    }

    /**
     * Populate registry from ListFoundationModels API response data.
     * Replaces existing entries for the same model IDs.
     *
     * @param models - Raw model summaries from the AWS API.
     */
    populate(models: Array<{
        modelId: string;
        modelName?: string;
        providerName?: string;
        inputModalities?: string[];
        outputModalities?: string[];
        responseStreamingSupported?: boolean;
        modelLifecycle?: { status?: string };
        inferenceTypesSupported?: string[];
    }>): void {
        for (const model of models) {
            if (!model.modelId) continue;

            const id = model.modelId;
            const family = resolveProviderFamily(id);
            const tokenLimits = PROVIDER_TOKEN_LIMITS[family];
            const inputMods = (model.inputModalities || []).map(m => String(m).toUpperCase());
            const outputMods = (model.outputModalities || []).map(m => String(m).toUpperCase());

            const capability: BedrockModelCapability = {
                id,
                name: model.modelName || id,
                providerName: model.providerName || 'Unknown',
                providerFamily: family,
                inputModalities: inputMods,
                outputModalities: outputMods,
                streaming: model.responseStreamingSupported === true,
                vision: inputMods.includes('IMAGE'),
                maxInputTokens: tokenLimits.maxInput,
                maxOutputTokens: tokenLimits.maxOutput,
                lifecycle: model.modelLifecycle?.status || 'ACTIVE',
                inferenceTypes: (model.inferenceTypesSupported || []).map(t => String(t)),
                promptProfile: FAMILY_TO_PROMPT_PROFILE[family],
                source: 'foundation',
            };

            this.models.set(id, capability);
        }

        this.populatedAt = Date.now();
        console.log(`[BedrockCapabilityRegistry] Populated ${this.models.size} models for region ${this.region}`);
    }

    /**
     * Add or update an inference profile mapping.
     * Associates an inference profile ID with an existing foundation model.
     */
    addInferenceProfile(profileId: string, foundationModelId: string, profileName?: string): void {
        const existing = this.models.get(foundationModelId);
        const family = resolveProviderFamily(profileId);
        const tokenLimits = PROVIDER_TOKEN_LIMITS[family];

        const capability: BedrockModelCapability = {
            id: profileId,
            name: profileName || existing?.name || profileId,
            providerName: existing?.providerName || 'Unknown',
            providerFamily: family,
            inputModalities: existing?.inputModalities || ['TEXT'],
            outputModalities: existing?.outputModalities || ['TEXT'],
            streaming: existing?.streaming ?? true,
            vision: existing?.vision ?? false,
            maxInputTokens: existing?.maxInputTokens ?? tokenLimits.maxInput,
            maxOutputTokens: existing?.maxOutputTokens ?? tokenLimits.maxOutput,
            lifecycle: existing?.lifecycle || 'ACTIVE',
            inferenceTypes: existing?.inferenceTypes || ['ON_DEMAND'],
            promptProfile: FAMILY_TO_PROMPT_PROFILE[family],
            source: 'inference_profile',
            inferenceProfileId: profileId,
        };

        this.models.set(profileId, capability);

        // Also update the foundation model entry with the profile reference
        if (existing && !existing.inferenceProfileId) {
            existing.inferenceProfileId = profileId;
        }
    }

    // ─── Query Methods ────────────────────────────────────────────────

    /** Get full capability record for a model. Returns undefined for unknown models. */
    get(modelId: string): BedrockModelCapability | undefined {
        return this.models.get(modelId) || this.findByNormalizedId(modelId);
    }

    /** Whether the registry has been populated with at least one model. */
    isPopulated(): boolean {
        return this.populatedAt > 0;
    }

    /** Get all registered models. */
    getAll(): BedrockModelCapability[] {
        return Array.from(this.models.values());
    }

    /** Get all active (non-deprecated, non-legacy) streaming models. */
    getActiveStreamingModels(): BedrockModelCapability[] {
        return this.getAll().filter(m =>
            m.streaming &&
            m.lifecycle !== 'LEGACY' &&
            m.lifecycle !== 'DEPRECATED'
        );
    }

    /** Get all vision-capable models, sorted by preference. */
    getVisionModels(): BedrockModelCapability[] {
        return this.getAll()
            .filter(m => m.vision && m.lifecycle !== 'DEPRECATED')
            .sort((a, b) => {
                // Claude vision models first, then Nova, then others
                const familyOrder: Record<string, number> = { claude: 0, nova: 1, llama: 2 };
                const aOrder = familyOrder[a.providerFamily] ?? 99;
                const bOrder = familyOrder[b.providerFamily] ?? 99;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return a.name.localeCompare(b.name);
            });
    }

    // ─── Convenience Methods (replace hardcoded checks) ───────────────

    /**
     * Whether a model supports image input.
     * Uses API-reported inputModalities, NOT string matching.
     *
     * For unknown models (not in registry), returns false as a safe default.
     * This replaces the hardcoded `isBedrockVisionModel()`.
     */
    supportsVision(modelId: string): boolean {
        const cap = this.get(modelId);
        if (!cap) return false;
        return cap.vision;
    }

    /**
     * Get the max output tokens for a model.
     * Uses provider-family defaults (since AWS doesn't expose via API).
     *
     * This replaces the hardcoded `BEDROCK_MAX_OUTPUT_TOKENS = 4096`.
     */
    getMaxOutputTokens(modelId: string): number {
        const cap = this.get(modelId);
        if (cap) return cap.maxOutputTokens;
        // Fall back to provider family from model ID even if not in registry
        const family = resolveProviderFamily(modelId);
        return PROVIDER_TOKEN_LIMITS[family].maxOutput;
    }

    /**
     * Get the max input tokens for a model.
     * This replaces the hardcoded `INPUT_BUDGETS['bedrock'] = 6000`.
     */
    getMaxInputTokens(modelId: string): number {
        const cap = this.get(modelId);
        if (cap) return cap.maxInputTokens;
        const family = resolveProviderFamily(modelId);
        return PROVIDER_TOKEN_LIMITS[family].maxInput;
    }

    /**
     * Get the prompt profile for a model.
     * This replaces the hardcoded "BEDROCK GPT-OSS REASONING PROFILE" for all models.
     */
    getPromptProfile(modelId: string): BedrockPromptProfile {
        const cap = this.get(modelId);
        if (cap) return cap.promptProfile;
        const family = resolveProviderFamily(modelId);
        return FAMILY_TO_PROMPT_PROFILE[family];
    }

    /**
     * Get the provider family for a model.
     */
    getProviderFamily(modelId: string): BedrockProviderFamily {
        const cap = this.get(modelId);
        if (cap) return cap.providerFamily;
        return resolveProviderFamily(modelId);
    }

    /**
     * Get the preferred invocation ID for a model.
     * If an inference profile exists, returns the profile ID.
     * Otherwise returns the foundation model ID.
     */
    getInvocationId(modelId: string): string {
        const cap = this.get(modelId);
        if (cap?.inferenceProfileId) return cap.inferenceProfileId;
        return modelId;
    }

    /**
     * Resolve the best vision model from registered models.
     * Returns the inference profile ID when available.
     *
     * This replaces `resolveBedrockVisionModel()` with metadata-driven selection.
     */
    resolveBestVisionModel(): string | undefined {
        const visionModels = this.getVisionModels();
        if (visionModels.length === 0) return undefined;
        const best = visionModels[0];
        return best.inferenceProfileId || best.id;
    }

    // ─── Internal ─────────────────────────────────────────────────────

    /**
     * Try to find a model by stripping region prefixes and comparing normalized IDs.
     * Handles inference profile IDs that may have been registered under their
     * foundation model ID.
     */
    private findByNormalizedId(modelId: string): BedrockModelCapability | undefined {
        const stripped = modelId.replace(REGION_PREFIXES, '');
        if (stripped !== modelId) {
            const found = this.models.get(stripped);
            if (found) return found;
        }

        // Check if any entry's inferenceProfileId matches
        for (const cap of this.models.values()) {
            if (cap.inferenceProfileId === modelId) return cap;
        }

        return undefined;
    }
}
