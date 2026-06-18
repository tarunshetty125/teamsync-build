// electron/utils/rollingTranscriptState.ts
// Pure-function helpers for merging partial & final STT segments into a
// rolling-transcript string displayed in the overlay. Uses a middle-dot
// separator ("  ·  ") to delimit committed (final) segments.

const FINAL_SEPARATOR = '  \u00B7  ';

/** Normalize text for fuzzy comparison — strips punctuation & collapses whitespace. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\p{Pd}]+/gu, ' ')
    .replace(/[\p{P}\p{S}]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Index of the last committed-segment separator. */
export function lastFinalSeparatorIndex(prev: string): number {
  return prev.lastIndexOf(FINAL_SEPARATOR);
}

/** Everything before (and including) the last separator. */
export function committedRollingPrefix(prev: string): string {
  const idx = lastFinalSeparatorIndex(prev);
  return idx >= 0 ? prev.substring(0, idx + FINAL_SEPARATOR.length) : '';
}

/** The in-progress tail after the last separator. */
export function inProgressRollingTail(prev: string): string {
  const idx = lastFinalSeparatorIndex(prev);
  return idx >= 0 ? prev.substring(idx + FINAL_SEPARATOR.length) : prev;
}

/**
 * Merge a partial (non-final) STT segment into the rolling transcript.
 * - Replaces the in-progress tail when the partial overlaps or extends it.
 * - Appends as a new segment when disjoint.
 */
export function mergeRollingTranscriptPartial(prev: string, partialText: string): string {
  const text = partialText.trim();
  if (!text) return prev;

  const prefix = committedRollingPrefix(prev);
  const inProgress = inProgressRollingTail(prev);
  const normText = norm(text);
  const normInProgress = norm(inProgress);

  if (!prefix && inProgress && (normText.startsWith(normInProgress) || normInProgress.startsWith(normText))) {
    return text;
  }
  if (prefix && (normText.startsWith(normInProgress) || normInProgress.startsWith(normText) || !inProgress)) {
    return prefix + text;
  }
  if (prev) {
    return prev + FINAL_SEPARATOR + text;
  }
  return text;
}

/**
 * Merge a final (committed) STT segment into the rolling transcript.
 * - Replaces the in-progress tail when the final overlaps it.
 * - Appends as a new committed segment when disjoint.
 */
export function mergeRollingTranscriptFinal(prev: string, finalText: string): string {
  const text = finalText.trim();
  if (!text) return prev;

  const prefix = committedRollingPrefix(prev);
  const inProgress = inProgressRollingTail(prev);
  const normText = norm(text);
  const normInProgress = norm(inProgress);

  if (inProgress && (normText.startsWith(normInProgress) || normInProgress.startsWith(normText))) {
    return prefix + text;
  }
  if (norm(inProgress).endsWith(normText) && norm(prev).endsWith(normText)) {
    return prev;
  }
  return prev ? prev + FINAL_SEPARATOR + text : text;
}
