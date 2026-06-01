import type {
    RuntimeDiagnosticEvent,
    RuntimeDiagnosticSeverity,
    RuntimeDiagnosticsReadModel,
} from './runtimeDiagnosticsReadModel';

export const RUNTIME_DIAGNOSTIC_AGGREGATION_SEVERITIES = [
    'info',
    'warning',
    'error',
    'critical',
] as const satisfies readonly RuntimeDiagnosticSeverity[];

export const RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS = [
    'provider.health',
    'provider.routing',
    'provider.fallback',
    'provider.telemetry',
    'validation.contract',
    'validation.repair',
    'diagram.parse',
    'diagram.guardrail',
    'export.guardrail',
    'export.delivery',
    'snapshot.guardrail',
    'ipc.boundary',
    'runtime.electron',
    'preload.bridge',
    'ownership.lineage',
    'personalization.resolution',
    'history.selection',
] as const;

export type RuntimeDiagnosticAggregationDomain = (typeof RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS)[number];

export interface RuntimeDiagnosticSeveritySummary {
    severity: RuntimeDiagnosticSeverity;
    totalEvents: number;
    activeEvents: number;
    recoverableEvents: number;
    userVisibleEvents: number;
}

export interface RuntimeDiagnosticDomainSummary {
    domain: RuntimeDiagnosticAggregationDomain;
    totalEvents: number;
    activeEvents: number;
    recoverableEvents: number;
    userVisibleEvents: number;
    severityCounts: Record<RuntimeDiagnosticSeverity, number>;
}

export interface RuntimeDiagnosticCodeFrequency {
    code: string;
    count: number;
    domains: RuntimeDiagnosticAggregationDomain[];
    severityCounts: Record<RuntimeDiagnosticSeverity, number>;
}

export interface RuntimeDiagnosticsAggregationReadModel {
    generatedAt: number;
    totalEvents: number;
    activeEvents: RuntimeDiagnosticEvent[];
    recoverableEvents: RuntimeDiagnosticEvent[];
    userVisibleEvents: RuntimeDiagnosticEvent[];
    severitySummaries: Record<RuntimeDiagnosticSeverity, RuntimeDiagnosticSeveritySummary>;
    domainSummaries: Record<RuntimeDiagnosticAggregationDomain, RuntimeDiagnosticDomainSummary>;
    mostFrequentCodes: RuntimeDiagnosticCodeFrequency[];
    eventsByResponseId: Record<string, RuntimeDiagnosticEvent[]>;
    eventsByProvider: Record<string, RuntimeDiagnosticEvent[]>;
    eventsBySeverity: Record<RuntimeDiagnosticSeverity, RuntimeDiagnosticEvent[]>;
    eventsByDomain: Record<RuntimeDiagnosticAggregationDomain, RuntimeDiagnosticEvent[]>;
}

function emptySeverityCounts(): Record<RuntimeDiagnosticSeverity, number> {
    return {
        info: 0,
        warning: 0,
        error: 0,
        critical: 0,
    };
}

function createSeveritySummaries(): Record<RuntimeDiagnosticSeverity, RuntimeDiagnosticSeveritySummary> {
    return {
        info: { severity: 'info', totalEvents: 0, activeEvents: 0, recoverableEvents: 0, userVisibleEvents: 0 },
        warning: { severity: 'warning', totalEvents: 0, activeEvents: 0, recoverableEvents: 0, userVisibleEvents: 0 },
        error: { severity: 'error', totalEvents: 0, activeEvents: 0, recoverableEvents: 0, userVisibleEvents: 0 },
        critical: { severity: 'critical', totalEvents: 0, activeEvents: 0, recoverableEvents: 0, userVisibleEvents: 0 },
    };
}

function createDomainSummaries(): Record<RuntimeDiagnosticAggregationDomain, RuntimeDiagnosticDomainSummary> {
    return Object.fromEntries(
        RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS.map((domain): [RuntimeDiagnosticAggregationDomain, RuntimeDiagnosticDomainSummary] => [
            domain,
            {
                domain,
                totalEvents: 0,
                activeEvents: 0,
                recoverableEvents: 0,
                userVisibleEvents: 0,
                severityCounts: emptySeverityCounts(),
            },
        ]),
    ) as Record<RuntimeDiagnosticAggregationDomain, RuntimeDiagnosticDomainSummary>;
}

function createEventsBySeverity(): Record<RuntimeDiagnosticSeverity, RuntimeDiagnosticEvent[]> {
    return {
        info: [],
        warning: [],
        error: [],
        critical: [],
    };
}

