import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import {
    SESSION_EXPORT_PRIVACY_EXCLUDED_FIELDS,
    buildSessionExportReadModel,
    type SessionExportReadModel,
    type SessionExportSourceResponse,
} from '../../src/lib/export/sessionExportReadModel.ts';
import { SESSION_EXPORT_GUARDRAIL_BUDGETS } from '../../src/lib/export/sessionExportGuardrails.ts';
import { buildExportPreviewModel } from '../../src/components/pro-v2/exportPreviewModel.ts';

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

test('Sprint 11 Phase B builds a valid Markdown export preview model', () => {
    const preview = buildExportPreviewModel(buildValidModel(), 'markdown');

    assert.equal(preview.format, 'markdown');
    assert.equal(preview.formatLabel, 'Markdown');
    assert.equal(preview.guardrailStatus, 'valid');
    assert.equal(preview.blocked, false);
    assert.equal(preview.warningCount, 0);
    assert.equal(preview.includedSections.includes('Session'), true);
    assert.equal(preview.includedSections.includes('Provider Routing'), true);
    assert.match(preview.contentPreview, /^# TeamSync Session Report/);
});

test('Sprint 11 Phase C projects valid guardrail feedback before delivery', () => {
    const preview = buildExportPreviewModel(buildValidModel(), 'markdown');

    assert.equal(preview.guardrailFeedback.status, 'valid');
    assert.equal(preview.guardrailFeedback.headline, 'Export Ready For Review');
    assert.equal(preview.guardrailFeedback.canPreviewReport, true);
    assert.equal(preview.guardrailFeedback.issueCount, 0);
    assert.equal(preview.guardrailFeedback.warningCount, 0);
    assert.equal(preview.guardrailFeedback.invalidCount, 0);
    assert.equal(preview.guardrailFeedback.reasonSummary.length, 0);
    assert.equal(preview.guardrailFeedback.budgetItems.some((item) => item.label === 'Payload Size' && item.status === 'ok'), true);
});

test('Sprint 11 Phase B summarizes warning previews without blocking report inspection', () => {
    const filler = 'x'.repeat(270_000);
    const warningModel = {
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

    const preview = buildExportPreviewModel(warningModel, 'markdown');

    assert.equal(preview.guardrailStatus, 'warning');
    assert.equal(preview.blocked, false);
    assert.equal(preview.warningCount > 0, true);
    assert.equal(preview.includedSections.includes('Guardrail Warnings'), true);
    assert.equal(preview.issueSummary.some((issue) => issue.code === 'payload_size_warning'), true);
    assert.equal(preview.guardrailFeedback.status, 'warning');
    assert.equal(preview.guardrailFeedback.headline, 'Export Has Warnings');
    assert.equal(preview.guardrailFeedback.canPreviewReport, true);
    assert.equal(preview.guardrailFeedback.reasonSummary.some((issue) => issue.code === 'payload_size_warning'), true);
    assert.equal(preview.guardrailFeedback.budgetItems.some((item) => item.label === 'Payload Size' && item.status === 'warning'), true);
});

test('Sprint 11 Phase C blocks invalid guardrail feedback without exposing sensitive actual values', () => {
    const blockedModel = {
        ...buildValidModel(),
        responses: [
            {
                ...buildValidModel().responses[0],
                text: 'SECRET_RESPONSE_TEXT',
                debugMetadata: {
                    prompt: 'SECRET_PROMPT',
                },
            },
        ],
    } as unknown as SessionExportReadModel;

    const preview = buildExportPreviewModel(blockedModel, 'html');

    assert.equal(preview.format, 'html');
    assert.equal(preview.formatLabel, 'HTML');
    assert.equal(preview.guardrailStatus, 'invalid');
    assert.equal(preview.blocked, true);
    assert.deepEqual(preview.includedSections, ['Export Blocked', 'Reason Summary']);
    assert.equal(JSON.stringify(preview.issueSummary).includes('SECRET_RESPONSE_TEXT'), false);
    assert.equal(JSON.stringify(preview.issueSummary).includes('SECRET_PROMPT'), false);
    assert.equal(preview.guardrailFeedback.status, 'invalid');
    assert.equal(preview.guardrailFeedback.headline, 'Export Blocked');
    assert.equal(preview.guardrailFeedback.canPreviewReport, false);
    assert.equal(preview.guardrailFeedback.invalidCount > 0, true);
    assert.equal(JSON.stringify(preview.guardrailFeedback).includes('SECRET_RESPONSE_TEXT'), false);
    assert.equal(JSON.stringify(preview.guardrailFeedback).includes('SECRET_PROMPT'), false);
});

test('Sprint 11 Phase C surfaces retained-response and budget feedback', () => {
    const responses = Array.from({ length: SESSION_EXPORT_GUARDRAIL_BUDGETS.maxResponses + 1 }, (_, index) => response(`response-${index}`, {
        rootResponseId: 'response-0',
        parentResponseId: index === 0 ? undefined : `response-${index - 1}`,
        ownership: ownership(`response-${index}`, {
            parentResponseId: index === 0 ? undefined : `response-${index - 1}`,
        }),
    }));
    const oversized = buildSessionExportReadModel({
        responses,
        activeResponseId: `response-${SESSION_EXPORT_GUARDRAIL_BUDGETS.maxResponses}`,
        generatedAt: 3000,
    });

    const preview = buildExportPreviewModel(oversized, 'markdown');

    assert.equal(preview.guardrailFeedback.status, 'invalid');
    assert.equal(preview.guardrailFeedback.reasonSummary.some((issue) => issue.code === 'response_count_exceeded'), true);
    assert.equal(preview.guardrailFeedback.budgetItems.some((item) => item.label === 'Responses' && item.status === 'invalid'), true);
});

test('Sprint 11 Phase B exposes the privacy exclusions allowlist in preview metadata', () => {
    const preview = buildExportPreviewModel(buildValidModel(), 'markdown');

    assert.deepEqual(preview.privacyExclusions, SESSION_EXPORT_PRIVACY_EXCLUDED_FIELDS);
    assert.equal(preview.privacyExclusions.includes('screenshots'), true);
    assert.equal(preview.privacyExclusions.includes('rawPrompt'), true);
    assert.equal(preview.privacyExclusions.includes('providerPayload'), true);
    assert.equal(preview.privacyExclusions.includes('debugMetadata'), true);
});

test('Sprint 11 Phase B supports Markdown and HTML preview mode switching', () => {
    const model = buildValidModel();
    const markdown = buildExportPreviewModel(model, 'markdown');
    const html = buildExportPreviewModel(model, 'html');

    assert.equal(markdown.formatLabel, 'Markdown');
    assert.equal(html.formatLabel, 'HTML');
    assert.match(markdown.contentPreview, /^# TeamSync Session Report/);
    assert.match(html.contentPreview, /^<!doctype html>/);
    assert.notEqual(markdown.contentPreview, html.contentPreview);
});

test('Sprint 11 Phase D preview surface renders guardrail feedback before Save-As delivery', () => {
    const component = read('src/components/pro-v2/ExportPreviewSurface.tsx');
    const model = read('src/components/pro-v2/exportPreviewModel.ts');
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(model, /Export Blocked/);
    assert.match(component, /ExportGuardrailFeedbackPanel/);
    assert.match(component, /Guardrail Feedback/);
    assert.match(component, /Reason Summary/);
    assert.match(component, /Export guardrail budgets/);
    assert.match(component, /Privacy Exclusions/);
    assert.match(component, /role="tablist"/);
    assert.match(component, /onFormatChange\(option\.format\)/);
    assert.match(surface, /Preview Markdown session report/);
    assert.match(surface, /Preview HTML session report/);
    assert.doesNotMatch(component, /showSaveFilePicker|download=|ipcRenderer|ipcMain|writeFile|appendFile/);
    assert.doesNotMatch(surface, /navigator\.clipboard\.writeText\(report\.content\)/);
});
