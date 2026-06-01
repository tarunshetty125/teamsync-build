import React, { type ReactNode } from 'react';
import type {
    ProviderHealthEntry,
    ProviderHealthReadModel,
} from '../../lib/providers/providerHealthReadModel';

export interface ProviderHealthStatusSurfaceProps {
    readModel: ProviderHealthReadModel;
}

type ProviderHealthTone = 'normal' | 'warning' | 'info';

const FIELD_LABELS = ['Provider', 'Configured', 'Reachable', 'Authenticated', 'Degraded', 'Last Diagnostic'];

function getProviderHealthTone(entry: ProviderHealthEntry): ProviderHealthTone {
    if (!entry.configured) return 'info';
    if (entry.degraded) return 'warning';
    return 'normal';
}

function toneClassName(tone: ProviderHealthTone): string {
    if (tone === 'warning') {
        return 'border-amber-400/35 bg-amber-500/[0.06]';
    }

    if (tone === 'info') {
        return 'border-sky-400/25 bg-sky-500/[0.045]';
    }

    return 'border-border-subtle bg-bg-item-surface';
}

function booleanClassName(value: boolean, tone: ProviderHealthTone, field: 'configured' | 'reachable' | 'authenticated' | 'degraded'): string {
    if (field === 'degraded') {
        return value ? 'text-amber-300' : 'text-text-secondary';
    }

    if (!value && tone === 'info') {
        return 'text-sky-300';
    }

    if (!value) {
        return 'text-amber-300';
    }

    return 'text-text-primary';
}

function booleanLabel(value: boolean): string {
    return value ? 'Yes' : 'No';
}

function diagnosticText(entry: ProviderHealthEntry): string {
    return entry.lastDiagnostic?.message || 'No diagnostic available';
}

function FieldValue({
    label,
    children,
    className = '',
}: {
    label: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className="min-w-0">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-text-tertiary md:hidden">
                {label}
            </div>
            <div className={className}>{children}</div>
        </div>
    );
}

export function ProviderHealthStatusSurface({ readModel }: ProviderHealthStatusSurfaceProps) {
    return (
        <section aria-label="Provider health status" className="space-y-3">
            <div>
                <h3 className="text-sm font-bold text-text-primary mb-1">Provider Health</h3>
            </div>

            <div
                role="table"
                aria-label="Provider health status table"
                className="overflow-hidden rounded-xl border border-border-subtle bg-bg-input/35"
            >
                <div
                    role="row"
                    className="hidden grid-cols-[1.1fr_0.75fr_0.75fr_0.85fr_0.7fr_2.4fr] gap-3 border-b border-border-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary md:grid"
                >
                    {FIELD_LABELS.map((label) => (
                        <div key={label} role="columnheader">
                            {label}
                        </div>
                    ))}
                </div>

                <div role="rowgroup" className="divide-y divide-border-subtle">
                    {readModel.orderedProviders.map((entry) => {
                        const tone = getProviderHealthTone(entry);
                        const rowClassName = toneClassName(tone);

                        return (
                            <div
                                key={entry.provider}
                                role="row"
                                data-provider={entry.provider}
                                data-health-tone={tone}
                                className={`grid grid-cols-1 gap-3 border-l-2 px-4 py-3 text-xs md:grid-cols-[1.1fr_0.75fr_0.75fr_0.85fr_0.7fr_2.4fr] md:items-center ${rowClassName}`}
                            >
                                <FieldValue label="Provider" className="min-w-0 font-semibold text-text-primary">
                                    <span className="block truncate">{entry.label}</span>
                                </FieldValue>
                                <FieldValue
                                    label="Configured"
                                    className={`font-medium ${booleanClassName(entry.configured, tone, 'configured')}`}
                                >
                                    {booleanLabel(entry.configured)}
                                </FieldValue>
                                <FieldValue
                                    label="Reachable"
                                    className={`font-medium ${booleanClassName(entry.reachable, tone, 'reachable')}`}
                                >
                                    {booleanLabel(entry.reachable)}
                                </FieldValue>
                                <FieldValue
                                    label="Authenticated"
                                    className={`font-medium ${booleanClassName(entry.authenticated, tone, 'authenticated')}`}
                                >
                                    {booleanLabel(entry.authenticated)}
                                </FieldValue>
                                <FieldValue
                                    label="Degraded"
                                    className={`font-medium ${booleanClassName(entry.degraded, tone, 'degraded')}`}
                                >
                                    {booleanLabel(entry.degraded)}
                                </FieldValue>
                                <FieldValue label="Last Diagnostic" className="min-w-0 text-text-secondary">
                                    <span className="block truncate" title={diagnosticText(entry)}>
                                        {diagnosticText(entry)}
                                    </span>
                                </FieldValue>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
