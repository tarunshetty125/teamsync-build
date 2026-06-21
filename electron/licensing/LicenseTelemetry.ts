/**
 * LicenseTelemetry — Privacy-safe local ring buffer for license events.
 *
 * Security decisions:
 * - No PII stored — only device hash, app version, tier, timestamps, event types.
 * - Ring buffer caps at 200 events to bound disk usage.
 * - Events are uploaded to the server only during successful license syncs.
 * - After successful upload, the buffer is cleared.
 * - All writes are atomic (tmp + rename) to prevent corruption.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type TelemetryEventType =
  | 'activation'
  | 'revocation'
  | 'tamper'
  | 'sync_failure'
  | 'clock_rollback'
  | 'downgrade'
  | 'offline_grace_started'
  | 'offline_grace_expired';

export interface TelemetryEvent {
  event: TelemetryEventType;
  timestamp: string;
  deviceIdHash: string;
  appVersion: string;
  tier: string;
  /** Optional numeric metric (e.g. sync latency in ms, clock drift in ms) */
  metricMs?: number;
}

const MAX_EVENTS = 200;
const TELEMETRY_FILE = 'license-telemetry.json';

export class LicenseTelemetry {
  private static instance: LicenseTelemetry | null = null;
  private events: TelemetryEvent[] = [];
  private readonly filePath: string;
  private deviceIdHash: string = '';

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(app.getPath('userData'), TELEMETRY_FILE);
    this.load();
  }

  static getInstance(): LicenseTelemetry {
    if (!LicenseTelemetry.instance) {
      LicenseTelemetry.instance = new LicenseTelemetry();
    }
    return LicenseTelemetry.instance;
  }

  /** Set the hashed device ID once at startup. Never store the raw ID. */
  setDeviceIdHash(rawDeviceId: string): void {
    this.deviceIdHash = crypto.createHash('sha256').update(rawDeviceId).digest('hex').slice(0, 16);
  }

  /**
   * Record a telemetry event into the ring buffer.
   * If the buffer exceeds MAX_EVENTS, oldest events are dropped.
   */
  record(event: TelemetryEventType, tier: string, metricMs?: number): void {
    const entry: TelemetryEvent = {
      event,
      timestamp: new Date().toISOString(),
      deviceIdHash: this.deviceIdHash,
      appVersion: app.getVersion?.() || 'unknown',
      tier,
      ...(metricMs !== undefined ? { metricMs } : {}),
    };

    this.events.push(entry);

    // Ring buffer: drop oldest events beyond cap
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    this.persist();
  }

  /**
   * Drain the buffer for upload during a successful sync.
   * Returns a copy of all events and clears the buffer.
   * If upload fails, caller should call `restore(events)` to put them back.
   */
  drain(): TelemetryEvent[] {
    const drained = [...this.events];
    this.events = [];
    this.persist();
    return drained;
  }

  /**
   * Restore events that failed to upload back into the buffer.
   */
  restore(events: TelemetryEvent[]): void {
    this.events = [...events, ...this.events].slice(-MAX_EVENTS);
    this.persist();
  }

  /** Get current buffer size (for diagnostics) */
  getCount(): number {
    return this.events.length;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (Array.isArray(raw)) {
        this.events = raw.slice(-MAX_EVENTS);
      }
    } catch {
      // Corrupted telemetry is non-fatal — start fresh
      this.events = [];
    }
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      const json = JSON.stringify(this.events);
      fs.writeFileSync(tmpPath, json);
      // Verify write integrity before atomic rename
      const readBack = fs.readFileSync(tmpPath, 'utf8');
      if (readBack !== json) {
        fs.unlinkSync(tmpPath);
        return;
      }
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      // Telemetry persistence failure is non-fatal
    }
  }
}
