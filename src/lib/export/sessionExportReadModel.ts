import type { DiagramComparisonReadModel } from '../../components/pro-v2/architecture/diagramComparison';
import type { DiagramEvolutionSummary } from '../../components/pro-v2/architecture/diagramEvolutionSummary';
import type { DiagramGuardrailReadModel } from '../../components/pro-v2/architecture/diagramGuardrails';
import type { DiagramTimeline } from '../../components/pro-v2/architecture/diagramTimeline';
import type { ResponseOwnership } from '../overlay/actionContextTypes';
import type { V2ResponseArtifact } from '../overlay/responseArtifacts';
import {
    buildProviderDiagnosticsReadModel,
    type ProviderDiagnosticsReadModel,
    type ProviderDiagnosticEntry,
} from '../providers/providerDiagnosticsReadModel';
import {
    buildProviderFallbackReadModel,
    type ProviderFallbackEntry,
    type ProviderFallbackReadModel,
} from '../providers/providerFallbackReadModel';
import {
    buildProviderPersonalizationReadModel,
    type ProviderPersonalizationEntry,
    type ProviderPersonalizationReadModel,
} from '../providers/providerPersonalizationReadModel';
import {
    buildProviderRoutingReadModel,
    type ProviderRoutingEntry,
    type ProviderRoutingMessage,
    type ProviderRoutingReadModel,
} from '../providers/providerRoutingReadModel';
import {
    buildProviderTelemetryReadModel,
    type ProviderTelemetryEntry,
    type ProviderTelemetryReadModel,
} from '../providers/providerTelemetryReadModel';

export const SESSION_EXPORT_PRIVACY_EXCLUDED_FIELDS = Object.freeze([
    'screenshots',
    'screenshotPreview',
    'transcript',
    'transcriptBuffer',
    'rawPrompt',
    'prompt',
    'credentials',
    'providerPayload',
    'debugMetadata',
    'intelligenceMetadata',
    'localFilesystemPath',
    'artifacts.payload',
    'architectureJson',
    'architecturePayload',
    'diagramPayload',
    'parsedDiagram',
    'parsedArchitecture',
] as const);

export const SESSION_EXPORT_PRIVACY_ALLOWLIST = Object.freeze({
    session: [
        'generatedAt',
        'activeResponseId',
        'responseCount',
        'rootResponseIds',
        'firstResponseAt',
        'lastResponseAt',
    ],
    response: [
        'responseId',
        'requestId',
        'role',
        'source',
        'intent',
        'timestamp',
        'questionTurnId',
        'questionTurn',
        'parentResponseId',
        'rootResponseId',
        'isActive',
        'isStreaming',
        'ownership',
        'artifactSummary',
    ],
    ownership: [
        'responseId',
        'questionTurnId',
        'transcriptVersion',
        'contextTarget',
        'actionId',
        'parentResponseId',
        'mode',
        'createdAt',
        'sourceProvider',
        'sourceModel',
        'requestedProvider',
        'requestedModel',
        'actualProvider',
        'actualModel',
        'routingReason',
        'resolvedCodingLanguage',
        'providerPreference',
        'responseStyle',
        'interviewFocus',
        'personalizationVersion',
    ],
    providers: [
        'routingSummary',
        'fallbackSummary',
        'telemetrySummary',
        'diagnosticsSummary',
        'personalizationSummary',
        'routes',
        'fallbacks',
        'telemetry',
        'diagnostics',
        'personalization',
    ],
    diagrams: [
        'timeline',
        'evolution',
        'guardrails',
        'comparisons',
    ],
} as const);

export interface SessionExportSourceResponse extends ProviderRoutingMessage {
    role?: string;
    rootResponseId?: string;
    parentResponseId?: string;
    questionTurn?: string;
    artifacts?: V2ResponseArtifact[];
    isStreaming?: boolean;
}

