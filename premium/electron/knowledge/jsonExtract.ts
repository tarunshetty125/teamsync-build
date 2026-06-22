// premium/electron/knowledge/jsonExtract.ts
// Robust JSON extraction from LLM responses

/**
 * Extract a JSON object from a raw LLM response string.
 * Handles markdown code fences (```json ... ```) and locates
 * the first balanced `{...}` block when a direct parse fails.
 */
export function extractJsonObject(raw: string): any {
  const trimmed = raw.trim();

  // Strip optional markdown code-fence wrappers
  let cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // Fast path: try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to brace-matching
  }

  // Find first '{' and match balanced braces
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('no JSON object in response');

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }

  throw new Error('unbalanced JSON braces');
}
