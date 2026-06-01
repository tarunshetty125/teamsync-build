import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    deriveValidationRepairPolicy,
} from '../../src/lib/diagnostics/validationRepairPolicy.ts';
import {
    buildRuntimeDiagnosticsReadModel,
} from '../../src/lib/diagnostics/runtimeDiagnosticsReadModel.ts';
import {
    buildRuntimeDiagnosticsAggregation,
} from '../../src/lib/diagnostics/runtimeDiagnosticsAggregation.ts';

test('Sprint 14 Phase F classifies repaired validation as success metadata', () => {
    const result = deriveValidationRepairPolicy({
        valid: true,
        repairApplied: true,
        status: 'valid_repaired',
    });

    assert.deepEqual(result, {
        outcome: 'repaired',
        classification: 'success',
        severity: 'info',
        recoverable: true,
        userVisible: false,
        sourceCode: 'valid_repaired',
        message: 'Validation repair produced a compliant response.',
    });
});

test('Sprint 14 Phase F classifies skipped repair as warning metadata', () => {
    const result = deriveValidationRepairPolicy({
        valid: false,
        sourceCode: 'repair_skipped',
    });

    assert.equal(result?.outcome, 'repair_skipped');
    assert.equal(result?.classification, 'warning');
    assert.equal(result?.severity, 'warning');
    assert.equal(result?.recoverable, true);
    assert.equal(result?.userVisible, false);
});

test('Sprint 14 Phase F classifies failed repair as error metadata', () => {
    const emptyResult = deriveValidationRepairPolicy({
        valid: false,
        repairApplied: true,
        sourceCode: 'repair_empty',
    });
    const invalidResult = deriveValidationRepairPolicy({
        valid: false,
        repairApplied: true,
        sourceCode: 'repair_invalid',
    });
    const entryResult = deriveValidationRepairPolicy({
        valid: false,
        repairApplied: true,
    });

    for (const result of [emptyResult, invalidResult, entryResult]) {
        assert.equal(result?.outcome, 'repair_failed');
        assert.equal(result?.classification, 'error');
        assert.equal(result?.severity, 'error');
        assert.equal(result?.recoverable, true);
        assert.equal(result?.userVisible, false);
    }
});

test('Sprint 14 Phase F classifies unsafe repair as critical metadata', () => {
    const result = deriveValidationRepairPolicy({
        valid: false,
        repairApplied: true,
        sourceCode: 'unsafe_repair',
    });

    assert.equal(result?.outcome, 'unsafe_repair');
    assert.equal(result?.classification, 'critical');
    assert.equal(result?.severity, 'critical');
    assert.equal(result?.recoverable, false);
    assert.equal(result?.userVisible, true);
});

test('Sprint 14 Phase F leaves ordinary contract validation issues unclassified as repair', () => {
    const result = deriveValidationRepairPolicy({
        valid: false,
        sourceCode: 'coding_missing_code_block',
    });

    assert.equal(result, null);
});

test('Sprint 14 Phase F repair policy is deterministic', () => {
    const input = {
        valid: false,
        repairApplied: true,
        sourceCode: 'repair_invalid',
        status: 'invalid',
        issues: ['repair_invalid'],
    };

    assert.deepEqual(
        deriveValidationRepairPolicy(input),
        deriveValidationRepairPolicy(input),
    );
});

test('Sprint 14 Phase F repair normalization flows through diagnostics aggregation', () => {
    const readModel = buildRuntimeDiagnosticsReadModel({
        validationMetadata: [
            {
                responseId: 'response-repaired',
                valid: true,
                repairApplied: true,
                status: 'valid_repaired',
                timestamp: 1000,
            },
            {
                responseId: 'response-skipped',
                valid: false,
                warnings: ['repair_skipped'],
                timestamp: 1100,
            },
            {
                responseId: 'response-failed',
                valid: false,
                repairApplied: true,
                issues: ['repair_empty'],
                timestamp: 1200,
            },
            {
                responseId: 'response-unsafe',
                valid: false,
                repairApplied: true,
                issues: ['unsafe_repair'],
                timestamp: 1300,
            },
        ],
        activeResponseId: 'response-unsafe',
        generatedAt: 2000,
    });
    const aggregation = buildRuntimeDiagnosticsAggregation(readModel);

    assert.equal(readModel.byDomain['validation.repair'].length, 4);
    assert.equal(readModel.events.some((event) => event.code === 'repaired' && event.severity === 'info'), true);
    assert.equal(readModel.events.some((event) => event.code === 'repair_skipped' && event.severity === 'warning'), true);
    assert.equal(readModel.events.some((event) => event.code === 'repair_failed' && event.severity === 'error'), true);
    assert.equal(readModel.events.some((event) => event.code === 'unsafe_repair' && event.severity === 'critical'), true);
    assert.equal(readModel.activeEvents.length, 1);
    assert.equal(readModel.activeEvents[0]?.code, 'unsafe_repair');
    assert.equal(aggregation.domainSummaries['validation.repair'].totalEvents, 4);
    assert.equal(aggregation.severitySummaries.info.totalEvents, 1);
    assert.equal(aggregation.severitySummaries.warning.totalEvents, 1);
    assert.equal(aggregation.severitySummaries.error.totalEvents, 1);
    assert.equal(aggregation.severitySummaries.critical.totalEvents, 1);
});
