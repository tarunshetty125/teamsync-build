import type { ResponseOwnership } from '../overlay/actionContextTypes';

export type ProviderRoutingSource = 'ownership' | 'debug_metadata' | 'message';

export type ProviderRoutingStatus =
    | 'direct'
    | 'remapped'
    | 'fallback'
    | 'local_fallback'
    | 'cache'
    | 'unknown';

export interface ProviderRoutingMessage {
    id: string;
    requestId?: string;
    provider?: string;
    model?: string;
    intent?: string;
    source?: string;
    timestamp?: number;
    questionTurnId?: string;
    ownership?: Partial<ResponseOwnership>;
    intelligenceMetadata?: unknown;
    debugMetadata?: unknown;
}

export interface ProviderRoutingEntry {
    responseId: string;
    requestId?: string;
    questionTurnId?: string;
    actionId?: string;
    mode?: string;
    createdAt?: number;
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    routingReason?: string;
    routeChanged: boolean;
    fallbackUsed: boolean;
    status: ProviderRoutingStatus;
    source: ProviderRoutingSource;
}

export interface ProviderRoutingSummary {
    totalRoutes: number;
    directCount: number;
    remapCount: number;
    fallbackCount: number;
    localFallbackCount: number;
    cacheCount: number;
    routeChangedCount: number;
    byRequestedProvider: Record<string, number>;
    byActualProvider: Record<string, number>;
    byReason: Record<string, number>;
}

export interface ProviderRoutingReadModel {
    routes: ProviderRoutingEntry[];
    byResponseId: Record<string, ProviderRoutingEntry>;
    activeResponseId?: string;
    activeRoute: ProviderRoutingEntry | null;
    summary: ProviderRoutingSummary;
    generatedAt: number;
}

