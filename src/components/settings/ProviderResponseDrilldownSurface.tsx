import React, { type ReactNode } from 'react';
import type { ResponseOwnership } from '../../lib/overlay/actionContextTypes';
import type {
    ProviderRoutingEntry,
    ProviderRoutingReadModel,
    ProviderRoutingStatus,
} from '../../lib/providers/providerRoutingReadModel';
import type {
    ProviderDiagnosticEntry,
    ProviderDiagnosticsReadModel,
} from '../../lib/providers/providerDiagnosticsReadModel';
import type {
    ProviderTelemetryEntry,
    ProviderTelemetryReadModel,
} from '../../lib/providers/providerTelemetryReadModel';

export interface ProviderResponseDrilldownSurfaceProps {
    ownershipByResponseId?: Record<string, Partial<ResponseOwnership> | undefined>;
    routingReadModel: ProviderRoutingReadModel;
    diagnosticsReadModel: ProviderDiagnosticsReadModel;
    telemetryReadModel: ProviderTelemetryReadModel;
}

type DrilldownRow = {
    responseId: string;
    ownership?: Partial<ResponseOwnership>;
    route?: ProviderRoutingEntry;
    telemetry?: ProviderTelemetryEntry;
    diagnostics: ProviderDiagnosticEntry[];
};

const ROUTE_STATUS_LABELS: Record<ProviderRoutingStatus, string> = {
    direct: 'Direct',
    remapped: 'Remapped',
    fallback: 'Fallback',
    local_fallback: 'Local Fallback',
    cache: 'Cache',
    unknown: 'Unknown',
};

function displayValue(value?: string | number | null): string {
    if (value === undefined || value === null) return '-';
    return String(value).trim() || '-';
}

