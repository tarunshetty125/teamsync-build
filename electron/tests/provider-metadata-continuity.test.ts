import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import {
    capResponseHistoryMessages,
} from '../../src/lib/overlay/responseHistoryState.ts';
import {
    resolveNextActiveResponseSelection,
} from '../../src/lib/overlay/responseHistorySelection.ts';
import {
    applyRoutingMetadataToOwnership,
} from '../../src/lib/overlay/responseRoutingMetadata.ts';
import {
    buildProviderAnalyticsSessionSnapshot,
    type ProviderAnalyticsSnapshotMessage,
} from '../../src/lib/providers/providerAnalyticsSessionSnapshot.ts';
import {
    buildProviderRoutingReadModel,
} from '../../src/lib/providers/providerRoutingReadModel.ts';
import {
    buildProviderFallbackReadModel,
} from '../../src/lib/providers/providerFallbackReadModel.ts';
import {
    buildProviderTelemetryReadModel,
} from '../../src/lib/providers/providerTelemetryReadModel.ts';
import {
    buildProviderPersonalizationReadModel,
} from '../../src/lib/providers/providerPersonalizationReadModel.ts';

interface ProviderContinuityMessage extends ProviderAnalyticsSnapshotMessage {
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
    isStreaming?: boolean;
}

function ownershipFor(index: number, parentResponseId?: string): ResponseOwnership {
    const isFallback = index % 10 === 0;
    const isRemap = !isFallback && index % 7 === 0;
    const requestedProvider = isFallback || isRemap ? 'bedrock' : 'openai';
    const requestedModel = requestedProvider === 'bedrock'
        ? 'openai.gpt-oss-120b-1:0'
        : 'gpt-4.1-mini';
    const actualProvider = isFallback ? 'groq' : requestedProvider;
    const actualModel = isFallback
        ? 'llama-3.3-70b-versatile'
        : isRemap
            ? 'anthropic.claude-3-5-sonnet-20241022-v2:0'
            : requestedModel;
    const routingReason = isFallback
        ? 'bedrock_auth_expired_fallback'
        : isRemap
            ? 'vision_required_model_remap'
            : undefined;

    return {
        responseId: `response-${index}`,
        questionTurnId: `turn-${index}`,
        transcriptVersion: index,
        contextTarget: parentResponseId ? 'active_context' : 'latest_turn',
        actionId: index % 3 === 0 ? 'manual_chat' : 'what_to_answer',
        parentResponseId,
        mode: index % 2 === 0 ? 'coding' : 'system_design',
        createdAt: 1000 + index,
        sourceProvider: requestedProvider,
        sourceModel: requestedModel,
        requestedProvider,
        requestedModel,
        actualProvider,
        actualModel,
        routingReason,
        resolvedCodingLanguage: index % 2 === 0 ? 'javascript' : undefined,
        providerPreference: requestedProvider,
        responseStyle: index % 2 === 0 ? 'concise' : 'balanced',
        interviewFocus: index % 2 === 0 ? 'coding' : 'system_design',
        personalizationVersion: 1,
    };
}

function debugFor(ownership: ResponseOwnership): unknown {
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
            fallbackUsed: Boolean(ownership.routingReason?.includes('fallback')),
            fallbackReason: ownership.routingReason,
            latencyMs: 250 + ownership.transcriptVersion,
            streamingCompleted: true,
            success: !ownership.routingReason?.includes('fallback'),
            promptTokens: 20,
            completionTokens: 80,
        },
        fallbackChain: ownership.routingReason?.includes('fallback')
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
                    result: 'success',
                },
            ]
            : [],
        validation: {
            valid: !ownership.routingReason?.includes('fallback'),
        },
        personalization: {
            providerPreference: ownership.providerPreference,
            responseStyle: ownership.responseStyle,
            interviewFocus: ownership.interviewFocus,
            resolvedCodingLanguage: ownership.resolvedCodingLanguage,
            personalizationVersion: ownership.personalizationVersion,
        },
    };
}

function buildMessages(count: number): ProviderContinuityMessage[] {
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
            isStreaming: false,
        };
    });
}

function assertSnapshotMatchesRetainedResponses(
    retained: ProviderContinuityMessage[],
    activeResponseId: string,
): void {
    const snapshot = buildProviderAnalyticsSessionSnapshot(retained, activeResponseId, 4000);
    const retainedIds = new Set(retained.map((message) => message.id));

    assert.equal(snapshot.responses.length, retained.length);
    assert.equal(snapshot.activeResponseId, activeResponseId);
    assert.deepEqual(
        snapshot.responses.map((response) => response.responseId),
        retained.map((message) => message.id),
    );

    retained.forEach((message) => {
        const snapshotResponse = snapshot.responses.find((response) => response.responseId === message.id);
        const snapshotOwnership = snapshot.ownershipByResponseId[message.id];
        assert.ok(snapshotResponse);
        assert.ok(snapshotOwnership);
        assert.equal(snapshotResponse?.requestedProvider, message.ownership?.requestedProvider);
        assert.equal(snapshotResponse?.requestedModel, message.ownership?.requestedModel);
        assert.equal(snapshotResponse?.actualProvider, message.ownership?.actualProvider);
        assert.equal(snapshotResponse?.actualModel, message.ownership?.actualModel);
        assert.equal(snapshotResponse?.routingReason, message.ownership?.routingReason);
        assert.equal(snapshotOwnership.requestedProvider, message.ownership?.requestedProvider);
        assert.equal(snapshotOwnership.actualProvider, message.ownership?.actualProvider);
        assert.equal(snapshotOwnership.routingReason, message.ownership?.routingReason);
        assert.equal(snapshotOwnership.personalizationVersion, message.ownership?.personalizationVersion);
        assert.equal(!snapshotResponse?.parentResponseId || retainedIds.has(snapshotResponse.parentResponseId), true);
        assert.equal(!snapshotResponse?.rootResponseId || retainedIds.has(snapshotResponse.rootResponseId), true);
    });
}

