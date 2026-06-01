import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildProviderFallbackReadModel } from '../../src/lib/providers/providerFallbackReadModel.ts';
import { buildProviderTelemetryReadModel } from '../../src/lib/providers/providerTelemetryReadModel.ts';
import type { ProviderRoutingMessage } from '../../src/lib/providers/providerRoutingReadModel.ts';
import { ProviderFallbackAnalyticsSurface } from '../../src/components/settings/ProviderFallbackAnalyticsSurface.tsx';
import { ProviderTelemetrySurface } from '../../src/components/settings/ProviderTelemetrySurface.tsx';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function sampleProviderMessages(): ProviderRoutingMessage[] {
    return [
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
                    latencyMs: 840,
                    success: false,
                    streamingCompleted: true,
                    promptTokens: 40,
                    completionTokens: 160,
                },
                fallbackChain: [
                    {
                        provider: 'bedrock',
                        model: 'openai.gpt-oss-120b-1:0',
                        result: 'failure',
                        reason: 'AWS session expired',
                    },
                    {
                        provider: 'groq',
                        model: 'llama-3.3-70b-versatile',
                        result: 'success',
                    },
                ],
                validation: {
                    valid: false,
                    reason: 'contract validation failed',
                },
            },
        },
    ];
}

test('Sprint 9 Phase E adds compact row labels to fallback and telemetry rows', () => {
    const fallbackSurface = read('src/components/settings/ProviderFallbackAnalyticsSurface.tsx');
    const telemetrySurface = read('src/components/settings/ProviderTelemetrySurface.tsx');

    for (const surface of [fallbackSurface, telemetrySurface]) {
        assert.match(surface, /function FieldValue/);
        assert.match(surface, /text-text-tertiary md:hidden/);
        assert.match(surface, /cellRole\?: 'cell' \| 'rowheader'/);
        assert.match(surface, /cellRole="rowheader"/);
    }

    assert.match(fallbackSurface, /<FieldValue label="Fallback Reason"/);
    assert.match(fallbackSurface, /<FieldValue label="Failure Category"/);
    assert.match(fallbackSurface, /<FieldValue label="Attempts"/);
    assert.match(telemetrySurface, /<FieldValue label="Latency"/);
    assert.match(telemetrySurface, /<FieldValue label="Streaming"/);
    assert.match(telemetrySurface, /<FieldValue label="Validation"/);
});

test('Sprint 9 Phase E row labels render without changing read-only provider surfaces', () => {
    const messages = sampleProviderMessages();
    const fallback = buildProviderFallbackReadModel({
        responses: messages,
        activeResponseId: 'response-fallback',
        now: 4000,
    });
    const telemetry = buildProviderTelemetryReadModel({
        responses: messages,
        activeResponseId: 'response-fallback',
        now: 4000,
    });
    const fallbackHtml = renderToStaticMarkup(React.createElement(ProviderFallbackAnalyticsSurface, { readModel: fallback }));
    const telemetryHtml = renderToStaticMarkup(React.createElement(ProviderTelemetrySurface, { readModel: telemetry }));

    assert.match(fallbackHtml, /Response/);
    assert.match(fallbackHtml, /Fallback Reason/);
    assert.match(fallbackHtml, /Failure Category/);
    assert.match(fallbackHtml, /Attempts/);
    assert.match(telemetryHtml, /Response/);
    assert.match(telemetryHtml, /Provider/);
    assert.match(telemetryHtml, /Latency/);
    assert.match(telemetryHtml, /Streaming/);
    assert.match(telemetryHtml, /Validation/);
    assert.doesNotMatch(`${fallbackHtml}${telemetryHtml}`, /<button|onClick|Reroute|Switch Provider|LineChart|BarChart/);
});

test('Sprint 9 Phase E does not modify provider architecture or persistence boundaries', () => {
    const fallbackSurface = read('src/components/settings/ProviderFallbackAnalyticsSurface.tsx');
    const telemetrySurface = read('src/components/settings/ProviderTelemetrySurface.tsx');
    const combined = `${fallbackSurface}\n${telemetrySurface}`;

    assert.doesNotMatch(combined, /buildProviderRoutingReadModel|buildProviderHealthReadModel|buildProviderDiagnosticsReadModel|buildProviderPersonalizationReadModel/);
    assert.doesNotMatch(combined, /safeHandle|ipcMain|ipcRenderer|CredentialsManager|BenchmarkManager|LLMHelper/);
    assert.doesNotMatch(combined, /localStorage|sessionStorage|indexedDB|writeFile|electron-store|new Store/);
});
