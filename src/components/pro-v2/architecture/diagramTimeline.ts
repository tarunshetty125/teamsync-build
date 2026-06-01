import type { V2ResponseArtifact } from '../../../lib/overlay/responseArtifacts';
import type { ArchitectureDiagramDiff } from './architectureDiff';

export interface DiagramTimelineMessage {
    id: string;
    timestamp?: number;
    rootResponseId?: string;
    ownership?: {
        parentResponseId?: string;
    };
    artifacts?: V2ResponseArtifact[];
}

export interface DiagramTimelineDiffSummary {
    addedNodes: number;
    removedNodes: number;
    modifiedNodes: number;
    addedEdges: number;
    removedEdges: number;
    totalChanges: number;
    hasChanges: boolean;
}

export interface DiagramTimelineItem {
    version: number;
    responseId: string;
    parentResponseId?: string;
    parentVersion?: number;
    rootResponseId: string;
    rootVersion?: number;
    artifactId: string;
    createdAt?: number;
    status: V2ResponseArtifact['status'];
    source: V2ResponseArtifact['source'];
    artifact: V2ResponseArtifact;
    hasDiff: boolean;
    diffSummary: DiagramTimelineDiffSummary;
}

export interface DiagramTimeline {
    rootResponseId: string | null;
    items: DiagramTimelineItem[];
    byResponseId: Map<string, DiagramTimelineItem>;
    byArtifactId: Map<string, DiagramTimelineItem>;
    activeItem: DiagramTimelineItem | null;
    activeVersion: number | null;
    activeVersionCount: number;
}

const EMPTY_DIFF_SUMMARY: DiagramTimelineDiffSummary = Object.freeze({
    addedNodes: 0,
    removedNodes: 0,
    modifiedNodes: 0,
    addedEdges: 0,
    removedEdges: 0,
    totalChanges: 0,
    hasChanges: false,
});

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function extractArchitectureArtifact(message: DiagramTimelineMessage): V2ResponseArtifact | undefined {
    return message.artifacts?.find((artifact) => artifact.kind === 'architecture');
}

function extractDiff(payload: unknown): ArchitectureDiagramDiff | undefined {
    const record = asRecord(payload);
    const diff = asRecord(record?.diff);
    if (!diff) return undefined;

    return {
        addedNodes: asArray(diff.addedNodes) as ArchitectureDiagramDiff['addedNodes'],
        removedNodes: asArray(diff.removedNodes) as ArchitectureDiagramDiff['removedNodes'],
        modifiedNodes: asArray(diff.modifiedNodes) as ArchitectureDiagramDiff['modifiedNodes'],
        addedEdges: asArray(diff.addedEdges) as ArchitectureDiagramDiff['addedEdges'],
        removedEdges: asArray(diff.removedEdges) as ArchitectureDiagramDiff['removedEdges'],
    };
}

export function summarizeArchitectureDiff(diff?: ArchitectureDiagramDiff): DiagramTimelineDiffSummary {
    if (!diff) return EMPTY_DIFF_SUMMARY;

    const summary = {
        addedNodes: diff.addedNodes.length,
        removedNodes: diff.removedNodes.length,
        modifiedNodes: diff.modifiedNodes.length,
        addedEdges: diff.addedEdges.length,
        removedEdges: diff.removedEdges.length,
    };
    const totalChanges =
        summary.addedNodes
        + summary.removedNodes
        + summary.modifiedNodes
        + summary.addedEdges
        + summary.removedEdges;

    return {
        ...summary,
        totalChanges,
        hasChanges: totalChanges > 0,
    };
}

export function buildDiagramTimeline(
    activeResponseChain: DiagramTimelineMessage[],
    activeResponseId?: string | null,
): DiagramTimeline {
    const items: DiagramTimelineItem[] = [];

    activeResponseChain.forEach((message) => {
        const artifact = extractArchitectureArtifact(message);
        if (!artifact) return;

        const diff = extractDiff(artifact.payload);
        const parentResponseId = artifact.parentResponseId ?? message.ownership?.parentResponseId;
        const rootResponseId = artifact.rootResponseId || message.rootResponseId || message.id;

        items.push({
            version: items.length + 1,
            responseId: message.id,
            parentResponseId,
            rootResponseId,
            artifactId: artifact.id,
            createdAt: artifact.createdAt ?? message.timestamp,
            status: artifact.status,
            source: artifact.source,
            artifact,
            hasDiff: Boolean(diff),
            diffSummary: summarizeArchitectureDiff(diff),
        });
    });

    const byResponseId = new Map(items.map((item) => [item.responseId, item]));
    const byArtifactId = new Map(items.map((item) => [item.artifactId, item]));
    const rootResponseId = items[0]?.rootResponseId ?? null;

    const itemsWithResolvedVersions = items.map((item) => {
        const parentVersion = item.parentResponseId
            ? byResponseId.get(item.parentResponseId)?.version
            : undefined;
        const rootVersion = byResponseId.get(item.rootResponseId)?.version ?? (item.rootResponseId === rootResponseId ? 1 : undefined);
        if (parentVersion === item.parentVersion && rootVersion === item.rootVersion) return item;
        return {
            ...item,
            ...(parentVersion ? { parentVersion } : {}),
            ...(rootVersion ? { rootVersion } : {}),
        };
    });

    const resolvedByResponseId = new Map(itemsWithResolvedVersions.map((item) => [item.responseId, item]));
    const resolvedByArtifactId = new Map(itemsWithResolvedVersions.map((item) => [item.artifactId, item]));
    const activeItem = activeResponseId === undefined
        ? itemsWithResolvedVersions[itemsWithResolvedVersions.length - 1] ?? null
        : activeResponseId
            ? resolvedByResponseId.get(activeResponseId) ?? null
            : null;

    return {
        rootResponseId,
        items: itemsWithResolvedVersions,
        byResponseId: resolvedByResponseId,
        byArtifactId: resolvedByArtifactId,
        activeItem,
        activeVersion: activeItem?.version ?? null,
        activeVersionCount: itemsWithResolvedVersions.length,
    };
}
