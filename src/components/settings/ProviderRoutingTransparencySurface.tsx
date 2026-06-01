import React, { type ReactNode } from 'react';
import type {
    ProviderRoutingEntry,
    ProviderRoutingReadModel,
    ProviderRoutingStatus,
} from '../../lib/providers/providerRoutingReadModel';

export interface ProviderRoutingTransparencySurfaceProps {
    readModel: ProviderRoutingReadModel;
}

const FIELD_LABELS = [
    'Requested Provider',
    'Requested Model',
    'Actual Provider',
    'Actual Model',
    'Routing Reason',
    'Route Changed',
    'Fallback Used',
    'Status',
];

const STATUS_ORDER: ProviderRoutingStatus[] = [
    'direct',
    'remapped',
    'fallback',
    'local_fallback',
    'cache',
    'unknown',
];

const STATUS_LABELS: Record<ProviderRoutingStatus, string> = {
    direct: 'Direct',
    remapped: 'Remapped',
    fallback: 'Fallback',
    local_fallback: 'Local Fallback',
    cache: 'Cache',
    unknown: 'Unknown',
};

function statusClassName(status: ProviderRoutingStatus): string {
    if (status === 'fallback') {
        return 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200';
    }

    if (status === 'local_fallback') {
        return 'border-red-400/30 bg-red-500/[0.08] text-red-200';
    }

    if (status === 'remapped') {
        return 'border-sky-400/30 bg-sky-500/[0.07] text-sky-200';
    }

    if (status === 'cache') {
        return 'border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-200';
    }

    if (status === 'unknown') {
        return 'border-border-subtle bg-bg-item-surface text-text-secondary';
    }

    return 'border-border-subtle bg-bg-item-surface text-text-primary';
}

function rowClassName(status: ProviderRoutingStatus): string {
    if (status === 'fallback') {
        return 'border-amber-400/25 bg-amber-500/[0.045]';
    }

    if (status === 'local_fallback') {
        return 'border-red-400/25 bg-red-500/[0.045]';
    }

    if (status === 'remapped') {
        return 'border-sky-400/20 bg-sky-500/[0.035]';
    }

    if (status === 'cache') {
        return 'border-emerald-400/20 bg-emerald-500/[0.035]';
    }

    return 'border-border-subtle bg-bg-item-surface';
}

function statusCounts(readModel: ProviderRoutingReadModel): Record<ProviderRoutingStatus, number> {
    const counts = Object.fromEntries(
        STATUS_ORDER.map((status) => [status, 0]),
    ) as Record<ProviderRoutingStatus, number>;

    for (const route of readModel.routes) {
        counts[route.status] += 1;
    }

    return counts;
}

function displayValue(value?: string): string {
    return value?.trim() || '-';
}

function booleanLabel(value: boolean): string {
    return value ? 'Yes' : 'No';
}

function compactValue(value?: string, maxLength: number = 34): string {
    const normalized = displayValue(value);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maxLength - 1))}...`;
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

function ProviderRoutingRow({ route }: { route: ProviderRoutingEntry }) {
    return (
        <div
            role="row"
            data-routing-status={route.status}
            data-route-changed={route.routeChanged}
            data-fallback-used={route.fallbackUsed}
            className={`grid min-w-[920px] grid-cols-1 gap-3 border-l-2 px-4 py-3 text-xs md:grid-cols-[1fr_1.35fr_1fr_1.35fr_1.45fr_0.85fr_0.85fr_0.9fr] md:items-center ${rowClassName(route.status)}`}
        >
            <FieldValue label="Requested Provider" className="truncate font-medium text-text-primary" title={displayValue(route.requestedProvider)}>
                {displayValue(route.requestedProvider)}
            </FieldValue>
            <FieldValue label="Requested Model" className="truncate text-text-secondary" title={displayValue(route.requestedModel)}>
                {compactValue(route.requestedModel)}
            </FieldValue>
            <FieldValue label="Actual Provider" className="truncate font-medium text-text-primary" title={displayValue(route.actualProvider)}>
                {displayValue(route.actualProvider)}
            </FieldValue>
            <FieldValue label="Actual Model" className="truncate text-text-secondary" title={displayValue(route.actualModel)}>
                {compactValue(route.actualModel)}
            </FieldValue>
            <FieldValue label="Routing Reason" className="truncate text-text-secondary" title={displayValue(route.routingReason)}>
                {compactValue(route.routingReason)}
            </FieldValue>
            <FieldValue label="Route Changed" className={route.routeChanged ? 'font-medium text-sky-200' : 'text-text-secondary'}>
                {booleanLabel(route.routeChanged)}
            </FieldValue>
            <FieldValue label="Fallback Used" className={route.fallbackUsed ? 'font-medium text-amber-200' : 'text-text-secondary'}>
                {booleanLabel(route.fallbackUsed)}
            </FieldValue>
            <FieldValue label="Status">
                <span className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold ${statusClassName(route.status)}`}>
                    {STATUS_LABELS[route.status]}
                </span>
            </FieldValue>
        </div>
    );
}

export function ProviderRoutingTransparencySurface({ readModel }: ProviderRoutingTransparencySurfaceProps) {
    const counts = statusCounts(readModel);

    return (
        <section aria-label="Provider routing transparency" className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-bold text-text-primary mb-1">Provider Routing</h3>
                </div>

                <div
                    role="list"
                    aria-label="Provider routing summary"
                    className="flex flex-wrap gap-1.5 text-[10px]"
                >
                    <span className="rounded-md border border-border-subtle bg-bg-item-surface px-2 py-1 font-semibold text-text-secondary">
                        Total {readModel.summary.totalRoutes}
                    </span>
                    <span className="rounded-md border border-border-subtle bg-bg-item-surface px-2 py-1 font-semibold text-text-secondary">
                        Changed {readModel.summary.routeChangedCount}
                    </span>
                    {STATUS_ORDER.map((status) => (
                        <span
                            key={status}
                            role="listitem"
                            data-routing-summary-status={status}
                            className={`rounded-md border px-2 py-1 font-semibold ${statusClassName(status)}`}
                        >
                            {STATUS_LABELS[status]} {counts[status]}
                        </span>
                    ))}
                </div>
            </div>

            <div
                role="table"
                aria-label="Provider routing transparency table"
                className="overflow-x-auto rounded-xl border border-border-subtle bg-bg-input/35"
            >
                <div
                    role="row"
                    className="hidden min-w-[920px] grid-cols-[1fr_1.35fr_1fr_1.35fr_1.45fr_0.85fr_0.85fr_0.9fr] gap-3 border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary md:grid"
                >
                    {FIELD_LABELS.map((label) => (
                        <div key={label} role="columnheader">
                            {label}
                        </div>
                    ))}
                </div>

                <div role="rowgroup" className="divide-y divide-border-subtle">
                    {readModel.routes.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-text-secondary" role="row">
                            No provider routes
                        </div>
                    ) : (
                        readModel.routes.map((route) => (
                            <ProviderRoutingRow key={route.responseId} route={route} />
                        ))
                    )}
                </div>
            </div>
        </section>
    );
}
