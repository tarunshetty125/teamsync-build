import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import {
    buildProviderRoutingReadModel,
    type ProviderRoutingMessage,
} from '../../src/lib/providers/providerRoutingReadModel.ts';
import { buildProviderDiagnosticsReadModel } from '../../src/lib/providers/providerDiagnosticsReadModel.ts';
import { buildProviderTelemetryReadModel } from '../../src/lib/providers/providerTelemetryReadModel.ts';
import { ProviderResponseDrilldownSurface } from '../../src/components/settings/ProviderResponseDrilldownSurface.tsx';

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
    debugMetadata?: unknown,
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
        intelligenceMetadata: debugMetadata,
    };
}

function sampleResponses(): ProviderRoutingMessage[] {
    return [
        ownershipMessage(
            'response-direct',
            {
                requestedProvider: 'openai',
                requestedModel: 'gpt-5.4',
            },
            {
                telemetry: {
                    success: true,
                    startedAt: 100,
                    completedAt: 450,
                    promptTokens: 120,
                    completionTokens: 240,
                    streamingStarted: true,
                    streamingCompleted: true,
                    validationResult: 'valid',
                },
                validation: {
                    valid: true,
                },
            },
        ),
        {
            id: 'response-fallback',
            requestId: 'request-fallback',
            questionTurnId: 'turn-response-fallback',
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
                    latencyMs: 800,
                },
                fallbackChain: [
                    { provider: 'bedrock', model: 'openai.gpt-oss-120b-1:0', result: 'failure', reason: 'AWS SSO session expired' },
                    { provider: 'groq', model: 'llama-3.3-70b-versatile', result: 'success' },
                ],
            },
        },
        ownershipMessage('response-remapped', {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'claude',
            actualModel: 'claude-sonnet-4-6',
            routingReason: 'vision_required_model_remap',
        }),
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
                    latencyMs: 650,
                },
                validation: {
                    valid: false,
                    reason: 'contract sections missing',
                },
            },
        },
    ];
}

function ownershipByResponseId(responses: ProviderRoutingMessage[]): Record<string, ResponseOwnership> {
    return Object.fromEntries(
        responses
            .filter((response): response is ProviderRoutingMessage & { ownership: ResponseOwnership } => Boolean(response.ownership))
            .map((response) => [response.ownership.responseId, response.ownership]),
    );
}

function buildModels(responses: ProviderRoutingMessage[]) {
    return {
        routingReadModel: buildProviderRoutingReadModel({
            responses,
            activeResponseId: 'response-fallback',
            now: 2000,
        }),
        diagnosticsReadModel: buildProviderDiagnosticsReadModel({
            responses,
            activeResponseId: 'response-fallback',
            now: 2000,
        }),
        telemetryReadModel: buildProviderTelemetryReadModel({
            responses,
            activeResponseId: 'response-fallback',
            benchmarkRecords: [
                {
                    id: 'response-remapped',
                    provider: 'claude',
                    model: 'claude-sonnet-4-6',
                    latencyMs: 500,
                    inputTokens: 32,
                    outputTokens: 64,
                    structuredOutputCompliant: true,
                },
            ],
            now: 2000,
        }),
        ownershipByResponseId: ownershipByResponseId(responses),
    };
}

test('Sprint 7 UI-G response drilldown consumes existing ownership and provider read models only', () => {
    const surface = read('src/components/settings/ProviderResponseDrilldownSurface.tsx');

    assert.match(surface, /ProviderResponseDrilldownSurfaceProps/);
    assert.match(surface, /ResponseOwnership/);
    assert.match(surface, /routingReadModel: ProviderRoutingReadModel/);
    assert.match(surface, /diagnosticsReadModel: ProviderDiagnosticsReadModel/);
    assert.match(surface, /telemetryReadModel: ProviderTelemetryReadModel/);
    assert.match(surface, /ownershipByResponseId/);
    assert.match(surface, /Response-level provider drilldown/);
    assert.match(surface, /Requested Provider/);
    assert.match(surface, /Requested Model/);
    assert.match(surface, /Actual Provider/);
    assert.match(surface, /Actual Model/);
    assert.match(surface, /Routing Reason/);
    assert.match(surface, /Route Status/);
    assert.match(surface, /Fallback Used/);
    assert.match(surface, /Diagnostics/);
    assert.match(surface, /Latency/);
    assert.match(surface, /Tokens/);
    assert.match(surface, /Validation Outcome/);
    assert.doesNotMatch(surface, /buildProviderRoutingReadModel|buildProviderDiagnosticsReadModel|buildProviderTelemetryReadModel|buildProviderFallbackReadModel|buildProviderPersonalizationReadModel/);
    assert.doesNotMatch(surface, /CredentialsManager|LLMHelper|BenchmarkManager|ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB|recharts|Chart|LineChart|BarChart/);
    assert.doesNotMatch(surface, /<button|onClick|Retry|Reroute|Switch Provider|setDefaultModel|setProviderPreferredModel/);
});

