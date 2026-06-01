import { after, test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';
import {
    buildProviderAnalyticsSessionSnapshot,
    buildProviderAnalyticsSessionSnapshotStateKey,
    type ProviderAnalyticsSessionSnapshot,
    type ProviderAnalyticsSnapshotMessage,
} from '../../src/lib/providers/providerAnalyticsSessionSnapshot.ts';
import { buildProviderRoutingReadModel } from '../../src/lib/providers/providerRoutingReadModel.ts';
import { buildProviderFallbackReadModel } from '../../src/lib/providers/providerFallbackReadModel.ts';
import { buildProviderTelemetryReadModel } from '../../src/lib/providers/providerTelemetryReadModel.ts';
import { buildProviderDiagnosticsReadModel } from '../../src/lib/providers/providerDiagnosticsReadModel.ts';
import { buildProviderPersonalizationReadModel } from '../../src/lib/providers/providerPersonalizationReadModel.ts';
import { buildProviderHealthReadModel } from '../../src/lib/providers/providerHealthReadModel.ts';
import { ProviderRoutingTransparencySurface } from '../../src/components/settings/ProviderRoutingTransparencySurface.tsx';
import { ProviderFallbackAnalyticsSurface } from '../../src/components/settings/ProviderFallbackAnalyticsSurface.tsx';
import { ProviderTelemetrySurface } from '../../src/components/settings/ProviderTelemetrySurface.tsx';
import { ProviderPersonalizationImpactSurface } from '../../src/components/settings/ProviderPersonalizationImpactSurface.tsx';
import { ProviderResponseDrilldownSurface } from '../../src/components/settings/ProviderResponseDrilldownSurface.tsx';
import {
    buildDiagramTimeline,
    type DiagramTimeline,
    type DiagramTimelineMessage,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import {
    buildParentToCurrentEvolutionSummary,
    buildRootToCurrentEvolutionSummary,
} from '../../src/components/pro-v2/architecture/diagramEvolutionSummary.ts';
import {
    buildParentCurrentDiagramComparison,
    buildRootCurrentDiagramComparison,
    buildVersionPairDiagramComparison,
} from '../../src/components/pro-v2/architecture/diagramComparison.ts';
import { buildDiagramNodeIntelligence } from '../../src/components/pro-v2/architecture/diagramNodeIntelligence.ts';
import { buildDiagramGuardrails } from '../../src/components/pro-v2/architecture/diagramGuardrails.ts';
import type {
    ArchitectureDiagram,
    ArchitectureEdgeModel,
    ArchitectureNodeKind,
} from '../../src/components/pro-v2/architecture/architectureSchema.ts';
import {
    measurePerformanceCase,
    printPerformanceReport,
    type PerformanceBenchmarkInput,
    type PerformanceBenchmarkResult,
} from './sprint9PerformanceProbe.ts';

const benchmarkResults: PerformanceBenchmarkResult[] = [];
const PROVIDER_SIZES = [30, 100, 500, 1000] as const;
const DIAGRAM_PROFILES = [
    { label: 'Small', nodeCount: 6, edgeCount: 7 },
    { label: 'Medium', nodeCount: 30, edgeCount: 45 },
    { label: 'Parser-cap', nodeCount: 60, edgeCount: 90, issues: ['architecture_nodes_truncated', 'architecture_edges_truncated'] },
] as const;

after(() => {
    printPerformanceReport(benchmarkResults);
});

async function recordBenchmark(input: PerformanceBenchmarkInput): Promise<PerformanceBenchmarkResult> {
    const result = await measurePerformanceCase(input);
    benchmarkResults.push(result);
    assert.equal(
        result.classification !== 'CEILING_EXCEEDED',
        true,
        `${result.area} ${result.case} ${result.size} exceeded ceiling: ${result.max}ms > ${result.ceiling}ms`,
    );
    return result;
}

function iterationsForSize(size: number): number {
    if (size >= 1000) return 5;
    if (size >= 500) return 7;
    return 12;
}

function providerRouteFor(index: number): {
    requestedProvider: string;
    requestedModel: string;
    actualProvider: string;
    actualModel: string;
    routingReason?: string;
} {
    if (index % 25 === 0) {
        return {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'local',
            actualModel: 'safe_action_fallback',
            routingReason: 'all_attempts_failed',
        };
    }

    if (index % 10 === 0) {
        return {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'groq',
            actualModel: 'llama-3.3-70b-versatile',
            routingReason: 'bedrock_auth_expired_fallback',
        };
    }

    if (index % 7 === 0) {
        return {
            requestedProvider: 'bedrock',
            requestedModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'bedrock',
            actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            routingReason: 'vision_required_model_remap',
        };
    }

    if (index % 5 === 0) {
        return {
            requestedProvider: 'gemini',
            requestedModel: 'gemini-2.5-pro',
            actualProvider: 'gemini',
            actualModel: 'gemini-2.5-pro',
        };
    }

    return {
        requestedProvider: 'openai',
        requestedModel: 'gpt-4.1-mini',
        actualProvider: 'openai',
        actualModel: 'gpt-4.1-mini',
    };
}

function providerOwnershipFor(index: number, parentResponseId?: string): ResponseOwnership {
    const route = providerRouteFor(index);

    return {
        responseId: `response-${index}`,
        questionTurnId: `turn-${index}`,
        transcriptVersion: index,
        contextTarget: parentResponseId ? 'active_context' : 'latest_turn',
        actionId: index % 3 === 0 ? 'manual_chat' : 'what_to_answer',
        parentResponseId,
        mode: index % 2 === 0 ? 'coding' : 'system_design',
        createdAt: 10_000 + index,
        sourceProvider: route.requestedProvider,
        sourceModel: route.requestedModel,
        requestedProvider: route.requestedProvider,
        requestedModel: route.requestedModel,
        actualProvider: route.actualProvider,
        actualModel: route.actualModel,
        routingReason: route.routingReason,
        resolvedCodingLanguage: index % 2 === 0 ? 'javascript' : undefined,
        providerPreference: route.requestedProvider,
        responseStyle: index % 3 === 0 ? 'detailed' : index % 3 === 1 ? 'balanced' : 'concise',
        interviewFocus: index % 2 === 0 ? 'coding' : 'system_design',
        personalizationVersion: 1,
    };
}

function providerDebugFor(ownership: ResponseOwnership): unknown {
    const fallbackUsed = Boolean(
        ownership.routingReason?.includes('fallback')
        || ownership.routingReason === 'all_attempts_failed',
    );
    const routeChanged = ownership.requestedProvider !== ownership.actualProvider
        || ownership.requestedModel !== ownership.actualModel
        || Boolean(ownership.routingReason);

    return {
        routing: {
            requestedProvider: ownership.requestedProvider,
            requestedModel: ownership.requestedModel,
            actualProvider: ownership.actualProvider,
            actualModel: ownership.actualModel,
            reason: ownership.routingReason ?? 'requested_model',
        },
        telemetry: {
            selectedProvider: ownership.requestedProvider,
            selectedModel: ownership.requestedModel,
            actualInvokedProvider: ownership.actualProvider,
            actualInvokedModel: ownership.actualModel,
            fallbackUsed,
            fallbackReason: ownership.routingReason,
            latencyMs: 175 + (ownership.transcriptVersion % 50),
            retryCount: fallbackUsed ? 1 : 0,
            streamingCompleted: ownership.transcriptVersion % 13 !== 0,
            success: !fallbackUsed,
            promptTokens: 40 + (ownership.transcriptVersion % 11),
            completionTokens: 90 + (ownership.transcriptVersion % 17),
        },
        fallbackChain: fallbackUsed
            ? [
                {
                    provider: ownership.requestedProvider,
                    model: ownership.requestedModel,
                    result: 'failure',
                    reason: ownership.routingReason,
                },
                {
                    provider: ownership.actualProvider,
                    model: ownership.actualModel,
                    result: routeChanged ? 'success' : 'failure',
                },
            ]
            : [],
        validation: {
            valid: !fallbackUsed,
            reason: fallbackUsed ? 'provider_fallback' : undefined,
        },
        personalization: {
            providerPreference: ownership.providerPreference,
            responseStyle: ownership.responseStyle,
            interviewFocus: ownership.interviewFocus,
            resolvedCodingLanguage: ownership.resolvedCodingLanguage,
            personalizationVersion: ownership.personalizationVersion,
        },
    };
}

function buildProviderMessages(count: number): ProviderAnalyticsSnapshotMessage[] {
    return Array.from({ length: count }, (_, index) => {
        const responseNumber = index + 1;
        const id = `response-${responseNumber}`;
        const parentResponseId = responseNumber > 1 ? `response-${responseNumber - 1}` : undefined;
        const ownership = providerOwnershipFor(responseNumber, parentResponseId);
        const debugMetadata = providerDebugFor(ownership);

        return {
            id,
            role: 'system',
            requestId: `request-${responseNumber}`,
            rootResponseId: 'response-1',
            timestamp: ownership.createdAt,
            questionTurnId: ownership.questionTurnId,
            intent: ownership.actionId ?? 'what_to_answer',
            source: 'Pro V2',
            provider: ownership.requestedProvider ?? 'unknown',
            model: ownership.requestedModel ?? 'unknown',
            ownership,
            intelligenceMetadata: debugMetadata,
            debugMetadata,
            isStreaming: responseNumber % 17 === 0,
        };
    });
}

function providerBudget(caseName: string, size: number): { budgetMs: number; ceilingMs: number; optimizationTarget: string } {
    const budgetsByCase: Record<string, Record<number, number>> = {
        Routing: { 30: 10, 100: 25, 500: 120, 1000: 250 },
        Fallback: { 30: 25, 100: 60, 500: 300, 1000: 650 },
        Telemetry: { 30: 50, 100: 120, 500: 650, 1000: 1400 },
        Diagnostics: { 30: 90, 100: 220, 500: 1200, 1000: 2500 },
        Personalization: { 30: 60, 100: 140, 500: 750, 1000: 1600 },
    };
    const targetByCase: Record<string, string> = {
        Routing: 'Reduce route projection passes over retained response metadata.',
        Fallback: 'Reuse routing projection when building fallback analytics.',
        Telemetry: 'Avoid rebuilding routing and fallback projections inside telemetry.',
        Diagnostics: 'Compose diagnostics from prebuilt routing, fallback, and telemetry projections.',
        Personalization: 'Reuse routing and fallback projections for personalization impact.',
    };
    const budgetMs = budgetsByCase[caseName][size];

    return {
        budgetMs,
        ceilingMs: Math.max(budgetMs * 8, budgetMs + 100),
        optimizationTarget: targetByCase[caseName],
    };
}

function providerHealthFixture() {
    return buildProviderHealthReadModel({
        credentials: {
            hasBedrockCredentials: true,
            hasGroqKey: true,
            hasGeminiKey: true,
            hasOpenaiKey: true,
            hasClaudeKey: true,
        },
        connectionTests: {
            bedrock: { success: true, source: 'sprint9-benchmark' },
            gemini: { success: true, source: 'sprint9-benchmark' },
            openai: { success: true, source: 'sprint9-benchmark' },
            claude: { success: true, source: 'sprint9-benchmark' },
        },
        modelFetches: {
            bedrock: { modelCount: 4, source: 'sprint9-benchmark' },
            groq: { modelCount: 3, source: 'sprint9-benchmark' },
            gemini: { modelCount: 3, source: 'sprint9-benchmark' },
            openai: { modelCount: 3, source: 'sprint9-benchmark' },
            claude: { modelCount: 2, source: 'sprint9-benchmark' },
        },
        ollama: {
            configured: true,
            reachable: true,
            status: 'detected',
            models: ['llama3.2'],
        },
        now: 90_000,
    });
}

function buildProviderSnapshot(size: number): ProviderAnalyticsSessionSnapshot {
    return buildProviderAnalyticsSessionSnapshot(
        buildProviderMessages(size),
        `response-${size}`,
        80_000 + size,
    );
}

function validateProviderSnapshot(snapshot: ProviderAnalyticsSessionSnapshot, size: number): void {
    const health = providerHealthFixture();
    const routing = buildProviderRoutingReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000 + size,
    });
    const fallback = buildProviderFallbackReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000 + size,
    });
    const telemetry = buildProviderTelemetryReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000 + size,
    });
    const diagnostics = buildProviderDiagnosticsReadModel({
        health,
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000 + size,
    });
    const personalization = buildProviderPersonalizationReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000 + size,
    });

    assert.equal(routing.routes.length, size);
    assert.equal(telemetry.entries.length, size);
    assert.equal(personalization.entries.length, size);
    assert.equal(routing.activeRoute?.responseId, `response-${size}`);
    assert.equal(fallback.summary.totalFallbacks > 0, true);
    assert.equal(diagnostics.summary.totalDiagnostics > 0, true);
}

