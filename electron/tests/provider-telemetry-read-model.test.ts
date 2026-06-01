import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildProviderTelemetryReadModel,
    type ProviderTelemetryBenchmarkRecord,
    type ProviderTelemetryReadModel,
} from '../../src/lib/providers/providerTelemetryReadModel.ts';
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

function buildModel(
    responses: ProviderRoutingMessage[],
    activeResponseId?: string,
    benchmarkRecords?: ProviderTelemetryBenchmarkRecord[],
): ProviderTelemetryReadModel {
    return buildProviderTelemetryReadModel({
        responses,
        activeResponseId,
        benchmarkRecords,
        now: 2000,
    });
}

test('Sprint 7 Phase D projects successful request telemetry from debug metadata', () => {
    const model = buildModel([
        {
            id: 'response-success',
            requestId: 'request-success',
            questionTurnId: 'turn-success',
            intelligenceMetadata: {
                routing: {
                    requestedProvider: 'openai',
                    requestedModel: 'gpt-5.4',
                    actualProvider: 'openai',
                    actualModel: 'gpt-5.4',
                    reason: 'requested_model',
                },
                telemetry: {
                    success: true,
                    startedAt: 100,
                    completedAt: 450,
                    promptTokens: 120,
                    completionTokens: 240,
                    parsedLength: 1800,
                    streamingStarted: true,
                    streamingCompleted: true,
                    validationResult: 'valid',
                },
                validation: {
                    valid: true,
                },
            },
        },
    ], 'response-success');
    const entry = model.activeEntry;

    assert.equal(model.generatedAt, 2000);
    assert.equal(entry?.responseId, 'response-success');
    assert.equal(entry?.requestId, 'request-success');
    assert.equal(entry?.actualProvider, 'openai');
    assert.equal(entry?.actualModel, 'gpt-5.4');
    assert.equal(entry?.status, 'success');
    assert.equal(entry?.latencyMs, 350);
    assert.equal(entry?.totalLatencyMs, 350);
    assert.equal(entry?.promptTokens, 120);
    assert.equal(entry?.completionTokens, 240);
    assert.equal(entry?.responseLength, 1800);
    assert.equal(entry?.streamingStarted, true);
    assert.equal(entry?.streamingCompleted, true);
    assert.equal(entry?.validationPassed, true);
    assert.equal(entry?.source, 'debug_metadata');
    assert.equal(model.summary.requestCount, 1);
    assert.equal(model.summary.successCount, 1);
    assert.equal(model.summary.avgLatencyMs, 350);
    assert.equal(model.summary.byProvider.openai.requestCount, 1);
    assert.equal(model.summary.byModel['gpt-5.4'].successCount, 1);
});

test('Sprint 7 Phase D projects successful provider fallback telemetry without counting it as failure', () => {
    const model = buildModel([
        {
            id: 'response-fallback',
            requestId: 'request-fallback',
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
                    startedAt: 100,
                    completedAt: 900,
                },
                fallbackChain: [
                    { provider: 'bedrock', model: 'openai.gpt-oss-120b-1:0', result: 'failure', reason: 'session expired' },
                    { provider: 'groq', model: 'llama-3.3-70b-versatile', result: 'success' },
                ],
            },
        },
    ], 'response-fallback');
    const entry = model.activeEntry;

    assert.equal(entry?.status, 'success');
    assert.equal(entry?.fallbackUsed, true);
    assert.equal(entry?.retryCount, 1);
    assert.equal(entry?.requestedProvider, 'bedrock');
    assert.equal(entry?.actualProvider, 'groq');
    assert.equal(entry?.latencyMs, 800);
    assert.equal(model.summary.successCount, 1);
    assert.equal(model.summary.failureCount, 0);
    assert.equal(model.summary.fallbackCount, 1);
    assert.equal(model.summary.retryCount, 1);
    assert.equal(model.summary.byProvider.groq.fallbackCount, 1);
});

test('Sprint 7 Phase D projects ownership-only safe fallback as failed request telemetry', () => {
    const model = buildModel([
        ownershipMessage('response-safe', {
            requestedProvider: 'claude',
            requestedModel: 'claude-sonnet-4-6',
            actualProvider: 'local',
            actualModel: 'safe_action_fallback',
            routingReason: 'all_attempts_failed',
        }),
    ], 'response-safe');
    const entry = model.activeEntry;

    assert.equal(entry?.source, 'ownership');
    assert.equal(entry?.status, 'failure');
    assert.equal(entry?.fallbackUsed, true);
    assert.equal(entry?.actualProvider, 'local');
    assert.equal(entry?.actualModel, 'safe_action_fallback');
    assert.equal(model.summary.failureCount, 1);
    assert.equal(model.summary.fallbackCount, 1);
    assert.equal(model.summary.byStatus.failure, 1);
});

