import type { ResponseOwnership } from '../overlay/actionContextTypes';
import type { ProviderRoutingMessage } from './providerRoutingReadModel';

export interface ProviderAnalyticsSnapshotResponse extends ProviderRoutingMessage {
    responseId: string;
    parentResponseId?: string;
    rootResponseId?: string;
    questionTurn?: string;
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    routingReason?: string;
    personalizationVersion?: number;
    providerDiagnosticsMetadata?: unknown;
    providerTelemetryMetadata?: unknown;
    validationMetadata?: unknown;
    isStreaming?: boolean;
}

export interface ProviderAnalyticsSessionSnapshot {
    generatedAt: number;
    activeResponseId: string | null;
    responses: ProviderAnalyticsSnapshotResponse[];
    ownershipByResponseId: Record<string, Partial<ResponseOwnership>>;
}

export const PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC = {
    set: 'provider-analytics:set-session-snapshot',
    get: 'provider-analytics:get-session-snapshot',
    changed: 'provider-analytics:session-snapshot-changed',
} as const;

export interface ProviderAnalyticsSessionSnapshotSetResult {
    success: true;
}

export type ProviderAnalyticsSessionSnapshotChangeHandler = (
    snapshot: ProviderAnalyticsSessionSnapshot | null,
) => void;

export interface ProviderAnalyticsSessionSnapshotBridge {
    setProviderAnalyticsSessionSnapshot: (
        snapshot: ProviderAnalyticsSessionSnapshot | null,
    ) => Promise<ProviderAnalyticsSessionSnapshotSetResult>;
    getProviderAnalyticsSessionSnapshot: () => Promise<ProviderAnalyticsSessionSnapshot | null>;
    onProviderAnalyticsSessionSnapshotChanged: (
        callback: ProviderAnalyticsSessionSnapshotChangeHandler,
    ) => () => void;
}

export interface ProviderAnalyticsSnapshotMessage {
    id: string;
    role?: string;
    requestId?: string;
    timestamp?: number;
    questionTurnId?: string;
    intent?: string;
    source?: string;
    provider?: string;
    model?: string;
    rootResponseId?: string;
    ownership?: ResponseOwnership;
    intelligenceMetadata?: unknown;
    debugMetadata?: unknown;
    isStreaming?: boolean;
}

type UnknownRecord = Record<string, unknown>;

const EMPTY_SNAPSHOT: ProviderAnalyticsSessionSnapshot = Object.freeze({
    generatedAt: 0,
    activeResponseId: null,
    responses: [],
    ownershipByResponseId: {},
});

const ROUTING_KEYS = [
    'requestedProvider',
    'requestedModel',
    'actualProvider',
    'actualModel',
    'reason',
] as const;

const TELEMETRY_KEYS = [
    'selectedProvider',
    'selectedModel',
    'actualInvokedProvider',
    'actualInvokedModel',
    'fallbackUsed',
    'fallbackReason',
    'cacheHit',
    'latencyMs',
    'latency_ms',
    'durationMs',
    'totalLatencyMs',
    'total_latency_ms',
    'startedAt',
    'completedAt',
    'retryCount',
    'validationResult',
    'success',
    'ok',
    'cancelled',
    'streamingStarted',
    'streamingCompleted',
    'promptTokens',
    'completionTokens',
    'rawLength',
    'parsedLength',
] as const;

const VALIDATION_KEYS = [
    'valid',
    'passed',
    'reason',
    'error',
    'validationResult',
    'warnings',
] as const;

const PERSONALIZATION_KEYS = [
    'resolvedCodingLanguage',
    'providerPreference',
    'responseStyle',
    'interviewFocus',
    'personalizationVersion',
] as const;

const ATTEMPT_KEYS = [
    'provider',
    'model',
    'result',
    'status',
    'ok',
    'reason',
    'error',
    'message',
    'startedAt',
    'completedAt',
    'durationMs',
] as const;

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

function asRecord(value: unknown): UnknownRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : undefined;
}

function pickDefined<T extends readonly string[]>(
    source: UnknownRecord | undefined,
    keys: T,
): Partial<Record<T[number], unknown>> | undefined {
    if (!source) return undefined;
    const picked: Partial<Record<T[number], unknown>> = {};
    keys.forEach((key) => {
        const value = source[key];
        if (value !== undefined) {
            (picked as Record<string, unknown>)[key] = value;
        }
    });
    return Object.keys(picked).length > 0 ? picked : undefined;
}

