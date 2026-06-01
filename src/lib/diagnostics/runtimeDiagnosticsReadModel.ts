import type { DiagramGuardrailReadModel } from '../../components/pro-v2/architecture/diagramGuardrails';
import type {
    SessionExportDeliveryRequestValidation,
    SessionExportPdfBufferValidation,
    SessionExportSaveResult,
} from '../export/sessionExportDelivery';
import type {
    SessionExportGuardrailIssue,
    SessionExportGuardrailResult,
} from '../export/sessionExportGuardrails';
import type { ResponseOwnership } from '../overlay/actionContextTypes';
import type {
    ProviderAnalyticsSessionSnapshotValidationIssue,
    ProviderAnalyticsSessionSnapshotValidationResult,
} from '../providers/providerAnalyticsSessionSnapshot';
import type {
    ProviderDiagnosticEntry,
    ProviderDiagnosticsReadModel,
    ProviderDiagnosticSeverity,
    ProviderDiagnosticSource,
} from '../providers/providerDiagnosticsReadModel';
import type {
    ProviderPersonalizationEntry,
    ProviderPersonalizationReadModel,
    ProviderPersonalizationStatus,
} from '../providers/providerPersonalizationReadModel';
import { deriveValidationRepairPolicy } from './validationRepairPolicy';

export type RuntimeDiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';

export type RuntimeDiagnosticDomain =
    | 'provider.health'
    | 'provider.routing'
    | 'provider.fallback'
    | 'provider.telemetry'
    | 'validation.contract'
    | 'validation.repair'
    | 'diagram.parse'
    | 'diagram.guardrail'
    | 'export.guardrail'
    | 'export.delivery'
    | 'snapshot.guardrail'
    | 'ipc.boundary'
    | 'runtime.electron'
    | 'preload.bridge'
    | 'ownership.lineage'
    | 'personalization.resolution'
    | 'history.selection';

export type RuntimeDiagnosticPrimitive = string | number | boolean | null;

export interface RuntimeDiagnosticEvent {
    id: string;
    timestamp: number;
    domain: RuntimeDiagnosticDomain;
    code: string;
    severity: RuntimeDiagnosticSeverity;
    source: string;
    message: string;
    responseId?: string;
    requestId?: string;
    questionTurnId?: string;
    provider?: string;
    model?: string;
    actionId?: string;
    routingReason?: string;
    recoverable: boolean;
    userVisible: boolean;
    sourceCode?: string;
    status?: string;
    redactedContext?: Record<string, RuntimeDiagnosticPrimitive>;
}

export interface RuntimeDiagnosticsSummary {
    totalEvents: number;
    infoCount: number;
    warningCount: number;
    errorCount: number;
    criticalCount: number;
    recoverableCount: number;
    userVisibleCount: number;
    byDomain: Record<string, number>;
    bySeverity: Record<string, number>;
}

export interface RuntimeDiagnosticsReadModel {
    events: RuntimeDiagnosticEvent[];
    byId: Record<string, RuntimeDiagnosticEvent>;
    byDomain: Record<string, RuntimeDiagnosticEvent[]>;
    bySeverity: Record<string, RuntimeDiagnosticEvent[]>;
    byResponseId: Record<string, RuntimeDiagnosticEvent[]>;
    activeResponseId?: string;
    activeEvents: RuntimeDiagnosticEvent[];
    summary: RuntimeDiagnosticsSummary;
    generatedAt: number;
}

export interface RuntimeValidationMetadataInput {
    responseId?: string;
    requestId?: string;
    questionTurnId?: string;
    actionId?: string;
    valid?: boolean;
    warnings?: string[];
    issues?: string[];
    repairApplied?: boolean;
    status?: string;
    source?: string;
    timestamp?: number;
}

export interface RuntimePdfDeliveryDiagnosticsInput {
    format?: 'pdf' | 'html' | 'markdown' | string;
    timestamp?: number;
    requestValidation?: SessionExportDeliveryRequestValidation | null;
    bufferValidation?: SessionExportPdfBufferValidation | null;
    saveResult?: SessionExportSaveResult | null;
}

export interface RuntimeIpcBoundaryDiagnosticsInput {
    channel?: string;
    operation?: string;
    code?: string;
    valid?: boolean;
    success?: boolean;
    error?: string;
    message?: string;
    source?: string;
    timestamp?: number;
    requestId?: string;
    responseId?: string;
    recoverable?: boolean;
    userVisible?: boolean;
}

export interface RuntimePreloadBridgeDiagnosticsInput {
    api?: string;
    code?: string;
    initialized?: boolean;
    available?: boolean;
    valid?: boolean;
    missingApis?: string[];
    error?: string;
    message?: string;
    source?: string;
    timestamp?: number;
    recoverable?: boolean;
    userVisible?: boolean;
}

export interface RuntimeElectronDiagnosticsInput {
    operation?: string;
    code?: string;
    success?: boolean;
    error?: string;
    message?: string;
    source?: string;
    timestamp?: number;
    recoverable?: boolean;
    userVisible?: boolean;
    severity?: RuntimeDiagnosticSeverity;
}

export interface RuntimeHistorySelectionDiagnosticsInput {
    activeResponseId?: string | null;
    selectedResponseId?: string | null;
    latestResponseId?: string | null;
    selectionMode?: string;
    responseIds?: string[];
    ownershipByResponseId?: Record<string, RuntimeOwnershipDiagnosticsEntry | undefined>;
    issues?: string[];
    source?: string;
    timestamp?: number;
}

export type RuntimeDiagramParseState = 'ready' | 'loading' | 'missing' | 'invalid' | string;

