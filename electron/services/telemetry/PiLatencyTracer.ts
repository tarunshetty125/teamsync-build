// electron/services/telemetry/PiLatencyTracer.ts
// Per-request latency tracer for the LLM pipeline ("PI" = Pipeline Intelligence).
// Records milestones with elapsed-from-start, emits to TelemetryService,
// and prints a detailed breakdown when MEASURE_LATENCY=true.

import { telemetryService } from './TelemetryService';

function monotonicNow(): number {
  try {
    const p = globalThis.performance;
    if (p && typeof p.now === 'function') return p.now();
  } catch { /* fallback */ }
  return Date.now();
}

export interface PiLatencyTraceInit {
  source: string;
  sessionId?: string;
  modeId?: string;
  requestId?: string;
}

export class PiLatencyTrace {
  private t0: number;
  private source: string;
  private sessionId?: string;
  private modeId?: string;
  private requestId: string;
  private timings: Record<string, number> = {};
  private firstUsefulEmitted = false;
  private static counter = 0;

  constructor(init: PiLatencyTraceInit) {
    this.t0 = monotonicNow();
    this.source = init.source;
    this.sessionId = init.sessionId;
    this.modeId = init.modeId;
    this.requestId = init.requestId ?? `pi_${Math.round(this.t0)}_${++PiLatencyTrace.counter}`;
  }

  /** ms elapsed since the trace started. */
  elapsedMs(): number {
    return Math.max(0, Math.round(monotonicNow() - this.t0));
  }

  /**
   * Record a milestone. `props` must be metadata only (no raw content).
   * The milestone's elapsed-from-start is stored under timings[milestone]
   * and emitted as the event's durationMs.
   */
  mark(milestone: string, props?: Record<string, unknown>): number {
    const elapsed = this.elapsedMs();
    if (!(milestone in this.timings)) this.timings[milestone] = elapsed;
    telemetryService.track({
      name: milestone,
      sessionId: this.sessionId,
      modeId: this.modeId,
      durationMs: elapsed,
      properties: { source: this.source, requestId: this.requestId, ...props ?? {} },
    });
    return elapsed;
  }

  /**
   * Idempotent first-useful-token marker — call on every emitted chunk;
   * only the first call records/emits. Returns true the first time.
   */
  markFirstUseful(props?: Record<string, unknown>): boolean {
    if (this.firstUsefulEmitted) return false;
    this.firstUsefulEmitted = true;
    this.mark('first_useful_token', props);
    return true;
  }

  hasFirstUseful(): boolean {
    return this.firstUsefulEmitted;
  }

  /** All recorded milestone elapsed-times (for debug metadata / eval reports). */
  snapshot(): Record<string, number> {
    return { ...this.timings };
  }

  /**
   * Print a human-readable per-stage breakdown to the console — gated behind
   * MEASURE_LATENCY=true (or PI_LATENCY_TRACE=true). Shows elapsed-from-start
   * AND delta between consecutive milestones.
   */
  finish(extra?: Record<string, unknown>): void {
    const on = (() => {
      try {
        return process.env.MEASURE_LATENCY === 'true' || process.env.PI_LATENCY_TRACE === 'true';
      } catch { return false; }
    })();
    if (!on) return;

    const entries = Object.entries(this.timings).sort((a, b) => a[1] - b[1]);
    const total = this.elapsedMs();
    const lines: string[] = [];
    lines.push(`\n┌─ PI LATENCY TRACE (${this.source}, req=${this.requestId}) ─ total ${total}ms`);

    let prev = 0;
    let firstUseful: number | null = null;
    for (const [name, at] of entries) {
      const delta = at - prev;
      const flag = delta >= 1000 ? '  ⟵ SLOW' : delta >= 400 ? '  ⟵' : '';
      lines.push(`│  +${String(delta).padStart(5)}ms   @${String(at).padStart(6)}ms  ${name}${flag}`);
      if (name === 'first_useful_token' && firstUseful === null) firstUseful = at;
      prev = at;
    }

    if (firstUseful !== null) {
      lines.push(`├─ FIRST USEFUL TOKEN: ${firstUseful}ms  (this is what the user perceives as "speed")`);
    }
    if (extra && Object.keys(extra).length) {
      lines.push(`├─ ${JSON.stringify(extra)}`);
    }
    lines.push('└─ end trace');
    console.log(lines.join('\n'));
  }
}
