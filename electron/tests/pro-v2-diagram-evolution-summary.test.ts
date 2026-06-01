import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildDiagramTimeline,
    type DiagramTimelineMessage,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import {
    buildParentToCurrentEvolutionSummary,
    buildRootToCurrentEvolutionSummary,
    compareDiagramTimelineVersions,
} from '../../src/components/pro-v2/architecture/diagramEvolutionSummary.ts';
import type { ArchitectureDiagram } from '../../src/components/pro-v2/architecture/architectureSchema.ts';
import type { ArchitectureDiagramDiff } from '../../src/components/pro-v2/architecture/architectureDiff.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function diagram(nodeIds: string[], edgePairs: Array<[string, string]> = []): ArchitectureDiagram {
    return {
        type: 'architecture',
        direction: 'TB',
        nodes: nodeIds.map((id) => ({
            id,
            label: id.toUpperCase(),
            kind: id.includes('redis') ? 'cache' : id.includes('kafka') ? 'queue' : 'service',
            technology: id,
            purpose: `${id} purpose`,
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
        diagram?: ArchitectureDiagram | null;
        fallbackDiagram?: ArchitectureDiagram | null;
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
        createdAt: 1000,
        status: options.diagram === null ? 'fallback' : 'parsed',
        payload: {
            diagram: options.diagram === undefined ? diagram(['user', 'app'], [['user', 'app']]) : options.diagram,
            fallbackDiagram: options.fallbackDiagram ?? null,
            ...(options.diff ? {
                diff: {
                    addedNodes: options.diff.addedNodes ?? [],
                    removedNodes: options.diff.removedNodes ?? [],
                    modifiedNodes: options.diff.modifiedNodes ?? [],
                    addedEdges: options.diff.addedEdges ?? [],
                    removedEdges: options.diff.removedEdges ?? [],
                },
            } : {}),
        },
    };
}

function buildChain(): DiagramTimelineMessage[] {
    return [
        {
            id: 'response-1',
            rootResponseId: 'response-1',
            artifacts: [
                architectureArtifact('response-1', {
                    rootResponseId: 'response-1',
                    diagram: diagram(['user', 'app'], [['user', 'app']]),
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
                    diagram: diagram(['user', 'app', 'redis'], [['user', 'app'], ['app', 'redis']]),
                    diff: {
                        addedNodes: [{ id: 'redis' }],
                        addedEdges: [{ key: 'app->redis' }],
                    },
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
                    diagram: diagram(['user', 'app', 'redis', 'kafka'], [['user', 'app'], ['app', 'redis'], ['app', 'kafka']]),
                }),
            ],
        },
    ];
}

test('Sprint 6 evolution summary uses stored artifact diff for parent to current when available', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-2');
    const summary = buildParentToCurrentEvolutionSummary(timeline);

    assert.equal(summary.mode, 'parent_current');
    assert.equal(summary.diffSource, 'stored_artifact_diff');
    assert.equal(summary.usedStoredDiff, true);
    assert.equal(summary.recomputed, false);
    assert.equal(summary.from?.responseId, 'response-1');
    assert.equal(summary.to?.responseId, 'response-2');
    assert.equal(summary.diffSummary.totalChanges, 2);
    assert.deepEqual(summary.changes.addedNodeIds, ['redis']);
    assert.deepEqual(summary.changes.addedEdgeKeys, ['app->redis']);
});

test('Sprint 6 evolution summary recomputes parent to current only when stored diff is missing', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-3');
    const summary = buildParentToCurrentEvolutionSummary(timeline);

    assert.equal(summary.diffSource, 'computed');
    assert.equal(summary.usedStoredDiff, false);
    assert.equal(summary.recomputed, true);
    assert.equal(summary.from?.version, 2);
    assert.equal(summary.to?.version, 3);
    assert.deepEqual(summary.changes.addedNodeIds, ['kafka']);
    assert.deepEqual(summary.changes.addedEdgeKeys, ['app->kafka']);
});

test('Sprint 6 evolution summary supports root to current comparison with lazy computed diff', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-3');
    const summary = buildRootToCurrentEvolutionSummary(timeline);

    assert.equal(summary.mode, 'root_current');
    assert.equal(summary.diffSource, 'computed');
    assert.equal(summary.recomputed, true);
    assert.equal(summary.from?.version, 1);
    assert.equal(summary.to?.version, 3);
    assert.deepEqual(summary.changes.addedNodeIds, ['redis', 'kafka']);
    assert.deepEqual(summary.changes.addedEdgeKeys, ['app->redis', 'app->kafka']);
});

test('Sprint 6 evolution summary compares arbitrary retained versions', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-3');
    const summary = compareDiagramTimelineVersions(timeline, 2, 3);

    assert.equal(summary.mode, 'version_pair');
    assert.equal(summary.diffSource, 'computed');
    assert.equal(summary.from?.responseId, 'response-2');
    assert.equal(summary.to?.responseId, 'response-3');
    assert.deepEqual(summary.changes.addedNodeIds, ['kafka']);
    assert.deepEqual(summary.changes.addedEdgeKeys, ['app->kafka']);
});

test('Sprint 6 evolution summary reports unavailable comparisons without mutating artifacts', () => {
    const currentArtifact = architectureArtifact('response-2', {
        parentResponseId: 'response-1',
        rootResponseId: 'response-1',
        diagram: null,
        fallbackDiagram: null,
    });
    const chain: DiagramTimelineMessage[] = [
        {
            id: 'response-1',
            rootResponseId: 'response-1',
            artifacts: [architectureArtifact('response-1', { rootResponseId: 'response-1' })],
        },
        {
            id: 'response-2',
            rootResponseId: 'response-1',
            ownership: { parentResponseId: 'response-1' },
            artifacts: [currentArtifact],
        },
    ];
    const timeline = buildDiagramTimeline(chain, 'response-2');
    const summary = buildParentToCurrentEvolutionSummary(timeline);

    assert.equal(summary.diffSource, 'unavailable');
    assert.deepEqual(summary.issues, ['comparison_diagram_missing']);
    assert.equal(summary.diffSummary.totalChanges, 0);
    assert.equal(chain[1].artifacts?.[0], currentArtifact);
});

test('Sprint 6 Phase B remains a read model without UI, persistence, or history wiring', () => {
    const helper = read('src/components/pro-v2/architecture/diagramEvolutionSummary.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');

    assert.match(helper, /diffArchitectureDiagrams/);
    assert.doesNotMatch(helper, /from 'react'|from "react"/);
    assert.doesNotMatch(helper, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(bridge, /buildParentToCurrentEvolutionSummary|compareDiagramTimelineVersions/);
    assert.doesNotMatch(history, /diagramEvolutionSummary|EvolutionSummary/);
});
