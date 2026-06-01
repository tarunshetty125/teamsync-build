import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildDiagramTimeline,
    type DiagramTimelineMessage,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import {
    buildDiagramNodeIntelligence,
} from '../../src/components/pro-v2/architecture/diagramNodeIntelligence.ts';
import type { ArchitectureDiagram, ArchitectureNodeModel } from '../../src/components/pro-v2/architecture/architectureSchema.ts';
import type { ArchitectureDiagramDiff } from '../../src/components/pro-v2/architecture/architectureDiff.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const userNode: ArchitectureNodeModel = {
    id: 'user',
    label: 'User',
    kind: 'client',
    technology: 'Mobile/Web',
    purpose: 'Initiates requests',
    layer: 'client',
    latency: '50ms',
    failureMode: 'Client connectivity issues',
};

const gatewayNode: ArchitectureNodeModel = {
    id: 'gateway',
    label: 'API Gateway',
    kind: 'gateway',
    technology: 'ALB',
    purpose: 'Routes requests',
    layer: 'edge',
    latency: '15ms',
    failureMode: 'Ingress saturation',
};

const appNode: ArchitectureNodeModel = {
    id: 'app',
    label: 'Application Service',
    kind: 'service',
    technology: 'Node.js',
    purpose: 'Handles business logic',
    layer: 'compute',
    latency: '80ms',
    failureMode: 'Thread pool exhaustion',
};

const redisNode: ArchitectureNodeModel = {
    id: 'redis',
    label: 'Redis Cache',
    kind: 'cache',
    technology: 'Redis',
    purpose: 'Caches hot reads',
    layer: 'data',
    latency: '5ms',
    failureMode: 'Cache eviction storm',
};

function diagram(nodes: ArchitectureNodeModel[] = [userNode, gatewayNode, appNode, redisNode]): ArchitectureDiagram {
    return {
        type: 'architecture',
        direction: 'TB',
        nodes,
        edges: [
            { source: 'user', target: 'gateway', label: 'HTTPS', protocol: 'HTTPS', latency: '50ms' },
            { source: 'gateway', target: 'app', label: 'HTTP', protocol: 'HTTP', latency: '15ms' },
            { source: 'app', target: 'redis', label: 'cache write', protocol: 'RESP', latency: '5ms' },
            { source: 'redis', target: 'app', label: 'cache read', protocol: 'RESP', latency: '5ms' },
        ].filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target)),
    };
}

function diff(): ArchitectureDiagramDiff {
    return {
        addedNodes: [{ id: 'redis', after: redisNode }],
        removedNodes: [{
            id: 'legacy',
            before: {
                id: 'legacy',
                label: 'Legacy Cache',
                kind: 'cache',
            },
        }],
        modifiedNodes: [{
            id: 'app',
            before: {
                ...appNode,
                purpose: 'Handles API requests',
                latency: '120ms',
            },
            after: appNode,
            changedFields: ['purpose', 'latency'],
        }],
        addedEdges: [{ key: 'app->redis', after: { source: 'app', target: 'redis' } }],
        removedEdges: [{ key: 'app->legacy', before: { source: 'app', target: 'legacy' } }],
    };
}

function architectureArtifact(
    responseId: string,
    options: {
        parentResponseId?: string;
        rootResponseId?: string;
        diagram?: ArchitectureDiagram | null;
        diff?: ArchitectureDiagramDiff;
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
        status: options.diagram === null ? 'parse_error' : 'parsed',
        payload: {
            diagram: options.diagram === undefined ? diagram() : options.diagram,
            fallbackDiagram: null,
            ...(options.diff ? { diff: options.diff } : {}),
        },
    };
}

function buildChain(currentDiff: ArchitectureDiagramDiff | null = diff()): DiagramTimelineMessage[] {
    return [
        {
            id: 'response-1',
            rootResponseId: 'response-1',
            artifacts: [
                architectureArtifact('response-1', {
                    rootResponseId: 'response-1',
                    diagram: diagram([userNode, gatewayNode, appNode]),
                }),
            ],
        },
        {
            id: 'response-2',
            rootResponseId: 'response-1',
            ownership: { parentResponseId: 'response-1' },
            artifacts: [
                architectureArtifact('response-2', {
                    parentResponseId: 'response-1',
                    rootResponseId: 'response-1',
                    diagram: diagram(),
                    ...(currentDiff ? { diff: currentDiff } : {}),
                }),
            ],
        },
    ];
}

