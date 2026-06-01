import type { SessionExportGuardrailStatus } from './sessionExportGuardrails';
import type { SessionExportReportFormat } from './sessionExportReportGenerator';

export const SESSION_EXPORT_DELIVERY_IPC = {
    save: 'session-export:save-report',
    savePdf: 'session-export:save-pdf-report',
} as const;

export const SESSION_EXPORT_SAVE_BUDGETS = Object.freeze({
    maxContentBytes: 1024 * 1024,
    maxPdfHtmlBytes: 1024 * 1024,
});

export const SESSION_EXPORT_PDF_RUNTIME_BUDGETS = Object.freeze({
    renderTimeoutMs: 30_000,
    warningPdfBytes: 8 * 1024 * 1024,
    maxPdfBytes: 16 * 1024 * 1024,
});

export type SessionExportDeliveryFormat = SessionExportReportFormat | 'pdf';

export interface SessionExportSaveRequest {
    format: SessionExportReportFormat;
    content: string;
    generatedAt?: number;
    suggestedFileName?: string;
    guardrailStatus: Exclude<SessionExportGuardrailStatus, 'invalid'>;
    blocked: false;
}

export interface SessionExportPdfSaveRequest {
    sourceFormat: 'html';
    html: string;
    generatedAt?: number;
    suggestedFileName?: string;
    guardrailStatus: Exclude<SessionExportGuardrailStatus, 'invalid'>;
    blocked: false;
}

export type SessionExportDeliveryIpcChannel =
    (typeof SESSION_EXPORT_DELIVERY_IPC)[keyof typeof SESSION_EXPORT_DELIVERY_IPC];

export type SessionExportDeliveryIpcOperation =
    | 'validate_request'
    | 'show_save_dialog'
    | 'write_file'
    | 'render_pdf'
    | 'validate_pdf_buffer'
    | 'save_report'
    | 'save_pdf_report';

export interface SessionExportDeliveryIpcDiagnostic {
    channel: SessionExportDeliveryIpcChannel;
    operation: SessionExportDeliveryIpcOperation;
    code: string;
    valid?: boolean;
    success?: boolean;
    error?: string;
    message: string;
    source: 'session_export_delivery';
    timestamp: number;
    recoverable: boolean;
    userVisible: boolean;
}

export interface SessionExportSaveResult {
    success: boolean;
    canceled?: boolean;
    filePath?: string;
    error?: string;
    diagnostic?: SessionExportDeliveryIpcDiagnostic;
}

export type SessionExportPdfSaveResult = SessionExportSaveResult;

export interface SessionExportClipboardRequest {
    format: SessionExportReportFormat;
    content: string;
    guardrailStatus: Exclude<SessionExportGuardrailStatus, 'invalid'>;
    blocked: false;
}

export interface SessionExportDeliveryRequestValidation {
    valid: boolean;
    error?: string;
}

export interface SessionExportPdfBufferValidation {
    valid: boolean;
    byteLength: number;
    warning?: string;
    error?: string;
}

export function getSessionExportFileExtension(format: SessionExportDeliveryFormat): 'md' | 'html' | 'pdf' {
    if (format === 'pdf') return 'pdf';
    return format === 'html' ? 'html' : 'md';
}

