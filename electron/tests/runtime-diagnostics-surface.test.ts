import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RuntimeDiagnosticsSurface } from '../../src/components/settings/RuntimeDiagnosticsSurface.tsx';
import type {
    RuntimeDiagnosticDomain,
    RuntimeDiagnosticEvent,
    RuntimeDiagnosticSeverity,
    RuntimeDiagnosticsReadModel,
} from '../../src/lib/diagnostics/runtimeDiagnosticsReadModel.ts';
import { RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS } from '../../src/lib/diagnostics/runtimeDiagnosticsAggregation.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function event(overrides: Partial<RuntimeDiagnosticEvent> & {
    id: string;
    domain: RuntimeDiagnosticDomain;
    code: string;
    severity: RuntimeDiagnosticSeverity;
}): RuntimeDiagnosticEvent {
    return {
        timestamp: 10_000,
        source: 'runtime_diagnostics_test',
        message: `${overrides.domain} ${overrides.code}`,
        recoverable: true,
        userVisible: false,
        ...overrides,
    };
}

function groupBy(
    events: RuntimeDiagnosticEvent[],
    getKey: (diagnostic: RuntimeDiagnosticEvent) => string | undefined,
): Record<string, RuntimeDiagnosticEvent[]> {
    const groups = new Map<string, RuntimeDiagnosticEvent[]>();
    events.forEach((diagnostic) => {
        const key = getKey(diagnostic);
        if (!key) return;
        const group = groups.get(key) ?? [];
        group.push(diagnostic);
        groups.set(key, group);
    });
    return Object.fromEntries(groups.entries()) as Record<string, RuntimeDiagnosticEvent[]>;
}

function readModel(events: RuntimeDiagnosticEvent[], activeResponseId: string | null = 'response-active'): RuntimeDiagnosticsReadModel {
    const activeEvents = activeResponseId
        ? events.filter((diagnostic) => diagnostic.responseId === activeResponseId)
        : [];

    return {
        events,
        byId: Object.fromEntries(events.map((diagnostic) => [diagnostic.id, diagnostic])),
        byDomain: groupBy(events, (diagnostic) => diagnostic.domain),
        bySeverity: groupBy(events, (diagnostic) => diagnostic.severity),
        byResponseId: groupBy(events, (diagnostic) => diagnostic.responseId),
        activeResponseId: activeResponseId ?? undefined,
        activeEvents,
        summary: {
            totalEvents: events.length,
            infoCount: events.filter((diagnostic) => diagnostic.severity === 'info').length,
            warningCount: events.filter((diagnostic) => diagnostic.severity === 'warning').length,
            errorCount: events.filter((diagnostic) => diagnostic.severity === 'error').length,
            criticalCount: events.filter((diagnostic) => diagnostic.severity === 'critical').length,
            recoverableCount: events.filter((diagnostic) => diagnostic.recoverable).length,
            userVisibleCount: events.filter((diagnostic) => diagnostic.userVisible).length,
            byDomain: {},
            bySeverity: {},
        },
        generatedAt: 50_000,
    };
}

function fixtureReadModel(): RuntimeDiagnosticsReadModel {
    return readModel([
        event({
            id: 'active-error',
            domain: 'provider.health',
            code: 'auth_expired',
            severity: 'error',
            responseId: 'response-active',
            source: 'provider_diagnostics',
            message: 'AWS session expired.',
            recoverable: true,
            userVisible: true,
            timestamp: 10_000,
        }),
        event({
            id: 'critical-export',
            domain: 'export.guardrail',
            code: 'content_leakage_key_detected',
            severity: 'critical',
            responseId: 'response-export',
            source: 'export_guardrails',
            message: 'Session export read models must remain allowlist-based.',
            recoverable: false,
            userVisible: true,
            timestamp: 12_000,
            redactedContext: {
                path: 'responses[0].debugMetadata.prompt',
                unsafeValue: '/Users/tarunshetty/private/token.txt',
            },
        }),
        event({
            id: 'warning-diagram',
            domain: 'diagram.guardrail',
            code: 'diagram_oversized_for_comparison',
            severity: 'warning',
            responseId: 'response-diagram',
            source: 'diagram_guardrails',
            message: 'Diagram guardrail: diagram_oversized_for_comparison',
            recoverable: true,
            userVisible: true,
            timestamp: 11_000,
        }),
        event({
            id: 'info-pdf',
            domain: 'export.delivery',
            code: 'pdf_save_canceled',
            severity: 'info',
            source: 'export_delivery',
            message: 'Export delivery was canceled before writing.',
            recoverable: true,
            userVisible: true,
            timestamp: 9000,
        }),
    ]);
}

function renderSurface(model: RuntimeDiagnosticsReadModel = fixtureReadModel()): string {
    return renderToStaticMarkup(React.createElement(RuntimeDiagnosticsSurface, { readModel: model }));
}

