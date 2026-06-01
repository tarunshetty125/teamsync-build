import {
    buildProviderRoutingReadModel,
    type ProviderRoutingEntry,
    type ProviderRoutingMessage,
} from './providerRoutingReadModel';

export type ProviderFallbackCategory =
    | 'auth_expired'
    | 'auth_failed'
    | 'rate_limited'
    | 'timeout'
    | 'model_unavailable'
    | 'provider_unavailable'
    | 'validation_failed'
    | 'safe_fallback'
    | 'all_attempts_failed'
    | 'unknown';

export type ProviderFallbackAttemptResult = 'success' | 'failure' | 'skipped';

export type ProviderFallbackSource = 'debug_metadata' | 'routing' | 'ownership';

export interface ProviderFallbackAttempt {
    provider?: string;
    model?: string;
    result: ProviderFallbackAttemptResult;
    reason?: string;
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
}

export interface ProviderFallbackEntry {
    responseId: string;
    requestId?: string;
    questionTurnId?: string;
    actionId?: string;
    createdAt?: number;
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    fallbackReason?: string;
    category: ProviderFallbackCategory;
    safeFallback: boolean;
    providerFallback: boolean;
    validationFallback: boolean;
    attempts: ProviderFallbackAttempt[];
    failedAttemptCount: number;
    successfulAttempt?: ProviderFallbackAttempt;
    source: ProviderFallbackSource;
}

export interface ProviderFallbackSummary {
    totalFallbacks: number;
    providerFallbackCount: number;
    safeFallbackCount: number;
    validationFallbackCount: number;
    failedAttemptCount: number;
    successfulFallbackCount: number;
    byCategory: Record<string, number>;
    byRequestedProvider: Record<string, number>;
    byActualProvider: Record<string, number>;
    byReason: Record<string, number>;
}

export interface ProviderFallbackReadModel {
    fallbacks: ProviderFallbackEntry[];
    byResponseId: Record<string, ProviderFallbackEntry>;
    activeResponseId?: string;
    activeFallback: ProviderFallbackEntry | null;
    summary: ProviderFallbackSummary;
    generatedAt: number;
}

export interface ProviderFallbackReadModelInput {
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

function readNumber(record: UnknownRecord | undefined, key: string): number | undefined {
    const value = record?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: UnknownRecord | undefined, key: string): boolean | undefined {
    const value = record?.[key];
    return typeof value === 'boolean' ? value : undefined;
}

function normalizeReason(value?: string): string {
    return (value ?? '').trim().toLowerCase();
}

function includesAny(value: string, patterns: string[]): boolean {
    return patterns.some((pattern) => value.includes(pattern));
}

function increment(map: Record<string, number>, key?: string): void {
    if (!key) return;
    map[key] = (map[key] ?? 0) + 1;
}

function hasEntries(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
}

function normalizeAttemptResult(value: unknown): ProviderFallbackAttemptResult {
    if (value === 'success' || value === 'failure' || value === 'skipped') {
        return value;
    }

    if (value === true) return 'success';
    if (value === false) return 'failure';

    return 'failure';
}

function buildAttempt(entry: unknown): ProviderFallbackAttempt | undefined {
    const record = asRecord(entry);
    if (!record) return undefined;

    const startedAt = readNumber(record, 'startedAt');
    const completedAt = readNumber(record, 'completedAt');
    const durationMs = readNumber(record, 'durationMs')
        ?? (
            startedAt !== undefined
            && completedAt !== undefined
            && completedAt >= startedAt
                ? completedAt - startedAt
                : undefined
        );

    return {
        provider: readString(record, 'provider'),
        model: readString(record, 'model'),
        result: normalizeAttemptResult(record.result ?? record.status ?? record.ok),
        reason: readString(record, 'reason') ?? readString(record, 'error') ?? readString(record, 'message'),
        startedAt,
        completedAt,
        durationMs,
    };
}

function readAttempts(debugMetadata?: unknown): ProviderFallbackAttempt[] {
    const debug = asRecord(debugMetadata);
    const routing = asRecord(debug?.routing);
    const telemetry = asRecord(debug?.telemetry);
    const fallback = asRecord(debug?.fallback);
    const candidates = [
        debug?.fallbackChain,
        debug?.fallbackAttempts,
        routing?.fallbackChain,
        telemetry?.fallbackChain,
        fallback?.attempts,
    ];

    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        return candidate
            .map(buildAttempt)
            .filter((attempt): attempt is ProviderFallbackAttempt => Boolean(attempt));
    }

