import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';
import {
    buildSessionExportReadModel,
    SESSION_EXPORT_PRIVACY_ALLOWLIST,
    type SessionExportSourceResponse,
} from '../../src/lib/export/sessionExportReadModel.ts';
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

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function ownership(
    responseId: string,
    overrides: Partial<ResponseOwnership> = {},
): ResponseOwnership {
    return {
        responseId,
        questionTurnId: `turn-${responseId}`,
        transcriptVersion: 5,
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
        role?: string;
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
        role: options.role ?? 'system',
        requestId: `request-${responseId}`,
        timestamp: options.timestamp ?? responseOwnership.createdAt,
        questionTurnId: responseOwnership.questionTurnId,
        intent: responseOwnership.mode === 'coding' ? 'answer_now' : 'manual_chat',
        source: 'Manual Input',
        provider: responseOwnership.requestedProvider,
        model: responseOwnership.requestedModel,
        rootResponseId: options.rootResponseId ?? responseId,
        parentResponseId: options.parentResponseId,
        ownership: responseOwnership,
        intelligenceMetadata: options.metadata,
        debugMetadata: options.metadata,
        isStreaming: false,
        artifacts: options.artifacts,
        text: 'SECRET_RESPONSE_TEXT',
        markdown: 'SECRET_MARKDOWN',
        rawPrompt: 'SECRET_RAW_PROMPT',
        providerPayload: { completion: 'SECRET_PROVIDER_PAYLOAD' },
        screenshotPreview: 'SECRET_SCREENSHOT',
        screenshots: ['SECRET_SCREENSHOT_BUFFER'],
        transcript: 'SECRET_TRANSCRIPT',
        transcriptBuffer: 'SECRET_TRANSCRIPT_BUFFER',
        architectureJson: { diagram: { nodes: ['SECRET_ARCHITECTURE_PAYLOAD'] } },
        parsedDiagram: { nodes: ['SECRET_PARSED_DIAGRAM'] },
        localFilesystemPath: '/Users/tarunshetty/secret/session.txt',
    };
}

