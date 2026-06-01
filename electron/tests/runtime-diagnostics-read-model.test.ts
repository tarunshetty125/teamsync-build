import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    buildDiagramTimeline,
    type DiagramTimelineMessage,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import {
    ARCHITECTURE_GUARDRAIL_EDGE_CAP,
    ARCHITECTURE_GUARDRAIL_NODE_CAP,
    ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT,
    buildDiagramGuardrails,
} from '../../src/components/pro-v2/architecture/diagramGuardrails.ts';
import {
    type ArchitectureDiagram,
    type ArchitectureNodeModel,
    validateArchitecturePayload,
} from '../../src/components/pro-v2/architecture/architectureSchema.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';
import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import {
    buildSessionExportReadModel,
    type SessionExportSourceResponse,
} from '../../src/lib/export/sessionExportReadModel.ts';
import { validateSessionExportReadModel } from '../../src/lib/export/sessionExportGuardrails.ts';
import {
    SESSION_EXPORT_PDF_RUNTIME_BUDGETS,
    validateSessionExportPdfBuffer,
    validateSessionExportPdfSaveRequest,
} from '../../src/lib/export/sessionExportDelivery.ts';
import {
    buildProviderAnalyticsSessionSnapshot,
    validateProviderAnalyticsSessionSnapshot,
    type ProviderAnalyticsSnapshotMessage,
} from '../../src/lib/providers/providerAnalyticsSessionSnapshot.ts';
import {
    buildProviderDiagnosticsReadModel,
    type ProviderDiagnosticsReadModel,
} from '../../src/lib/providers/providerDiagnosticsReadModel.ts';
import {
    buildProviderHealthReadModel,
    type ProviderHealthReadModel,
} from '../../src/lib/providers/providerHealthReadModel.ts';
import {
    buildProviderPersonalizationReadModel,
    type ProviderPersonalizationReadModel,
} from '../../src/lib/providers/providerPersonalizationReadModel.ts';
import type { ProviderRoutingMessage } from '../../src/lib/providers/providerRoutingReadModel.ts';
import {
    buildRuntimeDiagnosticsReadModel,
    type RuntimeDiagnosticsReadModel,
} from '../../src/lib/diagnostics/runtimeDiagnosticsReadModel.ts';

function responseOwnership(responseId: string, overrides: Partial<ResponseOwnership> = {}): ResponseOwnership {
    return {
        responseId,
        questionTurnId: `turn-${responseId}`,
        transcriptVersion: 1,
        contextTarget: 'active_context',
        actionId: 'manual_chat',
        mode: 'coding',
        createdAt: 1000,
        requestedProvider: 'bedrock',
        requestedModel: 'openai.gpt-oss-120b-1:0',
        actualProvider: 'bedrock',
        actualModel: 'openai.gpt-oss-120b-1:0',
        personalizationVersion: 1,
        ...overrides,
    };
}

function providerDiagnosticsFixture(): ProviderDiagnosticsReadModel {
    const health: ProviderHealthReadModel = buildProviderHealthReadModel({
        credentials: {
            hasBedrockCredentials: true,
            hasGroqKey: true,
            hasGeminiKey: true,
            hasOpenaiKey: true,
            hasClaudeKey: true,
        },
        bedrock: {
            authExpired: true,
            checkedAt: 1500,
        },
        groqHealth: {
            totalKeys: 1,
            availableKeys: 1,
            exhaustedKeys: 0,
            coolingDownKeys: 0,
            invalidKeys: 0,
        },
        connectionTests: {
            gemini: { success: true },
            openai: { success: true },
            claude: { success: true },
        },
        ollama: {
            status: 'detected',
            models: ['llama3.2'],
        },
        now: 1600,
    });
    const responses: ProviderRoutingMessage[] = [
        {
            id: 'response-fallback',
            requestId: 'request-fallback',
            timestamp: 2000,
            intelligenceMetadata: {
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
                },
                fallbackChain: [
                    { provider: 'bedrock', model: 'openai.gpt-oss-120b-1:0', result: 'failure', reason: 'session expired' },
                    { provider: 'groq', model: 'llama-3.3-70b-versatile', result: 'success' },
                ],
            },
        },
        {
            id: 'response-remap',
            timestamp: 2100,
            ownership: responseOwnership('response-remap', {
                actionId: 'answer_now',
                actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                routingReason: 'vision_required_model_remap',
            }),
        },
        {
            id: 'response-telemetry',
            requestId: 'request-telemetry',
            timestamp: 2200,
            intelligenceMetadata: {
                routing: {
                    requestedProvider: 'openai',
                    requestedModel: 'gpt-4.1-mini',
                    actualProvider: 'openai',
                    actualModel: 'gpt-4.1-mini',
                    reason: 'requested_model',
                },
                telemetry: {
                    success: false,
                    error: 'provider request failed',
                    latencyMs: 500,
                },
            },
        },
    ];

    return buildProviderDiagnosticsReadModel({
        responses,
        health,
        activeResponseId: 'response-fallback',
        now: 3000,
    });
}

