const SENSITIVE_BLOCKS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\[OCR_SCAN\][\s\S]*?\[OCR_SCAN_END\]/g,
    replacement: '[OCR_SCAN] [REDACTED_SCREEN_TEXT] [OCR_SCAN_END]',
  },
  {
    pattern: /\[SYSTEM_DESIGN_RAW_OUTPUT\][\s\S]*?\[SYSTEM_DESIGN_RAW_OUTPUT_END\]/g,
    replacement: '[SYSTEM_DESIGN_RAW_OUTPUT] [REDACTED_MODEL_OUTPUT] [SYSTEM_DESIGN_RAW_OUTPUT_END]',
  },
  {
    pattern: /(Transcript \((?:final|interim)\):\s*)"[^"]*"/gi,
    replacement: '$1"[REDACTED_TRANSCRIPT]"',
  },
  {
    pattern: /(\btext=)"[^"]*"/gi,
    replacement: '$1"[REDACTED_TEXT]"',
  },
];

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /(bearer\s+)[a-z0-9._~+/=-]+/gi, replacement: '$1[REDACTED_TOKEN]' },
  { pattern: /(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s]+/gi, replacement: '$1[REDACTED_API_KEY]' },
  { pattern: /(secret(?:AccessKey)?["']?\s*[:=]\s*["']?)[^"',\s]+/gi, replacement: '$1[REDACTED_SECRET]' },
  { pattern: /(token["']?\s*[:=]\s*["']?)[^"',\s]+/gi, replacement: '$1[REDACTED_TOKEN]' },
  { pattern: /(mongodb(?:\+srv)?:\/\/)[^\s"']+/gi, replacement: '$1[REDACTED_MONGO_URI]' },
];

const CONTENT_FIELD_PATTERN = /("(?:text|transcript|content|summary|raw|final|question|answer)"\s*:\s*)"([^"]{24,})"/gi;

export function redactForPersistentLog(input: string): string {
  let output = input;
  for (const { pattern, replacement } of SENSITIVE_BLOCKS) {
    output = output.replace(pattern, replacement);
  }
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  output = output.replace(CONTENT_FIELD_PATTERN, '$1"[REDACTED_CONTENT]"');
  return output;
}

export function stringifyForPersistentLog(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Unserializable Object]';
    }
  }
  return String(value);
}
