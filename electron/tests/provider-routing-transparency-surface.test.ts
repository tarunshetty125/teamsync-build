import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    buildProviderRoutingReadModel,
    type ProviderRoutingMessage,
} from '../../src/lib/providers/providerRoutingReadModel.ts';
import { ProviderRoutingTransparencySurface } from '../../src/components/settings/ProviderRoutingTransparencySurface.tsx';

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

function sampleRoutingMessages(): ProviderRoutingMessage[] {
    return [
        ownershipMessage('response-direct', {
            requestedProvider: 'groq',
            requestedModel: 'llama-3.3-70b-versatile',
        }),
        ownershipMessage('response-remapped', {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'bedrock',
            actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            routingReason: 'vision_required_model_remap',
        }),
        {
            id: 'response-fallback',
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
                    { provider: 'bedrock', model: 'openai.gpt-oss-120b-1:0', result: 'failure' },
                    { provider: 'groq', model: 'llama-3.3-70b-versatile', result: 'success' },
                ],
            },
        },
        ownershipMessage('response-local-fallback', {
            requestedProvider: 'claude',
            requestedModel: 'claude-sonnet-4-6',
            actualProvider: 'local',
            actualModel: 'safe_action_fallback',
            routingReason: 'all_attempts_failed',
        }),
        ownershipMessage('response-cache', {
            requestedProvider: 'gemini',
            requestedModel: 'gemini-3.1-flash-lite-preview',
            actualProvider: 'cache',
            actualModel: 'cache_hit',
            routingReason: 'cache_hit',
        }),
        { id: 'response-unknown' },
    ];
}

test('Sprint 7 UI-C routing surface consumes ProviderRoutingReadModel only', () => {
    const surface = read('src/components/settings/ProviderRoutingTransparencySurface.tsx');

    assert.match(surface, /ProviderRoutingTransparencySurfaceProps/);
    assert.match(surface, /readModel: ProviderRoutingReadModel/);
    assert.match(surface, /readModel\.routes/);
    assert.match(surface, /readModel\.summary\.totalRoutes/);
    assert.match(surface, /aria-label="Provider routing transparency"/);
    assert.match(surface, /aria-label="Provider routing transparency table"/);
    assert.match(surface, /Requested Provider/);
    assert.match(surface, /Requested Model/);
    assert.match(surface, /Actual Provider/);
    assert.match(surface, /Actual Model/);
    assert.match(surface, /Routing Reason/);
    assert.match(surface, /Route Changed/);
    assert.match(surface, /Fallback Used/);
    assert.match(surface, /Status/);
    assert.match(surface, /direct/);
    assert.match(surface, /remapped/);
    assert.match(surface, /fallback/);
    assert.match(surface, /local_fallback/);
    assert.match(surface, /cache/);
    assert.match(surface, /unknown/);
    assert.match(surface, /data-routing-status=\{route\.status\}/);
    assert.match(surface, /data-route-changed=\{route\.routeChanged\}/);
    assert.match(surface, /data-fallback-used=\{route\.fallbackUsed\}/);
    assert.doesNotMatch(surface, /buildProviderHealthReadModel|buildProviderDiagnosticsReadModel|buildProviderFallbackReadModel|buildProviderTelemetryReadModel|buildProviderPersonalizationReadModel/);
    assert.doesNotMatch(surface, /CredentialsManager|LLMHelper|BenchmarkManager|ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB|recharts|Chart/);
    assert.doesNotMatch(surface, /<button|onClick|reroute|Reroute|switchProvider|setDefaultModel|setProviderPreferredModel/);
});