type ProviderModels = ReturnType<typeof buildProviderModels>;

function buildProviderModels(snapshot: ProviderAnalyticsSessionSnapshot) {
    const health = providerHealthFixture();
    const routing = buildProviderRoutingReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000,
    });
    const fallback = buildProviderFallbackReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000,
    });
    const telemetry = buildProviderTelemetryReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000,
    });
    const diagnostics = buildProviderDiagnosticsReadModel({
        health,
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000,
    });
    const personalization = buildProviderPersonalizationReadModel({
        responses: snapshot.responses,
        activeResponseId: snapshot.activeResponseId,
        now: 90_000,
    });

    return {
        health,
        routing,
        fallback,
        telemetry,
        diagnostics,
        personalization,
    };
}

function renderSettingsAnalyticsSurfaces(snapshot: ProviderAnalyticsSessionSnapshot, models: ProviderModels): string {
    return renderToStaticMarkup(
        React.createElement(
            React.Fragment,
            null,
            React.createElement(ProviderRoutingTransparencySurface, { readModel: models.routing }),
            React.createElement(ProviderFallbackAnalyticsSurface, { readModel: models.fallback }),
            React.createElement(ProviderTelemetrySurface, { readModel: models.telemetry }),
            React.createElement(ProviderPersonalizationImpactSurface, { readModel: models.personalization }),
            React.createElement(ProviderResponseDrilldownSurface, {
                ownershipByResponseId: snapshot.ownershipByResponseId,
                routingReadModel: models.routing,
                diagnosticsReadModel: models.diagnostics,
                telemetryReadModel: models.telemetry,
            }),
        ),
    );
}

