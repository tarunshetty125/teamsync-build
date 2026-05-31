import type { ResponseOwnership } from '../../../lib/overlay/actionContextTypes';
import {
    detectResponseArtifacts,
    type V2ResponseArtifact,
} from '../../../lib/overlay/responseArtifacts';
import type { ArchitectureDiagram } from './architectureSchema';
import {
    parseArchitectureResponse,
    type ArchitectureParseState,
} from './architectureParser';
import {
    diffArchitectureDiagrams,
    type ArchitectureDiagramDiff,
} from './architectureDiff';

interface DiagramArtifactMessage {
    id: string;
    timestamp?: number;
    rootResponseId?: string;
    ownership?: Pick<ResponseOwnership, 'parentResponseId'>;
    artifacts?: V2ResponseArtifact[];
}

export interface ArchitectureResponseArtifactPayload {
    state: ArchitectureParseState;
    diagram: ArchitectureDiagram | null;
    fallbackDiagram: ArchitectureDiagram | null;
    issues: string[];
    diff?: ArchitectureDiagramDiff;
}

function getRootResponseId(message: DiagramArtifactMessage): string {
    return message.rootResponseId || message.id;
}

function resolveArchitectureSource(text: string, hasMermaidChart: boolean): V2ResponseArtifact['source'] {
    if (/```[ \t]*architecture_json\b/i.test(text) || /"diagram"\s*:/i.test(text)) {
        return 'architecture_json';
    }
    if (hasMermaidChart) return 'mermaid';
    return 'markdown';
}

function resolveArchitectureStatus(
    state: ArchitectureParseState,
    diagram: ArchitectureDiagram | null,
    fallbackDiagram: ArchitectureDiagram | null,
): V2ResponseArtifact['status'] {
    if (diagram) return 'parsed';
    if (fallbackDiagram) return 'fallback';
    if (state === 'invalid') return 'parse_error';
    return 'parsed_pending';
}

function extractArchitectureDiagram(artifact?: V2ResponseArtifact): ArchitectureDiagram | null {
    const payload = artifact?.payload;
    if (!payload || typeof payload !== 'object') return null;
    const diagram = (payload as { diagram?: unknown }).diagram;
    if (!diagram || typeof diagram !== 'object') return null;
    return diagram as ArchitectureDiagram;
}

function findParentArchitectureDiagram(
    messages: DiagramArtifactMessage[],
    parentResponseId?: string,
): ArchitectureDiagram | null {
    if (!parentResponseId) return null;
    const parent = messages.find((message) => message.id === parentResponseId);
    const artifact = parent?.artifacts?.find((item) => item.kind === 'architecture');
    return extractArchitectureDiagram(artifact);
}

export function buildArchitectureResponseArtifacts(
    message: DiagramArtifactMessage,
    text: string,
    messages: DiagramArtifactMessage[] = [],
): V2ResponseArtifact[] | undefined {
    const detectedArtifacts = detectResponseArtifacts(message, text) ?? [];
    const nonArchitectureArtifacts = detectedArtifacts.filter((artifact) => artifact.kind !== 'architecture');
    const parsed = parseArchitectureResponse(text, { isStreaming: false });
    const shouldPersistArchitecture =
        parsed.state !== 'missing'
        || Boolean(parsed.diagram)
        || Boolean(parsed.fallbackDiagram)
        || detectedArtifacts.some((artifact) => artifact.kind === 'architecture');

    if (!shouldPersistArchitecture) {
        return nonArchitectureArtifacts.length > 0 ? nonArchitectureArtifacts : message.artifacts;
    }

    const parentResponseId = message.ownership?.parentResponseId;
    const parentDiagram = findParentArchitectureDiagram(messages, parentResponseId);
    const diff = diffArchitectureDiagrams(parentDiagram, parsed.diagram);
    const payload: ArchitectureResponseArtifactPayload = {
        state: parsed.state,
        diagram: parsed.diagram,
        fallbackDiagram: parsed.fallbackDiagram,
        issues: parsed.issues,
        ...(diff ? { diff } : {}),
    };

    const architectureArtifact: V2ResponseArtifact = {
        id: `${message.id}:architecture`,
        responseId: message.id,
        parentResponseId,
        rootResponseId: getRootResponseId(message),
        kind: 'architecture',
        source: resolveArchitectureSource(text, Boolean(parsed.mermaidChart)),
        createdAt: message.timestamp ?? Date.now(),
        status: resolveArchitectureStatus(parsed.state, parsed.diagram, parsed.fallbackDiagram),
        payload,
    };

    return [architectureArtifact, ...nonArchitectureArtifacts];
}
