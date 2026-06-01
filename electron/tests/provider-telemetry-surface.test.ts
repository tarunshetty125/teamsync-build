import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildProviderTelemetryReadModel } from '../../src/lib/providers/providerTelemetryReadModel.ts';
import type { ProviderRoutingMessage } from '../../src/lib/providers/providerRoutingReadModel.ts';
import { ProviderTelemetrySurface } from '../../src/components/settings/ProviderTelemetrySurface.tsx';

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
            actionId: 'manual_chat',
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

function sampleTelemetryMessages(): ProviderRoutingMessage[] {
    return [
        {
            id: 'response-success',
            requestId: 'request-success',
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
                    validationResult: 'failed',
                },
                validation: {
                    valid: false,
                },
            },
        },
        {
            id: 'response-fallback',
            intelligenceMetadata: {
                routing: {
                    requestedProvider: 'bedrock',
                    requestedModel: 'openai.gpt-oss-120b-1:0',
                    actualProvider: 'gemini',
                    actualModel: 'gemini-3.1-flash-lite-preview',
                    reason: 'bedrock_auth_expired_fallback',
                },
                telemetry: {
                    fallbackUsed: true,
                    fallbackReason: 'bedrock_auth_expired_fallback',
                    latencyMs: 800,
                },
                fallbackChain: [
                    { provider: 'bedrock', model: 'openai.gpt-oss-120b-1:0', result: 'failure', reason: 'session expired' },
                    { provider: 'gemini', model: 'gemini-3.1-flash-lite-preview', result: 'success' },
                ],
            },
        },
        ownershipMessage('response-cache', {
            requestedProvider: 'gemini',
            requestedModel: 'gemini-3.1-flash-lite-preview',
            actualProvider: 'cache',
            actualModel: 'cache_hit',
            routingReason: 'cache_hit',
        }),
        {
            id: 'response-cancelled',
            provider: 'claude',
            model: 'claude-sonnet-4-6',
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
        {
            id: 'response-streaming',
            provider: 'bedrock',
            model: 'openai.gpt-oss-120b-1:0',
            isStreaming: true,
        } as ProviderRoutingMessage,
    ];
}

test('Sprint 7 UI-E telemetry surface consumes ProviderTelemetryReadModel only', () => {
    const surface = read('src/components/settings/ProviderTelemetrySurface.tsx');

    assert.match(surface, /ProviderTelemetrySurfaceProps/);
    assert.match(surface, /readModel: ProviderTelemetryReadModel/);
    assert.match(surface, /readModel\.entries/);
    assert.match(surface, /readModel\.summary\.requestCount/);
    assert.match(surface, /readModel\.summary\.successCount/);
    assert.match(surface, /readModel\.summary\.failureCount/);
    assert.match(surface, /readModel\.summary\.retryCount/);
    assert.match(surface, /readModel\.summary\.fallbackCount/);
    assert.match(surface, /readModel\.summary\.cacheHitCount/);
    assert.match(surface, /readModel\.summary\.avgLatencyMs/);
    assert.match(surface, /readModel\.summary\.cancelledCount/);
    assert.match(surface, /readModel\.summary\.byProvider/);
    assert.match(surface, /readModel\.summary\.byModel/);
    assert.match(surface, /aria-label="Provider telemetry"/);
    assert.match(surface, /Request Count/);
    assert.match(surface, /Success Count/);
    assert.match(surface, /Failure Count/);
    assert.match(surface, /Retry Count/);
    assert.match(surface, /Fallback Count/);
    assert.match(surface, /Cache Hits/);
    assert.match(surface, /Latency/);
    assert.match(surface, /Streaming Completion/);
    assert.match(surface, /Cancellation/);
    assert.match(surface, /Validation Outcome/);
    assert.match(surface, /Token Counts/);
    assert.match(surface, /Provider Summary/);
    assert.match(surface, /Model Summary/);
    assert.doesNotMatch(surface, /buildProviderHealthReadModel|buildProviderRoutingReadModel|buildProviderFallbackReadModel|buildProviderDiagnosticsReadModel|buildProviderPersonalizationReadModel/);
    assert.doesNotMatch(surface, /BenchmarkManager|CredentialsManager|LLMHelper|ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB|recharts|Chart|LineChart|BarChart/);
    assert.doesNotMatch(surface, /<button|onClick|Reroute|Switch Provider|switchProvider|setDefaultModel|setProviderPreferredModel/);
});

