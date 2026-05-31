import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { diffArchitectureDiagrams } from '../../src/components/pro-v2/architecture/architectureDiff.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const baseDiagram = {
    type: 'architecture' as const,
    direction: 'TB' as const,
    nodes: [
        {
            id: 'user',
            label: 'User',
            kind: 'client' as const,
            technology: 'Browser',
            purpose: 'Starts requests',
        },
        {
            id: 'lb',
            label: 'Load Balancer',
            kind: 'gateway' as const,
            technology: 'ALB',
            purpose: 'Routes traffic',
        },
        {
            id: 'app',
            label: 'App Server',
            kind: 'service' as const,
            technology: 'Node.js',
            purpose: 'Handles application logic',
        },
    ],
    edges: [
        { source: 'user', target: 'lb', label: 'HTTPS' },
        { source: 'lb', target: 'app', label: 'routes' },
    ],
};

test('Pro V2 diagram diff tracks node and edge evolution between parent and child diagrams', () => {
    const nextDiagram = {
        ...baseDiagram,
        nodes: [
            baseDiagram.nodes[0],
            baseDiagram.nodes[1],
            {
                ...baseDiagram.nodes[2],
                purpose: 'Handles application logic and cache orchestration',
            },
            {
                id: 'redis',
                label: 'Redis',
                kind: 'cache' as const,
                technology: 'Redis Cluster',
                purpose: 'Caches hot reads',
            },
        ],
        edges: [
            ...baseDiagram.edges,
            { source: 'app', target: 'redis', label: 'cache lookup' },
        ],
    };

    const diff = diffArchitectureDiagrams(baseDiagram, nextDiagram);

    assert.deepEqual(diff?.addedNodes.map((node) => node.id), ['redis']);
    assert.deepEqual(diff?.removedNodes, []);
    assert.deepEqual(diff?.modifiedNodes.map((node) => ({
        id: node.id,
        changedFields: node.changedFields,
    })), [
        {
            id: 'app',
            changedFields: ['purpose'],
        },
    ]);
    assert.deepEqual(diff?.addedEdges.map((edge) => edge.key), ['app->redis']);
    assert.deepEqual(diff?.removedEdges, []);
});

test('Pro V2 diagram artifacts persist parsed payloads with ownership lineage', () => {
    const artifacts = read('src/components/pro-v2/architecture/diagramArtifacts.ts');
    const responseArtifacts = read('src/lib/overlay/responseArtifacts.ts');
    const streams = read('src/components/pro-v2/useOverlayIpcStreams.ts');
    const bridge = read('src/components/pro-v2/useCluelyOverlayBridge.ts');

    assert.match(artifacts, /ArchitectureResponseArtifactPayload/);
    assert.match(artifacts, /diagram: ArchitectureDiagram \| null/);
    assert.match(artifacts, /fallbackDiagram: ArchitectureDiagram \| null/);
    assert.match(artifacts, /diff\?: ArchitectureDiagramDiff/);
    assert.match(artifacts, /const parentResponseId = message\.ownership\?\.parentResponseId/);
    assert.match(artifacts, /rootResponseId: getRootResponseId\(message\)/);
    assert.match(artifacts, /status: resolveArchitectureStatus/);
    assert.match(responseArtifacts, /status: 'detected' \| 'parsed_pending' \| 'parsed' \| 'parse_error' \| 'fallback'/);
    assert.match(streams, /buildArchitectureResponseArtifacts\(hydratedMessage, text, u\)/);
    assert.match(bridge, /buildArchitectureResponseArtifacts\(lastMsg, lastMsg\.text, prev\)/);
});

test('Pro V2 diagram viewport continuity is chain keyed without minimap or diagram history UI', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const renderer = read('src/components/pro-v2/architecture/ArchitectureRenderer.tsx');
    const canvas = read('src/components/pro-v2/architecture/ArchitectureCanvas.tsx');

    assert.match(surface, /diagramChainKey=\{getDiagramChainKey\(renderedResponse\)\}/);
    assert.match(surface, /diagramChainKey\?: string/);
    assert.match(renderer, /diagramChainKey\?: string/);
    assert.match(canvas, /const viewportByChainKey = new Map/);
    assert.match(canvas, /viewportByChainKey\.get\(viewportCacheKey\)/);
    assert.match(canvas, /rememberViewport\(viewportCacheKey/);
    assert.doesNotMatch(canvas, /MiniMap/);
    assert.doesNotMatch(surface, /Diagram 1/);
});

test('Pro V2 diagram nodes expose existing intelligence metadata before schema expansion', () => {
    const node = read('src/components/pro-v2/architecture/ArchitectureNode.tsx');
    const schema = read('src/components/pro-v2/architecture/architectureSchema.ts');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(schema, /technology\?: string/);
    assert.match(schema, /purpose\?: string/);
    assert.match(schema, /latency\?: string/);
    assert.match(schema, /failureMode\?: string/);
    assert.match(node, /Technology:/);
    assert.match(node, /Purpose:/);
    assert.match(node, /Latency:/);
    assert.match(node, /Failure mode:/);
    assert.match(node, /v2-architecture-node-failure/);
    assert.match(css, /\.v2-architecture-node-failure/);
    assert.doesNotMatch(schema, /tradeoffs\?:/);
    assert.doesNotMatch(schema, /bottlenecks\?:/);
});
