import {
    SESSION_EXPORT_GUARDRAIL_BUDGETS,
    type SessionExportGuardrailIssue,
} from '../../lib/export/sessionExportGuardrails';
import type { SessionExportReadModel } from '../../lib/export/sessionExportReadModel';
import {
    generateSessionExportHtmlReport,
    generateSessionExportMarkdownReport,
    type SessionExportReport,
    type SessionExportReportFormat,
} from '../../lib/export/sessionExportReportGenerator';

export type ExportPreviewFormat = SessionExportReportFormat;

export interface ExportPreviewIssueSummary {
    severity: SessionExportGuardrailIssue['severity'];
    code: string;
    path: string;
    message: string;
}

export type ExportGuardrailFeedbackBudgetStatus = 'ok' | 'warning' | 'invalid';

export interface ExportGuardrailFeedbackBudget {
    label: string;
    actual: string;
    budget: string;
    status: ExportGuardrailFeedbackBudgetStatus;
}

export interface ExportGuardrailFeedbackReason {
    severity: SessionExportGuardrailIssue['severity'];
    code: string;
    count: number;
    message: string;
}

export interface ExportGuardrailFeedback {
    status: SessionExportReport['validation']['status'];
    headline: string;
    detail: string;
    canPreviewReport: boolean;
    issueCount: number;
    warningCount: number;
    invalidCount: number;
    budgetItems: ExportGuardrailFeedbackBudget[];
    reasonSummary: ExportGuardrailFeedbackReason[];
}

export interface ExportPreviewModel {
    format: ExportPreviewFormat;
    formatLabel: string;
    guardrailStatus: SessionExportReport['validation']['status'];
    warningCount: number;
    blocked: boolean;
    sectionCount: number;
    includedSections: string[];
    privacyExclusions: readonly string[];
    issueSummary: ExportPreviewIssueSummary[];
    guardrailFeedback: ExportGuardrailFeedback;
    contentPreview: string;
    privacyNotice: string;
    redactionNotice: string;
}

const REPORT_SECTION_NAMES = Object.freeze([
    'Session',
    'Responses',
    'Provider Routing',
    'Provider Fallbacks',
    'Provider Telemetry',
    'Provider Diagnostics',
    'Provider Personalization Impact',
    'Diagrams',
    'Diagram Timeline',
    'Diagram Evolution',
    'Diagram Guardrails',
    'Personalization',
] as const);

function formatLabel(format: ExportPreviewFormat): string {
    return format === 'html' ? 'HTML' : 'Markdown';
}

function buildReport(model: SessionExportReadModel, format: ExportPreviewFormat): SessionExportReport {
    return format === 'html'
        ? generateSessionExportHtmlReport(model)
        : generateSessionExportMarkdownReport(model);
}

function buildIncludedSections(report: SessionExportReport): string[] {
    if (report.blocked) {
        return ['Export Blocked', 'Reason Summary'];
    }

    return [
        ...REPORT_SECTION_NAMES,
        ...(report.validation.issues.length > 0 ? ['Guardrail Warnings'] : []),
    ];
}

function summarizeIssues(issues: SessionExportGuardrailIssue[]): ExportPreviewIssueSummary[] {
    return issues.map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        path: issue.path,
        message: issue.message,
    }));
}

function formatCount(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB'] as const;
    let unitIndex = 0;
    let amount = value;
    while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024;
        unitIndex += 1;
    }
    const precision = unitIndex === 0 || amount >= 10 ? 0 : 1;
    return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

function summarizeGuardrailReasons(issues: SessionExportGuardrailIssue[]): ExportGuardrailFeedbackReason[] {
    const summaries = new Map<string, ExportGuardrailFeedbackReason>();

    issues.forEach((issue) => {
        const key = `${issue.severity}:${issue.code}:${issue.message}`;
        const existing = summaries.get(key);
        if (existing) {
            existing.count += 1;
            return;
        }

        summaries.set(key, {
            severity: issue.severity,
            code: issue.code,
            count: 1,
            message: issue.message,
        });
    });

    return [...summaries.values()].sort((left, right) => {
        if (left.severity !== right.severity) {
            return left.severity === 'invalid' ? -1 : 1;
        }
        return left.code.localeCompare(right.code);
    });
}

