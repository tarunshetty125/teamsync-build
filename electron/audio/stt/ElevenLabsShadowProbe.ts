import { EventEmitter } from "events";

export interface ElevenLabsShadowProbeSnapshot {
  running: boolean;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export class ElevenLabsShadowProbe extends EventEmitter {
  private readonly apiKey: string;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private snapshot: ElevenLabsShadowProbeSnapshot = {
    running: false,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    lastError: null,
  };

  constructor(apiKey: string, options?: { intervalMs?: number; timeoutMs?: number }) {
    super();
    this.apiKey = apiKey.trim();
    this.intervalMs = Math.max(30_000, options?.intervalMs ?? Number(process.env.ELEVENLABS_SHADOW_PROBE_INTERVAL_MS || 120_000));
    this.timeoutMs = Math.max(1_000, options?.timeoutMs ?? Number(process.env.ELEVENLABS_SHADOW_PROBE_TIMEOUT_MS || 2_500));
  }

  public start(): void {
    if (!this.apiKey || this.timer) {
      return;
    }

    this.snapshot.running = true;
    this.timer = setInterval(() => {
      void this.runProbe();
    }, this.intervalMs);
    if (this.timer.unref) {
      this.timer.unref();
    }

    void this.runProbe();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.inFlight = false;
    this.snapshot.running = false;
  }

  public getSnapshot(): ElevenLabsShadowProbeSnapshot {
    return { ...this.snapshot };
  }

  private async runProbe(): Promise<void> {
    if (this.inFlight || !this.snapshot.running) {
      return;
    }

    this.inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch("https://api.elevenlabs.io/v1/models", {
        method: "GET",
        headers: {
          "xi-api-key": this.apiKey,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`ElevenLabs probe returned ${response.status}`);
      }

      this.snapshot.lastSuccessAt = Date.now();
      this.snapshot.consecutiveFailures = 0;
      this.snapshot.lastError = null;
      this.emit("healthy", this.getSnapshot());
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.snapshot.lastFailureAt = Date.now();
      this.snapshot.consecutiveFailures += 1;
      this.snapshot.lastError = failure.message;
      this.emit("failed", this.getSnapshot());
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
    }
  }
}
