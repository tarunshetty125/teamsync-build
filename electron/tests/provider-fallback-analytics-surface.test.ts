import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildProviderFallbackReadModel } from '../../src/lib/providers/providerFallbackReadModel.ts';
import type { ProviderRoutingMessage } from '../../src/lib/providers/providerRoutingReadModel.ts';
import { ProviderFallbackAnalyticsSurface } from '../../src/components/settings/ProviderFallbackAnalyticsSurface.tsx';

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

function sampleFallbackMessages(): ProviderRoutingMessage[] {
    return [
        {
            id: 'response-auth',
            requestId: 'request-auth',
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
                    { provider: 'bedrock', model: 'openai.gpt-oss-120b-1:0', result: 'failure', reason: 'AWS SSO session expired' },
                    { provider: 'groq', model: 'llama-3.3-70b-versatile', result: 'success' },
                ],
            },
        },
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
        ownershipMessage('response-safe', {
            requestedProvider: 'claude',
            requestedModel: 'claude-sonnet-4-6',
            actualProvider: 'local',
            actualModel: 'safe_action_fallback',
            routingReason: 'all_attempts_failed',
        }),
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
    ];
}

test('Sprint 7 UI-D fallback analytics surface consumes ProviderFallbackReadModel only', () => {
    const surface = read('src/components/settings/ProviderFallbackAnalyticsSurface.tsx');

    assert.match(surface, /ProviderFallbackAnalyticsSurfaceProps/);
    assert.match(surface, /readModel: ProviderFallbackReadModel/);
    assert.match(surface, /readModel\.fallbacks/);
    assert.match(surface, /readModel\.summary\.totalFallbacks/);
    assert.match(surface, /readModel\.summary\.providerFallbackCount/);
    assert.match(surface, /readModel\.summary\.safeFallbackCount/);
    assert.match(surface, /readModel\.summary\.validationFallbackCount/);
    assert.match(surface, /readModel\.summary\.byCategory/);
    assert.match(surface, /readModel\.summary\.byReason/);
    assert.match(surface, /readModel\.summary\.byRequestedProvider/);
    assert.match(surface, /readModel\.summary\.byActualProvider/);
    assert.match(surface, /aria-label="Provider fallback analytics"/);
    assert.match(surface, /Total Fallbacks/);
    assert.match(surface, /Provider Fallbacks/);
    assert.match(surface, /Safe Fallbacks/);
    assert.match(surface, /Validation Fallbacks/);
    assert.match(surface, /Failure Categories/);
    assert.match(surface, /Fallback Reasons/);
    assert.match(surface, /Provider Summary/);
    assert.match(surface, /data-fallback-category=\{fallback\.category\}/);
    assert.doesNotMatch(surface, /buildProviderHealthReadModel|buildProviderRoutingReadModel|buildProviderDiagnosticsReadModel|buildProviderTelemetryReadModel|buildProviderPersonalizationReadModel/);
    assert.doesNotMatch(surface, /CredentialsManager|LLMHelper|BenchmarkManager|ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB|recharts|Chart/);
    assert.doesNotMatch(surface, /<button|onClick|retry|Retry|switchProvider|setDefaultModel|setProviderPreferredModel/);
});

