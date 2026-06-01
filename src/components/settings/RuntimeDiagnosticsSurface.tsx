import React, { useMemo, type ReactNode } from 'react';
import {
    buildRuntimeDiagnosticsAggregation,
    RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS,
    RUNTIME_DIAGNOSTIC_AGGREGATION_SEVERITIES,
    type RuntimeDiagnosticAggregationDomain,
} from '../../lib/diagnostics/runtimeDiagnosticsAggregation';
import type {
    RuntimeDiagnosticEvent,
    RuntimeDiagnosticSeverity,
    RuntimeDiagnosticsReadModel,
} from '../../lib/diagnostics/runtimeDiagnosticsReadModel';

export interface RuntimeDiagnosticsSurfaceProps {
    readModel: RuntimeDiagnosticsReadModel;
}

type MetricTone = 'normal' | 'warning' | 'critical';

function formatTimestamp(value: number): string {
    if (!Number.isFinite(value)) return '-';
    return new Date(value).toISOString();
}

function metricTone(value: number, tone: MetricTone = 'normal'): MetricTone {
    if (value === 0) return 'normal';
    return tone;
}

function metricClassName(tone: MetricTone): string {
    if (tone === 'critical') {
        return 'border-red-400/30 bg-red-500/[0.08] text-red-200';
    }
    if (tone === 'warning') {
        return 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200';
    }
    return 'border-border-subtle bg-bg-item-surface text-text-secondary';
}

function severityClassName(severity: RuntimeDiagnosticSeverity): string {
    if (severity === 'critical') {
        return 'border-red-400/40 bg-red-500/[0.12] text-red-100';
    }
    if (severity === 'error') {
        return 'border-red-400/30 bg-red-500/[0.08] text-red-200';
    }
    if (severity === 'warning') {
        return 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200';
    }
    return 'border-sky-400/25 bg-sky-500/[0.06] text-sky-200';
}

function severityTone(severity: RuntimeDiagnosticSeverity): MetricTone {
    if (severity === 'critical' || severity === 'error') return 'critical';
    if (severity === 'warning') return 'warning';
    return 'normal';
}

