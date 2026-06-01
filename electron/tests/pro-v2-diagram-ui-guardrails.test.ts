import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildDiagramTimeline,
    type DiagramTimelineMessage,
} from '../../src/components/pro-v2/architecture/diagramTimeline.ts';
import {
    buildDiagramGuardrails,
    ARCHITECTURE_GUARDRAIL_EDGE_CAP,
    ARCHITECTURE_GUARDRAIL_NODE_CAP,
    ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT,
    ARCHITECTURE_GUARDRAIL_WARNING_NODE_COUNT,
} from '../../src/components/pro-v2/architecture/diagramGuardrails.ts';
import {
    validateArchitecturePayload,
    type ArchitectureDiagram,
    type ArchitectureNodeModel,
} from '../../src/components/pro-v2/architecture/architectureSchema.ts';
import type { V2ResponseArtifact } from '../../src/lib/overlay/responseArtifacts.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function node(index: number): ArchitectureNodeModel {
    return {
        id: `node-${index}`,
        label: `Node ${index}`,
        kind: index === 0 ? 'client' : 'service',
    };
}

function diagram(nodeCount: number, edgeCount = Math.max(0, nodeCount - 1)): ArchitectureDiagram {
    const nodes = Array.from({ length: nodeCount }, (_, index) => node(index));
    const edges = Array.from({ length: edgeCount }, (_, index) => ({
        source: nodes[index % Math.max(1, nodes.length - 1)]?.id ?? 'node-0',
        target: nodes[(index % Math.max(1, nodes.length - 1)) + 1]?.id ?? 'node-0',
    })).filter((edge) => edge.source !== edge.target);

    return {
        type: 'architecture',
        direction: 'TB',
        nodes,
        edges,
    };
}

function architectureArtifact(
    responseId: string,
    currentDiagram: ArchitectureDiagram | null,
    issues: string[] = [],
    fallbackDiagram: ArchitectureDiagram | null = null,
): V2ResponseArtifact {
    return {
        id: `${responseId}:architecture`,
        responseId,
        rootResponseId: responseId,
        kind: 'architecture',
        source: 'architecture_json',
        createdAt: 1000,
        status: currentDiagram ? 'parsed' : 'fallback',
        payload: {
            diagram: currentDiagram,
            fallbackDiagram,
            issues,
        },
    };
}

function buildChain(
    currentDiagram: ArchitectureDiagram | null,
    issues: string[] = [],
    fallbackDiagram: ArchitectureDiagram | null = null,
): DiagramTimelineMessage[] {
    return [
        {
            id: 'response-1',
            rootResponseId: 'response-1',
            artifacts: [architectureArtifact('response-1', currentDiagram, issues, fallbackDiagram)],
        },
    ];
}

test('Sprint 6 UI-D wires guardrail messaging to buildDiagramGuardrails only', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(surface, /buildDiagramGuardrails/);
    assert.match(surface, /const diagramGuardrails = useMemo/);
    assert.match(surface, /diagramGuardrails\.status !== 'supported'/);
    assert.match(surface, /<DiagramGuardrailMessage guardrails=\{diagramGuardrails\} \/>/);
    assert.match(surface, /aria-label="Diagram guardrail message"/);
    assert.match(surface, /v2-diagram-guardrail--\$\{guardrails\.status\}/);
    assert.match(css, /\.v2-diagram-guardrail/);
    assert.match(css, /\.v2-diagram-guardrail--warning/);
    assert.match(css, /\.v2-diagram-guardrail--truncated/);
    assert.match(css, /\.v2-diagram-guardrail--oversized/);
});

test('Sprint 6 UI-D supported guardrail remains render-silent', () => {
    const timeline = buildDiagramTimeline(buildChain(diagram(4)), 'response-1');
    const guardrails = buildDiagramGuardrails(timeline, 'response-1');

    assert.equal(guardrails.status, 'supported');
    assert.equal(guardrails.supported, true);
    assert.equal(guardrails.warning, false);
    assert.equal(guardrails.truncated, false);
    assert.equal(guardrails.oversized, false);
});

test('Sprint 6 UI-D warning guardrail is informational and does not restrict timeline suitability', () => {
    const timeline = buildDiagramTimeline(buildChain(diagram(ARCHITECTURE_GUARDRAIL_WARNING_NODE_COUNT)), 'response-1');
    const guardrails = buildDiagramGuardrails(timeline, 'response-1');

    assert.equal(guardrails.status, 'warning');
    assert.equal(guardrails.warning, true);
    assert.equal(guardrails.truncated, false);
    assert.equal(guardrails.oversized, false);
    assert.equal(guardrails.timelineSuitability.suitable, true);
});

test('Sprint 6 UI-D truncated guardrail projects parser-cap warning without blocking timeline', () => {
    const validation = validateArchitecturePayload({
        type: 'architecture',
        direction: 'TB',
        nodes: Array.from({ length: ARCHITECTURE_GUARDRAIL_NODE_CAP + 5 }, (_, index) => ({
            id: `raw-${index}`,
            label: `Raw ${index}`,
            kind: 'service',
        })),
        edges: [],
    });
    const timeline = buildDiagramTimeline(buildChain(validation.diagram, validation.issues), 'response-1');
    const guardrails = buildDiagramGuardrails(timeline, 'response-1');

    assert.equal(guardrails.status, 'truncated');
    assert.equal(guardrails.truncated, true);
    assert.deepEqual(guardrails.parserCaps.truncationIssues, ['architecture_nodes_truncated']);
    assert.equal(guardrails.parserCaps.nodeCap, ARCHITECTURE_GUARDRAIL_NODE_CAP);
    assert.equal(guardrails.timelineSuitability.suitable, true);
});

test('Sprint 6 UI-D oversized guardrail projects performance notice without disabling navigation', () => {
    const timeline = buildDiagramTimeline(
        buildChain(diagram(ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT, ARCHITECTURE_GUARDRAIL_EDGE_CAP)),
        'response-1',
    );
    const guardrails = buildDiagramGuardrails(timeline, 'response-1');

    assert.equal(guardrails.status, 'oversized');
    assert.equal(guardrails.oversized, true);
    assert.equal(guardrails.parserCaps.edgeCountAtCap, true);
    assert.equal(guardrails.timelineSuitability.suitable, true);
});

test('Sprint 6 UI-D does not add renderer, schema, persistence, guardrail restrictions, or timeline disabling', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const renderer = read('src/components/pro-v2/architecture/ArchitectureRenderer.tsx');
    const canvas = read('src/components/pro-v2/architecture/ArchitectureCanvas.tsx');
    const schema = read('src/components/pro-v2/architecture/architectureSchema.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');

    assert.doesNotMatch(renderer, /DiagramGuardrail|buildDiagramGuardrails/);
    assert.doesNotMatch(canvas, /DiagramGuardrail|buildDiagramGuardrails/);
    assert.doesNotMatch(schema, /DiagramGuardrail|guardrailStatus|oversizedStatus/);
    assert.doesNotMatch(surface, /disabled=\{.*guardrail|comparisonSuitability\.suitable/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(bridge, /buildDiagramGuardrails|diagramGuardrails/);
    assert.doesNotMatch(history, /buildDiagramGuardrails|diagramGuardrails/);
});