test('Sprint 7 UI-D renders fallback totals, categories, reasons, and provider summary', () => {
    const model = buildProviderFallbackReadModel({
        responses: sampleFallbackMessages(),
        activeResponseId: 'response-auth',
        now: 2000,
    });
    const html = renderToStaticMarkup(React.createElement(ProviderFallbackAnalyticsSurface, { readModel: model }));

    assert.equal(model.summary.totalFallbacks, 4);
    assert.equal(model.summary.providerFallbackCount, 3);
    assert.equal(model.summary.safeFallbackCount, 2);
    assert.equal(model.summary.validationFallbackCount, 1);
    assert.match(html, /Provider fallback analytics/);
    assert.match(html, /Total Fallbacks/);
    assert.match(html, /Provider Fallbacks/);
    assert.match(html, /Safe Fallbacks/);
    assert.match(html, /Validation Fallbacks/);
    assert.match(html, /Failure Categories/);
    assert.match(html, /Fallback Reasons/);
    assert.match(html, /Provider Summary/);
    assert.match(html, /Auth Expired/);
    assert.match(html, /Validation Failed/);
    assert.match(html, /Safe Fallback/);
    assert.match(html, /Rate Limited/);
    assert.match(html, /bedrock_auth_expired_fallback/);
    assert.match(html, /validation_failed_repair_invalid/);
    assert.match(html, /rate limit fallback/);
    assert.match(html, /Bedrock/);
    assert.match(html, /Groq/);
    assert.match(html, /Gemini/);
    assert.match(html, /Claude/);
    assert.match(html, /data-fallback-category="auth_expired"/);
    assert.match(html, /data-fallback-category="validation_failed"/);
    assert.match(html, /data-fallback-category="safe_fallback"/);
    assert.match(html, /data-fallback-category="rate_limited"/);
});

test('Sprint 7 UI-D keeps fallback analytics compact and read-only', () => {
    const model = buildProviderFallbackReadModel({
        responses: sampleFallbackMessages(),
        now: 2000,
    });
    const html = renderToStaticMarkup(React.createElement(ProviderFallbackAnalyticsSurface, { readModel: model }));

    assert.match(html, /data-fallback-count-key="auth_expired"/);
    assert.match(html, /data-fallback-count-key="bedrock_auth_expired_fallback"/);
    assert.match(html, /data-fallback-provider="local"/);
    assert.match(html, /data-safe-fallback="true"/);
    assert.match(html, /data-validation-fallback="true"/);
    assert.doesNotMatch(html, /<button|Retry|Reroute|Switch Provider|Chart|LineChart|BarChart/);
});

test('Sprint 7 UI-D settings integration derives fallback read model without new provider state', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');

    assert.match(settings, /import \{ buildProviderFallbackReadModel \}/);
    assert.match(settings, /import \{ ProviderFallbackAnalyticsSurface \}/);
    assert.match(settings, /const providerFallbackReadModel = useMemo/);
    assert.match(settings, /buildProviderFallbackReadModel\(\{ responses: \[\] \}\)/);
    assert.match(settings, /<ProviderFallbackAnalyticsSurface readModel=\{providerFallbackReadModel\} \/>/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderFallback|setProviderFallback|providerFallbackState/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderPersonalization|setProviderPersonalization|providerPersonalizationState/);
});

test('Sprint 7 UI-D empty fallback model renders read-only empty states', () => {
    const model = buildProviderFallbackReadModel({ responses: [], now: 2000 });
    const html = renderToStaticMarkup(React.createElement(ProviderFallbackAnalyticsSurface, { readModel: model }));

    assert.match(html, /Total Fallbacks/);
    assert.match(html, /No failure categories/);
    assert.match(html, /No fallback reasons/);
    assert.match(html, /No provider fallback summary/);
    assert.match(html, /No provider fallbacks/);
    assert.doesNotMatch(html, /<button|onClick|Retry|Reroute/);
});

test('Sprint 7 UI-D does not modify routing, ownership, diagnostics, benchmark, or persistence systems', () => {
    const surface = read('src/components/settings/ProviderFallbackAnalyticsSurface.tsx');
    const fallback = read('src/lib/providers/providerFallbackReadModel.ts');
    const routing = read('src/lib/providers/providerRoutingReadModel.ts');
    const diagnostics = read('src/lib/providers/providerDiagnosticsReadModel.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');
    const helper = read('electron/LLMHelper.ts');

    assert.match(surface, /ProviderFallbackAnalyticsSurface/);
    assert.match(fallback, /buildProviderFallbackReadModel/);
    assert.match(routing, /buildProviderRoutingReadModel/);
    assert.match(diagnostics, /buildProviderDiagnosticsReadModel/);
    assert.match(ownership, /routingReason\?: string/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
    assert.match(helper, /resolveRoutingDecision/);
    assert.doesNotMatch(surface, /electron-store|new Store|safeHandle|ipcMain|ipcRenderer/);
});