    return [];
}

function readFallbackReason(route: ProviderRoutingEntry, debugMetadata?: unknown): string | undefined {
    const debug = asRecord(debugMetadata);
    const routing = asRecord(debug?.routing);
    const telemetry = asRecord(debug?.telemetry);
    const fallback = asRecord(debug?.fallback);
    return route.routingReason
        ?? readString(telemetry, 'fallbackReason')
        ?? readString(routing, 'reason')
        ?? readString(fallback, 'reason')
        ?? readString(debug, 'fallbackReason');
}

function hasExplicitFallbackMetadata(debugMetadata?: unknown): boolean {
    const debug = asRecord(debugMetadata);
    if (!debug) return false;

    const routing = asRecord(debug.routing);
    const telemetry = asRecord(debug.telemetry);
    const fallback = asRecord(debug.fallback);
    return readBoolean(telemetry, 'fallbackUsed') === true
        || readBoolean(fallback, 'used') === true
        || hasEntries(debug.fallbackChain)
        || hasEntries(debug.fallbackAttempts)
        || hasEntries(routing?.fallbackChain)
        || hasEntries(telemetry?.fallbackChain)
        || hasEntries(fallback?.attempts)
        || Boolean(readString(debug, 'fallbackReason'));
}

function hasValidationFailureMetadata(debugMetadata?: unknown): boolean {
    const debug = asRecord(debugMetadata);
    const validation = asRecord(debug?.validation) ?? asRecord(debug?.validator);
    const repair = asRecord(debug?.repair);
    return readBoolean(validation, 'valid') === false
        || readBoolean(validation, 'passed') === false
        || readBoolean(repair, 'succeeded') === false
        || Boolean(readString(validation, 'reason') || readString(repair, 'reason'));
}

function isFallbackRoute(route: ProviderRoutingEntry, attempts: ProviderFallbackAttempt[], debugMetadata?: unknown): boolean {
    if (route.status === 'cache') return hasExplicitFallbackMetadata(debugMetadata);
    return route.fallbackUsed
        || route.status === 'fallback'
        || route.status === 'local_fallback'
        || hasExplicitFallbackMetadata(debugMetadata)
        || attempts.some((attempt) => attempt.result === 'failure');
}

function isSafeFallback(route: ProviderRoutingEntry, reason?: string): boolean {
    const normalizedReason = normalizeReason(reason);
    return route.status === 'local_fallback'
        || route.actualProvider === 'local'
        || route.actualModel === 'safe_action_fallback'
        || includesAny(normalizedReason, ['safe_action_fallback', 'safe fallback']);
}

function isValidationFallback(reason?: string, debugMetadata?: unknown): boolean {
    const normalizedReason = normalizeReason(reason);
    return hasValidationFailureMetadata(debugMetadata)
        || includesAny(normalizedReason, [
            'validation',
            'validator',
            'contract',
            'repair_invalid',
            'repair_empty',
            'invalid_output',
            'invalid output',
            'unreliable response',
            'reliable response',
        ]);
}

function classifyFallbackCategory(args: {
    reason?: string;
    route: ProviderRoutingEntry;
    validationFallback: boolean;
    safeFallback: boolean;
}): ProviderFallbackCategory {
    const reason = normalizeReason(args.reason);

    if (includesAny(reason, ['bedrock_auth_expired', 'session expired', 'sso session', 'expired token', 'reauth'])) {
        return 'auth_expired';
    }

    if (includesAny(reason, ['unauthorized', 'forbidden', 'authentication', 'credential', 'api key', 'access denied'])) {
        return 'auth_failed';
    }

    if (includesAny(reason, ['rate limit', 'rate_limited', '429', 'quota', 'too many requests'])) {
        return 'rate_limited';
    }

    if (includesAny(reason, ['timeout', 'timed out', 'stream timeout'])) {
        return 'timeout';
    }

    if (args.validationFallback) {
        return 'validation_failed';
    }

    if (includesAny(reason, ['model unavailable', 'unavailable model', 'model_not_available', 'model access', 'no bedrock model selected'])) {
        return 'model_unavailable';
    }

    if (includesAny(reason, ['provider unavailable', 'provider_unavailable', 'network', 'fetch failed', 'econn', 'service unavailable'])) {
        return 'provider_unavailable';
    }

    if (args.safeFallback) {
        return 'safe_fallback';
    }

    if (includesAny(reason, ['all_attempts_failed', 'all attempts failed'])) {
        return 'all_attempts_failed';
    }

    return 'unknown';
}