function node(index: number): ArchitectureNodeModel {
    return {
        id: `node-${index}`,
        label: `Node ${index}`,
        kind: index === 0 ? 'client' : 'service',
    };
}

function diagram(nodeCount: number, edgeCount = Math.max(0, nodeCount - 1)): ArchitectureDiagram {
    const nodes = Array.from({ length: nodeCount }, (_, index) => node(index));
    const edges = Array.from({ length: edgeCount }, (_, index) => ({
        source: nodes[index % Math.max(1, nodes.length - 1)]?.id ?? 'node-0',
        target: nodes[(index % Math.max(1, nodes.length - 1)) + 1]?.id ?? 'node-0',
        label: `edge-${index}`,
    })).filter((edge) => edge.source !== edge.target);

    return {
        type: 'architecture',
        direction: 'TB',
        nodes,
        edges,
    };
}

function architectureArtifact(
    responseId: string,
    options: {
        parentResponseId?: string;
        rootResponseId?: string;
        diagram?: ArchitectureDiagram | null;
        fallbackDiagram?: ArchitectureDiagram | null;
        issues?: string[];
    } = {},
): V2ResponseArtifact {
    return {
        id: `${responseId}:architecture`,
        responseId,
        parentResponseId: options.parentResponseId,
        rootResponseId: options.rootResponseId ?? responseId,
        kind: 'architecture',
        source: 'architecture_json',
        createdAt: 6000,
        status: options.diagram === null && options.fallbackDiagram ? 'fallback' : 'parsed',
        payload: {
            diagram: options.diagram === undefined ? diagram(3) : options.diagram,
            fallbackDiagram: options.fallbackDiagram ?? null,
            issues: options.issues ?? [],
        },
    };
}

function diagramMessages(current: {
    diagram?: ArchitectureDiagram | null;
    fallbackDiagram?: ArchitectureDiagram | null;
    issues?: string[];
}): DiagramTimelineMessage[] {
    return [
        {
            id: 'diagram-response-1',
            rootResponseId: 'diagram-response-1',
            artifacts: [architectureArtifact('diagram-response-1', { diagram: diagram(3) })],
        },
        {
            id: 'diagram-response-2',
            rootResponseId: 'diagram-response-1',
            ownership: { parentResponseId: 'diagram-response-1' },
            artifacts: [
                architectureArtifact('diagram-response-2', {
                    parentResponseId: 'diagram-response-1',
                    rootResponseId: 'diagram-response-1',
                    diagram: current.diagram,
                    fallbackDiagram: current.fallbackDiagram,
                    issues: current.issues,
                }),
            ],
        },
    ];
}

function exportResponse(responseId: string, overrides: Partial<SessionExportSourceResponse> = {}): SessionExportSourceResponse {
    const ownership = overrides.ownership ?? responseOwnership(responseId, {
        requestedProvider: 'openai',
        requestedModel: 'gpt-4.1-mini',
        actualProvider: 'openai',
        actualModel: 'gpt-4.1-mini',
    });

    return {
        id: responseId,
        role: 'system',
        requestId: `request-${responseId}`,
        timestamp: ownership.createdAt,
        questionTurnId: ownership.questionTurnId,
        intent: 'manual_chat',
        source: 'Manual Input',
        provider: ownership.requestedProvider,
        model: ownership.requestedModel,
        rootResponseId: responseId,
        ownership,
        isStreaming: false,
        ...overrides,
    };
}