function compactValue(value?: string | number | null, maxLength: number = 34): string {
    const normalized = displayValue(value);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maxLength - 1))}...`;
}

function formatLatency(value?: number): string {
    if (value === undefined) return '-';
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
    return `${value}ms`;
}

function booleanLabel(value: boolean): string {
    return value ? 'Yes' : 'No';
}

function validationLabel(value?: boolean): string {
    if (value === true) return 'Passed';
    if (value === false) return 'Failed';
    return 'Unknown';
}

function routeStatusClassName(status?: ProviderRoutingStatus): string {
    if (status === 'fallback' || status === 'local_fallback') {
        return 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200';
    }

    if (status === 'remapped') {
        return 'border-sky-400/30 bg-sky-500/[0.07] text-sky-200';
    }

    if (status === 'cache') {
        return 'border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-200';
    }

    if (status === 'direct') {
        return 'border-border-subtle bg-bg-item-surface text-text-primary';
    }

    return 'border-border-subtle bg-bg-item-surface text-text-secondary';
}

function diagnosticClassName(diagnostic: ProviderDiagnosticEntry): string {
    if (diagnostic.severity === 'error') {
        return 'border-red-400/30 bg-red-500/[0.08] text-red-200';
    }

    if (diagnostic.severity === 'warning') {
        return 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200';
    }

    return 'border-sky-400/25 bg-sky-500/[0.06] text-sky-200';
}

function collectRows(args: ProviderResponseDrilldownSurfaceProps): DrilldownRow[] {
    const responseIds = new Set<string>();

    for (const route of args.routingReadModel.routes) responseIds.add(route.responseId);
    for (const entry of args.telemetryReadModel.entries) responseIds.add(entry.responseId);
    for (const responseId of Object.keys(args.diagnosticsReadModel.byResponseId)) responseIds.add(responseId);
    for (const responseId of Object.keys(args.ownershipByResponseId ?? {})) responseIds.add(responseId);

    return Array.from(responseIds)
        .map((responseId) => ({
            responseId,
            ownership: args.ownershipByResponseId?.[responseId],
            route: args.routingReadModel.byResponseId[responseId],
            telemetry: args.telemetryReadModel.byResponseId[responseId],
            diagnostics: args.diagnosticsReadModel.byResponseId[responseId] ?? [],
        }))
        .sort((a, b) => {
            const aCreatedAt = a.route?.createdAt ?? a.telemetry?.createdAt ?? a.ownership?.createdAt ?? 0;
            const bCreatedAt = b.route?.createdAt ?? b.telemetry?.createdAt ?? b.ownership?.createdAt ?? 0;
            return bCreatedAt - aCreatedAt || a.responseId.localeCompare(b.responseId);
        });
}

function requestedProvider(row: DrilldownRow): string | undefined {
    return row.route?.requestedProvider
        ?? row.ownership?.requestedProvider
        ?? row.ownership?.sourceProvider
        ?? row.telemetry?.requestedProvider;
}

function requestedModel(row: DrilldownRow): string | undefined {
    return row.route?.requestedModel
        ?? row.ownership?.requestedModel
        ?? row.ownership?.sourceModel
        ?? row.telemetry?.requestedModel;
}

function actualProvider(row: DrilldownRow): string | undefined {
    return row.route?.actualProvider
        ?? row.ownership?.actualProvider
        ?? row.telemetry?.actualProvider
        ?? requestedProvider(row);
}

function actualModel(row: DrilldownRow): string | undefined {
    return row.route?.actualModel
        ?? row.ownership?.actualModel
        ?? row.telemetry?.actualModel
        ?? requestedModel(row);
}

function routingReason(row: DrilldownRow): string | undefined {
    return row.route?.routingReason ?? row.ownership?.routingReason;
}

function fallbackUsed(row: DrilldownRow): boolean {
    return Boolean(row.route?.fallbackUsed || row.telemetry?.fallbackUsed);
}

function tokenText(entry?: ProviderTelemetryEntry): string {
    if (!entry) return '-';
    const parts = [
        entry.promptTokens !== undefined ? `Prompt ${entry.promptTokens}` : '',
        entry.completionTokens !== undefined ? `Completion ${entry.completionTokens}` : '',
        entry.inputTokens !== undefined ? `Input ${entry.inputTokens}` : '',
        entry.outputTokens !== undefined ? `Output ${entry.outputTokens}` : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' | ') : '-';
}

function FieldValue({
    label,
    title,
    children,
    className = '',
}: {
    label: string;
    title?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className="min-w-0">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary md:hidden">
                {label}
            </div>
            <div className={className} title={title}>
                {children}
            </div>
        </div>
    );
}

function DiagnosticsCell({ diagnostics }: { diagnostics: ProviderDiagnosticEntry[] }) {
    if (diagnostics.length === 0) {
        return <span className="text-text-secondary">None</span>;
    }

    return (
        <div className="flex min-w-0 flex-wrap gap-1.5">
            {diagnostics.map((diagnostic) => (
                <span
                    key={diagnostic.id}
                    className={`max-w-full truncate rounded-md border px-2 py-1 text-[10px] font-semibold ${diagnosticClassName(diagnostic)}`}
                    title={`${diagnostic.title}: ${diagnostic.message}`}
                    data-drilldown-diagnostic={diagnostic.category}
                >
                    {diagnostic.title}
                </span>
            ))}
        </div>
    );
}

function DrilldownRowView({ row }: { row: DrilldownRow }) {
    const routeStatus = row.route?.status ?? 'unknown';
    const fallback = fallbackUsed(row);
    const validation = validationLabel(row.telemetry?.validationPassed);

    return (
        <div
            role="row"
            data-drilldown-response-id={row.responseId}
            data-drilldown-route-status={routeStatus}
            data-drilldown-fallback-used={fallback}
            data-drilldown-validation={validation}
            className="grid min-w-[1180px] grid-cols-1 gap-3 border-l-2 border-border-subtle bg-bg-item-surface px-4 py-3 text-xs md:grid-cols-[1fr_1.25fr_1fr_1.25fr_1.4fr_0.85fr_0.8fr_1.4fr_0.75fr_1.25fr_0.95fr] md:items-center"
        >
            <FieldValue label="Requested Provider" className="truncate font-medium text-text-primary" title={displayValue(requestedProvider(row))}>
                {compactValue(requestedProvider(row))}
            </FieldValue>
            <FieldValue label="Requested Model" className="truncate text-text-secondary" title={displayValue(requestedModel(row))}>
                {compactValue(requestedModel(row))}
            </FieldValue>
            <FieldValue label="Actual Provider" className="truncate font-medium text-text-primary" title={displayValue(actualProvider(row))}>
                {compactValue(actualProvider(row))}
            </FieldValue>
            <FieldValue label="Actual Model" className="truncate text-text-secondary" title={displayValue(actualModel(row))}>
                {compactValue(actualModel(row))}
            </FieldValue>
            <FieldValue label="Routing Reason" className="truncate text-text-secondary" title={displayValue(routingReason(row))}>
                {compactValue(routingReason(row))}
            </FieldValue>
            <FieldValue label="Route Status">
                <span className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold ${routeStatusClassName(routeStatus)}`}>
                    {ROUTE_STATUS_LABELS[routeStatus]}
                </span>
            </FieldValue>
            <FieldValue label="Fallback Used" className={fallback ? 'font-medium text-amber-200' : 'text-text-secondary'}>
                {booleanLabel(fallback)}
            </FieldValue>
            <FieldValue label="Diagnostics">
                <DiagnosticsCell diagnostics={row.diagnostics} />
            </FieldValue>
            <FieldValue label="Latency" className="text-text-secondary">
                {formatLatency(row.telemetry?.latencyMs)}
            </FieldValue>
            <FieldValue label="Tokens" className="truncate text-text-secondary" title={tokenText(row.telemetry)}>
                {compactValue(tokenText(row.telemetry), 42)}
            </FieldValue>
            <FieldValue label="Validation Outcome" className={row.telemetry?.validationPassed === false ? 'font-medium text-red-200' : 'text-text-secondary'}>
                {validation}
            </FieldValue>
        </div>
    );
}

