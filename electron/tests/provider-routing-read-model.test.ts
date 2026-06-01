import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildProviderRoutingReadModel,
    type ProviderRoutingMessage,
} from '../../src/lib/providers/providerRoutingReadModel.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function ownershipMessage(
    id: string,
    routing: {
        requestedProvider: string;
        requestedModel: string;
        actualProvider?: string;
        actualModel?: string;
        routingReason?: string;
    },
): ProviderRoutingMessage {
    return {
        id,
        timestamp: 1000,
        ownership: {
            responseId: id,
            questionTurnId: `turn-${id}`,
            transcriptVersion: 1,
            contextTarget: 'latest_turn',
            actionId: 'what_to_answer',
            mode: 'coding',
            createdAt: 1000,
            sourceProvider: routing.requestedProvider,
            sourceModel: routing.requestedModel,
            requestedProvider: routing.requestedProvider,
            requestedModel: routing.requestedModel,
            actualProvider: routing.actualProvider ?? routing.requestedProvider,
            actualModel: routing.actualModel ?? routing.requestedModel,
            routingReason: routing.routingReason,
        },
    };
}

test('Sprint 7 Phase B derives active routing truth from ResponseOwnership', () => {
    const model = buildProviderRoutingReadModel({
        responses: [
            ownershipMessage('response-1', {
                requestedProvider: 'groq',
                requestedModel: 'llama-3.3-70b-versatile',
            }),
            ownershipMessage('response-2', {
                requestedProvider: 'bedrock',
                requestedModel: 'openai.gpt-oss-120b-1:0',
                actualProvider: 'bedrock',
                actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                routingReason: 'vision_required_model_remap',
            }),
        ],
        activeResponseId: 'response-2',
        now: 2000,
    });

    assert.equal(model.generatedAt, 2000);
    assert.equal(model.routes.length, 2);
    assert.equal(model.activeRoute?.responseId, 'response-2');
    assert.equal(model.activeRoute?.source, 'ownership');
    assert.equal(model.activeRoute?.requestedProvider, 'bedrock');
    assert.equal(model.activeRoute?.actualModel, 'anthropic.claude-3-5-sonnet-20241022-v2:0');
    assert.equal(model.activeRoute?.routingReason, 'vision_required_model_remap');
    assert.equal(model.activeRoute?.routeChanged, true);
    assert.equal(model.activeRoute?.fallbackUsed, false);
    assert.equal(model.activeRoute?.status, 'remapped');
    assert.equal(model.summary.totalRoutes, 2);
    assert.equal(model.summary.directCount, 1);
    assert.equal(model.summary.remapCount, 1);
    assert.equal(model.summary.fallbackCount, 0);
    assert.equal(model.summary.byRequestedProvider.bedrock, 1);
    assert.equal(model.summary.byActualProvider.bedrock, 1);
});

test('Sprint 7 Phase B falls back to debug metadata when ownership routing is absent', () => {
    const model = buildProviderRoutingReadModel({
        responses: [
            {
                id: 'response-debug',
                requestId: 'request-debug',
                intelligenceMetadata: {
                    routing: {
                        requestedProvider: 'bedrock',
                        requestedModel: 'openai.gpt-oss-120b-1:0',
                        actualProvider: 'groq',
                        actualModel: 'llama-3.3-70b-versatile',
                        reason: 'bedrock_auth_expired_fallback',
                    },
                    telemetry: {
                        selectedProvider: 'bedrock',
                        selectedModel: 'openai.gpt-oss-120b-1:0',
                        actualInvokedProvider: 'groq',
                        actualInvokedModel: 'llama-3.3-70b-versatile',
                        fallbackUsed: true,
                        fallbackReason: 'bedrock_auth_expired_fallback',
                    },
                    fallbackChain: [
                        { provider: 'bedrock', model: 'openai.gpt-oss-120b-1:0', result: 'failure' },
                        { provider: 'groq', model: 'llama-3.3-70b-versatile', result: 'success' },
                    ],
                },
            },
        ],
        activeResponseId: 'response-debug',
    });
    const route = model.activeRoute;

    assert.equal(route?.source, 'debug_metadata');
    assert.equal(route?.requestedProvider, 'bedrock');
    assert.equal(route?.actualProvider, 'groq');
    assert.equal(route?.routingReason, 'bedrock_auth_expired_fallback');
    assert.equal(route?.routeChanged, true);
    assert.equal(route?.fallbackUsed, true);
    assert.equal(route?.status, 'fallback');
    assert.equal(model.summary.fallbackCount, 1);
    assert.equal(model.summary.byReason.bedrock_auth_expired_fallback, 1);
});

