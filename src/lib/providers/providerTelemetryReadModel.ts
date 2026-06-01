import {
    buildProviderRoutingReadModel,
    type ProviderRoutingEntry,
    type ProviderRoutingMessage,
} from './providerRoutingReadModel';
import {
    buildProviderFallbackReadModel,
    type ProviderFallbackEntry,
} from './providerFallbackReadModel';

export type ProviderTelemetryStatus = 'success' | 'failure' | 'streaming' | 'cancelled' | 'unknown';

export type ProviderTelemetrySource = 'debug_metadata' | 'benchmark' | 'ownership' | 'message';

export interface ProviderTelemetryBenchmarkRecord {
    id: string;
    timestamp?: number;
    model?: string;
    provider?: string;
    mode?: string;
    intent?: string;
    latencyMs?: number;
    totalLatencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    responseLength?: number;
    cacheHit?: boolean;
    fallbackUsed?: boolean;
    retryCount?: number;
    structuredOutputCompliant?: boolean;
}

export interface ProviderTelemetryEntry {
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
    status: ProviderTelemetryStatus;
    latencyMs?: number;
    totalLatencyMs?: number;
    startedAt?: number;
    completedAt?: number;
    retryCount: number;
    fallbackUsed: boolean;
    cacheHit: boolean;
    streamingStarted: boolean;
    streamingCompleted: boolean;
    cancelled: boolean;
    validationPassed?: boolean;
    promptTokens?: number;
    completionTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    responseLength?: number;
    source: ProviderTelemetrySource;
}

export interface ProviderTelemetryBucket {
    requestCount: number;
    successCount: number;
    failureCount: number;
    streamingCount: number;
    cancelledCount: number;
    fallbackCount: number;
    cacheHitCount: number;
    retryCount: number;
    avgLatencyMs: number | null;
    avgTotalLatencyMs: number | null;
}

export interface ProviderTelemetrySummary extends ProviderTelemetryBucket {
    byStatus: Record<string, number>;
    byProvider: Record<string, ProviderTelemetryBucket>;
    byModel: Record<string, ProviderTelemetryBucket>;
}

export interface ProviderTelemetryReadModel {
    entries: ProviderTelemetryEntry[];
    byResponseId: Record<string, ProviderTelemetryEntry>;
    activeResponseId?: string;
    activeEntry: ProviderTelemetryEntry | null;
    summary: ProviderTelemetrySummary;
    generatedAt: number;
}

