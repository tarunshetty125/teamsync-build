import {
    type ProviderHealthDiagnosticCategory,
    type ProviderHealthEntry,
    type ProviderHealthProviderId,
    type ProviderHealthReadModel,
} from './providerHealthReadModel';
import {
    buildProviderRoutingReadModel,
    type ProviderRoutingEntry,
    type ProviderRoutingMessage,
} from './providerRoutingReadModel';
import {
    buildProviderFallbackReadModel,
    type ProviderFallbackCategory,
    type ProviderFallbackEntry,
} from './providerFallbackReadModel';
import {
    buildProviderTelemetryReadModel,
    type ProviderTelemetryEntry,
} from './providerTelemetryReadModel';

export type ProviderDiagnosticSeverity = 'info' | 'warning' | 'error';

export type ProviderDiagnosticCategory =
    | 'not_configured'
    | 'auth_expired'
    | 'auth_failed'
    | 'rate_limited'
    | 'provider_unavailable'
    | 'model_unavailable'
    | 'no_available_keys'
    | 'cooldown'
    | 'invalid_keys'
    | 'fallback_activated'
    | 'safe_fallback'
    | 'validation_failed'
    | 'routing_remap'
    | 'request_failed'
    | 'request_cancelled'
    | 'unknown';

export type ProviderDiagnosticSource = 'health' | 'routing' | 'fallback' | 'telemetry';

export interface ProviderDiagnosticEntry {
    id: string;
    responseId?: string;
    requestId?: string;
    questionTurnId?: string;
    actionId?: string;
    provider?: string;
    model?: string;
    category: ProviderDiagnosticCategory;
    severity: ProviderDiagnosticSeverity;
    title: string;
    message: string;
    source: ProviderDiagnosticSource;
    createdAt?: number;
    routingReason?: string;
    actionable: boolean;
    actionLabel?: string;
}

export interface ProviderDiagnosticsSummary {
    totalDiagnostics: number;
    infoCount: number;
    warningCount: number;
    errorCount: number;
    actionableCount: number;
    byCategory: Record<string, number>;
    byProvider: Record<string, number>;
    bySource: Record<string, number>;
}

export interface ProviderDiagnosticsReadModel {
    diagnostics: ProviderDiagnosticEntry[];
    byId: Record<string, ProviderDiagnosticEntry>;
    byResponseId: Record<string, ProviderDiagnosticEntry[]>;
    byProvider: Record<string, ProviderDiagnosticEntry[]>;
    activeResponseId?: string;
    activeDiagnostics: ProviderDiagnosticEntry[];
    summary: ProviderDiagnosticsSummary;
    generatedAt: number;
}

