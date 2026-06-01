import {
    redactSessionExportValue,
    SESSION_EXPORT_PRIVACY_ALLOWLIST,
    type SessionExportReadModel,
} from './sessionExportReadModel';

/**
 * Export guardrails protect the privacy-aware read model boundary before any
 * future renderer turns it into Markdown, HTML, PDF, or a downloadable file.
 * These are validation budgets only; they do not persist, truncate, or mutate
 * valid export models.
 */
export const SESSION_EXPORT_GUARDRAIL_BUDGETS = Object.freeze({
    maxResponses: 30,
    maxProviderRows: 120,
    maxDiagnostics: 120,
    maxDiagramVersions: 30,
    warningSerializedBytes: 256 * 1024,
    maxSerializedBytes: 768 * 1024,
});

export type SessionExportGuardrailStatus = 'valid' | 'warning' | 'invalid';

export interface SessionExportGuardrailIssue {
    severity: Exclude<SessionExportGuardrailStatus, 'valid'>;
    code: string;
    path: string;
    message: string;
    actual?: number | string;
    budget?: number | string;
}

export interface SessionExportGuardrailResult {
    status: SessionExportGuardrailStatus;
    issues: SessionExportGuardrailIssue[];
    responseCount: number;
    providerRowCount: number;
    diagnosticCount: number;
    diagramVersionCount: number;
    serializedBytes: number;
    budgets: typeof SESSION_EXPORT_GUARDRAIL_BUDGETS;
}

type UnknownRecord = Record<string, unknown>;

const TOP_LEVEL_KEYS = new Set([
    'generatedAt',
    'privacy',
    'session',
    'responses',
    'providers',
    'diagrams',
    'personalization',
    'summaries',
]);

const RESPONSE_KEYS = new Set([
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
]);

const OWNERSHIP_KEYS: ReadonlySet<string> = new Set(SESSION_EXPORT_PRIVACY_ALLOWLIST.ownership);

const CONTENT_LEAKAGE_KEYS = new Set([
    'answer',
    'answers',
    'artifact',
    'architecturejson',
    'architecturepayload',
    'body',
    'completion',
    'content',
    'credentials',
    'debugmetadata',
    'diagram',
    'diagrampayload',
    'fallbackdiagram',
    'image',
    'imagepayload',
    'images',
    'intelligencemetadata',
    'localfilesystempath',
    'markdown',
    'messages',
    'parsedarchitecture',
    'parseddiagram',
    'payload',
    'prompt',
    'prompts',
    'providerpayload',
    'rawcontent',
    'rawprompt',
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
    'transcriptbuffer',
    'transcripts',
    'transcripttext',
]);

const LOCAL_PATH_PATTERN = /(?:\/(?:Users|home|private|var|tmp|Applications|Volumes)\/[^\s"'<>]+)|(?:[A-Za-z]:\\[^\s"'<>]+)/;

function asRecord(value: unknown): UnknownRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as UnknownRecord
        : undefined;
}

function normalizedKey(value: string): string {
    return value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
}

function serializedByteLength(value: unknown): number {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return 0;
    return new TextEncoder().encode(serialized).length;
}

function pushIssue(
    issues: SessionExportGuardrailIssue[],
    issue: SessionExportGuardrailIssue,
): void {
    issues.push(issue);
}

function buildResult(args: {
    issues: SessionExportGuardrailIssue[];
    responseCount: number;
    providerRowCount: number;
    diagnosticCount: number;
    diagramVersionCount: number;
    serializedBytes: number;
}): SessionExportGuardrailResult {
    const status: SessionExportGuardrailStatus = args.issues.some((issue) => issue.severity === 'invalid')
        ? 'invalid'
        : args.issues.length > 0
            ? 'warning'
            : 'valid';

    return {
        status,
        issues: args.issues,
        responseCount: args.responseCount,
        providerRowCount: args.providerRowCount,
        diagnosticCount: args.diagnosticCount,
        diagramVersionCount: args.diagramVersionCount,
        serializedBytes: args.serializedBytes,
        budgets: SESSION_EXPORT_GUARDRAIL_BUDGETS,
    };
}

function collectLeakageIssues(
    value: unknown,
    path: string,
    issues: SessionExportGuardrailIssue[],
    seen: WeakSet<object> = new WeakSet<object>(),
): void {
    if (typeof value === 'string') {
        if (LOCAL_PATH_PATTERN.test(value)) {
            pushIssue(issues, {
                severity: 'invalid',
                code: 'local_path_leakage_detected',
                path,
                message: 'Session export read models must redact local filesystem paths.',
                actual: value,
            });
        }
        return;
    }

    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
        value.forEach((entry, index) => collectLeakageIssues(entry, `${path}[${index}]`, issues, seen));
        return;
    }

    Object.entries(value as UnknownRecord).forEach(([key, nestedValue]) => {
        const normalized = normalizedKey(key);
        const nextPath = path ? `${path}.${key}` : key;
        if (CONTENT_LEAKAGE_KEYS.has(normalized)) {
            pushIssue(issues, {
                severity: 'invalid',
                code: 'content_leakage_key_detected',
                path: nextPath,
                message: 'Session export read models must remain allowlist-based and exclude raw content or payload fields.',
                actual: key,
            });
        }

        if (LOCAL_PATH_PATTERN.test(key)) {
            pushIssue(issues, {
                severity: 'invalid',
                code: 'local_path_key_leakage_detected',
                path: nextPath,
                message: 'Session export read models must redact local filesystem paths from map keys.',
                actual: key,
            });
        }

        collectLeakageIssues(nestedValue, nextPath, issues, seen);
    });
}