export interface RuntimeDiagramParseDiagnosticsInput {
    responseId?: string;
    artifactId?: string;
    source?: string;
    timestamp?: number;
    parsed: {
        state: RuntimeDiagramParseState;
        issues: string[];
    };
}

export type RuntimeOwnershipDiagnosticsEntry = Partial<ResponseOwnership> & {
    rootResponseId?: string;
};

export interface RuntimeDiagnosticsReadModelInput {
    providerDiagnostics?: ProviderDiagnosticsReadModel | null;
    diagramGuardrails?: DiagramGuardrailReadModel | DiagramGuardrailReadModel[] | null;
    exportGuardrails?: SessionExportGuardrailResult | null;
    snapshotValidation?: ProviderAnalyticsSessionSnapshotValidationResult | null;
    validationMetadata?: RuntimeValidationMetadataInput[];
    ownershipByResponseId?: Record<string, RuntimeOwnershipDiagnosticsEntry | undefined>;
    retainedResponseIds?: string[];
    personalization?: ProviderPersonalizationReadModel | null;
    pdfDelivery?: RuntimePdfDeliveryDiagnosticsInput | null;
    ipcBoundary?: RuntimeIpcBoundaryDiagnosticsInput | RuntimeIpcBoundaryDiagnosticsInput[] | null;
    preloadBridge?: RuntimePreloadBridgeDiagnosticsInput | RuntimePreloadBridgeDiagnosticsInput[] | null;
    electronRuntime?: RuntimeElectronDiagnosticsInput | RuntimeElectronDiagnosticsInput[] | null;
    historySelection?: RuntimeHistorySelectionDiagnosticsInput | RuntimeHistorySelectionDiagnosticsInput[] | null;
    diagramParse?: RuntimeDiagramParseDiagnosticsInput | RuntimeDiagramParseDiagnosticsInput[] | null;
    activeResponseId?: string | null;
    generatedAt?: number;
}