function buildGuardrailFeedback(report: SessionExportReport): ExportGuardrailFeedback {
    const validation = report.validation;
    const warningCount = validation.issues.filter((issue) => issue.severity === 'warning').length;
    const invalidCount = validation.issues.filter((issue) => issue.severity === 'invalid').length;
    const payloadBudget = validation.serializedBytes > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxSerializedBytes
        ? 'invalid'
        : validation.serializedBytes > SESSION_EXPORT_GUARDRAIL_BUDGETS.warningSerializedBytes
            ? 'warning'
            : 'ok';
    const responseBudget: ExportGuardrailFeedbackBudgetStatus = validation.responseCount > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxResponses
        ? 'invalid'
        : 'ok';
    const providerRowsBudget: ExportGuardrailFeedbackBudgetStatus = validation.providerRowCount > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxProviderRows
        ? 'warning'
        : 'ok';
    const diagnosticBudget: ExportGuardrailFeedbackBudgetStatus = validation.diagnosticCount > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxDiagnostics
        ? 'warning'
        : 'ok';
    const diagramVersionBudget: ExportGuardrailFeedbackBudgetStatus = validation.diagramVersionCount > SESSION_EXPORT_GUARDRAIL_BUDGETS.maxDiagramVersions
        ? 'warning'
        : 'ok';

    return {
        status: validation.status,
        headline: report.blocked
            ? 'Export Blocked'
            : validation.status === 'warning'
                ? 'Export Has Warnings'
                : 'Export Ready For Review',
        detail: report.blocked
            ? 'Privacy or shape guardrails blocked report preview. Sensitive values are omitted from this reason summary.'
            : validation.status === 'warning'
                ? 'The report remains previewable, but review guardrail warnings before delivery is added in a later phase.'
                : 'No guardrail warnings were detected for this preview.',
        canPreviewReport: !report.blocked,
        issueCount: validation.issues.length,
        warningCount,
        invalidCount,
        budgetItems: [
            {
                label: 'Responses',
                actual: formatCount(validation.responseCount),
                budget: formatCount(SESSION_EXPORT_GUARDRAIL_BUDGETS.maxResponses),
                status: responseBudget,
            },
            {
                label: 'Provider Rows',
                actual: formatCount(validation.providerRowCount),
                budget: formatCount(SESSION_EXPORT_GUARDRAIL_BUDGETS.maxProviderRows),
                status: providerRowsBudget,
            },
            {
                label: 'Diagnostics',
                actual: formatCount(validation.diagnosticCount),
                budget: formatCount(SESSION_EXPORT_GUARDRAIL_BUDGETS.maxDiagnostics),
                status: diagnosticBudget,
            },
            {
                label: 'Diagram Versions',
                actual: formatCount(validation.diagramVersionCount),
                budget: formatCount(SESSION_EXPORT_GUARDRAIL_BUDGETS.maxDiagramVersions),
                status: diagramVersionBudget,
            },
            {
                label: 'Payload Size',
                actual: formatBytes(validation.serializedBytes),
                budget: `${formatBytes(SESSION_EXPORT_GUARDRAIL_BUDGETS.warningSerializedBytes)} warning / ${formatBytes(SESSION_EXPORT_GUARDRAIL_BUDGETS.maxSerializedBytes)} max`,
                status: payloadBudget,
            },
        ],
        reasonSummary: summarizeGuardrailReasons(validation.issues),
    };
}

export function buildExportPreviewModel(
    model: SessionExportReadModel,
    format: ExportPreviewFormat,
): ExportPreviewModel {
    const report = buildReport(model, format);
    const warnings = report.validation.issues.filter((issue) => issue.severity === 'warning');

    return {
        format,
        formatLabel: formatLabel(format),
        guardrailStatus: report.validation.status,
        warningCount: warnings.length,
        blocked: report.blocked,
        sectionCount: report.sectionCount,
        includedSections: buildIncludedSections(report),
        privacyExclusions: model.privacy.excludedFields,
        issueSummary: summarizeIssues(report.validation.issues),
        guardrailFeedback: buildGuardrailFeedback(report),
        contentPreview: report.content,
        privacyNotice: 'Session exports use an allowlist projection and exclude response content, prompts, screenshots, transcripts, credentials, provider payloads, and raw diagram payloads.',
        redactionNotice: 'Local filesystem paths and unsupported payload fields are redacted or blocked before report rendering.',
    };
}