test('Sprint 8 Phase B preserves provider metadata through cap trimming and snapshot projection', () => {
    const messages = buildMessages(45);
    const capped = capResponseHistoryMessages(messages, 30) as ProviderContinuityMessage[];
    const retainedIds = new Set(capped.map((message) => message.id));

    assert.equal(capped.length, 30);
    assert.equal(capped[0].id, 'response-16');
    capped.forEach((message) => {
        assert.equal(message.ownership?.requestedProvider, ownershipFor(Number(message.id.split('-')[1]), message.ownership?.parentResponseId).requestedProvider);
        assert.equal(message.ownership?.actualProvider, ownershipFor(Number(message.id.split('-')[1]), message.ownership?.parentResponseId).actualProvider);
        assert.equal(!message.ownership?.parentResponseId || retainedIds.has(message.ownership.parentResponseId), true);
        assert.equal(!message.rootResponseId || retainedIds.has(message.rootResponseId), true);
    });

    assertSnapshotMatchesRetainedResponses(capped, 'response-45');
});

test('Sprint 8 Phase B provider analytics active route follows pinned selection while latest changes', () => {
    const initial = buildMessages(30);
    const pinnedResponseId = 'response-20';
    const withNewResponse = [
        ...initial,
        ...buildMessages(31).slice(30),
    ];
    const responseIds = withNewResponse.map((message) => message.id);
    const selection = resolveNextActiveResponseSelection({
        currentActiveResponseId: pinnedResponseId,
        selectionMode: 'pinned',
        previousLatestResponseId: 'response-30',
        nextLatestResponseId: 'response-31',
        responseIds,
    });
    const snapshot = buildProviderAnalyticsSessionSnapshot(withNewResponse, selection.activeResponseId, 5000);
    const routing = buildProviderRoutingReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 5000,
    });

    assert.equal(selection.activeResponseId, pinnedResponseId);
    assert.equal(selection.selectionMode, 'pinned');
    assert.equal(routing.activeRoute?.responseId, pinnedResponseId);
    assert.equal(routing.activeRoute?.requestedProvider, snapshot.ownershipByResponseId[pinnedResponseId].requestedProvider);
    assert.equal(routing.byResponseId['response-31'].responseId, 'response-31');
});

test('Sprint 8 Phase B provider read models remain consistent after retained history trimming', () => {
    const capped = capResponseHistoryMessages(buildMessages(45), 30) as ProviderContinuityMessage[];
    const snapshot = buildProviderAnalyticsSessionSnapshot(capped, 'response-45', 6000);
    const routing = buildProviderRoutingReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 6000,
    });
    const fallback = buildProviderFallbackReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 6000,
    });
    const telemetry = buildProviderTelemetryReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 6000,
    });
    const personalization = buildProviderPersonalizationReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 6000,
    });

    assert.equal(routing.routes.length, 30);
    assert.equal(telemetry.entries.length, 30);
    assert.equal(personalization.entries.length, 30);
    assert.equal(Object.keys(routing.byResponseId).some((responseId) => responseId === 'response-1'), false);
    assert.equal(Object.keys(telemetry.byResponseId).some((responseId) => responseId === 'response-1'), false);
    assert.equal(fallback.fallbacks.every((entry) => Boolean(snapshot.ownershipByResponseId[entry.responseId])), true);
    assert.equal(routing.routes.every((route) => route.requestedProvider === snapshot.ownershipByResponseId[route.responseId].requestedProvider), true);
    assert.equal(routing.routes.every((route) => route.actualProvider === snapshot.ownershipByResponseId[route.responseId].actualProvider), true);
});

test('Sprint 8 Phase B routing hydration preserves existing ownership when debug metadata is partial or absent', () => {
    const ownership = ownershipFor(10, 'response-9');
    const withoutDebug = applyRoutingMetadataToOwnership(ownership, undefined);
    const partialDebug = applyRoutingMetadataToOwnership(ownership, {
        telemetry: {
            fallbackUsed: true,
            fallbackReason: 'bedrock_auth_expired_fallback',
        },
    });

    assert.equal(withoutDebug, ownership);
    assert.equal(partialDebug?.requestedProvider, ownership.requestedProvider);
    assert.equal(partialDebug?.requestedModel, ownership.requestedModel);
    assert.equal(partialDebug?.actualProvider, ownership.actualProvider);
    assert.equal(partialDebug?.actualModel, ownership.actualModel);
    assert.equal(partialDebug?.routingReason, 'bedrock_auth_expired_fallback');
    assert.equal(partialDebug?.sourceProvider, ownership.sourceProvider);
    assert.equal(partialDebug?.sourceModel, ownership.sourceModel);
});
