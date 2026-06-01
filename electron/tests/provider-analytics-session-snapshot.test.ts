import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import {
    buildProviderAnalyticsSessionSnapshot,
    buildProviderAnalyticsSessionSnapshotKey,
    buildProviderAnalyticsSessionSnapshotStateKey,
    createEmptyProviderAnalyticsSessionSnapshot,
    PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC,
    type ProviderAnalyticsSnapshotMessage,
} from '../../src/lib/providers/providerAnalyticsSessionSnapshot.ts';
import { buildProviderRoutingReadModel } from '../../src/lib/providers/providerRoutingReadModel.ts';
import { buildProviderFallbackReadModel } from '../../src/lib/providers/providerFallbackReadModel.ts';
import { buildProviderTelemetryReadModel } from '../../src/lib/providers/providerTelemetryReadModel.ts';
import { buildProviderPersonalizationReadModel } from '../../src/lib/providers/providerPersonalizationReadModel.ts';
import { buildProviderDiagnosticsReadModel } from '../../src/lib/providers/providerDiagnosticsReadModel.ts';
import { ProviderRoutingTransparencySurface } from '../../src/components/settings/ProviderRoutingTransparencySurface.tsx';
import { ProviderFallbackAnalyticsSurface } from '../../src/components/settings/ProviderFallbackAnalyticsSurface.tsx';
import { ProviderTelemetrySurface } from '../../src/components/settings/ProviderTelemetrySurface.tsx';
import { ProviderPersonalizationImpactSurface } from '../../src/components/settings/ProviderPersonalizationImpactSurface.tsx';
import { ProviderResponseDrilldownSurface } from '../../src/components/settings/ProviderResponseDrilldownSurface.tsx';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function ownership(
    responseId: string,
    route: {
        requestedProvider: string;
        requestedModel: string;
        actualProvider?: string;
        actualModel?: string;
        routingReason?: string;
        providerPreference?: string;
    },
): ResponseOwnership {
    return {
        responseId,
        questionTurnId: `turn-${responseId}`,
        transcriptVersion: 3,
        contextTarget: 'latest_turn',
        actionId: responseId.includes('manual') ? 'manual_chat' : 'what_to_answer',
        parentResponseId: responseId === 'response-direct' ? undefined : 'response-direct',
        mode: 'coding',
        createdAt: 1000,
        sourceProvider: route.requestedProvider,
        sourceModel: route.requestedModel,
        requestedProvider: route.requestedProvider,
        requestedModel: route.requestedModel,
        actualProvider: route.actualProvider ?? route.requestedProvider,
        actualModel: route.actualModel ?? route.requestedModel,
        routingReason: route.routingReason,
        providerPreference: route.providerPreference,
        responseStyle: 'balanced',
        interviewFocus: 'coding',
        personalizationVersion: 1,
    };
}

function message(
    responseId: string,
    route: Parameters<typeof ownership>[1],
    metadata: unknown = {},
): ProviderAnalyticsSnapshotMessage & Record<string, unknown> {
    return {
        id: responseId,
        role: 'system',
        requestId: `request-${responseId}`,
        timestamp: 1200,
        questionTurnId: `turn-${responseId}`,
        intent: 'answer_now',
        source: 'Manual Input',
        provider: route.requestedProvider,
        model: route.requestedModel,
        rootResponseId: 'response-direct',
        ownership: ownership(responseId, route),
        intelligenceMetadata: metadata,
        debugMetadata: metadata,
        isStreaming: false,
        text: 'SOLUTION_MARKDOWN ```js console.log("two sum") ```',
        markdown: 'SOLUTION_MARKDOWN',
        screenshotPreview: 'SCREENSHOT_PAYLOAD',
        hasScreenshot: true,
        artifacts: [
            {
                kind: 'architecture',
                payload: {
                    diagram: {
                        nodes: [{ id: 'diagram-secret', label: 'DIAGRAM_PAYLOAD' }],
                    },
                },
            },
        ],
        architectureJson: { diagram: { nodes: ['ARCHITECTURE_PAYLOAD'] } },
        transcript: 'TRANSCRIPT_PAYLOAD',
    };
}

