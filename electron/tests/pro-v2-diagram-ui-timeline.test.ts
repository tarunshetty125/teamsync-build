import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildDiagramTimeline,
    type DiagramTimelineMessage,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function architectureArtifact(
    responseId: string,
    parentResponseId?: string,
    rootResponseId: string = responseId,
): V2ResponseArtifact {
    return {
        id: `${responseId}:architecture`,
        responseId,
        parentResponseId,
        rootResponseId,
        kind: 'architecture',
        source: 'architecture_json',
        createdAt: 1000,
        status: 'parsed',
        payload: {
            diagram: {
                type: 'architecture',
                direction: 'TB',
                nodes: [{ id: responseId, label: responseId, kind: 'service' }],
                edges: [],
            },
            fallbackDiagram: null,
            issues: [],
            diff: {
                addedNodes: parentResponseId ? [{ id: responseId }] : [],
                removedNodes: [],
                modifiedNodes: [],
                addedEdges: [],
                removedEdges: [],
            },
        },
    };
}

test('Sprint 6 UI-A timeline panel is derived from activeResponseChain read model only', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(surface, /import \{\s*buildDiagramTimeline,/);
    assert.match(surface, /activeResponseChain: V2Message\[\]/);
    assert.match(surface, /buildDiagramTimeline\(activeResponseChain, renderedResponse\?\.id \?\? null\)/);
    assert.match(surface, /diagramTimeline\.items\.length >= 2 && Boolean\(diagramTimeline\.activeItem\)/);
    assert.match(surface, /<DiagramTimelinePanel/);
    assert.match(surface, /aria-label="Diagram timeline"/);
    assert.match(surface, /v\{timeline\.activeVersion \?\? 1\} of \{timeline\.activeVersionCount\}/);
    assert.match(css, /\.v2-diagram-timeline-panel/);
    assert.match(css, /\.v2-diagram-timeline-version--active/);
});

test('Sprint 6 UI-A timeline clicks reuse existing pinned response selection behavior', () => {
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const shell = read('src/components/pro-v2/TeamSyncCluelyOverlay.tsx');
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(bridge, /const selectResponseFromTimeline = useCallback\(\(responseId: string\) => \{/);
    assert.match(bridge, /setResponseSelection\(responseId, 'pinned'\)/);
    assert.match(bridge, /selectResponseFromTimeline,/);
    assert.match(shell, /activeResponseChain=\{bridge\.activeResponseChain\}/);
    assert.match(shell, /onSelectTimelineResponse=\{bridge\.selectResponseFromTimeline\}/);
    assert.match(surface, /onSelectTimelineResponse: \(responseId: string\) => void/);
    assert.match(surface, /if \(!isActive\) onSelectResponse\(item\.responseId\)/);
    assert.match(surface, /disabled=\{isActive\}/);
    assert.doesNotMatch(bridge, /setDiagramTimeline|diagramTimelineSelection|timelineSelectionMode/);
});

test('Sprint 6 UI-A timeline read model exposes active version without streaming mutation', () => {
    const chain: DiagramTimelineMessage[] = [
        {
            id: 'response-1',
            rootResponseId: 'response-1',
            artifacts: [architectureArtifact('response-1')],
        },
        {
            id: 'response-2',
            rootResponseId: 'response-1',
            ownership: { parentResponseId: 'response-1' },
            artifacts: [architectureArtifact('response-2', 'response-1', 'response-1')],
        },
        {
            id: 'response-3',
            rootResponseId: 'response-1',
            ownership: { parentResponseId: 'response-2' },
            artifacts: [architectureArtifact('response-3', 'response-2', 'response-1')],
        },
    ];

    const timeline = buildDiagramTimeline(chain, 'response-2');

    assert.equal(timeline.items.length, 3);
    assert.equal(timeline.activeVersion, 2);
    assert.equal(timeline.activeItem?.responseId, 'response-2');
    assert.deepEqual(timeline.items.map((item) => item.responseId), ['response-1', 'response-2', 'response-3']);
});

test('Sprint 6 UI-A does not add persistence, renderer, or history work', () => {
    const renderer = read('src/components/pro-v2/architecture/ArchitectureRenderer.tsx');
    const canvas = read('src/components/pro-v2/architecture/ArchitectureCanvas.tsx');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');

    assert.doesNotMatch(renderer, /DiagramTimelinePanel|buildDiagramTimeline/);
    assert.doesNotMatch(canvas, /DiagramTimelinePanel|buildDiagramTimeline/);
    assert.doesNotMatch(bridge, /localStorage\.setItem\([^)]*diagram|sessionStorage|indexedDB/);
    assert.doesNotMatch(history, /DiagramTimelinePanel|buildDiagramTimeline/);
});
