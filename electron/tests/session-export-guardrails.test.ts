import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import {
    buildSessionExportReadModel,
    type SessionExportReadModel,
    type SessionExportSourceResponse,
} from '../../src/lib/export/sessionExportReadModel.ts';
import {
    redactSessionExportGuardrailValue,
    SESSION_EXPORT_GUARDRAIL_BUDGETS,
    validateSessionExportReadModel,
} from '../../src/lib/export/sessionExportGuardrails.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function ownership(responseId: string, overrides: Partial<ResponseOwnership> = {}): ResponseOwnership {
    return {
        responseId,
        questionTurnId: `turn-${responseId}`,
        transcriptVersion: 1,
        contextTarget: 'active_context',
        actionId: 'manual_chat',
        mode: 'coding',
        createdAt: 1000,
        requestedProvider: 'openai',
        requestedModel: 'gpt-4.1-mini',
        actualProvider: 'openai',
        actualModel: 'gpt-4.1-mini',
        resolvedCodingLanguage: 'JavaScript',
        providerPreference: 'openai',
        responseStyle: 'balanced',
        interviewFocus: 'coding',
        personalizationVersion: 1,
        ...overrides,
    };
}

function response(responseId: string, overrides: Partial<SessionExportSourceResponse> = {}): SessionExportSourceResponse {
    const responseOwnership = overrides.ownership ?? ownership(responseId);
    return {
        id: responseId,
        role: 'system',
        requestId: `request-${responseId}`,
        timestamp: responseOwnership.createdAt,
        questionTurnId: responseOwnership.questionTurnId,
        intent: 'answer_now',
        source: 'Manual Input',
        provider: responseOwnership.requestedProvider,
        model: responseOwnership.requestedModel,
        rootResponseId: responseId,
        ownership: responseOwnership,
        isStreaming: false,
        ...overrides,
    };
}

function buildValidModel(): SessionExportReadModel {
    return buildSessionExportReadModel({
        responses: [
            response('response-1'),
            response('response-2', {
                rootResponseId: 'response-1',
                parentResponseId: 'response-1',
                ownership: ownership('response-2', {
                    parentResponseId: 'response-1',
                }),
            }),
        ],
        activeResponseId: 'response-2',
        generatedAt: 2000,
    });
}

test('Sprint 10 Phase C validates a privacy-safe session export read model', () => {
    const result = validateSessionExportReadModel(buildValidModel());

    assert.equal(result.status, 'valid');
    assert.equal(result.responseCount, 2);
    assert.equal(result.providerRowCount, 6);
    assert.equal(result.diagnosticCount, 0);
    assert.equal(result.diagramVersionCount, 0);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.budgets, SESSION_EXPORT_GUARDRAIL_BUDGETS);
});

test('Sprint 10 Phase C flags raw content and payload leakage', () => {
    const model = {
        ...buildValidModel(),
        responses: [
            {
                ...buildValidModel().responses[0],
                text: 'SECRET_RESPONSE_TEXT',
                debugMetadata: { prompt: 'SECRET_PROMPT' },
            },
        ],
        diagrams: {
            timeline: {
                items: [
                    {
                        payload: {
                            diagram: {
                                nodes: ['SECRET_DIAGRAM_NODE'],
                            },
                        },
                    },
                ],
            },
        },
    };

    const result = validateSessionExportReadModel(model);

    assert.equal(result.status, 'invalid');
    assert.equal(result.issues.some((issue) => issue.code === 'unsupported_response_key' && issue.path === 'responses[0].text'), true);
    assert.equal(result.issues.some((issue) => issue.code === 'content_leakage_key_detected' && issue.path.includes('debugMetadata')), true);
    assert.equal(result.issues.some((issue) => issue.code === 'content_leakage_key_detected' && issue.path.includes('payload')), true);
});

test('Sprint 10 Phase C redacts local filesystem paths in values and map keys', () => {
    const redacted = redactSessionExportGuardrailValue({
        '/Users/tarunshetty/private/key.txt': 1,
        reason: 'open /private/tmp/session.log for details',
    });

    assert.deepEqual(redacted, {
        '[local-path-redacted]': 1,
        reason: 'open [local-path-redacted] for details',
    });

    const unsafeModel = {
        ...buildValidModel(),
        providers: {
            ...buildValidModel().providers,
            routingSummary: {
                ...buildValidModel().providers.routingSummary,
                byReason: {
                    '/Users/tarunshetty/private/key.txt': 1,
                },
            },
        },
    };
    const result = validateSessionExportReadModel(unsafeModel);

    assert.equal(result.status, 'invalid');
    assert.equal(result.issues.some((issue) => issue.code === 'local_path_key_leakage_detected'), true);
});

test('Sprint 10 Phase C reports payload-size warnings without rejecting valid shape', () => {
    const filler = 'x'.repeat(SESSION_EXPORT_GUARDRAIL_BUDGETS.warningSerializedBytes + 1024);
    const model = {
        ...buildValidModel(),
        providers: {
            ...buildValidModel().providers,
            routingSummary: {
                ...buildValidModel().providers.routingSummary,
                byReason: {
                    [filler]: 1,
                },
            },
        },
    };

    const result = validateSessionExportReadModel(model);

    assert.equal(result.status, 'warning');
    assert.equal(result.issues.some((issue) => issue.code === 'payload_size_warning'), true);
    assert.equal(result.issues.some((issue) => issue.severity === 'invalid'), false);
});

test('Sprint 10 Phase C enforces retained response and lineage budgets', () => {
    const responses = Array.from({ length: SESSION_EXPORT_GUARDRAIL_BUDGETS.maxResponses + 1 }, (_, index) => {
        const responseId = `response-${index}`;
        return response(responseId, {
            rootResponseId: 'response-0',
            parentResponseId: index === 0 ? undefined : `response-${index - 1}`,
            ownership: ownership(responseId, {
                parentResponseId: index === 0 ? undefined : `response-${index - 1}`,
            }),
        });
    });
    const oversized = buildSessionExportReadModel({
        responses,
        activeResponseId: 'response-30',
        generatedAt: 3000,
    });
    const invalidLineage = {
        ...buildValidModel(),
        session: {
            ...buildValidModel().session,
            activeResponseId: 'removed-response',
        },
        responses: [
            {
                ...buildValidModel().responses[0],
                rootResponseId: 'removed-root',
            },
        ],
    };

    const oversizedResult = validateSessionExportReadModel(oversized);
    const lineageResult = validateSessionExportReadModel(invalidLineage);

    assert.equal(oversizedResult.status, 'invalid');
    assert.equal(oversizedResult.issues.some((issue) => issue.code === 'response_count_exceeded'), true);
    assert.equal(lineageResult.status, 'invalid');
    assert.equal(lineageResult.issues.some((issue) => issue.code === 'active_response_not_retained'), true);
    assert.equal(lineageResult.issues.some((issue) => issue.code === 'root_response_not_retained'), true);
});

test('Sprint 10 Phase C remains guardrail-only without UI, IPC, persistence, or export generation', () => {
    const helper = read('src/lib/export/sessionExportGuardrails.ts');

    assert.doesNotMatch(helper, /from 'react'|from "react"/);
    assert.doesNotMatch(helper, /ipcMain|ipcRenderer|safeHandle|preload/);
    assert.doesNotMatch(helper, /localStorage|sessionStorage|indexedDB|electron-store|writeFile|appendFile/);
    assert.doesNotMatch(helper, /renderToStaticMarkup|createElement|marked\(|html2pdf|pdfkit|puppeteer/);
});