function validExportModel() {
    return buildSessionExportReadModel({
        responses: [
            exportResponse('export-response-1'),
            exportResponse('export-response-2', {
                rootResponseId: 'export-response-1',
                parentResponseId: 'export-response-1',
                ownership: responseOwnership('export-response-2', {
                    parentResponseId: 'export-response-1',
                    requestedProvider: 'openai',
                    requestedModel: 'gpt-4.1-mini',
                    actualProvider: 'openai',
                    actualModel: 'gpt-4.1-mini',
                }),
            }),
        ],
        activeResponseId: 'export-response-2',
        generatedAt: 4000,
    });
}

function snapshotMessages(): ProviderAnalyticsSnapshotMessage[] {
    return [
        {
            id: 'snapshot-response-1',
            role: 'system',
            requestId: 'request-snapshot-1',
            timestamp: 5000,
            rootResponseId: 'snapshot-response-1',
            ownership: responseOwnership('snapshot-response-1'),
            debugMetadata: {
                routing: {
                    requestedProvider: 'bedrock',
                    requestedModel: 'openai.gpt-oss-120b-1:0',
                    actualProvider: 'bedrock',
                    actualModel: 'openai.gpt-oss-120b-1:0',
                    reason: 'requested_model',
                },
            },
        },
    ];
}

function assertNoSensitivePayload(model: RuntimeDiagnosticsReadModel): void {
    const serialized = JSON.stringify(model);
    assert.doesNotMatch(serialized, /LEAKED_RESPONSE_TEXT/);
    assert.doesNotMatch(serialized, /SECRET_PROMPT/);
    assert.doesNotMatch(serialized, /\/Users\/tarunshetty\/private/);
    assert.doesNotMatch(serialized, /file:\/\/\/Users/);
}

test('Sprint 13 Phase B normalizes provider diagnostics into provider domains', () => {
    const model = buildRuntimeDiagnosticsReadModel({
        providerDiagnostics: providerDiagnosticsFixture(),
        activeResponseId: 'response-fallback',
        generatedAt: 9000,
    });

    assert.equal(model.generatedAt, 9000);
    assert.equal(model.byDomain['provider.health'].length, 1);
    assert.equal(model.byDomain['provider.fallback'].length, 1);
    assert.equal(model.byDomain['provider.routing'].length, 1);
    assert.equal(model.byDomain['provider.telemetry'].length, 1);
    assert.equal(model.byResponseId['response-fallback'].length, 1);
    assert.equal(model.activeEvents.length, 1);
    assert.equal(model.activeEvents[0].domain, 'provider.fallback');
    assert.equal(model.activeEvents[0].provider, 'bedrock');
    assert.equal(model.activeEvents[0].routingReason, 'bedrock_auth_expired_fallback');
    assert.equal(model.activeEvents[0].userVisible, true);
    assert.equal(model.summary.errorCount, 3);
    assert.equal(model.summary.infoCount, 1);
});

test('Sprint 13 Phase B normalizes diagram guardrail warnings, truncation, and oversized states', () => {
    const warningTimeline = buildDiagramTimeline(diagramMessages({
        diagram: diagram(20),
    }), 'diagram-response-2');
    const truncatedValidation = validateArchitecturePayload({
        type: 'architecture',
        direction: 'TB',
        nodes: Array.from({ length: ARCHITECTURE_GUARDRAIL_NODE_CAP + 1 }, (_, index) => ({
            id: `raw-${index}`,
            label: `Raw ${index}`,
            kind: 'service',
        })),
        edges: [],
    });
    const truncatedTimeline = buildDiagramTimeline(diagramMessages({
        diagram: truncatedValidation.diagram,
        issues: truncatedValidation.issues,
    }), 'diagram-response-2');
    const oversizedTimeline = buildDiagramTimeline(diagramMessages({
        diagram: diagram(ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT, ARCHITECTURE_GUARDRAIL_EDGE_CAP),
    }), 'diagram-response-2');
    const model = buildRuntimeDiagnosticsReadModel({
        diagramGuardrails: [
            buildDiagramGuardrails(warningTimeline),
            buildDiagramGuardrails(truncatedTimeline),
            buildDiagramGuardrails(oversizedTimeline),
        ],
        generatedAt: 9100,
    });

    assert.equal(model.byDomain['diagram.guardrail'].length > 0, true);
    assert.equal(model.events.every((event) => event.domain !== 'diagram.guardrail' || event.severity === 'warning'), true);
    assert.equal(model.events.some((event) => event.code === 'diagram_truncated_by_parser'), true);
    assert.equal(model.events.some((event) => event.code === 'diagram_oversized_for_comparison'), true);
    assert.equal(model.events.some((event) => event.redactedContext?.nodes === ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT), true);
});