export interface ProviderTelemetryReadModelInput {
    responses: ProviderRoutingMessage[];
    activeResponseId?: string | null;
    benchmarkRecords?: ProviderTelemetryBenchmarkRecord[];
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

function readNestedRecord(record: UnknownRecord | undefined, key: string): UnknownRecord | undefined {
    return asRecord(record?.[key]);
}

function round(value: number): number {
    return Math.round(value);
}

function average(values: number[]): number | null {
    if (values.length === 0) return null;
    return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function normalizeText(value?: string): string {
    return (value ?? '').trim().toLowerCase();
}

function includesAny(value: string, patterns: string[]): boolean {
    return patterns.some((pattern) => value.includes(pattern));
}

function increment(map: Record<string, number>, key?: string): void {
    if (!key) return;
    map[key] = (map[key] ?? 0) + 1;
}

function findBenchmarkRecord(
    message: ProviderRoutingMessage,
    route?: ProviderRoutingEntry,
    benchmarkRecords: ProviderTelemetryBenchmarkRecord[] = [],
): ProviderTelemetryBenchmarkRecord | undefined {
    const ids = new Set<string>([
        message.id,
        route?.responseId,
        message.requestId,
        route?.requestId,
        message.ownership?.responseId,
    ].filter((value): value is string => Boolean(value)));

    return benchmarkRecords.find((record) => ids.has(record.id));
}

function readLatencyMs(args: {
    telemetry?: UnknownRecord;
    debug?: UnknownRecord;
    benchmark?: ProviderTelemetryBenchmarkRecord;
    startedAt?: number;
    completedAt?: number;
}): number | undefined {
    const explicit = readNumber(args.telemetry, 'latencyMs')
        ?? readNumber(args.telemetry, 'latency_ms')
        ?? readNumber(args.telemetry, 'durationMs')
        ?? readNumber(args.debug, 'latencyMs')
        ?? args.benchmark?.latencyMs;
    if (explicit !== undefined) return explicit;

    if (
        args.startedAt !== undefined
        && args.completedAt !== undefined
        && args.completedAt >= args.startedAt
    ) {
        return args.completedAt - args.startedAt;
    }

    return undefined;
}

function readTotalLatencyMs(args: {
    telemetry?: UnknownRecord;
    debug?: UnknownRecord;
    benchmark?: ProviderTelemetryBenchmarkRecord;
    latencyMs?: number;
}): number | undefined {
    return readNumber(args.telemetry, 'totalLatencyMs')
        ?? readNumber(args.telemetry, 'total_latency_ms')
        ?? readNumber(args.debug, 'totalLatencyMs')
        ?? args.benchmark?.totalLatencyMs
        ?? args.latencyMs;
}

function readRetryCount(args: {
    telemetry?: UnknownRecord;
    debug?: UnknownRecord;
    benchmark?: ProviderTelemetryBenchmarkRecord;
    fallback?: ProviderFallbackEntry;
}): number {
    return readNumber(args.telemetry, 'retryCount')
        ?? readNumber(args.debug, 'retryCount')
        ?? args.benchmark?.retryCount
        ?? args.fallback?.failedAttemptCount
        ?? 0;
}

function readValidationPassed(debug?: UnknownRecord, telemetry?: UnknownRecord, benchmark?: ProviderTelemetryBenchmarkRecord): boolean | undefined {
    const validation = readNestedRecord(debug, 'validation') ?? readNestedRecord(debug, 'validator');
    const result = readString(telemetry, 'validationResult') ?? readString(debug, 'validationResult');
    if (readBoolean(validation, 'valid') !== undefined) return readBoolean(validation, 'valid');
    if (readBoolean(validation, 'passed') !== undefined) return readBoolean(validation, 'passed');
    if (typeof benchmark?.structuredOutputCompliant === 'boolean') return benchmark.structuredOutputCompliant;
    if (result) return !includesAny(normalizeText(result), ['invalid', 'failed', 'failure']);
    return undefined;
}

function readCancelled(messageRecord: UnknownRecord, debug?: UnknownRecord, telemetry?: UnknownRecord): boolean {
    const cancellation = readNestedRecord(debug, 'cancellation');
    const errorText = normalizeText(
        readString(messageRecord, 'error')
        ?? readString(telemetry, 'error')
        ?? readString(debug, 'error')
        ?? readString(cancellation, 'reason'),
    );

    return readBoolean(messageRecord, 'cancelled') === true
        || readBoolean(telemetry, 'cancelled') === true
        || readBoolean(debug, 'cancelled') === true
        || readBoolean(cancellation, 'cancelled') === true
        || includesAny(errorText, ['cancelled', 'canceled', 'abort']);
}

function readStreamingStarted(messageRecord: UnknownRecord, debug?: UnknownRecord, telemetry?: UnknownRecord): boolean {
    const streaming = readNestedRecord(debug, 'streaming');
    return readBoolean(messageRecord, 'isStreaming') === true
        || readBoolean(telemetry, 'streamingStarted') === true
        || readBoolean(debug, 'streamingStarted') === true
        || readBoolean(streaming, 'started') === true
        || readBoolean(streaming, 'completed') === true;
}

function readStreamingCompleted(args: {
    messageRecord: UnknownRecord;
    debug?: UnknownRecord;
    telemetry?: UnknownRecord;
    streamingStarted: boolean;
    completedAt?: number;
    cancelled: boolean;
}): boolean {
    const streaming = readNestedRecord(args.debug, 'streaming');
    const explicit = readBoolean(args.telemetry, 'streamingCompleted')
        ?? readBoolean(args.debug, 'streamingCompleted')
        ?? readBoolean(streaming, 'completed');
    if (explicit !== undefined) return explicit;
    if (!args.streamingStarted || args.cancelled) return false;
    if (readBoolean(args.messageRecord, 'isStreaming') === false) return true;
    return args.completedAt !== undefined;
}

function hasError(debug?: UnknownRecord, telemetry?: UnknownRecord, messageRecord?: UnknownRecord): boolean {
    return Boolean(
        readString(messageRecord, 'error')
        || readString(telemetry, 'error')
        || readString(debug, 'error')
    );
}

function readExplicitSuccess(debug?: UnknownRecord, telemetry?: UnknownRecord): boolean | undefined {
    return readBoolean(telemetry, 'success')
        ?? readBoolean(debug, 'success')
        ?? readBoolean(telemetry, 'ok')
        ?? readBoolean(debug, 'ok');
}

function deriveStatus(args: {
    route?: ProviderRoutingEntry;
    fallback?: ProviderFallbackEntry;
    messageRecord: UnknownRecord;
    debug?: UnknownRecord;
    telemetry?: UnknownRecord;
    cancelled: boolean;
    streamingCompleted: boolean;
    validationPassed?: boolean;
    latencyMs?: number;
}): ProviderTelemetryStatus {
    if (args.cancelled) return 'cancelled';
    if (readBoolean(args.messageRecord, 'isStreaming') === true && !args.streamingCompleted) return 'streaming';

    const explicitSuccess = readExplicitSuccess(args.debug, args.telemetry);
    if (explicitSuccess === false) return 'failure';
    if (hasError(args.debug, args.telemetry, args.messageRecord)) return 'failure';
    if (args.fallback?.safeFallback && !args.fallback.successfulAttempt) return 'failure';
    if (args.route?.status === 'local_fallback') return 'failure';
    if (args.validationPassed === false && !args.fallback?.successfulAttempt) return 'failure';
    if (explicitSuccess === true) return 'success';
    if (args.route?.status === 'unknown' && args.latencyMs === undefined && args.validationPassed === undefined) return 'unknown';
    return 'success';
}

function hasTelemetryDebug(debug?: UnknownRecord): boolean {
    return Boolean(
        readNestedRecord(debug, 'telemetry')
        || readNestedRecord(debug, 'streaming')
        || readNestedRecord(debug, 'validation')
        || readString(debug, 'validationResult')
        || readNumber(debug, 'latencyMs')
        || readBoolean(debug, 'success') !== undefined
    );
}

function deriveSource(args: {
    debug?: UnknownRecord;
    benchmark?: ProviderTelemetryBenchmarkRecord;
    route?: ProviderRoutingEntry;
}): ProviderTelemetrySource {
    if (hasTelemetryDebug(args.debug)) return 'debug_metadata';
    if (args.benchmark) return 'benchmark';
    if (args.route?.source === 'ownership') return 'ownership';
    return 'message';
}

function buildTelemetryEntry(args: {
    message: ProviderRoutingMessage;
    route?: ProviderRoutingEntry;
    fallback?: ProviderFallbackEntry;
    benchmark?: ProviderTelemetryBenchmarkRecord;
}): ProviderTelemetryEntry {
    const messageRecord = args.message as unknown as UnknownRecord;
    const debugMetadata = args.message.intelligenceMetadata ?? args.message.debugMetadata;
    const debug = asRecord(debugMetadata);
    const telemetry = readNestedRecord(debug, 'telemetry');

    const startedAt =
        readNumber(telemetry, 'startedAt')
        ?? readNumber(debug, 'startedAt');
    const completedAt =
        readNumber(telemetry, 'completedAt')
        ?? readNumber(debug, 'completedAt');
    const latencyMs = readLatencyMs({
        telemetry,
        debug,
        benchmark: args.benchmark,
        startedAt,
        completedAt,
    });
    const totalLatencyMs = readTotalLatencyMs({
        telemetry,
        debug,
        benchmark: args.benchmark,
        latencyMs,
    });
    const cancelled = readCancelled(messageRecord, debug, telemetry);
    const streamingStarted = readStreamingStarted(messageRecord, debug, telemetry);
    const streamingCompleted = readStreamingCompleted({
        messageRecord,
        debug,
        telemetry,
        streamingStarted,
        completedAt,
        cancelled,
    });
    const validationPassed = readValidationPassed(debug, telemetry, args.benchmark);
    const fallbackUsed = Boolean(
        args.route?.fallbackUsed
        || args.fallback
        || readBoolean(telemetry, 'fallbackUsed') === true
        || args.benchmark?.fallbackUsed === true
    );
    const cacheHit = Boolean(
        args.route?.status === 'cache'
        || readBoolean(telemetry, 'cacheHit') === true
        || args.benchmark?.cacheHit === true
    );
    const retryCount = readRetryCount({
        telemetry,
        debug,
        benchmark: args.benchmark,
        fallback: args.fallback,
    });
    const status = deriveStatus({
        route: args.route,
        fallback: args.fallback,
        messageRecord,
        debug,
        telemetry,
        cancelled,
        streamingCompleted,
        validationPassed,
        latencyMs,
    });

    return {
        responseId: args.route?.responseId ?? args.message.ownership?.responseId ?? args.message.id,
        requestId: args.route?.requestId ?? args.message.requestId,
        questionTurnId: args.route?.questionTurnId ?? args.message.questionTurnId,
        actionId: args.route?.actionId ?? args.message.intent ?? args.message.source,
        mode: args.route?.mode ?? args.benchmark?.mode,
        createdAt: args.route?.createdAt ?? args.message.timestamp ?? args.benchmark?.timestamp,
        requestedProvider: args.route?.requestedProvider ?? args.benchmark?.provider ?? args.message.provider,
        requestedModel: args.route?.requestedModel ?? args.benchmark?.model ?? args.message.model,
        actualProvider: args.route?.actualProvider ?? args.benchmark?.provider ?? args.message.provider,
        actualModel: args.route?.actualModel ?? args.benchmark?.model ?? args.message.model,
        status,
        latencyMs,
        totalLatencyMs,
        startedAt,
        completedAt,
        retryCount,
        fallbackUsed,
        cacheHit,
        streamingStarted,
        streamingCompleted,
        cancelled,
        validationPassed,
        promptTokens: readNumber(telemetry, 'promptTokens'),
        completionTokens: readNumber(telemetry, 'completionTokens'),
        inputTokens: args.benchmark?.inputTokens,
        outputTokens: args.benchmark?.outputTokens,
        responseLength: readNumber(telemetry, 'parsedLength')
            ?? readNumber(telemetry, 'rawLength')
            ?? args.benchmark?.responseLength,
        source: deriveSource({
            debug,
            benchmark: args.benchmark,
            route: args.route,
        }),
    };
}

function emptyBucket(): ProviderTelemetryBucket {
    return {
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        streamingCount: 0,
        cancelledCount: 0,
        fallbackCount: 0,
        cacheHitCount: 0,
        retryCount: 0,
        avgLatencyMs: null,
        avgTotalLatencyMs: null,
    };
}

function summarizeEntries(entries: ProviderTelemetryEntry[]): ProviderTelemetryBucket {
    const bucket = emptyBucket();
    bucket.requestCount = entries.length;
    bucket.successCount = entries.filter((entry) => entry.status === 'success').length;
    bucket.failureCount = entries.filter((entry) => entry.status === 'failure').length;
    bucket.streamingCount = entries.filter((entry) => entry.status === 'streaming').length;
    bucket.cancelledCount = entries.filter((entry) => entry.status === 'cancelled').length;
    bucket.fallbackCount = entries.filter((entry) => entry.fallbackUsed).length;
    bucket.cacheHitCount = entries.filter((entry) => entry.cacheHit).length;
    bucket.retryCount = entries.reduce((count, entry) => count + entry.retryCount, 0);
    bucket.avgLatencyMs = average(entries.map((entry) => entry.latencyMs).filter((value): value is number => value !== undefined));
    bucket.avgTotalLatencyMs = average(entries.map((entry) => entry.totalLatencyMs).filter((value): value is number => value !== undefined));
    return bucket;
}

function groupBy(entries: ProviderTelemetryEntry[], getKey: (entry: ProviderTelemetryEntry) => string | undefined): Record<string, ProviderTelemetryBucket> {
    const groups = new Map<string, ProviderTelemetryEntry[]>();
    for (const entry of entries) {
        const key = getKey(entry);
        if (!key) continue;
        const group = groups.get(key) ?? [];
        group.push(entry);
        groups.set(key, group);
    }

    return Object.fromEntries(
        Array.from(groups.entries()).map(([key, group]) => [key, summarizeEntries(group)]),
    ) as Record<string, ProviderTelemetryBucket>;
}

function buildSummary(entries: ProviderTelemetryEntry[]): ProviderTelemetrySummary {
    const byStatus: Record<string, number> = {};
    for (const entry of entries) {
        increment(byStatus, entry.status);
    }

    return {
        ...summarizeEntries(entries),
        byStatus,
        byProvider: groupBy(entries, (entry) => entry.actualProvider ?? entry.requestedProvider),
        byModel: groupBy(entries, (entry) => entry.actualModel ?? entry.requestedModel),
    };
}

export function buildProviderTelemetryReadModel(input: ProviderTelemetryReadModelInput): ProviderTelemetryReadModel {
    const routing = buildProviderRoutingReadModel({
        responses: input.responses,
        activeResponseId: input.activeResponseId,
        now: input.now,
    });
    const fallback = buildProviderFallbackReadModel({
        responses: input.responses,
        activeResponseId: input.activeResponseId,
        now: input.now,
    });
    const entries = input.responses.map((message) => {
        const responseId = message.ownership?.responseId ?? message.id;
        const route = routing.byResponseId[responseId];
        return buildTelemetryEntry({
            message,
            route,
            fallback: fallback.byResponseId[responseId],
            benchmark: findBenchmarkRecord(message, route, input.benchmarkRecords),
        });
    });
    const byResponseId = Object.fromEntries(
        entries.map((entry) => [entry.responseId, entry]),
    ) as Record<string, ProviderTelemetryEntry>;
    const activeResponseId = input.activeResponseId ?? undefined;

    return {
        entries,
        byResponseId,
        activeResponseId,
        activeEntry: activeResponseId ? byResponseId[activeResponseId] ?? null : null,
        summary: buildSummary(entries),
        generatedAt: input.now ?? Date.now(),
    };
}
