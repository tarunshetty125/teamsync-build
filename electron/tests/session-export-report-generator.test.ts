import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';
import type { ArchitectureDiagram } from '../../src/components/pro-v2/architecture/architectureSchema.ts';
import type { ArchitectureDiagramDiff } from '../../src/components/pro-v2/architecture/architectureDiff.ts';
import {
    buildDiagramTimeline,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import {
    buildParentToCurrentEvolutionSummary,
} from '../../src/components/pro-v2/architecture/diagramEvolutionSummary.ts';
import {
    buildDiagramGuardrails,
} from '../../src/components/pro-v2/architecture/diagramGuardrails.ts';
import {
    buildSessionExportReadModel,
    SESSION_EXPORT_PRIVACY_EXCLUDED_FIELDS,
    type SessionExportReadModel,
    type SessionExportSourceResponse,
} from '../../src/lib/export/sessionExportReadModel.ts';
import {
    generateSessionExportHtmlReport,
    generateSessionExportMarkdownReport,
} from '../../src/lib/export/sessionExportReportGenerator.ts';

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

function response(
    responseId: string,
    options: {
        rootResponseId?: string;
        parentResponseId?: string;
        ownership?: ResponseOwnership;
        source?: string;
        metadata?: unknown;
        artifacts?: V2ResponseArtifact[];
    } = {},
): SessionExportSourceResponse & Record<string, unknown> {
    const responseOwnership = options.ownership ?? ownership(responseId, {
        parentResponseId: options.parentResponseId,
    });

    return {
        id: responseId,
        role: 'system',
        requestId: `request-${responseId}`,
        timestamp: responseOwnership.createdAt,
        questionTurnId: responseOwnership.questionTurnId,
        intent: responseOwnership.mode === 'coding' ? 'answer_now' : 'manual_chat',
        source: options.source ?? 'Manual Input',
        provider: responseOwnership.requestedProvider,
        model: responseOwnership.requestedModel,
        rootResponseId: options.rootResponseId ?? responseId,
        parentResponseId: options.parentResponseId,
        ownership: responseOwnership,
        intelligenceMetadata: options.metadata,
        debugMetadata: options.metadata,
        artifacts: options.artifacts,
        text: 'SECRET_RESPONSE_TEXT',
        markdown: 'SECRET_MARKDOWN',
        rawPrompt: 'SECRET_RAW_PROMPT',
        providerPayload: 'SECRET_PROVIDER_PAYLOAD',
        screenshotPreview: 'SECRET_SCREENSHOT',
        transcript: 'SECRET_TRANSCRIPT',
    };
}

function providerResponses(): Array<SessionExportSourceResponse & Record<string, unknown>> {
    return [
        response('response-direct', {
            rootResponseId: 'response-direct',
            ownership: ownership('response-direct', {
                requestedProvider: 'openai',
                requestedModel: 'gpt-4.1-mini',
                actualProvider: 'openai',
                actualModel: 'gpt-4.1-mini',
                providerPreference: 'openai',
            }),
            metadata: {
                telemetry: {
                    latencyMs: 420,
                    success: true,
                    streamingCompleted: true,
                    promptTokens: 20,
                    completionTokens: 80,
                },
                validation: { valid: true },
            },
        }),
        response('response-fallback', {
            rootResponseId: 'response-direct',
            parentResponseId: 'response-direct',
            ownership: ownership('response-fallback', {
                parentResponseId: 'response-direct',
                requestedProvider: 'bedrock',
                requestedModel: 'openai.gpt-oss-120b-1:0',
                actualProvider: 'groq',
                actualModel: 'llama-3.3-70b-versatile',
                routingReason: 'bedrock_auth_expired_fallback',
                providerPreference: 'bedrock',
                responseStyle: 'concise',
            }),
            metadata: {
                routing: {
                    requestedProvider: 'bedrock',
                    requestedModel: 'openai.gpt-oss-120b-1:0',
                    actualProvider: 'groq',
                    actualModel: 'llama-3.3-70b-versatile',
                    reason: 'bedrock_auth_expired_fallback',
                },
                telemetry: {
                    fallbackUsed: true,
                    fallbackReason: 'bedrock_auth_expired_fallback',
                    latencyMs: 1300,
                    success: false,
                    streamingCompleted: true,
                    promptTokens: 35,
                    completionTokens: 120,
                },
                fallbackChain: [
                    {
                        provider: 'bedrock',
                        model: 'openai.gpt-oss-120b-1:0',
                        result: 'failure',
                        reason: 'bedrock_auth_expired_fallback',
                    },
                    {
                        provider: 'groq',
                        model: 'llama-3.3-70b-versatile',
                        result: 'success',
                    },
                ],
                validation: { valid: false, reason: 'contract_validation_failed' },
            },
        }),
    ];
}

function diagram(nodeIds: string[], edgePairs: Array<[string, string]>): ArchitectureDiagram {
    return {
        type: 'architecture',
        direction: 'TB',
        nodes: nodeIds.map((id) => ({
            id,
            label: id.toUpperCase(),
            kind: id.includes('redis') ? 'cache' : 'service',
            purpose: `SECRET_DIAGRAM_PAYLOAD_${id}`,
        })),
        edges: edgePairs.map(([source, target]) => ({ source, target })),
    };
}

function architectureArtifact(
    responseId: string,
    options: {
        parentResponseId?: string;
        rootResponseId?: string;
        diagram: ArchitectureDiagram;
        diff?: Partial<ArchitectureDiagramDiff>;
    },
): V2ResponseArtifact {
    return {
        id: `${responseId}:architecture`,
        responseId,
        parentResponseId: options.parentResponseId,
        rootResponseId: options.rootResponseId ?? responseId,
        kind: 'architecture',
        source: 'architecture_json',
        createdAt: 2000,
        status: 'parsed',
        payload: {
            diagram: options.diagram,
            diff: options.diff ? {
                addedNodes: options.diff.addedNodes ?? [],
                removedNodes: options.diff.removedNodes ?? [],
                modifiedNodes: options.diff.modifiedNodes ?? [],
                addedEdges: options.diff.addedEdges ?? [],
                removedEdges: options.diff.removedEdges ?? [],
            } : undefined,
        },
    };
}

function buildReportModel(): SessionExportReadModel {
    const rootArtifact = architectureArtifact('response-direct', {
        rootResponseId: 'response-direct',
        diagram: diagram(['user', 'app'], [['user', 'app']]),
    });
    const childArtifact = architectureArtifact('response-fallback', {
        parentResponseId: 'response-direct',
        rootResponseId: 'response-direct',
        diagram: diagram(['user', 'app', 'redis'], [['user', 'app'], ['app', 'redis']]),
        diff: {
            addedNodes: [{ id: 'redis' }],
            addedEdges: [{ key: 'app->redis' }],
        },
    });
    const responses = providerResponses();
    responses[0].artifacts = [rootArtifact];
    responses[1].artifacts = [childArtifact];
    const timeline = buildDiagramTimeline(responses, 'response-fallback');

    return buildSessionExportReadModel({
        responses,
        activeResponseId: 'response-fallback',
        generatedAt: 5000,
        diagramTimeline: timeline,
        parentCurrentEvolution: buildParentToCurrentEvolutionSummary(timeline, 'response-fallback'),
        diagramGuardrails: buildDiagramGuardrails(timeline, 'response-fallback'),
    });
}

test('Sprint 10 Phase D generates a deterministic Markdown session report', () => {
    const model = buildReportModel();
    const first = generateSessionExportMarkdownReport(model, {
        title: 'Interview Export',
        generatedBy: 'TeamSync Test',
    });
    const second = generateSessionExportMarkdownReport(model, {
        title: 'Interview Export',
        generatedBy: 'TeamSync Test',
    });

    assert.equal(first.format, 'markdown');
    assert.equal(first.blocked, false);
    assert.equal(first.validation.status, 'valid');
    assert.equal(first.sectionCount, 12);
    assert.equal(first.content, second.content);
    assert.match(first.content, /^# Interview Export/);
    assert.match(first.content, /## Session/);
    assert.match(first.content, /## Provider Routing/);
    assert.match(first.content, /bedrock_auth_expired_fallback/);
    assert.match(first.content, /## Diagrams/);
    assert.match(first.content, /redis/);
    assert.doesNotMatch(first.content, /SECRET_RESPONSE_TEXT|SECRET_MARKDOWN|SECRET_RAW_PROMPT|SECRET_PROVIDER_PAYLOAD|SECRET_DIAGRAM_PAYLOAD/);
});

test('Sprint 10 Phase E renders detailed provider report sections from export metadata', () => {
    const report = generateSessionExportMarkdownReport(buildReportModel(), {
        title: 'Provider Report',
    });

    assert.equal(report.blocked, false);
    assert.match(report.content, /## Provider Diagnostics/);
    assert.match(report.content, /## Provider Personalization Impact/);
    assert.match(report.content, /auth_expired/);
    assert.match(report.content, /Provider fallback activated|AWS session expired before fallback/);
    assert.match(report.content, /fallback/);
    assert.match(report.content, /bedrock/);
    assert.match(report.content, /groq/);
    assert.doesNotMatch(report.content, /SECRET_RESPONSE_TEXT|SECRET_MARKDOWN|SECRET_RAW_PROMPT|SECRET_PROVIDER_PAYLOAD/);
});

test('Sprint 10 Phase E renders detailed diagram timeline, evolution, and guardrail sections', () => {
    const markdown = generateSessionExportMarkdownReport(buildReportModel(), {
        title: 'Diagram Report',
    });
    const html = generateSessionExportHtmlReport(buildReportModel(), {
        title: 'Diagram Report',
    });

    assert.equal(markdown.blocked, false);
    assert.match(markdown.content, /## Diagram Timeline/);
    assert.match(markdown.content, /## Diagram Evolution/);
    assert.match(markdown.content, /## Diagram Guardrails/);
    assert.match(markdown.content, /response-direct/);
    assert.match(markdown.content, /response-fallback/);
    assert.match(markdown.content, /stored_artifact_diff/);
    assert.match(markdown.content, /redis/);
    assert.match(markdown.content, /app->redis/);
    assert.match(markdown.content, /supported/);
    assert.match(html.content, /<h2>Diagram Timeline<\/h2>/);
    assert.match(html.content, /<h2>Diagram Evolution<\/h2>/);
    assert.match(html.content, /<h2>Diagram Guardrails<\/h2>/);
    assert.doesNotMatch(markdown.content, /SECRET_DIAGRAM_PAYLOAD|"payload"|fallbackDiagram|parsedDiagram/);
    assert.doesNotMatch(html.content, /SECRET_DIAGRAM_PAYLOAD|"payload"|fallbackDiagram|parsedDiagram/);
});

test('Sprint 12 Phase B emits print-ready HTML styles for reports', () => {
    const report = generateSessionExportHtmlReport(buildReportModel(), {
        title: 'Print Report',
    });

    assert.equal(report.blocked, false);
    assert.match(report.content, /@page\{size:auto;margin:0\.65in;\}/);
    assert.match(report.content, /@media print\{/);
    assert.match(report.content, /main\.export-report\{max-width:none;margin:0;\}/);
    assert.match(report.content, /print-color-adjust:exact/);
    assert.match(report.content, /break-inside:avoid-page;page-break-inside:avoid/);
    assert.match(report.content, /break-after:avoid-page;page-break-after:avoid/);
});

test('Sprint 12 Phase B emits table and long-token print rules', () => {
    const report = generateSessionExportHtmlReport(buildReportModel(), {
        title: 'Table Print Report',
    });

    assert.match(report.content, /thead\{display:table-header-group;\}/);
    assert.match(report.content, /tfoot\{display:table-footer-group;\}/);
    assert.match(report.content, /tbody\{display:table-row-group;\}/);
    assert.match(report.content, /tr\{break-inside:avoid-page;page-break-inside:avoid;\}/);
    assert.match(report.content, /overflow-wrap:anywhere;word-break:break-word/);
    assert.match(report.content, /pre,code\{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;\}/);
});

test('Sprint 12 Phase B marks provider and diagram sections for print layout', () => {
    const report = generateSessionExportHtmlReport(buildReportModel(), {
        title: 'Section Print Report',
    });

    assert.match(report.content, /<main class="export-report">/);
    assert.match(report.content, /<section class="export-section export-section--provider"><h2>Provider Routing<\/h2>/);
    assert.match(report.content, /<section class="export-section export-section--provider"><h2>Provider Telemetry<\/h2>/);
    assert.match(report.content, /<section class="export-section export-section--diagram"><h2>Diagrams<\/h2>/);
    assert.match(report.content, /<section class="export-section export-section--diagram"><h2>Diagram Timeline<\/h2>/);
    assert.match(report.content, /<section class="export-section export-section--diagram"><h2>Diagram Evolution<\/h2>/);
    assert.match(report.content, /<section class="export-section export-section--diagram"><h2>Diagram Guardrails<\/h2>/);
});

test('Sprint 12 Phase B preserves export privacy exclusions while adding print styles', () => {
    const model = buildReportModel();
    const report = generateSessionExportHtmlReport(model, {
        title: 'Privacy Print Report',
    });

    assert.deepEqual([...model.privacy.excludedFields], [...SESSION_EXPORT_PRIVACY_EXCLUDED_FIELDS]);
    assert.match(report.content, /@media print/);
    assert.doesNotMatch(report.content, /SECRET_RESPONSE_TEXT|SECRET_MARKDOWN|SECRET_RAW_PROMPT|SECRET_PROVIDER_PAYLOAD|SECRET_DIAGRAM_PAYLOAD/);
});

test('Sprint 10 Phase D generates escaped HTML without raw content leakage', () => {
    const model = buildSessionExportReadModel({
        responses: [
            response('html-response', {
                source: '<script>alert("x")</script>',
                ownership: ownership('html-response', {
                    routingReason: 'See /Users/tarunshetty/private/provider.log',
                }),
            }),
        ],
        activeResponseId: 'html-response',
        generatedAt: 6000,
    });
    const report = generateSessionExportHtmlReport(model, {
        title: '<Session Export>',
    });

    assert.equal(report.format, 'html');
    assert.equal(report.blocked, false);
    assert.match(report.content, /^<!doctype html>/);
    assert.match(report.content, /&lt;Session Export&gt;/);
    assert.match(report.content, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
    assert.match(report.content, /\[local-path-redacted\]/);
    assert.doesNotMatch(report.content, /<script>alert/);
    assert.doesNotMatch(report.content, /\/Users\/tarunshetty\/private/);
    assert.doesNotMatch(report.content, /SECRET_RESPONSE_TEXT|SECRET_MARKDOWN|SECRET_RAW_PROMPT|SECRET_PROVIDER_PAYLOAD/);
});

test('Sprint 10 Phase D blocks invalid export models before rendering report data', () => {
    const invalidModel = {
        ...buildReportModel(),
        responses: [
            {
                ...buildReportModel().responses[0],
                text: 'SECRET_SHOULD_NOT_RENDER',
                debugMetadata: { prompt: 'SECRET_PROMPT' },
            },
        ],
    } as unknown as SessionExportReadModel;

    const markdown = generateSessionExportMarkdownReport(invalidModel);
    const html = generateSessionExportHtmlReport(invalidModel);

    assert.equal(markdown.blocked, true);
    assert.equal(html.blocked, true);
    assert.equal(markdown.validation.status, 'invalid');
    assert.match(markdown.content, /Export blocked/);
    assert.match(html.content, /Export blocked/);
    assert.doesNotMatch(markdown.content, /SECRET_SHOULD_NOT_RENDER|SECRET_PROMPT/);
    assert.doesNotMatch(html.content, /SECRET_SHOULD_NOT_RENDER|SECRET_PROMPT/);
});

test('Sprint 10 Phase D includes guardrail warnings without exposing issue actual values', () => {
    const filler = 'x'.repeat(270 * 1024);
    const warningModel = {
        ...buildReportModel(),
        providers: {
            ...buildReportModel().providers,
            routingSummary: {
                ...buildReportModel().providers.routingSummary,
                byReason: {
                    [filler]: 1,
                },
            },
        },
    };

    const report = generateSessionExportMarkdownReport(warningModel);

    assert.equal(report.blocked, false);
    assert.equal(report.validation.status, 'warning');
    assert.match(report.content, /## Guardrail Warnings/);
    assert.match(report.content, /payload_size_warning/);
    assert.doesNotMatch(report.content, new RegExp(filler.slice(0, 80)));
});

test('Sprint 10 Phase D remains generator-only without UI, IPC, persistence, or PDF output', () => {
    const helper = read('src/lib/export/sessionExportReportGenerator.ts');

    assert.doesNotMatch(helper, /from 'react'|from "react"|createElement|renderToStaticMarkup/);
    assert.doesNotMatch(helper, /ipcMain|ipcRenderer|safeHandle|preload/);
    assert.doesNotMatch(helper, /localStorage|sessionStorage|indexedDB|electron-store|writeFile|appendFile/);
    assert.doesNotMatch(helper, /pdfkit|html2pdf|puppeteer|BrowserWindow|printToPDF/);
});