test('Sprint 7 Phase B projects safe local fallback and cache routes without mutating ownership', () => {
    const safeFallback = ownershipMessage('response-safe', {
        requestedProvider: 'claude',
        requestedModel: 'claude-sonnet-4-6',
        actualProvider: 'local',
        actualModel: 'safe_action_fallback',
        routingReason: 'all_attempts_failed',
    });
    const cache = ownershipMessage('response-cache', {
        requestedProvider: 'gemini',
        requestedModel: 'gemini-3.1-flash-lite-preview',
        actualProvider: 'cache',
        actualModel: 'cache_hit',
        routingReason: 'cache_hit',
    });

    const model = buildProviderRoutingReadModel({
        responses: [safeFallback, cache],
    });

    assert.equal(model.byResponseId['response-safe'].status, 'local_fallback');
    assert.equal(model.byResponseId['response-safe'].fallbackUsed, true);
    assert.equal(model.byResponseId['response-safe'].routeChanged, true);
    assert.equal(model.byResponseId['response-cache'].status, 'cache');
    assert.equal(model.summary.localFallbackCount, 1);
    assert.equal(model.summary.cacheCount, 1);
    assert.equal(safeFallback.ownership?.actualProvider, 'local');
    assert.equal(cache.ownership?.actualModel, 'cache_hit');
});

test('Sprint 7 Phase B uses message provider and model as a direct route when no metadata exists', () => {
    const model = buildProviderRoutingReadModel({
        responses: [
            {
                id: 'response-message',
                provider: 'openai',
                model: 'gpt-5.4',
                source: 'Manual Input',
                intent: 'manual_chat',
            },
        ],
        activeResponseId: 'response-message',
    });
    const route = model.activeRoute;

    assert.equal(route?.source, 'message');
    assert.equal(route?.requestedProvider, 'openai');
    assert.equal(route?.requestedModel, 'gpt-5.4');
    assert.equal(route?.actualProvider, 'openai');
    assert.equal(route?.actualModel, 'gpt-5.4');
    assert.equal(route?.status, 'direct');
    assert.equal(route?.routeChanged, false);
    assert.equal(model.summary.directCount, 1);
});

test('Sprint 7 Phase B reports missing active response without selecting another route', () => {
    const model = buildProviderRoutingReadModel({
        responses: [
            ownershipMessage('response-1', {
                requestedProvider: 'groq',
                requestedModel: 'llama-3.3-70b-versatile',
            }),
        ],
        activeResponseId: 'missing-response',
    });

    assert.equal(model.activeResponseId, 'missing-response');
    assert.equal(model.activeRoute, null);
    assert.equal(model.routes.length, 1);
});

test('Sprint 7 Phase B remains a read model without provider routing, ownership, or persistence changes', () => {
    const helper = read('src/lib/providers/providerRoutingReadModel.ts');
    const routing = read('electron/LLMHelper.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');

    assert.match(helper, /buildProviderRoutingReadModel/);
    assert.doesNotMatch(helper, /CredentialsManager/);
    assert.doesNotMatch(helper, /LLMHelper/);
    assert.doesNotMatch(helper, /BenchmarkManager/);
    assert.doesNotMatch(helper, /ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(helper, /electron-store|new Store/);
    assert.match(routing, /resolveRoutingDecision/);
    assert.match(ownership, /requestedProvider\?: string/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
});
