import type { ArchitectureDiagram } from './architectureSchema';
import type { DiagramTimeline, DiagramTimelineItem } from './diagramTimeline';

export const ARCHITECTURE_GUARDRAIL_NODE_CAP = 60;
export const ARCHITECTURE_GUARDRAIL_EDGE_CAP = 90;
export const ARCHITECTURE_GUARDRAIL_WARNING_NODE_COUNT = 20;
export const ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT = 35;

export type DiagramGuardrailStatus =
    | 'supported'
    | 'warning'
    | 'truncated'
    | 'oversized';

export type DiagramGuardrailLayoutDensity =
    | 'standard'
    | 'dense'
    | 'very_dense';

export type DiagramGuardrailDiagramSource =
    | 'diagram'
    | 'fallbackDiagram'
    | 'missing';

export interface DiagramGuardrailCounts {
    nodes: number;
    edges: number;
}

export interface DiagramGuardrailParserCapAwareness {
    nodeCap: number;
    edgeCap: number;
    nodeCountAtCap: boolean;
    edgeCountAtCap: boolean;
    remainingNodeCapacity: number;
    remainingEdgeCapacity: number;
    parserIssues: string[];
    truncationIssues: string[];
}

export interface DiagramGuardrailLayoutAwareness {
    density: DiagramGuardrailLayoutDensity;
    warningNodeCount: number;
    oversizedNodeCount: number;
}

export interface DiagramGuardrailComparisonSuitability {
    suitable: boolean;
    parentCurrent: boolean;
    rootCurrent: boolean;
    arbitraryVersion: boolean;
    requiresLazyDiff: boolean;
    issues: string[];
}

export interface DiagramGuardrailTimelineSuitability {
    suitable: boolean;
    versionCount: number;
    activeVersion: number | null;
    currentVersion: number | null;
    rootVersion: number | null;
    parentVersion: number | null;
    hasRootVersion: boolean;
    hasParentVersion: boolean;
    lineageGap: boolean;
    issues: string[];
}

