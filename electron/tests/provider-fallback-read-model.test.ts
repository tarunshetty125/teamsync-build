import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildProviderFallbackReadModel,
    type ProviderFallbackReadModel,
} from '../../src/lib/providers/providerFallbackReadModel.ts';
import type { ProviderRoutingMessage } from '../../src/lib/providers/providerRoutingReadModel.ts';

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

function buildModel(responses: ProviderRoutingMessage[], activeResponseId?: string): ProviderFallbackReadModel {
    return buildProviderFallbackReadModel({
        responses,
        activeResponseId,
        now: 2000,
    });
}

test('Sprint 7 Phase C projects Bedrock auth-expired provider fallback attempts', () => {
    const model = buildModel([
        {
            id: 'response-auth',
            requestId: 'request-auth',
            questionTurnId: 'turn-auth',
            intelligenceMetadata: {
                routing: {
                    requestedProvider: 'bedrock',
                    requestedModel: 'openai.gpt-oss-120b-1:0',
                    actualProvider: 'groq',
                    actualModel: 'llama-3.3-70b-versatile',
                    reason: 'bedrock_auth_expired_fallback',
                },
                telemetry: {
                    fallbackUsed: true,
                    fallbackReason: 'bedrock_auth_expired_fallback',
                },
                fallbackChain: [
                    {
                        provider: 'bedrock',
                        model: 'openai.gpt-oss-120b-1:0',
                        result: 'failure',
                        reason: 'AWS SSO session expired, please reauth',
                        startedAt: 100,
                        completedAt: 250,
                    },
                    {
                        provider: 'groq',
                        model: 'llama-3.3-70b-versatile',
                        result: 'success',
                        startedAt: 260,
                        completedAt: 500,
                    },
                ],
            },
        },
    ], 'response-auth');
    const fallback = model.activeFallback;

    assert.equal(model.generatedAt, 2000);
    assert.equal(model.summary.totalFallbacks, 1);
    assert.equal(fallback?.responseId, 'response-auth');
    assert.equal(fallback?.requestId, 'request-auth');
    assert.equal(fallback?.requestedProvider, 'bedrock');
    assert.equal(fallback?.actualProvider, 'groq');
    assert.equal(fallback?.fallbackReason, 'bedrock_auth_expired_fallback');
    assert.equal(fallback?.category, 'auth_expired');
    assert.equal(fallback?.providerFallback, true);
    assert.equal(fallback?.safeFallback, false);
    assert.equal(fallback?.validationFallback, false);
    assert.equal(fallback?.source, 'debug_metadata');
    assert.equal(fallback?.attempts.length, 2);
    assert.equal(fallback?.attempts[0]?.durationMs, 150);
    assert.equal(fallback?.failedAttemptCount, 1);
    assert.equal(fallback?.successfulAttempt?.provider, 'groq');
    assert.equal(model.summary.providerFallbackCount, 1);
    assert.equal(model.summary.successfulFallbackCount, 1);
    assert.equal(model.summary.failedAttemptCount, 1);
    assert.equal(model.summary.byCategory.auth_expired, 1);
    assert.equal(model.summary.byRequestedProvider.bedrock, 1);
    assert.equal(model.summary.byActualProvider.groq, 1);
    assert.equal(model.summary.byReason.bedrock_auth_expired_fallback, 1);
});

test('Sprint 7 Phase C projects ownership-only safe local fallback', () => {
    const model = buildModel([
        ownershipMessage('response-safe', {
            requestedProvider: 'claude',
            requestedModel: 'claude-sonnet-4-6',
            actualProvider: 'local',
            actualModel: 'safe_action_fallback',
            routingReason: 'all_attempts_failed',
        }),
    ], 'response-safe');
    const fallback = model.activeFallback;

    assert.equal(fallback?.source, 'ownership');
    assert.equal(fallback?.category, 'safe_fallback');
    assert.equal(fallback?.safeFallback, true);
    assert.equal(fallback?.providerFallback, true);
    assert.equal(fallback?.validationFallback, false);
    assert.equal(fallback?.attempts.length, 0);
    assert.equal(model.summary.safeFallbackCount, 1);
    assert.equal(model.summary.providerFallbackCount, 1);
    assert.equal(model.summary.byReason.all_attempts_failed, 1);
});

