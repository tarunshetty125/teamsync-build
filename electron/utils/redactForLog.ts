// electron/utils/redactForLog.ts
// Log redaction utilities — strips API keys, secrets, JWT tokens, and
// sensitive field values before writing to console / telemetry.

const REDACTED = '[REDACTED]';
const REMOVED = '[REMOVED]';
const MAX_PREVIEW_LEN = 120;

/** Regex matching object keys whose values must be fully redacted. */
const SENSITIVE_KEY_RE =
  /(api[_-]?key|authorization|bearer|token|secret|password|credential|raw[_-]?(transcript|prompt|reference|content|query)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response|message)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|cookie|set[_-]?cookie|signature|x[_-]?api[_-]?key|x[_-]?trial[_-]?token|x[_-]?natively[_-]?key)$/i;

/** Regex matching object keys whose values should be entirely removed. */
const REMOVE_VALUE_KEY_RE =
  /(raw[_-]?(transcript|prompt|reference|content|query)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|base64|audio[_-]?data)$/i;

/** Patterns that match secret-shaped values inside arbitrary strings. */
const VALUE_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  { regex: /Bearer\s+[A-Za-z0-9._~+\/=:-]{12,}/gi, replacement: 'Bearer [REDACTED]' },
  { regex: /natively_sk_[A-Za-z0-9._-]+/gi, replacement: REDACTED },
  { regex: /sk-[A-Za-z0-9]{20,}/gi, replacement: REDACTED },
  { regex: /gsk_[A-Za-z0-9]{20,}/gi, replacement: REDACTED },
  { regex: /dg_[A-Za-z0-9]{20,}/gi, replacement: REDACTED },
  { regex: /AIza[A-Za-z0-9_-]{20,}/g, replacement: REDACTED },
  { regex: /sk-ant-api03-[A-Za-z0-9_-]{20,}/g, replacement: REDACTED },
  // JWT-shaped triple-base64 sequences (header.payload.signature)
  { regex: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replacement: REDACTED },
];

/** Redact an array of console-log–style arguments into a single safe string. */
export function redactForLog(args: unknown[]): string {
  return args.map(arg => formatOne(arg)).join(' ');
}

/** Recursively sanitize a single value (for structured telemetry payloads). */
export function redactValue(value: unknown): unknown {
  return sanitize(value, new WeakSet());
}

// ── Internal helpers ─────────────────────────────────────────────────────

function formatOne(arg: unknown): string {
  if (arg instanceof Error) {
    const base = arg.stack || arg.message || 'Error';
    return scrubString(base);
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(sanitize(arg, new WeakSet()));
    } catch {
      return '[Unserializable]';
    }
  }
  if (typeof arg === 'string') return scrubString(arg);
  if (typeof arg === 'bigint') return arg.toString();
  if (typeof arg === 'undefined') return 'undefined';
  return String(arg);
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubString(value).slice(0, MAX_PREVIEW_LEN);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return Number.isNaN(value as number) ? null : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message ?? ''),
      stack: scrubString(value.stack ?? ''),
    };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map(item => sanitize(item, seen)).filter(item => item !== undefined);
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (REMOVE_VALUE_KEY_RE.test(key)) {
        output[key] = REMOVED;
      } else if (SENSITIVE_KEY_RE.test(key)) {
        output[key] = REDACTED;
      } else {
        const sanitized = sanitize(child, seen);
        if (sanitized !== undefined) output[key] = sanitized;
      }
    }
    return output;
  }
  return undefined;
}

function scrubString(value: string): string {
  let scrubbed = value;
  for (const { regex, replacement } of VALUE_PATTERNS) {
    scrubbed = scrubbed.replace(regex, replacement);
  }
  return scrubbed;
}
