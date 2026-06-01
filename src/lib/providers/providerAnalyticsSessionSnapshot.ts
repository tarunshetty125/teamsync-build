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

/**
 * Provider analytics snapshots are a retained-session metadata relay, not a
 * second response-history store. Keep these budgets near the snapshot shape so
 * IPC payload growth is easy to audit.
 */
export const PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS = Object.freeze({
    maxResponses: 30,
    maxOwnershipEntries: 30,
    warningSerializedBytes: 96 * 1024,
    maxSerializedBytes: 256 * 1024,
});

export type ProviderAnalyticsSessionSnapshotValidationStatus =
    | 'valid'
    | 'warning'
    | 'invalid';

export interface ProviderAnalyticsSessionSnapshotValidationIssue {
    severity: Exclude<ProviderAnalyticsSessionSnapshotValidationStatus, 'valid'>;
    code: string;
    path: string;
    message: string;
    actual?: number | string;
    budget?: number | string;
}

export interface ProviderAnalyticsSessionSnapshotValidationResult {
    status: ProviderAnalyticsSessionSnapshotValidationStatus;
    issues: ProviderAnalyticsSessionSnapshotValidationIssue[];
    responseCount: number;
    ownershipEntryCount: number;
    serializedBytes: number;
    budgets: typeof PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS;
}

export type ProviderAnalyticsSessionSnapshotRelayStatus =
    | 'accepted'
    | 'accepted_with_warning'
    | 'quarantined';

export interface ProviderAnalyticsSessionSnapshotRelayDiagnosticIssue {
    severity: Exclude<ProviderAnalyticsSessionSnapshotValidationStatus, 'valid'>;
    code: string;
    path: string;
    message: string;
    budget?: number | string;
}

export interface ProviderAnalyticsSessionSnapshotRelayDiagnostic {
    source: 'provider_analytics_snapshot_relay';
    code: 'provider_analytics_snapshot_warning' | 'provider_analytics_snapshot_quarantined';
    status: Exclude<ProviderAnalyticsSessionSnapshotValidationStatus, 'valid'>;
    message: string;
    timestamp: number;
    responseCount: number;
    ownershipEntryCount: number;
    serializedBytes: number;
    issueCount: number;
    issues: ProviderAnalyticsSessionSnapshotRelayDiagnosticIssue[];
    recoverable: boolean;
    userVisible: false;
}

export interface ProviderAnalyticsSessionSnapshotQuarantineResult {
    currentSnapshot: ProviderAnalyticsSessionSnapshot | null;
    shouldBroadcast: boolean;
    broadcastSnapshot: ProviderAnalyticsSessionSnapshot | null;
    setResult: ProviderAnalyticsSessionSnapshotSetResult;
}

export const PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC = {
    set: 'provider-analytics:set-session-snapshot',
    get: 'provider-analytics:get-session-snapshot',
    changed: 'provider-analytics:session-snapshot-changed',
} as const;

