import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import {
    PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS,
    PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC,
    applyProviderAnalyticsSessionSnapshotQuarantine,
    validateProviderAnalyticsSessionSnapshot,
    type ProviderAnalyticsSessionSnapshot,
} from '../../src/lib/providers/providerAnalyticsSessionSnapshot.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function makeOwnership(responseId: string, parentResponseId?: string): Partial<ResponseOwnership> {
    return {
        responseId,
        questionTurnId: `turn-${responseId}`,
        transcriptVersion: 4,
        contextTarget: 'latest_turn',
        actionId: 'manual_chat',
        parentResponseId,
        mode: 'coding',
        createdAt: 10_000,
        requestedProvider: 'bedrock',
        requestedModel: 'openai.gpt-oss-120b-1:0',
        actualProvider: 'groq',
        actualModel: 'llama-3.3-70b-versatile',
        routingReason: 'bedrock_auth_expired_fallback',
        personalizationVersion: 1,
    };
}

function makeSnapshot(count = 3): ProviderAnalyticsSessionSnapshot {
    const responses = Array.from({ length: count }, (_, index) => {
        const responseNumber = index + 1;
        const responseId = `response-${responseNumber}`;
        const parentResponseId = responseNumber === 1 ? undefined : `response-${responseNumber - 1}`;
        const ownership = makeOwnership(responseId, parentResponseId);

        return {
            id: responseId,
            responseId,
            requestId: `request-${responseId}`,
            provider: 'bedrock',
            model: 'openai.gpt-oss-120b-1:0',
            intent: 'answer_now',
            source: 'Manual Input',
            timestamp: 20_000 + responseNumber,
            questionTurnId: ownership.questionTurnId,
            ownership,
            debugMetadata: {
                routing: {
                    requestedProvider: 'bedrock',
                    requestedModel: 'openai.gpt-oss-120b-1:0',
                    actualProvider: 'groq',
                    actualModel: 'llama-3.3-70b-versatile',
                    reason: 'bedrock_auth_expired_fallback',
                },
                telemetry: {
                    latencyMs: 420 + responseNumber,
                    fallbackUsed: true,
                    streamingCompleted: true,
                    promptTokens: 30,
                    completionTokens: 90,
                },
            },
            parentResponseId,
            rootResponseId: 'response-1',
            questionTurn: ownership.questionTurnId,
            requestedProvider: ownership.requestedProvider,
            requestedModel: ownership.requestedModel,
            actualProvider: ownership.actualProvider,
            actualModel: ownership.actualModel,
            routingReason: ownership.routingReason,
            personalizationVersion: ownership.personalizationVersion,
            providerTelemetryMetadata: {
                latencyMs: 420 + responseNumber,
                fallbackUsed: true,
            },
            validationMetadata: { valid: true },
            isStreaming: false,
        };
    });
    const ownershipByResponseId = responses.reduce<Record<string, Partial<ResponseOwnership>>>((acc, response) => {
        acc[response.responseId] = response.ownership;
        return acc;
    }, {});

    return {
        generatedAt: 30_000,
        activeResponseId: responses.length > 0 ? responses[responses.length - 1].responseId : null,
        responses,
        ownershipByResponseId,
    };
}

function codes(snapshot: unknown): string[] {
    return validateProviderAnalyticsSessionSnapshot(snapshot).issues.map((issue) => issue.code);
}

test('Sprint 9 Phase D accepts valid metadata-only provider analytics snapshots', () => {
    const snapshot = makeSnapshot();
    const result = validateProviderAnalyticsSessionSnapshot(snapshot);

    assert.equal(result.status, 'valid');
    assert.equal(result.responseCount, 3);
    assert.equal(result.ownershipEntryCount, 3);
    assert.equal(result.issues.length, 0);
    assert.equal(result.budgets.maxResponses, PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxResponses);
});

test('Sprint 9 Phase D flags oversized provider analytics snapshots', () => {
    const snapshot = makeSnapshot();
    snapshot.responses[0].providerTelemetryMetadata = {
        retainedMetadata: 'x'.repeat(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxSerializedBytes),
    };
    const result = validateProviderAnalyticsSessionSnapshot(snapshot);

    assert.equal(result.status, 'invalid');
    assert.match(codes(snapshot).join(','), /payload_size_exceeded/);
});

test('Sprint 9 Phase D flags ownership alignment mismatches', () => {
    const snapshot = makeSnapshot();
    snapshot.ownershipByResponseId['response-2'] = {
        ...snapshot.ownershipByResponseId['response-2'],
        parentResponseId: 'removed-response',
    };
    const result = validateProviderAnalyticsSessionSnapshot(snapshot);

    assert.equal(result.status, 'invalid');
    assert.match(result.issues.map((issue) => issue.code).join(','), /ownership_field_mismatch/);
});