test('Sprint 7 UI-E renders telemetry counts, latency, validation, tokens, providers, and models', () => {
    const model = buildProviderTelemetryReadModel({
        responses: sampleTelemetryMessages(),
        benchmarkRecords: [
            {
                id: 'response-cache',
                provider: 'cache',
                model: 'cache_hit',
                latencyMs: 50,
                totalLatencyMs: 50,
                inputTokens: 12,
                outputTokens: 20,
                cacheHit: true,
                structuredOutputCompliant: true,
            },
        ],
        now: 2000,
    });
    const html = renderToStaticMarkup(React.createElement(ProviderTelemetrySurface, { readModel: model }));

    assert.equal(model.summary.requestCount, 6);
    assert.equal(model.summary.successCount, 3);
    assert.equal(model.summary.failureCount, 1);
    assert.equal(model.summary.streamingCount, 1);
    assert.equal(model.summary.cancelledCount, 1);
    assert.equal(model.summary.retryCount, 2);
    assert.equal(model.summary.fallbackCount, 1);
    assert.equal(model.summary.cacheHitCount, 1);
    assert.equal(model.summary.avgLatencyMs, 525);
    assert.match(html, /Provider telemetry/);
    assert.match(html, /Request Count/);
    assert.match(html, /Success Count/);
    assert.match(html, /Failure Count/);
    assert.match(html, /Retry Count/);
    assert.match(html, /Fallback Count/);
    assert.match(html, /Cache Hits/);
    assert.match(html, /Latency/);
    assert.match(html, /Streaming Completion/);
    assert.match(html, /Cancellation/);
    assert.match(html, /Validation Outcome/);
    assert.match(html, /Token Counts/);
    assert.match(html, /Provider Summary/);
    assert.match(html, /Model Summary/);
    assert.match(html, /Openai/);
    assert.match(html, /Groq/);
    assert.match(html, /Gemini/);
    assert.match(html, /Claude/);
    assert.match(html, /Cache Hit/);
    assert.match(html, /Gpt 5\.4/);
    assert.match(html, /Prompt Tokens/);
    assert.match(html, /Completion Tokens/);
    assert.match(html, /Input Tokens/);
    assert.match(html, /Output Tokens/);
    assert.match(html, /data-telemetry-status="success"/);
    assert.match(html, /data-telemetry-status="failure"/);
    assert.match(html, /data-telemetry-status="cancelled"/);
    assert.match(html, /data-telemetry-status="streaming"/);
    assert.match(html, /data-telemetry-cache-hit="true"/);
});

test('Sprint 7 UI-E keeps telemetry read-only and compact', () => {
    const model = buildProviderTelemetryReadModel({
        responses: sampleTelemetryMessages(),
        now: 2000,
    });
    const html = renderToStaticMarkup(React.createElement(ProviderTelemetrySurface, { readModel: model }));

    assert.match(html, /data-telemetry-count-key="passed"/);
    assert.match(html, /data-telemetry-count-key="failed"/);
    assert.match(html, /data-telemetry-count-key="unknown"/);
    assert.match(html, /data-telemetry-bucket="openai"/);
    assert.match(html, /data-telemetry-bucket="gpt-5.4"/);
    assert.match(html, /data-telemetry-cancelled="true"/);
    assert.doesNotMatch(html, /<button|Reroute|Switch Provider|Chart|LineChart|BarChart/);
});

test('Sprint 7 UI-E settings integration derives telemetry read model without new provider state', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');

    assert.match(settings, /import \{ buildProviderTelemetryReadModel \}/);
    assert.match(settings, /import \{ ProviderTelemetrySurface \}/);
    assert.match(settings, /const providerTelemetryReadModel = useMemo/);
    assert.match(settings, /buildProviderTelemetryReadModel\(\{ responses: \[\] \}\)/);
    assert.match(settings, /<ProviderTelemetrySurface readModel=\{providerTelemetryReadModel\} \/>/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderTelemetry|setProviderTelemetry|providerTelemetryState/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderPersonalization|setProviderPersonalization|providerPersonalizationState/);
});

test('Sprint 7 UI-E empty telemetry model renders read-only empty states', () => {
    const model = buildProviderTelemetryReadModel({ responses: [], now: 2000 });
    const html = renderToStaticMarkup(React.createElement(ProviderTelemetrySurface, { readModel: model }));

    assert.match(html, /Request Count/);
    assert.match(html, /No status counts/);
    assert.match(html, /No provider telemetry/);
    assert.match(html, /No model telemetry/);
    assert.match(html, /No provider telemetry/);
    assert.doesNotMatch(html, /<button|onClick|Reroute/);
});

test('Sprint 7 UI-E does not modify routing, ownership, diagnostics, benchmark, or persistence systems', () => {
    const surface = read('src/components/settings/ProviderTelemetrySurface.tsx');
    const telemetry = read('src/lib/providers/providerTelemetryReadModel.ts');
    const routing = read('src/lib/providers/providerRoutingReadModel.ts');
    const fallback = read('src/lib/providers/providerFallbackReadModel.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');
    const helper = read('electron/LLMHelper.ts');

    assert.match(surface, /ProviderTelemetrySurface/);
    assert.match(telemetry, /buildProviderTelemetryReadModel/);
    assert.match(routing, /buildProviderRoutingReadModel/);
    assert.match(fallback, /buildProviderFallbackReadModel/);
    assert.match(ownership, /routingReason\?: string/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
    assert.match(helper, /resolveRoutingDecision/);
    assert.doesNotMatch(surface, /electron-store|new Store|safeHandle|ipcMain|ipcRenderer|BenchmarkManager/);
});