test('Sprint 13 Phase B normalizes export guardrails and redacts sensitive values', () => {
    const warningModel = {
        ...validExportModel(),
        providers: {
            ...validExportModel().providers,
            routingSummary: {
                ...validExportModel().providers.routingSummary,
                byReason: {
                    ['x'.repeat(260 * 1024)]: 1,
                },
            },
        },
    };
    const invalidModel = {
        ...validExportModel(),
        responses: [
            {
                ...validExportModel().responses[0],
                text: 'LEAKED_RESPONSE_TEXT',
                debugMetadata: { prompt: 'SECRET_PROMPT' },
            },
        ],
        providers: {
            ...validExportModel().providers,
            routingSummary: {
                ...validExportModel().providers.routingSummary,
                byReason: {
                    '/Users/tarunshetty/private/token.txt': 1,
                },
            },
        },
    };
    const model = buildRuntimeDiagnosticsReadModel({
        exportGuardrails: validateSessionExportReadModel(warningModel),
        snapshotValidation: validateProviderAnalyticsSessionSnapshot({
            ...buildProviderAnalyticsSessionSnapshot(snapshotMessages(), 'snapshot-response-1', 5000),
            markdown: 'LEAKED_RESPONSE_TEXT',
        }),
        generatedAt: 9200,
    });
    const criticalModel = buildRuntimeDiagnosticsReadModel({
        exportGuardrails: validateSessionExportReadModel(invalidModel),
        generatedAt: 9201,
    });

    assert.equal(model.events.some((event) => event.domain === 'export.guardrail' && event.code === 'payload_size_warning' && event.severity === 'warning'), true);
    assert.equal(model.events.some((event) => event.domain === 'snapshot.guardrail' && event.code === 'metadata_only_shape_violation' && event.severity === 'critical'), true);
    assert.equal(model.events.some((event) => event.domain === 'snapshot.guardrail' && event.userVisible === false), true);
    assert.equal(criticalModel.events.some((event) => event.domain === 'export.guardrail' && event.severity === 'critical'), true);
    assertNoSensitivePayload(model);
    assertNoSensitivePayload(criticalModel);
});

test('Sprint 13 Phase B normalizes validation metadata for contract and repair outcomes', () => {
    const model = buildRuntimeDiagnosticsReadModel({
        validationMetadata: [
            {
                responseId: 'validation-valid',
                valid: true,
                warnings: [],
                issues: [],
                timestamp: 1000,
            },
            {
                responseId: 'validation-warning',
                requestId: 'request-warning',
                actionId: 'manual_chat',
                valid: true,
                warnings: ['minor_contract_warning'],
                timestamp: 1100,
            },
            {
                responseId: 'validation-repaired',
                valid: true,
                repairApplied: true,
                timestamp: 1200,
            },
            {
                responseId: 'validation-invalid',
                valid: false,
                issues: ['coding_missing_code_block', 'repair_empty', 'repair_invalid'],
                repairApplied: true,
                timestamp: 1300,
            },
        ],
        activeResponseId: 'validation-invalid',
        generatedAt: 9300,
    });

    assert.equal(model.byDomain['validation.contract'].length, 2);
    assert.equal(model.byDomain['validation.repair'].length, 3);
    assert.equal(model.events.some((event) => event.code === 'repaired' && event.status === 'success' && event.severity === 'info'), true);
    assert.equal(model.events.filter((event) => event.code === 'repair_failed' && event.status === 'error' && event.severity === 'error').length, 2);
    assert.equal(model.byResponseId['validation-valid'], undefined);
    assert.equal(model.activeEvents.length, 3);
});