function countProviderRows(model: Partial<SessionExportReadModel>): number {
    const providers = asRecord(model.providers);
    const routes = Array.isArray(providers?.routes) ? providers.routes.length : 0;
    const fallbacks = Array.isArray(providers?.fallbacks) ? providers.fallbacks.length : 0;
    const telemetry = Array.isArray(providers?.telemetry) ? providers.telemetry.length : 0;
    const personalization = Array.isArray(providers?.personalization) ? providers.personalization.length : 0;
    return routes + fallbacks + telemetry + personalization;
}

function countDiagnostics(model: Partial<SessionExportReadModel>): number {
    const providers = asRecord(model.providers);
    return Array.isArray(providers?.diagnostics) ? providers.diagnostics.length : 0;
}

function countDiagramVersions(model: Partial<SessionExportReadModel>): number {
    const diagrams = asRecord(model.diagrams);
    const timeline = asRecord(diagrams?.timeline);
    return Array.isArray(timeline?.items) ? timeline.items.length : 0;
}

function validateShape(model: UnknownRecord, issues: SessionExportGuardrailIssue[]): void {
    Object.keys(model).forEach((key) => {
        if (!TOP_LEVEL_KEYS.has(key)) {
            pushIssue(issues, {
                severity: 'invalid',
                code: 'unsupported_top_level_key',
                path: key,
                message: 'Session export read model contains a field outside the approved top-level shape.',
                actual: key,
            });
        }
    });

    if (model.privacy !== undefined) {
        const privacy = asRecord(model.privacy);
        if (!privacy || privacy.policy !== 'allowlist' || privacy.contentIncluded !== false) {
            pushIssue(issues, {
                severity: 'invalid',
                code: 'privacy_contract_invalid',
                path: 'privacy',
                message: 'Session export read model must declare allowlist privacy and contentIncluded=false.',
            });
        }
    }

    const responses = Array.isArray(model.responses) ? model.responses : [];
    if (!Array.isArray(model.responses)) {
        pushIssue(issues, {
            severity: 'invalid',
            code: 'responses_shape_invalid',
            path: 'responses',
            message: 'Session export read model responses must be an array.',
        });
    }

    responses.forEach((response, index) => {
        const record = asRecord(response);
        if (!record) {
            pushIssue(issues, {
                severity: 'invalid',
                code: 'response_shape_invalid',
                path: `responses[${index}]`,
                message: 'Session export response entries must be objects.',
            });
            return;
        }

        Object.keys(record).forEach((key) => {
            if (!RESPONSE_KEYS.has(key)) {
                pushIssue(issues, {
                    severity: 'invalid',
                    code: 'unsupported_response_key',
                    path: `responses[${index}].${key}`,
                    message: 'Session export response contains a field outside the response allowlist.',
                    actual: key,
                });
            }
        });

        const ownership = asRecord(record.ownership);
        if (ownership) {
            Object.keys(ownership).forEach((key) => {
                if (!OWNERSHIP_KEYS.has(key)) {
                    pushIssue(issues, {
                        severity: 'invalid',
                        code: 'unsupported_ownership_key',
                        path: `responses[${index}].ownership.${key}`,
                        message: 'Session export ownership contains a field outside the ownership allowlist.',
                        actual: key,
                    });
                }
            });
        }
    });
}

function validateRetainedReferences(model: UnknownRecord, issues: SessionExportGuardrailIssue[]): void {
    const responses = Array.isArray(model.responses) ? model.responses : [];
    const responseIds = new Set<string>();
    responses.forEach((response) => {
        const id = asRecord(response)?.responseId;
        if (typeof id === 'string') responseIds.add(id);
    });

    const session = asRecord(model.session);
    const activeResponseId = session?.activeResponseId;
    if (typeof activeResponseId === 'string' && !responseIds.has(activeResponseId)) {
        pushIssue(issues, {
            severity: 'invalid',
            code: 'active_response_not_retained',
            path: 'session.activeResponseId',
            message: 'Session export activeResponseId must reference a retained response.',
            actual: activeResponseId,
        });
    }

    responses.forEach((response, index) => {
        const record = asRecord(response);
        if (!record) return;
        const parentResponseId = typeof record.parentResponseId === 'string' ? record.parentResponseId : undefined;
        const rootResponseId = typeof record.rootResponseId === 'string' ? record.rootResponseId : undefined;

        if (parentResponseId && !responseIds.has(parentResponseId)) {
            pushIssue(issues, {
                severity: 'invalid',
                code: 'parent_response_not_retained',
                path: `responses[${index}].parentResponseId`,
                message: 'Session export parentResponseId must reference a retained response.',
                actual: parentResponseId,
            });
        }

        if (rootResponseId && !responseIds.has(rootResponseId)) {
            pushIssue(issues, {
                severity: 'invalid',
                code: 'root_response_not_retained',
                path: `responses[${index}].rootResponseId`,
                message: 'Session export rootResponseId must reference a retained response.',
                actual: rootResponseId,
            });
        }
    });
}