const NODE_KINDS: ArchitectureNodeKind[] = [
    'client',
    'gateway',
    'service',
    'database',
    'cache',
    'queue',
    'storage',
    'external',
];

function buildDiagram(nodeCount: number, edgeCount: number, seed = 0): ArchitectureDiagram {
    const nodes = Array.from({ length: nodeCount }, (_, index) => {
        const id = `node-${seed}-${index + 1}`;
        return {
            id,
            label: `Service ${seed}-${index + 1}`,
            kind: NODE_KINDS[index % NODE_KINDS.length],
            technology: `Tech ${index % 8}`,
            purpose: `Purpose ${index + 1}`,
            layer: index < 4 ? 'edge' : index < 16 ? 'compute' : 'data',
            latency: `${10 + (index % 9) * 5}ms`,
            failureMode: `Failure mode ${index % 5}`,
        };
    });
    const edges: ArchitectureEdgeModel[] = [];

    for (let sourceIndex = 0; sourceIndex < nodeCount && edges.length < edgeCount; sourceIndex += 1) {
        for (let offset = 1; offset < nodeCount && edges.length < edgeCount; offset += 1) {
            const targetIndex = (sourceIndex + offset) % nodeCount;
            if (sourceIndex === targetIndex) continue;
            edges.push({
                source: nodes[sourceIndex].id,
                target: nodes[targetIndex].id,
                label: `path ${sourceIndex}-${targetIndex}`,
                protocol: offset % 3 === 0 ? 'Kafka' : offset % 2 === 0 ? 'HTTP' : 'gRPC',
                latency: `${5 + (offset % 7) * 3}ms`,
            });
        }
    }

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
        diagram: ArchitectureDiagram;
        diff?: V2ResponseArtifact['payload'];
        issues?: string[];
    },
): V2ResponseArtifact {
    return {
        id: `${responseId}:architecture`,
        responseId,
        parentResponseId: options.parentResponseId,
        rootResponseId: options.rootResponseId ?? responseId,
        kind: 'architecture',
        source: 'architecture_json',
        createdAt: 20_000,
        status: 'parsed',
        payload: {
            diagram: options.diagram,
            fallbackDiagram: null,
            issues: options.issues ?? [],
            ...(options.diff ? { diff: options.diff } : {}),
        },
    };
}