test('Sprint 13 Phase B validates retained ownership lineage without mutating ownership', () => {
    const ownershipByResponseId = {
        'lineage-response-1': {
            ...responseOwnership('wrong-response-id'),
            rootResponseId: 'lineage-response-1',
        },
        'lineage-response-2': {
            ...responseOwnership('lineage-response-2', {
                parentResponseId: 'removed-parent',
            }),
            rootResponseId: 'removed-root',
        },
        'removed-response': {
            ...responseOwnership('removed-response'),
            parentResponseId: 'also-removed',
            rootResponseId: 'also-removed-root',
        },
    };
    const model = buildRuntimeDiagnosticsReadModel({
        ownershipByResponseId,
        retainedResponseIds: ['lineage-response-1', 'lineage-response-2'],
        generatedAt: 9400,
    });

    assert.equal(model.byDomain['ownership.lineage'].length, 3);
    assert.equal(model.events.some((event) => event.code === 'ownership_response_id_mismatch'), true);
    assert.equal(model.events.some((event) => event.code === 'parent_response_not_retained'), true);
    assert.equal(model.events.some((event) => event.code === 'root_response_not_retained'), true);
    assert.equal(model.events.some((event) => event.responseId === 'removed-response'), false);
    assert.equal(ownershipByResponseId['lineage-response-2'].parentResponseId, 'removed-parent');
});

test('Sprint 13 Phase B normalizes notable personalization resolution statuses only', () => {
    const personalization: ProviderPersonalizationReadModel = buildProviderPersonalizationReadModel({
        responses: [
            { id: 'personalization-not-captured', timestamp: 1000 },
            {
                id: 'personalization-fallback',
                timestamp: 1001,
                ownership: responseOwnership('personalization-fallback', {
                    providerPreference: 'bedrock',
                    requestedProvider: 'bedrock',
                    requestedModel: 'openai.gpt-oss-120b-1:0',
                    actualProvider: 'groq',
                    actualModel: 'llama-3.3-70b-versatile',
                    routingReason: 'bedrock_auth_expired_fallback',
                }),
            },
            {
                id: 'personalization-remapped',
                timestamp: 1002,
                ownership: responseOwnership('personalization-remapped', {
                    providerPreference: 'bedrock',
                    requestedProvider: 'bedrock',
                    requestedModel: 'openai.gpt-oss-120b-1:0',
                    actualProvider: 'claude',
                    actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                    routingReason: 'vision_required_model_remap',
                }),
            },
            {
                id: 'personalization-bypassed',
                timestamp: 1003,
                ownership: responseOwnership('personalization-bypassed', {
                    providerPreference: 'bedrock',
                    requestedProvider: 'openai',
                    requestedModel: 'gpt-4.1-mini',
                    actualProvider: 'openai',
                    actualModel: 'gpt-4.1-mini',
                }),
            },
            {
                id: 'personalization-applied',
                timestamp: 1004,
                ownership: responseOwnership('personalization-applied', {
                    providerPreference: 'bedrock',
                    requestedProvider: 'bedrock',
                    requestedModel: 'openai.gpt-oss-120b-1:0',
                    actualProvider: 'bedrock',
                    actualModel: 'openai.gpt-oss-120b-1:0',
                }),
            },
        ],
        activeResponseId: 'personalization-fallback',
        now: 9500,
    });
    const model = buildRuntimeDiagnosticsReadModel({
        personalization,
        activeResponseId: 'personalization-fallback',
        generatedAt: 9500,
    });

    assert.equal(model.byDomain['personalization.resolution'].length, 4);
    assert.equal(model.events.some((event) => event.code === 'not_captured' && event.severity === 'info'), true);
    assert.equal(model.events.some((event) => event.code === 'fallback' && event.severity === 'warning'), true);
    assert.equal(model.events.some((event) => event.code === 'remapped' && event.severity === 'warning'), true);
    assert.equal(model.events.some((event) => event.code === 'bypassed' && event.severity === 'warning'), true);
    assert.equal(model.events.some((event) => event.responseId === 'personalization-applied'), false);
    assert.equal(model.activeEvents.length, 1);
});

