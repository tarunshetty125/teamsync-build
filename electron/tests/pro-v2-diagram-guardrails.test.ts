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
        label: `edge-${index}`,
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
    options: {
        parentResponseId?: string;
        rootResponseId?: string;
        diagram?: ArchitectureDiagram | null;
        fallbackDiagram?: ArchitectureDiagram | null;
        issues?: string[];
        diff?: unknown;
    } = {},
): V2ResponseArtifact {
    return {
        id: `${responseId}:architecture`,
        responseId,
        parentResponseId: options.parentResponseId,
        rootResponseId: options.rootResponseId ?? responseId,
        kind: 'architecture',
        source: 'architecture_json',
        createdAt: 6000,
        status: options.diagram === null && options.fallbackDiagram ? 'fallback' : 'parsed',
        payload: {
            diagram: options.diagram === undefined ? diagram(3) : options.diagram,
            fallbackDiagram: options.fallbackDiagram ?? null,
            issues: options.issues ?? [],
            ...(options.diff ? { diff: options.diff } : {}),
        },
    };
}

function buildChain(current: {
    diagram?: ArchitectureDiagram | null;
    fallbackDiagram?: ArchitectureDiagram | null;
    issues?: string[];
    diff?: unknown;
} = {}): DiagramTimelineMessage[] {
    return [
        {
            id: 'response-1',
            rootResponseId: 'response-1',
            artifacts: [
                architectureArtifact('response-1', {
                    rootResponseId: 'response-1',
                    diagram: diagram(3),
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
                    diagram: current.diagram,
                    fallbackDiagram: current.fallbackDiagram,
                    issues: current.issues,
                    diff: current.diff,
                }),
            ],
        },
    ];
}

test('Sprint 6 guardrails project supported small diagrams and comparison suitability', () => {
    const timeline = buildDiagramTimeline(buildChain({
        diagram: diagram(4),
        diff: { addedNodes: [], removedNodes: [], modifiedNodes: [], addedEdges: [], removedEdges: [] },
    }), 'response-2');
    const guardrails = buildDiagramGuardrails(timeline);

    assert.equal(guardrails.status, 'supported');
    assert.equal(guardrails.supported, true);
    assert.equal(guardrails.warning, false);
    assert.equal(guardrails.truncated, false);
    assert.equal(guardrails.oversized, false);
    assert.deepEqual(guardrails.counts, {
        nodes: 4,
        edges: 3,
    });
    assert.equal(guardrails.layout.density, 'standard');
    assert.equal(guardrails.parserCaps.nodeCap, ARCHITECTURE_GUARDRAIL_NODE_CAP);
    assert.equal(guardrails.parserCaps.edgeCap, ARCHITECTURE_GUARDRAIL_EDGE_CAP);
    assert.equal(guardrails.parserCaps.remainingNodeCapacity, 56);
    assert.equal(guardrails.comparisonSuitability.suitable, true);
    assert.equal(guardrails.comparisonSuitability.parentCurrent, true);
    assert.equal(guardrails.comparisonSuitability.rootCurrent, true);
    assert.equal(guardrails.comparisonSuitability.arbitraryVersion, true);
    assert.equal(guardrails.comparisonSuitability.requiresLazyDiff, false);
    assert.equal(guardrails.timelineSuitability.suitable, true);
});

test('Sprint 6 guardrails project dense layout warnings before oversized limits', () => {
    const timeline = buildDiagramTimeline(buildChain({
        diagram: diagram(ARCHITECTURE_GUARDRAIL_WARNING_NODE_COUNT),
    }), 'response-2');
    const guardrails = buildDiagramGuardrails(timeline);

    assert.equal(guardrails.status, 'warning');
    assert.equal(guardrails.supported, true);
    assert.equal(guardrails.warning, true);
    assert.equal(guardrails.truncated, false);
    assert.equal(guardrails.oversized, false);
    assert.equal(guardrails.layout.density, 'dense');
    assert.equal(guardrails.comparisonSuitability.suitable, true);
    assert.equal(guardrails.comparisonSuitability.requiresLazyDiff, true);
});