function directRemapFallbackMessages(): ProviderAnalyticsSnapshotMessage[] {
    return [
        message('response-direct', {
            requestedProvider: 'openai',
            requestedModel: 'gpt-4.1-mini',
            providerPreference: 'openai',
        }, {
            routing: {
                requestedProvider: 'openai',
                requestedModel: 'gpt-4.1-mini',
                actualProvider: 'openai',
                actualModel: 'gpt-4.1-mini',
                reason: 'requested_model',
            },
            telemetry: {
                selectedProvider: 'openai',
                selectedModel: 'gpt-4.1-mini',
                actualInvokedProvider: 'openai',
                actualInvokedModel: 'gpt-4.1-mini',
                latencyMs: 420,
                success: true,
                streamingCompleted: true,
                promptTokens: 20,
                completionTokens: 80,
            },
            validation: { valid: true },
            personalization: {
                providerPreference: 'openai',
                responseStyle: 'balanced',
                interviewFocus: 'coding',
                personalizationVersion: 1,
            },
            prompt: 'PROMPT_PAYLOAD',
            content: 'CONTENT_PAYLOAD',
            transcript: 'TRANSCRIPT_PAYLOAD',
        }),
        message('response-remap', {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'bedrock',
            actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            routingReason: 'vision_required_model_remap',
            providerPreference: 'bedrock',
        }, {
            routing: {
                requestedProvider: 'bedrock',
                requestedModel: 'openai.gpt-oss-120b-1:0',
                actualProvider: 'bedrock',
                actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                reason: 'vision_required_model_remap',
            },
            telemetry: {
                selectedProvider: 'bedrock',
                selectedModel: 'openai.gpt-oss-120b-1:0',
                actualInvokedProvider: 'bedrock',
                actualInvokedModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                latencyMs: 900,
                success: true,
                streamingCompleted: true,
            },
            validation: { valid: true },
            personalization: {
                providerPreference: 'bedrock',
                responseStyle: 'detailed',
                interviewFocus: 'system_design',
                personalizationVersion: 1,
            },
        }),
        message('response-fallback', {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'groq',
            actualModel: 'llama-3.3-70b-versatile',
            routingReason: 'bedrock_auth_expired_fallback',
            providerPreference: 'bedrock',
        }, {
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
                latencyMs: 1300,
                success: false,
                streamingCompleted: true,
                promptTokens: 35,
                completionTokens: 120,
            },
            fallbackChain: [
                {
                    provider: 'bedrock',
                    model: 'openai.gpt-oss-120b-1:0',
                    result: 'failure',
                    reason: 'bedrock_auth_expired_fallback',
                },
                {
                    provider: 'groq',
                    model: 'llama-3.3-70b-versatile',
                    result: 'success',
                },
            ],
            validation: { valid: false, reason: 'contract_validation_failed' },
            personalization: {
                providerPreference: 'bedrock',
                responseStyle: 'concise',
                interviewFocus: 'coding',
                personalizationVersion: 1,
            },
        }),
    ];
}

test('Sprint 8 Phase A projects metadata-only provider analytics snapshot', () => {
    const snapshot = buildProviderAnalyticsSessionSnapshot(
        directRemapFallbackMessages(),
        'response-fallback',
        2000,
    );
    const serialized = JSON.stringify(snapshot);

    assert.equal(snapshot.generatedAt, 2000);
    assert.equal(snapshot.activeResponseId, 'response-fallback');
    assert.equal(snapshot.responses.length, 3);
    assert.equal(snapshot.responses[2].requestedProvider, 'bedrock');
    assert.equal(snapshot.responses[2].actualProvider, 'groq');
    assert.equal(snapshot.responses[2].routingReason, 'bedrock_auth_expired_fallback');
    assert.equal(snapshot.ownershipByResponseId['response-fallback'].actualProvider, 'groq');
    assert.equal(snapshot.ownershipByResponseId['response-fallback'].parentResponseId, 'response-direct');

    assert.doesNotMatch(serialized, /SOLUTION_MARKDOWN/);
    assert.doesNotMatch(serialized, /SCREENSHOT_PAYLOAD/);
    assert.doesNotMatch(serialized, /DIAGRAM_PAYLOAD/);
    assert.doesNotMatch(serialized, /ARCHITECTURE_PAYLOAD/);
    assert.doesNotMatch(serialized, /TRANSCRIPT_PAYLOAD/);
    assert.doesNotMatch(serialized, /PROMPT_PAYLOAD/);
    assert.doesNotMatch(serialized, /CONTENT_PAYLOAD/);
    assert.doesNotMatch(serialized, /"artifacts"|"architectureJson"|"screenshotPreview"|"markdown"|"transcript"|"text"/);
});