function pickOwnership(ownership?: ResponseOwnership): Partial<ResponseOwnership> | undefined {
    if (!ownership) return undefined;
    const picked: Partial<ResponseOwnership> = {};
    OWNERSHIP_KEYS.forEach((key) => {
        const value = ownership[key];
        if (value !== undefined) {
            (picked as Record<string, unknown>)[key] = value;
        }
    });
    return picked;
}

function sanitizeAttempts(value: unknown): unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const attempts = value
        .map((entry) => pickDefined(asRecord(entry), ATTEMPT_KEYS))
        .filter((entry): entry is UnknownRecord => Boolean(entry && Object.keys(entry).length > 0));
    return attempts.length > 0 ? attempts : undefined;
}

function sanitizeProviderDebugMetadata(metadata?: unknown): unknown {
    const debug = asRecord(metadata);
    if (!debug) return undefined;

    const routing = pickDefined(asRecord(debug.routing), ROUTING_KEYS);
    const telemetry = pickDefined(asRecord(debug.telemetry), TELEMETRY_KEYS);
    const validation = pickDefined(asRecord(debug.validation) ?? asRecord(debug.validator), VALIDATION_KEYS);
    const personalization = pickDefined(asRecord(debug.personalization), PERSONALIZATION_KEYS);
    const fallback = pickDefined(asRecord(debug.fallback), [
        'used',
        'reason',
        'fallbackReason',
        'category',
    ] as const);
    const repair = pickDefined(asRecord(debug.repair), [
        'succeeded',
        'reason',
        'error',
    ] as const);
    const cancellation = pickDefined(asRecord(debug.cancellation), [
        'cancelled',
        'reason',
    ] as const);
    const streaming = pickDefined(asRecord(debug.streaming), [
        'started',
        'completed',
    ] as const);
    const fallbackChain = sanitizeAttempts(debug.fallbackChain);
    const fallbackAttempts = sanitizeAttempts(debug.fallbackAttempts);

    const sanitized = {
        ...(routing ? { routing } : {}),
        ...(telemetry ? { telemetry } : {}),
        ...(fallback ? { fallback } : {}),
        ...(fallbackChain ? { fallbackChain } : {}),
        ...(fallbackAttempts ? { fallbackAttempts } : {}),
        ...(validation ? { validation } : {}),
        ...(repair ? { repair } : {}),
        ...(cancellation ? { cancellation } : {}),
        ...(streaming ? { streaming } : {}),
        ...(personalization ? { personalization } : {}),
    };

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function readDebugSection(metadata: unknown, key: string): unknown {
    return asRecord(metadata)?.[key];
}

function buildSnapshotResponse(message: ProviderAnalyticsSnapshotMessage): ProviderAnalyticsSnapshotResponse {
    const ownership = pickOwnership(message.ownership);
    const responseId = message.ownership?.responseId ?? message.id;
    const sanitizedMetadata = sanitizeProviderDebugMetadata(
        message.intelligenceMetadata ?? message.debugMetadata,
    );
    const requestedProvider = message.ownership?.requestedProvider ?? message.ownership?.sourceProvider ?? message.provider;
    const requestedModel = message.ownership?.requestedModel ?? message.ownership?.sourceModel ?? message.model;
    const actualProvider = message.ownership?.actualProvider ?? requestedProvider;
    const actualModel = message.ownership?.actualModel ?? requestedModel;
    const providerDiagnosticsMetadata = sanitizedMetadata
        ? {
            routing: readDebugSection(sanitizedMetadata, 'routing'),
            fallback: readDebugSection(sanitizedMetadata, 'fallback'),
            fallbackChain: readDebugSection(sanitizedMetadata, 'fallbackChain'),
            validation: readDebugSection(sanitizedMetadata, 'validation'),
        }
        : undefined;

    return {
        id: responseId,
        responseId,
        requestId: message.requestId,
        provider: requestedProvider,
        model: requestedModel,
        intent: message.intent,
        source: message.source,
        timestamp: message.timestamp,
        questionTurnId: message.ownership?.questionTurnId ?? message.questionTurnId,
        ownership,
        intelligenceMetadata: sanitizedMetadata,
        debugMetadata: sanitizedMetadata,
        parentResponseId: message.ownership?.parentResponseId,
        rootResponseId: message.rootResponseId,
        questionTurn: message.ownership?.questionTurnId ?? message.questionTurnId,
        requestedProvider,
        requestedModel,
        actualProvider,
        actualModel,
        routingReason: message.ownership?.routingReason,
        personalizationVersion: message.ownership?.personalizationVersion,
        providerDiagnosticsMetadata,
        providerTelemetryMetadata: readDebugSection(sanitizedMetadata, 'telemetry'),
        validationMetadata: readDebugSection(sanitizedMetadata, 'validation'),
        isStreaming: message.isStreaming,
    };
}

function buildSnapshotKeyEntry(message: ProviderAnalyticsSnapshotMessage): UnknownRecord {
    return {
        id: message.id,
        role: message.role,
        requestId: message.requestId,
        timestamp: message.timestamp,
        questionTurnId: message.questionTurnId,
        intent: message.intent,
        source: message.source,
        provider: message.provider,
        model: message.model,
        rootResponseId: message.rootResponseId,
        ownership: pickOwnership(message.ownership),
        debugMetadata: sanitizeProviderDebugMetadata(
            message.intelligenceMetadata ?? message.debugMetadata,
        ),
        isStreaming: message.isStreaming,
    };
}

function buildSnapshotResponseKeyEntry(response: ProviderAnalyticsSnapshotResponse): UnknownRecord {
    return {
        id: response.id,
        responseId: response.responseId,
        requestId: response.requestId,
        provider: response.provider,
        model: response.model,
        intent: response.intent,
        source: response.source,
        timestamp: response.timestamp,
        questionTurnId: response.questionTurnId,
        ownership: response.ownership,
        parentResponseId: response.parentResponseId,
        rootResponseId: response.rootResponseId,
        questionTurn: response.questionTurn,
        requestedProvider: response.requestedProvider,
        requestedModel: response.requestedModel,
        actualProvider: response.actualProvider,
        actualModel: response.actualModel,
        routingReason: response.routingReason,
        personalizationVersion: response.personalizationVersion,
        providerDiagnosticsMetadata: response.providerDiagnosticsMetadata,
        providerTelemetryMetadata: response.providerTelemetryMetadata,
        validationMetadata: response.validationMetadata,
        isStreaming: response.isStreaming,
    };
}

export function createEmptyProviderAnalyticsSessionSnapshot(
    generatedAt: number = Date.now(),
): ProviderAnalyticsSessionSnapshot {
    return {
        ...EMPTY_SNAPSHOT,
        generatedAt,
    };
}

export function buildProviderAnalyticsSessionSnapshot(
    messages: ProviderAnalyticsSnapshotMessage[],
    activeResponseId: string | null,
    generatedAt: number = Date.now(),
): ProviderAnalyticsSessionSnapshot {
    const responses = messages
        .filter((message) => message.role === undefined || message.role === 'system')
        .map(buildSnapshotResponse);
    const ownershipByResponseId = responses.reduce<Record<string, Partial<ResponseOwnership>>>((acc, response) => {
        if (response.ownership) acc[response.responseId] = response.ownership;
        return acc;
    }, {});

    return {
        generatedAt,
        activeResponseId,
        responses,
        ownershipByResponseId,
    };
}

export function buildProviderAnalyticsSessionSnapshotKey(
    messages: ProviderAnalyticsSnapshotMessage[],
    activeResponseId: string | null,
): string {
    return JSON.stringify({
        activeResponseId,
        responses: messages
            .filter((message) => message.role === undefined || message.role === 'system')
            .map(buildSnapshotKeyEntry),
    });
}

export function buildProviderAnalyticsSessionSnapshotStateKey(
    snapshot: ProviderAnalyticsSessionSnapshot,
): string {
    return JSON.stringify({
        activeResponseId: snapshot.activeResponseId,
        responses: snapshot.responses.map(buildSnapshotResponseKeyEntry),
        ownershipByResponseId: snapshot.ownershipByResponseId,
    });
}