test('Sprint 7 UI-G renders per-response routing, diagnostics, telemetry, tokens, and validation', () => {
    const responses = sampleResponses();
    const models = buildModels(responses);
    const html = renderToStaticMarkup(React.createElement(ProviderResponseDrilldownSurface, models));

    assert.match(html, /Response-level provider drilldown/);
    assert.match(html, /Responses 4/);
    assert.match(html, /Diagnostics 3/);
    assert.match(html, /Telemetry 4/);
    assert.match(html, /openai/);
    assert.match(html, /gpt-5\.4/);
    assert.match(html, /bedrock/);
    assert.match(html, /openai\.gpt-oss-120b-1:0/);
    assert.match(html, /groq/);
    assert.match(html, /llama-3\.3-70b-versatile/);
    assert.match(html, /claude/);
    assert.match(html, /claude-sonnet-4-6/);
    assert.match(html, /gemini/);
    assert.match(html, /safe_action_fallback/);
    assert.match(html, /bedrock_auth_expired_fallback/);
    assert.match(html, /vision_required_model_remap/);
    assert.match(html, /validation_failed_repair_invalid/);
    assert.match(html, /Direct/);
    assert.match(html, /Fallback/);
    assert.match(html, /Remapped/);
    assert.match(html, /Local Fallback/);
    assert.match(html, /AWS session expired before fallback/);
    assert.match(html, /Provider routing changed/);
    assert.match(html, /Provider output failed validation/);
    assert.match(html, /350ms/);
    assert.match(html, /800ms/);
    assert.match(html, /Prompt 120/);
    assert.match(html, /Completion 240/);
    assert.match(html, /Input 32/);
    assert.match(html, /Output 64/);
    assert.match(html, /Passed/);
    assert.match(html, /Failed/);
    assert.match(html, /Unknown/);
    assert.match(html, /data-drilldown-response-id="response-direct"/);
    assert.match(html, /data-drilldown-response-id="response-fallback"/);
    assert.match(html, /data-drilldown-route-status="fallback"/);
    assert.match(html, /data-drilldown-fallback-used="true"/);
    assert.match(html, /data-drilldown-validation="Failed"/);
    assert.match(html, /data-drilldown-diagnostic="auth_expired"/);
    assert.match(html, /data-drilldown-diagnostic="routing_remap"/);
    assert.match(html, /data-drilldown-diagnostic="validation_failed"/);
});

test('Sprint 7 UI-G settings integration uses existing read models without response-history or provider state changes', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');

    assert.match(settings, /import \{ ProviderResponseDrilldownSurface \}/);
    assert.match(settings, /<ProviderResponseDrilldownSurface/);
    assert.match(settings, /ownershipByResponseId=\{\{\}\}/);
    assert.match(settings, /routingReadModel=\{providerRoutingReadModel\}/);
    assert.match(settings, /diagnosticsReadModel=\{providerDiagnosticsReadModel\}/);
    assert.match(settings, /telemetryReadModel=\{providerTelemetryReadModel\}/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderResponse|setProviderResponse|providerResponseState/);
    assert.doesNotMatch(settings, /setResponseHistory|capResponseHistoryMessages|resolveNextActiveResponseSelection/);
});

test('Sprint 7 UI-G empty drilldown model renders read-only empty state', () => {
    const responses: ProviderRoutingMessage[] = [];
    const models = buildModels(responses);
    const html = renderToStaticMarkup(React.createElement(ProviderResponseDrilldownSurface, models));

    assert.match(html, /No response provider drilldown/);
    assert.match(html, /Responses 0/);
    assert.match(html, /Diagnostics 0/);
    assert.match(html, /Telemetry 0/);
    assert.doesNotMatch(html, /<button|onClick|Retry|Reroute|Switch Provider/);
});

test('Sprint 7 UI-G does not modify routing, diagnostics, telemetry, ownership, response history, or persistence systems', () => {
    const surface = read('src/components/settings/ProviderResponseDrilldownSurface.tsx');
    const routing = read('src/lib/providers/providerRoutingReadModel.ts');
    const diagnostics = read('src/lib/providers/providerDiagnosticsReadModel.ts');
    const telemetry = read('src/lib/providers/providerTelemetryReadModel.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');
    const helper = read('electron/LLMHelper.ts');

    assert.match(surface, /ProviderResponseDrilldownSurface/);
    assert.match(routing, /buildProviderRoutingReadModel/);
    assert.match(diagnostics, /buildProviderDiagnosticsReadModel/);
    assert.match(telemetry, /buildProviderTelemetryReadModel/);
    assert.match(ownership, /export interface ResponseOwnership/);
    assert.match(history, /capResponseHistoryMessages/);
    assert.match(helper, /resolveRoutingDecision/);
    assert.doesNotMatch(surface, /electron-store|new Store|safeHandle|ipcMain|ipcRenderer|BenchmarkManager|SettingsManager/);
});
