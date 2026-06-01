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
} from '../../src/components/pro-v2/architecture/diagramEvolutionSummary.ts';
import type { ArchitectureDiagram } from '../../src/components/pro-v2/architecture/architectureSchema.ts';
import type { ArchitectureDiagramDiff } from '../../src/components/pro-v2/architecture/architectureDiff.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function diagram(nodeIds: string[], edgePairs: Array<[string, string]>): ArchitectureDiagram {
    return {
        type: 'architecture',
        direction: 'TB',
        nodes: nodeIds.map((id) => ({
            id,
            label: id,
            kind: id.includes('redis') ? 'cache' : id.includes('kafka') ? 'queue' : 'service',
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
        createdAt: 1000,
        status: 'parsed',
        payload: {
            diagram: options.diagram,
            fallbackDiagram: null,
            issues: [],
            ...(options.diff ? { diff: options.diff } : {}),
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
                        removedNodes: [],
                        modifiedNodes: [{ id: 'app', changedFields: ['purpose'] }],
                        addedEdges: [{ key: 'app->redis' }],
                        removedEdges: [],
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

test('Sprint 6 UI-C renders compact evolution summary from parent and root read models', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(surface, /buildParentToCurrentEvolutionSummary/);
    assert.match(surface, /buildRootToCurrentEvolutionSummary/);
    assert.match(surface, /const parentEvolutionSummary = useMemo/);
    assert.match(surface, /const rootEvolutionSummary = useMemo/);
    assert.match(surface, /<DiagramEvolutionSummaryPanel/);
    assert.match(surface, /aria-label="Diagram evolution summary"/);
    assert.match(surface, /addedNodes/);
    assert.match(surface, /removedNodes/);
    assert.match(surface, /modifiedNodes/);
    assert.match(surface, /addedEdges/);
    assert.match(surface, /removedEdges/);
    assert.match(css, /\.v2-diagram-evolution-panel/);
    assert.match(css, /\.v2-diagram-evolution-metric/);
});

test('Sprint 6 UI-C parent/current summary displays stored artifact diff counts', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-2');
    const summary = buildParentToCurrentEvolutionSummary(timeline, 'response-2');

    assert.equal(summary.diffSource, 'stored_artifact_diff');
    assert.equal(summary.recomputed, false);
    assert.deepEqual(summary.diffSummary, {
        addedNodes: 1,
        removedNodes: 0,
        modifiedNodes: 1,
        addedEdges: 1,
        removedEdges: 0,
        totalChanges: 3,
        hasChanges: true,
    });
});

test('Sprint 6 UI-C root/current summary displays lazy computed diff counts', () => {
    const timeline = buildDiagramTimeline(buildChain(), 'response-3');
    const summary = buildRootToCurrentEvolutionSummary(timeline, 'response-3');

    assert.equal(summary.diffSource, 'computed');
    assert.equal(summary.recomputed, true);
    assert.deepEqual(summary.diffSummary, {
        addedNodes: 2,
        removedNodes: 0,
        modifiedNodes: 0,
        addedEdges: 2,
        removedEdges: 0,
        totalChanges: 4,
        hasChanges: true,
    });
});

test('Sprint 6 UI-C does not add renderer, schema, persistence, or history changes', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const renderer = read('src/components/pro-v2/architecture/ArchitectureRenderer.tsx');
    const canvas = read('src/components/pro-v2/architecture/ArchitectureCanvas.tsx');
    const schema = read('src/components/pro-v2/architecture/architectureSchema.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');

    assert.doesNotMatch(renderer, /EvolutionSummary|buildParentToCurrentEvolutionSummary/);
    assert.doesNotMatch(canvas, /EvolutionSummary|buildParentToCurrentEvolutionSummary/);
    assert.doesNotMatch(schema, /evolution|comparisonStatus/);
    assert.doesNotMatch(surface, /visual diff|diff overlay|overlay diff/i);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(bridge, /buildParentToCurrentEvolutionSummary|buildRootToCurrentEvolutionSummary/);
    assert.doesNotMatch(history, /buildParentToCurrentEvolutionSummary|EvolutionSummary/);
});
