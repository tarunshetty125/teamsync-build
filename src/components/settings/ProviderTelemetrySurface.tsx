import React, { type ReactNode } from 'react';
import type {
    ProviderTelemetryBucket,
    ProviderTelemetryEntry,
    ProviderTelemetryReadModel,
    ProviderTelemetryStatus,
} from '../../lib/providers/providerTelemetryReadModel';

export interface ProviderTelemetrySurfaceProps {
    readModel: ProviderTelemetryReadModel;
}

type CountRow = {
    key: string;
    label: string;
    value: number | string;
};

type ValidationSummary = {
    passed: number;
    failed: number;
    unknown: number;
};

type TokenSummary = {
    promptTokens: number;
    completionTokens: number;
    inputTokens: number;
    outputTokens: number;
};

const STATUS_LABELS: Record<ProviderTelemetryStatus, string> = {
    success: 'Success',
    failure: 'Failure',
    streaming: 'Streaming',
    cancelled: 'Cancelled',
    unknown: 'Unknown',
};

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

function compactValue(value?: string, maxLength: number = 34): string {
    const normalized = displayValue(value);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maxLength - 1))}...`;
}

function formatLatency(value: number | null | undefined): string {
    if (value === null || value === undefined) return '-';
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`;
    return `${value}ms`;
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

function sumValues(entries: ProviderTelemetryEntry[], key: keyof Pick<ProviderTelemetryEntry, 'promptTokens' | 'completionTokens' | 'inputTokens' | 'outputTokens'>): number {
    return entries.reduce((sum, entry) => sum + (entry[key] ?? 0), 0);
}

function buildValidationSummary(entries: ProviderTelemetryEntry[]): ValidationSummary {
    return {
        passed: entries.filter((entry) => entry.validationPassed === true).length,
        failed: entries.filter((entry) => entry.validationPassed === false).length,
        unknown: entries.filter((entry) => entry.validationPassed === undefined).length,
    };
}

function buildTokenSummary(entries: ProviderTelemetryEntry[]): TokenSummary {
    return {
        promptTokens: sumValues(entries, 'promptTokens'),
        completionTokens: sumValues(entries, 'completionTokens'),
        inputTokens: sumValues(entries, 'inputTokens'),
        outputTokens: sumValues(entries, 'outputTokens'),
    };
}

