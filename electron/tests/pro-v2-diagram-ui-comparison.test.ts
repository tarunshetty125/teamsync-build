import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildDiagramTimeline,
    type DiagramTimelineMessage,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import {
    buildParentCurrentDiagramComparison,
    buildRootCurrentDiagramComparison,
    buildVersionPairDiagramComparison,
} from '../../src/components/pro-v2/architecture/diagramComparison.ts';
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
};

const baseAppNode: ArchitectureNodeModel = {
    id: 'app',
    label: 'App Server',
    kind: 'service',
    purpose: 'Handles API requests',
};

const evolvedAppNode: ArchitectureNodeModel = {
    ...baseAppNode,
    purpose: 'Handles business logic',
};

const redisNode: ArchitectureNodeModel = {
    id: 'redis',
    label: 'Redis Cache',
    kind: 'cache',
};

const kafkaNode: ArchitectureNodeModel = {
    id: 'kafka',
    label: 'Kafka Queue',
    kind: 'queue',
};

function diagram(nodes: ArchitectureNodeModel[], edgePairs: Array<[string, string]>): ArchitectureDiagram {
    return {
        type: 'architecture',
        direction: 'TB',
        nodes,
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
        diff?: ArchitectureDiagramDiff;
    },
): V2ResponseArtifact {
    return {
        id: `${responseId}:architecture`,
        responseId,
        parentResponseId: options.parentResponseId,
        rootResponseId: options.rootResponseId ?? responseId,
        kind: 'architecture',
        source: 'architecture_json',
        createdAt: 5000,
        status: 'parsed',
        payload: {
            diagram: options.diagram,
            fallbackDiagram: null,
            issues: [],
            ...(options.diff ? { diff: options.diff } : {}),
        },
    };
}

function storedDiffForResponse2(): ArchitectureDiagramDiff {
    return {
        addedNodes: [{ id: 'redis', after: redisNode }],
        removedNodes: [],
        modifiedNodes: [{
            id: 'app',
            before: baseAppNode,
            after: evolvedAppNode,
            changedFields: ['purpose'],
        }],
        addedEdges: [{ key: 'app->redis', after: { source: 'app', target: 'redis' } }],
        removedEdges: [],
    };
}

function buildChain(): DiagramTimelineMessage[] {
    const rootDiagram = diagram([userNode, baseAppNode], [['user', 'app']]);
    const redisDiagram = diagram([userNode, evolvedAppNode, redisNode], [['user', 'app'], ['app', 'redis']]);
    const kafkaDiagram = diagram(
        [userNode, evolvedAppNode, redisNode, kafkaNode],
        [['user', 'app'], ['app', 'redis'], ['app', 'kafka']],
    );

    return [
        {
            id: 'response-1',
            rootResponseId: 'response-1',
            artifacts: [
                architectureArtifact('response-1', {
                    rootResponseId: 'response-1',
                    diagram: rootDiagram,
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
                    diagram: redisDiagram,
                    diff: storedDiffForResponse2(),
                }),
            ],
        },
        {
            id: 'response-3',
            rootResponseId: 'response-1',
            ownership: { parentResponseId: 'response-2' },
            artifacts: [
                architectureArtifact('response-3', {
                    parentResponseId: 'response-2',
                    rootResponseId: 'response-1',
                    diagram: kafkaDiagram,
                }),
            ],
        },
    ];
}

test('Sprint 6 UI-E wires compact comparison view to approved comparison read models', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(surface, /buildParentCurrentDiagramComparison/);
    assert.match(surface, /buildRootCurrentDiagramComparison/);
    assert.match(surface, /buildVersionPairDiagramComparison/);
    assert.match(surface, /const \[diagramComparisonMode, setDiagramComparisonMode\] = useState<DiagramComparisonMode>/);
    assert.match(surface, /const \[comparisonFromVersion, setComparisonFromVersion\] = useState\(1\)/);
    assert.match(surface, /const \[comparisonToVersion, setComparisonToVersion\] = useState\(1\)/);
    assert.match(surface, /<DiagramComparisonPanel/);
    assert.match(surface, /aria-label="Diagram comparison view"/);
    assert.match(surface, /Parent ↔ Current/);
    assert.match(surface, /Root ↔ Current/);
    assert.match(surface, /Version Pair/);
    assert.match(surface, /Added Nodes/);
    assert.match(surface, /Removed Nodes/);
    assert.match(surface, /Modified Nodes/);
    assert.match(surface, /Added Edges/);
    assert.match(surface, /Removed Edges/);
    assert.match(css, /\.v2-diagram-comparison-panel/);
    assert.match(css, /\.v2-diagram-comparison-mode--active/);
    assert.match(css, /\.v2-diagram-comparison-row--active/);
});

test('Sprint 6 UI-E parent/current view displays stored diff counts and statuses', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-2');
    const comparison = buildParentCurrentDiagramComparison(timeline, 'response-2');

    assert.equal(comparison.mode, 'parent_current');
    assert.equal(comparison.available, true);
    assert.equal(comparison.diffSource, 'stored_artifact_diff');
    assert.equal(comparison.nodeCounts.added, 1);
    assert.equal(comparison.nodeCounts.modified, 1);
    assert.equal(comparison.edgeCounts.added, 1);
    assert.deepEqual(comparison.nodes.map((node) => [node.label, node.status]), [
        ['User', 'unchanged'],
        ['App Server', 'modified'],
        ['Redis Cache', 'added'],
    ]);
});

test('Sprint 6 UI-E root/current view and version-pair view use lazy comparison projection', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-3');
    const rootComparison = buildRootCurrentDiagramComparison(timeline, 'response-3');
    const pairComparison = buildVersionPairDiagramComparison(timeline, 2, 3);

    assert.equal(rootComparison.mode, 'root_current');
    assert.equal(rootComparison.recomputed, true);
    assert.equal(rootComparison.nodeCounts.added, 2);
    assert.equal(rootComparison.edgeCounts.added, 2);
    assert.deepEqual(rootComparison.nodes.filter((node) => node.status === 'added').map((node) => node.label), [
        'Redis Cache',
        'Kafka Queue',
    ]);

    assert.equal(pairComparison.mode, 'version_pair');
    assert.equal(pairComparison.recomputed, true);
    assert.equal(pairComparison.nodeCounts.added, 1);
    assert.equal(pairComparison.edgeCounts.added, 1);
    assert.deepEqual(pairComparison.nodes.filter((node) => node.status === 'added').map((node) => node.label), [
        'Kafka Queue',
    ]);
});

test('Sprint 6 UI-E remains local UI only without persistence, renderer wiring, or extra canvas work', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const renderer = read('src/components/pro-v2/architecture/ArchitectureRenderer.tsx');
    const canvas = read('src/components/pro-v2/architecture/ArchitectureCanvas.tsx');
    const schema = read('src/components/pro-v2/architecture/architectureSchema.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');

    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(surface, /ReactFlow|diff overlay|visual diff|overlay diff/i);
    assert.doesNotMatch(renderer, /DiagramComparison|buildParentCurrentDiagramComparison/);
    assert.doesNotMatch(canvas, /DiagramComparison|buildParentCurrentDiagramComparison/);
    assert.doesNotMatch(schema, /comparisonStatus|comparisonMode|DiagramComparison/);
    assert.doesNotMatch(bridge, /DiagramComparison|buildParentCurrentDiagramComparison|comparisonMode/);
    assert.doesNotMatch(history, /DiagramComparison|buildParentCurrentDiagramComparison|comparisonMode/);
});
