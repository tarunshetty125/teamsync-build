import type { ProviderHealthDiagnostic, ProviderHealthEntry } from './providerHealthReadModel';

export type ProviderFallbackCandidateDecision = 'attempt' | 'skip';

export type ProviderFallbackCandidateSkipReason =
    | 'not_configured'
    | 'unreachable'
    | 'auth_failed'
    | 'provider_unavailable';

export interface ProviderFallbackCandidate {
    model: string;
    provider: string;
}

export interface ProviderFallbackCandidateHealthSignal {
    configured?: boolean;
    reachable?: boolean;
    authenticated?: boolean;
    degraded?: boolean;
    lastDiagnostic?: ProviderHealthDiagnostic | null;
}

export type ProviderFallbackCandidateHealthInput =
    | ProviderFallbackCandidateHealthSignal
    | ProviderHealthEntry;

export interface ProviderFallbackCandidateEvaluation {
    candidate: ProviderFallbackCandidate;
    decision: ProviderFallbackCandidateDecision;
    skipReason?: ProviderFallbackCandidateSkipReason;
    diagnosticCode?: string;
    degraded: boolean;
    knownHealth: boolean;
}

export interface ProviderFallbackCandidatePlan {
    evaluations: ProviderFallbackCandidateEvaluation[];
    selectedCandidate: ProviderFallbackCandidate | null;
    skippedCandidates: ProviderFallbackCandidateEvaluation[];
}

const PERMANENTLY_UNAVAILABLE_DIAGNOSTICS = new Set([
    'provider_unavailable',
    'ollama_unavailable',
    'no_available_keys',
]);

function normalizeProvider(provider: string): string {
    return provider.trim().toLowerCase();
}

function normalizeDiagnosticCode(
    health?: ProviderFallbackCandidateHealthInput | null,
): string | undefined {
    return typeof health?.lastDiagnostic?.category === 'string'
        ? health.lastDiagnostic.category
        : undefined;
}

export function evaluateProviderFallbackCandidate(
    candidate: ProviderFallbackCandidate,
    health?: ProviderFallbackCandidateHealthInput | null,
): ProviderFallbackCandidateEvaluation {
    const diagnosticCode = normalizeDiagnosticCode(health);
    const knownHealth = Boolean(health);
    const degraded = health?.degraded === true;
    const base = {
        candidate,
        diagnosticCode,
        degraded,
        knownHealth,
    };

    if (health?.configured === false || diagnosticCode === 'not_configured') {
        return {
            ...base,
            decision: 'skip',
            skipReason: 'not_configured',
        };
    }

    if (
        health?.authenticated === false
        || (
            health?.authenticated !== true
            && (
                diagnosticCode === 'auth_failed'
                || diagnosticCode === 'auth_expired'
                || diagnosticCode === 'invalid_keys'
            )
        )
    ) {
        return {
            ...base,
            decision: 'skip',
            skipReason: 'auth_failed',
        };
    }

    if (
        health?.reachable === false
        || (
            health?.reachable !== true
            && (diagnosticCode === 'connection_failed' || diagnosticCode === 'model_fetch_failed')
        )
    ) {
        return {
            ...base,
            decision: 'skip',
            skipReason: 'unreachable',
        };
    }

    if (diagnosticCode && PERMANENTLY_UNAVAILABLE_DIAGNOSTICS.has(diagnosticCode)) {
        return {
            ...base,
            decision: 'skip',
            skipReason: 'provider_unavailable',
        };
    }

    return {
        ...base,
        decision: 'attempt',
    };
}

export function buildProviderFallbackCandidatePlan(
    candidates: ProviderFallbackCandidate[],
    healthByProvider: Record<string, ProviderFallbackCandidateHealthInput | null | undefined> = {},
): ProviderFallbackCandidatePlan {
    const evaluations = candidates.map((candidate) => evaluateProviderFallbackCandidate(
        candidate,
        healthByProvider[normalizeProvider(candidate.provider)] ?? healthByProvider[candidate.provider],
    ));
    return {
        evaluations,
        selectedCandidate: evaluations.find((evaluation) => evaluation.decision === 'attempt')?.candidate ?? null,
        skippedCandidates: evaluations.filter((evaluation) => evaluation.decision === 'skip'),
    };
}

export function formatProviderFallbackCandidateSkipReason(
    evaluation: ProviderFallbackCandidateEvaluation,
): string {
    const reason = evaluation.skipReason ?? 'provider_unavailable';
    return [
        'fallback_candidate_skipped',
        reason,
        `provider=${evaluation.candidate.provider}`,
        `model=${evaluation.candidate.model}`,
        evaluation.diagnosticCode ? `diagnostic=${evaluation.diagnosticCode}` : undefined,
    ].filter(Boolean).join(':');
}