function diagramDiffPayload(
    previous: ArchitectureDiagram,
    next: ArchitectureDiagram,
): V2ResponseArtifact['payload'] {
    const addedNode = next.nodes.find((node) => !previous.nodes.some((previousNode) => previousNode.id === node.id));
    const addedEdge = next.edges.find((edge) => !previous.edges.some(
        (previousEdge) => previousEdge.source === edge.source && previousEdge.target === edge.target,
    ));

    return {
        addedNodes: addedNode ? [{ id: addedNode.id, after: addedNode }] : [],
        removedNodes: [],
        modifiedNodes: [],
        addedEdges: addedEdge ? [{ key: `${addedEdge.source}->${addedEdge.target}`, after: addedEdge }] : [],
        removedEdges: [],
    };
}

function buildDiagramChain(profile: typeof DIAGRAM_PROFILES[number]): DiagramTimelineMessage[] {
    const rootNodeCount = Math.max(2, profile.nodeCount - 2);
    const parentNodeCount = Math.max(2, profile.nodeCount - 1);
    const root = buildDiagram(rootNodeCount, Math.max(1, profile.edgeCount - 4), 1);
    const parent = buildDiagram(parentNodeCount, Math.max(1, profile.edgeCount - 2), 1);
    const current = buildDiagram(profile.nodeCount, profile.edgeCount, 1);

    return [
        {
            id: 'diagram-response-1',
            rootResponseId: 'diagram-response-1',
            artifacts: [
                architectureArtifact('diagram-response-1', {
                    rootResponseId: 'diagram-response-1',
                    diagram: root,
                }),
            ],
        },
        {
            id: 'diagram-response-2',
            rootResponseId: 'diagram-response-1',
            ownership: { parentResponseId: 'diagram-response-1' },
            artifacts: [
                architectureArtifact('diagram-response-2', {
                    parentResponseId: 'diagram-response-1',
                    rootResponseId: 'diagram-response-1',
                    diagram: parent,
                    diff: diagramDiffPayload(root, parent),
                }),
            ],
        },
        {
            id: 'diagram-response-3',
            rootResponseId: 'diagram-response-1',
            ownership: { parentResponseId: 'diagram-response-2' },
            artifacts: [
                architectureArtifact('diagram-response-3', {
                    parentResponseId: 'diagram-response-2',
                    rootResponseId: 'diagram-response-1',
                    diagram: current,
                    diff: diagramDiffPayload(parent, current),
                    issues: 'issues' in profile ? [...profile.issues] : undefined,
                }),
            ],
        },
    ];
}