function Metric({
    label,
    value,
    tone = 'normal',
}: {
    label: string;
    value: number;
    tone?: MetricTone;
}) {
    return (
        <div role="listitem" className={`rounded-lg border px-3 py-2 ${metricClassName(metricTone(value, tone))}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                {label}
            </div>
            <div className="mt-1 text-lg font-bold leading-none">
                {value}
            </div>
        </div>
    );
}

function SummaryGrid({ children, label }: { children: ReactNode; label: string }) {
    return (
        <div role="list" aria-label={label} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {children}
        </div>
    );
}

function BreakdownRow({
    label,
    count,
    tone = 'normal',
    dataKey,
}: {
    label: string;
    count: number;
    tone?: MetricTone;
    dataKey: string;
}) {
    return (
        <div
            className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2.5 text-xs"
            data-runtime-diagnostics-row={dataKey}
        >
            <span className="min-w-0 truncate text-text-secondary" title={label}>
                {label}
            </span>
            <strong className={count > 0 && tone !== 'normal' ? (tone === 'critical' ? 'text-red-200' : 'text-amber-200') : 'text-text-primary'}>
                {count}
            </strong>
        </div>
    );
}

function BreakdownPanel({
    title,
    children,
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-input/35">
            <div className="border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                {title}
            </div>
            <div className="divide-y divide-border-subtle">
                {children}
            </div>
        </div>
    );
}

function EventList({
    title,
    emptyLabel,
    events,
    dataKey,
}: {
    title: string;
    emptyLabel: string;
    events: RuntimeDiagnosticEvent[];
    dataKey: string;
}) {
    return (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-input/35" data-runtime-diagnostics-list={dataKey}>
            <div className="border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                {title}
            </div>
            {events.length === 0 ? (
                <div className="px-4 py-3 text-xs text-text-secondary">
                    {emptyLabel}
                </div>
            ) : (
                <div className="divide-y divide-border-subtle">
                    {events.map((event) => (
                        <article
                            key={event.id}
                            className="px-4 py-3 text-xs"
                            data-runtime-diagnostic-event={event.id}
                            data-runtime-diagnostic-domain={event.domain}
                            data-runtime-diagnostic-severity={event.severity}
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${severityClassName(event.severity)}`}>
                                    {event.severity}
                                </span>
                                <span className="font-semibold text-text-primary">
                                    {event.code}
                                </span>
                                <span className="text-text-tertiary">
                                    {event.domain}
                                </span>
                            </div>
                            <p className="mt-2 text-text-secondary">
                                {event.message}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
                                <span>{event.source}</span>
                                <time dateTime={formatTimestamp(event.timestamp)}>
                                    {formatTimestamp(event.timestamp)}
                                </time>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}

function recentEvents(events: RuntimeDiagnosticEvent[]): RuntimeDiagnosticEvent[] {
    return [...events].sort((left, right) => {
        if (left.timestamp !== right.timestamp) return right.timestamp - left.timestamp;
        return left.id.localeCompare(right.id);
    });
}

export function RuntimeDiagnosticsSurface({ readModel }: RuntimeDiagnosticsSurfaceProps) {
    const aggregation = useMemo(
        () => buildRuntimeDiagnosticsAggregation(readModel),
        [readModel],
    );
    const orderedRecentEvents = useMemo(
        () => recentEvents(readModel.events),
        [readModel.events],
    );

    return (
        <section aria-label="Runtime diagnostics" className="space-y-4">
            <div>
                <h3 className="text-sm font-bold text-text-primary mb-1">Runtime Diagnostics</h3>
                <p className="text-xs text-text-secondary">
                    Unified diagnostic summaries for the current retained session.
                </p>
            </div>

            <SummaryGrid label="Runtime diagnostics summary">
                <Metric label="Total Events" value={aggregation.totalEvents} />
                <Metric label="Active Events" value={aggregation.activeEvents.length} tone="warning" />
                <Metric label="Recoverable Events" value={aggregation.recoverableEvents.length} />
                <Metric label="User Visible Events" value={aggregation.userVisibleEvents.length} />
            </SummaryGrid>

            <div className="grid gap-3 lg:grid-cols-2">
                <BreakdownPanel title="Severity Breakdown">
                    {RUNTIME_DIAGNOSTIC_AGGREGATION_SEVERITIES.map((severity) => (
                        <BreakdownRow
                            key={severity}
                            label={severity}
                            count={aggregation.severitySummaries[severity].totalEvents}
                            tone={severityTone(severity)}
                            dataKey={`severity:${severity}`}
                        />
                    ))}
                </BreakdownPanel>

                <BreakdownPanel title="Domain Breakdown">
                    {RUNTIME_DIAGNOSTIC_AGGREGATION_DOMAINS.map((domain: RuntimeDiagnosticAggregationDomain) => (
                        <BreakdownRow
                            key={domain}
                            label={domain}
                            count={aggregation.domainSummaries[domain].totalEvents}
                            tone={aggregation.domainSummaries[domain].severityCounts.critical > 0 || aggregation.domainSummaries[domain].severityCounts.error > 0 ? 'critical' : aggregation.domainSummaries[domain].severityCounts.warning > 0 ? 'warning' : 'normal'}
                            dataKey={`domain:${domain}`}
                        />
                    ))}
                </BreakdownPanel>
            </div>

            <div className="grid gap-3 xl:grid-cols-3">
                <EventList
                    title="Active Diagnostics"
                    emptyLabel="No active diagnostics"
                    events={aggregation.activeEvents}
                    dataKey="active"
                />
                <EventList
                    title="Recent Diagnostics"
                    emptyLabel="No recent diagnostics"
                    events={orderedRecentEvents}
                    dataKey="recent"
                />
                <EventList
                    title="Recoverable Diagnostics"
                    emptyLabel="No recoverable diagnostics"
                    events={aggregation.recoverableEvents}
                    dataKey="recoverable"
                />
            </div>
        </section>
    );
}
