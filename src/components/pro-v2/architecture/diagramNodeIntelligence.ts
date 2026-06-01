import type { ArchitectureDiagram, ArchitectureNodeKind } from './architectureSchema';
import type { ArchitectureDiagramDiff } from './architectureDiff';
import type { DiagramTimeline, DiagramTimelineItem } from './diagramTimeline';

export type DiagramNodeDiffParticipationStatus =
    | 'added'
    | 'removed'
    | 'modified'
    | 'unchanged'
    | 'unavailable';

export interface BuildDiagramNodeIntelligenceOptions {
    responseId?: string | null;
    selectedNodeId?: string | null;
}

export interface DiagramNodeDependency {
    edgeKey: string;
    nodeId: string;
    label: string;
    kind: ArchitectureNodeKind;
    edgeLabel?: string;
    protocol?: string;
    latency?: string;
}

export interface DiagramNodeDependencyCounts {
    incoming: number;
    outgoing: number;
    total: number;
}

export interface DiagramNodeResponseOwnershipContext {
    responseId: string;
    version: number;
    rootResponseId: string;
    rootVersion?: number;
    parentResponseId?: string;
    parentVersion?: number;
}

export interface DiagramNodeArtifactOwnershipContext {
    artifactId: string;
    responseId: string;
    rootResponseId: string;
    parentResponseId?: string;
    status: DiagramTimelineItem['status'];
    source: DiagramTimelineItem['source'];
    createdAt?: number;
}

export interface DiagramNodeDiffParticipation {
    status: DiagramNodeDiffParticipationStatus;
    changedFields: string[];
}

export interface DiagramNodeDiffContext {
    hasDiff: boolean;
    addedNodeIds: string[];
    removedNodeIds: string[];
    modifiedNodeIds: string[];
}

export interface DiagramNodeIntelligence {
    id: string;
    label: string;
    kind: ArchitectureNodeKind;
    technology?: string;
    purpose?: string;
    layer?: string;
    latency?: string;
    failureMode?: string;
    incomingDependencies: DiagramNodeDependency[];
    outgoingDependencies: DiagramNodeDependency[];
    dependencyCounts: DiagramNodeDependencyCounts;
    responseOwnership: DiagramNodeResponseOwnershipContext;
    artifactOwnership: DiagramNodeArtifactOwnershipContext;
    diffParticipation: DiagramNodeDiffParticipation;
}

export interface DiagramNodeIntelligenceReadModel {
    responseOwnership: DiagramNodeResponseOwnershipContext | null;
    artifactOwnership: DiagramNodeArtifactOwnershipContext | null;
    nodes: DiagramNodeIntelligence[];
    byNodeId: Map<string, DiagramNodeIntelligence>;
    selectedNode: DiagramNodeIntelligence | null;
    nodeCount: number;
    edgeCount: number;
    diffContext: DiagramNodeDiffContext;
    issues: string[];
}

function emptyDiffContext(): DiagramNodeDiffContext {
    return {
        hasDiff: false,
        addedNodeIds: [],
        removedNodeIds: [],
        modifiedNodeIds: [],
    };
}

