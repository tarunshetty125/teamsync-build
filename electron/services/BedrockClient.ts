import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
    BedrockClient as AwsBedrockClient,
    ListFoundationModelsCommand,
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

export class BedrockClient {
    private readonly credentials: BedrockCredentials;
    private readonly region: string;
    private readonly controlClient: AwsBedrockClient;
    private readonly runtimeClient: BedrockRuntimeClient;
    private modelCache: { models: BedrockModel[]; expiresAt: number } | null = null;

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

    static normalizeError(error: any): string {
        const name = error?.name || error?.Code || error?.code;
        const message = error?.message || error?.Message || "Bedrock request failed";
        const status = error?.$metadata?.httpStatusCode;
        const parts = [name, status ? `HTTP ${status}` : "", message].filter(Boolean);
        return parts.join(": ");
    }

    async validate(): Promise<void> {
        await this.fetchModels();
    }

    async fetchModels(): Promise<BedrockModel[]> {
        if (this.modelCache && Date.now() < this.modelCache.expiresAt) {
            return this.modelCache.models;
        }

        const response = await this.controlClient.send(new ListFoundationModelsCommand({}));
        const models = (response.modelSummaries || [])
            .filter((model): model is FoundationModelSummary & { modelId: string } => {
                return !!model.modelId && model.responseStreamingSupported === true;
            })
            .map(model => ({
                id: model.modelId,
                label: model.modelName || model.modelId,
                inputModalities: model.inputModalities?.map(modality => String(modality)),
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        console.log("[BEDROCK_MODELS]", {
            count: models.length,
            region: this.region,
        });

        this.modelCache = {
            models,
            expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
        };

        return models;
    }

    async generate(userMessage: string, options: BedrockGenerateOptions = {}): Promise<string> {
        const modelId = this.requireModel(options.modelId);
        const message = await this.buildUserMessage(userMessage, options.imagePaths);
        this.logMultimodalRequest(modelId, message);
        const response = await this.runtimeClient.send(new ConverseCommand({
            modelId,
            messages: [message],
            ...(options.systemPrompt ? { system: [{ text: options.systemPrompt }] } : {}),
            inferenceConfig: {
                maxTokens: options.maxOutputTokens || DEFAULT_MAX_TOKENS,
                temperature: options.temperature ?? 0.4,
                topP: options.topP ?? 0.9,
            },
        }));

        const content = response.output?.message?.content || [];
        return content.map(block => block.text || "").join("");
    }

    async *stream(userMessage: string, options: BedrockGenerateOptions = {}): AsyncGenerator<string, void, unknown> {
        const modelId = this.requireModel(options.modelId);
        const message = await this.buildUserMessage(userMessage, options.imagePaths);
        this.logMultimodalRequest(modelId, message);
        const response = await this.runtimeClient.send(new ConverseStreamCommand({
            modelId,
            messages: [message],
            ...(options.systemPrompt ? { system: [{ text: options.systemPrompt }] } : {}),
            inferenceConfig: {
                maxTokens: options.maxOutputTokens || DEFAULT_MAX_TOKENS,
                temperature: options.temperature ?? 0.4,
                topP: options.topP ?? 0.9,
            },
        }));

        for await (const event of response.stream || []) {
            const text = event.contentBlockDelta?.delta?.text;
            if (text) yield text;
        }
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
        return resolved.trim();
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