export interface DiagramGuardrailReadModel {
    status: DiagramGuardrailStatus;
    supported: boolean;
    warning: boolean;
    truncated: boolean;
    oversized: boolean;
    responseId: string | null;
    artifactId: string | null;
    diagramSource: DiagramGuardrailDiagramSource;
    counts: DiagramGuardrailCounts;
    parserCaps: DiagramGuardrailParserCapAwareness;
    layout: DiagramGuardrailLayoutAwareness;
    comparisonSuitability: DiagramGuardrailComparisonSuitability;
    timelineSuitability: DiagramGuardrailTimelineSuitability;
    issues: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function emptyCounts(): DiagramGuardrailCounts {
    return {
        nodes: 0,
        edges: 0,
    };
}

function extractPayload(item: DiagramTimelineItem | null): Record<string, unknown> | null {
    return asRecord(item?.artifact.payload);
}

function extractDiagram(item: DiagramTimelineItem | null): {
    diagram: ArchitectureDiagram | null;
    source: DiagramGuardrailDiagramSource;
} {
    const payload = extractPayload(item);
    const diagram = asRecord(payload?.diagram);
    if (diagram) {
        return {
            diagram: diagram as unknown as ArchitectureDiagram,
            source: 'diagram',
        };
    }

    const fallbackDiagram = asRecord(payload?.fallbackDiagram);
    if (fallbackDiagram) {
        return {
            diagram: fallbackDiagram as unknown as ArchitectureDiagram,
            source: 'fallbackDiagram',
        };
    }

    return {
        diagram: null,
        source: 'missing',
    };
}

function extractParserIssues(item: DiagramTimelineItem | null): string[] {
    const payload = extractPayload(item);
    return asStringArray(payload?.issues);
}

function hasStoredDiff(item: DiagramTimelineItem | null): boolean {
    const payload = extractPayload(item);
    return Boolean(asRecord(payload?.diff));
}

function resolveCurrentItem(timeline: DiagramTimeline, responseId?: string | null): DiagramTimelineItem | null {
    if (responseId === undefined) return timeline.activeItem ?? timeline.items[timeline.items.length - 1] ?? null;
    return responseId ? timeline.byResponseId.get(responseId) ?? null : null;
}

function getLayoutDensity(nodeCount: number): DiagramGuardrailLayoutDensity {
    if (nodeCount >= ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT) return 'very_dense';
    if (nodeCount >= ARCHITECTURE_GUARDRAIL_WARNING_NODE_COUNT) return 'dense';
    return 'standard';
}

function buildParserCapAwareness(
    counts: DiagramGuardrailCounts,
    parserIssues: string[],
): DiagramGuardrailParserCapAwareness {
    const truncationIssues = parserIssues.filter((issue) => issue.includes('truncated'));

    return {
        nodeCap: ARCHITECTURE_GUARDRAIL_NODE_CAP,
        edgeCap: ARCHITECTURE_GUARDRAIL_EDGE_CAP,
        nodeCountAtCap: counts.nodes >= ARCHITECTURE_GUARDRAIL_NODE_CAP,
        edgeCountAtCap: counts.edges >= ARCHITECTURE_GUARDRAIL_EDGE_CAP,
        remainingNodeCapacity: Math.max(0, ARCHITECTURE_GUARDRAIL_NODE_CAP - counts.nodes),
        remainingEdgeCapacity: Math.max(0, ARCHITECTURE_GUARDRAIL_EDGE_CAP - counts.edges),
        parserIssues,
        truncationIssues,
    };
}

function buildTimelineSuitability(
    timeline: DiagramTimeline,
    item: DiagramTimelineItem | null,
): DiagramGuardrailTimelineSuitability {
    const issues: string[] = [];
    const hasRootVersion = Boolean(item?.rootVersion);
    const hasParentVersion = Boolean(item?.parentVersion);
    const lineageGap = Boolean(item?.parentResponseId && !item.parentVersion);

    if (timeline.items.length === 0) issues.push('timeline_empty');
    if (!item) issues.push('current_version_missing');
    if (item && !hasRootVersion) issues.push('root_version_missing');
    if (lineageGap) issues.push('parent_version_missing');

    return {
        suitable: Boolean(item && timeline.items.length > 0 && !lineageGap && hasRootVersion),
        versionCount: timeline.items.length,
        activeVersion: timeline.activeVersion,
        currentVersion: item?.version ?? null,
        rootVersion: item?.rootVersion ?? null,
        parentVersion: item?.parentVersion ?? null,
        hasRootVersion,
        hasParentVersion,
        lineageGap,
        issues,
    };
}

function buildComparisonSuitability(args: {
    timeline: DiagramTimeline;
    item: DiagramTimelineItem | null;
    supported: boolean;
    truncated: boolean;
    oversized: boolean;
}): DiagramGuardrailComparisonSuitability {
    const { timeline, item, supported, truncated, oversized } = args;
    const issues: string[] = [];
    const parentCurrent = Boolean(item?.parentResponseId && item.parentVersion);
    const rootCurrent = Boolean(item && item.rootVersion && item.rootVersion !== item.version);
    const arbitraryVersion = timeline.items.length >= 2;

    if (!supported) issues.push('diagram_missing');
    if (truncated) issues.push('diagram_truncated_by_parser');
    if (oversized) issues.push('diagram_oversized_for_comparison');
    if (!parentCurrent) issues.push('parent_current_unavailable');
    if (!rootCurrent) issues.push('root_current_unavailable');
    if (!arbitraryVersion) issues.push('version_pair_unavailable');

    return {
        suitable: supported && !truncated && !oversized && (parentCurrent || rootCurrent || arbitraryVersion),
        parentCurrent,
        rootCurrent,
        arbitraryVersion,
        requiresLazyDiff: Boolean(item && !hasStoredDiff(item) && (parentCurrent || rootCurrent || arbitraryVersion)),
        issues,
    };
}

function resolveStatus(args: {
    supported: boolean;
    warning: boolean;
    truncated: boolean;
    oversized: boolean;
}): DiagramGuardrailStatus {
    if (args.truncated) return 'truncated';
    if (args.oversized) return 'oversized';
    if (args.warning || !args.supported) return 'warning';
    return 'supported';
}

export function buildDiagramGuardrails(
    timeline: DiagramTimeline,
    responseId?: string | null,
): DiagramGuardrailReadModel {
    const item = resolveCurrentItem(timeline, responseId);
    const { diagram, source } = extractDiagram(item);
    const parserIssues = extractParserIssues(item);
    const counts = diagram
        ? {
            nodes: diagram.nodes.length,
            edges: diagram.edges.length,
        }
        : emptyCounts();
    const parserCaps = buildParserCapAwareness(counts, parserIssues);
    const supported = Boolean(diagram && counts.nodes > 0);
    const truncated = parserCaps.truncationIssues.length > 0;
    const oversized = Boolean(diagram && (
        counts.nodes >= ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT
        || counts.edges >= ARCHITECTURE_GUARDRAIL_EDGE_CAP
    ));
    const warning = Boolean(
        source === 'fallbackDiagram'
        || parserIssues.length > 0
        || (diagram && counts.nodes >= ARCHITECTURE_GUARDRAIL_WARNING_NODE_COUNT)
    );
    const status = resolveStatus({
        supported,
        warning,
        truncated,
        oversized,
    });
    const timelineSuitability = buildTimelineSuitability(timeline, item);
    const comparisonSuitability = buildComparisonSuitability({
        timeline,
        item,
        supported,
        truncated,
        oversized,
    });
    const issues = [
        ...(!item ? ['current_version_missing'] : []),
        ...(!diagram ? ['diagram_missing'] : []),
        ...(source === 'fallbackDiagram' ? ['fallback_diagram_used'] : []),
        ...parserIssues,
        ...comparisonSuitability.issues,
        ...timelineSuitability.issues,
    ];

    return {
        status,
        supported,
        warning,
        truncated,
        oversized,
        responseId: item?.responseId ?? null,
        artifactId: item?.artifactId ?? null,
        diagramSource: source,
        counts,
        parserCaps,
        layout: {
            density: getLayoutDensity(counts.nodes),
            warningNodeCount: ARCHITECTURE_GUARDRAIL_WARNING_NODE_COUNT,
            oversizedNodeCount: ARCHITECTURE_GUARDRAIL_OVERSIZED_NODE_COUNT,
        },
        comparisonSuitability,
        timelineSuitability,
        issues: [...new Set(issues)],
    };
}
