import type { ResponseOwnership } from './actionContextTypes';

export type V2ResponseArtifactKind = 'architecture' | 'mermaid';

export interface V2ResponseArtifact {
  id: string;
  responseId: string;
  parentResponseId?: string;
  rootResponseId: string;
  kind: V2ResponseArtifactKind;
  source: 'architecture_json' | 'mermaid' | 'markdown';
  createdAt: number;
  status: 'detected' | 'parsed_pending' | 'parsed' | 'parse_error' | 'fallback';
  payload?: unknown;
}

interface ArtifactSourceMessage {
  id: string;
  timestamp?: number;
  rootResponseId?: string;
  ownership?: Pick<ResponseOwnership, 'parentResponseId'>;
  artifacts?: V2ResponseArtifact[];
}

export function detectResponseArtifacts(
  message: ArtifactSourceMessage,
  text: string,
): V2ResponseArtifact[] | undefined {
  const rootResponseId = message.rootResponseId || message.ownership?.parentResponseId || message.id;
  const createdAt = message.timestamp ?? Date.now();
  const artifacts: V2ResponseArtifact[] = [];

  if (/```[ \t]*architecture_json\b/i.test(text) || (/"diagram"\s*:/i.test(text) && /architecture/i.test(text))) {
    artifacts.push({
      id: `${message.id}:architecture`,
      responseId: message.id,
      parentResponseId: message.ownership?.parentResponseId,
      rootResponseId,
      kind: 'architecture',
      source: 'architecture_json',
      createdAt,
      status: 'parsed_pending',
    });
  }

  if (/```[ \t]*mermaid\b/i.test(text) || /(?:^|\n)\s*(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph)\b/i.test(text)) {
    artifacts.push({
      id: `${message.id}:mermaid`,
      responseId: message.id,
      parentResponseId: message.ownership?.parentResponseId,
      rootResponseId,
      kind: 'mermaid',
      source: 'mermaid',
      createdAt,
      status: 'detected',
    });
  }

  return artifacts.length > 0 ? artifacts : message.artifacts;
}
