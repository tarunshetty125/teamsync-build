import React, { type ReactNode } from 'react';
import type {
    ProviderFallbackCategory,
    ProviderFallbackEntry,
    ProviderFallbackReadModel,
} from '../../lib/providers/providerFallbackReadModel';

export interface ProviderFallbackAnalyticsSurfaceProps {
    readModel: ProviderFallbackReadModel;
}

type CountRow = {
    key: string;
    label: string;
    count: number;
};

const CATEGORY_LABELS: Record<ProviderFallbackCategory, string> = {
    auth_expired: 'Auth Expired',
    auth_failed: 'Auth Failed',
    rate_limited: 'Rate Limited',
    timeout: 'Timeout',
    model_unavailable: 'Model Unavailable',
    provider_unavailable: 'Provider Unavailable',
    validation_failed: 'Validation Failed',
    safe_fallback: 'Safe Fallback',
    all_attempts_failed: 'All Attempts Failed',
    unknown: 'Unknown',
};

function countRows(record: Record<string, number>, labels?: Record<string, string>): CountRow[] {
    return Object.entries(record)
        .map(([key, count]) => ({
            key,
            label: labels?.[key] ?? formatReadableValue(key),
            count,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function providerRows(readModel: ProviderFallbackReadModel): CountRow[] {
    const providers = new Set([
        ...Object.keys(readModel.summary.byRequestedProvider),
        ...Object.keys(readModel.summary.byActualProvider),
    ]);

    return Array.from(providers)
        .map((provider) => ({
            key: provider,
            label: formatReadableValue(provider),
            count: (readModel.summary.byRequestedProvider[provider] ?? 0)
                + (readModel.summary.byActualProvider[provider] ?? 0),
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function formatReadableValue(value: string): string {
    return value
        .split(/[_\-\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || '-';
}

function displayValue(value?: string): string {
    return value?.trim() || '-';
}

function compactValue(value?: string, maxLength: number = 38): string {
    const normalized = displayValue(value);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maxLength - 1))}...`;
}

function FieldValue({
    label,
    title,
    children,
    className = '',
    cellRole = 'cell',
}: {
    label: string;
    title?: string;
    children: ReactNode;
    className?: string;
    cellRole?: 'cell' | 'rowheader';
}) {
    return (
        <div className="min-w-0" role={cellRole}>
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary md:hidden">
                {label}
            </div>
            <div className={className} title={title}>
                {children}
            </div>
        </div>
    );
}

function metricClassName(value: number, tone: 'normal' | 'warning' | 'critical' = 'normal'): string {
    if (value === 0) {
        return 'border-border-subtle bg-bg-item-surface text-text-secondary';
    }

    if (tone === 'critical') {
        return 'border-red-400/30 bg-red-500/[0.08] text-red-200';
    }

    if (tone === 'warning') {
        return 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200';
    }

    return 'border-sky-400/25 bg-sky-500/[0.06] text-sky-200';
}

function fallbackTone(fallback: ProviderFallbackEntry): 'normal' | 'warning' | 'critical' {
    if (fallback.safeFallback || fallback.category === 'all_attempts_failed') return 'critical';
    if (fallback.validationFallback || fallback.failedAttemptCount > 0) return 'warning';
    return 'normal';
}

function FallbackMetric({
    label,
    value,
    tone = 'normal',
}: {
    label: string;
    value: number;
    tone?: 'normal' | 'warning' | 'critical';
}) {
    return (
        <div role="listitem" className={`rounded-lg border px-3 py-2 ${metricClassName(value, tone)}`}>
            <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                {label}
            </div>
            <div className="mt-1 text-lg font-bold leading-none">
                {value}
            </div>
        </div>
    );
}

function CountTable({
    title,
    emptyLabel,
    rows,
}: {
    title: string;
    emptyLabel: string;
    rows: CountRow[];
}) {
    return (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-input/35">
            <div className="border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                {title}
            </div>
            {rows.length === 0 ? (
                <div className="px-4 py-3 text-xs text-text-secondary">
                    {emptyLabel}
                </div>
            ) : (
                <div className="divide-y divide-border-subtle">
                    {rows.map((row) => (
                        <div
                            key={row.key}
                            className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2.5 text-xs"
                            data-fallback-count-key={row.key}
                        >
                            <span className="min-w-0 truncate text-text-secondary" title={row.key}>
                                {row.label}
                            </span>
                            <strong className="text-text-primary">{row.count}</strong>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function ProviderSummaryTable({ readModel }: { readModel: ProviderFallbackReadModel }) {
    const rows = providerRows(readModel);

    return (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-input/35">
            <div className="grid grid-cols-[1fr_0.7fr_0.7fr] gap-3 border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                <div>Provider Summary</div>
                <div>Requested</div>
                <div>Actual</div>
            </div>
            {rows.length === 0 ? (
                <div className="px-4 py-3 text-xs text-text-secondary">
                    No provider fallback summary
                </div>
            ) : (
                <div className="divide-y divide-border-subtle">
                    {rows.map((row) => (
                        <div
                            key={row.key}
                            className="grid grid-cols-[1fr_0.7fr_0.7fr] gap-3 px-4 py-2.5 text-xs"
                            data-fallback-provider={row.key}
                        >
                            <span className="min-w-0 truncate text-text-secondary" title={row.key}>
                                {row.label}
                            </span>
                            <strong className="text-text-primary">{readModel.summary.byRequestedProvider[row.key] ?? 0}</strong>
                            <strong className="text-text-primary">{readModel.summary.byActualProvider[row.key] ?? 0}</strong>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function FallbackEntryTable({ readModel }: { readModel: ProviderFallbackReadModel }) {
    return (
        <div
            role="table"
            aria-label="Provider fallback rows"
            className="overflow-x-auto rounded-xl border border-border-subtle bg-bg-input/35"
        >
            <div
                role="row"
                className="hidden min-w-[860px] grid-cols-[1.05fr_1fr_1fr_1.45fr_1fr_0.8fr] gap-3 border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary md:grid"
            >
                <div role="columnheader">Response</div>
                <div role="columnheader">Requested</div>
                <div role="columnheader">Actual</div>
                <div role="columnheader">Fallback Reason</div>
                <div role="columnheader">Failure Category</div>
                <div role="columnheader">Attempts</div>
            </div>

            <div role="rowgroup" className="divide-y divide-border-subtle">
                {readModel.fallbacks.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-text-secondary" role="row">
                        <div role="cell">No provider fallbacks</div>
                    </div>
                ) : (
                    readModel.fallbacks.map((fallback) => (
                        <div
                            key={fallback.responseId}
                            role="row"
                            data-fallback-category={fallback.category}
                            data-safe-fallback={fallback.safeFallback}
                            data-validation-fallback={fallback.validationFallback}
                            className={`grid min-w-[860px] grid-cols-1 gap-3 border-l-2 px-4 py-3 text-xs md:grid-cols-[1.05fr_1fr_1fr_1.45fr_1fr_0.8fr] md:items-center ${metricClassName(1, fallbackTone(fallback))}`}
                        >
                            <FieldValue label="Response" className="truncate font-medium text-text-primary" title={fallback.responseId} cellRole="rowheader">
                                {compactValue(fallback.responseId, 24)}
                            </FieldValue>
                            <FieldValue label="Requested" className="truncate text-text-secondary" title={[fallback.requestedProvider, fallback.requestedModel].filter(Boolean).join(' / ')}>
                                {compactValue(fallback.requestedProvider)}
                            </FieldValue>
                            <FieldValue label="Actual" className="truncate text-text-secondary" title={[fallback.actualProvider, fallback.actualModel].filter(Boolean).join(' / ')}>
                                {compactValue(fallback.actualProvider)}
                            </FieldValue>
                            <FieldValue label="Fallback Reason" className="truncate text-text-secondary" title={displayValue(fallback.fallbackReason)}>
                                {compactValue(fallback.fallbackReason)}
                            </FieldValue>
                            <FieldValue label="Failure Category" className="truncate font-medium text-text-primary" title={fallback.category}>
                                {CATEGORY_LABELS[fallback.category]}
                            </FieldValue>
                            <FieldValue label="Attempts" className="text-text-secondary">
                                {fallback.failedAttemptCount} failed
                            </FieldValue>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export function ProviderFallbackAnalyticsSurface({ readModel }: ProviderFallbackAnalyticsSurfaceProps) {
    return (
        <section aria-label="Provider fallback analytics" className="space-y-3">
            <div>
                <h3 className="text-sm font-bold text-text-primary mb-1">Provider Fallbacks</h3>
            </div>

            <div
                role="list"
                aria-label="Provider fallback summary"
                className="grid grid-cols-2 gap-2 md:grid-cols-4"
            >
                <FallbackMetric label="Total Fallbacks" value={readModel.summary.totalFallbacks} />
                <FallbackMetric label="Provider Fallbacks" value={readModel.summary.providerFallbackCount} tone="warning" />
                <FallbackMetric label="Safe Fallbacks" value={readModel.summary.safeFallbackCount} tone="critical" />
                <FallbackMetric label="Validation Fallbacks" value={readModel.summary.validationFallbackCount} tone="warning" />
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                <CountTable
                    title="Failure Categories"
                    emptyLabel="No failure categories"
                    rows={countRows(readModel.summary.byCategory, CATEGORY_LABELS)}
                />
                <CountTable
                    title="Fallback Reasons"
                    emptyLabel="No fallback reasons"
                    rows={countRows(readModel.summary.byReason)}
                />
                <ProviderSummaryTable readModel={readModel} />
            </div>

            <FallbackEntryTable readModel={readModel} />
        </section>
    );
}