test('Sprint 9 Phase D enforces metadata-only snapshot shape', () => {
    const snapshot = {
        ...makeSnapshot(),
        markdown: 'LEAKED_MARKDOWN',
    };
    const result = validateProviderAnalyticsSessionSnapshot(snapshot);

    assert.equal(result.status, 'invalid');
    assert.match(result.issues.map((issue) => issue.code).join(','), /metadata_only_shape_violation/);
    assert.match(result.issues.map((issue) => issue.code).join(','), /content_leakage_detected/);
});

test('Sprint 9 Phase D detects response content leakage', () => {
    const snapshot = makeSnapshot() as ProviderAnalyticsSessionSnapshot & {
        responses: Array<ProviderAnalyticsSessionSnapshot['responses'][number] & { artifacts?: unknown; text?: string }>;
    };
    snapshot.responses[0] = {
        ...snapshot.responses[0],
        text: 'LEAKED_RESPONSE_TEXT',
        artifacts: [{ kind: 'architecture', payload: { diagram: [] } }],
    };
    const result = validateProviderAnalyticsSessionSnapshot(snapshot);

    assert.equal(result.status, 'invalid');
    assert.equal(result.issues.some((issue) => issue.code === 'content_leakage_detected' && issue.path.includes('.text')), true);
    assert.equal(result.issues.some((issue) => issue.code === 'content_leakage_detected' && issue.path.includes('.artifacts')), true);
});

test('Sprint 9 Phase D reports payload-size warnings before the hard ceiling', () => {
    const snapshot = makeSnapshot();
    snapshot.responses[0].providerTelemetryMetadata = {
        retainedMetadata: 'x'.repeat(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.warningSerializedBytes),
    };
    const result = validateProviderAnalyticsSessionSnapshot(snapshot);

    assert.equal(result.status, 'warning');
    assert.match(result.issues.map((issue) => issue.code).join(','), /payload_size_warning/);
    assert.doesNotMatch(result.issues.map((issue) => issue.code).join(','), /payload_size_exceeded/);
});

test('Sprint 9 Phase D enforces retained-response budget compliance', () => {
    const retainedSnapshot = makeSnapshot(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxResponses);
    const oversizedSnapshot = makeSnapshot(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxResponses + 1);
    const retainedResult = validateProviderAnalyticsSessionSnapshot(retainedSnapshot);
    const oversizedResult = validateProviderAnalyticsSessionSnapshot(oversizedSnapshot);

    assert.equal(retainedResult.status, 'valid');
    assert.equal(retainedResult.responseCount, PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxResponses);
    assert.equal(oversizedResult.status, 'invalid');
    assert.match(oversizedResult.issues.map((issue) => issue.code).join(','), /response_count_exceeded/);
    assert.match(oversizedResult.issues.map((issue) => issue.code).join(','), /ownership_entry_count_exceeded/);
});

