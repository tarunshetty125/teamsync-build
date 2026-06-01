import type { ArchitectureDiagram } from './architectureSchema';
import {
    diffArchitectureDiagrams,
    type ArchitectureDiagramDiff,
} from './architectureDiff';
import {
    summarizeArchitectureDiff,
    type DiagramTimeline,
    type DiagramTimelineDiffSummary,
    type DiagramTimelineItem,
} from './diagramTimeline';

export type DiagramEvolutionSummaryMode =
    | 'parent_current'
    | 'root_current'
    | 'version_pair';

export type DiagramEvolutionDiffSource =
    | 'stored_artifact_diff'
    | 'computed'
    | 'none'
    | 'unavailable';

export interface DiagramEvolutionEndpoint {
    version: number;
    responseId: string;
    artifactId: string;
    rootResponseId: string;
    parentResponseId?: string;
}

export interface DiagramEvolutionChangeProjection {
    addedNodeIds: string[];
    removedNodeIds: string[];
    modifiedNodeIds: string[];
    addedEdgeKeys: string[];
    removedEdgeKeys: string[];
}

export interface DiagramEvolutionSummary {
    mode: DiagramEvolutionSummaryMode;
    from: DiagramEvolutionEndpoint | null;
    to: DiagramEvolutionEndpoint | null;
    diff?: ArchitectureDiagramDiff;
    diffSummary: DiagramTimelineDiffSummary;
    changes: DiagramEvolutionChangeProjection;
    diffSource: DiagramEvolutionDiffSource;
    usedStoredDiff: boolean;
    recomputed: boolean;
    issues: string[];
}

function emptyChanges(): DiagramEvolutionChangeProjection {
    return {
        addedNodeIds: [],
        removedNodeIds: [],
        modifiedNodeIds: [],
        addedEdgeKeys: [],
        removedEdgeKeys: [],
    };
}

