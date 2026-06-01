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
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const userNode: ArchitectureNodeModel = {
    id: 'user',
    label: 'User',
    kind: 'client',
};

const appNode: ArchitectureNodeModel = {
    id: 'app',
    label: 'Application Service',
    kind: 'service',
    technology: 'Node.js',
    purpose: 'Handles business logic',
    layer: 'compute',
    latency: '80ms',
    failureMode: 'Worker saturation',
};

const redisNode: ArchitectureNodeModel = {
    id: 'redis',
    label: 'Redis Cache',
    kind: 'cache',
    technology: 'Redis',
    purpose: 'Caches hot reads',
};

function diagram(): ArchitectureDiagram {
    return {
        type: 'architecture',
        direction: 'TB',
        nodes: [userNode, appNode, redisNode],
        edges: [
            { source: 'user', target: 'app', label: 'request' },
            { source: 'app', target: 'redis', label: 'write' },
            { source: 'redis', target: 'app', label: 'read' },
        ],
    };
}

function architectureArtifact(responseId: string): V2ResponseArtifact {
    return {
        id: `${responseId}:architecture`,
        responseId,
        rootResponseId: responseId,
        kind: 'architecture',
        source: 'architecture_json',
        createdAt: 9000,
        status: 'parsed',
        payload: {
            diagram: diagram(),
            fallbackDiagram: null,
            issues: [],
            diff: {
                addedNodes: [{ id: 'redis', after: redisNode }],
                removedNodes: [],
                modifiedNodes: [{ id: 'app', changedFields: ['latency'] }],
                addedEdges: [{ key: 'app->redis' }],
                removedEdges: [],
            },
        },
    };
}

test('Sprint 6 UI-B wires node click handling through presentation props only', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const renderer = read('src/components/pro-v2/architecture/ArchitectureRenderer.tsx');
    const canvas = read('src/components/pro-v2/architecture/ArchitectureCanvas.tsx');
    const node = read('src/components/pro-v2/architecture/ArchitectureNode.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(renderer, /selectedNodeId\?: string \| null/);
    assert.match(renderer, /onNodeSelect\?: \(nodeId: string\) => void/);
    assert.match(renderer, /selectedNodeId=\{selectedNodeId\}/);
    assert.match(renderer, /onNodeSelect=\{onNodeSelect\}/);
    assert.match(canvas, /selectedNodeId\?: string \| null/);
    assert.match(canvas, /onNodeSelect\?: \(nodeId: string\) => void/);
    assert.match(canvas, /selected: node\.id === selectedNodeId/);
    assert.match(canvas, /onNodeClick=\{handleNodeClick\}/);
    assert.match(canvas, /onNodeSelect\?\.\(node\.id\)/);
    assert.match(node, /v2-architecture-node--selected/);
    assert.match(surface, /selectedNodeId=\{selectedDiagramNodeId\}/);
    assert.match(surface, /onNodeSelect=\{setSelectedDiagramNodeId\}/);
    assert.match(css, /\.v2-architecture-node--selected/);
});

test('Sprint 6 UI-B drawer is powered by diagramNodeIntelligence read model', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(surface, /buildDiagramNodeIntelligence\(diagramTimeline, \{/);
    assert.match(surface, /selectedNodeId: selectedDiagramNodeId/);
    assert.match(surface, /const selectedDiagramNode = diagramNodeIntelligence\.selectedNode/);
    assert.match(surface, /<DiagramNodeIntelligenceDrawer/);
    assert.match(surface, /aria-label="Node intelligence"/);
    assert.match(surface, /incomingDependencies/);
    assert.match(surface, /outgoingDependencies/);
    assert.match(surface, /dependencyCounts/);
    assert.match(surface, /responseOwnership/);
    assert.match(surface, /artifactOwnership/);
    assert.match(surface, /diffParticipation/);
    assert.match(css, /\.v2-diagram-node-drawer/);
    assert.match(css, /\.v2-diagram-node-drawer-field/);
    assert.match(css, /\.v2-diagram-node-drawer-dep-list/);
});

test('Sprint 6 UI-B node intelligence runtime projection remains read-only and metadata-bound', () => {
    const chain: DiagramTimelineMessage[] = [
        {
            id: 'response-1',
            rootResponseId: 'response-1',
            artifacts: [architectureArtifact('response-1')],
        },
    ];
    const timeline = buildDiagramTimeline(chain, 'response-1');
    const model = buildDiagramNodeIntelligence(timeline, {
        responseId: 'response-1',
        selectedNodeId: 'app',
    });

    assert.equal(model.selectedNode?.id, 'app');
    assert.equal(model.selectedNode?.technology, 'Node.js');
    assert.equal(model.selectedNode?.purpose, 'Handles business logic');
    assert.equal(model.selectedNode?.layer, 'compute');
    assert.equal(model.selectedNode?.latency, '80ms');
    assert.equal(model.selectedNode?.failureMode, 'Worker saturation');
    assert.deepEqual(model.selectedNode?.incomingDependencies.map((dependency) => dependency.nodeId), ['user', 'redis']);
    assert.deepEqual(model.selectedNode?.outgoingDependencies.map((dependency) => dependency.nodeId), ['redis']);
    assert.deepEqual(model.selectedNode?.dependencyCounts, {
        incoming: 2,
        outgoing: 1,
        total: 3,
    });
    assert.deepEqual(model.selectedNode?.diffParticipation, {
        status: 'modified',
        changedFields: ['latency'],
    });
});

test('Sprint 6 UI-B does not expand schema, persistence, or history wiring', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const schema = read('src/components/pro-v2/architecture/architectureSchema.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');

    assert.doesNotMatch(schema, /dependencies|scalingNotes|ownershipFields/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(bridge, /selectedDiagramNodeId|buildDiagramNodeIntelligence/);
    assert.doesNotMatch(history, /selectedDiagramNodeId|buildDiagramNodeIntelligence/);
});
