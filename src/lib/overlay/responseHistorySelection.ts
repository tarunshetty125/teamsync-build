export type ResponseSelectionMode = 'latest' | 'pinned';

export interface ResponseHistorySelectionInput {
  currentActiveResponseId: string | null;
  selectionMode: ResponseSelectionMode;
  previousLatestResponseId: string | null;
  nextLatestResponseId: string | null;
  responseIds: string[];
}

export interface ResponseHistorySelectionResult {
  activeResponseId: string | null;
  selectionMode: ResponseSelectionMode;
  latestResponseId: string | null;
}

export function resolveNextActiveResponseSelection({
  currentActiveResponseId,
  selectionMode,
  previousLatestResponseId,
  nextLatestResponseId,
  responseIds,
}: ResponseHistorySelectionInput): ResponseHistorySelectionResult {
  if (!nextLatestResponseId) {
    return {
      activeResponseId: null,
      selectionMode: 'latest',
      latestResponseId: null,
    };
  }

  const selectedStillExists = currentActiveResponseId
    ? responseIds.includes(currentActiveResponseId)
    : false;
  const latestChanged = previousLatestResponseId !== nextLatestResponseId;

  if (latestChanged && selectionMode === 'pinned' && selectedStillExists) {
    return {
      activeResponseId: currentActiveResponseId,
      selectionMode: 'pinned',
      latestResponseId: nextLatestResponseId,
    };
  }

  if (selectionMode === 'latest' || !selectedStillExists) {
    return {
      activeResponseId: nextLatestResponseId,
      selectionMode: 'latest',
      latestResponseId: nextLatestResponseId,
    };
  }

  return {
    activeResponseId: currentActiveResponseId,
    selectionMode,
    latestResponseId: nextLatestResponseId,
  };
}