test('Sprint 6 guardrails project oversized diagrams using existing layout and parser edge caps', () => {
    const timeline = buildDiagramTimeline(buildChain({
        diagram: diagram(ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT, ARCHITECTURE_GUARDRAIL_EDGE_CAP),
    }), 'response-2');
    const guardrails = buildDiagramGuardrails(timeline);

    assert.equal(guardrails.status, 'oversized');
    assert.equal(guardrails.supported, true);
    assert.equal(guardrails.oversized, true);
    assert.equal(guardrails.layout.density, 'very_dense');
    assert.equal(guardrails.parserCaps.edgeCountAtCap, true);
    assert.equal(guardrails.parserCaps.remainingEdgeCapacity, 0);
    assert.equal(guardrails.comparisonSuitability.suitable, false);
    assert.deepEqual(guardrails.comparisonSuitability.issues.filter((issue) => issue === 'diagram_oversized_for_comparison'), [
        'diagram_oversized_for_comparison',
    ]);
    assert.equal(guardrails.timelineSuitability.suitable, true);
});

test('Sprint 6 guardrails project parser truncation from existing validation issues', () => {
    const rawNodes = Array.from({ length: ARCHITECTURE_GUARDRAIL_NODE_CAP + 5 }, (_, index) => ({
        id: `raw-${index}`,
        label: `Raw ${index}`,
        kind: 'service',
    }));
    const validation = validateArchitecturePayload({
        type: 'architecture',
        direction: 'TB',
        nodes: rawNodes,
        edges: [],
    });
    const timeline = buildDiagramTimeline(buildChain({
        diagram: validation.diagram,
        issues: validation.issues,
    }), 'response-2');
    const guardrails = buildDiagramGuardrails(timeline);

    assert.equal(validation.valid, true);
    assert.equal(validation.diagram?.nodes.length, ARCHITECTURE_GUARDRAIL_NODE_CAP);
    assert.match(validation.issues.join(','), /architecture_nodes_truncated/);
    assert.equal(guardrails.status, 'truncated');
    assert.equal(guardrails.truncated, true);
    assert.equal(guardrails.parserCaps.nodeCountAtCap, true);
    assert.deepEqual(guardrails.parserCaps.truncationIssues, ['architecture_nodes_truncated']);
    assert.equal(guardrails.comparisonSuitability.suitable, false);
    assert.deepEqual(guardrails.comparisonSuitability.issues.filter((issue) => issue === 'diagram_truncated_by_parser'), [
        'diagram_truncated_by_parser',
    ]);
});

test('Sprint 6 guardrails mark fallback diagrams as supported with warnings', () => {
    const timeline = buildDiagramTimeline(buildChain({
        diagram: null,
        fallbackDiagram: diagram(3),
        issues: ['invalid_json'],
    }), 'response-2');
    const guardrails = buildDiagramGuardrails(timeline);

    assert.equal(guardrails.status, 'warning');
    assert.equal(guardrails.supported, true);
    assert.equal(guardrails.warning, true);
    assert.equal(guardrails.diagramSource, 'fallbackDiagram');
    assert.match(guardrails.issues.join(','), /fallback_diagram_used/);
    assert.match(guardrails.issues.join(','), /invalid_json/);
});

test('Sprint 6 Phase E remains a read model without UI, persistence, or history wiring', () => {
    const helper = read('src/components/pro-v2/architecture/diagramGuardrails.ts');
    const schema = read('src/components/pro-v2/architecture/architectureSchema.ts');
    const layout = read('src/components/pro-v2/architecture/architectureLayout.ts');
    const canvas = read('src/components/pro-v2/architecture/ArchitectureCanvas.tsx');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');
    const history = read('src/lib/overlay/responseHistoryState.ts');

    assert.match(helper, /ARCHITECTURE_GUARDRAIL_NODE_CAP = 60/);
    assert.match(helper, /ARCHITECTURE_GUARDRAIL_EDGE_CAP = 90/);
    assert.match(schema, /rawNodes\.slice\(0, 60\)/);
    assert.match(schema, /rawEdges\.slice\(0, 90\)/);
    assert.match(layout, /nodeCount >= 35/);
    assert.match(layout, /nodeCount >= 20/);
    assert.match(canvas, /nodeCount >= 35/);
    assert.match(canvas, /nodeCount >= 20/);
    assert.doesNotMatch(helper, /from 'react'|from "react"/);
    assert.doesNotMatch(helper, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(bridge, /buildDiagramGuardrails|diagramGuardrails/);
    assert.doesNotMatch(history, /diagramGuardrails|DiagramGuardrail/);
});