export interface ProviderDiagnosticsReadModelInput {
    responses?: ProviderRoutingMessage[];
    activeResponseId?: string | null;
    health?: ProviderHealthReadModel | null;
    now?: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function readString(record: UnknownRecord | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function increment(map: Record<string, number>, key?: string): void {
    if (!key) return;
    map[key] = (map[key] ?? 0) + 1;
}

function providerDisplay(value?: string): string {
    if (!value) return 'Provider';
    if (value === 'bedrock') return 'Amazon Bedrock';
    if (value === 'groq') return 'Groq';
    if (value === 'gemini') return 'Gemini';
    if (value === 'openai') return 'OpenAI';
    if (value === 'claude') return 'Claude';
    if (value === 'ollama') return 'Ollama';
    if (value === 'local') return 'Local fallback';
    return value;
}

function modelDisplay(value?: string): string {
    return value ? ` (${value})` : '';
}

function isRoutineHealthDiagnostic(category: ProviderHealthDiagnosticCategory): boolean {
    return (
        category === 'ok'
        || category === 'configured'
        || category === 'checking'
        || category === 'connection_success'
    );
}

function mapHealthCategory(category: ProviderHealthDiagnosticCategory): ProviderDiagnosticCategory {
    if (category === 'connection_failed' || category === 'ollama_unavailable') return 'provider_unavailable';
    if (category === 'model_fetch_failed') return 'model_unavailable';
    if (category === 'auth_expired') return 'auth_expired';
    if (category === 'auth_failed') return 'auth_failed';
    if (category === 'rate_limited') return 'rate_limited';
    if (category === 'provider_unavailable') return 'provider_unavailable';
    if (category === 'no_available_keys') return 'no_available_keys';
    if (category === 'cooldown') return 'cooldown';
    if (category === 'invalid_keys') return 'invalid_keys';
    if (category === 'not_configured') return 'not_configured';
    return 'unknown';
}

function mapFallbackCategory(category: ProviderFallbackCategory): ProviderDiagnosticCategory {
    if (category === 'auth_expired') return 'auth_expired';
    if (category === 'auth_failed') return 'auth_failed';
    if (category === 'rate_limited') return 'rate_limited';
    if (category === 'timeout') return 'provider_unavailable';
    if (category === 'model_unavailable') return 'model_unavailable';
    if (category === 'provider_unavailable') return 'provider_unavailable';
    if (category === 'validation_failed') return 'validation_failed';
    if (category === 'safe_fallback') return 'safe_fallback';
    return 'fallback_activated';
}

function severityForCategory(category: ProviderDiagnosticCategory): ProviderDiagnosticSeverity {
    if (
        category === 'auth_expired'
        || category === 'auth_failed'
        || category === 'provider_unavailable'
        || category === 'model_unavailable'
        || category === 'no_available_keys'
        || category === 'invalid_keys'
        || category === 'safe_fallback'
        || category === 'validation_failed'
        || category === 'request_failed'
    ) {
        return 'error';
    }

    if (
        category === 'not_configured'
        || category === 'rate_limited'
        || category === 'cooldown'
        || category === 'fallback_activated'
    ) {
        return 'warning';
    }

    return 'info';
}

function isActionable(category: ProviderDiagnosticCategory): boolean {
    return (
        category === 'not_configured'
        || category === 'auth_expired'
        || category === 'auth_failed'
        || category === 'provider_unavailable'
        || category === 'model_unavailable'
        || category === 'no_available_keys'
        || category === 'invalid_keys'
        || category === 'safe_fallback'
        || category === 'validation_failed'
    );
}

function actionLabelFor(category: ProviderDiagnosticCategory, provider?: string): string | undefined {
    if (category === 'auth_expired' && provider === 'bedrock') return 'Re-authenticate AWS';
    if (category === 'auth_failed') return 'Check credentials';
    if (category === 'not_configured') return 'Configure provider';
    if (category === 'model_unavailable') return 'Check model access';
    if (category === 'provider_unavailable') return 'Check provider status';
    if (category === 'no_available_keys' || category === 'invalid_keys') return 'Review API keys';
    if (category === 'safe_fallback') return 'Review fallback chain';
    if (category === 'validation_failed') return 'Review contract output';
    return undefined;
}

function buildHealthTitle(category: ProviderDiagnosticCategory, provider: ProviderHealthProviderId): string {
    if (category === 'auth_expired' && provider === 'bedrock') return 'AWS session expired';
    if (category === 'auth_failed') return `${providerDisplay(provider)} authentication failed`;
    if (category === 'not_configured') return `${providerDisplay(provider)} is not configured`;
    if (category === 'model_unavailable') return `${providerDisplay(provider)} model discovery failed`;
    if (category === 'provider_unavailable') return `${providerDisplay(provider)} is unavailable`;
    if (category === 'rate_limited') return `${providerDisplay(provider)} is rate limited`;
    if (category === 'no_available_keys') return `${providerDisplay(provider)} has no available keys`;
    if (category === 'invalid_keys') return `${providerDisplay(provider)} key pool is degraded`;
    if (category === 'cooldown') return `${providerDisplay(provider)} keys are cooling down`;
    return `${providerDisplay(provider)} diagnostic`;
}

function buildHealthDiagnostics(health?: ProviderHealthReadModel | null): ProviderDiagnosticEntry[] {
    if (!health) return [];

    return health.orderedProviders
        .map((entry: ProviderHealthEntry): ProviderDiagnosticEntry | undefined => {
            const diagnostic = entry.lastDiagnostic;
            if (!diagnostic || isRoutineHealthDiagnostic(diagnostic.category)) return undefined;

            const category = mapHealthCategory(diagnostic.category);
            const severity = severityForCategory(category);
            return {
                id: `health:${entry.provider}:${category}:${diagnostic.at ?? health.generatedAt}`,
                provider: entry.provider,
                category,
                severity,
                title: buildHealthTitle(category, entry.provider),
                message: diagnostic.message,
                source: 'health',
                createdAt: diagnostic.at ?? health.generatedAt,
                actionable: isActionable(category),
                actionLabel: actionLabelFor(category, entry.provider),
            };
        })
        .filter((diagnostic): diagnostic is ProviderDiagnosticEntry => Boolean(diagnostic));
}

function buildFallbackTitle(fallback: ProviderFallbackEntry, category: ProviderDiagnosticCategory): string {
    if (category === 'auth_expired' && fallback.requestedProvider === 'bedrock') return 'AWS session expired before fallback';
    if (category === 'validation_failed') return 'Provider output failed validation';
    if (category === 'safe_fallback') return 'Safe fallback response used';
    if (category === 'rate_limited') return `${providerDisplay(fallback.requestedProvider)} rate limit triggered fallback`;
    if (category === 'provider_unavailable') return `${providerDisplay(fallback.requestedProvider)} unavailable during generation`;
    if (category === 'model_unavailable') return `${providerDisplay(fallback.requestedProvider)} model unavailable`;
    return 'Provider fallback activated';
}

function buildFallbackMessage(fallback: ProviderFallbackEntry): string {
    const requested = `${providerDisplay(fallback.requestedProvider)}${modelDisplay(fallback.requestedModel)}`;
    const actual = `${providerDisplay(fallback.actualProvider)}${modelDisplay(fallback.actualModel)}`;
    const reason = fallback.fallbackReason ? ` Reason: ${fallback.fallbackReason}.` : '';
    return `${requested} routed to ${actual}.${reason}`;
}

function buildFallbackDiagnostic(fallback: ProviderFallbackEntry): ProviderDiagnosticEntry {
    const category = mapFallbackCategory(fallback.category);
    const provider = fallback.requestedProvider ?? fallback.actualProvider;
    const severity = severityForCategory(category);
    return {
        id: `fallback:${fallback.responseId}:${category}:${fallback.createdAt ?? 0}`,
        responseId: fallback.responseId,
        requestId: fallback.requestId,
        questionTurnId: fallback.questionTurnId,
        actionId: fallback.actionId,
        provider,
        model: fallback.requestedModel ?? fallback.actualModel,
        category,
        severity,
        title: buildFallbackTitle(fallback, category),
        message: buildFallbackMessage(fallback),
        source: 'fallback',
        createdAt: fallback.createdAt,
        routingReason: fallback.fallbackReason,
        actionable: isActionable(category),
        actionLabel: actionLabelFor(category, provider),
    };
}

function buildRoutingRemapDiagnostic(route: ProviderRoutingEntry): ProviderDiagnosticEntry | undefined {
    if (route.status !== 'remapped') return undefined;

    return {
        id: `routing:${route.responseId}:routing_remap:${route.createdAt ?? 0}`,
        responseId: route.responseId,
        requestId: route.requestId,
        questionTurnId: route.questionTurnId,
        actionId: route.actionId,
        provider: route.requestedProvider ?? route.actualProvider,
        model: route.requestedModel ?? route.actualModel,
        category: 'routing_remap',
        severity: 'info',
        title: 'Provider routing changed',
        message: `${providerDisplay(route.requestedProvider)}${modelDisplay(route.requestedModel)} routed to ${providerDisplay(route.actualProvider)}${modelDisplay(route.actualModel)}.`,
        source: 'routing',
        createdAt: route.createdAt,
        routingReason: route.routingReason,
        actionable: false,
    };
}

function readDebugMetadata(message: ProviderRoutingMessage): UnknownRecord | undefined {
    return asRecord(message.intelligenceMetadata ?? message.debugMetadata);
}

function readTelemetryError(message: ProviderRoutingMessage): string | undefined {
    const messageRecord = message as unknown as UnknownRecord;
    const debug = readDebugMetadata(message);
    const telemetry = asRecord(debug?.telemetry);
    return readString(messageRecord, 'error')
        ?? readString(telemetry, 'error')
        ?? readString(debug, 'error');
}

function buildTelemetryDiagnostic(entry: ProviderTelemetryEntry, message: ProviderRoutingMessage): ProviderDiagnosticEntry | undefined {
    if (entry.status === 'cancelled') {
        return {
            id: `telemetry:${entry.responseId}:request_cancelled:${entry.createdAt ?? 0}`,
            responseId: entry.responseId,
            requestId: entry.requestId,
            questionTurnId: entry.questionTurnId,
            actionId: entry.actionId,
            provider: entry.actualProvider ?? entry.requestedProvider,
            model: entry.actualModel ?? entry.requestedModel,
            category: 'request_cancelled',
            severity: 'info',
            title: 'Provider request cancelled',
            message: `${providerDisplay(entry.actualProvider ?? entry.requestedProvider)} request was cancelled before completion.`,
            source: 'telemetry',
            createdAt: entry.createdAt,
            actionable: false,
        };
    }

    if (entry.status !== 'failure') return undefined;

    const provider = entry.actualProvider ?? entry.requestedProvider;
    const error = readTelemetryError(message);
    return {
        id: `telemetry:${entry.responseId}:request_failed:${entry.createdAt ?? 0}`,
        responseId: entry.responseId,
        requestId: entry.requestId,
        questionTurnId: entry.questionTurnId,
        actionId: entry.actionId,
        provider,
        model: entry.actualModel ?? entry.requestedModel,
        category: 'request_failed',
        severity: 'error',
        title: 'Provider request failed',
        message: error
            ? `${providerDisplay(provider)} request failed: ${error}.`
            : `${providerDisplay(provider)} request failed before a reliable response was produced.`,
        source: 'telemetry',
        createdAt: entry.createdAt,
        actionable: true,
        actionLabel: 'Review provider logs',
    };
}

function buildResponseDiagnostics(input: {
    responses: ProviderRoutingMessage[];
    routes: Record<string, ProviderRoutingEntry>;
    fallbacks: Record<string, ProviderFallbackEntry>;
    telemetry: Record<string, ProviderTelemetryEntry>;
}): ProviderDiagnosticEntry[] {
    const diagnostics: ProviderDiagnosticEntry[] = [];

    for (const message of input.responses) {
        const responseId = message.ownership?.responseId ?? message.id;
        const route = input.routes[responseId];
        const fallback = input.fallbacks[responseId];
        const telemetry = input.telemetry[responseId];

        if (fallback) {
            diagnostics.push(buildFallbackDiagnostic(fallback));
        } else if (route) {
            const routingDiagnostic = buildRoutingRemapDiagnostic(route);
            if (routingDiagnostic) diagnostics.push(routingDiagnostic);
        }

        if (telemetry && !fallback) {
            const telemetryDiagnostic = buildTelemetryDiagnostic(telemetry, message);
            if (telemetryDiagnostic) diagnostics.push(telemetryDiagnostic);
        }
    }

    return diagnostics;
}

function groupDiagnostics(
    diagnostics: ProviderDiagnosticEntry[],
    getKey: (diagnostic: ProviderDiagnosticEntry) => string | undefined,
): Record<string, ProviderDiagnosticEntry[]> {
    const groups = new Map<string, ProviderDiagnosticEntry[]>();
    for (const diagnostic of diagnostics) {
        const key = getKey(diagnostic);
        if (!key) continue;
        const group = groups.get(key) ?? [];
        group.push(diagnostic);
        groups.set(key, group);
    }

    return Object.fromEntries(groups.entries()) as Record<string, ProviderDiagnosticEntry[]>;
}

function buildSummary(diagnostics: ProviderDiagnosticEntry[]): ProviderDiagnosticsSummary {
    const byCategory: Record<string, number> = {};
    const byProvider: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    for (const diagnostic of diagnostics) {
        increment(byCategory, diagnostic.category);
        increment(byProvider, diagnostic.provider);
        increment(bySource, diagnostic.source);
    }

    return {
        totalDiagnostics: diagnostics.length,
        infoCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length,
        warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
        errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
        actionableCount: diagnostics.filter((diagnostic) => diagnostic.actionable).length,
        byCategory,
        byProvider,
        bySource,
    };
}

export function buildProviderDiagnosticsReadModel(input: ProviderDiagnosticsReadModelInput): ProviderDiagnosticsReadModel {
    const responses = input.responses ?? [];
    const routing = buildProviderRoutingReadModel({
        responses,
        activeResponseId: input.activeResponseId,
        now: input.now,
    });
    const fallback = buildProviderFallbackReadModel({
        responses,
        activeResponseId: input.activeResponseId,
        now: input.now,
    });
    const telemetry = buildProviderTelemetryReadModel({
        responses,
        activeResponseId: input.activeResponseId,
        now: input.now,
    });
    const diagnostics = [
        ...buildHealthDiagnostics(input.health),
        ...buildResponseDiagnostics({
            responses,
            routes: routing.byResponseId,
            fallbacks: fallback.byResponseId,
            telemetry: telemetry.byResponseId,
        }),
    ];
    const byId = Object.fromEntries(
        diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]),
    ) as Record<string, ProviderDiagnosticEntry>;
    const byResponseId = groupDiagnostics(diagnostics, (diagnostic) => diagnostic.responseId);
    const byProvider = groupDiagnostics(diagnostics, (diagnostic) => diagnostic.provider);
    const activeResponseId = input.activeResponseId ?? undefined;

    return {
        diagnostics,
        byId,
        byResponseId,
        byProvider,
        activeResponseId,
        activeDiagnostics: activeResponseId ? byResponseId[activeResponseId] ?? [] : [],
        summary: buildSummary(diagnostics),
        generatedAt: input.now ?? Date.now(),
    };
}
