import type { RuntimeDiagnosticSeverity } from './runtimeDiagnosticsReadModel';

export type ValidationRepairOutcome =
    | 'repaired'
    | 'repair_skipped'
    | 'repair_failed'
    | 'unsafe_repair';

export type ValidationRepairClassification =
    | 'success'
    | 'warning'
    | 'error'
    | 'critical';

export interface ValidationRepairPolicyInput {
    valid?: boolean;
    warnings?: readonly string[];
    issues?: readonly string[];
    repairApplied?: boolean;
    status?: string;
    sourceCode?: string;
}

export interface ValidationRepairPolicyResult {
    outcome: ValidationRepairOutcome;
    classification: ValidationRepairClassification;
    severity: RuntimeDiagnosticSeverity;
    recoverable: boolean;
    userVisible: boolean;
    sourceCode: string;
    message: string;
}

const UNSAFE_REPAIR_CODES = new Set([
    'unsafe_repair',
    'repair_unsafe',
    'unsafe-repair',
]);

const REPAIR_SKIPPED_CODES = new Set([
    'repair_skipped',
    'repair-skip',
    'repair_skip',
    'skipped_repair',
]);

const REPAIR_FAILED_CODES = new Set([
    'repair_failed',
    'repair_empty',
    'repair_invalid',
]);

const REPAIRED_CODES = new Set([
    'repaired',
    'repair_applied',
    'valid_repaired',
]);

function normalizeCode(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function collectCodes(input: ValidationRepairPolicyInput): string[] {
    return [
        input.sourceCode,
        input.status,
        ...(input.warnings ?? []),
        ...(input.issues ?? []),
    ]
        .map(normalizeCode)
        .filter(Boolean);
}

function includesCode(codes: readonly string[], knownCodes: ReadonlySet<string>): boolean {
    return codes.some((code) => knownCodes.has(code));
}

function repairResult(
    outcome: ValidationRepairOutcome,
    classification: ValidationRepairClassification,
    severity: RuntimeDiagnosticSeverity,
    recoverable: boolean,
    userVisible: boolean,
    sourceCode: string,
    message: string,
): ValidationRepairPolicyResult {
    return {
        outcome,
        classification,
        severity,
        recoverable,
        userVisible,
        sourceCode,
        message,
    };
}

export function deriveValidationRepairPolicy(
    input: ValidationRepairPolicyInput,
): ValidationRepairPolicyResult | null {
    const codes = collectCodes(input);
    const sourceCode = normalizeCode(input.sourceCode)
        || normalizeCode(input.status)
        || 'validation_repair';

    if (includesCode(codes, UNSAFE_REPAIR_CODES)) {
        return repairResult(
            'unsafe_repair',
            'critical',
            'critical',
            false,
            true,
            sourceCode,
            'Validation repair was marked unsafe.',
        );
    }

    if (includesCode(codes, REPAIR_SKIPPED_CODES)) {
        return repairResult(
            'repair_skipped',
            'warning',
            'warning',
            true,
            false,
            sourceCode,
            'Validation repair was skipped.',
        );
    }

    if (includesCode(codes, REPAIR_FAILED_CODES)) {
        return repairResult(
            'repair_failed',
            'error',
            'error',
            true,
            false,
            sourceCode,
            'Validation repair failed.',
        );
    }

    if (!input.sourceCode && input.repairApplied === true && input.valid === false) {
        return repairResult(
            'repair_failed',
            'error',
            'error',
            true,
            false,
            sourceCode,
            'Validation repair failed.',
        );
    }

    if (includesCode(codes, REPAIRED_CODES) || (input.repairApplied === true && input.valid === true)) {
        return repairResult(
            'repaired',
            'success',
            'info',
            true,
            false,
            sourceCode,
            'Validation repair produced a compliant response.',
        );
    }

    return null;
}