function streamingCompletionCount(entries: ProviderTelemetryEntry[]): number {
    return entries.filter((entry) => entry.streamingCompleted).length;
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

function statusClassName(status: ProviderTelemetryStatus): string {
    if (status === 'failure' || status === 'cancelled') {
        return 'border-red-400/30 bg-red-500/[0.08] text-red-200';
    }

    if (status === 'streaming') {
        return 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200';
    }

    if (status === 'unknown') {
        return 'border-border-subtle bg-bg-item-surface text-text-secondary';
    }

    return 'border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-200';
}

function TelemetryMetric({
    label,
    value,
    tone = 'normal',
}: {
    label: string;
    value: number | string;
    tone?: 'normal' | 'warning' | 'critical';
}) {
    const numericValue = typeof value === 'number' ? value : Number.parseFloat(String(value)) || 0;

    return (
        <div role="listitem" className={`rounded-lg border px-3 py-2 ${metricClassName(numericValue, tone)}`}>
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
                            data-telemetry-count-key={row.key}
                        >
                            <span className="min-w-0 truncate text-text-secondary" title={row.key}>
                                {row.label}
                            </span>
                            <strong className="text-text-primary">{row.value}</strong>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function bucketRows(record: Record<string, ProviderTelemetryBucket>): Array<CountRow & { bucket: ProviderTelemetryBucket }> {
    return Object.entries(record)
        .map(([key, bucket]) => ({
            key,
            label: formatReadableValue(key),
            value: bucket.requestCount,
            bucket,
        }))
        .sort((a, b) => b.bucket.requestCount - a.bucket.requestCount || a.label.localeCompare(b.label));
}

function BucketSummaryTable({
    title,
    emptyLabel,
    rows,
}: {
    title: string;
    emptyLabel: string;
    rows: Array<CountRow & { bucket: ProviderTelemetryBucket }>;
}) {
    return (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-input/35">
            <div className="grid grid-cols-[1fr_0.55fr_0.55fr_0.55fr_0.65fr] gap-3 border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                <div>{title}</div>
                <div>Req</div>
                <div>Ok</div>
                <div>Fail</div>
                <div>Latency</div>
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
                            className="grid grid-cols-[1fr_0.55fr_0.55fr_0.55fr_0.65fr] gap-3 px-4 py-2.5 text-xs"
                            data-telemetry-bucket={row.key}
                        >
                            <span className="min-w-0 truncate text-text-secondary" title={row.key}>
                                {row.label}
                            </span>
                            <strong className="text-text-primary">{row.bucket.requestCount}</strong>
                            <strong className="text-text-primary">{row.bucket.successCount}</strong>
                            <strong className="text-text-primary">{row.bucket.failureCount}</strong>
                            <strong className="text-text-primary">{formatLatency(row.bucket.avgLatencyMs)}</strong>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function EntryTable({ readModel }: { readModel: ProviderTelemetryReadModel }) {
    return (
        <div
            role="table"
            aria-label="Provider telemetry rows"
            className="overflow-x-auto rounded-xl border border-border-subtle bg-bg-input/35"
        >
            <div
                role="row"
                className="hidden min-w-[900px] grid-cols-[1.05fr_1fr_1fr_0.75fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary md:grid"
            >
                <div role="columnheader">Response</div>
                <div role="columnheader">Provider</div>
                <div role="columnheader">Model</div>
                <div role="columnheader">Status</div>
                <div role="columnheader">Latency</div>
                <div role="columnheader">Streaming</div>
                <div role="columnheader">Validation</div>
            </div>

            <div role="rowgroup" className="divide-y divide-border-subtle">
                {readModel.entries.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-text-secondary" role="row">
                        <div role="cell">No provider telemetry</div>
                    </div>
                ) : (
                    readModel.entries.map((entry) => (
                        <div
                            key={entry.responseId}
                            role="row"
                            data-telemetry-status={entry.status}
                            data-telemetry-cache-hit={entry.cacheHit}
                            data-telemetry-cancelled={entry.cancelled}
                            className="grid min-w-[900px] grid-cols-1 gap-3 border-l-2 border-border-subtle bg-bg-item-surface px-4 py-3 text-xs md:grid-cols-[1.05fr_1fr_1fr_0.75fr_0.8fr_0.8fr_0.8fr] md:items-center"
                        >
                            <FieldValue label="Response" className="truncate font-medium text-text-primary" title={entry.responseId} cellRole="rowheader">
                                {compactValue(entry.responseId, 24)}
                            </FieldValue>
                            <FieldValue label="Provider" className="truncate text-text-secondary" title={displayValue(entry.actualProvider ?? entry.requestedProvider)}>
                                {compactValue(entry.actualProvider ?? entry.requestedProvider)}
                            </FieldValue>
                            <FieldValue label="Model" className="truncate text-text-secondary" title={displayValue(entry.actualModel ?? entry.requestedModel)}>
                                {compactValue(entry.actualModel ?? entry.requestedModel)}
                            </FieldValue>
                            <FieldValue label="Status">
                                <span className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold ${statusClassName(entry.status)}`}>
                                    {STATUS_LABELS[entry.status]}
                                </span>
                            </FieldValue>
                            <FieldValue label="Latency" className="text-text-secondary">
                                {formatLatency(entry.latencyMs)}
                            </FieldValue>
                            <FieldValue label="Streaming" className="text-text-secondary">
                                {entry.streamingCompleted ? 'Completed' : entry.streamingStarted ? 'Started' : '-'}
                            </FieldValue>
                            <FieldValue label="Validation" className="text-text-secondary">
                                {entry.validationPassed === true ? 'Passed' : entry.validationPassed === false ? 'Failed' : '-'}
                            </FieldValue>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export function ProviderTelemetrySurface({ readModel }: ProviderTelemetrySurfaceProps) {
    const validation = buildValidationSummary(readModel.entries);
    const tokens = buildTokenSummary(readModel.entries);
    const streamingCompleted = streamingCompletionCount(readModel.entries);
    const statusRows = Object.entries(readModel.summary.byStatus)
        .map(([status, count]) => ({
            key: status,
            label: STATUS_LABELS[status as ProviderTelemetryStatus] ?? formatReadableValue(status),
            value: count,
        }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)));

    return (
        <section aria-label="Provider telemetry" className="space-y-3">
            <div>
                <h3 className="text-sm font-bold text-text-primary mb-1">Provider Telemetry</h3>
            </div>

            <div
                role="list"
                aria-label="Provider telemetry summary"
                className="grid grid-cols-2 gap-2 md:grid-cols-4"
            >
                <TelemetryMetric label="Request Count" value={readModel.summary.requestCount} />
                <TelemetryMetric label="Success Count" value={readModel.summary.successCount} />
                <TelemetryMetric label="Failure Count" value={readModel.summary.failureCount} tone="critical" />
                <TelemetryMetric label="Retry Count" value={readModel.summary.retryCount} tone="warning" />
                <TelemetryMetric label="Fallback Count" value={readModel.summary.fallbackCount} tone="warning" />
                <TelemetryMetric label="Cache Hits" value={readModel.summary.cacheHitCount} />
                <TelemetryMetric label="Latency" value={formatLatency(readModel.summary.avgLatencyMs)} />
                <TelemetryMetric label="Streaming Completion" value={streamingCompleted} />
                <TelemetryMetric label="Cancellation" value={readModel.summary.cancelledCount} tone="critical" />
                <TelemetryMetric label="Validation Outcome" value={`${validation.passed}/${validation.failed}/${validation.unknown}`} />
                <TelemetryMetric label="Token Counts" value={tokens.promptTokens + tokens.completionTokens + tokens.inputTokens + tokens.outputTokens} />
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                <CountTable
                    title="Validation Outcome"
                    emptyLabel="No validation outcomes"
                    rows={[
                        { key: 'passed', label: 'Passed', value: validation.passed },
                        { key: 'failed', label: 'Failed', value: validation.failed },
                        { key: 'unknown', label: 'Unknown', value: validation.unknown },
                    ]}
                />
                <CountTable
                    title="Token Counts"
                    emptyLabel="No token counts"
                    rows={[
                        { key: 'promptTokens', label: 'Prompt Tokens', value: tokens.promptTokens },
                        { key: 'completionTokens', label: 'Completion Tokens', value: tokens.completionTokens },
                        { key: 'inputTokens', label: 'Input Tokens', value: tokens.inputTokens },
                        { key: 'outputTokens', label: 'Output Tokens', value: tokens.outputTokens },
                    ]}
                />
                <CountTable
                    title="Status Counts"
                    emptyLabel="No status counts"
                    rows={statusRows}
                />
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <BucketSummaryTable
                    title="Provider Summary"
                    emptyLabel="No provider telemetry"
                    rows={bucketRows(readModel.summary.byProvider)}
                />
                <BucketSummaryTable
                    title="Model Summary"
                    emptyLabel="No model telemetry"
                    rows={bucketRows(readModel.summary.byModel)}
                />
            </div>

            <EntryTable readModel={readModel} />
        </section>
    );
}