function sanitizeFileNamePart(value: string): string {
    return value
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

export function buildSessionExportDefaultFileName(
    format: SessionExportDeliveryFormat,
    generatedAt: number = Date.now(),
): string {
    const timestamp = Number.isFinite(generatedAt)
        ? new Date(generatedAt).toISOString()
        : new Date().toISOString();
    const safeTimestamp = sanitizeFileNamePart(timestamp.replace(/\.\d{3}Z$/, 'Z'));
    return `TeamSync Session Report - ${safeTimestamp}.${getSessionExportFileExtension(format)}`;
}

function serializedByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

const SESSION_EXPORT_LOCAL_PATH_PATTERN = /(?:\/(?:Users|home|private|var|tmp|Applications|Volumes)\/[^\s"'<>]+)|(?:[A-Za-z]:\\[^\s"'<>]+)/g;

export function sanitizeSessionExportDeliveryError(error: unknown, fallback: string): string {
    const raw = error instanceof Error
        ? error.message
        : typeof error === 'string'
            ? error
            : fallback;
    const sanitized = raw
        .replace(SESSION_EXPORT_LOCAL_PATH_PATTERN, '[local-path-redacted]')
        .replace(/\s+/g, ' ')
        .trim();
    return sanitized || fallback;
}

export function buildSessionExportIpcBoundaryDiagnostic(args: {
    channel: SessionExportDeliveryIpcChannel;
    operation: SessionExportDeliveryIpcOperation;
    code: string;
    valid?: boolean;
    success?: boolean;
    error?: unknown;
    message?: string;
    timestamp?: number;
    recoverable?: boolean;
    userVisible?: boolean;
}): SessionExportDeliveryIpcDiagnostic {
    const fallbackMessage = args.message ?? 'Export delivery IPC boundary failed.';
    const error = args.error === undefined
        ? undefined
        : sanitizeSessionExportDeliveryError(args.error, fallbackMessage);
    return {
        channel: args.channel,
        operation: args.operation,
        code: args.code,
        ...(args.valid !== undefined ? { valid: args.valid } : {}),
        ...(args.success !== undefined ? { success: args.success } : {}),
        ...(error ? { error } : {}),
        message: sanitizeSessionExportDeliveryError(args.message ?? error ?? fallbackMessage, fallbackMessage),
        source: 'session_export_delivery',
        timestamp: args.timestamp ?? Date.now(),
        recoverable: args.recoverable ?? true,
        userVisible: args.userVisible ?? true,
    };
}

export function validateSessionExportSaveRequest(request: unknown): SessionExportDeliveryRequestValidation {
    const baseValidation = validateSessionExportDeliveryRequest(request);
    if (!baseValidation.valid) return baseValidation;

    const record = request as Record<string, unknown>;
    if (record.suggestedFileName !== undefined && typeof record.suggestedFileName !== 'string') {
        return { valid: false, error: 'Export save request suggestedFileName must be a string.' };
    }

    return { valid: true };
}

export function validateSessionExportPdfSaveRequest(request: unknown): SessionExportDeliveryRequestValidation {
    const record = request && typeof request === 'object'
        ? request as Record<string, unknown>
        : null;

    if (!record) {
        return { valid: false, error: 'PDF export request must be an object.' };
    }

    if (record.sourceFormat !== 'html') {
        return { valid: false, error: 'PDF export request sourceFormat must be HTML.' };
    }

    const guardrailStatus = typeof record.guardrailStatus === 'string'
        ? record.guardrailStatus
        : undefined;

    if (record.blocked !== false || guardrailStatus === 'invalid') {
        return { valid: false, error: 'Blocked or invalid exports cannot be delivered as PDF.' };
    }

    if (guardrailStatus !== 'valid' && guardrailStatus !== 'warning') {
        return { valid: false, error: 'PDF export request guardrail status is invalid.' };
    }

    if (typeof record.html !== 'string' || record.html.trim().length === 0) {
        return { valid: false, error: 'PDF export request HTML is empty.' };
    }

    if (serializedByteLength(record.html) > SESSION_EXPORT_SAVE_BUDGETS.maxPdfHtmlBytes) {
        return { valid: false, error: 'PDF export HTML exceeds the delivery payload budget.' };
    }

    if (!/^\s*<!doctype html>/i.test(record.html) || !/<html\b/i.test(record.html)) {
        return { valid: false, error: 'PDF export requires a complete generated HTML report.' };
    }

    if (/<script\b/i.test(record.html)) {
        return { valid: false, error: 'PDF export HTML cannot contain script tags.' };
    }

    if (/\b(?:file|filesystem):\/\//i.test(record.html)) {
        return { valid: false, error: 'PDF export HTML cannot reference local file URLs.' };
    }

    if (record.suggestedFileName !== undefined && typeof record.suggestedFileName !== 'string') {
        return { valid: false, error: 'PDF export request suggestedFileName must be a string.' };
    }

    return { valid: true };
}

export function validateSessionExportClipboardRequest(request: unknown): SessionExportDeliveryRequestValidation {
    return validateSessionExportDeliveryRequest(request);
}

export function validateSessionExportPdfBuffer(buffer: Uint8Array): SessionExportPdfBufferValidation {
    const byteLength = buffer.byteLength;
    if (byteLength === 0) {
        return {
            valid: false,
            byteLength,
            error: 'Generated PDF is empty.',
        };
    }

    const hasPdfHeader = buffer.length >= 4
        && buffer[0] === 0x25
        && buffer[1] === 0x50
        && buffer[2] === 0x44
        && buffer[3] === 0x46;

    if (!hasPdfHeader) {
        return {
            valid: false,
            byteLength,
            error: 'Generated PDF does not contain a valid PDF header.',
        };
    }

    if (byteLength > SESSION_EXPORT_PDF_RUNTIME_BUDGETS.maxPdfBytes) {
        return {
            valid: false,
            byteLength,
            error: 'Generated PDF exceeds the output size ceiling.',
        };
    }

    if (byteLength > SESSION_EXPORT_PDF_RUNTIME_BUDGETS.warningPdfBytes) {
        return {
            valid: true,
            byteLength,
            warning: 'Generated PDF is larger than the preferred output budget.',
        };
    }

    return {
        valid: true,
        byteLength,
    };
}

function validateSessionExportDeliveryRequest(request: unknown): SessionExportDeliveryRequestValidation {
    const record = request && typeof request === 'object'
        ? request as Record<string, unknown>
        : null;

    if (!record) {
        return { valid: false, error: 'Export delivery request must be an object.' };
    }

    if (record.format !== 'markdown' && record.format !== 'html') {
        return { valid: false, error: 'Export delivery request format must be Markdown or HTML.' };
    }

    const guardrailStatus = typeof record.guardrailStatus === 'string'
        ? record.guardrailStatus
        : undefined;

    if (record.blocked !== false || guardrailStatus === 'invalid') {
        return { valid: false, error: 'Blocked or invalid exports cannot be delivered.' };
    }

    if (guardrailStatus !== 'valid' && guardrailStatus !== 'warning') {
        return { valid: false, error: 'Export delivery request guardrail status is invalid.' };
    }

    if (typeof record.content !== 'string' || record.content.trim().length === 0) {
        return { valid: false, error: 'Export delivery request content is empty.' };
    }

    if (serializedByteLength(record.content) > SESSION_EXPORT_SAVE_BUDGETS.maxContentBytes) {
        return { valid: false, error: 'Export report exceeds the delivery payload budget.' };
    }

    if (record.format === 'html' && /<script\b/i.test(record.content)) {
        return { valid: false, error: 'Export HTML cannot contain script tags.' };
    }

    return { valid: true };
}