const LOCAL_PATH_PATTERN = /(?:\/(?:Users|home|private|var|tmp|Applications|Volumes)\/[^\s"'<>]+)|(?:[A-Za-z]:\\[^\s"'<>]+)/g;
const MAX_MESSAGE_LENGTH = 220;

function sanitizeText(value: string): string {
    const cleaned = value
        .replace(LOCAL_PATH_PATTERN, '[local-path-redacted]')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.length > MAX_MESSAGE_LENGTH
        ? `${cleaned.slice(0, MAX_MESSAGE_LENGTH - 3)}...`
        : cleaned;
}

function sanitizeCodePart(value: unknown): string {
    return sanitizeText(String(value ?? 'unknown'))
        .toLowerCase()
        .replace(/[^a-z0-9_.:-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'unknown';
}

function buildEventId(parts: Array<string | number | undefined | null>): string {
    return parts.map(sanitizeCodePart).join(':');
}

function compactMessage(prefix: string, detail: string): string {
    return sanitizeText(`${prefix}: ${detail}`);
}

function count(map: Record<string, number>, key?: string): void {
    if (!key) return;
    map[key] = (map[key] ?? 0) + 1;
}

function pushContext(
    context: Record<string, RuntimeDiagnosticPrimitive>,
    key: string,
    value: unknown,
): void {
    if (value === undefined) return;
    if (value === null) {
        context[key] = null;
        return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        context[key] = value;
        return;
    }
    if (typeof value === 'string') {
        context[key] = sanitizeText(value);
    }
}

function withContext(
    values: Record<string, unknown>,
): Record<string, RuntimeDiagnosticPrimitive> | undefined {
    const context: Record<string, RuntimeDiagnosticPrimitive> = {};
    for (const [key, value] of Object.entries(values)) {
        pushContext(context, key, value);
    }
    return Object.keys(context).length > 0 ? context : undefined;
}

function providerDomain(source: ProviderDiagnosticSource): RuntimeDiagnosticDomain {
    if (source === 'health') return 'provider.health';
    if (source === 'routing') return 'provider.routing';
    if (source === 'fallback') return 'provider.fallback';
    return 'provider.telemetry';
}

function mapProviderSeverity(severity: ProviderDiagnosticSeverity): RuntimeDiagnosticSeverity {
    return severity;
}

function normalizeProviderDiagnostics(
    readModel: ProviderDiagnosticsReadModel | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    if (!readModel) return [];

    return readModel.diagnostics.map((diagnostic: ProviderDiagnosticEntry): RuntimeDiagnosticEvent => {
        const domain = providerDomain(diagnostic.source);
        return {
            id: buildEventId(['runtime', domain, diagnostic.id]),
            timestamp: diagnostic.createdAt ?? readModel.generatedAt ?? generatedAt,
            domain,
            code: diagnostic.category,
            severity: mapProviderSeverity(diagnostic.severity),
            source: 'provider_diagnostics',
            message: sanitizeText(diagnostic.message),
            responseId: diagnostic.responseId,
            requestId: diagnostic.requestId,
            questionTurnId: diagnostic.questionTurnId,
            provider: diagnostic.provider,
            model: diagnostic.model,
            actionId: diagnostic.actionId,
            routingReason: diagnostic.routingReason,
            recoverable: diagnostic.severity !== 'error' || diagnostic.actionable,
            userVisible: true,
            sourceCode: diagnostic.category,
            status: diagnostic.source,
            redactedContext: withContext({
                title: diagnostic.title,
                actionable: diagnostic.actionable,
                actionLabel: diagnostic.actionLabel,
            }),
        };
    });
}

function normalizeDiagramGuardrails(
    guardrails: DiagramGuardrailReadModel | DiagramGuardrailReadModel[] | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    const items = Array.isArray(guardrails)
        ? guardrails
        : guardrails
            ? [guardrails]
            : [];
    const events: RuntimeDiagnosticEvent[] = [];

    items.forEach((guardrail, guardrailIndex) => {
        if (guardrail.status === 'supported' && guardrail.issues.length === 0) return;

        guardrail.issues.forEach((issue, issueIndex) => {
            events.push({
                id: buildEventId([
                    'runtime',
                    'diagram.guardrail',
                    guardrail.responseId ?? guardrail.artifactId ?? guardrailIndex,
                    issueIndex,
                    issue,
                ]),
                timestamp: generatedAt,
                domain: 'diagram.guardrail',
                code: issue,
                severity: 'warning',
                source: 'diagram_guardrails',
                message: compactMessage('Diagram guardrail', issue),
                responseId: guardrail.responseId ?? undefined,
                recoverable: true,
                userVisible: true,
                sourceCode: issue,
                status: guardrail.status,
                redactedContext: withContext({
                    artifactId: guardrail.artifactId,
                    diagramSource: guardrail.diagramSource,
                    nodes: guardrail.counts.nodes,
                    edges: guardrail.counts.edges,
                    layoutDensity: guardrail.layout.density,
                }),
            });
        });
    });

    return events;
}

function diagramParseSeverity(state?: string, issue?: string): RuntimeDiagnosticSeverity {
    if (state === 'invalid' || issue === 'parse_error') return 'error';
    return 'warning';
}

function normalizeDiagramParseInputs(
    diagramParse: RuntimeDiagramParseDiagnosticsInput | RuntimeDiagramParseDiagnosticsInput[] | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    const entries = Array.isArray(diagramParse)
        ? diagramParse
        : diagramParse
            ? [diagramParse]
            : [];
    const events: RuntimeDiagnosticEvent[] = [];

    entries.forEach((entry, entryIndex) => {
        const issues = entry.parsed.issues.length > 0
            ? entry.parsed.issues
            : entry.parsed.state === 'ready'
                ? []
                : [`diagram_parse_${entry.parsed.state}`];

        issues.forEach((issue, issueIndex) => {
            events.push({
                id: buildEventId(['runtime', 'diagram.parse', entry.responseId ?? entry.artifactId ?? entryIndex, issueIndex, issue]),
                timestamp: entry.timestamp ?? generatedAt,
                domain: 'diagram.parse',
                code: issue,
                severity: diagramParseSeverity(entry.parsed.state, issue),
                source: entry.source ?? 'diagram_parse',
                message: compactMessage('Diagram parse', issue),
                responseId: entry.responseId,
                recoverable: true,
                userVisible: true,
                sourceCode: issue,
                status: entry.parsed.state,
                redactedContext: withContext({
                    artifactId: entry.artifactId,
                    state: entry.parsed.state,
                }),
            });
        });
    });

    return events;
}

function normalizeDiagramParseFromGuardrails(
    guardrails: DiagramGuardrailReadModel | DiagramGuardrailReadModel[] | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    const items = Array.isArray(guardrails)
        ? guardrails
        : guardrails
            ? [guardrails]
            : [];
    const events: RuntimeDiagnosticEvent[] = [];

    items.forEach((guardrail, guardrailIndex) => {
        guardrail.parserCaps.parserIssues.forEach((issue, issueIndex) => {
            events.push({
                id: buildEventId(['runtime', 'diagram.parse', guardrail.responseId ?? guardrail.artifactId ?? guardrailIndex, issueIndex, issue]),
                timestamp: generatedAt,
                domain: 'diagram.parse',
                code: issue,
                severity: diagramParseSeverity(guardrail.status, issue),
                source: 'diagram_guardrails',
                message: compactMessage('Diagram parse', issue),
                responseId: guardrail.responseId ?? undefined,
                recoverable: true,
                userVisible: true,
                sourceCode: issue,
                status: guardrail.status,
                redactedContext: withContext({
                    artifactId: guardrail.artifactId,
                    parserNodeCap: guardrail.parserCaps.nodeCap,
                    parserEdgeCap: guardrail.parserCaps.edgeCap,
                }),
            });
        });
    });

    return events;
}

function isExportCriticalIssue(issue: SessionExportGuardrailIssue): boolean {
    return (
        issue.code.includes('content_leakage')
        || issue.code.includes('local_path')
        || issue.code === 'privacy_contract_invalid'
    );
}

function normalizeExportGuardrails(
    guardrails: SessionExportGuardrailResult | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    if (!guardrails) return [];

    return guardrails.issues.map((issue, index): RuntimeDiagnosticEvent => ({
        id: buildEventId(['runtime', 'export.guardrail', index, issue.code, issue.path]),
        timestamp: generatedAt,
        domain: 'export.guardrail',
        code: issue.code,
        severity: isExportCriticalIssue(issue)
            ? 'critical'
            : issue.severity === 'invalid'
                ? 'error'
                : 'warning',
        source: 'export_guardrails',
        message: sanitizeText(issue.message),
        recoverable: issue.severity !== 'invalid',
        userVisible: true,
        sourceCode: issue.code,
        status: issue.severity,
        redactedContext: withContext({
            path: issue.path,
            actual: typeof issue.actual === 'number' ? issue.actual : undefined,
            budget: issue.budget,
            responseCount: guardrails.responseCount,
            providerRowCount: guardrails.providerRowCount,
            diagnosticCount: guardrails.diagnosticCount,
            diagramVersionCount: guardrails.diagramVersionCount,
        }),
    }));
}

function isSnapshotCriticalIssue(issue: ProviderAnalyticsSessionSnapshotValidationIssue): boolean {
    return (
        issue.code.includes('content_leakage')
        || issue.code === 'metadata_only_shape_violation'
    );
}

function normalizeSnapshotGuardrails(
    validation: ProviderAnalyticsSessionSnapshotValidationResult | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    if (!validation) return [];

    return validation.issues.map((issue, index): RuntimeDiagnosticEvent => ({
        id: buildEventId(['runtime', 'snapshot.guardrail', index, issue.code, issue.path]),
        timestamp: generatedAt,
        domain: 'snapshot.guardrail',
        code: issue.code,
        severity: isSnapshotCriticalIssue(issue)
            ? 'critical'
            : issue.severity === 'invalid'
                ? 'error'
                : 'warning',
        source: 'snapshot_guardrails',
        message: sanitizeText(issue.message),
        recoverable: issue.severity !== 'invalid',
        userVisible: false,
        sourceCode: issue.code,
        status: issue.severity,
        redactedContext: withContext({
            path: issue.path,
            actual: typeof issue.actual === 'number' ? issue.actual : undefined,
            budget: issue.budget,
            responseCount: validation.responseCount,
            ownershipEntryCount: validation.ownershipEntryCount,
            serializedBytes: validation.serializedBytes,
        }),
    }));
}

function normalizeValidationMetadata(
    validationMetadata: RuntimeValidationMetadataInput[] | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    const events: RuntimeDiagnosticEvent[] = [];
    const entries = validationMetadata ?? [];

    entries.forEach((entry, entryIndex) => {
        const warnings = entry.warnings ?? [];
        const issues = entry.issues ?? [];

        warnings.forEach((warning, warningIndex) => {
            const repairPolicy = deriveValidationRepairPolicy({
                valid: entry.valid,
                repairApplied: entry.repairApplied,
                status: entry.status,
                sourceCode: warning,
                warnings: [warning],
            });
            if (repairPolicy) {
                events.push({
                    id: buildEventId([
                        'runtime',
                        'validation.repair',
                        entry.responseId ?? entryIndex,
                        'warning',
                        warningIndex,
                        repairPolicy.outcome,
                        repairPolicy.sourceCode,
                    ]),
                    timestamp: entry.timestamp ?? generatedAt,
                    domain: 'validation.repair',
                    code: repairPolicy.outcome,
                    severity: repairPolicy.severity,
                    source: entry.source ?? 'validation_metadata',
                    message: repairPolicy.message,
                    responseId: entry.responseId,
                    requestId: entry.requestId,
                    questionTurnId: entry.questionTurnId,
                    actionId: entry.actionId,
                    recoverable: repairPolicy.recoverable,
                    userVisible: repairPolicy.userVisible,
                    sourceCode: repairPolicy.sourceCode,
                    status: repairPolicy.classification,
                    redactedContext: withContext({
                        repairOutcome: repairPolicy.outcome,
                        repairClassification: repairPolicy.classification,
                        validationStatus: entry.status,
                        validationValid: entry.valid,
                    }),
                });
                return;
            }

            events.push({
                id: buildEventId(['runtime', 'validation.contract', entry.responseId ?? entryIndex, 'warning', warningIndex, warning]),
                timestamp: entry.timestamp ?? generatedAt,
                domain: 'validation.contract',
                code: warning,
                severity: 'warning',
                source: entry.source ?? 'validation_metadata',
                message: compactMessage('Validation warning', warning),
                responseId: entry.responseId,
                requestId: entry.requestId,
                questionTurnId: entry.questionTurnId,
                actionId: entry.actionId,
                recoverable: true,
                userVisible: false,
                sourceCode: warning,
                status: entry.status ?? (entry.valid === false ? 'invalid' : 'valid'),
            });
        });

        if (entry.repairApplied && entry.valid === true) {
            const repairPolicy = deriveValidationRepairPolicy({
                valid: entry.valid,
                repairApplied: entry.repairApplied,
                status: entry.status,
                sourceCode: 'repair_applied',
            });
            if (!repairPolicy) return;
            events.push({
                id: buildEventId(['runtime', 'validation.repair', entry.responseId ?? entryIndex, repairPolicy.outcome, repairPolicy.sourceCode]),
                timestamp: entry.timestamp ?? generatedAt,
                domain: 'validation.repair',
                code: repairPolicy.outcome,
                severity: repairPolicy.severity,
                source: entry.source ?? 'validation_metadata',
                message: repairPolicy.message,
                responseId: entry.responseId,
                requestId: entry.requestId,
                questionTurnId: entry.questionTurnId,
                actionId: entry.actionId,
                recoverable: repairPolicy.recoverable,
                userVisible: repairPolicy.userVisible,
                sourceCode: repairPolicy.sourceCode,
                status: repairPolicy.classification,
                redactedContext: withContext({
                    repairOutcome: repairPolicy.outcome,
                    repairClassification: repairPolicy.classification,
                    validationStatus: entry.status,
                    validationValid: entry.valid,
                }),
            });
        }

        if (entry.valid !== false) return;

        let emittedRepairIssue = false;
        issues.forEach((issue, issueIndex) => {
            const repairPolicy = deriveValidationRepairPolicy({
                valid: entry.valid,
                repairApplied: entry.repairApplied,
                status: entry.status,
                sourceCode: issue,
                issues: [issue],
            });
            if (repairPolicy) {
                emittedRepairIssue = true;
                events.push({
                    id: buildEventId([
                        'runtime',
                        'validation.repair',
                        entry.responseId ?? entryIndex,
                        issueIndex,
                        repairPolicy.outcome,
                        repairPolicy.sourceCode,
                    ]),
                    timestamp: entry.timestamp ?? generatedAt,
                    domain: 'validation.repair',
                    code: repairPolicy.outcome,
                    severity: repairPolicy.severity,
                    source: entry.source ?? 'validation_metadata',
                    message: repairPolicy.message,
                    responseId: entry.responseId,
                    requestId: entry.requestId,
                    questionTurnId: entry.questionTurnId,
                    actionId: entry.actionId,
                    recoverable: repairPolicy.recoverable,
                    userVisible: repairPolicy.userVisible,
                    sourceCode: repairPolicy.sourceCode,
                    status: repairPolicy.classification,
                    redactedContext: withContext({
                        repairApplied: entry.repairApplied,
                        repairOutcome: repairPolicy.outcome,
                        repairClassification: repairPolicy.classification,
                        validationStatus: entry.status,
                    }),
                });
                return;
            }

            events.push({
                id: buildEventId(['runtime', 'validation.contract', entry.responseId ?? entryIndex, issueIndex, issue]),
                timestamp: entry.timestamp ?? generatedAt,
                domain: 'validation.contract',
                code: issue,
                severity: 'error',
                source: entry.source ?? 'validation_metadata',
                message: compactMessage('Validation contract failed', issue),
                responseId: entry.responseId,
                requestId: entry.requestId,
                questionTurnId: entry.questionTurnId,
                actionId: entry.actionId,
                recoverable: true,
                userVisible: false,
                sourceCode: issue,
                status: entry.status ?? 'invalid',
                redactedContext: withContext({
                    repairApplied: entry.repairApplied,
                }),
            });
        });

        if (entry.repairApplied && !emittedRepairIssue) {
            const repairPolicy = deriveValidationRepairPolicy({
                valid: entry.valid,
                repairApplied: entry.repairApplied,
                status: entry.status,
            });
            if (!repairPolicy) return;
            events.push({
                id: buildEventId(['runtime', 'validation.repair', entry.responseId ?? entryIndex, 'entry', repairPolicy.outcome, repairPolicy.sourceCode]),
                timestamp: entry.timestamp ?? generatedAt,
                domain: 'validation.repair',
                code: repairPolicy.outcome,
                severity: repairPolicy.severity,
                source: entry.source ?? 'validation_metadata',
                message: repairPolicy.message,
                responseId: entry.responseId,
                requestId: entry.requestId,
                questionTurnId: entry.questionTurnId,
                actionId: entry.actionId,
                recoverable: repairPolicy.recoverable,
                userVisible: repairPolicy.userVisible,
                sourceCode: repairPolicy.sourceCode,
                status: repairPolicy.classification,
                redactedContext: withContext({
                    repairApplied: entry.repairApplied,
                    repairOutcome: repairPolicy.outcome,
                    repairClassification: repairPolicy.classification,
                    validationStatus: entry.status,
                }),
            });
        }
    });

    return events;
}

function normalizeOwnershipLineage(
    ownershipByResponseId: Record<string, RuntimeOwnershipDiagnosticsEntry | undefined> | undefined,
    retainedResponseIds: string[] | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    if (!ownershipByResponseId) return [];

    const retained = new Set(retainedResponseIds ?? Object.keys(ownershipByResponseId));
    const events: RuntimeDiagnosticEvent[] = [];

    Object.entries(ownershipByResponseId).forEach(([responseId, ownership]) => {
        if (!retained.has(responseId) || !ownership) return;

        if (ownership.responseId && ownership.responseId !== responseId) {
            events.push({
                id: buildEventId(['runtime', 'ownership.lineage', responseId, 'ownership_response_id_mismatch']),
                timestamp: ownership.createdAt ?? generatedAt,
                domain: 'ownership.lineage',
                code: 'ownership_response_id_mismatch',
                severity: 'error',
                source: 'response_ownership',
                message: 'Response ownership responseId does not match the retained response key.',
                responseId,
                questionTurnId: ownership.questionTurnId,
                actionId: ownership.actionId,
                recoverable: true,
                userVisible: false,
                sourceCode: 'ownership_response_id_mismatch',
                redactedContext: withContext({
                    ownershipResponseId: ownership.responseId,
                }),
            });
        }

        if (ownership.parentResponseId && !retained.has(ownership.parentResponseId)) {
            events.push({
                id: buildEventId(['runtime', 'ownership.lineage', responseId, 'parent_response_not_retained']),
                timestamp: ownership.createdAt ?? generatedAt,
                domain: 'ownership.lineage',
                code: 'parent_response_not_retained',
                severity: 'error',
                source: 'response_ownership',
                message: 'Response ownership parentResponseId does not reference a retained response.',
                responseId,
                questionTurnId: ownership.questionTurnId,
                actionId: ownership.actionId,
                recoverable: true,
                userVisible: false,
                sourceCode: 'parent_response_not_retained',
                redactedContext: withContext({
                    parentResponseId: ownership.parentResponseId,
                }),
            });
        }

        if (ownership.rootResponseId && !retained.has(ownership.rootResponseId)) {
            events.push({
                id: buildEventId(['runtime', 'ownership.lineage', responseId, 'root_response_not_retained']),
                timestamp: ownership.createdAt ?? generatedAt,
                domain: 'ownership.lineage',
                code: 'root_response_not_retained',
                severity: 'error',
                source: 'response_ownership',
                message: 'Response ownership rootResponseId does not reference a retained response.',
                responseId,
                questionTurnId: ownership.questionTurnId,
                actionId: ownership.actionId,
                recoverable: true,
                userVisible: false,
                sourceCode: 'root_response_not_retained',
                redactedContext: withContext({
                    rootResponseId: ownership.rootResponseId,
                }),
            });
        }
    });

    return events;
}

function personalizationSeverity(status: ProviderPersonalizationStatus): RuntimeDiagnosticSeverity | null {
    if (status === 'fallback' || status === 'remapped' || status === 'bypassed') return 'warning';
    if (status === 'not_captured') return 'info';
    return null;
}

function normalizePersonalization(
    readModel: ProviderPersonalizationReadModel | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    if (!readModel) return [];

    return readModel.entries
        .map((entry: ProviderPersonalizationEntry): RuntimeDiagnosticEvent | undefined => {
            const severity = personalizationSeverity(entry.providerPreferenceStatus);
            if (!severity) return undefined;

            return {
                id: buildEventId(['runtime', 'personalization.resolution', entry.responseId, entry.providerPreferenceStatus]),
                timestamp: entry.createdAt ?? readModel.generatedAt ?? generatedAt,
                domain: 'personalization.resolution',
                code: entry.providerPreferenceStatus,
                severity,
                source: 'provider_personalization',
                message: compactMessage('Provider personalization', entry.providerPreferenceStatus),
                responseId: entry.responseId,
                requestId: entry.requestId,
                questionTurnId: entry.questionTurnId,
                provider: entry.providerPreference,
                model: entry.requestedModel ?? entry.actualModel,
                actionId: entry.actionId,
                routingReason: entry.routingReason,
                recoverable: true,
                userVisible: false,
                sourceCode: entry.providerPreferenceStatus,
                status: entry.providerPreferenceStatus,
                redactedContext: withContext({
                    requestedProvider: entry.requestedProvider,
                    actualProvider: entry.actualProvider,
                    fallbackUsed: entry.fallbackUsed,
                    personalizationVersion: entry.personalizationVersion,
                }),
            };
        })
        .filter((event): event is RuntimeDiagnosticEvent => Boolean(event));
}

function normalizePdfDelivery(
    input: RuntimePdfDeliveryDiagnosticsInput | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    if (!input) return [];
    const events: RuntimeDiagnosticEvent[] = [];
    const timestamp = input.timestamp ?? generatedAt;
    const format = input.format ?? 'pdf';

    if (input.requestValidation && !input.requestValidation.valid) {
        events.push({
            id: buildEventId(['runtime', 'export.delivery', format, 'request_invalid']),
            timestamp,
            domain: 'export.delivery',
            code: format === 'pdf' ? 'pdf_request_invalid' : 'delivery_request_invalid',
            severity: 'error',
            source: 'export_delivery',
            message: sanitizeText(input.requestValidation.error ?? 'Export delivery request is invalid.'),
            recoverable: true,
            userVisible: true,
            sourceCode: 'request_invalid',
            status: 'invalid',
            redactedContext: withContext({ format }),
        });
    }

    if (input.bufferValidation) {
        if (!input.bufferValidation.valid) {
            events.push({
                id: buildEventId(['runtime', 'export.delivery', format, 'buffer_invalid']),
                timestamp,
                domain: 'export.delivery',
                code: 'pdf_buffer_invalid',
                severity: 'error',
                source: 'export_delivery',
                message: sanitizeText(input.bufferValidation.error ?? 'Generated PDF buffer is invalid.'),
                recoverable: true,
                userVisible: true,
                sourceCode: 'buffer_invalid',
                status: 'invalid',
                redactedContext: withContext({
                    format,
                    byteLength: input.bufferValidation.byteLength,
                }),
            });
        } else if (input.bufferValidation.warning) {
            events.push({
                id: buildEventId(['runtime', 'export.delivery', format, 'buffer_warning']),
                timestamp,
                domain: 'export.delivery',
                code: 'pdf_buffer_warning',
                severity: 'warning',
                source: 'export_delivery',
                message: sanitizeText(input.bufferValidation.warning),
                recoverable: true,
                userVisible: true,
                sourceCode: 'buffer_warning',
                status: 'warning',
                redactedContext: withContext({
                    format,
                    byteLength: input.bufferValidation.byteLength,
                }),
            });
        }
    }

    if (input.saveResult) {
        if (input.saveResult.canceled) {
            events.push({
                id: buildEventId(['runtime', 'export.delivery', format, 'save_canceled']),
                timestamp,
                domain: 'export.delivery',
                code: format === 'pdf' ? 'pdf_save_canceled' : 'save_canceled',
                severity: 'info',
                source: 'export_delivery',
                message: 'Export delivery was canceled before writing.',
                recoverable: true,
                userVisible: true,
                sourceCode: 'save_canceled',
                status: 'canceled',
                redactedContext: withContext({ format }),
            });
        } else if (!input.saveResult.success) {
            events.push({
                id: buildEventId(['runtime', 'export.delivery', format, 'save_failed']),
                timestamp,
                domain: 'export.delivery',
                code: format === 'pdf' ? 'pdf_save_failed' : 'save_failed',
                severity: 'error',
                source: 'export_delivery',
                message: sanitizeText(input.saveResult.error ?? 'Export delivery failed.'),
                recoverable: true,
                userVisible: true,
                sourceCode: 'save_failed',
                status: 'error',
                redactedContext: withContext({ format }),
            });
        }
    }

    return events;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function normalizeIpcBoundary(
    input: RuntimeIpcBoundaryDiagnosticsInput | RuntimeIpcBoundaryDiagnosticsInput[] | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    return asArray(input)
        .map((entry, index): RuntimeDiagnosticEvent | undefined => {
            const failed = entry.valid === false || entry.success === false || Boolean(entry.error);
            if (!failed) return undefined;
            const code = entry.code
                ?? (entry.valid === false ? 'ipc_contract_invalid' : entry.success === false ? 'ipc_request_failed' : 'ipc_error');
            return {
                id: buildEventId(['runtime', 'ipc.boundary', entry.channel ?? entry.operation ?? index, code]),
                timestamp: entry.timestamp ?? generatedAt,
                domain: 'ipc.boundary',
                code,
                severity: 'error',
                source: entry.source ?? 'ipc_boundary',
                message: sanitizeText(entry.message ?? entry.error ?? 'IPC boundary validation failed.'),
                responseId: entry.responseId,
                requestId: entry.requestId,
                recoverable: entry.recoverable ?? true,
                userVisible: entry.userVisible ?? false,
                sourceCode: code,
                status: entry.valid === false ? 'invalid' : 'error',
                redactedContext: withContext({
                    channel: entry.channel,
                    operation: entry.operation,
                }),
            };
        })
        .filter((event): event is RuntimeDiagnosticEvent => Boolean(event));
}

function normalizePreloadBridge(
    input: RuntimePreloadBridgeDiagnosticsInput | RuntimePreloadBridgeDiagnosticsInput[] | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    const events: RuntimeDiagnosticEvent[] = [];

    asArray(input).forEach((entry, index) => {
        const baseCode = entry.code
            ?? (entry.initialized === false ? 'preload_initialization_failed' : entry.available === false ? 'preload_api_missing' : entry.valid === false ? 'preload_bridge_invalid' : entry.error ? 'preload_bridge_error' : 'preload_bridge_warning');
        const failed = entry.initialized === false || entry.available === false || entry.valid === false || Boolean(entry.error);
        const missingApis = entry.missingApis ?? [];

        if (failed) {
            events.push({
                id: buildEventId(['runtime', 'preload.bridge', entry.api ?? index, baseCode]),
                timestamp: entry.timestamp ?? generatedAt,
                domain: 'preload.bridge',
                code: baseCode,
                severity: entry.initialized === false || entry.available === false ? 'critical' : 'error',
                source: entry.source ?? 'preload_bridge',
                message: sanitizeText(entry.message ?? entry.error ?? 'Preload bridge validation failed.'),
                recoverable: entry.recoverable ?? true,
                userVisible: entry.userVisible ?? false,
                sourceCode: baseCode,
                status: entry.initialized === false || entry.available === false || entry.valid === false ? 'invalid' : 'error',
                redactedContext: withContext({
                    api: entry.api,
                    missingApiCount: missingApis.length,
                }),
            });
        }

        missingApis.forEach((api, apiIndex) => {
            events.push({
                id: buildEventId(['runtime', 'preload.bridge', entry.api ?? index, apiIndex, api, 'missing_api']),
                timestamp: entry.timestamp ?? generatedAt,
                domain: 'preload.bridge',
                code: 'preload_api_missing',
                severity: 'critical',
                source: entry.source ?? 'preload_bridge',
                message: 'Preload bridge API is missing.',
                recoverable: entry.recoverable ?? true,
                userVisible: entry.userVisible ?? false,
                sourceCode: 'preload_api_missing',
                status: 'missing',
                redactedContext: withContext({
                    api,
                }),
            });
        });
    });

    return events;
}

function normalizeElectronRuntime(
    input: RuntimeElectronDiagnosticsInput | RuntimeElectronDiagnosticsInput[] | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    return asArray(input)
        .map((entry, index): RuntimeDiagnosticEvent | undefined => {
            const failed = entry.success === false || Boolean(entry.error) || Boolean(entry.code);
            if (!failed) return undefined;
            const code = entry.code ?? 'electron_runtime_failure';
            return {
                id: buildEventId(['runtime', 'runtime.electron', entry.operation ?? index, code]),
                timestamp: entry.timestamp ?? generatedAt,
                domain: 'runtime.electron',
                code,
                severity: entry.severity ?? 'error',
                source: entry.source ?? 'electron_runtime',
                message: sanitizeText(entry.message ?? entry.error ?? 'Electron runtime operation failed.'),
                recoverable: entry.recoverable ?? true,
                userVisible: entry.userVisible ?? false,
                sourceCode: code,
                status: entry.success === false ? 'failure' : 'error',
                redactedContext: withContext({
                    operation: entry.operation,
                }),
            };
        })
        .filter((event): event is RuntimeDiagnosticEvent => Boolean(event));
}

function normalizeHistorySelection(
    input: RuntimeHistorySelectionDiagnosticsInput | RuntimeHistorySelectionDiagnosticsInput[] | null | undefined,
    generatedAt: number,
): RuntimeDiagnosticEvent[] {
    const events: RuntimeDiagnosticEvent[] = [];

    asArray(input).forEach((entry, entryIndex) => {
        const retained = new Set(entry.responseIds ?? Object.keys(entry.ownershipByResponseId ?? {}));
        const source = entry.source ?? 'history_selection';
        const timestamp = entry.timestamp ?? generatedAt;
        const context = {
            selectionMode: entry.selectionMode,
            retainedResponseCount: retained.size,
            latestResponseId: entry.latestResponseId,
        };

        const pushHistoryEvent = (args: {
            code: string;
            responseId?: string | null;
            severity?: RuntimeDiagnosticSeverity;
            message: string;
            status?: string;
        }): void => {
            events.push({
                id: buildEventId(['runtime', 'history.selection', args.responseId ?? entryIndex, args.code]),
                timestamp,
                domain: 'history.selection',
                code: args.code,
                severity: args.severity ?? 'error',
                source,
                message: sanitizeText(args.message),
                responseId: args.responseId ?? undefined,
                recoverable: true,
                userVisible: false,
                sourceCode: args.code,
                status: args.status ?? 'invalid',
                redactedContext: withContext(context),
            });
        };

        if (entry.activeResponseId && !retained.has(entry.activeResponseId)) {
            pushHistoryEvent({
                code: 'active_response_not_retained',
                responseId: entry.activeResponseId,
                message: 'Active response selection does not reference retained history.',
            });
        }

        if (entry.selectedResponseId && !retained.has(entry.selectedResponseId)) {
            pushHistoryEvent({
                code: 'selected_response_not_retained',
                responseId: entry.selectedResponseId,
                severity: 'warning',
                message: 'Selected response does not reference retained history.',
            });
        }

        if (entry.latestResponseId && !retained.has(entry.latestResponseId)) {
            pushHistoryEvent({
                code: 'latest_response_not_retained',
                responseId: entry.latestResponseId,
                message: 'Latest response does not reference retained history.',
            });
        }

        Object.entries(entry.ownershipByResponseId ?? {}).forEach(([responseId, ownership]) => {
            if (!retained.has(responseId) || !ownership) return;
            if (ownership.parentResponseId && !retained.has(ownership.parentResponseId)) {
                pushHistoryEvent({
                    code: 'history_parent_response_not_retained',
                    responseId,
                    message: 'Retained response history contains a parentResponseId outside retained history.',
                });
            }
            if (ownership.rootResponseId && !retained.has(ownership.rootResponseId)) {
                pushHistoryEvent({
                    code: 'history_root_response_not_retained',
                    responseId,
                    message: 'Retained response history contains a rootResponseId outside retained history.',
                });
            }
        });

        (entry.issues ?? []).forEach((issue) => {
            pushHistoryEvent({
                code: issue,
                responseId: entry.activeResponseId ?? entry.selectedResponseId,
                severity: 'warning',
                message: compactMessage('History selection', issue),
                status: 'warning',
            });
        });
    });

    return events;
}

function groupBy(
    events: RuntimeDiagnosticEvent[],
    getKey: (event: RuntimeDiagnosticEvent) => string | undefined,
): Record<string, RuntimeDiagnosticEvent[]> {
    const groups = new Map<string, RuntimeDiagnosticEvent[]>();
    events.forEach((event) => {
        const key = getKey(event);
        if (!key) return;
        const group = groups.get(key) ?? [];
        group.push(event);
        groups.set(key, group);
    });
    return Object.fromEntries(groups.entries()) as Record<string, RuntimeDiagnosticEvent[]>;
}

function buildSummary(events: RuntimeDiagnosticEvent[]): RuntimeDiagnosticsSummary {
    const byDomain: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    events.forEach((event) => {
        count(byDomain, event.domain);
        count(bySeverity, event.severity);
    });

    return {
        totalEvents: events.length,
        infoCount: events.filter((event) => event.severity === 'info').length,
        warningCount: events.filter((event) => event.severity === 'warning').length,
        errorCount: events.filter((event) => event.severity === 'error').length,
        criticalCount: events.filter((event) => event.severity === 'critical').length,
        recoverableCount: events.filter((event) => event.recoverable).length,
        userVisibleCount: events.filter((event) => event.userVisible).length,
        byDomain,
        bySeverity,
    };
}

function ensureUniqueEventIds(events: RuntimeDiagnosticEvent[]): RuntimeDiagnosticEvent[] {
    const seen = new Map<string, number>();
    return events.map((event) => {
        const countForId = seen.get(event.id) ?? 0;
        seen.set(event.id, countForId + 1);
        if (countForId === 0) return event;
        return {
            ...event,
            id: `${event.id}:${countForId + 1}`,
        };
    });
}

export function buildRuntimeDiagnosticsReadModel(input: RuntimeDiagnosticsReadModelInput): RuntimeDiagnosticsReadModel {
    const generatedAt = input.generatedAt ?? Date.now();
    const activeResponseId = input.activeResponseId ?? undefined;
    const events = ensureUniqueEventIds([
        ...normalizeProviderDiagnostics(input.providerDiagnostics, generatedAt),
        ...normalizeDiagramParseInputs(input.diagramParse, generatedAt),
        ...normalizeDiagramParseFromGuardrails(input.diagramGuardrails, generatedAt),
        ...normalizeDiagramGuardrails(input.diagramGuardrails, generatedAt),
        ...normalizeExportGuardrails(input.exportGuardrails, generatedAt),
        ...normalizeSnapshotGuardrails(input.snapshotValidation, generatedAt),
        ...normalizeIpcBoundary(input.ipcBoundary, generatedAt),
        ...normalizeElectronRuntime(input.electronRuntime, generatedAt),
        ...normalizePreloadBridge(input.preloadBridge, generatedAt),
        ...normalizeValidationMetadata(input.validationMetadata, generatedAt),
        ...normalizeOwnershipLineage(input.ownershipByResponseId, input.retainedResponseIds, generatedAt),
        ...normalizePersonalization(input.personalization, generatedAt),
        ...normalizeHistorySelection(input.historySelection, generatedAt),
        ...normalizePdfDelivery(input.pdfDelivery, generatedAt),
    ]);
    const byId = Object.fromEntries(events.map((event) => [event.id, event])) as Record<string, RuntimeDiagnosticEvent>;
    const byResponseId = groupBy(events, (event) => event.responseId);

    return {
        events,
        byId,
        byDomain: groupBy(events, (event) => event.domain),
        bySeverity: groupBy(events, (event) => event.severity),
        byResponseId,
        activeResponseId,
        activeEvents: activeResponseId ? byResponseId[activeResponseId] ?? [] : [],
        summary: buildSummary(events),
        generatedAt,
    };
}