function diagramBudget(caseName: string, size: string): { budgetMs: number; ceilingMs: number; optimizationTarget: string } {
    const budgetsByCase: Record<string, Record<string, number>> = {
        Timeline: { Small: 10, Medium: 20, 'Parser-cap': 40 },
        'Evolution Summary': { Small: 20, Medium: 60, 'Parser-cap': 150 },
        'Node Intelligence': { Small: 20, Medium: 80, 'Parser-cap': 220 },
        Comparison: { Small: 30, Medium: 120, 'Parser-cap': 300 },
        Guardrails: { Small: 10, Medium: 25, 'Parser-cap': 50 },
    };
    const targetByCase: Record<string, string> = {
        Timeline: 'Keep timeline derivation scoped to activeResponseChain only.',
        'Evolution Summary': 'Preserve stored diff reuse and avoid recomputing root diffs unless the panel needs them.',
        'Node Intelligence': 'Pre-index edges by source and target before deriving node dependencies.',
        Comparison: 'Defer root and version-pair comparison projection until selected.',
        Guardrails: 'Keep guardrail checks count-based and parser-issue based.',
    };
    const budgetMs = budgetsByCase[caseName][size];

    return {
        budgetMs,
        ceilingMs: Math.max(budgetMs * 8, budgetMs + 100),
        optimizationTarget: targetByCase[caseName],
    };
}

function validateDiagramTimeline(timeline: DiagramTimeline, profile: typeof DIAGRAM_PROFILES[number]): void {
    const nodeIntelligence = buildDiagramNodeIntelligence(timeline, {
        responseId: 'diagram-response-3',
        selectedNodeId: 'node-1-1',
    });
    const parentSummary = buildParentToCurrentEvolutionSummary(timeline, 'diagram-response-3');
    const rootSummary = buildRootToCurrentEvolutionSummary(timeline, 'diagram-response-3');
    const comparison = buildRootCurrentDiagramComparison(timeline, 'diagram-response-3');
    const guardrails = buildDiagramGuardrails(timeline, 'diagram-response-3');

    assert.equal(timeline.items.length, 3);
    assert.equal(nodeIntelligence.nodeCount, profile.nodeCount);
    assert.notEqual(parentSummary.diffSource, 'unavailable');
    assert.notEqual(rootSummary.diffSource, 'unavailable');
    assert.equal(comparison.available, true);
    assert.equal(guardrails.counts.nodes, profile.nodeCount);
}