test('Sprint 7 Phase C classifies validator-driven fallback separately from provider fallback', () => {
    const model = buildModel([
        {
            id: 'response-validation',
            intelligenceMetadata: {
                routing: {
                    requestedProvider: 'gemini',
                    requestedModel: 'gemini-3.1-flash-lite-preview',
                    actualProvider: 'local',
                    actualModel: 'safe_action_fallback',
                    reason: 'validation_failed_repair_invalid',
                },
                telemetry: {
                    fallbackUsed: true,
                    fallbackReason: 'validation_failed_repair_invalid',
                },
                validation: {
                    valid: false,
                    reason: 'contract sections missing',
                },
            },
        },
    ], 'response-validation');
    const fallback = model.activeFallback;

    assert.equal(fallback?.category, 'validation_failed');
    assert.equal(fallback?.safeFallback, true);
    assert.equal(fallback?.providerFallback, false);
    assert.equal(fallback?.validationFallback, true);
    assert.equal(model.summary.validationFallbackCount, 1);
    assert.equal(model.summary.safeFallbackCount, 1);
    assert.equal(model.summary.providerFallbackCount, 0);
});

test('Sprint 7 Phase C excludes remaps, cache hits, and direct routes without fallback signals', () => {
    const model = buildModel([
        ownershipMessage('response-remap', {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'bedrock',
            actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            routingReason: 'vision_required_model_remap',
        }),
        ownershipMessage('response-cache', {
            requestedProvider: 'gemini',
            requestedModel: 'gemini-3.1-flash-lite-preview',
            actualProvider: 'cache',
            actualModel: 'cache_hit',
            routingReason: 'cache_hit',
        }),
        {
            id: 'response-direct',
            provider: 'openai',
            model: 'gpt-5.4',
            intent: 'manual_chat',
        },
        {
            id: 'response-empty-chain',
            provider: 'groq',
            model: 'llama-3.3-70b-versatile',
            intelligenceMetadata: {
                fallbackChain: [],
                routing: {
                    requestedProvider: 'groq',
                    requestedModel: 'llama-3.3-70b-versatile',
                    actualProvider: 'groq',
                    actualModel: 'llama-3.3-70b-versatile',
                    reason: 'requested_model',
                },
            },
        },
    ], 'response-direct');

    assert.equal(model.fallbacks.length, 0);
    assert.equal(model.activeFallback, null);
    assert.equal(model.summary.totalFallbacks, 0);
    assert.equal(model.summary.providerFallbackCount, 0);
});

test('Sprint 7 Phase C summarizes fallback categories and active response misses', () => {
    const model = buildModel([
        {
            id: 'response-timeout',
            intelligenceMetadata: {
                routing: {
                    requestedProvider: 'ollama',
                    requestedModel: 'llama3.2',
                    actualProvider: 'openai',
                    actualModel: 'gpt-5.4',
                    reason: 'provider timeout fallback',
                },
                telemetry: {
                    fallbackUsed: true,
                    fallbackReason: 'provider timeout fallback',
                },
                fallbackChain: [
                    { provider: 'ollama', model: 'llama3.2', result: 'failure', reason: 'timed out' },
                    { provider: 'openai', model: 'gpt-5.4', result: 'success' },
                ],
            },
        },
        {
            id: 'response-rate-limit',
            intelligenceMetadata: {
                routing: {
                    requestedProvider: 'groq',
                    requestedModel: 'llama-3.3-70b-versatile',
                    actualProvider: 'gemini',
                    actualModel: 'gemini-3.1-flash-lite-preview',
                    reason: 'rate limit fallback',
                },
                telemetry: {
                    fallbackUsed: true,
                    fallbackReason: 'rate limit fallback',
                },
            },
        },
    ], 'missing-response');

    assert.equal(model.activeResponseId, 'missing-response');
    assert.equal(model.activeFallback, null);
    assert.equal(model.summary.totalFallbacks, 2);
    assert.equal(model.summary.byCategory.timeout, 1);
    assert.equal(model.summary.byCategory.rate_limited, 1);
    assert.equal(model.summary.byRequestedProvider.ollama, 1);
    assert.equal(model.summary.byRequestedProvider.groq, 1);
    assert.equal(model.summary.byActualProvider.openai, 1);
    assert.equal(model.summary.byActualProvider.gemini, 1);
});

test('Sprint 7 Phase C remains a read model without provider routing, diagnostics, or persistence changes', () => {
    const helper = read('src/lib/providers/providerFallbackReadModel.ts');
    const routing = read('electron/LLMHelper.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');

    assert.match(helper, /buildProviderFallbackReadModel/);
    assert.doesNotMatch(helper, /CredentialsManager/);
    assert.doesNotMatch(helper, /LLMHelper/);
    assert.doesNotMatch(helper, /BenchmarkManager/);
    assert.doesNotMatch(helper, /ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(helper, /electron-store|new Store/);
    assert.match(routing, /resolveRoutingDecision/);
    assert.match(ownership, /routingReason\?: string/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
});