function buildFallbackEntry(
    message: ProviderRoutingMessage,
    route: ProviderRoutingEntry,
): ProviderFallbackEntry | undefined {
    const debugMetadata = message.intelligenceMetadata ?? message.debugMetadata;
    const attempts = readAttempts(debugMetadata);

    if (!isFallbackRoute(route, attempts, debugMetadata)) {
        return undefined;
    }

    const fallbackReason = readFallbackReason(route, debugMetadata);
    const safeFallback = isSafeFallback(route, fallbackReason);
    const validationFallback = isValidationFallback(fallbackReason, debugMetadata);
    const category = classifyFallbackCategory({
        reason: fallbackReason,
        route,
        validationFallback,
        safeFallback,
    });
    const failedAttemptCount = attempts.filter((attempt) => attempt.result === 'failure').length;
    const successfulAttempt = attempts.find((attempt) => attempt.result === 'success');
    const providerFallback = Boolean(
        !validationFallback
        && (
            route.status === 'fallback'
            || route.status === 'local_fallback'
            || route.routeChanged
            || failedAttemptCount > 0
        )
    );
    const source: ProviderFallbackSource = hasExplicitFallbackMetadata(debugMetadata)
        ? 'debug_metadata'
        : route.source === 'ownership'
            ? 'ownership'
            : 'routing';

    return {
        responseId: route.responseId,
        requestId: route.requestId ?? message.requestId,
        questionTurnId: route.questionTurnId ?? message.questionTurnId,
        actionId: route.actionId,
        createdAt: route.createdAt ?? message.timestamp,
        requestedProvider: route.requestedProvider,
        requestedModel: route.requestedModel,
        actualProvider: route.actualProvider,
        actualModel: route.actualModel,
        fallbackReason,
        category,
        safeFallback,
        providerFallback,
        validationFallback,
        attempts,
        failedAttemptCount,
        successfulAttempt,
        source,
    };
}

function buildSummary(fallbacks: ProviderFallbackEntry[]): ProviderFallbackSummary {
    const byCategory: Record<string, number> = {};
    const byRequestedProvider: Record<string, number> = {};
    const byActualProvider: Record<string, number> = {};
    const byReason: Record<string, number> = {};

    for (const fallback of fallbacks) {
        increment(byCategory, fallback.category);
        increment(byRequestedProvider, fallback.requestedProvider);
        increment(byActualProvider, fallback.actualProvider);
        increment(byReason, fallback.fallbackReason);
    }

    return {
        totalFallbacks: fallbacks.length,
        providerFallbackCount: fallbacks.filter((fallback) => fallback.providerFallback).length,
        safeFallbackCount: fallbacks.filter((fallback) => fallback.safeFallback).length,
        validationFallbackCount: fallbacks.filter((fallback) => fallback.validationFallback).length,
        failedAttemptCount: fallbacks.reduce((count, fallback) => count + fallback.failedAttemptCount, 0),
        successfulFallbackCount: fallbacks.filter((fallback) => Boolean(fallback.successfulAttempt)).length,
        byCategory,
        byRequestedProvider,
        byActualProvider,
        byReason,
    };
}

export function buildProviderFallbackReadModel(input: ProviderFallbackReadModelInput): ProviderFallbackReadModel {
    const routing = buildProviderRoutingReadModel({
        responses: input.responses,
        activeResponseId: input.activeResponseId,
        now: input.now,
    });
    const fallbacks = input.responses
        .map((message) => {
            const responseId = message.ownership?.responseId ?? message.id;
            const route = routing.byResponseId[responseId];
            return route ? buildFallbackEntry(message, route) : undefined;
        })
        .filter((fallback): fallback is ProviderFallbackEntry => Boolean(fallback));
    const byResponseId = Object.fromEntries(
        fallbacks.map((fallback) => [fallback.responseId, fallback]),
    ) as Record<string, ProviderFallbackEntry>;
    const activeResponseId = input.activeResponseId ?? undefined;

    return {
        fallbacks,
        byResponseId,
        activeResponseId,
        activeFallback: activeResponseId ? byResponseId[activeResponseId] ?? null : null,
        summary: buildSummary(fallbacks),
        generatedAt: input.now ?? Date.now(),
    };
}
