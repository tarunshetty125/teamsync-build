import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';
import { capResponseHistoryMessages } from '../../src/lib/overlay/responseHistoryState.ts';
import {
    buildProviderAnalyticsSessionSnapshot,
    buildProviderAnalyticsSessionSnapshotKey,
    type ProviderAnalyticsSnapshotMessage,
} from '../../src/lib/providers/providerAnalyticsSessionSnapshot.ts';
import { buildProviderRoutingReadModel } from '../../src/lib/providers/providerRoutingReadModel.ts';
import { buildProviderFallbackReadModel } from '../../src/lib/providers/providerFallbackReadModel.ts';
import { buildProviderTelemetryReadModel } from '../../src/lib/providers/providerTelemetryReadModel.ts';
import { buildProviderPersonalizationReadModel } from '../../src/lib/providers/providerPersonalizationReadModel.ts';
import { buildProviderDiagnosticsReadModel } from '../../src/lib/providers/providerDiagnosticsReadModel.ts';

interface LargeSessionMessage extends ProviderAnalyticsSnapshotMessage {
    id: string;
    role: 'system';
    rootResponseId?: string;
    ownership: ResponseOwnership;
    timestamp: number;
    requestId: string;
    intent: string;
    source: string;
    provider: string;
    model: string;
    intelligenceMetadata?: unknown;
    debugMetadata?: unknown;
    isStreaming?: boolean;
    text?: string;
    markdown?: string;
    artifacts?: V2ResponseArtifact[];
    architectureJson?: unknown;
    screenshotPreview?: string;
    transcript?: string;
}

function routeFor(index: number): {
    requestedProvider: string;
    requestedModel: string;
    actualProvider: string;
    actualModel: string;
    routingReason?: string;
} {
    if (index % 25 === 0) {
        return {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'local',
            actualModel: 'safe_action_fallback',
            routingReason: 'all_attempts_failed',
        };
    }

    if (index % 10 === 0) {
        return {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'groq',
            actualModel: 'llama-3.3-70b-versatile',
            routingReason: 'bedrock_auth_expired_fallback',
        };
    }

    if (index % 7 === 0) {
        return {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'bedrock',
            actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            routingReason: 'vision_required_model_remap',
        };
    }

    if (index % 5 === 0) {
        return {
            requestedProvider: 'gemini',
            requestedModel: 'gemini-2.5-pro',
            actualProvider: 'gemini',
            actualModel: 'gemini-2.5-pro',
        };
    }

    return {
        requestedProvider: 'openai',
        requestedModel: 'gpt-4.1-mini',
        actualProvider: 'openai',
        actualModel: 'gpt-4.1-mini',
    };
}

function ownershipFor(index: number, parentResponseId?: string): ResponseOwnership {
    const route = routeFor(index);

    return {
        responseId: `response-${index}`,
        questionTurnId: `turn-${index}`,
        transcriptVersion: index,
        contextTarget: parentResponseId ? 'active_context' : 'latest_turn',
        actionId: index % 3 === 0 ? 'manual_chat' : 'what_to_answer',
        parentResponseId,
        mode: index % 2 === 0 ? 'coding' : 'system_design',
        createdAt: 10_000 + index,
        sourceProvider: route.requestedProvider,
        sourceModel: route.requestedModel,
        requestedProvider: route.requestedProvider,
        requestedModel: route.requestedModel,
        actualProvider: route.actualProvider,
        actualModel: route.actualModel,
        routingReason: route.routingReason,
        resolvedCodingLanguage: index % 2 === 0 ? 'javascript' : undefined,
        providerPreference: route.requestedProvider,
        responseStyle: index % 3 === 0 ? 'detailed' : index % 3 === 1 ? 'balanced' : 'concise',
        interviewFocus: index % 2 === 0 ? 'coding' : 'system_design',
        personalizationVersion: 1,
    };
}

