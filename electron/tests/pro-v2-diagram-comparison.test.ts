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
        createdAt: 4000,
        status: 'parsed',
        payload: {
            diagram: options.diagram,
            fallbackDiagram: null,
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

function statusById(comparison: ReturnType<typeof buildParentCurrentDiagramComparison>): Record<string, string> {
    return Object.fromEntries(comparison.nodes.map((node) => [node.id, node.status]));
}

function edgeStatusByKey(comparison: ReturnType<typeof buildParentCurrentDiagramComparison>): Record<string, string> {
    return Object.fromEntries(comparison.edges.map((edge) => [edge.key, edge.status]));
}

test('Sprint 6 comparison projects parent/current comparison from stored artifact diff', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-2');
    const comparison = buildParentCurrentDiagramComparison(timeline);

    assert.equal(comparison.mode, 'parent_current');
    assert.equal(comparison.available, true);
    assert.equal(comparison.diffSource, 'stored_artifact_diff');
    assert.equal(comparison.usedStoredDiff, true);
    assert.equal(comparison.recomputed, false);
    assert.equal(comparison.from?.responseId, 'response-1');
    assert.equal(comparison.to?.responseId, 'response-2');
    assert.deepEqual(statusById(comparison), {
        user: 'unchanged',
        app: 'modified',
        redis: 'added',
    });
    assert.deepEqual(comparison.nodes.find((node) => node.id === 'app')?.changedFields, ['purpose']);
    assert.deepEqual(edgeStatusByKey(comparison), {
        'user->app': 'unchanged',
        'app->redis': 'added',
    });
    assert.deepEqual(comparison.nodeCounts, {
        added: 1,
        removed: 0,
        modified: 1,
        unchanged: 1,
        total: 3,
    });
});

test('Sprint 6 comparison projects root/current comparison with lazy computed diff', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-3');
    const comparison = buildRootCurrentDiagramComparison(timeline);

    assert.equal(comparison.mode, 'root_current');
    assert.equal(comparison.available, true);
    assert.equal(comparison.diffSource, 'computed');
    assert.equal(comparison.recomputed, true);
    assert.equal(comparison.from?.version, 1);
    assert.equal(comparison.to?.version, 3);
    assert.deepEqual(statusById(comparison), {
        user: 'unchanged',
        app: 'modified',
        redis: 'added',
        kafka: 'added',
    });
    assert.deepEqual(edgeStatusByKey(comparison), {
        'user->app': 'unchanged',
        'app->redis': 'added',
        'app->kafka': 'added',
    });
});

test('Sprint 6 comparison projects arbitrary retained version comparison', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-3');
    const comparison = buildVersionPairDiagramComparison(timeline, 2, 3);

    assert.equal(comparison.mode, 'version_pair');
    assert.equal(comparison.available, true);
    assert.equal(comparison.diffSource, 'computed');
    assert.equal(comparison.from?.responseId, 'response-2');
    assert.equal(comparison.to?.responseId, 'response-3');
    assert.deepEqual(statusById(comparison), {
        user: 'unchanged',
        app: 'unchanged',
        redis: 'unchanged',
        kafka: 'added',
    });
    assert.deepEqual(edgeStatusByKey(comparison), {
        'user->app': 'unchanged',
        'app->redis': 'unchanged',
        'app->kafka': 'added',
    });
});

test('Sprint 6 comparison reports unavailable arbitrary versions without creating fallback state', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-3');
    const comparison = buildVersionPairDiagramComparison(timeline, 99, 100);

    assert.equal(comparison.available, false);
    assert.equal(comparison.diffSource, 'unavailable');
    assert.deepEqual(comparison.issues, ['from_version_missing', 'to_version_missing']);
    assert.deepEqual(comparison.nodes, []);
    assert.deepEqual(comparison.edges, []);
    assert.deepEqual(comparison.nodeCounts, {
        added: 0,
        removed: 0,
        modified: 0,
        unchanged: 0,
        total: 0,
    });
});

test('Sprint 6 Phase D helper remains a read model without persistence or history wiring', () => {
    const helper = read('src/components/pro-v2/architecture/diagramComparison.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');

    assert.match(helper, /buildParentToCurrentEvolutionSummary/);
    assert.match(helper, /compareDiagramTimelineVersions/);
    assert.doesNotMatch(helper, /from 'react'|from "react"/);
    assert.doesNotMatch(helper, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(bridge, /buildParentCurrentDiagramComparison|diagramComparison/);
    assert.doesNotMatch(history, /diagramComparison|DiagramComparison/);
});