test('Sprint 8 Phase A snapshot key ignores streamed response content changes', () => {
    const first = directRemapFallbackMessages();
    const second = directRemapFallbackMessages();
    second[0] = {
        ...second[0],
        text: 'DIFFERENT_STREAMED_CONTENT',
        markdown: 'DIFFERENT_MARKDOWN',
    } as ProviderAnalyticsSnapshotMessage & Record<string, unknown>;

    assert.equal(
        buildProviderAnalyticsSessionSnapshotKey(first, 'response-direct'),
        buildProviderAnalyticsSessionSnapshotKey(second, 'response-direct'),
    );
});

test('Sprint 8 Phase C snapshot keys track metadata changes without generatedAt churn', () => {
    const first = directRemapFallbackMessages();
    const second = directRemapFallbackMessages();
    second[1] = message('response-remap', {
        requestedProvider: 'bedrock',
        requestedModel: 'openai.gpt-oss-120b-1:0',
        actualProvider: 'openai',
        actualModel: 'gpt-4.1-mini',
        routingReason: 'bedrock_region_remap',
        providerPreference: 'bedrock',
    }, {
        routing: {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'openai',
            actualModel: 'gpt-4.1-mini',
            reason: 'bedrock_region_remap',
        },
    });

    const firstSnapshot = buildProviderAnalyticsSessionSnapshot(first, 'response-remap', 2000);
    const sameSnapshotLater = buildProviderAnalyticsSessionSnapshot(first, 'response-remap', 9000);

    assert.notEqual(
        buildProviderAnalyticsSessionSnapshotKey(first, 'response-remap'),
        buildProviderAnalyticsSessionSnapshotKey(second, 'response-remap'),
    );
    assert.equal(
        buildProviderAnalyticsSessionSnapshotStateKey(firstSnapshot),
        buildProviderAnalyticsSessionSnapshotStateKey(sameSnapshotLater),
    );
});

test('Sprint 8 Phase A IPC relay is memory-only and exposed through preload', () => {
    const ipcHandlers = read('electron/ipcHandlers.ts');
    const preload = read('electron/preload.ts');
    const electronTypes = read('src/types/electron.d.ts');
    const relayStart = ipcHandlers.indexOf('PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.set');
    const relayEnd = ipcHandlers.indexOf('safeHandle("delete-screenshot"');
    const relayBody = ipcHandlers.slice(relayStart, relayEnd);

    assert.match(ipcHandlers, /let providerAnalyticsSessionSnapshot/);
    assert.match(ipcHandlers, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.set/);
    assert.match(ipcHandlers, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.get/);
    assert.match(ipcHandlers, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.changed/);
    assert.match(preload, /setProviderAnalyticsSessionSnapshot/);
    assert.match(preload, /getProviderAnalyticsSessionSnapshot/);
    assert.match(preload, /onProviderAnalyticsSessionSnapshotChanged/);
    assert.match(preload, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.set/);
    assert.match(preload, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.get/);
    assert.match(preload, /PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC\.changed/);
    assert.match(electronTypes, /ProviderAnalyticsSessionSnapshotBridge/);
    assert.deepEqual(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC, {
        set: 'provider-analytics:set-session-snapshot',
        get: 'provider-analytics:get-session-snapshot',
        changed: 'provider-analytics:session-snapshot-changed',
    });
    assert.doesNotMatch(relayBody, /CredentialsManager|DatabaseManager|BenchmarkManager|writeFile|localStorage|setProviderPreferredModel|setModel/);
});