function validateBudgets(
    model: Partial<SessionExportReadModel>,
    issues: SessionExportGuardrailIssue[],
    serializedBytes: number,
): {
    responseCount: number;
    providerRowCount: number;
    diagnosticCount: number;
    diagramVersionCount: number;
} {
    const responseCount = Array.isArray(model.responses) ? model.responses.length : 0;
    const providerRowCount = countProviderRows(model);
    const diagnosticCount = countDiagnostics(model);
    const diagramVersionCount = countDiagramVersions(model);

    if (serializedBytes > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxSerializedBytes) {
        pushIssue(issues, {
            severity: 'invalid',
            code: 'payload_size_exceeded',
            path: '$',
            message: 'Session export read model exceeds the maximum serialized payload size.',
            actual: serializedBytes,
            budget: SESSION_EXPORT_GUARDRAIL_BUDGETS.maxSerializedBytes,
        });
    } else if (serializedBytes > SESSION_EXPORT_GUARDRAIL_BUDGETS.warningSerializedBytes) {
        pushIssue(issues, {
            severity: 'warning',
            code: 'payload_size_warning',
            path: '$',
            message: 'Session export read model is approaching the serialized payload budget.',
            actual: serializedBytes,
            budget: SESSION_EXPORT_GUARDRAIL_BUDGETS.warningSerializedBytes,
        });
    }

    if (responseCount > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxResponses) {
        pushIssue(issues, {
            severity: 'invalid',
            code: 'response_count_exceeded',
            path: 'responses',
            message: 'Session export read model exceeds the retained-response budget.',
            actual: responseCount,
            budget: SESSION_EXPORT_GUARDRAIL_BUDGETS.maxResponses,
        });
    }

    if (providerRowCount > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxProviderRows) {
        pushIssue(issues, {
            severity: 'warning',
            code: 'provider_row_budget_warning',
            path: 'providers',
            message: 'Session export provider projections are larger than the preferred row budget.',
            actual: providerRowCount,
            budget: SESSION_EXPORT_GUARDRAIL_BUDGETS.maxProviderRows,
        });
    }

    if (diagnosticCount > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxDiagnostics) {
        pushIssue(issues, {
            severity: 'warning',
            code: 'diagnostic_budget_warning',
            path: 'providers.diagnostics',
            message: 'Session export diagnostics are larger than the preferred diagnostic budget.',
            actual: diagnosticCount,
            budget: SESSION_EXPORT_GUARDRAIL_BUDGETS.maxDiagnostics,
        });
    }

    if (diagramVersionCount > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxDiagramVersions) {
        pushIssue(issues, {
            severity: 'warning',
            code: 'diagram_version_budget_warning',
            path: 'diagrams.timeline.items',
            message: 'Session export diagram timeline is larger than the preferred retained-version budget.',
            actual: diagramVersionCount,
            budget: SESSION_EXPORT_GUARDRAIL_BUDGETS.maxDiagramVersions,
        });
    }

    return {
        responseCount,
        providerRowCount,
        diagnosticCount,
        diagramVersionCount,
    };
}

export function redactSessionExportGuardrailValue<T>(value: T): T {
    return redactSessionExportValue(value);
}

export function validateSessionExportReadModel(model: unknown): SessionExportGuardrailResult {
    const issues: SessionExportGuardrailIssue[] = [];
    let serializedBytes = 0;

    try {
        serializedBytes = serializedByteLength(model);
    } catch (error) {
        pushIssue(issues, {
            severity: 'invalid',
            code: 'serialization_failed',
            path: '$',
            message: 'Session export read model must be JSON-serializable.',
            actual: error instanceof Error ? error.message : String(error),
        });
    }

    const record = asRecord(model);
    if (!record) {
        pushIssue(issues, {
            severity: 'invalid',
            code: 'model_shape_invalid',
            path: '$',
            message: 'Session export read model must be an object.',
        });
        return buildResult({
            issues,
            responseCount: 0,
            providerRowCount: 0,
            diagnosticCount: 0,
            diagramVersionCount: 0,
            serializedBytes,
        });
    }

    validateShape(record, issues);
    validateRetainedReferences(record, issues);
    collectLeakageIssues(record, '$', issues);
    const counts = validateBudgets(record as Partial<SessionExportReadModel>, issues, serializedBytes);

    return buildResult({
        issues,
        ...counts,
        serializedBytes,
    });
}