test('Sprint 9 Phase D keeps IPC channels stable and adds non-blocking relay guardrails', () => {
    const ipcHandlers = read('electron/ipcHandlers.ts');
    const relayStart = ipcHandlers.indexOf('PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.set');
    const relayEnd = ipcHandlers.indexOf('safeHandle(SESSION_EXPORT_DELIVERY_IPC.save', relayStart);
    const relayBody = ipcHandlers.slice(relayStart, relayEnd);

    assert.deepEqual(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC, {
        set: 'provider-analytics:set-session-snapshot',
        get: 'provider-analytics:get-session-snapshot',
        changed: 'provider-analytics:session-snapshot-changed',
    });
    assert.match(ipcHandlers, /validateProviderAnalyticsSessionSnapshot/);
    assert.match(relayBody, /validateProviderAnalyticsSessionSnapshot\(snapshot\)/);
    assert.match(relayBody, /applyProviderAnalyticsSessionSnapshotQuarantine/);
    assert.match(relayBody, /console\.warn\('\[ProviderAnalytics\] session snapshot guardrail'/);
    assert.match(relayBody, /providerAnalyticsSessionSnapshot = quarantine\.currentSnapshot/);
    assert.match(relayBody, /if \(quarantine\.shouldBroadcast\)/);
    assert.match(relayBody, /broadcastProviderAnalyticsSessionSnapshot\(quarantine\.broadcastSnapshot\)/);
    assert.doesNotMatch(relayBody, /writeFile|localStorage|sessionStorage|indexedDB|BenchmarkManager|CredentialsManager/);
});

test('Sprint 14 Phase D accepts valid snapshots and broadcasts the retained metadata state', () => {
    const snapshot = makeSnapshot();
    const result = applyProviderAnalyticsSessionSnapshotQuarantine({
        currentSnapshot: null,
        incomingSnapshot: snapshot,
        timestamp: 14_000,
    });

    assert.equal(result.setResult.success, true);
    assert.equal(result.setResult.status, 'accepted');
    assert.equal(result.setResult.accepted, true);
    assert.equal(result.setResult.quarantined, false);
    assert.equal(result.setResult.diagnostic, undefined);
    assert.equal(result.currentSnapshot, snapshot);
    assert.equal(result.broadcastSnapshot, snapshot);
    assert.equal(result.shouldBroadcast, true);
});

test('Sprint 14 Phase D accepts warning snapshots with metadata-only diagnostics', () => {
    const snapshot = makeSnapshot() as ProviderAnalyticsSessionSnapshot & {
        responses: Array<ProviderAnalyticsSessionSnapshot['responses'][number] & { harmlessExtra?: string }>;
    };
    snapshot.responses[0] = {
        ...snapshot.responses[0],
        harmlessExtra: 'metadata-only-extra',
    };
    const result = applyProviderAnalyticsSessionSnapshotQuarantine({
        currentSnapshot: null,
        incomingSnapshot: snapshot,
        timestamp: 14_001,
    });
    const serialized = JSON.stringify(result.setResult.diagnostic);

    assert.equal(result.setResult.status, 'accepted_with_warning');
    assert.equal(result.setResult.accepted, true);
    assert.equal(result.setResult.quarantined, false);
    assert.equal(result.shouldBroadcast, true);
    assert.equal(result.currentSnapshot, snapshot);
    assert.equal(result.setResult.diagnostic?.code, 'provider_analytics_snapshot_warning');
    assert.equal(result.setResult.diagnostic?.status, 'warning');
    assert.equal(result.setResult.diagnostic?.userVisible, false);
    assert.match(serialized, /unknown_response_metadata_key/);
    assert.doesNotMatch(serialized, /SOLUTION_MARKDOWN|TRANSCRIPT_PAYLOAD|SCREENSHOT_PAYLOAD/);
});

test('Sprint 14 Phase D quarantines invalid snapshots without replacing the last valid snapshot', () => {
    const valid = makeSnapshot();
    const invalid = makeSnapshot() as ProviderAnalyticsSessionSnapshot & { markdown?: string };
    invalid.markdown = 'LEAKED_MARKDOWN';
    const result = applyProviderAnalyticsSessionSnapshotQuarantine({
        currentSnapshot: valid,
        incomingSnapshot: invalid,
        timestamp: 14_002,
    });

    assert.equal(result.setResult.status, 'quarantined');
    assert.equal(result.setResult.accepted, false);
    assert.equal(result.setResult.quarantined, true);
    assert.equal(result.shouldBroadcast, false);
    assert.equal(result.currentSnapshot, valid);
    assert.equal(result.broadcastSnapshot, valid);
    assert.equal(result.setResult.diagnostic?.code, 'provider_analytics_snapshot_quarantined');
    assert.equal(result.setResult.diagnostic?.status, 'invalid');
});

test('Sprint 14 Phase D keeps an empty snapshot state when the first snapshot is invalid', () => {
    const invalid = makeSnapshot() as ProviderAnalyticsSessionSnapshot & { markdown?: string };
    invalid.markdown = 'LEAKED_MARKDOWN';
    const result = applyProviderAnalyticsSessionSnapshotQuarantine({
        currentSnapshot: null,
        incomingSnapshot: invalid,
        timestamp: 14_003,
    });

    assert.equal(result.setResult.status, 'quarantined');
    assert.equal(result.shouldBroadcast, false);
    assert.equal(result.currentSnapshot?.generatedAt, 0);
    assert.equal(result.currentSnapshot?.activeResponseId, null);
    assert.deepEqual(result.currentSnapshot?.responses, []);
    assert.deepEqual(result.currentSnapshot?.ownershipByResponseId, {});
});

test('Sprint 14 Phase D preserves the last valid snapshot across multiple invalid snapshots', () => {
    const valid = makeSnapshot();
    const firstInvalid = makeSnapshot() as ProviderAnalyticsSessionSnapshot & { text?: string };
    const secondInvalid = makeSnapshot(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxResponses + 1);
    firstInvalid.text = 'LEAKED_RESPONSE_TEXT';

    const first = applyProviderAnalyticsSessionSnapshotQuarantine({
        currentSnapshot: valid,
        incomingSnapshot: firstInvalid,
        timestamp: 14_004,
    });
    const second = applyProviderAnalyticsSessionSnapshotQuarantine({
        currentSnapshot: first.currentSnapshot,
        incomingSnapshot: secondInvalid,
        timestamp: 14_005,
    });

    assert.equal(first.currentSnapshot, valid);
    assert.equal(second.currentSnapshot, valid);
    assert.equal(first.shouldBroadcast, false);
    assert.equal(second.shouldBroadcast, false);
    assert.equal(first.setResult.diagnostic?.issueCount, 2);
    assert.equal(second.setResult.diagnostic?.issues.some((issue) => issue.code === 'response_count_exceeded'), true);
});
