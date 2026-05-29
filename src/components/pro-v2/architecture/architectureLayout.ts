import type { Edge, Node } from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { ArchitectureDiagram, ArchitectureDirection } from './architectureSchema';
import { ARCHITECTURE_NODE_HEIGHT, ARCHITECTURE_NODE_WIDTH } from './architectureStyles';

export interface ArchitectureNodeData extends Record<string, unknown> {
    label: string;
    kind: ArchitectureDiagram['nodes'][number]['kind'];
    technology?: string;
    purpose?: string;
    layer?: string;
    latency?: string;
    failureMode?: string;
    direction: ArchitectureDirection;
    emphasized: boolean;
}

export interface ArchitectureEdgeData extends Record<string, unknown> {
    label?: string;
    protocol?: string;
    latency?: string;
}

export type ArchitectureFlowNode = Node<ArchitectureNodeData, 'architecture'>;
export type ArchitectureFlowEdge = Edge<ArchitectureEdgeData>;

export interface ArchitectureLayoutResult {
    nodes: ArchitectureFlowNode[];
    edges: ArchitectureFlowEdge[];
}

const elk = new ELK();

function getLayoutDensity(nodeCount: number) {
    if (nodeCount >= 35) {
        return {
            nodeSpacing: '54',
            layerSpacing: '112',
            padding: '[top=52,left=64,bottom=52,right=64]',
        };
    }
    if (nodeCount >= 20) {
        return {
            nodeSpacing: '46',
            layerSpacing: '92',
            padding: '[top=44,left=52,bottom=44,right=52]',
        };
    }
    return {
        nodeSpacing: '38',
        layerSpacing: '72',
        padding: '[top=36,left=40,bottom=36,right=40]',
    };
}

function elkDirection(direction: ArchitectureDirection): string {
    switch (direction) {
        case 'LR':
            return 'RIGHT';
        case 'RL':
            return 'LEFT';
        case 'BT':
            return 'UP';
        case 'TB':
        default:
            return 'DOWN';
    }
}

export function architectureDiagramFingerprint(diagram: ArchitectureDiagram): string {
    return JSON.stringify({
        direction: diagram.direction,
        nodes: diagram.nodes,
        edges: diagram.edges,
    });
}

export async function layoutArchitectureDiagram(diagram: ArchitectureDiagram): Promise<ArchitectureLayoutResult> {
    const density = getLayoutDensity(diagram.nodes.length);
    const graph: ElkNode = {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': elkDirection(diagram.direction),
            'elk.spacing.nodeNode': density.nodeSpacing,
            'elk.layered.spacing.nodeNodeBetweenLayers': density.layerSpacing,
            'elk.layered.spacing.edgeNodeBetweenLayers': '28',
            'elk.layered.spacing.edgeEdgeBetweenLayers': '18',
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.layered.edgeRouting': 'ORTHOGONAL',
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.padding': density.padding,
        },
        children: diagram.nodes.map((node) => ({
            id: node.id,
            width: ARCHITECTURE_NODE_WIDTH,
            height: node.kind === 'gateway' ? ARCHITECTURE_NODE_HEIGHT + 8 : ARCHITECTURE_NODE_HEIGHT,
        })),
        edges: diagram.edges.map((edge, index) => ({
            id: `edge-${edge.source}-${edge.target}-${index}`,
            sources: [edge.source],
            targets: [edge.target],
            labels: edge.label ? [{ text: edge.label }] : undefined,
        })),
    };

    const laidOut = await elk.layout(graph);
    const positionById = new Map(
        (laidOut.children ?? []).map((node) => [
            node.id,
            {
                x: node.x ?? 0,
                y: node.y ?? 0,
            },
        ]),
    );

    const nodes: ArchitectureFlowNode[] = diagram.nodes.map((node, index) => {
        const position = positionById.get(node.id) ?? { x: index * 220, y: 0 };
        return {
            id: node.id,
            type: 'architecture',
            position,
            data: {
                label: node.label,
                kind: node.kind,
                technology: node.technology,
                purpose: node.purpose,
                layer: node.layer,
                latency: node.latency,
                failureMode: node.failureMode,
                direction: diagram.direction,
                emphasized: node.kind === 'gateway' || index === 0,
            },
            draggable: false,
            selectable: false,
        };
    });

    const edges: ArchitectureFlowEdge[] = diagram.edges.map((edge, index) => ({
        id: `architecture-edge-${edge.source}-${edge.target}-${index}`,
        type: 'architecture',
        source: edge.source,
        target: edge.target,
        data: {
            ...(edge.label ? { label: edge.label } : {}),
            ...(edge.protocol ? { protocol: edge.protocol } : {}),
            ...(edge.latency ? { latency: edge.latency } : {}),
        },
        animated: false,
        selectable: false,
        focusable: false,
    }));

    return { nodes, edges };
}