function emptySummary(
    mode: DiagramEvolutionSummaryMode,
    args: {
        from?: DiagramTimelineItem | null;
        to?: DiagramTimelineItem | null;
        diffSource?: DiagramEvolutionDiffSource;
        issues?: string[];
    } = {},
): DiagramEvolutionSummary {
    return {
        mode,
        from: args.from ? toEndpoint(args.from) : null,
        to: args.to ? toEndpoint(args.to) : null,
        diffSummary: summarizeArchitectureDiff(),
        changes: emptyChanges(),
        diffSource: args.diffSource ?? 'none',
        usedStoredDiff: false,
        recomputed: false,
        issues: args.issues ?? [],
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
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

function extractDiagram(item: DiagramTimelineItem): ArchitectureDiagram | null {
    const payload = asRecord(item.artifact.payload);
    const diagram = asRecord(payload?.diagram);
    if (diagram) return diagram as unknown as ArchitectureDiagram;
    const fallbackDiagram = asRecord(payload?.fallbackDiagram);
    return fallbackDiagram ? fallbackDiagram as unknown as ArchitectureDiagram : null;
}

function toEndpoint(item: DiagramTimelineItem): DiagramEvolutionEndpoint {
    return {
        version: item.version,
        responseId: item.responseId,
        artifactId: item.artifactId,
        rootResponseId: item.rootResponseId,
        ...(item.parentResponseId ? { parentResponseId: item.parentResponseId } : {}),
    };
}

function projectChanges(diff?: ArchitectureDiagramDiff): DiagramEvolutionChangeProjection {
    if (!diff) return emptyChanges();

    return {
        addedNodeIds: diff.addedNodes.map((change) => change.id),
        removedNodeIds: diff.removedNodes.map((change) => change.id),
        modifiedNodeIds: diff.modifiedNodes.map((change) => change.id),
        addedEdgeKeys: diff.addedEdges.map((change) => change.key),
        removedEdgeKeys: diff.removedEdges.map((change) => change.key),
    };
}

function buildSummaryFromDiff(
    mode: DiagramEvolutionSummaryMode,
    from: DiagramTimelineItem,
    to: DiagramTimelineItem,
    diff: ArchitectureDiagramDiff,
    diffSource: DiagramEvolutionDiffSource,
): DiagramEvolutionSummary {
    return {
        mode,
        from: toEndpoint(from),
        to: toEndpoint(to),
        diff,
        diffSummary: summarizeArchitectureDiff(diff),
        changes: projectChanges(diff),
        diffSource,
        usedStoredDiff: diffSource === 'stored_artifact_diff',
        recomputed: diffSource === 'computed',
        issues: [],
    };
}

function computeSummary(
    mode: DiagramEvolutionSummaryMode,
    from: DiagramTimelineItem,
    to: DiagramTimelineItem,
): DiagramEvolutionSummary {
    const previous = extractDiagram(from);
    const next = extractDiagram(to);
    if (!previous || !next) {
        return emptySummary(mode, {
            from,
            to,
            diffSource: 'unavailable',
            issues: ['comparison_diagram_missing'],
        });
    }

    const diff = diffArchitectureDiagrams(previous, next);
    if (!diff) {
        return emptySummary(mode, {
            from,
            to,
            diffSource: 'unavailable',
            issues: ['comparison_diff_unavailable'],
        });
    }

    return buildSummaryFromDiff(mode, from, to, diff, 'computed');
}

function resolveCurrentItem(timeline: DiagramTimeline, responseId?: string | null): DiagramTimelineItem | null {
    if (responseId === undefined) return timeline.activeItem ?? timeline.items[timeline.items.length - 1] ?? null;
    return responseId ? timeline.byResponseId.get(responseId) ?? null : null;
}

export function buildParentToCurrentEvolutionSummary(
    timeline: DiagramTimeline,
    currentResponseId?: string | null,
): DiagramEvolutionSummary {
    const current = resolveCurrentItem(timeline, currentResponseId);
    if (!current) {
        return emptySummary('parent_current', {
            issues: ['current_version_missing'],
        });
    }

    const parent = current.parentResponseId
        ? timeline.byResponseId.get(current.parentResponseId) ?? null
        : null;
    if (!parent) {
        return emptySummary('parent_current', {
            to: current,
            issues: ['parent_version_missing'],
        });
    }

    const storedDiff = extractStoredDiff(current);
    if (storedDiff) {
        return buildSummaryFromDiff('parent_current', parent, current, storedDiff, 'stored_artifact_diff');
    }

    return computeSummary('parent_current', parent, current);
}

export function buildRootToCurrentEvolutionSummary(
    timeline: DiagramTimeline,
    currentResponseId?: string | null,
): DiagramEvolutionSummary {
    const current = resolveCurrentItem(timeline, currentResponseId);
    if (!current) {
        return emptySummary('root_current', {
            issues: ['current_version_missing'],
        });
    }

    const root = timeline.items.find((item) => item.version === (current.rootVersion ?? 1)) ?? timeline.items[0] ?? null;
    if (!root) {
        return emptySummary('root_current', {
            to: current,
            issues: ['root_version_missing'],
        });
    }

    if (root.responseId === current.responseId) {
        return emptySummary('root_current', {
            from: root,
            to: current,
            issues: ['root_and_current_same_version'],
        });
    }

    return computeSummary('root_current', root, current);
}

export function compareDiagramTimelineVersions(
    timeline: DiagramTimeline,
    fromVersion: number,
    toVersion: number,
): DiagramEvolutionSummary {
    const from = timeline.items.find((item) => item.version === fromVersion) ?? null;
    const to = timeline.items.find((item) => item.version === toVersion) ?? null;

    if (!from || !to) {
        return emptySummary('version_pair', {
            from,
            to,
            diffSource: 'unavailable',
            issues: [
                ...(!from ? ['from_version_missing'] : []),
                ...(!to ? ['to_version_missing'] : []),
            ],
        });
    }

    if (from.responseId === to.responseId) {
        return emptySummary('version_pair', {
            from,
            to,
            issues: ['same_version'],
        });
    }

    return computeSummary('version_pair', from, to);
}
