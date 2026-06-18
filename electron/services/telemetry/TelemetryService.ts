// electron/services/telemetry/TelemetryService.ts
// Local-first telemetry: JSONL append to userData/logs/telemetry.jsonl.
// Sanitizes all properties to strip secrets, API keys, transcript content.

import fs from 'fs';
import path from 'path';

const DEFAULT_FILE_NAME = 'telemetry.jsonl';

const REDACTED = '[REDACTED]';
const REMOVED = '[REMOVED]';

const SENSITIVE_KEY_RE =
  /(api[_-]?key|authorization|bearer|token|secret|password|credential|raw[_-]?(transcript|prompt|reference|content|query|resume|jd|persona|negotiation)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response|message)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|resume(text)?|persona(text)?|negotiation(text|script|context)?|jd(text|content)?|customcontext|customnotes|notes|note|answer(text)?|question(text)?|latestquestion|salary|compensation|content|text)$/i;

const REMOVE_VALUE_KEY_RE =
  /(raw[_-]?(transcript|prompt|reference|content|query|resume|jd|persona|negotiation)|transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|error(body|response)?|responsebody|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?|resume(text)?|persona(text)?|negotiation(text|script|context)?|jd(text|content)?|customcontext|customnotes|notes|note|answer(text)?|question(text)?|latestquestion|content|text)$/i;

const API_KEY_VALUE_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+\/=:-]{12,}/gi,
  /natively_sk_[A-Za-z0-9._-]+/gi,
  /sk-[A-Za-z0-9]{20,}/gi,
  /gsk_[A-Za-z0-9]{20,}/gi,
  /dg_[A-Za-z0-9]{20,}/gi,
  /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g,
];

function monotonicNow(): number {
  try {
    const p = globalThis.performance;
    if (p && typeof p.now === 'function') return p.now();
  } catch { /* fallback */ }
  return Date.now();
}

function redactString(value: string): string {
  let redacted = value;
  for (const pattern of API_KEY_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted;
}

function sanitizeObject(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return Number.isNaN(value as number) ? null : value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map(item => sanitizeObject(item, seen)).filter(item => item !== undefined);
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
        const sanitized = sanitizeObject(child, seen);
        if (sanitized !== undefined) output[key] = sanitized;
      }
    }
    return output;
  }
  return undefined;
}

export function sanitizeTelemetryProperties(properties: unknown): unknown {
  return sanitizeObject(properties, new WeakSet());
}

// ── TelemetrySpan ────────────────────────────────────────────────────────

export class TelemetrySpan {
  private startedAt: number;
  private ended = false;

  constructor(
    private service: TelemetryService,
    private name: string,
    private base: Record<string, any> = {},
  ) {
    this.startedAt = monotonicNow();
  }

  elapsedMs(): number {
    return Math.max(0, Math.round(monotonicNow() - this.startedAt));
  }

  end(extraProps?: Record<string, unknown>): number {
    if (this.ended) return 0;
    this.ended = true;
    const durationMs = this.elapsedMs();
    this.service.track({
      ...this.base,
      name: this.name,
      durationMs,
      properties: { ...this.base.properties ?? {}, ...extraProps ?? {} },
    });
    return durationMs;
  }

  endWith(status: string, extraProps?: Record<string, unknown>): number {
    if (this.ended) return 0;
    this.ended = true;
    const durationMs = this.elapsedMs();
    this.service.track({
      ...this.base,
      name: this.name,
      durationMs,
      status,
      properties: { ...this.base.properties ?? {}, ...extraProps ?? {} },
    });
    return durationMs;
  }
}

// ── TelemetryService ─────────────────────────────────────────────────────

export interface TelemetryConfig {
  enabled?: boolean;
  localEnabled?: boolean;
  logFilePath?: string;
  userDataPath?: string;
  sinks?: Array<{ name: string; enabled: boolean }>;
  debugMetadata?: Record<string, unknown> | null;
}

export interface TelemetryEvent {
  name: string;
  sessionId?: string;
  modeId?: string;
  provider?: string;
  durationMs?: number;
  status?: string;
  properties?: Record<string, unknown>;
}

export class TelemetryService {
  private enabled: boolean;
  private localEnabled: boolean;
  private logFilePath: string;
  private sinks: Array<{ name: string; enabled: boolean }>;
  private debugMetadata: Record<string, unknown> | null;

  constructor(config: TelemetryConfig = {}) {
    this.enabled = config.enabled !== false;
    this.localEnabled = config.localEnabled !== false;
    this.sinks = config.sinks ?? [];
    this.debugMetadata = config.debugMetadata ?? null;
    this.logFilePath = config.logFilePath ?? path.join(config.userDataPath ?? process.cwd(), 'logs', DEFAULT_FILE_NAME);
  }

  configure(config: TelemetryConfig): void {
    if (typeof config.enabled === 'boolean') this.enabled = config.enabled;
    if (typeof config.localEnabled === 'boolean') this.localEnabled = config.localEnabled;
    if (Array.isArray(config.sinks)) this.sinks = config.sinks;
    if (config.logFilePath) {
      this.logFilePath = config.logFilePath;
    } else if (config.userDataPath) {
      this.logFilePath = path.join(config.userDataPath, 'logs', DEFAULT_FILE_NAME);
    }
    if (config.debugMetadata !== undefined) this.debugMetadata = config.debugMetadata ?? null;
  }

  isEnabled(): boolean { return this.enabled; }
  getLogFilePath(): string { return this.logFilePath; }

  setDebugMetadata(metadata: Record<string, unknown> | null): void {
    this.debugMetadata = metadata;
  }

  record(name: string, properties?: Record<string, unknown>): void {
    this.track({ name, properties });
  }

  startSpan(name: string, base: Record<string, any> = {}): TelemetrySpan {
    return new TelemetrySpan(this, name, base);
  }

  track(input: TelemetryEvent): void {
    if (!this.enabled) return;
    try {
      const evDebug =
        input.properties?.debug && typeof input.properties.debug === 'object' && !Array.isArray(input.properties.debug)
          ? (input.properties.debug as Record<string, unknown>)
          : {};
      const mergedProps = this.debugMetadata
        ? { ...input.properties ?? {}, debug: { ...this.debugMetadata, ...evDebug } }
        : input.properties ?? {};

      const record: Record<string, unknown> = {
        name: String(input.name),
        timestamp: new Date().toISOString(),
        properties: sanitizeTelemetryProperties(mergedProps),
      };
      if (input.sessionId) record.sessionId = String(input.sessionId);
      if (input.modeId) record.modeId = String(input.modeId);
      if (input.provider) record.provider = String(input.provider);
      if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) record.durationMs = input.durationMs;
      if (input.status) record.status = String(input.status);

      if (this.localEnabled) {
        this.appendLocal(record);
      }
      // Remote sinks are a no-op placeholder
      for (const sink of this.sinks) {
        if (!sink.enabled || sink.name === 'local-jsonl') continue;
      }
    } catch { /* swallow telemetry errors */ }
  }

  private appendLocal(record: Record<string, unknown>): void {
    try {
      fs.mkdirSync(path.dirname(this.logFilePath), { recursive: true });
      fs.appendFileSync(this.logFilePath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch { /* swallow */ }
  }
}

/** Shared singleton instance — reconfigure after app.whenReady(). */
export const telemetryService = new TelemetryService();