test('Sprint 6 node intelligence projects existing node metadata and ownership context', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-2');
    const model = buildDiagramNodeIntelligence(timeline, {
        selectedNodeId: 'app',
    });
    const app = model.selectedNode;

    assert.equal(model.nodeCount, 4);
    assert.equal(model.edgeCount, 4);
    assert.equal(app?.id, 'app');
    assert.equal(app?.label, 'Application Service');
    assert.equal(app?.kind, 'service');
    assert.equal(app?.technology, 'Node.js');
    assert.equal(app?.purpose, 'Handles business logic');
    assert.equal(app?.layer, 'compute');
    assert.equal(app?.latency, '80ms');
    assert.equal(app?.failureMode, 'Thread pool exhaustion');
    assert.deepEqual(model.responseOwnership, {
        responseId: 'response-2',
        version: 2,
        rootResponseId: 'response-1',
        rootVersion: 1,
        parentResponseId: 'response-1',
        parentVersion: 1,
    });
    assert.deepEqual(model.artifactOwnership, {
        artifactId: 'response-2:architecture',
        responseId: 'response-2',
        rootResponseId: 'response-1',
        parentResponseId: 'response-1',
        status: 'parsed',
        source: 'architecture_json',
        createdAt: 2000,
    });
    assert.equal(app?.responseOwnership.responseId, 'response-2');
    assert.equal(app?.artifactOwnership.artifactId, 'response-2:architecture');
});

test('Sprint 6 node intelligence derives incoming and outgoing dependencies from diagram edges', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-2');
    const model = buildDiagramNodeIntelligence(timeline);
    const app = model.byNodeId.get('app');
    const gateway = model.byNodeId.get('gateway');

    assert.deepEqual(app?.incomingDependencies.map((dependency) => dependency.nodeId), ['gateway', 'redis']);
    assert.deepEqual(app?.incomingDependencies.map((dependency) => dependency.edgeKey), ['gateway->app', 'redis->app']);
    assert.deepEqual(app?.outgoingDependencies.map((dependency) => dependency.nodeId), ['redis']);
    assert.deepEqual(app?.dependencyCounts, {
        incoming: 2,
        outgoing: 1,
        total: 3,
    });
    assert.deepEqual(gateway?.incomingDependencies.map((dependency) => dependency.nodeId), ['user']);
    assert.deepEqual(gateway?.outgoingDependencies.map((dependency) => dependency.nodeId), ['app']);
});

test('Sprint 6 node intelligence projects diff participation from stored artifact diff', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-2');
    const model = buildDiagramNodeIntelligence(timeline);

    assert.deepEqual(model.diffContext, {
        hasDiff: true,
        addedNodeIds: ['redis'],
        removedNodeIds: ['legacy'],
        modifiedNodeIds: ['app'],
    });
    assert.deepEqual(model.byNodeId.get('redis')?.diffParticipation, {
        status: 'added',
        changedFields: [],
    });
    assert.deepEqual(model.byNodeId.get('app')?.diffParticipation, {
        status: 'modified',
        changedFields: ['purpose', 'latency'],
    });
    assert.deepEqual(model.byNodeId.get('user')?.diffParticipation, {
        status: 'unchanged',
        changedFields: [],
    });
});

test('Sprint 6 node intelligence marks participation unavailable when no stored diff exists', () => {
    const timeline = buildDiagramTimeline(buildChain(null), 'response-2');
    const model = buildDiagramNodeIntelligence(timeline);

    assert.deepEqual(model.diffContext, {
        hasDiff: false,
        addedNodeIds: [],
        removedNodeIds: [],
        modifiedNodeIds: [],
    });
    assert.equal(model.byNodeId.get('app')?.diffParticipation.status, 'unavailable');
    assert.equal(model.byNodeId.get('redis')?.diffParticipation.status, 'unavailable');
});

test('Sprint 6 node intelligence reports missing selected nodes without falling back to another node', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-2');
    const model = buildDiagramNodeIntelligence(timeline, {
        selectedNodeId: 'missing-node',
    });

    assert.equal(model.selectedNode, null);
    assert.deepEqual(model.issues, ['selected_node_missing']);
});

test('Sprint 6 Phase C remains a read model without UI, persistence, or history wiring', () => {
    const helper = read('src/components/pro-v2/architecture/diagramNodeIntelligence.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');

    assert.doesNotMatch(helper, /from 'react'|from "react"/);
    assert.doesNotMatch(helper, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(bridge, /buildDiagramNodeIntelligence|diagramNodeIntelligence/);
    assert.doesNotMatch(history, /diagramNodeIntelligence|NodeIntelligence/);
});