test('Sprint 7 UI-C renders routing fields and all approved status values', () => {
    const model = buildProviderRoutingReadModel({
        responses: sampleRoutingMessages(),
        activeResponseId: 'response-fallback',
        now: 2000,
    });
    const html = renderToStaticMarkup(React.createElement(ProviderRoutingTransparencySurface, { readModel: model }));

    assert.match(html, /Provider routing transparency/);
    assert.match(html, /Requested Provider/);
    assert.match(html, /Requested Model/);
    assert.match(html, /Actual Provider/);
    assert.match(html, /Actual Model/);
    assert.match(html, /Routing Reason/);
    assert.match(html, /Route Changed/);
    assert.match(html, /Fallback Used/);
    assert.match(html, /Status/);
    assert.match(html, /groq/);
    assert.match(html, /llama-3\.3-70b-versatile/);
    assert.match(html, /bedrock_auth_expired_fallback/);
    assert.match(html, /vision_required_model_remap/);
    assert.match(html, /safe_action_fallback/);
    assert.match(html, /Direct/);
    assert.match(html, /Remapped/);
    assert.match(html, /Fallback/);
    assert.match(html, /Local Fallback/);
    assert.match(html, /Cache/);
    assert.match(html, /Unknown/);
    assert.match(html, /data-routing-status="direct"/);
    assert.match(html, /data-routing-status="remapped"/);
    assert.match(html, /data-routing-status="fallback"/);
    assert.match(html, /data-routing-status="local_fallback"/);
    assert.match(html, /data-routing-status="cache"/);
    assert.match(html, /data-routing-status="unknown"/);
});

test('Sprint 7 UI-C projects compact routing summary counts without charts or controls', () => {
    const model = buildProviderRoutingReadModel({
        responses: sampleRoutingMessages(),
        now: 2000,
    });
    const html = renderToStaticMarkup(React.createElement(ProviderRoutingTransparencySurface, { readModel: model }));

    assert.equal(model.summary.totalRoutes, 6);
    assert.equal(model.summary.routeChangedCount, 4);
    assert.match(html, /Total 6/);
    assert.match(html, /Changed 4/);
    assert.match(html, /Direct 1/);
    assert.match(html, /Remapped 1/);
    assert.match(html, /Fallback 1/);
    assert.match(html, /Local Fallback 1/);
    assert.match(html, /Cache 1/);
    assert.match(html, /Unknown 1/);
    assert.match(html, /data-routing-summary-status="direct"/);
    assert.match(html, /data-routing-summary-status="local_fallback"/);
    assert.doesNotMatch(html, /<button|Reroute|Switch Provider|Chart|Retry/);
});

test('Sprint 7 UI-C settings integration derives routing read model without new provider state', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');

    assert.match(settings, /import \{ buildProviderRoutingReadModel \}/);
    assert.match(settings, /import \{ ProviderRoutingTransparencySurface \}/);
    assert.match(settings, /const providerRoutingReadModel = useMemo/);
    assert.match(settings, /buildProviderRoutingReadModel\(\{ responses: \[\] \}\)/);
    assert.match(settings, /<ProviderRoutingTransparencySurface readModel=\{providerRoutingReadModel\} \/>/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderRouting|setProviderRouting|providerRoutingState/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderPersonalization|setProviderPersonalization|providerPersonalizationState/);
});

test('Sprint 7 UI-C empty routing model renders a read-only empty state', () => {
    const model = buildProviderRoutingReadModel({ responses: [], now: 2000 });
    const html = renderToStaticMarkup(React.createElement(ProviderRoutingTransparencySurface, { readModel: model }));

    assert.match(html, /No provider routes/);
    assert.match(html, /Total 0/);
    assert.match(html, /Changed 0/);
    assert.doesNotMatch(html, /<button|onClick|Retry|Reroute/);
});

test('Sprint 7 UI-C does not modify routing, ownership, diagnostics, benchmark, or persistence systems', () => {
    const surface = read('src/components/settings/ProviderRoutingTransparencySurface.tsx');
    const routing = read('src/lib/providers/providerRoutingReadModel.ts');
    const diagnostics = read('src/lib/providers/providerDiagnosticsReadModel.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');
    const helper = read('electron/LLMHelper.ts');

    assert.match(surface, /ProviderRoutingTransparencySurface/);
    assert.match(routing, /buildProviderRoutingReadModel/);
    assert.match(diagnostics, /buildProviderDiagnosticsReadModel/);
    assert.match(ownership, /requestedProvider\?: string/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
    assert.match(helper, /resolveRoutingDecision/);
    assert.doesNotMatch(surface, /electron-store|new Store|safeHandle|ipcMain|ipcRenderer/);
});