function debugFor(ownership: ResponseOwnership): unknown {
    const fallbackUsed = Boolean(ownership.routingReason?.includes('fallback') || ownership.routingReason === 'all_attempts_failed');
    const routeChanged = ownership.requestedProvider !== ownership.actualProvider
        || ownership.requestedModel !== ownership.actualModel
        || Boolean(ownership.routingReason);

    return {
        routing: {
            requestedProvider: ownership.requestedProvider,
            requestedModel: ownership.requestedModel,
            actualProvider: ownership.actualProvider,
            actualModel: ownership.actualModel,
            reason: ownership.routingReason ?? 'requested_model',
        },
        telemetry: {
            selectedProvider: ownership.requestedProvider,
            selectedModel: ownership.requestedModel,
            actualInvokedProvider: ownership.actualProvider,
            actualInvokedModel: ownership.actualModel,
            fallbackUsed,
            fallbackReason: ownership.routingReason,
            latencyMs: 175 + (ownership.transcriptVersion % 50),
            retryCount: fallbackUsed ? 1 : 0,
            streamingCompleted: ownership.transcriptVersion % 13 !== 0,
            success: !fallbackUsed,
            promptTokens: 40 + (ownership.transcriptVersion % 11),
            completionTokens: 90 + (ownership.transcriptVersion % 17),
        },
        fallbackChain: fallbackUsed
            ? [
                {
                    provider: ownership.requestedProvider,
                    model: ownership.requestedModel,
                    result: 'failure',
                    reason: ownership.routingReason,
                },
                {
                    provider: ownership.actualProvider,
                    model: ownership.actualModel,
                    result: routeChanged ? 'success' : 'failure',
                },
            ]
            : [],
        validation: {
            valid: !fallbackUsed,
            reason: fallbackUsed ? 'provider_fallback' : undefined,
        },
        personalization: {
            providerPreference: ownership.providerPreference,
            responseStyle: ownership.responseStyle,
            interviewFocus: ownership.interviewFocus,
            resolvedCodingLanguage: ownership.resolvedCodingLanguage,
            personalizationVersion: ownership.personalizationVersion,
        },
        prompt: `PROMPT_PAYLOAD_${ownership.responseId}`,
        content: `CONTENT_PAYLOAD_${ownership.responseId}`,
    };
}

function buildLargeSessionMessages(count: number): LargeSessionMessage[] {
    return Array.from({ length: count }, (_, index) => {
        const responseNumber = index + 1;
        const id = `response-${responseNumber}`;
        const parentResponseId = responseNumber > 1 ? `response-${responseNumber - 1}` : undefined;
        const ownership = ownershipFor(responseNumber, parentResponseId);

        return {
            id,
            role: 'system',
            requestId: `request-${responseNumber}`,
            rootResponseId: 'response-1',
            timestamp: ownership.createdAt,
            questionTurnId: ownership.questionTurnId,
            intent: ownership.actionId ?? 'what_to_answer',
            source: 'Pro V2',
            provider: ownership.requestedProvider ?? 'unknown',
            model: ownership.requestedModel ?? 'unknown',
            ownership,
            intelligenceMetadata: debugFor(ownership),
            debugMetadata: debugFor(ownership),
            isStreaming: responseNumber % 17 === 0,
            text: `RESPONSE_TEXT_PAYLOAD_${responseNumber}`,
            markdown: `RESPONSE_MARKDOWN_PAYLOAD_${responseNumber}`,
            screenshotPreview: `SCREENSHOT_PAYLOAD_${responseNumber}`,
            artifacts: [
                {
                    id: `${id}:architecture`,
                    responseId: id,
                    parentResponseId,
                    rootResponseId: 'response-1',
                    kind: 'architecture',
                    source: 'architecture_json',
                    createdAt: ownership.createdAt,
                    status: 'parsed',
                    payload: {
                        nodes: [`DIAGRAM_PAYLOAD_${responseNumber}`],
                    },
                },
            ],
            architectureJson: { nodes: [`ARCHITECTURE_PAYLOAD_${responseNumber}`] },
            transcript: `TRANSCRIPT_PAYLOAD_${responseNumber}`,
        };
    });
}

function assertNoLargePayloads(serialized: string): void {
    assert.doesNotMatch(serialized, /RESPONSE_TEXT_PAYLOAD/);
    assert.doesNotMatch(serialized, /RESPONSE_MARKDOWN_PAYLOAD/);
    assert.doesNotMatch(serialized, /SCREENSHOT_PAYLOAD/);
    assert.doesNotMatch(serialized, /DIAGRAM_PAYLOAD/);
    assert.doesNotMatch(serialized, /ARCHITECTURE_PAYLOAD/);
    assert.doesNotMatch(serialized, /TRANSCRIPT_PAYLOAD/);
    assert.doesNotMatch(serialized, /PROMPT_PAYLOAD/);
    assert.doesNotMatch(serialized, /CONTENT_PAYLOAD/);
    assert.doesNotMatch(serialized, /"text"|"markdown"|"artifacts"|"architectureJson"|"screenshotPreview"|"transcript"/);
}