function emptyReadModel(issues: string[] = []): DiagramNodeIntelligenceReadModel {
    return {
        responseOwnership: null,
        artifactOwnership: null,
        nodes: [],
        byNodeId: new Map(),
        selectedNode: null,
        nodeCount: 0,
        edgeCount: 0,
        diffContext: emptyDiffContext(),
        issues,
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function extractDiagram(item: DiagramTimelineItem): ArchitectureDiagram | null {
    const payload = asRecord(item.artifact.payload);
    const diagram = asRecord(payload?.diagram);
    if (diagram) return diagram as unknown as ArchitectureDiagram;
    const fallbackDiagram = asRecord(payload?.fallbackDiagram);
    return fallbackDiagram ? fallbackDiagram as unknown as ArchitectureDiagram : null;
}

function extractStoredDiff(item: DiagramTimelineItem): ArchitectureDiagramDiff | undefined {
    const payload = asRecord(item.artifact.payload);
    const diff = asRecord(payload?.diff);
    if (!diff) return undefined;

    return {
        addedNodes: asArray(diff.addedNodes) as ArchitectureDiagramDiff['addedNodes'],
        removedNodes: asArray(diff.removedNodes) as ArchitectureDiagramDiff['removedNodes'],
        modifiedNodes: asArray(diff.modifiedNodes) as ArchitectureDiagramDiff['modifiedNodes'],
        addedEdges: asArray(diff.addedEdges) as ArchitectureDiagramDiff['addedEdges'],
        removedEdges: asArray(diff.removedEdges) as ArchitectureDiagramDiff['removedEdges'],
    };
}

function resolveCurrentItem(timeline: DiagramTimeline, responseId?: string | null): DiagramTimelineItem | null {
    if (responseId === undefined) return timeline.activeItem ?? timeline.items[timeline.items.length - 1] ?? null;
    return responseId ? timeline.byResponseId.get(responseId) ?? null : null;
}

function toResponseOwnership(item: DiagramTimelineItem): DiagramNodeResponseOwnershipContext {
    return {
        responseId: item.responseId,
        version: item.version,
        rootResponseId: item.rootResponseId,
        ...(item.rootVersion ? { rootVersion: item.rootVersion } : {}),
        ...(item.parentResponseId ? { parentResponseId: item.parentResponseId } : {}),
        ...(item.parentVersion ? { parentVersion: item.parentVersion } : {}),
    };
}

function toArtifactOwnership(item: DiagramTimelineItem): DiagramNodeArtifactOwnershipContext {
    return {
        artifactId: item.artifactId,
        responseId: item.artifact.responseId,
        rootResponseId: item.artifact.rootResponseId,
        ...(item.artifact.parentResponseId ? { parentResponseId: item.artifact.parentResponseId } : {}),
        status: item.status,
        source: item.source,
        ...(item.artifact.createdAt ? { createdAt: item.artifact.createdAt } : {}),
    };
}

function edgeKey(source: string, target: string): string {
    return `${source}->${target}`;
}

function toDependency(
    edge: ArchitectureDiagram['edges'][number],
    peerNode: ArchitectureDiagram['nodes'][number],
): DiagramNodeDependency {
    return {
        edgeKey: edgeKey(edge.source, edge.target),
        nodeId: peerNode.id,
        label: peerNode.label,
        kind: peerNode.kind,
        ...(edge.label ? { edgeLabel: edge.label } : {}),
        ...(edge.protocol ? { protocol: edge.protocol } : {}),
        ...(edge.latency ? { latency: edge.latency } : {}),
    };
}

function projectDiffContext(diff?: ArchitectureDiagramDiff): DiagramNodeDiffContext {
    if (!diff) return emptyDiffContext();
    return {
        hasDiff: true,
        addedNodeIds: diff.addedNodes.map((change) => change.id),
        removedNodeIds: diff.removedNodes.map((change) => change.id),
        modifiedNodeIds: diff.modifiedNodes.map((change) => change.id),
    };
}

function projectDiffParticipation(
    nodeId: string,
    diff?: ArchitectureDiagramDiff,
): DiagramNodeDiffParticipation {
    if (!diff) {
        return {
            status: 'unavailable',
            changedFields: [],
        };
    }

    if (diff.addedNodes.some((change) => change.id === nodeId)) {
        return {
            status: 'added',
            changedFields: [],
        };
    }

    const modified = diff.modifiedNodes.find((change) => change.id === nodeId);
    if (modified) {
        return {
            status: 'modified',
            changedFields: modified.changedFields ?? [],
        };
    }

    if (diff.removedNodes.some((change) => change.id === nodeId)) {
        return {
            status: 'removed',
            changedFields: [],
        };
    }

    return {
        status: 'unchanged',
        changedFields: [],
    };
}

export function buildDiagramNodeIntelligence(
    timeline: DiagramTimeline,
    options: BuildDiagramNodeIntelligenceOptions = {},
): DiagramNodeIntelligenceReadModel {
    const item = resolveCurrentItem(timeline, options.responseId);
    if (!item) return emptyReadModel(['current_version_missing']);

    const diagram = extractDiagram(item);
    if (!diagram) return emptyReadModel(['diagram_missing']);

    const responseOwnership = toResponseOwnership(item);
    const artifactOwnership = toArtifactOwnership(item);
    const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]));
    const diff = extractStoredDiff(item);
    const diffContext = projectDiffContext(diff);

    const nodes = diagram.nodes.map((node) => {
        const incomingDependencies = diagram.edges
            .filter((edge) => edge.target === node.id)
            .map((edge) => {
                const peerNode = nodeById.get(edge.source);
                return peerNode ? toDependency(edge, peerNode) : null;
            })
            .filter((dependency): dependency is DiagramNodeDependency => Boolean(dependency));

        const outgoingDependencies = diagram.edges
            .filter((edge) => edge.source === node.id)
            .map((edge) => {
                const peerNode = nodeById.get(edge.target);
                return peerNode ? toDependency(edge, peerNode) : null;
            })
            .filter((dependency): dependency is DiagramNodeDependency => Boolean(dependency));

        return {
            id: node.id,
            label: node.label,
            kind: node.kind,
            ...(node.technology ? { technology: node.technology } : {}),
            ...(node.purpose ? { purpose: node.purpose } : {}),
            ...(node.layer ? { layer: node.layer } : {}),
            ...(node.latency ? { latency: node.latency } : {}),
            ...(node.failureMode ? { failureMode: node.failureMode } : {}),
            incomingDependencies,
            outgoingDependencies,
            dependencyCounts: {
                incoming: incomingDependencies.length,
                outgoing: outgoingDependencies.length,
                total: incomingDependencies.length + outgoingDependencies.length,
            },
            responseOwnership,
            artifactOwnership,
            diffParticipation: projectDiffParticipation(node.id, diff),
        };
    });

    const byNodeId = new Map(nodes.map((node) => [node.id, node]));
    const selectedNode = options.selectedNodeId
        ? byNodeId.get(options.selectedNodeId) ?? null
        : null;

    return {
        responseOwnership,
        artifactOwnership,
        nodes,
        byNodeId,
        selectedNode,
        nodeCount: nodes.length,
        edgeCount: diagram.edges.length,
        diffContext,
        issues: options.selectedNodeId && !selectedNode ? ['selected_node_missing'] : [],
    };
}
