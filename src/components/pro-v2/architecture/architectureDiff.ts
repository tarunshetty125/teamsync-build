import type { ArchitectureDiagram, ArchitectureEdgeModel, ArchitectureNodeModel } from './architectureSchema';

export interface ArchitectureNodeChange {
    id: string;
    before?: ArchitectureNodeModel;
    after?: ArchitectureNodeModel;
    changedFields?: string[];
}

export interface ArchitectureEdgeChange {
    key: string;
    before?: ArchitectureEdgeModel;
    after?: ArchitectureEdgeModel;
}

export interface ArchitectureDiagramDiff {
    addedNodes: ArchitectureNodeChange[];
    removedNodes: ArchitectureNodeChange[];
    modifiedNodes: ArchitectureNodeChange[];
    addedEdges: ArchitectureEdgeChange[];
    removedEdges: ArchitectureEdgeChange[];
}

const NODE_COMPARE_FIELDS: Array<keyof ArchitectureNodeModel> = [
    'label',
    'kind',
    'technology',
    'purpose',
    'layer',
    'latency',
    'failureMode',
];

function edgeKey(edge: ArchitectureEdgeModel): string {
    return `${edge.source}->${edge.target}`;
}

export function diffArchitectureDiagrams(
    previous: ArchitectureDiagram | null | undefined,
    next: ArchitectureDiagram | null | undefined,
): ArchitectureDiagramDiff | undefined {
    if (!previous || !next) return undefined;

    const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
    const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));
    const previousEdges = new Map(previous.edges.map((edge) => [edgeKey(edge), edge]));
    const nextEdges = new Map(next.edges.map((edge) => [edgeKey(edge), edge]));

    const addedNodes: ArchitectureNodeChange[] = [];
    const removedNodes: ArchitectureNodeChange[] = [];
    const modifiedNodes: ArchitectureNodeChange[] = [];
    const addedEdges: ArchitectureEdgeChange[] = [];
    const removedEdges: ArchitectureEdgeChange[] = [];

    nextNodes.forEach((node, id) => {
        const before = previousNodes.get(id);
        if (!before) {
            addedNodes.push({ id, after: node });
            return;
        }

        const changedFields = NODE_COMPARE_FIELDS.filter((field) => before[field] !== node[field]);
        if (changedFields.length > 0) {
            modifiedNodes.push({ id, before, after: node, changedFields });
        }
    });

    previousNodes.forEach((node, id) => {
        if (!nextNodes.has(id)) removedNodes.push({ id, before: node });
    });

    nextEdges.forEach((edge, key) => {
        if (!previousEdges.has(key)) addedEdges.push({ key, after: edge });
    });

    previousEdges.forEach((edge, key) => {
        if (!nextEdges.has(key)) removedEdges.push({ key, before: edge });
    });

    return {
        addedNodes,
        removedNodes,
        modifiedNodes,
        addedEdges,
        removedEdges,
    };
}
