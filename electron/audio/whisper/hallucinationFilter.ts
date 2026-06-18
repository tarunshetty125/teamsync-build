// electron/audio/whisper/hallucinationFilter.ts
// Filters known Whisper hallucination patterns (phantom subtitles,
// music tags, ultra-short nonsense, bracket tokens).

const EXACT_BLOCKS = new Set([
  '[music]', '[applause]', '[inaudible]', '(music)',
  'thank you for watching', 'thanks for watching',
  'you', 'bye', '...', '.',
]);

const BRACKET_TOKEN_RE = /^\[.*\]$/;

/** Returns empty string if the text is a known hallucination, trimmed text otherwise. */
export function filterHallucination(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return '';
  const lower = trimmed.toLowerCase();
  if (EXACT_BLOCKS.has(lower)) return '';
  if (BRACKET_TOKEN_RE.test(trimmed)) return '';
  return trimmed;
}
