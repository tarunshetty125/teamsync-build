import type { Edge, Node } from '@xyflow/react';
import dagre from 'dagre';
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

function getLayoutDensity(nodeCount: number) {
    if (nodeCount >= 35) {
        return {
            nodeSpacing: 54,
            layerSpacing: 112,
            marginX: 64,
            marginY: 52,
        };
    }
    if (nodeCount >= 20) {
        return {
            nodeSpacing: 46,
            layerSpacing: 92,
            marginX: 52,
            marginY: 44,
        };
    }
    return {
        nodeSpacing: 38,
        layerSpacing: 72,
        marginX: 40,
        marginY: 36,
    };
}

function dagreDirection(direction: ArchitectureDirection): 'TB' | 'BT' | 'LR' | 'RL' {
    return direction || 'TB';
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
    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
        rankdir: dagreDirection(diagram.direction),
        nodesep: density.nodeSpacing,
        ranksep: density.layerSpacing,
        marginx: density.marginX,
        marginy: density.marginY,
        ranker: 'network-simplex',
    });

    diagram.nodes.forEach((node) => {
        graph.setNode(node.id, {
            width: ARCHITECTURE_NODE_WIDTH,
            height: node.kind === 'gateway' ? ARCHITECTURE_NODE_HEIGHT + 8 : ARCHITECTURE_NODE_HEIGHT,
        });
    });
    diagram.edges.forEach((edge) => {
        graph.setEdge(edge.source, edge.target, {
            label: edge.label || '',
            width: edge.label ? Math.min(160, Math.max(48, edge.label.length * 7)) : 0,
            height: edge.label ? 18 : 0,
        });
    });

    dagre.layout(graph);

    const nodes: ArchitectureFlowNode[] = diagram.nodes.map((node, index) => {
        const laidOut = graph.node(node.id);
        const width = ARCHITECTURE_NODE_WIDTH;
        const height = node.kind === 'gateway' ? ARCHITECTURE_NODE_HEIGHT + 8 : ARCHITECTURE_NODE_HEIGHT;
        const position = laidOut
            ? { x: laidOut.x - width / 2, y: laidOut.y - height / 2 }
            : { x: index * (ARCHITECTURE_NODE_WIDTH + density.nodeSpacing), y: 0 };
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