function providerSessionResponses(): Array<SessionExportSourceResponse & Record<string, unknown>> {
    return [
        response('response-direct', {
            rootResponseId: 'response-direct',
            ownership: ownership('response-direct', {
                requestedProvider: 'openai',
                requestedModel: 'gpt-4.1-mini',
                actualProvider: 'openai',
                actualModel: 'gpt-4.1-mini',
                routingReason: 'requested_model',
                providerPreference: 'openai',
            }),
            metadata: {
                routing: {
                    requestedProvider: 'openai',
                    requestedModel: 'gpt-4.1-mini',
                    actualProvider: 'openai',
                    actualModel: 'gpt-4.1-mini',
                    reason: 'requested_model',
                },
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
            parentResponseId: 'response-direct',
            rootResponseId: 'response-direct',
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

function diagram(nodeIds: string[], edgePairs: Array<[string, string]> = []): ArchitectureDiagram {
    return {
        type: 'architecture',
        direction: 'TB',
        nodes: nodeIds.map((id) => ({
            id,
            label: id.toUpperCase(),
            kind: id.includes('redis') ? 'cache' : 'service',
            technology: id,
            purpose: `SECRET_DIAGRAM_PAYLOAD_${id}`,
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
        diagram?: ArchitectureDiagram;
        diff?: Partial<ArchitectureDiagramDiff>;
    } = {},
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
            diagram: options.diagram ?? diagram(['user', 'app'], [['user', 'app']]),
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

test('Sprint 10 Phase B exports coding session metadata without response content', () => {
    const responses = [
        response('response-code', {
            rootResponseId: 'response-code',
            ownership: ownership('response-code', {
                actionId: 'manual_chat',
                mode: 'coding',
                resolvedCodingLanguage: 'JavaScript',
                providerPreference: 'openai',
            }),
        }),
    ];

    const model = buildSessionExportReadModel({
        responses,
        activeResponseId: 'response-code',
        generatedAt: 3000,
    });
    const serialized = JSON.stringify(model);

    assert.equal(model.generatedAt, 3000);
    assert.equal(model.privacy.policy, 'allowlist');
    assert.equal(model.privacy.contentIncluded, false);
    assert.deepEqual(model.privacy.allowlist, SESSION_EXPORT_PRIVACY_ALLOWLIST);
    assert.equal(model.responses[0].responseId, 'response-code');
    assert.equal(model.responses[0].isActive, true);
    assert.equal(model.responses[0].ownership?.actionId, 'manual_chat');
    assert.equal(model.responses[0].ownership?.mode, 'coding');
    assert.equal(model.responses[0].ownership?.resolvedCodingLanguage, 'JavaScript');

    assert.doesNotMatch(serialized, /SECRET_RESPONSE_TEXT|SECRET_MARKDOWN|SECRET_RAW_PROMPT|SECRET_PROVIDER_PAYLOAD/);
    assert.doesNotMatch(serialized, /"text"\s*:|"markdown"\s*:|"rawPrompt"\s*:|"providerPayload"\s*:/);
});

test('Sprint 10 Phase B projects provider fallback sessions from Sprint 7 read models', () => {
    const responses = providerSessionResponses();
    const routing = buildProviderRoutingReadModel({
        responses,
        activeResponseId: 'response-fallback',
        now: 4000,
    });
    const fallback = buildProviderFallbackReadModel({
        responses,
        activeResponseId: 'response-fallback',
        now: 4000,
    });
    const telemetry = buildProviderTelemetryReadModel({
        responses,
        activeResponseId: 'response-fallback',
        now: 4000,
    });
    const diagnostics = buildProviderDiagnosticsReadModel({
        responses,
        activeResponseId: 'response-fallback',
        now: 4000,
    });
    const personalization = buildProviderPersonalizationReadModel({
        responses,
        activeResponseId: 'response-fallback',
        now: 4000,
    });

    const model = buildSessionExportReadModel({
        responses,
        activeResponseId: 'response-fallback',
        generatedAt: 4000,
        providerRouting: routing,
        providerFallback: fallback,
        providerTelemetry: telemetry,
        providerDiagnostics: diagnostics,
        providerPersonalization: personalization,
    });

    assert.equal(model.providers.routes.length, 2);
    assert.equal(model.providers.routingSummary?.directCount, 1);
    assert.equal(model.providers.routingSummary?.fallbackCount, 1);
    assert.equal(model.providers.fallbackSummary?.totalFallbacks, 1);
    assert.equal(model.providers.fallbacks[0].category, 'auth_expired');
    assert.equal(model.providers.fallbacks[0].attemptCount, 2);
    assert.equal(model.providers.fallbacks[0].successfulAttempt?.provider, 'groq');
    assert.equal(model.providers.telemetry.length, 2);
    assert.equal(model.providers.diagnostics.some((entry) => entry.category === 'auth_expired'), true);
    assert.equal(model.personalization.summary?.fallbackCount, 1);
    assert.equal(model.summaries.fallbackCount, 1);
});

test('Sprint 10 Phase B projects diagram session summaries without diagram payloads', () => {
    const rootArtifact = architectureArtifact('diagram-root', {
        rootResponseId: 'diagram-root',
        diagram: diagram(['user', 'app'], [['user', 'app']]),
    });
    const childArtifact = architectureArtifact('diagram-child', {
        parentResponseId: 'diagram-root',
        rootResponseId: 'diagram-root',
        diagram: diagram(['user', 'app', 'redis'], [['user', 'app'], ['app', 'redis']]),
        diff: {
            addedNodes: [{ id: 'redis' }],
            addedEdges: [{ key: 'app->redis' }],
        },
    });
    const responses = [
        response('diagram-root', {
            rootResponseId: 'diagram-root',
            artifacts: [rootArtifact],
            ownership: ownership('diagram-root', {
                mode: 'system_design',
                actionId: 'what_to_answer',
            }),
        }),
        response('diagram-child', {
            parentResponseId: 'diagram-root',
            rootResponseId: 'diagram-root',
            artifacts: [childArtifact],
            ownership: ownership('diagram-child', {
                parentResponseId: 'diagram-root',
                mode: 'system_design',
                actionId: 'deep_dive',
            }),
        }),
    ];
    const timeline = buildDiagramTimeline(responses, 'diagram-child');
    const evolution = buildParentToCurrentEvolutionSummary(timeline, 'diagram-child');
    const guardrails = buildDiagramGuardrails(timeline, 'diagram-child');

    const model = buildSessionExportReadModel({
        responses,
        activeResponseId: 'diagram-child',
        generatedAt: 5000,
        diagramTimeline: timeline,
        parentCurrentEvolution: evolution,
        diagramGuardrails: guardrails,
    });
    const serialized = JSON.stringify(model);

    assert.equal(model.diagrams.timeline?.activeVersionCount, 2);
    assert.equal(model.diagrams.timeline?.items[1].diffSummary.addedNodes, 1);
    assert.equal(model.diagrams.evolution?.parentCurrent?.changes.addedNodeIds[0], 'redis');
    assert.equal(model.diagrams.guardrails?.counts.nodes, 3);
    assert.equal(model.responses[1].artifactSummary.architectureCount, 1);
    assert.equal(model.summaries.diagramVersionCount, 2);

    assert.doesNotMatch(serialized, /SECRET_DIAGRAM_PAYLOAD/);
    assert.doesNotMatch(serialized, /"payload"\s*:|"diagram"\s*:|"fallbackDiagram"\s*:|"purpose"\s*:|"technology"\s*:/);
});

test('Sprint 10 Phase B preserves pinned active response selection in export metadata', () => {
    const responses = [
        response('older-response', {
            rootResponseId: 'older-response',
            timestamp: 1000,
        }),
        response('newer-response', {
            parentResponseId: 'older-response',
            rootResponseId: 'older-response',
            timestamp: 2000,
            ownership: ownership('newer-response', {
                parentResponseId: 'older-response',
            }),
        }),
    ];

    const model = buildSessionExportReadModel({
        responses,
        activeResponseId: 'older-response',
        generatedAt: 2500,
    });

    assert.equal(model.session.activeResponseId, 'older-response');
    assert.equal(model.session.responseCount, 2);
    assert.equal(model.session.firstResponseAt, 1000);
    assert.equal(model.session.lastResponseAt, 2000);
    assert.equal(model.responses.find((entry) => entry.responseId === 'older-response')?.isActive, true);
    assert.equal(model.responses.find((entry) => entry.responseId === 'newer-response')?.isActive, false);
});

test('Sprint 10 Phase B privacy projection excludes unsafe fields and redacts local filesystem paths', () => {
    const model = buildSessionExportReadModel({
        responses: [
            response('privacy-response', {
                rootResponseId: 'privacy-response',
                ownership: ownership('privacy-response', {
                    routingReason: 'See /Users/tarunshetty/secret/aws.log before fallback',
                }),
            }),
        ],
        activeResponseId: 'privacy-response',
        generatedAt: 6000,
    });
    const serialized = JSON.stringify(model);

    assert.doesNotMatch(serialized, /SECRET_SCREENSHOT|SECRET_TRANSCRIPT|SECRET_ARCHITECTURE_PAYLOAD|SECRET_PARSED_DIAGRAM/);
    assert.doesNotMatch(serialized, /\/Users\/tarunshetty\/secret/);
    assert.match(serialized, /\[local-path-redacted\]/);
    assert.doesNotMatch(serialized, /"debugMetadata"\s*:|"intelligenceMetadata"\s*:|"screenshots"\s*:|"transcript"\s*:|"architectureJson"\s*:|"parsedDiagram"\s*:/);
});

test('Sprint 10 Phase B remains a pure read model without UI, IPC, or persistence', () => {
    const helper = read('src/lib/export/sessionExportReadModel.ts');

    assert.doesNotMatch(helper, /from 'react'|from "react"/);
    assert.doesNotMatch(helper, /ipcMain|ipcRenderer|safeHandle|preload/);
    assert.doesNotMatch(helper, /localStorage|sessionStorage|indexedDB|electron-store|writeFile|appendFile/);
    assert.doesNotMatch(helper, /marked|markdown|html2|pdf|puppeteer/);
});
