import type { SessionExportGuardrailStatus } from './sessionExportGuardrails';
import type { SessionExportReportFormat } from './sessionExportReportGenerator';

export const SESSION_EXPORT_DELIVERY_IPC = {
    save: 'session-export:save-report',
} as const;

export const SESSION_EXPORT_SAVE_BUDGETS = Object.freeze({
    maxContentBytes: 1024 * 1024,
});

export interface SessionExportSaveRequest {
    format: SessionExportReportFormat;
    content: string;
    generatedAt?: number;
    suggestedFileName?: string;
    guardrailStatus: Exclude<SessionExportGuardrailStatus, 'invalid'>;
    blocked: false;
}

export interface SessionExportSaveResult {
    success: boolean;
    canceled?: boolean;
    filePath?: string;
    error?: string;
}

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

export function getSessionExportFileExtension(format: SessionExportReportFormat): 'md' | 'html' {
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
    format: SessionExportReportFormat,
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

export function validateSessionExportSaveRequest(request: unknown): SessionExportDeliveryRequestValidation {
    const baseValidation = validateSessionExportDeliveryRequest(request);
    if (!baseValidation.valid) return baseValidation;

    const record = request as Record<string, unknown>;
    if (record.suggestedFileName !== undefined && typeof record.suggestedFileName !== 'string') {
        return { valid: false, error: 'Export save request suggestedFileName must be a string.' };
    }

    return { valid: true };
}

export function validateSessionExportClipboardRequest(request: unknown): SessionExportDeliveryRequestValidation {
    return validateSessionExportDeliveryRequest(request);
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
