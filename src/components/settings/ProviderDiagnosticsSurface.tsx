import React from 'react';
import type {
    ProviderDiagnosticCategory,
    ProviderDiagnosticEntry,
    ProviderDiagnosticSeverity,
    ProviderDiagnosticsReadModel,
} from '../../lib/providers/providerDiagnosticsReadModel';

export interface ProviderDiagnosticsSurfaceProps {
    readModel: ProviderDiagnosticsReadModel;
}

function diagnosticLabel(diagnostic: ProviderDiagnosticEntry): string {
    if (diagnostic.category === 'auth_expired' && diagnostic.provider === 'bedrock') {
        return 'AWS Reauth Required';
    }

    const labels: Record<ProviderDiagnosticCategory, string> = {
        not_configured: 'Missing Credentials',
        auth_expired: 'Missing Credentials',
        auth_failed: 'Missing Credentials',
        rate_limited: 'Provider Unavailable',
        provider_unavailable: 'Provider Unavailable',
        model_unavailable: 'Model Unavailable',
        no_available_keys: 'Missing Credentials',
        cooldown: 'Provider Unavailable',
        invalid_keys: 'Missing Credentials',
        fallback_activated: 'Fallback Activated',
        safe_fallback: 'Safe Fallback Activated',
        validation_failed: 'Validation Failure',
        routing_remap: 'Route Remap',
        request_failed: 'Direct Provider Failure',
        request_cancelled: 'Cancellation',
        unknown: 'Provider Unavailable',
    };

    return labels[diagnostic.category];
}

function severityLabel(severity: ProviderDiagnosticSeverity): string {
    if (severity === 'error') return 'Error';
    if (severity === 'warning') return 'Warning';
    return 'Info';
}

function severityClassName(severity: ProviderDiagnosticSeverity): string {
    if (severity === 'error') {
        return 'border-red-400/30 bg-red-500/[0.08] text-red-200';
    }

    if (severity === 'warning') {
        return 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200';
    }

    return 'border-sky-400/25 bg-sky-500/[0.06] text-sky-200';
}

function rowClassName(severity: ProviderDiagnosticSeverity): string {
    if (severity === 'error') {
        return 'border-red-400/25 bg-red-500/[0.045]';
    }

    if (severity === 'warning') {
        return 'border-amber-400/25 bg-amber-500/[0.045]';
    }

    return 'border-sky-400/20 bg-sky-500/[0.035]';
}

function providerText(diagnostic: ProviderDiagnosticEntry): string {
    return [diagnostic.provider, diagnostic.model].filter(Boolean).join(' / ');
}

export function ProviderDiagnosticsSurface({ readModel }: ProviderDiagnosticsSurfaceProps) {
    return (
        <section aria-label="Provider diagnostics" className="space-y-3">
            <div>
                <h3 className="text-sm font-bold text-text-primary mb-1">Provider Diagnostics</h3>
            </div>

            <div
                role="list"
                aria-label="Provider diagnostics list"
                className="overflow-hidden rounded-xl border border-border-subtle bg-bg-input/35"
            >
                {readModel.diagnostics.length === 0 ? (
                    <div className="px-4 py-3 text-xs text-text-secondary" role="listitem">
                        No provider diagnostics
                    </div>
                ) : (
                    <div className="divide-y divide-border-subtle">
                        {readModel.diagnostics.map((diagnostic) => (
                            <div
                                key={diagnostic.id}
                                role="listitem"
                                data-diagnostic-category={diagnostic.category}
                                data-diagnostic-severity={diagnostic.severity}
                                className={`border-l-2 px-4 py-3 ${rowClassName(diagnostic.severity)}`}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-xs font-semibold text-text-primary">
                                                {diagnosticLabel(diagnostic)}
                                            </span>
                                            <span className="text-[10px] text-text-tertiary">
                                                {diagnostic.source}
                                            </span>
                                        </div>
                                        <div className="mt-1 text-xs text-text-secondary">
                                            {diagnostic.message}
                                        </div>
                                        {providerText(diagnostic) && (
                                            <div className="mt-1 truncate text-[10px] text-text-tertiary" title={providerText(diagnostic)}>
                                                {providerText(diagnostic)}
                                            </div>
                                        )}
                                    </div>

                                    <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold ${severityClassName(diagnostic.severity)}`}>
                                        {severityLabel(diagnostic.severity)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
