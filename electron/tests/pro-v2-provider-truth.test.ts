import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
    getProviderModelMetadata,
    isBedrockGptOssUiModel,
} from '../../src/lib/providers/providerModelMetadata.ts';
import {
    applyRoutingMetadataToOwnership,
    extractRoutingOwnershipMetadata,
} from '../../src/lib/overlay/responseRoutingMetadata.ts';
import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Pro V2 canonical provider metadata groups Bedrock GPT-OSS and dynamic providers correctly', () => {
    const bedrockGptOss = getProviderModelMetadata('openai.gpt-oss-120b-1:0');
    const groq = getProviderModelMetadata('llama-3.3-70b-versatile');
    const local = getProviderModelMetadata('ollama-llama3.2');

    assert.equal(bedrockGptOss.providerId, 'bedrock');
    assert.equal(bedrockGptOss.providerLabel, 'Amazon Bedrock');
    assert.equal(bedrockGptOss.isGptOss, true);
    assert.equal(bedrockGptOss.isTextOnly, true);
    assert.equal(groq.providerId, 'groq');
    assert.equal(local.providerId, 'ollama');
});

test('Pro V2 Bedrock metadata exposes region, GPT-OSS, vision, text-only, and access state', () => {
    const visionModel = getProviderModelMetadata('anthropic.claude-3-5-sonnet-20241022-v2:0', {
        explicitProvider: 'bedrock',
        region: 'us-east-1',
        inputModalities: ['TEXT', 'IMAGE'],
        accessState: 'available',
        source: 'dynamic',
    });
    const gptOss = getProviderModelMetadata('openai.gpt-oss-20b-1:0', {
        explicitProvider: 'bedrock',
        region: 'us-west-2',
        inputModalities: ['TEXT'],
        accessState: 'available',
    });

    assert.equal(visionModel.region, 'us-east-1');
    assert.equal(visionModel.isVisionCapable, true);
    assert.equal(visionModel.accessState, 'available');
    assert.equal(gptOss.region, 'us-west-2');
    assert.equal(gptOss.isGptOss, true);
    assert.equal(gptOss.isTextOnly, true);
    assert.equal(isBedrockGptOssUiModel('bedrock:openai.gpt-oss-120b-1:0'), true);
});

test('Pro V2 routing debug metadata persists requested and actual ownership truth', () => {
    const ownership: ResponseOwnership = {
        responseId: 'response-1',
        questionTurnId: 'turn-1',
        transcriptVersion: 1,
        contextTarget: 'latest_turn',
        createdAt: 1000,
        sourceProvider: 'bedrock',
        sourceModel: 'openai.gpt-oss-120b-1:0',
        requestedProvider: 'bedrock',
        requestedModel: 'openai.gpt-oss-120b-1:0',
        actualProvider: 'bedrock',
        actualModel: 'openai.gpt-oss-120b-1:0',
    };
    const debugMetadata = {
        routing: {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'bedrock',
            actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            reason: 'vision_required_model_remap',
        },
        telemetry: {
            fallbackUsed: false,
        },
    };

    const extracted = extractRoutingOwnershipMetadata(debugMetadata);
    const updated = applyRoutingMetadataToOwnership(ownership, debugMetadata);

    assert.equal(extracted.requestedProvider, 'bedrock');
    assert.equal(extracted.actualModel, 'anthropic.claude-3-5-sonnet-20241022-v2:0');
    assert.equal(extracted.routingReason, 'vision_required_model_remap');
    assert.equal(updated?.requestedProvider, 'bedrock');
    assert.equal(updated?.requestedModel, 'openai.gpt-oss-120b-1:0');
    assert.equal(updated?.actualProvider, 'bedrock');
    assert.equal(updated?.actualModel, 'anthropic.claude-3-5-sonnet-20241022-v2:0');
    assert.equal(updated?.routingReason, 'vision_required_model_remap');
    assert.equal(updated?.sourceModel, 'openai.gpt-oss-120b-1:0');
});

test('Pro V2 selector and overlay surfaces consume canonical provider metadata', () => {
    const selector = read('src/components/ModelSelectorWindow.tsx');
    const controlStrip = read('src/components/pro-v2/ProOverlayControlStrip.tsx');
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const streams = read('src/components/pro-v2/useOverlayIpcStreams.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const types = read('src/lib/overlay/actionContextTypes.ts');

    assert.match(selector, /getProviderModelMetadata/);
    assert.match(selector, /providerFetchErrors/);
    assert.match(selector, /GPT-OSS/);
    assert.match(selector, /Vision/);
    assert.match(selector, /Text-only/);
    assert.match(selector, /Access:/);
    assert.match(selector, /bedrockRegion/);
    assert.match(controlStrip, /modelMetadata\.statusLabel/);
    assert.match(controlStrip, /v2-overlay-model-status/);
    assert.match(surface, /ownership\?\.requestedProvider/);
    assert.match(surface, /ownership\?\.actualProvider/);
    assert.match(surface, /ownership\?\.routingReason/);
    assert.match(surface, /label: 'Route'/);
    assert.match(streams, /applyRoutingMetadataToOwnership/);
    assert.match(streams, /data\.debugMetadata/);
    assert.match(bridge, /requestedProvider: sourceProvider/);
    assert.match(bridge, /actualProvider: sourceProvider/);
    assert.match(types, /requestedProvider\?: string/);
    assert.match(types, /actualModel\?: string/);
});