test('Sprint 7 Phase D projects streaming cancellation without mutating request state', () => {
    const model = buildModel([
        {
            id: 'response-cancelled',
            requestId: 'request-cancelled',
            provider: 'gemini',
            model: 'gemini-3.1-flash-lite-preview',
            isStreaming: true,
            cancelled: true,
            intelligenceMetadata: {
                telemetry: {
                    streamingStarted: true,
                    cancelled: true,
                    startedAt: 100,
                },
                cancellation: {
                    reason: 'user cancelled request',
                },
            },
        } as ProviderRoutingMessage,
    ], 'response-cancelled');
    const entry = model.activeEntry;

    assert.equal(entry?.status, 'cancelled');
    assert.equal(entry?.cancelled, true);
    assert.equal(entry?.streamingStarted, true);
    assert.equal(entry?.streamingCompleted, false);
    assert.equal(model.summary.cancelledCount, 1);
    assert.equal(model.summary.streamingCount, 0);
    assert.equal(model.summary.byProvider.gemini.cancelledCount, 1);
});

test('Sprint 7 Phase D can project existing benchmark records without importing BenchmarkManager', () => {
    const model = buildModel([
        {
            id: 'response-benchmark',
            requestId: 'request-benchmark',
            provider: 'ollama',
            model: 'llama3.2',
            intent: 'manual_chat',
        },
    ], 'response-benchmark', [
        {
            id: 'request-benchmark',
            timestamp: 1500,
            provider: 'ollama',
            model: 'llama3.2',
            mode: 'general',
            intent: 'manual_chat',
            latencyMs: 1250,
            totalLatencyMs: 1400,
            inputTokens: 220,
            outputTokens: 480,
            responseLength: 2600,
            cacheHit: true,
            fallbackUsed: false,
            retryCount: 2,
            structuredOutputCompliant: true,
        },
    ]);
    const entry = model.activeEntry;

    assert.equal(entry?.source, 'benchmark');
    assert.equal(entry?.status, 'success');
    assert.equal(entry?.latencyMs, 1250);
    assert.equal(entry?.totalLatencyMs, 1400);
    assert.equal(entry?.cacheHit, true);
    assert.equal(entry?.retryCount, 2);
    assert.equal(entry?.inputTokens, 220);
    assert.equal(entry?.outputTokens, 480);
    assert.equal(entry?.responseLength, 2600);
    assert.equal(entry?.validationPassed, true);
    assert.equal(model.summary.cacheHitCount, 1);
    assert.equal(model.summary.retryCount, 2);
    assert.equal(model.summary.avgLatencyMs, 1250);
    assert.equal(model.summary.avgTotalLatencyMs, 1400);
});

test('Sprint 7 Phase D summarizes mixed provider telemetry and missing active responses', () => {
    const model = buildModel([
        {
            id: 'response-success',
            provider: 'openai',
            model: 'gpt-5.4',
            intelligenceMetadata: {
                telemetry: {
                    success: true,
                    latencyMs: 300,
                },
            },
        },
        {
            id: 'response-failure',
            provider: 'groq',
            model: 'llama-3.3-70b-versatile',
            intelligenceMetadata: {
                telemetry: {
                    success: false,
                    latencyMs: 900,
                    retryCount: 1,
                    error: 'rate limit',
                },
            },
        },
        {
            id: 'response-streaming',
            provider: 'bedrock',
            model: 'openai.gpt-oss-120b-1:0',
            isStreaming: true,
        } as ProviderRoutingMessage,
    ], 'missing-response');

    assert.equal(model.activeResponseId, 'missing-response');
    assert.equal(model.activeEntry, null);
    assert.equal(model.summary.requestCount, 3);
    assert.equal(model.summary.successCount, 1);
    assert.equal(model.summary.failureCount, 1);
    assert.equal(model.summary.streamingCount, 1);
    assert.equal(model.summary.retryCount, 1);
    assert.equal(model.summary.avgLatencyMs, 600);
    assert.equal(model.summary.byStatus.success, 1);
    assert.equal(model.summary.byStatus.failure, 1);
    assert.equal(model.summary.byStatus.streaming, 1);
    assert.equal(model.summary.byProvider.openai.successCount, 1);
    assert.equal(model.summary.byProvider.groq.failureCount, 1);
    assert.equal(model.summary.byProvider.bedrock.streamingCount, 1);
});

test('Sprint 7 Phase D remains a read model without provider routing, diagnostics, benchmark, or persistence changes', () => {
    const helper = read('src/lib/providers/providerTelemetryReadModel.ts');
    const routing = read('electron/LLMHelper.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');

    assert.match(helper, /buildProviderTelemetryReadModel/);
    assert.doesNotMatch(helper, /CredentialsManager/);
    assert.doesNotMatch(helper, /LLMHelper/);
    assert.doesNotMatch(helper, /BenchmarkManager/);
    assert.doesNotMatch(helper, /ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(helper, /electron-store|new Store/);
    assert.match(routing, /resolveRoutingDecision/);
    assert.match(ownership, /routingReason\?: string/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
});