export interface ProviderRoutingReadModelInput {
    responses: ProviderRoutingMessage[];
    activeResponseId?: string | null;
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

function valuesDiffer(a?: string, b?: string): boolean {
    return Boolean(a && b && a !== b);
}

function isProviderRoutingSourceFromOwnership(ownership?: Partial<ResponseOwnership>): boolean {
    return Boolean(
        ownership?.requestedProvider
        || ownership?.requestedModel
        || ownership?.actualProvider
        || ownership?.actualModel
        || ownership?.routingReason
        || ownership?.sourceProvider
        || ownership?.sourceModel
    );
}

function hasDebugRoutingMetadata(debugMetadata?: unknown): boolean {
    const debug = asRecord(debugMetadata);
    return Boolean(asRecord(debug?.routing) || asRecord(debug?.telemetry));
}

function readFallbackUsed(debugMetadata?: unknown, reason?: string, actualProvider?: string, actualModel?: string): boolean {
    const debug = asRecord(debugMetadata);
    const telemetry = asRecord(debug?.telemetry);
    const fallbackChain = Array.isArray(debug?.fallbackChain) ? debug.fallbackChain : [];
    const normalizedReason = (reason || '').toLowerCase();
    return telemetry?.fallbackUsed === true
        || normalizedReason.includes('fallback')
        || actualProvider === 'local'
        || actualModel === 'safe_action_fallback'
        || fallbackChain.some((entry) => asRecord(entry)?.result === 'failure');
}

function shouldKeepReason(reason: string | undefined, routeChanged: boolean, fallbackUsed: boolean): boolean {
    return Boolean(reason && (routeChanged || fallbackUsed || reason !== 'requested_model'));
}

function deriveStatus(args: {
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    routingReason?: string;
    routeChanged: boolean;
    fallbackUsed: boolean;
}): ProviderRoutingStatus {
    if (!args.requestedProvider && !args.requestedModel && !args.actualProvider && !args.actualModel) {
        return 'unknown';
    }

    if (args.actualProvider === 'cache' || args.actualModel === 'cache_hit') {
        return 'cache';
    }

    if (args.actualProvider === 'local' || args.actualModel === 'safe_action_fallback') {
        return 'local_fallback';
    }

    if (args.fallbackUsed) {
        return 'fallback';
    }

    if (args.routeChanged) {
        return 'remapped';
    }

    return 'direct';
}

function increment(map: Record<string, number>, key?: string): void {
    if (!key) return;
    map[key] = (map[key] ?? 0) + 1;
}

function buildRoutingEntry(message: ProviderRoutingMessage): ProviderRoutingEntry {
    const debugMetadata = message.intelligenceMetadata ?? message.debugMetadata;
    const debug = asRecord(debugMetadata);
    const routing = asRecord(debug?.routing);
    const telemetry = asRecord(debug?.telemetry);
    const ownership = message.ownership;

    const requestedProvider =
        ownership?.requestedProvider
        ?? readString(routing, 'requestedProvider')
        ?? readString(telemetry, 'selectedProvider')
        ?? ownership?.sourceProvider
        ?? message.provider;
    const requestedModel =
        ownership?.requestedModel
        ?? readString(routing, 'requestedModel')
        ?? readString(telemetry, 'selectedModel')
        ?? ownership?.sourceModel
        ?? message.model;
    const actualProvider =
        ownership?.actualProvider
        ?? readString(routing, 'actualProvider')
        ?? readString(telemetry, 'actualInvokedProvider')
        ?? requestedProvider;
    const actualModel =
        ownership?.actualModel
        ?? readString(routing, 'actualModel')
        ?? readString(telemetry, 'actualInvokedModel')
        ?? requestedModel;
    const rawReason =
        ownership?.routingReason
        ?? readString(routing, 'reason')
        ?? readString(telemetry, 'fallbackReason');
    const routeChanged = Boolean(
        valuesDiffer(requestedProvider, actualProvider)
        || valuesDiffer(requestedModel, actualModel)
        || (rawReason && rawReason !== 'requested_model')
    );
    const fallbackUsed = readFallbackUsed(debugMetadata, rawReason, actualProvider, actualModel);
    const routingReason = shouldKeepReason(rawReason, routeChanged, fallbackUsed) ? rawReason : undefined;
    const status = deriveStatus({
        requestedProvider,
        requestedModel,
        actualProvider,
        actualModel,
        routingReason,
        routeChanged,
        fallbackUsed,
    });
    const source: ProviderRoutingSource = isProviderRoutingSourceFromOwnership(ownership)
        ? 'ownership'
        : hasDebugRoutingMetadata(debugMetadata)
            ? 'debug_metadata'
            : 'message';

    return {
        responseId: ownership?.responseId ?? message.id,
        ...(message.requestId ? { requestId: message.requestId } : {}),
        questionTurnId: ownership?.questionTurnId ?? message.questionTurnId,
        actionId: ownership?.actionId ?? message.intent ?? message.source,
        mode: ownership?.mode,
        createdAt: ownership?.createdAt ?? message.timestamp,
        requestedProvider,
        requestedModel,
        actualProvider,
        actualModel,
        routingReason,
        routeChanged,
        fallbackUsed,
        status,
        source,
    };
}

function buildSummary(routes: ProviderRoutingEntry[]): ProviderRoutingSummary {
    const byRequestedProvider: Record<string, number> = {};
    const byActualProvider: Record<string, number> = {};
    const byReason: Record<string, number> = {};

    for (const route of routes) {
        increment(byRequestedProvider, route.requestedProvider);
        increment(byActualProvider, route.actualProvider);
        increment(byReason, route.routingReason);
    }

    return {
        totalRoutes: routes.length,
        directCount: routes.filter((route) => route.status === 'direct').length,
        remapCount: routes.filter((route) => route.status === 'remapped').length,
        fallbackCount: routes.filter((route) => route.status === 'fallback' || route.status === 'local_fallback').length,
        localFallbackCount: routes.filter((route) => route.status === 'local_fallback').length,
        cacheCount: routes.filter((route) => route.status === 'cache').length,
        routeChangedCount: routes.filter((route) => route.routeChanged).length,
        byRequestedProvider,
        byActualProvider,
        byReason,
    };
}

export function buildProviderRoutingReadModel(input: ProviderRoutingReadModelInput): ProviderRoutingReadModel {
    const routes = input.responses.map(buildRoutingEntry);
    const byResponseId = Object.fromEntries(
        routes.map((route) => [route.responseId, route]),
    ) as Record<string, ProviderRoutingEntry>;
    const activeResponseId = input.activeResponseId ?? undefined;

    return {
        routes,
        byResponseId,
        activeResponseId,
        activeRoute: activeResponseId ? byResponseId[activeResponseId] ?? null : null,
        summary: buildSummary(routes),
        generatedAt: input.now ?? Date.now(),
    };
}