export interface BuildSessionExportReadModelInput {
    responses: SessionExportSourceResponse[];
    activeResponseId?: string | null;
    generatedAt?: number;
    providerRouting?: ProviderRoutingReadModel;
    providerFallback?: ProviderFallbackReadModel;
    providerTelemetry?: ProviderTelemetryReadModel;
    providerDiagnostics?: ProviderDiagnosticsReadModel;
    providerPersonalization?: ProviderPersonalizationReadModel;
    diagramTimeline?: DiagramTimeline | null;
    parentCurrentEvolution?: DiagramEvolutionSummary | null;
    rootCurrentEvolution?: DiagramEvolutionSummary | null;
    versionPairEvolution?: DiagramEvolutionSummary | null;
    diagramGuardrails?: DiagramGuardrailReadModel | null;
    parentCurrentComparison?: DiagramComparisonReadModel | null;
    rootCurrentComparison?: DiagramComparisonReadModel | null;
    versionPairComparison?: DiagramComparisonReadModel | null;
}

export interface SessionExportArtifactSummary {
    total: number;
    byKind: Record<string, number>;
    bySource: Record<string, number>;
    byStatus: Record<string, number>;
    architectureCount: number;
    mermaidCount: number;
}

export interface SessionExportResponse {
    responseId: string;
    requestId?: string;
    role?: string;
    source?: string;
    intent?: string;
    timestamp?: number;
    questionTurnId?: string;
    questionTurn?: string;
    parentResponseId?: string;
    rootResponseId?: string;
    isActive: boolean;
    isStreaming?: boolean;
    ownership?: Partial<ResponseOwnership>;
    artifactSummary: SessionExportArtifactSummary;
}

export interface SessionExportProviderSection {
    routingSummary?: ProviderRoutingReadModel['summary'];
    fallbackSummary?: ProviderFallbackReadModel['summary'];
    telemetrySummary?: ProviderTelemetryReadModel['summary'];
    diagnosticsSummary?: ProviderDiagnosticsReadModel['summary'];
    personalizationSummary?: ProviderPersonalizationReadModel['summary'];
    activeRoute?: SessionExportProviderRoute | null;
    activeTelemetry?: SessionExportProviderTelemetry | null;
    activePersonalization?: SessionExportProviderPersonalization | null;
    routes: SessionExportProviderRoute[];
    fallbacks: SessionExportProviderFallback[];
    telemetry: SessionExportProviderTelemetry[];
    diagnostics: SessionExportProviderDiagnostic[];
    personalization: SessionExportProviderPersonalization[];
}

export type SessionExportProviderRoute = ProviderRoutingEntry;

export interface SessionExportProviderFallback extends Omit<ProviderFallbackEntry, 'attempts' | 'successfulAttempt'> {
    attemptCount: number;
    successfulAttempt?: {
        provider?: string;
        model?: string;
        result: ProviderFallbackEntry['attempts'][number]['result'];
        durationMs?: number;
    };
}

export type SessionExportProviderTelemetry = ProviderTelemetryEntry;

export type SessionExportProviderDiagnostic = Omit<ProviderDiagnosticEntry, 'message' | 'actionLabel'>;

export type SessionExportProviderPersonalization = ProviderPersonalizationEntry;

export interface SessionExportTimelineItem {
    version: number;
    responseId: string;
    parentResponseId?: string;
    parentVersion?: number;
    rootResponseId: string;
    rootVersion?: number;
    artifactId: string;
    createdAt?: number;
    status: string;
    source: string;
    hasDiff: boolean;
    diffSummary: DiagramTimeline['items'][number]['diffSummary'];
}

export interface SessionExportEvolutionSummary {
    mode: DiagramEvolutionSummary['mode'];
    from: DiagramEvolutionSummary['from'];
    to: DiagramEvolutionSummary['to'];
    diffSummary: DiagramEvolutionSummary['diffSummary'];
    changes: DiagramEvolutionSummary['changes'];
    diffSource: DiagramEvolutionSummary['diffSource'];
    usedStoredDiff: boolean;
    recomputed: boolean;
    issues: string[];
}

