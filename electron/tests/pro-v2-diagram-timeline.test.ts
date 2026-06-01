import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildDiagramTimeline,
    summarizeArchitectureDiff,
    type DiagramTimelineMessage,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import type { ArchitectureDiagramDiff } from '../../src/components/pro-v2/architecture/architectureDiff.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function architectureArtifact(
    responseId: string,
    options: {
        parentResponseId?: string;
        rootResponseId?: string;
        createdAt?: number;
        status?: V2ResponseArtifact['status'];
        source?: V2ResponseArtifact['source'];
        diff?: Partial<ArchitectureDiagramDiff>;
    } = {},
): V2ResponseArtifact {
    return {
        id: `${responseId}:architecture`,
        responseId,
        parentResponseId: options.parentResponseId,
        rootResponseId: options.rootResponseId ?? responseId,
        kind: 'architecture',
        source: options.source ?? 'architecture_json',
        createdAt: options.createdAt ?? 1000,
        status: options.status ?? 'parsed',
        payload: {
            diagram: {
                type: 'architecture',
                direction: 'TB',
                nodes: [],
                edges: [],
            },
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

test('Sprint 6 diagram timeline derives versions from active response chain architecture artifacts', () => {
    const firstArtifact = architectureArtifact('response-1', {
        rootResponseId: 'response-1',
        createdAt: 1001,
    });
    const secondArtifact = architectureArtifact('response-3', {
        parentResponseId: 'response-1',
        rootResponseId: 'response-1',
        createdAt: 1003,
        diff: {
            addedNodes: [{ id: 'redis' }],
            addedEdges: [{ key: 'app->redis' }],
        },
    });
    const thirdArtifact = architectureArtifact('response-4', {
        parentResponseId: 'response-3',
        rootResponseId: 'response-1',
        createdAt: 1004,
        status: 'fallback',
        source: 'markdown',
        diff: {
            addedNodes: [{ id: 'kafka' }],
            modifiedNodes: [{ id: 'app', changedFields: ['purpose'] }],
        },
    });
    const chain: DiagramTimelineMessage[] = [
        { id: 'response-1', timestamp: 1001, rootResponseId: 'response-1', artifacts: [firstArtifact] },
        { id: 'response-2', timestamp: 1002, rootResponseId: 'response-1' },
        { id: 'response-3', timestamp: 1003, rootResponseId: 'response-1', artifacts: [secondArtifact] },
        { id: 'response-4', timestamp: 1004, rootResponseId: 'response-1', artifacts: [thirdArtifact] },
    ];

    const timeline = buildDiagramTimeline(chain, 'response-3');

    assert.equal(timeline.rootResponseId, 'response-1');
    assert.equal(timeline.activeVersionCount, 3);
    assert.equal(timeline.activeVersion, 2);
    assert.equal(timeline.activeItem?.responseId, 'response-3');
    assert.deepEqual(timeline.items.map((item) => item.responseId), ['response-1', 'response-3', 'response-4']);
    assert.deepEqual(timeline.items.map((item) => item.version), [1, 2, 3]);
    assert.equal(timeline.items[1].parentVersion, 1);
    assert.equal(timeline.items[1].rootVersion, 1);
    assert.equal(timeline.items[2].parentVersion, 2);
    assert.equal(timeline.items[2].rootVersion, 1);
    assert.equal(timeline.items[2].status, 'fallback');
    assert.equal(timeline.items[2].source, 'markdown');
});

test('Sprint 6 diagram timeline prefers artifact lineage and keeps artifact references read-only', () => {
    const artifact = architectureArtifact('child', {
        parentResponseId: 'artifact-parent',
        rootResponseId: 'artifact-root',
        createdAt: 4200,
    });
    const chain: DiagramTimelineMessage[] = [
        {
            id: 'child',
            timestamp: 4100,
            rootResponseId: 'message-root',
            ownership: { parentResponseId: 'message-parent' },
            artifacts: [artifact],
        },
    ];

    const timeline = buildDiagramTimeline(chain, 'child');

    assert.equal(timeline.rootResponseId, 'artifact-root');
    assert.equal(timeline.items[0].parentResponseId, 'artifact-parent');
    assert.equal(timeline.items[0].rootResponseId, 'artifact-root');
    assert.equal(timeline.items[0].createdAt, 4200);
    assert.equal(timeline.items[0].artifact, artifact);
    assert.equal(chain[0].rootResponseId, 'message-root');
    assert.equal(chain[0].ownership?.parentResponseId, 'message-parent');
    assert.equal(chain[0].artifacts?.[0], artifact);
});

test('Sprint 6 diagram timeline resolves active version only for selected architecture responses', () => {
    const chain: DiagramTimelineMessage[] = [
        { id: 'response-1', rootResponseId: 'response-1', artifacts: [architectureArtifact('response-1')] },
        { id: 'response-2', rootResponseId: 'response-1' },
        {
            id: 'response-3',
            rootResponseId: 'response-1',
            artifacts: [architectureArtifact('response-3', { parentResponseId: 'response-1', rootResponseId: 'response-1' })],
        },
    ];

    assert.equal(buildDiagramTimeline(chain, 'response-2').activeVersion, null);
    assert.equal(buildDiagramTimeline(chain, 'missing').activeVersion, null);
    assert.equal(buildDiagramTimeline(chain, null).activeVersion, null);
    assert.equal(buildDiagramTimeline(chain).activeVersion, 2);
});

test('Sprint 6 diagram timeline projects diff summaries without recomputing history', () => {
    const diff: ArchitectureDiagramDiff = {
        addedNodes: [{ id: 'redis' }, { id: 'kafka' }],
        removedNodes: [{ id: 'old-cache' }],
        modifiedNodes: [{ id: 'app', changedFields: ['purpose'] }],
        addedEdges: [{ key: 'app->redis' }, { key: 'app->kafka' }],
        removedEdges: [],
    };
    const summary = summarizeArchitectureDiff(diff);
    const timeline = buildDiagramTimeline([
        {
            id: 'response-1',
            rootResponseId: 'response-1',
            artifacts: [architectureArtifact('response-1', { diff })],
        },
    ], 'response-1');

    assert.deepEqual(summary, {
        addedNodes: 2,
        removedNodes: 1,
        modifiedNodes: 1,
        addedEdges: 2,
        removedEdges: 0,
        totalChanges: 6,
        hasChanges: true,
    });
    assert.equal(timeline.items[0].hasDiff, true);
    assert.deepEqual(timeline.items[0].diffSummary, summary);
});

test('Sprint 6 diagram timeline handles empty and non-diagram chains', () => {
    assert.equal(buildDiagramTimeline([]).rootResponseId, null);
    assert.equal(buildDiagramTimeline([]).activeVersionCount, 0);
    assert.equal(buildDiagramTimeline([{ id: 'response-1' }], 'response-1').activeVersion, null);
    assert.equal(buildDiagramTimeline([{ id: 'response-1' }], 'response-1').items.length, 0);
});

test('Sprint 6 Phase A remains a read model without UI or persistence wiring', () => {
    const helper = read('src/components/pro-v2/architecture/diagramTimeline.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');

    assert.doesNotMatch(helper, /from 'react'|from "react"/);
    assert.doesNotMatch(helper, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(bridge, /buildDiagramTimeline/);
});