function createEventsByDomain(): Record<RuntimeDiagnosticAggregationDomain, RuntimeDiagnosticEvent[]> {
    return Object.fromEntries(
        RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS.map((domain): [RuntimeDiagnosticAggregationDomain, RuntimeDiagnosticEvent[]] => [domain, []]),
    ) as Record<RuntimeDiagnosticAggregationDomain, RuntimeDiagnosticEvent[]>;
}

function isAggregationDomain(domain: string): domain is RuntimeDiagnosticAggregationDomain {
    return (RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS as readonly string[]).includes(domain);
}

function domainSortIndex(domain: RuntimeDiagnosticAggregationDomain): number {
    return RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS.indexOf(domain);
}

function appendGroup(
    groups: Map<string, RuntimeDiagnosticEvent[]>,
    key: string | undefined,
    event: RuntimeDiagnosticEvent,
): void {
    if (!key) return;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
}

function sortedRecordFromMap(map: Map<string, RuntimeDiagnosticEvent[]>): Record<string, RuntimeDiagnosticEvent[]> {
    return Object.fromEntries(
        [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ) as Record<string, RuntimeDiagnosticEvent[]>;
}

function buildMostFrequentCodes(events: RuntimeDiagnosticEvent[]): RuntimeDiagnosticCodeFrequency[] {
    const frequencies = new Map<string, RuntimeDiagnosticCodeFrequency>();

    events.forEach((event) => {
        const domain = isAggregationDomain(event.domain) ? event.domain : undefined;
        const current = frequencies.get(event.code) ?? {
            code: event.code,
            count: 0,
            domains: [],
            severityCounts: emptySeverityCounts(),
        };
        current.count += 1;
        current.severityCounts[event.severity] += 1;
        if (domain && !current.domains.includes(domain)) {
            current.domains.push(domain);
            current.domains.sort((left, right) => domainSortIndex(left) - domainSortIndex(right));
        }
        frequencies.set(event.code, current);
    });

    return [...frequencies.values()].sort((left, right) => {
        if (left.count !== right.count) return right.count - left.count;
        return left.code.localeCompare(right.code);
    });
}

function updateSeveritySummary(
    summary: RuntimeDiagnosticSeveritySummary,
    event: RuntimeDiagnosticEvent,
    activeIds: Set<string>,
): void {
    summary.totalEvents += 1;
    if (activeIds.has(event.id)) summary.activeEvents += 1;
    if (event.recoverable) summary.recoverableEvents += 1;
    if (event.userVisible) summary.userVisibleEvents += 1;
}

function updateDomainSummary(
    summary: RuntimeDiagnosticDomainSummary,
    event: RuntimeDiagnosticEvent,
    activeIds: Set<string>,
): void {
    summary.totalEvents += 1;
    if (activeIds.has(event.id)) summary.activeEvents += 1;
    if (event.recoverable) summary.recoverableEvents += 1;
    if (event.userVisible) summary.userVisibleEvents += 1;
    summary.severityCounts[event.severity] += 1;
}

export function buildRuntimeDiagnosticsAggregation(
    readModel: RuntimeDiagnosticsReadModel,
): RuntimeDiagnosticsAggregationReadModel {
    const events = readModel.events;
    const activeIds = new Set(readModel.activeEvents.map((event) => event.id));
    const severitySummaries = createSeveritySummaries();
    const domainSummaries = createDomainSummaries();
    const eventsBySeverity = createEventsBySeverity();
    const eventsByDomain = createEventsByDomain();
    const responseGroups = new Map<string, RuntimeDiagnosticEvent[]>();
    const providerGroups = new Map<string, RuntimeDiagnosticEvent[]>();

    events.forEach((event) => {
        updateSeveritySummary(severitySummaries[event.severity], event, activeIds);
        eventsBySeverity[event.severity].push(event);

        if (isAggregationDomain(event.domain)) {
            updateDomainSummary(domainSummaries[event.domain], event, activeIds);
            eventsByDomain[event.domain].push(event);
        }

        appendGroup(responseGroups, event.responseId, event);
        appendGroup(providerGroups, event.provider, event);
    });

    return {
        generatedAt: readModel.generatedAt,
        totalEvents: events.length,
        activeEvents: readModel.activeEvents,
        recoverableEvents: events.filter((event) => event.recoverable),
        userVisibleEvents: events.filter((event) => event.userVisible),
        severitySummaries,
        domainSummaries,
        mostFrequentCodes: buildMostFrequentCodes(events),
        eventsByResponseId: sortedRecordFromMap(responseGroups),
        eventsByProvider: sortedRecordFromMap(providerGroups),
        eventsBySeverity,
        eventsByDomain,
    };
}