test('Sprint 8 Phase E trims 1000-response sessions to retained metadata-only analytics snapshots', () => {
    const capped = capResponseHistoryMessages(buildLargeSessionMessages(1000), 30) as LargeSessionMessage[];
    const retainedIds = new Set(capped.map((message) => message.id));
    const snapshot = buildProviderAnalyticsSessionSnapshot(capped, 'response-1000', 12_000);
    const serialized = JSON.stringify(snapshot);

    assert.equal(capped.length, 30);
    assert.equal(capped[0].id, 'response-971');
    assert.equal(snapshot.responses.length, 30);
    assert.equal(snapshot.activeResponseId, 'response-1000');
    assert.equal(Object.keys(snapshot.ownershipByResponseId).length, 30);
    assertNoLargePayloads(serialized);

    snapshot.responses.forEach((response) => {
        const ownership = snapshot.ownershipByResponseId[response.responseId];
        assert.ok(ownership);
        assert.equal(response.requestedProvider, ownership.requestedProvider);
        assert.equal(response.actualProvider, ownership.actualProvider);
        assert.equal(response.routingReason, ownership.routingReason);
        assert.equal(!response.parentResponseId || retainedIds.has(response.parentResponseId), true);
        assert.equal(!response.rootResponseId || retainedIds.has(response.rootResponseId), true);
    });
});

test('Sprint 8 Phase E validates analytics read models at 100, 500, and 1000 metadata rows', () => {
    for (const size of [100, 500, 1000]) {
        const snapshot = buildProviderAnalyticsSessionSnapshot(
            buildLargeSessionMessages(size),
            `response-${size}`,
            20_000 + size,
        );
        const startedAt = performance.now();
        const routing = buildProviderRoutingReadModel({
            responses: snapshot.responses,
            activeResponseId: snapshot.activeResponseId,
            now: 20_000 + size,
        });
        const fallback = buildProviderFallbackReadModel({
            responses: snapshot.responses,
            activeResponseId: snapshot.activeResponseId,
            now: 20_000 + size,
        });
        const telemetry = buildProviderTelemetryReadModel({
            responses: snapshot.responses,
            activeResponseId: snapshot.activeResponseId,
            now: 20_000 + size,
        });
        const personalization = buildProviderPersonalizationReadModel({
            responses: snapshot.responses,
            activeResponseId: snapshot.activeResponseId,
            now: 20_000 + size,
        });
        const diagnostics = buildProviderDiagnosticsReadModel({
            responses: snapshot.responses,
            activeResponseId: snapshot.activeResponseId,
            now: 20_000 + size,
        });
        const durationMs = performance.now() - startedAt;

        assert.equal(routing.routes.length, size);
        assert.equal(telemetry.entries.length, size);
        assert.equal(personalization.entries.length, size);
        assert.equal(routing.activeRoute?.responseId, `response-${size}`);
        assert.equal(telemetry.activeEntry?.responseId, `response-${size}`);
        assert.equal(personalization.activeEntry?.responseId, `response-${size}`);
        assert.equal(fallback.summary.totalFallbacks > 0, true);
        assert.equal(diagnostics.summary.totalDiagnostics > 0, true);
        assert.equal(Number.isFinite(durationMs), true);
        assert.equal(durationMs < 2_000, true, `${size} rows should build analytics read models within a generous local bound`);
    }
});

test('Sprint 8 Phase E large snapshot key ignores response body churn while preserving metadata changes', () => {
    const first = buildLargeSessionMessages(1000);
    const bodyOnlyChange = first.map((message, index) => ({
        ...message,
        text: `DIFFERENT_RESPONSE_TEXT_${index}`,
        markdown: `DIFFERENT_MARKDOWN_${index}`,
        screenshotPreview: `DIFFERENT_SCREENSHOT_${index}`,
        artifacts: message.artifacts?.map((artifact) => ({
            ...artifact,
            payload: { nodes: [`DIFFERENT_DIAGRAM_${index}`] },
        })),
        architectureJson: { nodes: [`DIFFERENT_ARCH_${index}`] },
        transcript: `DIFFERENT_TRANSCRIPT_${index}`,
    }));
    const metadataChange = first.map((message, index) => index === 999
        ? {
            ...message,
            ownership: {
                ...message.ownership,
                actualProvider: 'groq',
                actualModel: 'llama-3.3-70b-versatile',
                routingReason: 'manual_large_session_fallback',
            },
        }
        : message);

    assert.equal(
        buildProviderAnalyticsSessionSnapshotKey(first, 'response-1000'),
        buildProviderAnalyticsSessionSnapshotKey(bodyOnlyChange, 'response-1000'),
    );
    assert.notEqual(
        buildProviderAnalyticsSessionSnapshotKey(first, 'response-1000'),
        buildProviderAnalyticsSessionSnapshotKey(metadataChange, 'response-1000'),
    );
});