test('Sprint 13 Phase D diagnostics surface consumes only unified runtime diagnostics inputs', () => {
    const source = read('src/components/settings/RuntimeDiagnosticsSurface.tsx');

    assert.match(source, /readModel: RuntimeDiagnosticsReadModel/);
    assert.match(source, /buildRuntimeDiagnosticsAggregation\(readModel\)/);
    assert.match(source, /RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS/);
    assert.match(source, /RUNTIME_DIAGNOSTIC_AGGREGATION_SEVERITIES/);
    assert.doesNotMatch(source, /buildProvider|ProviderDiagnosticsReadModel|SessionExportGuardrail|ProviderAnalyticsSessionSnapshot|DiagramGuardrailReadModel|validateSessionExport|validateProviderAnalytics|validateActionOutput/);
    assert.doesNotMatch(source, /ipcRenderer|ipcMain|safeHandle|localStorage|sessionStorage|indexedDB|BenchmarkManager|CredentialsManager|LLMHelper/);
    assert.doesNotMatch(source, /<button|onClick|retry|Retry|dismiss|Dismiss|repair|Repair/);
});

test('Sprint 13 Phase D renders summary and severity breakdown', () => {
    const html = renderSurface();

    assert.match(html, /Runtime Diagnostics/);
    assert.match(html, /Total Events/);
    assert.match(html, /Active Events/);
    assert.match(html, /Recoverable Events/);
    assert.match(html, /User Visible Events/);
    assert.match(html, />4</);
    assert.match(html, /Severity Breakdown/);
    assert.match(html, /info/);
    assert.match(html, /warning/);
    assert.match(html, /error/);
    assert.match(html, /critical/);
});

test('Sprint 13 Phase D renders all known domains', () => {
    const html = renderSurface();

    for (const domain of RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS) {
        assert.match(html, new RegExp(domain.replace(/\./g, '\\.')));
    }
    assert.match(html, /data-runtime-diagnostics-row="domain:provider.health"/);
    assert.match(html, /data-runtime-diagnostics-row="domain:history.selection"/);
});

test('Sprint 13 Phase D filters active and recoverable diagnostics', () => {
    const html = renderSurface();
    const activeIndex = html.indexOf('data-runtime-diagnostics-list="active"');
    const recentIndex = html.indexOf('data-runtime-diagnostics-list="recent"');
    const recoverableIndex = html.indexOf('data-runtime-diagnostics-list="recoverable"');
    const activeSection = html.slice(activeIndex, recentIndex);
    const recoverableSection = html.slice(recoverableIndex);

    assert.match(activeSection, /active-error/);
    assert.doesNotMatch(activeSection, /critical-export|warning-diagram|info-pdf/);
    assert.match(recoverableSection, /active-error/);
    assert.match(recoverableSection, /warning-diagram/);
    assert.match(recoverableSection, /info-pdf/);
    assert.doesNotMatch(recoverableSection, /critical-export/);
});

test('Sprint 13 Phase D renders recent diagnostics newest first', () => {
    const html = renderSurface();
    const recentIndex = html.indexOf('data-runtime-diagnostics-list="recent"');
    const recoverableIndex = html.indexOf('data-runtime-diagnostics-list="recoverable"');
    const recentSection = html.slice(recentIndex, recoverableIndex);

    const criticalIndex = recentSection.indexOf('critical-export');
    const warningIndex = recentSection.indexOf('warning-diagram');
    const activeIndex = recentSection.indexOf('active-error');
    const infoIndex = recentSection.indexOf('info-pdf');

    assert.equal(criticalIndex >= 0, true);
    assert.equal(warningIndex > criticalIndex, true);
    assert.equal(activeIndex > warningIndex, true);
    assert.equal(infoIndex > activeIndex, true);
});

test('Sprint 13 Phase D displays only approved event fields and remains privacy-safe', () => {
    const html = renderSurface();

    assert.match(html, /auth_expired/);
    assert.match(html, /provider.health/);
    assert.match(html, /error/);
    assert.match(html, /AWS session expired/);
    assert.match(html, /provider_diagnostics/);
    assert.match(html, /1970-01-01T00:00:10.000Z/);
    assert.doesNotMatch(html, /\/Users\/tarunshetty\/private/);
    assert.doesNotMatch(html, /debugMetadata\.prompt/);
    assert.doesNotMatch(html, /unsafeValue/);
    assert.doesNotMatch(html, /redactedContext/);
});

test('Sprint 13 Phase D renders empty states', () => {
    const html = renderSurface(readModel([], null));

    assert.match(html, /Total Events/);
    assert.match(html, /No active diagnostics/);
    assert.match(html, /No recent diagnostics/);
    assert.match(html, /No recoverable diagnostics/);
    assert.match(html, /data-runtime-diagnostics-row="severity:critical"/);
    assert.match(html, /data-runtime-diagnostics-row="domain:preload.bridge"/);
});

test('Sprint 13 Phase D surface is read-only', () => {
    const html = renderSurface();

    assert.doesNotMatch(html, /<button|role="button"|Retry|Repair|Dismiss|Configure|Re-authenticate|Save|Copy|Route|Switch/);
    assert.doesNotMatch(html, /href=/);
});
