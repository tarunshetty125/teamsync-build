import type {
    ArchitectureDiagram,
    ArchitectureEdgeModel,
    ArchitectureNodeKind,
    ArchitectureNodeModel,
} from './architectureSchema';
import type { ArchitectureDiagramDiff } from './architectureDiff';
import type { DiagramTimeline, DiagramTimelineItem } from './diagramTimeline';
import {
    buildParentToCurrentEvolutionSummary,
    buildRootToCurrentEvolutionSummary,
    compareDiagramTimelineVersions,
    type DiagramEvolutionDiffSource,
    type DiagramEvolutionEndpoint,
    type DiagramEvolutionSummary,
    type DiagramEvolutionSummaryMode,
} from './diagramEvolutionSummary';

export type DiagramComparisonStatus =
    | 'added'
    | 'removed'
    | 'modified'
    | 'unchanged';

export interface DiagramComparisonNodeProjection {
    id: string;
    label: string;
    kind: ArchitectureNodeKind;
    status: DiagramComparisonStatus;
    changedFields: string[];
    before?: ArchitectureNodeModel;
    after?: ArchitectureNodeModel;
}

export interface DiagramComparisonEdgeProjection {
    key: string;
    source: string;
    target: string;
    status: DiagramComparisonStatus;
    before?: ArchitectureEdgeModel;
    after?: ArchitectureEdgeModel;
}

export interface DiagramComparisonCountProjection {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    total: number;
}

export interface DiagramComparisonReadModel {
    mode: DiagramEvolutionSummaryMode;
    from: DiagramEvolutionEndpoint | null;
    to: DiagramEvolutionEndpoint | null;
    available: boolean;
    diffSource: DiagramEvolutionDiffSource;
    usedStoredDiff: boolean;
    recomputed: boolean;
    summary: DiagramEvolutionSummary;
    nodes: DiagramComparisonNodeProjection[];
    edges: DiagramComparisonEdgeProjection[];
    nodeCounts: DiagramComparisonCountProjection;
    edgeCounts: DiagramComparisonCountProjection;
    issues: string[];
}

