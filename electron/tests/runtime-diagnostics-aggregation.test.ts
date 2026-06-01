import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    buildRuntimeDiagnosticsAggregation,
    RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS,
    RUNTIME_DIAGNOSTIC_AGGREGATION_SEVERITIES,
} from '../../src/lib/diagnostics/runtimeDiagnosticsAggregation.ts';
import type {
    RuntimeDiagnosticDomain,
    RuntimeDiagnosticEvent,
    RuntimeDiagnosticSeverity,
    RuntimeDiagnosticsReadModel,
} from '../../src/lib/diagnostics/runtimeDiagnosticsReadModel.ts';

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
    getKey: (event: RuntimeDiagnosticEvent) => string | undefined,
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

function makeReadModel(events: RuntimeDiagnosticEvent[], activeResponseId: string | null = 'response-active'): RuntimeDiagnosticsReadModel {
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

function fixtureEvents(): RuntimeDiagnosticEvent[] {
    return [
        event({
            id: '01-provider-health',
            domain: 'provider.health',
            code: 'auth_expired',
            severity: 'error',
            responseId: 'response-active',
            provider: 'bedrock',
            recoverable: true,
            userVisible: true,
        }),
        event({
            id: '02-provider-fallback',
            domain: 'provider.fallback',
            code: 'auth_expired',
            severity: 'error',
            responseId: 'response-active',
            provider: 'bedrock',
            recoverable: true,
            userVisible: true,
        }),
        event({
            id: '03-export-critical',
            domain: 'export.guardrail',
            code: 'content_leakage_key_detected',
            severity: 'critical',
            responseId: 'response-export',
            recoverable: false,
            userVisible: true,
        }),
        event({
            id: '04-snapshot-warning',
            domain: 'snapshot.guardrail',
            code: 'payload_size_warning',
            severity: 'warning',
            responseId: 'response-snapshot',
            recoverable: true,
            userVisible: false,
        }),
        event({
            id: '05-validation-error',
            domain: 'validation.contract',
            code: 'coding_missing_code_block',
            severity: 'error',
            responseId: 'response-export',
            recoverable: true,
            userVisible: false,
        }),
        event({
            id: '06-personalization-info',
            domain: 'personalization.resolution',
            code: 'not_captured',
            severity: 'info',
            responseId: 'response-personalization',
            provider: 'groq',
            recoverable: true,
            userVisible: false,
        }),
        event({
            id: '07-diagram-warning',
            domain: 'diagram.guardrail',
            code: 'diagram_oversized_for_comparison',
            severity: 'warning',
            responseId: 'response-personalization',
            recoverable: true,
            userVisible: true,
        }),
        event({
            id: '08-export-delivery-info',
            domain: 'export.delivery',
            code: 'pdf_save_canceled',
            severity: 'info',
            recoverable: true,
            userVisible: true,
        }),
    ];
}

test('Sprint 13 Phase C aggregates severity summaries', () => {
    const aggregate = buildRuntimeDiagnosticsAggregation(makeReadModel(fixtureEvents()));

    assert.equal(aggregate.totalEvents, 8);
    assert.equal(aggregate.severitySummaries.info.totalEvents, 2);
    assert.equal(aggregate.severitySummaries.warning.totalEvents, 2);
    assert.equal(aggregate.severitySummaries.error.totalEvents, 3);
    assert.equal(aggregate.severitySummaries.critical.totalEvents, 1);
    assert.equal(aggregate.eventsBySeverity.info.length, 2);
    assert.equal(aggregate.eventsBySeverity.warning.length, 2);
    assert.equal(aggregate.eventsBySeverity.error.length, 3);
    assert.equal(aggregate.eventsBySeverity.critical.length, 1);
});

test('Sprint 13 Phase C aggregates domain summaries including zero-count future domains', () => {
    const aggregate = buildRuntimeDiagnosticsAggregation(makeReadModel(fixtureEvents()));

    assert.deepEqual(Object.keys(aggregate.domainSummaries), [...RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS]);
    assert.equal(aggregate.domainSummaries['provider.health'].totalEvents, 1);
    assert.equal(aggregate.domainSummaries['provider.fallback'].totalEvents, 1);
    assert.equal(aggregate.domainSummaries['validation.contract'].totalEvents, 1);
    assert.equal(aggregate.domainSummaries['diagram.guardrail'].totalEvents, 1);
    assert.equal(aggregate.domainSummaries['export.guardrail'].severityCounts.critical, 1);
    assert.equal(aggregate.domainSummaries['snapshot.guardrail'].severityCounts.warning, 1);
    assert.equal(aggregate.domainSummaries['diagram.parse'].totalEvents, 0);
    assert.equal(aggregate.domainSummaries['ipc.boundary'].totalEvents, 0);
    assert.equal(aggregate.domainSummaries['runtime.electron'].totalEvents, 0);
    assert.equal(aggregate.domainSummaries['preload.bridge'].totalEvents, 0);
    assert.equal(aggregate.domainSummaries['history.selection'].totalEvents, 0);
});

test('Sprint 13 Phase C filters active, recoverable, and user-visible events', () => {
    const aggregate = buildRuntimeDiagnosticsAggregation(makeReadModel(fixtureEvents()));

    assert.deepEqual(aggregate.activeEvents.map((diagnostic) => diagnostic.id), [
        '01-provider-health',
        '02-provider-fallback',
    ]);
    assert.equal(aggregate.recoverableEvents.length, 7);
    assert.equal(aggregate.userVisibleEvents.length, 5);
    assert.equal(aggregate.severitySummaries.error.activeEvents, 2);
    assert.equal(aggregate.domainSummaries['provider.health'].activeEvents, 1);
    assert.equal(aggregate.domainSummaries['export.guardrail'].recoverableEvents, 0);
    assert.equal(aggregate.domainSummaries['export.guardrail'].userVisibleEvents, 1);
});

test('Sprint 13 Phase C groups events by provider and responseId', () => {
    const aggregate = buildRuntimeDiagnosticsAggregation(makeReadModel(fixtureEvents()));

    assert.deepEqual(Object.keys(aggregate.eventsByProvider), ['bedrock', 'groq']);
    assert.deepEqual(aggregate.eventsByProvider.bedrock.map((diagnostic) => diagnostic.id), [
        '01-provider-health',
        '02-provider-fallback',
    ]);
    assert.deepEqual(aggregate.eventsByProvider.groq.map((diagnostic) => diagnostic.id), [
        '06-personalization-info',
    ]);
    assert.deepEqual(Object.keys(aggregate.eventsByResponseId), [
        'response-active',
        'response-export',
        'response-personalization',
        'response-snapshot',
    ]);
    assert.deepEqual(aggregate.eventsByResponseId['response-export'].map((diagnostic) => diagnostic.id), [
        '03-export-critical',
        '05-validation-error',
    ]);
});

test('Sprint 13 Phase C projects most frequent diagnostic codes deterministically', () => {
    const aggregate = buildRuntimeDiagnosticsAggregation(makeReadModel([
        ...fixtureEvents(),
        event({
            id: '09-alpha',
            domain: 'provider.telemetry',
            code: 'alpha_same_count',
            severity: 'warning',
        }),
        event({
            id: '10-beta',
            domain: 'provider.routing',
            code: 'beta_same_count',
            severity: 'warning',
        }),
    ]));

    assert.equal(aggregate.mostFrequentCodes[0].code, 'auth_expired');
    assert.equal(aggregate.mostFrequentCodes[0].count, 2);
    assert.deepEqual(aggregate.mostFrequentCodes[0].domains, ['provider.health', 'provider.fallback']);
    assert.equal(aggregate.mostFrequentCodes[1].code, 'alpha_same_count');
    assert.equal(aggregate.mostFrequentCodes[2].code, 'beta_same_count');
});

test('Sprint 13 Phase C aggregation is deterministic and metadata-only', () => {
    const readModel = makeReadModel(fixtureEvents());
    const first = buildRuntimeDiagnosticsAggregation(readModel);
    const second = buildRuntimeDiagnosticsAggregation(readModel);
    const serialized = JSON.stringify(first);

    assert.deepEqual(first, second);
    assert.doesNotMatch(serialized, /"(?:content|prompt|transcript|screenshot|payload)"\s*:/i);
    assert.doesNotMatch(serialized, /\/Users\/tarunshetty\/private/);
    assert.deepEqual(Object.keys(first.eventsBySeverity), [...RUNTIME_DIAGNOSTIC_AGGREGATION_SEVERITIES]);
    assert.deepEqual(Object.keys(first.eventsByDomain), [...RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS]);
});

test('Sprint 13 Phase C handles empty diagnostics input', () => {
    const aggregate = buildRuntimeDiagnosticsAggregation(makeReadModel([], null));

    assert.equal(aggregate.generatedAt, 50_000);
    assert.equal(aggregate.totalEvents, 0);
    assert.deepEqual(aggregate.activeEvents, []);
    assert.deepEqual(aggregate.recoverableEvents, []);
    assert.deepEqual(aggregate.userVisibleEvents, []);
    assert.deepEqual(aggregate.mostFrequentCodes, []);
    assert.deepEqual(aggregate.eventsByResponseId, {});
    assert.deepEqual(aggregate.eventsByProvider, {});
    RUNTIME_DIAGNOSTIC_AGGREGATION_SEVERITIES.forEach((severity) => {
        assert.equal(aggregate.severitySummaries[severity].totalEvents, 0);
        assert.deepEqual(aggregate.eventsBySeverity[severity], []);
    });
    RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS.forEach((domain) => {
        assert.equal(aggregate.domainSummaries[domain].totalEvents, 0);
        assert.deepEqual(aggregate.eventsByDomain[domain], []);
    });
});