export function ProviderResponseDrilldownSurface(props: ProviderResponseDrilldownSurfaceProps) {
    const rows = collectRows(props);

    return (
        <section aria-label="Response-level provider drilldown" className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Response Provider Drilldown</h3>
                </div>
                <div
                    role="list"
                    aria-label="Response provider drilldown summary"
                    className="flex flex-wrap gap-1.5 text-[10px]"
                >
                    <span role="listitem" className="rounded-md border border-border-subtle bg-bg-item-surface px-2 py-1 font-semibold text-text-secondary">
                        Responses {rows.length}
                    </span>
                    <span role="listitem" className="rounded-md border border-border-subtle bg-bg-item-surface px-2 py-1 font-semibold text-text-secondary">
                        Diagnostics {props.diagnosticsReadModel.diagnostics.filter((diagnostic) => diagnostic.responseId).length}
                    </span>
                    <span role="listitem" className="rounded-md border border-border-subtle bg-bg-item-surface px-2 py-1 font-semibold text-text-secondary">
                        Telemetry {props.telemetryReadModel.entries.length}
                    </span>
                </div>
            </div>

            <div
                role="table"
                aria-label="Response-level provider drilldown table"
                className="overflow-x-auto rounded-xl border border-border-subtle bg-bg-input/35"
            >
                <div
                    role="row"
                    className="hidden min-w-[1180px] grid-cols-[1fr_1.25fr_1fr_1.25fr_1.4fr_0.85fr_0.8fr_1.4fr_0.75fr_1.25fr_0.95fr] gap-3 border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary md:grid"
                >
                    {[
                        'Requested Provider',
                        'Requested Model',
                        'Actual Provider',
                        'Actual Model',
                        'Routing Reason',
                        'Route Status',
                        'Fallback Used',
                        'Diagnostics',
                        'Latency',
                        'Tokens',
                        'Validation Outcome',
                    ].map((label) => (
                        <div key={label} role="columnheader">
                            {label}
                        </div>
                    ))}
                </div>

                <div role="rowgroup" className="divide-y divide-border-subtle">
                    {rows.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-text-secondary" role="row">
                            No response provider drilldown
                        </div>
                    ) : (
                        rows.map((row) => (
                            <DrilldownRowView key={row.responseId} row={row} />
                        ))
                    )}
                </div>
            </div>
        </section>
    );
}
