import type { ResponseOwnership } from './actionContextTypes';
import type { V2ResponseArtifact } from './responseArtifacts';

export interface ResponseHistoryMessage {
  id: string;
  role: string;
  rootResponseId?: string;
  ownership?: ResponseOwnership;
  artifacts?: V2ResponseArtifact[];
}

export function capResponseHistoryMessages<T extends ResponseHistoryMessage>(
  messages: T[],
  maxSystemResponses: number,
): T[] {
  const systemIndexes: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'system') systemIndexes.push(index);
  });

  if (systemIndexes.length <= maxSystemResponses) return messages;

  const firstKeptSystemIndex = systemIndexes[systemIndexes.length - maxSystemResponses];
  return sanitizeCappedResponseHistory(messages.slice(firstKeptSystemIndex));
}

export function sanitizeCappedResponseHistory<T extends ResponseHistoryMessage>(messages: T[]): T[] {
  const systemIds = new Set(
    messages
      .filter((message) => message.role === 'system')
      .map((message) => message.id),
  );
  const rootById = new Map<string, string>();

  return messages.map((message) => {
    if (message.role !== 'system') return message;

    const rawParentId = message.ownership?.parentResponseId;
    const parentResponseId = rawParentId && systemIds.has(rawParentId)
      ? rawParentId
      : undefined;
    const rootResponseId = parentResponseId
      ? rootById.get(parentResponseId) ?? parentResponseId
      : message.id;

    rootById.set(message.id, rootResponseId);
    let artifactsChanged = false;
    const artifacts = message.artifacts?.map((artifact) => {
      if (
        artifact.parentResponseId === parentResponseId
        && artifact.rootResponseId === rootResponseId
      ) {
        return artifact;
      }

      artifactsChanged = true;
      return {
        ...artifact,
        parentResponseId,
        rootResponseId,
      };
    });

    if (
      message.rootResponseId === rootResponseId
      && message.ownership?.parentResponseId === parentResponseId
      && !artifactsChanged
    ) {
      return message;
    }

    const ownership = message.ownership
      ? { ...message.ownership, parentResponseId }
      : undefined;

    return {
      ...message,
      rootResponseId,
      ...(ownership ? { ownership } : {}),
      ...(artifacts ? { artifacts } : {}),
    };
  });
}
