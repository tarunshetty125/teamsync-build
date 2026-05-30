import fs from "fs";
import path from "path";
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
        const response = await this.controlClient.send(new ListFoundationModelsCommand({}));
        const models = (response.modelSummaries || [])
            .filter((model): model is FoundationModelSummary & { modelId: string } => {
                return !!model.modelId && model.responseStreamingSupported === true;
            })
            .map(model => ({
                id: model.modelId,
                label: model.modelName || model.modelId,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        console.log("[BEDROCK_MODELS]", {
            count: models.length,
            region: this.region,
        });

        return models;
    }

    async generate(userMessage: string, options: BedrockGenerateOptions = {}): Promise<string> {
        const modelId = this.requireModel(options.modelId);
        const response = await this.runtimeClient.send(new ConverseCommand({
            modelId,
            messages: [await this.buildUserMessage(userMessage, options.imagePaths)],
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
        const response = await this.runtimeClient.send(new ConverseStreamCommand({
            modelId,
            messages: [await this.buildUserMessage(userMessage, options.imagePaths)],
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
        const content: ContentBlock[] = [{ text: userMessage }];
        for (const imagePath of imagePaths || []) {
            const image = await this.readImageContent(imagePath);
            if (image) content.push(image);
        }
        return { role: "user", content };
    }

    private async readImageContent(imagePath: string): Promise<ContentBlock | null> {
        if (!fs.existsSync(imagePath)) return null;
        const ext = path.extname(imagePath).toLowerCase().replace(".", "");
        const format = ext === "jpg" ? "jpeg" : ext;
        if (!["png", "jpeg", "gif", "webp"].includes(format)) {
            console.warn("[BedrockClient] Skipping unsupported image format:", format);
            return null;
        }
        const bytes = await fs.promises.readFile(imagePath);
        return {
            image: {
                format: format as "png" | "jpeg" | "gif" | "webp",
                source: { bytes },
            },
        };
    }
}
