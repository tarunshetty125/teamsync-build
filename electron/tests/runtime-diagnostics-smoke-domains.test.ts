import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RuntimeDiagnosticsSurface } from '../../src/components/settings/RuntimeDiagnosticsSurface.tsx';
import { buildRuntimeDiagnosticsAggregation } from '../../src/lib/diagnostics/runtimeDiagnosticsAggregation.ts';
import {
    buildRuntimeDiagnosticsReadModel,
    type RuntimeDiagnosticsReadModel,
} from '../../src/lib/diagnostics/runtimeDiagnosticsReadModel.ts';

function buildSmokeModel(): RuntimeDiagnosticsReadModel {
    return buildRuntimeDiagnosticsReadModel({
        ipcBoundary: [
            {
                channel: 'session-export:save-report',
                valid: false,
                error: 'Invalid export save request.',
                timestamp: 1000,
            },
            {
                channel: 'provider-analytics:get-session-snapshot',
                valid: true,
                success: true,
                timestamp: 1001,
            },
        ],
        preloadBridge: [
            {
                api: 'saveSessionExportReport',
                available: false,
                missingApis: ['saveSessionExportPdfReport'],
                timestamp: 2000,
            },
            {
                api: 'getProviderAnalyticsSessionSnapshot',
                initialized: true,
                available: true,
                valid: true,
                timestamp: 2001,
            },
        ],
        electronRuntime: [
            {
                operation: 'renderSessionExportPdfFromHtml',
                success: false,
                error: 'PDF render timeout while writing /Users/tarunshetty/private/report.pdf',
                timestamp: 3000,
            },
            {
                operation: 'showSaveDialog',
                success: true,
                timestamp: 3001,
            },
        ],
        historySelection: {
            activeResponseId: 'removed-active',
            selectedResponseId: 'removed-selected',
            latestResponseId: 'kept-response',
            selectionMode: 'pinned',
            responseIds: ['kept-response'],
            ownershipByResponseId: {
                'kept-response': {
                    responseId: 'kept-response',
                    questionTurnId: 'turn-kept',
                    transcriptVersion: 1,
                    contextTarget: 'active_context',
                    actionId: 'manual_chat',
                    createdAt: 4000,
                    parentResponseId: 'removed-parent',
                    rootResponseId: 'removed-root',
                },
            },
            issues: ['pinned_selection_recovered_to_latest'],
            timestamp: 4000,
        },
        diagramParse: {
            responseId: 'diagram-response',
            timestamp: 5000,
            parsed: {
                state: 'invalid',
                issues: ['architecture_nodes_missing'],
            },
        },
        activeResponseId: 'removed-active',
        generatedAt: 6000,
    });
}

test('Sprint 13 Phase E normalizes IPC, preload, Electron, history, and diagram parse smoke domains', () => {
    const model = buildSmokeModel();

    assert.equal(model.byDomain['ipc.boundary'].length, 1);
    assert.equal(model.byDomain['preload.bridge'].length, 2);
    assert.equal(model.byDomain['runtime.electron'].length, 1);
    assert.equal(model.byDomain['history.selection'].length, 5);
    assert.equal(model.byDomain['diagram.parse'].length, 1);
    assert.equal(model.events.some((event) => event.code === 'ipc_contract_invalid'), true);
    assert.equal(model.events.some((event) => event.code === 'preload_api_missing' && event.severity === 'critical'), true);
    assert.equal(model.events.some((event) => event.code === 'electron_runtime_failure'), true);
    assert.equal(model.events.some((event) => event.code === 'active_response_not_retained'), true);
    assert.equal(model.events.some((event) => event.code === 'selected_response_not_retained'), true);
    assert.equal(model.events.some((event) => event.code === 'history_parent_response_not_retained'), true);
    assert.equal(model.events.some((event) => event.code === 'history_root_response_not_retained'), true);
    assert.equal(model.events.some((event) => event.code === 'architecture_nodes_missing'), true);
    assert.equal(model.summary.byDomain['ipc.boundary'], 1);
    assert.equal(model.summary.byDomain['preload.bridge'], 2);
    assert.equal(model.summary.byDomain['runtime.electron'], 1);
    assert.equal(model.summary.byDomain['history.selection'], 5);
    assert.equal(model.summary.byDomain['diagram.parse'], 1);
});

test('Sprint 13 Phase E smoke diagnostics stay metadata-only and sanitize local paths', () => {
    const model = buildSmokeModel();
    const serialized = JSON.stringify(model);

    assert.doesNotMatch(serialized, /\/Users\/tarunshetty\/private/);
    assert.doesNotMatch(serialized, /"(?:content|prompt|transcript|screenshot|payload)"\s*:/i);
    assert.match(serialized, /\[local-path-redacted\]/);
});

test('Sprint 13 Phase E smoke domains aggregate through the existing aggregation layer', () => {
    const aggregate = buildRuntimeDiagnosticsAggregation(buildSmokeModel());

    assert.equal(aggregate.domainSummaries['ipc.boundary'].totalEvents, 1);
    assert.equal(aggregate.domainSummaries['preload.bridge'].totalEvents, 2);
    assert.equal(aggregate.domainSummaries['runtime.electron'].totalEvents, 1);
    assert.equal(aggregate.domainSummaries['history.selection'].totalEvents, 5);
    assert.equal(aggregate.domainSummaries['diagram.parse'].totalEvents, 1);
    assert.equal(aggregate.eventsByDomain['ipc.boundary'].length, 1);
    assert.equal(aggregate.eventsByDomain['preload.bridge'].length, 2);
    assert.equal(aggregate.eventsByDomain['runtime.electron'].length, 1);
    assert.equal(aggregate.eventsByDomain['history.selection'].length, 5);
    assert.equal(aggregate.eventsByDomain['diagram.parse'].length, 1);
    assert.equal(aggregate.mostFrequentCodes.some((entry) => entry.code === 'preload_api_missing' && entry.count === 2), true);
});

test('Sprint 13 Phase E smoke domains are compatible with the diagnostics surface', () => {
    const html = renderToStaticMarkup(React.createElement(RuntimeDiagnosticsSurface, { readModel: buildSmokeModel() }));

    assert.match(html, /ipc\.boundary/);
    assert.match(html, /preload\.bridge/);
    assert.match(html, /runtime\.electron/);
    assert.match(html, /history\.selection/);
    assert.match(html, /diagram\.parse/);
    assert.match(html, /ipc_contract_invalid/);
    assert.match(html, /preload_api_missing/);
    assert.match(html, /electron_runtime_failure/);
    assert.match(html, /active_response_not_retained/);
    assert.match(html, /architecture_nodes_missing/);
    assert.doesNotMatch(html, /\/Users\/tarunshetty\/private/);
    assert.doesNotMatch(html, /Retry|Repair|Dismiss|Re-authenticate|Save|Copy/);
});