function createMockSnapshotRelay() {
    let snapshot: ProviderAnalyticsSessionSnapshot | null = null;
    const subscribers = new Set<(nextSnapshot: ProviderAnalyticsSessionSnapshot | null) => void>();

    return {
        publish(nextSnapshot: ProviderAnalyticsSessionSnapshot | null) {
            snapshot = nextSnapshot;
            subscribers.forEach((subscriber) => subscriber(snapshot));
        },
        subscribe(subscriber: (nextSnapshot: ProviderAnalyticsSessionSnapshot | null) => void) {
            subscribers.add(subscriber);
            return () => subscribers.delete(subscriber);
        },
    };
}

test('Sprint 9 Phase A measures provider analytics read-model budgets', async () => {
    for (const size of PROVIDER_SIZES) {
        const snapshot = buildProviderSnapshot(size);
        const health = providerHealthFixture();
        const iterations = iterationsForSize(size);
        validateProviderSnapshot(snapshot, size);

        await recordBenchmark({
            area: 'Provider Analytics',
            case: 'Routing',
            size: `${size}`,
            ...providerBudget('Routing', size),
            iterations,
            run: () => buildProviderRoutingReadModel({
                responses: snapshot.responses,
                activeResponseId: snapshot.activeResponseId,
                now: 100_000 + size,
            }),
        });
        await recordBenchmark({
            area: 'Provider Analytics',
            case: 'Fallback',
            size: `${size}`,
            ...providerBudget('Fallback', size),
            iterations,
            run: () => buildProviderFallbackReadModel({
                responses: snapshot.responses,
                activeResponseId: snapshot.activeResponseId,
                now: 100_000 + size,
            }),
        });
        await recordBenchmark({
            area: 'Provider Analytics',
            case: 'Telemetry',
            size: `${size}`,
            ...providerBudget('Telemetry', size),
            iterations,
            run: () => buildProviderTelemetryReadModel({
                responses: snapshot.responses,
                activeResponseId: snapshot.activeResponseId,
                now: 100_000 + size,
            }),
        });
        await recordBenchmark({
            area: 'Provider Analytics',
            case: 'Diagnostics',
            size: `${size}`,
            ...providerBudget('Diagnostics', size),
            iterations,
            run: () => buildProviderDiagnosticsReadModel({
                health,
                responses: snapshot.responses,
                activeResponseId: snapshot.activeResponseId,
                now: 100_000 + size,
            }),
        });
        await recordBenchmark({
            area: 'Provider Analytics',
            case: 'Personalization',
            size: `${size}`,
            ...providerBudget('Personalization', size),
            iterations,
            run: () => buildProviderPersonalizationReadModel({
                responses: snapshot.responses,
                activeResponseId: snapshot.activeResponseId,
                now: 100_000 + size,
            }),
        });
    }
});

test('Sprint 9 Phase A measures diagram intelligence read-model budgets', async () => {
    for (const profile of DIAGRAM_PROFILES) {
        const chain = buildDiagramChain(profile);
        const timeline = buildDiagramTimeline(chain, 'diagram-response-3');
        const iterations = profile.label === 'Parser-cap' ? 7 : 12;
        validateDiagramTimeline(timeline, profile);

        await recordBenchmark({
            area: 'Diagram Intelligence',
            case: 'Timeline',
            size: profile.label,
            ...diagramBudget('Timeline', profile.label),
            iterations,
            run: () => buildDiagramTimeline(chain, 'diagram-response-3'),
        });
        await recordBenchmark({
            area: 'Diagram Intelligence',
            case: 'Evolution Summary',
            size: profile.label,
            ...diagramBudget('Evolution Summary', profile.label),
            iterations,
            run: () => {
                buildParentToCurrentEvolutionSummary(timeline, 'diagram-response-3');
                buildRootToCurrentEvolutionSummary(timeline, 'diagram-response-3');
            },
        });
        await recordBenchmark({
            area: 'Diagram Intelligence',
            case: 'Node Intelligence',
            size: profile.label,
            ...diagramBudget('Node Intelligence', profile.label),
            iterations,
            run: () => buildDiagramNodeIntelligence(timeline, {
                responseId: 'diagram-response-3',
                selectedNodeId: 'node-1-1',
            }),
        });
        await recordBenchmark({
            area: 'Diagram Intelligence',
            case: 'Comparison',
            size: profile.label,
            ...diagramBudget('Comparison', profile.label),
            iterations,
            run: () => {
                buildParentCurrentDiagramComparison(timeline, 'diagram-response-3');
                buildRootCurrentDiagramComparison(timeline, 'diagram-response-3');
                buildVersionPairDiagramComparison(timeline, 1, 3);
            },
        });
        await recordBenchmark({
            area: 'Diagram Intelligence',
            case: 'Guardrails',
            size: profile.label,
            ...diagramBudget('Guardrails', profile.label),
            iterations,
            run: () => buildDiagramGuardrails(timeline, 'diagram-response-3'),
        });
    }
});