export interface SessionExportComparisonSummary {
    mode: DiagramComparisonReadModel['mode'];
    from: DiagramComparisonReadModel['from'];
    to: DiagramComparisonReadModel['to'];
    available: boolean;
    diffSource: DiagramComparisonReadModel['diffSource'];
    usedStoredDiff: boolean;
    recomputed: boolean;
    nodeCounts: DiagramComparisonReadModel['nodeCounts'];
    edgeCounts: DiagramComparisonReadModel['edgeCounts'];
    issues: string[];
}

export interface SessionExportDiagramSection {
    timeline?: {
        rootResponseId: string | null;
        activeVersion: number | null;
        activeVersionCount: number;
        items: SessionExportTimelineItem[];
    };
    evolution?: {
        parentCurrent?: SessionExportEvolutionSummary;
        rootCurrent?: SessionExportEvolutionSummary;
        versionPair?: SessionExportEvolutionSummary;
    };
    guardrails?: DiagramGuardrailReadModel;
    comparisons?: {
        parentCurrent?: SessionExportComparisonSummary;
        rootCurrent?: SessionExportComparisonSummary;
        versionPair?: SessionExportComparisonSummary;
    };
}

export interface SessionExportReadModel {
    generatedAt: number;
    privacy: {
        policy: 'allowlist';
        contentIncluded: false;
        excludedFields: readonly string[];
        allowlist: typeof SESSION_EXPORT_PRIVACY_ALLOWLIST;
    };
    session: {
        activeResponseId: string | null;
        responseCount: number;
        rootResponseIds: string[];
        firstResponseAt?: number;
        lastResponseAt?: number;
    };
    responses: SessionExportResponse[];
    providers: SessionExportProviderSection;
    diagrams: SessionExportDiagramSection;
    personalization: {
        summary?: ProviderPersonalizationReadModel['summary'];
        entries: SessionExportProviderPersonalization[];
    };
    summaries: {
        responseCount: number;
        activeResponseId: string | null;
        providerRouteCount: number;
        fallbackCount: number;
        telemetryCount: number;
        diagnosticsCount: number;
        personalizationCount: number;
        diagramVersionCount: number;
        artifactCount: number;
    };
}

const OWNERSHIP_KEYS: Array<keyof ResponseOwnership> = [
    'responseId',
    'questionTurnId',
    'transcriptVersion',
    'contextTarget',
    'actionId',
    'parentResponseId',
    'mode',
    'createdAt',
    'sourceProvider',
    'sourceModel',
    'requestedProvider',
    'requestedModel',
    'actualProvider',
    'actualModel',
    'routingReason',
    'resolvedCodingLanguage',
    'providerPreference',
    'responseStyle',
    'interviewFocus',
    'personalizationVersion',
];

