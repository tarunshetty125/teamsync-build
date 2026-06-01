import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';
import type { ArchitectureDiagram } from '../../src/components/pro-v2/architecture/architectureSchema.ts';
import type { ArchitectureDiagramDiff } from '../../src/components/pro-v2/architecture/architectureDiff.ts';
import {
    buildDiagramTimeline,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import {
    buildParentToCurrentEvolutionSummary,
    buildRootToCurrentEvolutionSummary,
} from '../../src/components/pro-v2/architecture/diagramEvolutionSummary.ts';
import {
    buildDiagramGuardrails,
} from '../../src/components/pro-v2/architecture/diagramGuardrails.ts';
import {
    buildSessionExportReadModel,
    type SessionExportReadModel,
    type SessionExportSourceResponse,
} from '../../src/lib/export/sessionExportReadModel.ts';
import {
    validateSessionExportReadModel,
} from '../../src/lib/export/sessionExportGuardrails.ts';
import {
    generateSessionExportHtmlReport,
    generateSessionExportMarkdownReport,
} from '../../src/lib/export/sessionExportReportGenerator.ts';
import {
    validateSessionExportClipboardRequest,
    validateSessionExportSaveRequest,
} from '../../src/lib/export/sessionExportDelivery.ts';
import {
    buildExportPreviewModel,
} from '../../src/components/pro-v2/exportPreviewModel.ts';
import {
    buildProviderDiagnosticsReadModel,
} from '../../src/lib/providers/providerDiagnosticsReadModel.ts';
import {
    buildProviderFallbackReadModel,
} from '../../src/lib/providers/providerFallbackReadModel.ts';
import {
    buildProviderPersonalizationReadModel,
} from '../../src/lib/providers/providerPersonalizationReadModel.ts';
import {
    buildProviderRoutingReadModel,
} from '../../src/lib/providers/providerRoutingReadModel.ts';
import {
    buildProviderTelemetryReadModel,
} from '../../src/lib/providers/providerTelemetryReadModel.ts';

const SECRET_NEEDLES = [
    'PHASE_F_SECRET_RESPONSE_TEXT',
    'PHASE_F_SECRET_MARKDOWN',
    'PHASE_F_SECRET_RAW_PROMPT',
    'PHASE_F_SECRET_PROVIDER_PAYLOAD',
    'PHASE_F_SECRET_SCREENSHOT',
    'PHASE_F_SECRET_SCREENSHOT_BUFFER',
    'PHASE_F_SECRET_TRANSCRIPT',
    'PHASE_F_SECRET_TRANSCRIPT_BUFFER',
    'PHASE_F_SECRET_ARCHITECTURE_PAYLOAD',
    'PHASE_F_SECRET_PARSED_DIAGRAM',
    'PHASE_F_SECRET_DIAGRAM_PURPOSE',
    'PHASE_F_SECRET_DEBUG_METADATA',
    'PHASE_F_SECRET_INTELLIGENCE_METADATA',
] as const;

const RAW_LOCAL_PATH = '/Users/tarunshetty/Desktop/private/export-red-team.txt';

function assertNoSensitiveLeak(value: unknown): void {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    SECRET_NEEDLES.forEach((needle) => {
        assert.equal(serialized.includes(needle), false, `Leaked sensitive value: ${needle}`);
    });
    assert.equal(serialized.includes(RAW_LOCAL_PATH), false, 'Leaked raw local filesystem path.');
}

function ownership(responseId: string, overrides: Partial<ResponseOwnership> = {}): ResponseOwnership {
    return {
        responseId,
        questionTurnId: `turn-${responseId}`,
        transcriptVersion: 11,
        contextTarget: 'active_context',
        actionId: 'manual_chat',
        parentResponseId: overrides.parentResponseId,
        mode: 'coding',
        createdAt: 1000,
        sourceProvider: 'openai',
        sourceModel: 'gpt-4.1-mini',
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
        parentResponseId?: string;
        rootResponseId?: string;
        ownership?: ResponseOwnership;
        metadata?: unknown;
        artifacts?: V2ResponseArtifact[];
        timestamp?: number;
    } = {},
): SessionExportSourceResponse & Record<string, unknown> {
    const responseOwnership = options.ownership ?? ownership(responseId, {
        parentResponseId: options.parentResponseId,
    });

    return {
        id: responseId,
        role: 'system',
        requestId: `request-${responseId}`,
        timestamp: options.timestamp ?? responseOwnership.createdAt,
        questionTurnId: responseOwnership.questionTurnId,
        intent: responseOwnership.mode === 'coding' ? 'answer_now' : 'system_design',
        source: 'Manual Input',
        provider: responseOwnership.requestedProvider,
        model: responseOwnership.requestedModel,
        rootResponseId: options.rootResponseId ?? responseId,
        parentResponseId: options.parentResponseId,
        ownership: responseOwnership,
        intelligenceMetadata: {
            unsafe: 'PHASE_F_SECRET_INTELLIGENCE_METADATA',
            ...(options.metadata && typeof options.metadata === 'object' ? options.metadata as Record<string, unknown> : {}),
        },
        debugMetadata: {
            unsafe: 'PHASE_F_SECRET_DEBUG_METADATA',
            ...(options.metadata && typeof options.metadata === 'object' ? options.metadata as Record<string, unknown> : {}),
        },
        isStreaming: false,
        artifacts: options.artifacts,
        text: 'PHASE_F_SECRET_RESPONSE_TEXT',
        markdown: 'PHASE_F_SECRET_MARKDOWN',
        rawPrompt: 'PHASE_F_SECRET_RAW_PROMPT',
        providerPayload: { completion: 'PHASE_F_SECRET_PROVIDER_PAYLOAD' },
        screenshotPreview: 'PHASE_F_SECRET_SCREENSHOT',
        screenshots: ['PHASE_F_SECRET_SCREENSHOT_BUFFER'],
        transcript: 'PHASE_F_SECRET_TRANSCRIPT',
        transcriptBuffer: 'PHASE_F_SECRET_TRANSCRIPT_BUFFER',
        architectureJson: { diagram: { nodes: ['PHASE_F_SECRET_ARCHITECTURE_PAYLOAD'] } },
        parsedDiagram: { nodes: ['PHASE_F_SECRET_PARSED_DIAGRAM'] },
        localFilesystemPath: RAW_LOCAL_PATH,
    };
}

function diagram(nodeIds: string[], edgePairs: Array<[string, string]>): ArchitectureDiagram {
    return {
        type: 'architecture',
        direction: 'TB',
        nodes: nodeIds.map((id) => ({
            id,
            label: id.toUpperCase(),
            kind: id.includes('redis') ? 'cache' : 'service',
            technology: id,
            purpose: `PHASE_F_SECRET_DIAGRAM_PURPOSE_${id}`,
        })),
        edges: edgePairs.map(([source, target]) => ({
            source,
            target,
            label: `${source} to ${target}`,
        })),
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

function buildRedTeamModel(): SessionExportReadModel {
    const direct = response('red-team-direct', {
        rootResponseId: 'red-team-direct',
        timestamp: 1000,
        ownership: ownership('red-team-direct', {
            mode: 'coding',
            actionId: 'manual_chat',
            requestedProvider: 'openai',
            requestedModel: 'gpt-4.1-mini',
            actualProvider: 'openai',
            actualModel: 'gpt-4.1-mini',
            routingReason: `requested_model ${RAW_LOCAL_PATH}`,
        }),
        metadata: {
            routing: {
                requestedProvider: 'openai',
                requestedModel: 'gpt-4.1-mini',
                actualProvider: 'openai',
                actualModel: 'gpt-4.1-mini',
                reason: `requested_model ${RAW_LOCAL_PATH}`,
            },
            telemetry: {
                latencyMs: 421,
                success: true,
                streamingCompleted: true,
                promptTokens: 20,
                completionTokens: 80,
            },
            validation: { valid: true },
        },
    });
    const fallback = response('red-team-fallback', {
        parentResponseId: 'red-team-direct',
        rootResponseId: 'red-team-direct',
        timestamp: 2000,
        ownership: ownership('red-team-fallback', {
            parentResponseId: 'red-team-direct',
            mode: 'coding',
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'groq',
            actualModel: 'llama-3.3-70b-versatile',
            routingReason: `bedrock_auth_expired_fallback ${RAW_LOCAL_PATH}`,
            providerPreference: 'bedrock',
            responseStyle: 'concise',
        }),
        metadata: {
            routing: {
                requestedProvider: 'bedrock',
                requestedModel: 'openai.gpt-oss-120b-1:0',
                actualProvider: 'groq',
                actualModel: 'llama-3.3-70b-versatile',
                reason: `bedrock_auth_expired_fallback ${RAW_LOCAL_PATH}`,
            },
            telemetry: {
                fallbackUsed: true,
                fallbackReason: `bedrock_auth_expired_fallback ${RAW_LOCAL_PATH}`,
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
                    reason: `bedrock_auth_expired_fallback ${RAW_LOCAL_PATH}`,
                },
                {
                    provider: 'groq',
                    model: 'llama-3.3-70b-versatile',
                    result: 'success',
                },
            ],
            validation: { valid: false, reason: `contract_validation_failed ${RAW_LOCAL_PATH}` },
        },
    });
    const rootArtifact = architectureArtifact('red-team-diagram-root', {
        rootResponseId: 'red-team-direct',
        diagram: diagram(['user', 'app'], [['user', 'app']]),
    });
    const childArtifact = architectureArtifact('red-team-diagram-child', {
        parentResponseId: 'red-team-diagram-root',
        rootResponseId: 'red-team-direct',
        diagram: diagram(['user', 'app', 'redis'], [['user', 'app'], ['app', 'redis']]),
        diff: {
            addedNodes: [{ id: 'redis' }],
            addedEdges: [{ key: 'app->redis' }],
        },
    });
    const diagramRoot = response('red-team-diagram-root', {
        parentResponseId: 'red-team-fallback',
        rootResponseId: 'red-team-direct',
        timestamp: 3000,
        ownership: ownership('red-team-diagram-root', {
            parentResponseId: 'red-team-fallback',
            mode: 'system_design',
            actionId: 'what_to_answer',
        }),
        artifacts: [rootArtifact],
    });
    const diagramChild = response('red-team-diagram-child', {
        parentResponseId: 'red-team-diagram-root',
        rootResponseId: 'red-team-direct',
        timestamp: 4000,
        ownership: ownership('red-team-diagram-child', {
            parentResponseId: 'red-team-diagram-root',
            mode: 'system_design',
            actionId: 'deep_dive',
        }),
        artifacts: [childArtifact],
    });
    const responses = [direct, fallback, diagramRoot, diagramChild];
    const activeResponseId = 'red-team-diagram-child';
    const timeline = buildDiagramTimeline(responses, activeResponseId);

    return buildSessionExportReadModel({
        responses,
        activeResponseId,
        generatedAt: 7000,
        providerRouting: buildProviderRoutingReadModel({ responses, activeResponseId, now: 7000 }),
        providerFallback: buildProviderFallbackReadModel({ responses, activeResponseId, now: 7000 }),
        providerTelemetry: buildProviderTelemetryReadModel({ responses, activeResponseId, now: 7000 }),
        providerDiagnostics: buildProviderDiagnosticsReadModel({ responses, activeResponseId, now: 7000 }),
        providerPersonalization: buildProviderPersonalizationReadModel({ responses, activeResponseId, now: 7000 }),
        diagramTimeline: timeline,
        parentCurrentEvolution: buildParentToCurrentEvolutionSummary(timeline, activeResponseId),
        rootCurrentEvolution: buildRootToCurrentEvolutionSummary(timeline, activeResponseId),
        diagramGuardrails: buildDiagramGuardrails(timeline, activeResponseId),
    });
}

test('Sprint 11 Phase F red-team fixture keeps sensitive payloads out of export models and reports', () => {
    const model = buildRedTeamModel();
    const validation = validateSessionExportReadModel(model);
    const markdown = generateSessionExportMarkdownReport(model);
    const html = generateSessionExportHtmlReport(model);
    const markdownPreview = buildExportPreviewModel(model, 'markdown');
    const htmlPreview = buildExportPreviewModel(model, 'html');

    assert.equal(validation.status, 'valid');
    assert.equal(markdown.blocked, false);
    assert.equal(html.blocked, false);
    assert.equal(markdownPreview.blocked, false);
    assert.equal(htmlPreview.blocked, false);
    assert.match(JSON.stringify(model), /\[local-path-redacted\]/);
    assert.match(markdown.content, /\[local-path-redacted\]/);
    assert.match(html.content, /\[local-path-redacted\]/);
    assert.match(markdown.content, /bedrock_auth_expired_fallback/);
    assert.match(markdown.content, /redis/);

    assertNoSensitiveLeak(model);
    assertNoSensitiveLeak(markdown.content);
    assertNoSensitiveLeak(html.content);
    assertNoSensitiveLeak(markdownPreview.contentPreview);
    assertNoSensitiveLeak(htmlPreview.contentPreview);
});

test('Sprint 11 Phase F blocks tampered export models before delivery contracts can use them', () => {
    const tamperedModel = {
        ...buildRedTeamModel(),
        responses: [
            {
                ...buildRedTeamModel().responses[0],
                text: 'PHASE_F_SECRET_RESPONSE_TEXT',
                providerPayload: 'PHASE_F_SECRET_PROVIDER_PAYLOAD',
                debugMetadata: { rawPrompt: 'PHASE_F_SECRET_RAW_PROMPT' },
            },
        ],
    } as unknown as SessionExportReadModel;
    const markdown = generateSessionExportMarkdownReport(tamperedModel);
    const html = generateSessionExportHtmlReport(tamperedModel);
    const preview = buildExportPreviewModel(tamperedModel, 'markdown');
    const saveValidation = validateSessionExportSaveRequest({
        format: 'markdown',
        content: preview.contentPreview,
        guardrailStatus: preview.guardrailStatus,
        blocked: preview.blocked,
    });
    const clipboardValidation = validateSessionExportClipboardRequest({
        format: 'markdown',
        content: preview.contentPreview,
        guardrailStatus: preview.guardrailStatus,
        blocked: preview.blocked,
    });

    assert.equal(markdown.blocked, true);
    assert.equal(html.blocked, true);
    assert.equal(preview.blocked, true);
    assert.equal(preview.guardrailFeedback.canPreviewReport, false);
    assert.equal(saveValidation.valid, false);
    assert.equal(clipboardValidation.valid, false);

    assertNoSensitiveLeak(markdown.content);
    assertNoSensitiveLeak(html.content);
    assertNoSensitiveLeak(preview.contentPreview);
    assertNoSensitiveLeak(preview.guardrailFeedback);
});

test('Sprint 11 Phase F accepts only guardrail-passed preview content for Save-As and clipboard delivery', () => {
    const model = buildRedTeamModel();
    const preview = buildExportPreviewModel(model, 'html');
    const saveValidation = validateSessionExportSaveRequest({
        format: preview.format,
        content: preview.contentPreview,
        generatedAt: model.generatedAt,
        suggestedFileName: 'red-team-export.html',
        guardrailStatus: preview.guardrailStatus === 'warning' ? 'warning' : 'valid',
        blocked: false,
    });
    const clipboardValidation = validateSessionExportClipboardRequest({
        format: preview.format,
        content: preview.contentPreview,
        guardrailStatus: preview.guardrailStatus === 'warning' ? 'warning' : 'valid',
        blocked: false,
    });
    const unsafeClipboardValidation = validateSessionExportClipboardRequest({
        format: 'html',
        content: '<!doctype html><script>PHASE_F_SECRET_PROVIDER_PAYLOAD</script>',
        guardrailStatus: 'valid',
        blocked: false,
    });

    assert.equal(preview.blocked, false);
    assert.equal(saveValidation.valid, true);
    assert.equal(clipboardValidation.valid, true);
    assert.equal(unsafeClipboardValidation.valid, false);
    assertNoSensitiveLeak(preview.contentPreview);
});