test('Sprint 13 Phase B normalizes PDF delivery diagnostics without emitting success events', () => {
    const invalidRequest = validateSessionExportPdfSaveRequest({
        sourceFormat: 'html',
        html: '<!doctype html><html><body><script>alert(1)</script></body></html>',
        guardrailStatus: 'valid',
        blocked: false,
    });
    const invalidBuffer = validateSessionExportPdfBuffer(new TextEncoder().encode('not a pdf'));
    const warningBuffer = validateSessionExportPdfBuffer(new Uint8Array(SESSION_EXPORT_PDF_RUNTIME_BUDGETS.warningPdfBytes + 1).fill(0x20));
    warningBuffer.valid = true;
    warningBuffer.warning = 'Generated PDF is larger than the preferred output budget.';
    warningBuffer.byteLength = SESSION_EXPORT_PDF_RUNTIME_BUDGETS.warningPdfBytes + 1;
    const model = buildRuntimeDiagnosticsReadModel({
        pdfDelivery: {
            format: 'pdf',
            requestValidation: invalidRequest,
            bufferValidation: invalidBuffer,
            saveResult: {
                success: false,
                error: 'Unable to save /Users/tarunshetty/private/report.pdf',
            },
            timestamp: 9600,
        },
        generatedAt: 9600,
    });
    const warningModel = buildRuntimeDiagnosticsReadModel({
        pdfDelivery: {
            format: 'pdf',
            bufferValidation: warningBuffer,
            saveResult: { success: false, canceled: true },
            timestamp: 9601,
        },
        generatedAt: 9601,
    });
    const successModel = buildRuntimeDiagnosticsReadModel({
        pdfDelivery: {
            format: 'pdf',
            bufferValidation: validateSessionExportPdfBuffer(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
            saveResult: { success: true, filePath: '/Users/tarunshetty/private/report.pdf' },
            timestamp: 9602,
        },
        generatedAt: 9602,
    });

    assert.equal(model.byDomain['export.delivery'].length, 3);
    assert.equal(model.events.some((event) => event.code === 'pdf_request_invalid' && event.severity === 'error'), true);
    assert.equal(model.events.some((event) => event.code === 'pdf_buffer_invalid' && event.severity === 'error'), true);
    assert.equal(model.events.some((event) => event.code === 'pdf_save_failed' && event.severity === 'error'), true);
    assert.equal(warningModel.events.some((event) => event.code === 'pdf_buffer_warning' && event.severity === 'warning'), true);
    assert.equal(warningModel.events.some((event) => event.code === 'pdf_save_canceled' && event.severity === 'info'), true);
    assert.equal(successModel.events.length, 0);
    assertNoSensitivePayload(model);
    assertNoSensitivePayload(successModel);
});

test('Sprint 13 Phase B provides deterministic grouping, active events, and stable ids', () => {
    const first = buildRuntimeDiagnosticsReadModel({
        providerDiagnostics: providerDiagnosticsFixture(),
        validationMetadata: [
            {
                responseId: 'response-fallback',
                valid: false,
                issues: ['coding_missing_code_block'],
                timestamp: 1000,
            },
        ],
        activeResponseId: 'response-fallback',
        generatedAt: 9700,
    });
    const second = buildRuntimeDiagnosticsReadModel({
        providerDiagnostics: providerDiagnosticsFixture(),
        validationMetadata: [
            {
                responseId: 'response-fallback',
                valid: false,
                issues: ['coding_missing_code_block'],
                timestamp: 1000,
            },
        ],
        activeResponseId: 'response-fallback',
        generatedAt: 9700,
    });

    assert.deepEqual(first.events.map((event) => event.id), second.events.map((event) => event.id));
    assert.equal(Object.keys(first.byId).length, first.events.length);
    assert.equal(first.bySeverity.error.length, first.summary.errorCount);
    assert.equal(first.bySeverity.info.length, first.summary.infoCount);
    assert.equal(first.byDomain['provider.fallback'].length, 1);
    assert.equal(first.byDomain['validation.contract'].length, 1);
    assert.equal(first.byResponseId['response-fallback'].length, first.activeEvents.length);
    assert.equal(first.summary.totalEvents, first.events.length);
    assert.equal(first.summary.userVisibleCount, first.events.filter((event) => event.userVisible).length);
});