export function redactSessionExportString(value: string): string {
    return value.replace(
        /(?:\/(?:Users|home|private|var|tmp|Applications|Volumes)\/[^\s"'<>]+)|(?:[A-Za-z]:\\[^\s"'<>]+)/g,
        '[local-path-redacted]',
    );
}

export function redactSessionExportValue<T>(value: T): T {
    if (typeof value === 'string') return redactSessionExportString(value) as T;
    if (Array.isArray(value)) return value.map(redactSessionExportValue) as T;
    if (!value || typeof value !== 'object') return value;

    const record = value as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    Object.entries(record).forEach(([key, entry]) => {
        if (entry === undefined) return;
        cleaned[redactSessionExportString(key)] = redactSessionExportValue(entry);
    });
    return cleaned as T;
}

function pickOwnership(ownership?: Partial<ResponseOwnership>): Partial<ResponseOwnership> | undefined {
    if (!ownership) return undefined;
    const picked: Partial<ResponseOwnership> = {};
    OWNERSHIP_KEYS.forEach((key) => {
        const value = ownership[key];
        if (value !== undefined) {
            (picked as Record<string, unknown>)[key] = redactSessionExportValue(value);
        }
    });
    return Object.keys(picked).length > 0 ? picked : undefined;
}

function increment(map: Record<string, number>, key?: string): void {
    if (!key) return;
    map[key] = (map[key] ?? 0) + 1;
}

function buildArtifactSummary(artifacts: V2ResponseArtifact[] = []): SessionExportArtifactSummary {
    const byKind: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    artifacts.forEach((artifact) => {
        increment(byKind, artifact.kind);
        increment(bySource, artifact.source);
        increment(byStatus, artifact.status);
    });

    return {
        total: artifacts.length,
        byKind,
        bySource,
        byStatus,
        architectureCount: artifacts.filter((artifact) => artifact.kind === 'architecture').length,
        mermaidCount: artifacts.filter((artifact) => artifact.kind === 'mermaid').length,
    };
}

function resolveResponseId(response: SessionExportSourceResponse): string {
    return response.ownership?.responseId ?? response.id;
}

function buildExportResponse(
    response: SessionExportSourceResponse,
    activeResponseId: string | null,
): SessionExportResponse {
    const ownership = pickOwnership(response.ownership);
    const responseId = resolveResponseId(response);
    const parentResponseId = response.ownership?.parentResponseId ?? response.parentResponseId;

    return redactSessionExportValue({
        responseId,
        requestId: response.requestId,
        role: response.role,
        source: response.source,
        intent: response.intent,
        timestamp: response.timestamp,
        questionTurnId: response.ownership?.questionTurnId ?? response.questionTurnId,
        questionTurn: response.questionTurn ?? response.ownership?.questionTurnId ?? response.questionTurnId,
        parentResponseId,
        rootResponseId: response.rootResponseId ?? response.ownership?.parentResponseId ?? responseId,
        isActive: activeResponseId === responseId,
        isStreaming: response.isStreaming,
        ownership,
        artifactSummary: buildArtifactSummary(response.artifacts),
    });
}

function firstDefinedTimestamp(responses: SessionExportResponse[]): number | undefined {
    return responses.find((response) => response.timestamp !== undefined)?.timestamp;
}

function lastDefinedTimestamp(responses: SessionExportResponse[]): number | undefined {
    for (let index = responses.length - 1; index >= 0; index -= 1) {
        const timestamp = responses[index].timestamp;
        if (timestamp !== undefined) return timestamp;
    }
    return undefined;
}

function inferGeneratedAt(input: BuildSessionExportReadModelInput, responses: SessionExportResponse[]): number {
    return input.generatedAt
        ?? input.providerRouting?.generatedAt
        ?? input.providerFallback?.generatedAt
        ?? input.providerTelemetry?.generatedAt
        ?? input.providerDiagnostics?.generatedAt
        ?? input.providerPersonalization?.generatedAt
        ?? lastDefinedTimestamp(responses)
        ?? 0;
}

function buildRootResponseIds(responses: SessionExportResponse[]): string[] {
    const seen = new Set<string>();
    const roots: string[] = [];
    responses.forEach((response) => {
        const rootResponseId = response.rootResponseId ?? response.responseId;
        if (seen.has(rootResponseId)) return;
        seen.add(rootResponseId);
        roots.push(rootResponseId);
    });
    return roots;
}

function buildProviderSourceResponses(responses: SessionExportSourceResponse[]): ProviderRoutingMessage[] {
    return responses.map((response) => ({
        id: resolveResponseId(response),
        requestId: response.requestId,
        provider: response.provider,
        model: response.model,
        intent: response.intent,
        source: response.source,
        timestamp: response.timestamp,
        questionTurnId: response.ownership?.questionTurnId ?? response.questionTurnId,
        ownership: response.ownership,
        ...(response.isStreaming !== undefined ? { isStreaming: response.isStreaming } : {}),
    } as ProviderRoutingMessage));
}

function buildProviders(input: BuildSessionExportReadModelInput): {
    routing: ProviderRoutingReadModel;
    fallback: ProviderFallbackReadModel;
    telemetry: ProviderTelemetryReadModel;
    diagnostics: ProviderDiagnosticsReadModel;
    personalization: ProviderPersonalizationReadModel;
} {
    const activeResponseId = input.activeResponseId ?? null;
    const providerResponses = buildProviderSourceResponses(input.responses);
    const routing = input.providerRouting ?? buildProviderRoutingReadModel({
        responses: providerResponses,
        activeResponseId,
        now: input.generatedAt,
    });
    const fallback = input.providerFallback ?? buildProviderFallbackReadModel({
        responses: providerResponses,
        activeResponseId,
        now: input.generatedAt,
    });
    const telemetry = input.providerTelemetry ?? buildProviderTelemetryReadModel({
        responses: providerResponses,
        activeResponseId,
        now: input.generatedAt,
    });
    const diagnostics = input.providerDiagnostics ?? buildProviderDiagnosticsReadModel({
        responses: providerResponses,
        activeResponseId,
        now: input.generatedAt,
    });
    const personalization = input.providerPersonalization ?? buildProviderPersonalizationReadModel({
        responses: providerResponses,
        activeResponseId,
        now: input.generatedAt,
    });

    return {
        routing,
        fallback,
        telemetry,
        diagnostics,
        personalization,
    };
}

function projectFallback(fallback: ProviderFallbackEntry): SessionExportProviderFallback {
    return redactSessionExportValue({
        responseId: fallback.responseId,
        requestId: fallback.requestId,
        questionTurnId: fallback.questionTurnId,
        actionId: fallback.actionId,
        createdAt: fallback.createdAt,
        requestedProvider: fallback.requestedProvider,
        requestedModel: fallback.requestedModel,
        actualProvider: fallback.actualProvider,
        actualModel: fallback.actualModel,
        fallbackReason: fallback.fallbackReason,
        category: fallback.category,
        safeFallback: fallback.safeFallback,
        providerFallback: fallback.providerFallback,
        validationFallback: fallback.validationFallback,
        failedAttemptCount: fallback.failedAttemptCount,
        source: fallback.source,
        attemptCount: fallback.attempts.length,
        successfulAttempt: fallback.successfulAttempt
            ? {
                provider: fallback.successfulAttempt.provider,
                model: fallback.successfulAttempt.model,
                result: fallback.successfulAttempt.result,
                durationMs: fallback.successfulAttempt.durationMs,
            }
            : undefined,
    });
}

function projectDiagnostic(diagnostic: ProviderDiagnosticEntry): SessionExportProviderDiagnostic {
    return redactSessionExportValue({
        id: diagnostic.id,
        responseId: diagnostic.responseId,
        requestId: diagnostic.requestId,
        questionTurnId: diagnostic.questionTurnId,
        actionId: diagnostic.actionId,
        provider: diagnostic.provider,
        model: diagnostic.model,
        category: diagnostic.category,
        severity: diagnostic.severity,
        title: diagnostic.title,
        source: diagnostic.source,
        createdAt: diagnostic.createdAt,
        routingReason: diagnostic.routingReason,
        actionable: diagnostic.actionable,
    });
}

function projectProviderSection(models: ReturnType<typeof buildProviders>): SessionExportProviderSection {
    return redactSessionExportValue({
        routingSummary: models.routing.summary,
        fallbackSummary: models.fallback.summary,
        telemetrySummary: models.telemetry.summary,
        diagnosticsSummary: models.diagnostics.summary,
        personalizationSummary: models.personalization.summary,
        activeRoute: models.routing.activeRoute,
        activeTelemetry: models.telemetry.activeEntry,
        activePersonalization: models.personalization.activeEntry,
        routes: models.routing.routes,
        fallbacks: models.fallback.fallbacks.map(projectFallback),
        telemetry: models.telemetry.entries,
        diagnostics: models.diagnostics.diagnostics.map(projectDiagnostic),
        personalization: models.personalization.entries,
    });
}

function projectTimeline(timeline?: DiagramTimeline | null): SessionExportDiagramSection['timeline'] | undefined {
    if (!timeline) return undefined;
    return redactSessionExportValue({
        rootResponseId: timeline.rootResponseId,
        activeVersion: timeline.activeVersion,
        activeVersionCount: timeline.activeVersionCount,
        items: timeline.items.map((item): SessionExportTimelineItem => ({
            version: item.version,
            responseId: item.responseId,
            parentResponseId: item.parentResponseId,
            parentVersion: item.parentVersion,
            rootResponseId: item.rootResponseId,
            rootVersion: item.rootVersion,
            artifactId: item.artifactId,
            createdAt: item.createdAt,
            status: item.status,
            source: item.source,
            hasDiff: item.hasDiff,
            diffSummary: item.diffSummary,
        })),
    });
}

function projectEvolution(summary?: DiagramEvolutionSummary | null): SessionExportEvolutionSummary | undefined {
    if (!summary) return undefined;
    return redactSessionExportValue({
        mode: summary.mode,
        from: summary.from,
        to: summary.to,
        diffSummary: summary.diffSummary,
        changes: summary.changes,
        diffSource: summary.diffSource,
        usedStoredDiff: summary.usedStoredDiff,
        recomputed: summary.recomputed,
        issues: summary.issues,
    });
}

function projectComparison(comparison?: DiagramComparisonReadModel | null): SessionExportComparisonSummary | undefined {
    if (!comparison) return undefined;
    return redactSessionExportValue({
        mode: comparison.mode,
        from: comparison.from,
        to: comparison.to,
        available: comparison.available,
        diffSource: comparison.diffSource,
        usedStoredDiff: comparison.usedStoredDiff,
        recomputed: comparison.recomputed,
        nodeCounts: comparison.nodeCounts,
        edgeCounts: comparison.edgeCounts,
        issues: comparison.issues,
    });
}

function buildDiagramSection(input: BuildSessionExportReadModelInput): SessionExportDiagramSection {
    const evolution = {
        parentCurrent: projectEvolution(input.parentCurrentEvolution),
        rootCurrent: projectEvolution(input.rootCurrentEvolution),
        versionPair: projectEvolution(input.versionPairEvolution),
    };
    const comparisons = {
        parentCurrent: projectComparison(input.parentCurrentComparison),
        rootCurrent: projectComparison(input.rootCurrentComparison),
        versionPair: projectComparison(input.versionPairComparison),
    };

    return redactSessionExportValue({
        timeline: projectTimeline(input.diagramTimeline),
        evolution: Object.values(evolution).some(Boolean) ? evolution : undefined,
        guardrails: input.diagramGuardrails ?? undefined,
        comparisons: Object.values(comparisons).some(Boolean) ? comparisons : undefined,
    });
}

export function buildSessionExportReadModel(input: BuildSessionExportReadModelInput): SessionExportReadModel {
    const activeResponseId = input.activeResponseId ?? null;
    const responses = input.responses.map((response) => buildExportResponse(response, activeResponseId));
    const providers = buildProviders(input);
    const providerSection = projectProviderSection(providers);
    const diagrams = buildDiagramSection(input);
    const generatedAt = inferGeneratedAt(input, responses);
    const artifactCount = responses.reduce((count, response) => count + response.artifactSummary.total, 0);

    return redactSessionExportValue({
        generatedAt,
        privacy: {
            policy: 'allowlist',
            contentIncluded: false,
            excludedFields: SESSION_EXPORT_PRIVACY_EXCLUDED_FIELDS,
            allowlist: SESSION_EXPORT_PRIVACY_ALLOWLIST,
        },
        session: {
            activeResponseId,
            responseCount: responses.length,
            rootResponseIds: buildRootResponseIds(responses),
            firstResponseAt: firstDefinedTimestamp(responses),
            lastResponseAt: lastDefinedTimestamp(responses),
        },
        responses,
        providers: providerSection,
        diagrams,
        personalization: {
            summary: providerSection.personalizationSummary,
            entries: providerSection.personalization,
        },
        summaries: {
            responseCount: responses.length,
            activeResponseId,
            providerRouteCount: providerSection.routes.length,
            fallbackCount: providerSection.fallbacks.length,
            telemetryCount: providerSection.telemetry.length,
            diagnosticsCount: providerSection.diagnostics.length,
            personalizationCount: providerSection.personalization.length,
            diagramVersionCount: diagrams.timeline?.items.length ?? 0,
            artifactCount,
        },
    });
}