export interface ProviderAnalyticsSessionSnapshotSetResult {
    success: true;
    status: ProviderAnalyticsSessionSnapshotRelayStatus;
    accepted: boolean;
    quarantined: boolean;
    diagnostic?: ProviderAnalyticsSessionSnapshotRelayDiagnostic;
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

const SNAPSHOT_TOP_LEVEL_KEYS = new Set([
    'generatedAt',
    'activeResponseId',
    'responses',
    'ownershipByResponseId',
]);

const SNAPSHOT_RESPONSE_KEYS = new Set([
    'id',
    'responseId',
    'requestId',
    'provider',
    'model',
    'intent',
    'source',
    'timestamp',
    'questionTurnId',
    'ownership',
    'intelligenceMetadata',
    'debugMetadata',
    'parentResponseId',
    'rootResponseId',
    'questionTurn',
    'requestedProvider',
    'requestedModel',
    'actualProvider',
    'actualModel',
    'routingReason',
    'personalizationVersion',
    'providerDiagnosticsMetadata',
    'providerTelemetryMetadata',
    'validationMetadata',
    'isStreaming',
]);

const SNAPSHOT_CONTENT_LEAKAGE_KEYS = new Set([
    'answer',
    'answers',
    'artifact',
    'artifacts',
    'architecture',
    'architecturejson',
    'architecture_json',
    'architecturepayload',
    'body',
    'completion',
    'content',
    'diagram',
    'diagrampayload',
    'diagrams',
    'image',
    'imagepayload',
    'images',
    'markdown',
    'messages',
    'parsedarchitecture',
    'parseddiagram',
    'prompt',
    'prompts',
    'rawcontent',
    'rawresponse',
    'responsecontent',
    'responsemarkdown',
    'responsetext',
    'screenshot',
    'screenshotpreview',
    'screenshots',
    'streamedcontent',
    'streamingcontent',
    'text',
    'transcript',
    'transcripts',
    'transcripttext',
]);

function asRecord(value: unknown): UnknownRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : undefined;
}

function normalizedSnapshotKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function serializedByteLength(value: unknown): number {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return 0;
    return new TextEncoder().encode(serialized).length;
}

function pushSnapshotValidationIssue(
    issues: ProviderAnalyticsSessionSnapshotValidationIssue[],
    issue: ProviderAnalyticsSessionSnapshotValidationIssue,
): void {
    issues.push(issue);
}

function collectContentLeakageIssues(
    value: unknown,
    path: string,
    issues: ProviderAnalyticsSessionSnapshotValidationIssue[],
    seen: WeakSet<object> = new WeakSet<object>(),
): void {
    if (!value || typeof value !== 'object') return;

    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
        value.forEach((entry, index) => {
            collectContentLeakageIssues(entry, `${path}[${index}]`, issues, seen);
        });
        return;
    }

    Object.entries(value as UnknownRecord).forEach(([key, nestedValue]) => {
        const normalizedKey = normalizedSnapshotKey(key);
        const nextPath = path ? `${path}.${key}` : key;
        if (SNAPSHOT_CONTENT_LEAKAGE_KEYS.has(normalizedKey)) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'content_leakage_detected',
                path: nextPath,
                message: 'Provider analytics session snapshots must remain metadata-only.',
                actual: key,
            });
        }
        collectContentLeakageIssues(nestedValue, nextPath, issues, seen);
    });
}

function compareSnapshotField(
    issues: ProviderAnalyticsSessionSnapshotValidationIssue[],
    responseId: string,
    field: string,
    responseValue: unknown,
    ownershipValue: unknown,
): void {
    if (responseValue === undefined || ownershipValue === undefined || responseValue === ownershipValue) {
        return;
    }

    pushSnapshotValidationIssue(issues, {
        severity: 'invalid',
        code: 'ownership_field_mismatch',
        path: `ownershipByResponseId.${responseId}.${field}`,
        message: 'Snapshot response metadata must stay aligned with ownership metadata.',
        actual: String(ownershipValue),
        budget: String(responseValue),
    });
}

function buildSnapshotValidationResult(
    issues: ProviderAnalyticsSessionSnapshotValidationIssue[],
    responseCount: number,
    ownershipEntryCount: number,
    serializedBytes: number,
): ProviderAnalyticsSessionSnapshotValidationResult {
    const status: ProviderAnalyticsSessionSnapshotValidationStatus = issues.some((issue) => issue.severity === 'invalid')
        ? 'invalid'
        : issues.length > 0
            ? 'warning'
            : 'valid';

    return {
        status,
        issues,
        responseCount,
        ownershipEntryCount,
        serializedBytes,
        budgets: PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS,
    };
}