function emptyCounts(): DiagramComparisonCountProjection {
    return {
        added: 0,
        removed: 0,
        modified: 0,
        unchanged: 0,
        total: 0,
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function extractDiagram(item: DiagramTimelineItem | null): ArchitectureDiagram | null {
    if (!item) return null;
    const payload = asRecord(item.artifact.payload);
    const diagram = asRecord(payload?.diagram);
    if (diagram) return diagram as unknown as ArchitectureDiagram;
    const fallbackDiagram = asRecord(payload?.fallbackDiagram);
    return fallbackDiagram ? fallbackDiagram as unknown as ArchitectureDiagram : null;
}

function edgeKey(edge: ArchitectureEdgeModel): string {
    return `${edge.source}->${edge.target}`;
}

function countStatuses<T extends { status: DiagramComparisonStatus }>(items: T[]): DiagramComparisonCountProjection {
    const counts = items.reduce((acc, item) => {
        acc[item.status] += 1;
        return acc;
    }, {
        added: 0,
        removed: 0,
        modified: 0,
        unchanged: 0,
    });

    return {
        ...counts,
        total: items.length,
    };
}

function resolveItemByEndpoint(
    timeline: DiagramTimeline,
    endpoint: DiagramEvolutionEndpoint | null,
): DiagramTimelineItem | null {
    return endpoint ? timeline.byResponseId.get(endpoint.responseId) ?? null : null;
}

function fallbackNode(id: string): ArchitectureNodeModel {
    return {
        id,
        label: id,
        kind: 'service',
    };
}

function projectNodes(
    previous: ArchitectureDiagram | null,
    next: ArchitectureDiagram | null,
    diff?: ArchitectureDiagramDiff,
): DiagramComparisonNodeProjection[] {
    const previousNodes = new Map((previous?.nodes ?? []).map((node) => [node.id, node]));
    const nextNodes = new Map((next?.nodes ?? []).map((node) => [node.id, node]));
    const added = new Map((diff?.addedNodes ?? []).map((change) => [change.id, change]));
    const removed = new Map((diff?.removedNodes ?? []).map((change) => [change.id, change]));
    const modified = new Map((diff?.modifiedNodes ?? []).map((change) => [change.id, change]));
    const nodeIds = new Set<string>([
        ...previousNodes.keys(),
        ...nextNodes.keys(),
        ...added.keys(),
        ...removed.keys(),
        ...modified.keys(),
    ]);

    return [...nodeIds].map((id) => {
        const addedChange = added.get(id);
        const removedChange = removed.get(id);
        const modifiedChange = modified.get(id);
        const before = removedChange?.before ?? modifiedChange?.before ?? previousNodes.get(id);
        const after = addedChange?.after ?? modifiedChange?.after ?? nextNodes.get(id);
        const node = after ?? before ?? fallbackNode(id);

        if (addedChange) {
            return {
                id,
                label: node.label,
                kind: node.kind,
                status: 'added',
                changedFields: [] as string[],
                ...(after ? { after } : {}),
            };
        }

        if (removedChange) {
            return {
                id,
                label: node.label,
                kind: node.kind,
                status: 'removed',
                changedFields: [] as string[],
                ...(before ? { before } : {}),
            };
        }

        if (modifiedChange) {
            return {
                id,
                label: node.label,
                kind: node.kind,
                status: 'modified',
                changedFields: modifiedChange.changedFields ?? [],
                ...(before ? { before } : {}),
                ...(after ? { after } : {}),
            };
        }

        return {
            id,
            label: node.label,
            kind: node.kind,
            status: 'unchanged',
            changedFields: [] as string[],
            ...(before ? { before } : {}),
            ...(after ? { after } : {}),
        };
    });
}

function fallbackEdge(key: string): ArchitectureEdgeModel {
    const [source = '', target = ''] = key.split('->');
    return {
        source,
        target,
    };
}

function projectEdges(
    previous: ArchitectureDiagram | null,
    next: ArchitectureDiagram | null,
    diff?: ArchitectureDiagramDiff,
): DiagramComparisonEdgeProjection[] {
    const previousEdges = new Map((previous?.edges ?? []).map((edge) => [edgeKey(edge), edge]));
    const nextEdges = new Map((next?.edges ?? []).map((edge) => [edgeKey(edge), edge]));
    const added = new Map((diff?.addedEdges ?? []).map((change) => [change.key, change]));
    const removed = new Map((diff?.removedEdges ?? []).map((change) => [change.key, change]));
    const edgeKeys = new Set<string>([
        ...previousEdges.keys(),
        ...nextEdges.keys(),
        ...added.keys(),
        ...removed.keys(),
    ]);

    return [...edgeKeys].map((key) => {
        const addedChange = added.get(key);
        const removedChange = removed.get(key);
        const before = removedChange?.before ?? previousEdges.get(key);
        const after = addedChange?.after ?? nextEdges.get(key);
        const edge = after ?? before ?? fallbackEdge(key);

        if (addedChange) {
            return {
                key,
                source: edge.source,
                target: edge.target,
                status: 'added',
                ...(after ? { after } : {}),
            };
        }

        if (removedChange) {
            return {
                key,
                source: edge.source,
                target: edge.target,
                status: 'removed',
                ...(before ? { before } : {}),
            };
        }

        return {
            key,
            source: edge.source,
            target: edge.target,
            status: 'unchanged',
            ...(before ? { before } : {}),
            ...(after ? { after } : {}),
        };
    });
}

function buildComparisonFromSummary(
    timeline: DiagramTimeline,
    summary: DiagramEvolutionSummary,
): DiagramComparisonReadModel {
    const fromItem = resolveItemByEndpoint(timeline, summary.from);
    const toItem = resolveItemByEndpoint(timeline, summary.to);
    const previous = extractDiagram(fromItem);
    const next = extractDiagram(toItem);
    const nodes = projectNodes(previous, next, summary.diff);
    const edges = projectEdges(previous, next, summary.diff);

    return {
        mode: summary.mode,
        from: summary.from,
        to: summary.to,
        available: Boolean(summary.from && summary.to && summary.diff),
        diffSource: summary.diffSource,
        usedStoredDiff: summary.usedStoredDiff,
        recomputed: summary.recomputed,
        summary,
        nodes,
        edges,
        nodeCounts: countStatuses(nodes),
        edgeCounts: countStatuses(edges),
        issues: summary.issues,
    };
}

export function buildParentCurrentDiagramComparison(
    timeline: DiagramTimeline,
    currentResponseId?: string | null,
): DiagramComparisonReadModel {
    return buildComparisonFromSummary(
        timeline,
        buildParentToCurrentEvolutionSummary(timeline, currentResponseId),
    );
}

export function buildRootCurrentDiagramComparison(
    timeline: DiagramTimeline,
    currentResponseId?: string | null,
): DiagramComparisonReadModel {
    return buildComparisonFromSummary(
        timeline,
        buildRootToCurrentEvolutionSummary(timeline, currentResponseId),
    );
}

export function buildVersionPairDiagramComparison(
    timeline: DiagramTimeline,
    fromVersion: number,
    toVersion: number,
): DiagramComparisonReadModel {
    return buildComparisonFromSummary(
        timeline,
        compareDiagramTimelineVersions(timeline, fromVersion, toVersion),
    );
}
