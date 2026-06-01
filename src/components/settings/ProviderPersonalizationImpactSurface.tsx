import React from 'react';
import type {
    ProviderPersonalizationEntry,
    ProviderPersonalizationReadModel,
    ProviderPersonalizationStatus,
} from '../../lib/providers/providerPersonalizationReadModel';

export interface ProviderPersonalizationImpactSurfaceProps {
    readModel: ProviderPersonalizationReadModel;
}

const FIELD_LABELS = [
    'Preferred Provider',
    'Preferred Model',
    'Requested Provider',
    'Requested Model',
    'Actual Provider',
    'Actual Model',
    'Auto Route',
    'Remapped',
    'Fallback Used',
    'Preference Honored',
    'Preference Bypassed',
];

const STATUS_LABELS: Record<ProviderPersonalizationStatus, string> = {
    not_captured: 'Not Captured',
    auto: 'Auto',
    applied: 'Applied',
    fallback: 'Fallback',
    remapped: 'Remapped',
    bypassed: 'Bypassed',
    satisfied_by_actual: 'Satisfied By Actual',
};

function displayValue(value?: string | number): string {
    if (value === undefined || value === null) return '-';
    return String(value).trim() || '-';
}

function compactValue(value?: string | number, maxLength: number = 34): string {
    const normalized = displayValue(value);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maxLength - 1))}...`;
}

function formatReadableValue(value: string): string {
    return value
        .split(/[_\-\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || '-';
}

function booleanLabel(value: boolean): string {
    return value ? 'Yes' : 'No';
}

function isAutoRoute(entry: ProviderPersonalizationEntry): boolean {
    return entry.providerPreferenceStatus === 'auto';
}

function isRemapped(entry: ProviderPersonalizationEntry): boolean {
    return entry.providerPreferenceStatus === 'remapped'
        || Boolean(
            entry.routingReason
            && entry.routingReason !== 'requested_model'
            && entry.requestedProvider
            && entry.actualProvider
            && entry.requestedProvider !== entry.actualProvider,
        );
}

function isPreferenceHonored(entry: ProviderPersonalizationEntry): boolean {
    return entry.providerPreferenceStatus === 'applied'
        || entry.providerPreferenceStatus === 'satisfied_by_actual';
}

function isPreferenceBypassed(entry: ProviderPersonalizationEntry): boolean {
    return entry.providerPreferenceStatus === 'bypassed';
}

function preferredModelValue(entry: ProviderPersonalizationEntry): string | undefined {
    if (!entry.providerPreferenceCaptured || !entry.requestedMatchesPreference) return undefined;
    return entry.requestedModel;
}

function statusClassName(status: ProviderPersonalizationStatus): string {
    if (status === 'fallback' || status === 'bypassed') {
        return 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200';
    }

    if (status === 'remapped') {
        return 'border-sky-400/30 bg-sky-500/[0.07] text-sky-200';
    }

    if (status === 'applied' || status === 'satisfied_by_actual') {
        return 'border-emerald-400/25 bg-emerald-500/[0.06] text-emerald-200';
    }

    if (status === 'auto') {
        return 'border-violet-400/25 bg-violet-500/[0.06] text-violet-200';
    }

    return 'border-border-subtle bg-bg-item-surface text-text-secondary';
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

function ImpactMetric({
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
    rows: Array<{ key: string; label: string; count: number }>;
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
                            data-personalization-count-key={row.key}
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

function countRows(record: Record<string, number>, labels?: Record<string, string>) {
    return Object.entries(record)
        .map(([key, count]) => ({
            key,
            label: labels?.[key] ?? formatReadableValue(key),
            count,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function FieldValue({
    label,
    title,
    children,
    className = '',
}: {
    label: string;
    title?: string;
    children: React.ReactNode;
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

function PersonalizationRow({ entry }: { entry: ProviderPersonalizationEntry }) {
    const autoRoute = isAutoRoute(entry);
    const remapped = isRemapped(entry);
    const honored = isPreferenceHonored(entry);
    const bypassed = isPreferenceBypassed(entry);

    return (
        <div
            role="row"
            data-personalization-status={entry.providerPreferenceStatus}
            data-auto-route={autoRoute}
            data-remapped={remapped}
            data-fallback-used={entry.fallbackUsed}
            data-preference-honored={honored}
            data-preference-bypassed={bypassed}
            className="grid min-w-[1120px] grid-cols-1 gap-3 border-l-2 border-border-subtle bg-bg-item-surface px-4 py-3 text-xs md:grid-cols-[1fr_1.25fr_1fr_1.25fr_1fr_1.25fr_0.75fr_0.75fr_0.85fr_1fr_1fr] md:items-center"
        >
            <FieldValue label="Preferred Provider" className="truncate font-medium text-text-primary" title={displayValue(entry.providerPreference)}>
                {compactValue(entry.providerPreference)}
            </FieldValue>
            <FieldValue label="Preferred Model" className="truncate text-text-secondary" title={displayValue(preferredModelValue(entry))}>
                {compactValue(preferredModelValue(entry))}
            </FieldValue>
            <FieldValue label="Requested Provider" className="truncate text-text-secondary" title={displayValue(entry.requestedProvider)}>
                {compactValue(entry.requestedProvider)}
            </FieldValue>
            <FieldValue label="Requested Model" className="truncate text-text-secondary" title={displayValue(entry.requestedModel)}>
                {compactValue(entry.requestedModel)}
            </FieldValue>
            <FieldValue label="Actual Provider" className="truncate text-text-secondary" title={displayValue(entry.actualProvider)}>
                {compactValue(entry.actualProvider)}
            </FieldValue>
            <FieldValue label="Actual Model" className="truncate text-text-secondary" title={displayValue(entry.actualModel)}>
                {compactValue(entry.actualModel)}
            </FieldValue>
            <FieldValue label="Auto Route" className={autoRoute ? 'font-medium text-violet-200' : 'text-text-secondary'}>
                {booleanLabel(autoRoute)}
            </FieldValue>
            <FieldValue label="Remapped" className={remapped ? 'font-medium text-sky-200' : 'text-text-secondary'}>
                {booleanLabel(remapped)}
            </FieldValue>
            <FieldValue label="Fallback Used" className={entry.fallbackUsed ? 'font-medium text-amber-200' : 'text-text-secondary'}>
                {booleanLabel(entry.fallbackUsed)}
            </FieldValue>
            <FieldValue label="Preference Honored">
                <span className={`inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold ${statusClassName(entry.providerPreferenceStatus)}`}>
                    {honored ? 'Yes' : STATUS_LABELS[entry.providerPreferenceStatus]}
                </span>
            </FieldValue>
            <FieldValue label="Preference Bypassed" className={bypassed ? 'font-medium text-amber-200' : 'text-text-secondary'}>
                {booleanLabel(bypassed)}
            </FieldValue>
        </div>
    );
}

export function ProviderPersonalizationImpactSurface({ readModel }: ProviderPersonalizationImpactSurfaceProps) {
    const honoredCount = readModel.summary.appliedCount + readModel.summary.satisfiedByActualCount;

    return (
        <section aria-label="Provider personalization impact" className="space-y-3">
            <div>
                <h3 className="text-sm font-bold text-text-primary mb-1">Provider Personalization</h3>
            </div>

            <div
                role="list"
                aria-label="Provider personalization impact summary"
                className="grid grid-cols-2 gap-2 md:grid-cols-4"
            >
                <ImpactMetric label="Preferred Provider" value={readModel.summary.capturedCount} />
                <ImpactMetric label="Auto Route" value={readModel.summary.autoCount} />
                <ImpactMetric label="Remapped" value={readModel.summary.remapCount} tone="warning" />
                <ImpactMetric label="Fallback Used" value={readModel.summary.fallbackCount} tone="warning" />
                <ImpactMetric label="Preference Honored" value={honoredCount} />
                <ImpactMetric label="Preference Bypassed" value={readModel.summary.bypassedCount} tone="warning" />
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                <CountTable
                    title="Preferred Provider"
                    emptyLabel="No provider preferences"
                    rows={countRows(readModel.summary.byProviderPreference)}
                />
                <CountTable
                    title="Preference Status"
                    emptyLabel="No personalization statuses"
                    rows={countRows(readModel.summary.byStatus, STATUS_LABELS)}
                />
                <CountTable
                    title="Preference Context"
                    emptyLabel="No preference context"
                    rows={[
                        ...countRows(readModel.summary.byResponseStyle).map((row) => ({ ...row, label: `Style: ${row.label}` })),
                        ...countRows(readModel.summary.byInterviewFocus).map((row) => ({ ...row, label: `Focus: ${row.label}` })),
                    ]}
                />
            </div>

            <div
                role="table"
                aria-label="Provider personalization impact rows"
                className="overflow-x-auto rounded-xl border border-border-subtle bg-bg-input/35"
            >
                <div
                    role="row"
                    className="hidden min-w-[1120px] grid-cols-[1fr_1.25fr_1fr_1.25fr_1fr_1.25fr_0.75fr_0.75fr_0.85fr_1fr_1fr] gap-3 border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary md:grid"
                >
                    {FIELD_LABELS.map((label) => (
                        <div key={label} role="columnheader">
                            {label}
                        </div>
                    ))}
                </div>

                <div role="rowgroup" className="divide-y divide-border-subtle">
                    {readModel.entries.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-text-secondary" role="row">
                            No provider personalization impact
                        </div>
                    ) : (
                        readModel.entries.map((entry) => (
                            <PersonalizationRow key={entry.responseId} entry={entry} />
                        ))
                    )}
                </div>
            </div>
        </section>
    );
}