export function validateProviderAnalyticsSessionSnapshot(
    snapshot: unknown,
): ProviderAnalyticsSessionSnapshotValidationResult {
    const issues: ProviderAnalyticsSessionSnapshotValidationIssue[] = [];
    let serializedBytes = 0;

    try {
        serializedBytes = serializedByteLength(snapshot);
    } catch (error) {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'snapshot_serialization_failed',
            path: '$',
            message: 'Provider analytics session snapshot must be JSON-serializable.',
            actual: error instanceof Error ? error.message : String(error),
        });
    }

    if (serializedBytes > PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxSerializedBytes) {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'payload_size_exceeded',
            path: '$',
            message: 'Provider analytics session snapshot exceeds the maximum serialized payload size.',
            actual: serializedBytes,
            budget: PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxSerializedBytes,
        });
    } else if (serializedBytes > PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.warningSerializedBytes) {
        pushSnapshotValidationIssue(issues, {
            severity: 'warning',
            code: 'payload_size_warning',
            path: '$',
            message: 'Provider analytics session snapshot is approaching the serialized payload budget.',
            actual: serializedBytes,
            budget: PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.warningSerializedBytes,
        });
    }

    if (snapshot === null) {
        return buildSnapshotValidationResult(issues, 0, 0, serializedBytes);
    }

    const snapshotRecord = asRecord(snapshot);
    if (!snapshotRecord) {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'snapshot_shape_invalid',
            path: '$',
            message: 'Provider analytics session snapshot must be an object or null.',
        });
        return buildSnapshotValidationResult(issues, 0, 0, serializedBytes);
    }

    Object.keys(snapshotRecord).forEach((key) => {
        if (!SNAPSHOT_TOP_LEVEL_KEYS.has(key)) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'metadata_only_shape_violation',
                path: key,
                message: 'Provider analytics session snapshot contains an unsupported top-level field.',
                actual: key,
            });
        }
    });

    if (typeof snapshotRecord.generatedAt !== 'number') {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'generated_at_invalid',
            path: 'generatedAt',
            message: 'Provider analytics session snapshot generatedAt must be numeric.',
        });
    }

    if (snapshotRecord.activeResponseId !== null && snapshotRecord.activeResponseId !== undefined && typeof snapshotRecord.activeResponseId !== 'string') {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'active_response_id_invalid',
            path: 'activeResponseId',
            message: 'Provider analytics session snapshot activeResponseId must be a string or null.',
        });
    }

    const responses = Array.isArray(snapshotRecord.responses) ? snapshotRecord.responses : [];
    if (!Array.isArray(snapshotRecord.responses)) {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'responses_shape_invalid',
            path: 'responses',
            message: 'Provider analytics session snapshot responses must be an array.',
        });
    }

    const ownershipByResponseId = asRecord(snapshotRecord.ownershipByResponseId) ?? {};
    if (!asRecord(snapshotRecord.ownershipByResponseId)) {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'ownership_shape_invalid',
            path: 'ownershipByResponseId',
            message: 'Provider analytics session snapshot ownershipByResponseId must be an object.',
        });
    }

    if (responses.length > PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxResponses) {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'response_count_exceeded',
            path: 'responses',
            message: 'Provider analytics session snapshot exceeds the retained-response budget.',
            actual: responses.length,
            budget: PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxResponses,
        });
    }

    const ownershipEntries = Object.entries(ownershipByResponseId);
    if (ownershipEntries.length > PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxOwnershipEntries) {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'ownership_entry_count_exceeded',
            path: 'ownershipByResponseId',
            message: 'Provider analytics session snapshot exceeds the ownership-entry budget.',
            actual: ownershipEntries.length,
            budget: PROVIDER_ANALYTICS_SESSION_SNAPSHOT_BUDGETS.maxOwnershipEntries,
        });
    }

    collectContentLeakageIssues(snapshotRecord, '$', issues);

    const responseRecords = responses
        .map((response, index) => {
            const record = asRecord(response);
            if (!record) {
                pushSnapshotValidationIssue(issues, {
                    severity: 'invalid',
                    code: 'response_shape_invalid',
                    path: `responses[${index}]`,
                    message: 'Provider analytics session snapshot response entries must be objects.',
                });
            }
            return record ? { record, index } : null;
        })
        .filter((entry): entry is { record: UnknownRecord; index: number } => Boolean(entry));
    const responseIds = new Set<string>();

    responseRecords.forEach(({ record, index }) => {
        Object.keys(record).forEach((key) => {
            if (!SNAPSHOT_RESPONSE_KEYS.has(key)) {
                pushSnapshotValidationIssue(issues, {
                    severity: 'warning',
                    code: 'unknown_response_metadata_key',
                    path: `responses[${index}].${key}`,
                    message: 'Provider analytics session snapshot response contains an unrecognized metadata key.',
                    actual: key,
                });
            }
        });

        if (typeof record.responseId !== 'string' || !record.responseId.trim()) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'response_id_invalid',
                path: `responses[${index}].responseId`,
                message: 'Provider analytics session snapshot responseId must be a non-empty string.',
            });
            return;
        }

        responseIds.add(record.responseId);

        if (record.id !== undefined && record.id !== record.responseId) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'response_id_mismatch',
                path: `responses[${index}].id`,
                message: 'Provider analytics session snapshot id must match responseId.',
                actual: String(record.id),
                budget: String(record.responseId),
            });
        }
    });

    if (typeof snapshotRecord.activeResponseId === 'string' && !responseIds.has(snapshotRecord.activeResponseId)) {
        pushSnapshotValidationIssue(issues, {
            severity: 'invalid',
            code: 'active_response_not_retained',
            path: 'activeResponseId',
            message: 'Provider analytics activeResponseId must reference a retained response.',
            actual: snapshotRecord.activeResponseId,
        });
    }

    responseRecords.forEach(({ record, index }) => {
        const responseId = String(record.responseId);
        const parentResponseId = typeof record.parentResponseId === 'string' ? record.parentResponseId : undefined;
        const rootResponseId = typeof record.rootResponseId === 'string' ? record.rootResponseId : undefined;
        const responseOwnership = asRecord(record.ownership);
        const mappedOwnership = asRecord(ownershipByResponseId[responseId]);

        if (parentResponseId && !responseIds.has(parentResponseId)) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'parent_response_not_retained',
                path: `responses[${index}].parentResponseId`,
                message: 'Provider analytics parentResponseId must reference a retained response.',
                actual: parentResponseId,
            });
        }

        if (rootResponseId && !responseIds.has(rootResponseId)) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'root_response_not_retained',
                path: `responses[${index}].rootResponseId`,
                message: 'Provider analytics rootResponseId must reference a retained response.',
                actual: rootResponseId,
            });
        }

        if (responseOwnership && !mappedOwnership) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'ownership_entry_missing',
                path: `ownershipByResponseId.${responseId}`,
                message: 'Provider analytics ownership map must include retained response ownership.',
            });
        }

        if (!mappedOwnership) return;

        if (mappedOwnership.responseId !== undefined && mappedOwnership.responseId !== responseId) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'ownership_response_id_mismatch',
                path: `ownershipByResponseId.${responseId}.responseId`,
                message: 'Provider analytics ownership entry responseId must match its map key.',
                actual: String(mappedOwnership.responseId),
                budget: responseId,
            });
        }

        compareSnapshotField(issues, responseId, 'parentResponseId', parentResponseId, mappedOwnership.parentResponseId);
        compareSnapshotField(issues, responseId, 'requestedProvider', record.requestedProvider, mappedOwnership.requestedProvider);
        compareSnapshotField(issues, responseId, 'requestedModel', record.requestedModel, mappedOwnership.requestedModel);
        compareSnapshotField(issues, responseId, 'actualProvider', record.actualProvider, mappedOwnership.actualProvider);
        compareSnapshotField(issues, responseId, 'actualModel', record.actualModel, mappedOwnership.actualModel);
        compareSnapshotField(issues, responseId, 'routingReason', record.routingReason, mappedOwnership.routingReason);
        compareSnapshotField(issues, responseId, 'personalizationVersion', record.personalizationVersion, mappedOwnership.personalizationVersion);
    });

    ownershipEntries.forEach(([responseId, ownership]) => {
        if (!responseIds.has(responseId)) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'ownership_entry_not_retained',
                path: `ownershipByResponseId.${responseId}`,
                message: 'Provider analytics ownership map contains an entry for a non-retained response.',
                actual: responseId,
            });
        }

        if (!asRecord(ownership)) {
            pushSnapshotValidationIssue(issues, {
                severity: 'invalid',
                code: 'ownership_entry_shape_invalid',
                path: `ownershipByResponseId.${responseId}`,
                message: 'Provider analytics ownership entries must be objects.',
            });
        }
    });

    return buildSnapshotValidationResult(
        issues,
        responses.length,
        ownershipEntries.length,
        serializedBytes,
    );
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

