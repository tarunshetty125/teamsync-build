import type { Edge, Node } from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { ArchitectureDiagram, ArchitectureDirection } from './architectureSchema';
import { ARCHITECTURE_NODE_HEIGHT, ARCHITECTURE_NODE_WIDTH } from './architectureStyles';

export interface ArchitectureNodeData extends Record<string, unknown> {
    label: string;
    kind: ArchitectureDiagram['nodes'][number]['kind'];
    direction: ArchitectureDirection;
    emphasized: boolean;
}

export interface ArchitectureEdgeData extends Record<string, unknown> {
    label?: string;
}

export type ArchitectureFlowNode = Node<ArchitectureNodeData, 'architecture'>;
export type ArchitectureFlowEdge = Edge<ArchitectureEdgeData>;

export interface ArchitectureLayoutResult {
    nodes: ArchitectureFlowNode[];
    edges: ArchitectureFlowEdge[];
}

const elk = new ELK();

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
    const graph: ElkNode = {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': elkDirection(diagram.direction),
            'elk.spacing.nodeNode': '34',
            'elk.layered.spacing.nodeNodeBetweenLayers': '56',
            'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
            'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
            'elk.layered.edgeRouting': 'ORTHOGONAL',
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.padding': '[top=28,left=28,bottom=28,right=28]',
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
        data: edge.label ? { label: edge.label } : {},
        animated: false,
        selectable: false,
        focusable: false,
    }));

    return { nodes, edges };
}
