import type { BedrockClient } from '../services/BedrockClient';
import { resolveBedrockModelId, resolveBedrockVisionModel } from './BedrockModelIds';

export interface BedrockRuntimeRoute {
    modelId: string;
    hasImages: boolean;
    imageCount: number;
}

export async function resolveBedrockRuntimeRoute(args: {
    client: BedrockClient;
    requestedModel?: string;
    preferredModel?: string;
    imagePaths?: string[];
}): Promise<BedrockRuntimeRoute> {
    const imageCount = (args.imagePaths || []).filter(Boolean).length;

    if (imageCount > 0) {
        const models = await args.client.fetchModels();
        const requestedVisionModel = resolveBedrockModelId(args.requestedModel, args.preferredModel);
        const requestedModelEntry = requestedVisionModel
            ? models.find((model) => model.id === requestedVisionModel)
            : undefined;
        if (
            requestedVisionModel
            && requestedModelEntry
            && (!requestedModelEntry.inputModalities?.length
                || requestedModelEntry.inputModalities.some((modality) => modality.toUpperCase() === 'IMAGE'))
        ) {
            return {
                modelId: requestedVisionModel,
                hasImages: true,
                imageCount,
            };
        }

        const visionModel = resolveBedrockVisionModel(models);
        if (!visionModel) {
            throw new Error('No Bedrock multimodal model available. Enable Claude Sonnet or Amazon Nova model access in Amazon Bedrock for this region/account.');
        }

        return {
            modelId: visionModel,
            hasImages: true,
            imageCount,
        };
    }

    const textModel = resolveBedrockModelId(args.requestedModel, args.preferredModel);
    if (!textModel) {
        throw new Error('No Bedrock model selected');
    }

    return {
        modelId: textModel,
        hasImages: false,
        imageCount: 0,
    };
}