function buildProviderAnalyticsSessionSnapshotRelayDiagnostic(
    validation: ProviderAnalyticsSessionSnapshotValidationResult,
    timestamp: number = Date.now(),
): ProviderAnalyticsSessionSnapshotRelayDiagnostic | undefined {
    if (validation.status === 'valid') return undefined;

    const quarantined = validation.status === 'invalid';
    return {
        source: 'provider_analytics_snapshot_relay',
        code: quarantined
            ? 'provider_analytics_snapshot_quarantined'
            : 'provider_analytics_snapshot_warning',
        status: validation.status,
        message: quarantined
            ? 'Provider analytics session snapshot was quarantined and the last valid snapshot was preserved.'
            : 'Provider analytics session snapshot was accepted with guardrail warnings.',
        timestamp,
        responseCount: validation.responseCount,
        ownershipEntryCount: validation.ownershipEntryCount,
        serializedBytes: validation.serializedBytes,
        issueCount: validation.issues.length,
        issues: validation.issues.map((issue) => ({
            severity: issue.severity,
            code: issue.code,
            path: issue.path,
            message: issue.message,
            ...(issue.budget !== undefined ? { budget: issue.budget } : {}),
        })),
        recoverable: true,
        userVisible: false,
    };
}

export function applyProviderAnalyticsSessionSnapshotQuarantine(args: {
    currentSnapshot: ProviderAnalyticsSessionSnapshot | null;
    incomingSnapshot: ProviderAnalyticsSessionSnapshot | null;
    validation?: ProviderAnalyticsSessionSnapshotValidationResult;
    timestamp?: number;
}): ProviderAnalyticsSessionSnapshotQuarantineResult {
    const validation = args.validation ?? validateProviderAnalyticsSessionSnapshot(args.incomingSnapshot);
    const diagnostic = buildProviderAnalyticsSessionSnapshotRelayDiagnostic(validation, args.timestamp);

    if (validation.status === 'invalid') {
        const currentSnapshot = args.currentSnapshot ?? createEmptyProviderAnalyticsSessionSnapshot(0);
        return {
            currentSnapshot,
            shouldBroadcast: false,
            broadcastSnapshot: currentSnapshot,
            setResult: {
                success: true,
                status: 'quarantined',
                accepted: false,
                quarantined: true,
                ...(diagnostic ? { diagnostic } : {}),
            },
        };
    }

    return {
        currentSnapshot: args.incomingSnapshot ?? null,
        shouldBroadcast: true,
        broadcastSnapshot: args.incomingSnapshot ?? null,
        setResult: {
            success: true,
            status: validation.status === 'warning' ? 'accepted_with_warning' : 'accepted',
            accepted: true,
            quarantined: false,
            ...(diagnostic ? { diagnostic } : {}),
        },
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