test('Sprint 8 Phase A settings wiring feeds retained snapshot responses into Sprint 7 read models', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');

    assert.match(settings, /buildProviderAnalyticsSessionSnapshotStateKey/);
    assert.match(settings, /providerAnalyticsSnapshotKeyRef/);
    assert.match(settings, /applyProviderAnalyticsSnapshot/);
    assert.match(settings, /getProviderAnalyticsSessionSnapshot/);
    assert.match(settings, /onProviderAnalyticsSessionSnapshotChanged/);
    assert.match(settings, /buildProviderRoutingReadModel\(\{\s*responses: providerAnalyticsSnapshot\.responses,\s*activeResponseId: providerAnalyticsSnapshot\.activeResponseId,/s);
    assert.match(settings, /buildProviderFallbackReadModel\(\{\s*responses: providerAnalyticsSnapshot\.responses,\s*activeResponseId: providerAnalyticsSnapshot\.activeResponseId,/s);
    assert.match(settings, /buildProviderTelemetryReadModel\(\{\s*responses: providerAnalyticsSnapshot\.responses,\s*activeResponseId: providerAnalyticsSnapshot\.activeResponseId,/s);
    assert.match(settings, /buildProviderPersonalizationReadModel\(\{\s*responses: providerAnalyticsSnapshot\.responses,\s*activeResponseId: providerAnalyticsSnapshot\.activeResponseId,/s);
    assert.match(settings, /ownershipByResponseId=\{providerAnalyticsSnapshot\.ownershipByResponseId\}/);
    assert.doesNotMatch(settings, /buildProviderRoutingReadModel\(\{\s*responses: \[\]/);
    assert.doesNotMatch(settings, /buildProviderFallbackReadModel\(\{\s*responses: \[\]/);
    assert.doesNotMatch(settings, /buildProviderTelemetryReadModel\(\{\s*responses: \[\]/);
    assert.doesNotMatch(settings, /buildProviderPersonalizationReadModel\(\{\s*responses: \[\]/);
    assert.doesNotMatch(settings, /ownershipByResponseId=\{\{\}\}/);
    assert.match(bridge, /buildProviderAnalyticsSessionSnapshotKey\(responseHistory, activeResponse\?\.id \?\? null\)/);
    assert.match(bridge, /setProviderAnalyticsSessionSnapshot\(snapshot\)/);
});

test('Sprint 8 Phase A integration fixture renders Sprint 7 analytics surfaces with retained rows', () => {
    const snapshot = buildProviderAnalyticsSessionSnapshot(
        directRemapFallbackMessages(),
        'response-fallback',
        2000,
    );
    const routing = buildProviderRoutingReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 2000,
    });
    const fallback = buildProviderFallbackReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 2000,
    });
    const telemetry = buildProviderTelemetryReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 2000,
    });
    const personalization = buildProviderPersonalizationReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 2000,
    });
    const diagnostics = buildProviderDiagnosticsReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 2000,
    });

    assert.equal(routing.routes.length, 3);
    assert.equal(routing.summary.directCount, 1);
    assert.equal(routing.summary.remapCount, 1);
    assert.equal(routing.summary.fallbackCount, 1);
    assert.equal(fallback.summary.totalFallbacks, 1);
    assert.equal(telemetry.entries.length, 3);
    assert.equal(personalization.entries.length, 3);
    assert.equal(diagnostics.byResponseId['response-fallback'].some((entry) => entry.category === 'auth_expired'), true);

    const routingHtml = renderToStaticMarkup(React.createElement(ProviderRoutingTransparencySurface, { readModel: routing }));
    const fallbackHtml = renderToStaticMarkup(React.createElement(ProviderFallbackAnalyticsSurface, { readModel: fallback }));
    const telemetryHtml = renderToStaticMarkup(React.createElement(ProviderTelemetrySurface, { readModel: telemetry }));
    const personalizationHtml = renderToStaticMarkup(React.createElement(ProviderPersonalizationImpactSurface, { readModel: personalization }));
    const drilldownHtml = renderToStaticMarkup(React.createElement(ProviderResponseDrilldownSurface, {
        ownershipByResponseId: snapshot.ownershipByResponseId,
        routingReadModel: routing,
        diagnosticsReadModel: diagnostics,
        telemetryReadModel: telemetry,
    }));

    assert.match(routingHtml, /data-routing-status="direct"/);
    assert.match(routingHtml, /data-routing-status="remapped"/);
    assert.match(routingHtml, /data-routing-status="fallback"/);
    assert.match(fallbackHtml, /data-fallback-category="auth_expired"/);
    assert.match(telemetryHtml, /data-telemetry-status="success"/);
    assert.match(telemetryHtml, /data-telemetry-status="failure"/);
    assert.match(personalizationHtml, /data-personalization-status="applied"|data-personalization-status="fallback"/);
    assert.match(drilldownHtml, /data-drilldown-response-id="response-fallback"/);
    assert.match(drilldownHtml, /data-drilldown-diagnostic="auth_expired"/);
});

test('Sprint 8 Phase A empty snapshot remains available for reset handling', () => {
    const empty = createEmptyProviderAnalyticsSessionSnapshot(3000);

    assert.equal(empty.generatedAt, 3000);
    assert.equal(empty.activeResponseId, null);
    assert.deepEqual(empty.responses, []);
    assert.deepEqual(empty.ownershipByResponseId, {});
});
