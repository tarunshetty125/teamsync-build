import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
    BedrockClient as AwsBedrockClient,
    ListFoundationModelsCommand,
    ListInferenceProfilesCommand,
    type FoundationModelSummary,
} from "@aws-sdk/client-bedrock";
import {
    BedrockRuntimeClient,
    ConverseCommand,
    ConverseStreamCommand,
    type ContentBlock,
    type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from "@smithy/types";
import type { BedrockCredentials } from "./CredentialsManager";
import { BedrockCapabilityRegistry } from "./BedrockCapabilityRegistry";
import { mapBedrockError, formatBedrockError, isBedrockReauthError } from "./BedrockErrorMapper";
import { BedrockTelemetry } from "./BedrockTelemetry";

export interface BedrockModel {
    id: string;
    label: string;
    inputModalities?: string[];
}

export interface BedrockGenerateOptions {
    modelId?: string;
    systemPrompt?: string;
    imagePaths?: string[];
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
}

const DEFAULT_REGION = "us-east-1";
const DEFAULT_MAX_TOKENS = 4096;
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_BEDROCK_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_BEDROCK_IMAGE_DIMENSION = 1600;
const SUPPORTED_IMAGE_FORMATS = ["png", "jpeg", "webp"] as const;
type SupportedImageFormat = typeof SUPPORTED_IMAGE_FORMATS[number];

/** Default streaming timeout: 90 seconds. Prevents hung streams. */
const STREAM_TIMEOUT_MS = 90_000;

/**
 * Static model cache keyed by region.
 * Shared across all BedrockClient instances in the same region so that
 * test/fetch and runtime clients don't re-fetch independently.
 */
const regionModelCaches = new Map<string, { models: BedrockModel[]; expiresAt: number }>();

export class BedrockClient {
    private readonly credentials: BedrockCredentials;
    private readonly region: string;
    private readonly controlClient: AwsBedrockClient;
    private readonly runtimeClient: BedrockRuntimeClient;

    constructor(credentials: BedrockCredentials) {
        this.credentials = {
            ...credentials,
            region: credentials.region?.trim() || DEFAULT_REGION,
        };
        this.region = this.credentials.region;

        const config = {
            region: this.region,
            credentials: this.resolveCredentials(this.credentials),
        };

        this.controlClient = new AwsBedrockClient(config);
        this.runtimeClient = new BedrockRuntimeClient(config);
    }

    /**
     * @deprecated Use formatBedrockError() or mapBedrockError() from BedrockErrorMapper.
     * Kept for backward compatibility with existing callers.
     */
    static normalizeError(error: any): string {
        return formatBedrockError(error);
    }

    /**
     * Validate credentials with a lightweight API call.
     * Bypasses the model cache to ensure we actually test credential validity.
     * Uses maxResults=1 to minimize response size.
     */
    async validate(): Promise<void> {
        await this.controlClient.send(new ListFoundationModelsCommand({
            // @ts-ignore — maxResults is supported but not in all SDK type versions
            maxResults: 1,
        }));
    }

    /**
     * Fetch models from ListFoundationModels and populate the capability registry.
     * Uses a static cache shared across all instances for the same region.
     */
    async fetchModels(): Promise<BedrockModel[]> {
        const cached = regionModelCaches.get(this.region);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.models;
        }

        const response = await this.controlClient.send(new ListFoundationModelsCommand({}));
        const rawSummaries = response.modelSummaries || [];

        // Populate the capability registry with full metadata BEFORE filtering
        const registry = BedrockCapabilityRegistry.forRegion(this.region);
        registry.populate(rawSummaries);

        // Filter and project to the slim BedrockModel interface for backward compatibility
        const models = rawSummaries
            .filter((model): model is FoundationModelSummary & { modelId: string } => {
                if (!model.modelId) return false;
                if (model.responseStreamingSupported !== true) return false;
                // Filter out deprecated/legacy models
                const lifecycle = model.modelLifecycle?.status;
                if (lifecycle === 'DEPRECATED') return false;
                return true;
            })
            .map(model => ({
                id: model.modelId,
                label: model.modelName || model.modelId,
                inputModalities: model.inputModalities?.map(modality => String(modality)),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        // Discover inference profiles and merge into registry (non-blocking on failure)
        await this.fetchInferenceProfiles(registry);

        console.log("[BEDROCK_MODELS]", {
            count: models.length,
            region: this.region,
            registrySize: registry.getAll().length,
        });

        regionModelCaches.set(this.region, {
            models,
            expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
        });

        return models;
    }

    /**
     * Fetch inference profiles and register them in the capability registry.
     *
     * Inference profiles enable cross-region model invocation. When a profile
     * exists for a foundation model, the profile ID should be preferred for
     * invocation because it may be the ONLY way to access certain models
     * in certain regions.
     *
     * This method is non-blocking: errors are caught and logged. Accounts or
     * regions without inference profile support will gracefully fall back to
     * direct foundation model IDs.
     */
    private async fetchInferenceProfiles(registry: BedrockCapabilityRegistry): Promise<void> {
        try {
            const profiles: Array<{ profileId: string; profileName: string; modelId?: string }> = [];
            let nextToken: string | undefined;

            // Paginate through all inference profiles
            do {
                const response = await this.controlClient.send(
                    new ListInferenceProfilesCommand({
                        nextToken,
                        maxResults: 100,
                    }),
                );

                for (const profile of response.inferenceProfileSummaries || []) {
                    if (!profile.inferenceProfileId) continue;

                    // Extract the foundation model ID from the profile
                    // The profile's models array contains the underlying foundation model(s)
                    const foundationModelId = profile.models?.[0]?.modelArn?.split('/')?.pop()
                        || this.extractFoundationModelId(profile.inferenceProfileId);

                    profiles.push({
                        profileId: profile.inferenceProfileId,
                        profileName: profile.inferenceProfileName || profile.inferenceProfileId,
                        modelId: foundationModelId,
                    });
                }

                nextToken = response.nextToken;
            } while (nextToken);

            // Register profiles in the capability registry
            for (const profile of profiles) {
                if (profile.modelId) {
                    registry.addInferenceProfile(profile.profileId, profile.modelId, profile.profileName);
                }
            }

            if (profiles.length > 0) {
                console.log('[BEDROCK_INFERENCE_PROFILES]', {
                    count: profiles.length,
                    region: this.region,
                    profileIds: profiles.slice(0, 5).map(p => p.profileId),
                });
            }
        } catch (error: any) {
            // Non-fatal: inference profiles may not be available in all regions/accounts
            // The system falls back to direct foundation model IDs
            console.warn('[BEDROCK_INFERENCE_PROFILES] Discovery failed (non-fatal):', error?.name || error?.message);
        }
    }

    /**
     * Extract the likely foundation model ID from an inference profile ID.
     * Inference profile IDs follow the pattern: <region-prefix>.<provider>.<model>
     * Foundation model IDs follow: <provider>.<model>
     *
     * Example:
     *   us.anthropic.claude-sonnet-4-20260514-v1:0 → anthropic.claude-sonnet-4-20260514-v1:0
     */
    private extractFoundationModelId(profileId: string): string {
        const regionPrefixMatch = profileId.match(/^(?:us|eu|apac|ap|me|af|sa|ca)\.(.*)/i);
        return regionPrefixMatch ? regionPrefixMatch[1] : profileId;
    }

    /**
     * Non-streaming generation with AbortController support.
     *
     * @param signal - AbortSignal for cancellation and timeout.
     */
    async generate(userMessage: string, options: BedrockGenerateOptions = {}, signal?: AbortSignal): Promise<string> {
        const modelId = this.requireModel(options.modelId);
        const resolvedMaxTokens = this.resolveMaxOutputTokens(modelId, options.maxOutputTokens);
        const message = await this.buildUserMessage(userMessage, options.imagePaths);
        this.logMultimodalRequest(modelId, message);

        const response = await this.runtimeClient.send(
            new ConverseCommand({
                modelId,
                messages: [message],
                ...(options.systemPrompt ? { system: [{ text: options.systemPrompt }] } : {}),
                inferenceConfig: {
                    maxTokens: resolvedMaxTokens,
                    temperature: options.temperature ?? 0.4,
                    topP: options.topP ?? 0.9,
                },
            }),
            ...(signal ? [{ abortSignal: signal }] : []),
        );

        const content = response.output?.message?.content || [];
        return content.map(block => block.text || "").join("");
    }

    /**
     * Streaming generation with AbortController and timeout support.
     *
     * @param signal - AbortSignal for user cancellation. If not provided, a
     *   timeout-only signal (90s) is used to prevent hung streams.
     */
    async *stream(userMessage: string, options: BedrockGenerateOptions = {}, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        const modelId = this.requireModel(options.modelId);
        const resolvedMaxTokens = this.resolveMaxOutputTokens(modelId, options.maxOutputTokens);
        const message = await this.buildUserMessage(userMessage, options.imagePaths);
        this.logMultimodalRequest(modelId, message);

        // Compose signals: user cancellation + timeout fallback
        const timeoutSignal = AbortSignal.timeout(STREAM_TIMEOUT_MS);
        const effectiveSignal = signal
            ? composeAbortSignals(signal, timeoutSignal)
            : timeoutSignal;

        const response = await this.runtimeClient.send(
            new ConverseStreamCommand({
                modelId,
                messages: [message],
                ...(options.systemPrompt ? { system: [{ text: options.systemPrompt }] } : {}),
                inferenceConfig: {
                    maxTokens: resolvedMaxTokens,
                    temperature: options.temperature ?? 0.4,
                    topP: options.topP ?? 0.9,
                },
            }),
            { abortSignal: effectiveSignal },
        );

        try {
            for await (const event of response.stream || []) {
                if (effectiveSignal.aborted) return;
                const text = event.contentBlockDelta?.delta?.text;
                if (text) yield text;
            }
        } finally {
            // Cleanup: if we composed signals, release the composed controller
            if (signal && (effectiveSignal as any).__controller) {
                (effectiveSignal as any).__controller.abort();
            }
        }
    }

    /**
     * Get the capability registry for this client's region.
     */
    getRegistry(): BedrockCapabilityRegistry {
        return BedrockCapabilityRegistry.forRegion(this.region);
    }

    /**
     * Invalidate the static model cache for this region.
     * Forces the next fetchModels() to re-query the API.
     */
    invalidateCache(): void {
        regionModelCaches.delete(this.region);
    }

    /**
     * Get the configured region.
     */
    getRegion(): string {
        return this.region;
    }

    // ─── Private Methods ──────────────────────────────────────────────

    /**
     * Resolve max output tokens for a model.
     * Uses the capability registry for model-specific limits instead of
     * the hardcoded DEFAULT_MAX_TOKENS constant.
     */
    private resolveMaxOutputTokens(modelId: string, override?: number): number {
        if (override && override > 0) return override;
        const registry = BedrockCapabilityRegistry.forRegion(this.region);
        if (registry.isPopulated()) {
            return registry.getMaxOutputTokens(modelId);
        }
        return DEFAULT_MAX_TOKENS;
    }

    private resolveCredentials(credentials: BedrockCredentials): AwsCredentialIdentity | AwsCredentialIdentityProvider {
        if (credentials.authMode === "access_keys") {
            const accessKeyId = credentials.accessKeyId?.trim();
            const secretAccessKey = credentials.secretAccessKey?.trim();
            if (!accessKeyId || !secretAccessKey) {
                throw new Error("AWS Access Key ID and Secret Access Key are required.");
            }
            return {
                accessKeyId,
                secretAccessKey,
                ...(credentials.sessionToken?.trim() ? { sessionToken: credentials.sessionToken.trim() } : {}),
            };
        }

        return fromNodeProviderChain({
            ...(credentials.profileName?.trim() ? { profile: credentials.profileName.trim() } : {}),
            clientConfig: { region: this.region },
        });
    }

    private requireModel(modelId?: string): string {
        const resolved = modelId || this.credentials.preferredModel;
        if (!resolved?.trim()) {
            throw new Error("No Bedrock model selected. Fetch models and choose a model first.");
        }
        const trimmed = resolved.trim();

        // Prefer inference profile ID when available — required for models
        // that are only accessible via cross-region inference profiles.
        const registry = BedrockCapabilityRegistry.forRegion(this.region);
        if (registry.isPopulated()) {
            const invocationId = registry.getInvocationId(trimmed);
            if (invocationId !== trimmed) {
                console.log('[BEDROCK_INVOKE]', { requested: trimmed, resolved: invocationId, source: 'inference_profile' });
                BedrockTelemetry.recordInferenceProfileUsage();
            }
            return invocationId;
        }

        return trimmed;
    }

    private async buildUserMessage(userMessage: string, imagePaths?: string[]): Promise<Message> {
        const content: ContentBlock[] = [];
        for (const imagePath of imagePaths || []) {
            content.push(await this.readImageContent(imagePath));
        }
        content.push({ text: userMessage });
        return { role: "user", content };
    }

    private async readImageContent(imagePath: string): Promise<ContentBlock> {
        if (!fs.existsSync(imagePath)) {
            throw new Error(`Bedrock image file not found: ${path.basename(imagePath)}`);
        }

        const ext = path.extname(imagePath).toLowerCase().replace(".", "");
        const initialFormat = ext === "jpg" ? "jpeg" : ext;
        if (!this.isSupportedImageFormat(initialFormat)) {
            throw new Error(`Unsupported Bedrock image format ".${ext}". Supported formats: png, jpg, jpeg, webp.`);
        }

        const { bytes, format } = await this.prepareImageBytes(imagePath, initialFormat);
        return {
            image: {
                format,
                source: { bytes },
            },
        };
    }

    private isSupportedImageFormat(format: string): format is SupportedImageFormat {
        return SUPPORTED_IMAGE_FORMATS.includes(format as SupportedImageFormat);
    }

    private async prepareImageBytes(imagePath: string, format: SupportedImageFormat): Promise<{ bytes: Buffer; format: SupportedImageFormat }> {
        const originalBytes = await fs.promises.readFile(imagePath);
        if (originalBytes.byteLength <= MAX_BEDROCK_IMAGE_BYTES) {
            return { bytes: originalBytes, format };
        }

        const resized = sharp(originalBytes, { failOn: "none" })
            .rotate()
            .resize({
                width: MAX_BEDROCK_IMAGE_DIMENSION,
                height: MAX_BEDROCK_IMAGE_DIMENSION,
                fit: "inside",
                withoutEnlargement: true,
            });

        const primaryBytes = await this.encodeImage(resized.clone(), format, 80);
        if (primaryBytes.byteLength <= MAX_BEDROCK_IMAGE_BYTES) {
            return { bytes: primaryBytes, format };
        }

        const jpegBytes = await this.encodeImage(
            sharp(originalBytes, { failOn: "none" })
                .rotate()
                .resize({
                    width: 1280,
                    height: 1280,
                    fit: "inside",
                    withoutEnlargement: true,
                }),
            "jpeg",
            72,
        );
        if (jpegBytes.byteLength <= MAX_BEDROCK_IMAGE_BYTES) {
            return { bytes: jpegBytes, format: "jpeg" };
        }

        throw new Error(`Bedrock image exceeds 4MB after compression: ${path.basename(imagePath)}`);
    }

    private async encodeImage(image: sharp.Sharp, format: SupportedImageFormat, quality: number): Promise<Buffer> {
        if (format === "webp") {
            return image.webp({ quality }).toBuffer();
        }

        if (format === "png") {
            return image.png({ compressionLevel: 9, palette: true }).toBuffer();
        }

        return image.jpeg({ quality, mozjpeg: true }).toBuffer();
    }

    private logMultimodalRequest(modelId: string, message: Message): void {
        const contentTypes = (message.content || []).map(block => {
            if (block.image?.format) return `image/${block.image.format}`;
            if (block.text !== undefined) return "text";
            return "unknown";
        });

        if (!contentTypes.some(type => type.startsWith("image/"))) return;

        console.log("[BEDROCK_MULTIMODAL]", {
            provider: "bedrock",
            model: modelId,
            contentTypes,
        });
    }
}

// Re-export error utilities for backward compatibility
export { mapBedrockError, formatBedrockError, isBedrockReauthError };

// ─── AbortSignal Composition ──────────────────────────────────────────────

/**
 * Compose two AbortSignals into one that aborts when EITHER fires.
 * Required because AbortSignal.any() is not available in all Node.js versions.
 */
function composeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
    if (a.aborted) return a;
    if (b.aborted) return b;

    // Use AbortSignal.any if available (Node 20+)
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any([a, b]);
    }

    // Fallback: manual composition
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    a.addEventListener('abort', onAbort, { once: true });
    b.addEventListener('abort', onAbort, { once: true });

    // Attach controller reference for cleanup
    (controller.signal as any).__controller = controller;
    return controller.signal;
}