test('Sprint 9 Phase A measures settings static analytics render budget', async () => {
    const snapshot = buildProviderSnapshot(30);
    const models = buildProviderModels(snapshot);
    const markup = renderSettingsAnalyticsSurfaces(snapshot, models);
    assert.equal(markup.length > 0, true);

    await recordBenchmark({
        area: 'Settings',
        case: 'Static analytics render',
        size: '30',
        budgetMs: 250,
        ceilingMs: 1500,
        iterations: 7,
        optimizationTarget: 'Avoid mounting heavy analytics tables behind closed disclosure sections.',
        run: () => renderSettingsAnalyticsSurfaces(snapshot, models),
    });
});

test('Sprint 9 Phase A measures snapshot relay budgets', async () => {
    for (const size of PROVIDER_SIZES) {
        const messages = buildProviderMessages(size);
        const snapshot = buildProviderAnalyticsSessionSnapshot(messages, `response-${size}`, 110_000 + size);
        const iterations = iterationsForSize(size);

        await recordBenchmark({
            area: 'Snapshot Relay',
            case: 'Generation',
            size: `${size}`,
            budgetMs: size >= 1000 ? 500 : size >= 500 ? 250 : size >= 100 ? 60 : 20,
            ceilingMs: size >= 1000 ? 4000 : size >= 500 ? 2000 : size >= 100 ? 600 : 250,
            iterations,
            optimizationTarget: 'Keep snapshot generation metadata-only and avoid including response content or artifacts.',
            run: () => buildProviderAnalyticsSessionSnapshot(messages, `response-${size}`, 110_000 + size),
        });

        await recordBenchmark({
            area: 'Snapshot Relay',
            case: 'Mock publish',
            size: `${size}`,
            budgetMs: size >= 1000 ? 200 : size >= 500 ? 100 : size >= 100 ? 30 : 10,
            ceilingMs: size >= 1000 ? 1500 : size >= 500 ? 800 : size >= 100 ? 250 : 100,
            iterations,
            optimizationTarget: 'Bound snapshot fanout and keep the main-process relay in-memory only.',
            run: () => {
                const relay = createMockSnapshotRelay();
                let observed = 0;
                relay.subscribe(() => { observed += 1; });
                relay.subscribe(() => { observed += 1; });
                relay.publish(snapshot);
                if (observed !== 2) throw new Error('Mock publish did not notify subscribers');
            },
        });

        await recordBenchmark({
            area: 'Snapshot Relay',
            case: 'Mock subscribe/update',
            size: `${size}`,
            budgetMs: size >= 1000 ? 200 : size >= 500 ? 100 : size >= 100 ? 30 : 10,
            ceilingMs: size >= 1000 ? 1500 : size >= 500 ? 800 : size >= 100 ? 250 : 100,
            iterations,
            optimizationTarget: 'Deduplicate unchanged snapshot state before updating analytics settings state.',
            run: () => {
                const relay = createMockSnapshotRelay();
                let observedKey = '';
                const unsubscribe = relay.subscribe((nextSnapshot) => {
                    observedKey = nextSnapshot ? buildProviderAnalyticsSessionSnapshotStateKey(nextSnapshot) : '';
                });
                relay.publish(snapshot);
                unsubscribe();
                if (!observedKey) throw new Error('Mock subscribe/update did not receive snapshot state');
            },
        });
    }
});
