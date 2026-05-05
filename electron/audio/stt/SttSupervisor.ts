import { EventEmitter } from "events";
import * as crypto from "crypto";
import { ReplayBuffer, ReplayBufferEntry } from "./ReplayBuffer";
import { SttMetricsSnapshot, SttProviderMetrics, StreamingSttAdapter, SttFatalEvent, SttTelemetryEvent, SttTranscriptEvent } from "./SttAdapter";

interface QueuedWrite {
  chunk: Buffer;
  timestamp: number;
}

export interface SttSupervisorOptions {
  sourceLabel: string;
  adapters: StreamingSttAdapter[];
  replayBufferDurationMs?: number;
  failureThreshold?: number;
  providerDisableMs?: number;
  maxFailoversPerWindow?: number;
  failoverWindowMs?: number;
  maxPendingWrites?: number;
  maxPendingBytes?: number;
  maintenanceIntervalMs?: number;
}

interface ProviderHealthState {
  consecutiveFailures: number;
  disabledUntil: number | null;
  failureTimestamps: number[];
}

interface ProviderMetricState {
  starts: number;
  transcripts: number;
  finalTranscripts: number;
  failures: number;
  failovers: number;
  latencyTotalMs: number;
  latencySamples: number;
  lastLatencyMs?: number;
  successTimestamps: number[];
  failureTimestamps: number[];
  latencyWindow: Array<{ timestamp: number; latencyMs: number }>;
}

export class SttSupervisor extends EventEmitter {
  private readonly sourceLabel: string;
  private readonly adapters: StreamingSttAdapter[];
  private readonly providers: StreamingSttAdapter[];
  private readonly replayBuffer: ReplayBuffer;
  private unsubscribeFns: Array<() => void> = [];

  private activeAdapterIndex = -1;
  private started = false;
  private isTransitioning = false;
  private replayInProgress = false;
  private pendingWrites: QueuedWrite[] = [];
  private pendingWriteBytes = 0;
  private readonly providerHealth = new Map<number, ProviderHealthState>();
  private readonly failureThreshold: number;
  private readonly providerDisableMs: number;
  private readonly providerMetrics = new Map<string, ProviderMetricState>();
  private readonly maxFailoversPerWindow: number;
  private readonly failoverWindowMs: number;
  private readonly rollingWindowMs: number;
  private readonly failoverTimestamps: number[] = [];
  private readonly maxPendingWrites: number;
  private readonly maxPendingBytes: number;
  private readonly maintenanceIntervalMs: number;
  private maintenanceTimer: NodeJS.Timeout | null = null;
  private droppedPendingWrites = 0;
  private backpressureEvents = 0;
  private memorySamples: Array<{ timestamp: number; heapUsed: number; rss: number }> = [];

  private sampleRate = 16_000;
  private audioChannelCount = 1;
  private recognitionLanguage = "english-us";
  private credentialsPath: string | null = null;

  private lastFinalTranscript: { text: string; emittedAt: number } | null = null;
  private totalTranscripts = 0;
  private totalFinalTranscripts = 0;
  private failoverCount = 0;
  private startedAt: number | null = null;
  private lastReplayStats: { entries: number; durationMs: number } = { entries: 0, durationMs: 0 };

  private currentGenerationId: string = crypto.randomUUID();
  private cutoverTimestamp: number = 0;
  private lastInterimText: string = "";

  constructor(options: SttSupervisorOptions) {
    super();
    this.sourceLabel = options.sourceLabel;
    this.adapters = options.adapters;
    this.providers = options.adapters;
    this.replayBuffer = new ReplayBuffer({
      maxDurationMs: options.replayBufferDurationMs ?? 12_000,
      maxEntries: Number(process.env.STT_REPLAY_MAX_ENTRIES || 4_096),
      maxBytes: Number(process.env.STT_REPLAY_MAX_BYTES || 24 * 1024 * 1024),
    });
    this.failureThreshold = Math.max(1, options.failureThreshold ?? Number(process.env.STT_PROVIDER_FAILURE_THRESHOLD || 3));
    this.providerDisableMs = Math.max(5_000, options.providerDisableMs ?? Number(process.env.STT_PROVIDER_DISABLE_MS || 90_000));
    this.maxFailoversPerWindow = Math.max(1, options.maxFailoversPerWindow ?? Number(process.env.STT_MAX_FAILOVERS_PER_WINDOW || 6));
    this.failoverWindowMs = Math.max(10_000, options.failoverWindowMs ?? Number(process.env.STT_FAILOVER_WINDOW_MS || 120_000));
    this.rollingWindowMs = Math.max(30_000, Number(process.env.STT_METRICS_WINDOW_MS || 300_000));
    this.maxPendingWrites = Math.max(32, options.maxPendingWrites ?? Number(process.env.STT_MAX_PENDING_WRITES || 512));
    this.maxPendingBytes = Math.max(256 * 1024, options.maxPendingBytes ?? Number(process.env.STT_MAX_PENDING_BYTES || 8 * 1024 * 1024));
    this.maintenanceIntervalMs = Math.max(5_000, options.maintenanceIntervalMs ?? Number(process.env.STT_MAINTENANCE_INTERVAL_MS || 60_000));

    this.unsubscribeFns = [];
  }

  private async acquireTransitionLock(): Promise<void> {
    while (this.isTransitioning) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.isTransitioning = true;
  }

  public getActiveProviderName(): string {
    if (this.activeAdapterIndex < 0) {
      return "inactive";
    }
    return this.adapters[this.activeAdapterIndex]?.name || "inactive";
  }

  public start(sessionId?: string): void {
    if (this.started) {
      return;
    }
    
    console.log(`[SESSION_START] ${sessionId}`);
    
    (this as any)._activeSessionId = sessionId;

    this.replayBuffer.clear();
    this.started = true;
    this.startedAt = Date.now();
    this.startMaintenanceTimer();
    const nextIndex = this.findNextAvailableAdapterIndex(-1);
    if (nextIndex === -1) {
      this.emit("error", new Error(`[SttSupervisor/${this.sourceLabel}] No STT adapters are available`));
      return;
    }

    void (async () => {
      await this.acquireTransitionLock();
      try {
        await this.activateAdapter(nextIndex);
      } finally {
        this.isTransitioning = false;
      }
    })();
  }

  public stop(): void {
    console.log(`[SESSION_STOP] ${(this as any)._activeSessionId}`);
    this.started = false;
    (this as any)._activeSessionId = null;
    this.isTransitioning = false;
    this.replayInProgress = false;
    this.pendingWrites = [];
    this.pendingWriteBytes = 0;
    this.replayBuffer.clear();
    this.lastFinalTranscript = null;
    this.lastReplayStats = { entries: 0, durationMs: 0 };
    this.lastInterimText = "";
    this.stopMaintenanceTimer();

    const active = this.getActiveAdapter();
    if (active) {
      active.stop();
    }
    this.activeAdapterIndex = -1;
    this.unsubscribeFns.forEach(fn => fn());
    this.unsubscribeFns = [];
    this.logDebug(`cleanup_complete pendingWrites=0 replayEntries=0 droppedPendingWrites=${this.droppedPendingWrites}`);
    this.emitMetrics();
  }

  public destroy(): void {
    this.stop();
    for (const unsubscribe of this.unsubscribeFns) {
      unsubscribe();
    }
    for (const adapter of this.adapters) {
      adapter.destroy?.();
    }
    this.removeAllListeners();
  }

  public write(chunk: Buffer): void {
    if (!this.started || !(this as any)._activeSessionId) {
      return;
    }

    const timestamp = Date.now();
    this.replayBuffer.push(chunk, timestamp);

    const MAX_BUFFER_SIZE = 1000;
    if (this.replayBuffer.getEntryCount() > MAX_BUFFER_SIZE) {
      this.replayBuffer.dropOldestChunk();
      this.emitTelemetry({
        type: "stt.buffer_drop",
        provider: this.getActiveProviderName(),
        sourceLabel: this.sourceLabel,
        timestamp: Date.now()
      } as any);
    }

    if (this.replayInProgress || this.isTransitioning || this.activeAdapterIndex < 0) {
      this.enqueuePendingWrite(chunk, timestamp);
      return;
    }

    this.getActiveAdapter()?.write(chunk, timestamp);
  }

  public setSampleRate(rate: number): void {
    this.sampleRate = rate;
    for (const adapter of this.adapters) {
      adapter.setSampleRate?.(rate);
    }
  }

  public setAudioChannelCount(count: number): void {
    this.audioChannelCount = count;
    for (const adapter of this.adapters) {
      adapter.setAudioChannelCount?.(count);
    }
  }

  public setRecognitionLanguage(key: string): void {
    this.recognitionLanguage = key;
    for (const adapter of this.adapters) {
      adapter.setRecognitionLanguage?.(key);
    }
  }

  public setCredentials(path: string): void {
    this.credentialsPath = path;
    for (const adapter of this.adapters) {
      adapter.setCredentials?.(path);
    }
  }

  public notifySpeechEnded(): void {
    this.getActiveAdapter()?.notifySpeechEnded?.();
  }

  public finalize(): void {
    this.getActiveAdapter()?.finalize?.();
  }

  public debugPrimeReplayBuffer(durationMs: number = 4_000, frameMs: number = 20): { entryCount: number; durationMs: number } {
    const frameDurationMs = Math.max(10, frameMs);
    const frames = Math.max(1, Math.round(durationMs / frameDurationMs));
    const frameSamples = Math.max(1, Math.round((this.sampleRate * frameDurationMs) / 1000));
    const frameBytes = frameSamples * Math.max(1, this.audioChannelCount) * 2;
    const baseTime = Date.now() - durationMs;

    for (let index = 0; index < frames; index++) {
      this.replayBuffer.push(Buffer.alloc(frameBytes), baseTime + (index * frameDurationMs));
    }

    const replayDurationMs = this.getReplayDurationMs(this.replayBuffer.snapshot());
    this.lastReplayStats = {
      entries: this.replayBuffer.getEntryCount(),
      durationMs: replayDurationMs,
    };
    if (this.isDebugEnabled()) {
      console.log(
        `[STT_DEBUG][${this.sourceLabel}] Primed replay buffer entries=${this.lastReplayStats.entries} duration=${this.lastReplayStats.durationMs}ms`
      );
    }
    this.emitMetrics();
    return {
      entryCount: this.lastReplayStats.entries,
      durationMs: this.lastReplayStats.durationMs,
    };
  }

  public debugSimulateFailure(providerName?: string, reason: string = "debug_failure_injected"): boolean {
    const activeProvider = this.getActiveProviderName();
    if (this.activeAdapterIndex < 0 || (providerName && providerName !== activeProvider)) {
      return false;
    }

    this.emitTelemetry({
      type: "debug_failure_injected",
      provider: activeProvider,
      sourceLabel: this.sourceLabel,
      timestamp: Date.now(),
      reason,
    });
    this.handleFatal(this.activeAdapterIndex, {
      error: new Error(reason),
      provider: activeProvider,
      sourceLabel: this.sourceLabel,
      retryable: true,
    });
    return true;
  }

  public getMetricsSnapshot(): SttMetricsSnapshot {
    const uptimeMs = this.startedAt ? Math.max(1, Date.now() - this.startedAt) : 0;
    const transcriptsPerSecond = uptimeMs > 0
      ? Number((this.totalFinalTranscripts / (uptimeMs / 1000)).toFixed(3))
      : 0;

    const providers: SttProviderMetrics[] = this.adapters.map((adapter, index) => {
      const providerMetric = this.getProviderMetric(adapter.name);
      this.pruneProviderWindows(providerMetric, Date.now());
      const health = this.providerHealth.get(index);
      const rollingSuccesses = providerMetric.successTimestamps.length;
      const rollingFailures = providerMetric.failureTimestamps.length;
      const successRateBase = rollingSuccesses + rollingFailures;
      const rollingAverageLatency = providerMetric.latencyWindow.length > 0
        ? providerMetric.latencyWindow.reduce((sum, entry) => sum + entry.latencyMs, 0) / providerMetric.latencyWindow.length
        : undefined;
      return {
        provider: adapter.name,
        starts: providerMetric.starts,
        transcripts: providerMetric.transcripts,
        finalTranscripts: providerMetric.finalTranscripts,
        failures: providerMetric.failures,
        failovers: providerMetric.failovers,
        successRate: successRateBase > 0 ? Number((rollingSuccesses / successRateBase).toFixed(3)) : 1,
        cooldownUntil: health?.disabledUntil ?? null,
        lastLatencyMs: providerMetric.lastLatencyMs,
        averageLatencyMs: typeof rollingAverageLatency === "number" ? Number(rollingAverageLatency.toFixed(1)) : undefined,
      };
    });

    return {
      sourceLabel: this.sourceLabel,
      activeProvider: this.getActiveProviderName(),
      started: this.started,
      replayInProgress: this.replayInProgress,
      pendingWrites: this.pendingWrites.length,
      replayBufferEntries: this.replayBuffer.getEntryCount(),
      replayBufferDurationMs: this.lastReplayStats.durationMs,
      failoverCount: this.failoverCount,
      totalTranscripts: this.totalTranscripts,
      totalFinalTranscripts: this.totalFinalTranscripts,
      transcriptsPerSecond,
      providers,
    };
  }

  private getActiveAdapter(): StreamingSttAdapter | null {
    if (this.activeAdapterIndex < 0) {
      return null;
    }
    return this.adapters[this.activeAdapterIndex] || null;
  }

  private async activateAdapter(index: number, replaySnapshot?: ReplayBufferEntry[]): Promise<void> {
    const adapter = this.adapters[index];
    if (!adapter) {
      return;
    }

    adapter.setSampleRate?.(this.sampleRate);
    adapter.setAudioChannelCount?.(this.audioChannelCount);
    adapter.setRecognitionLanguage?.(this.recognitionLanguage);
    if (this.credentialsPath) {
      adapter.setCredentials?.(this.credentialsPath);
    }

    this.unsubscribeFns.forEach(fn => fn());
    this.unsubscribeFns = [];

    const activeSessionId = (this as any)._activeSessionId;

    this.unsubscribeFns.push(
      adapter.onTranscript((event) => {
        if (activeSessionId !== (this as any)._activeSessionId) return;
        this.handleTranscript(index, event);
      }),
      adapter.onFatal((event) => {
        if (activeSessionId !== (this as any)._activeSessionId) return;
        this.handleFatal(index, event);
      })
    );

    this.activeAdapterIndex = index;
    this.getProviderMetric(adapter.name).starts += 1;
    this.logDebug(`active_provider=${adapter.name}`);
    this.emitTelemetry({
      type: "provider_started",
      provider: adapter.name,
      sourceLabel: this.sourceLabel,
      timestamp: Date.now(),
    });

    try {
        await Promise.resolve(adapter.start());
    } catch (error) {
        this.handleFatal(index, {
            error: error instanceof Error ? error : new Error(String(error)),
            provider: adapter.name,
            sourceLabel: this.sourceLabel,
            retryable: true
        });
        return;
    }

    if (replaySnapshot && replaySnapshot.length > 0) {
      this.replayInProgress = true;
      this.lastReplayStats = {
        entries: replaySnapshot.length,
        durationMs: this.getReplayDurationMs(replaySnapshot),
      };
      this.logDebug(
        `replay_start provider=${adapter.name} entries=${this.lastReplayStats.entries} duration=${this.lastReplayStats.durationMs}ms`
      );
      this.replaySnapshotToActiveAdapter(replaySnapshot);
    }
    this.emitMetrics();
  }

  private handleTranscript(adapterIndex: number, event: SttTranscriptEvent): void {
    if (!this.started || adapterIndex !== this.activeAdapterIndex) {
      return;
    }
    const eventTime = (event as any).timestamp ?? Date.now();
    if (eventTime < this.cutoverTimestamp) {
      return;
    }

    if (!event.isFinal) {
      this.lastInterimText = event.text;
    } else {
      this.lastInterimText = "";
    }

    const providerName = this.adapters[adapterIndex]?.name || event.provider || "unknown";
    const providerMetric = this.getProviderMetric(providerName);
    this.totalTranscripts += 1;
    providerMetric.transcripts += 1;
    if (typeof event.latencyMs === "number" && Number.isFinite(event.latencyMs)) {
      providerMetric.lastLatencyMs = event.latencyMs;
      providerMetric.latencyTotalMs += event.latencyMs;
      providerMetric.latencySamples += 1;
      providerMetric.latencyWindow.push({
        timestamp: Date.now(),
        latencyMs: event.latencyMs,
      });
      this.pruneProviderWindows(providerMetric, Date.now());
    }

    if (event.isFinal) {
      const normalized = event.text.trim();
      if (!normalized) {
        return;
      }
      const now = Date.now();
      if (
        this.lastFinalTranscript
        && this.lastFinalTranscript.text === normalized
        && now - this.lastFinalTranscript.emittedAt < 2500
      ) {
        return;
      }
      this.resetProviderHealth(adapterIndex);
      providerMetric.finalTranscripts += 1;
      this.totalFinalTranscripts += 1;
      providerMetric.successTimestamps.push(now);
      this.pruneProviderWindows(providerMetric, now);
      this.lastFinalTranscript = {
        text: normalized,
        emittedAt: now,
      };
    }

    this.logDebug(
      `transcript provider=${providerName} final=${event.isFinal} latency=${event.latencyMs ?? "n/a"}ms text="${event.text.slice(0, 80)}"`
    );
    
    const emitGenerationId = this.currentGenerationId;
    
    this.emit("transcript", {
      ...event,
      provider: providerName,
      sourceLabel: this.sourceLabel,
      _sessionId: (this as any)._activeSessionId,
      generationId: emitGenerationId,
    });

    if (event.isFinal) {
        this.currentGenerationId = crypto.randomUUID();
    }
    
    this.emitMetrics();
  }

  private handleFatal(adapterIndex: number, event: SttFatalEvent): void {
    if (!this.started || adapterIndex !== this.activeAdapterIndex) {
      return;
    }

    void (async () => {
      await this.acquireTransitionLock();
      try {
        if (!this.started || adapterIndex !== this.activeAdapterIndex) return;

        const health = this.registerFailure(adapterIndex);
        const providerMetric = this.getProviderMetric(event.provider);
        console.log(`[PIPELINE_ERROR] provider=${event.provider} error="${event.error.message}"`);
        providerMetric.failures += 1;
        providerMetric.failureTimestamps.push(Date.now());
        this.pruneProviderWindows(providerMetric, Date.now());
        this.emitTelemetry({
          type: "provider_failed",
          provider: event.provider,
          sourceLabel: this.sourceLabel,
          timestamp: Date.now(),
          reason: event.error.message,
          consecutiveFailures: health.consecutiveFailures,
          disabledUntil: health.disabledUntil,
        });
        this.logDebug(
          `provider_failed provider=${event.provider} reason="${event.error.message}" consecutive=${health.consecutiveFailures} cooldownUntil=${health.disabledUntil ?? "none"}`
        );
        this.emit("error", new Error(`[${event.provider}] ${event.error.message}`));
        
        await this.failover(event);
      } finally {
        this.isTransitioning = false;
        this.emitMetrics();
      }
    })();
  }

  private async failover(event: SttFatalEvent): Promise<void> {
    this.cutoverTimestamp = Date.now();
    this.currentGenerationId = crypto.randomUUID();
    console.log(`[FAILOVER_TRIGGERED] from ${event.provider}`);
    const previousAdapter = this.getActiveAdapter();
    const previousProvider = this.getActiveProviderName();
    const replaySnapshot = this.replayBuffer.snapshot();
    
    this.unsubscribeFns.forEach(fn => fn());
    this.unsubscribeFns = [];

    if (this.lastInterimText) {
      this.emit("transcript", {
        text: this.lastInterimText + "...",
        isFinal: true,
        confidence: 1.0,
        provider: previousProvider,
        sourceLabel: this.sourceLabel,
        _sessionId: (this as any)._activeSessionId,
        generationId: this.currentGenerationId,
      });
      this.currentGenerationId = crypto.randomUUID();
      this.lastInterimText = "";
    }

    const nextIndex = this.findNextAvailableAdapterIndex(this.activeAdapterIndex);
    const isSelfRestart = (nextIndex !== -1 && nextIndex === this.activeAdapterIndex);

    if (!isSelfRestart && !this.canAttemptFailover()) {
      this.activeAdapterIndex = -1;
      this.emit("error", new Error(`[SttSupervisor/${this.sourceLabel}] Failover loop guard triggered after ${previousProvider}`));
      return;
    }

    try {
      await Promise.resolve(previousAdapter?.stop());

      if (!this.started || !(this as any)._activeSessionId) return;

      if (nextIndex === -1) {
        this.activeAdapterIndex = -1;
        this.emit(
          "error",
          new Error(
            `[SttSupervisor/${this.sourceLabel}] Exhausted STT failover chain after ${previousProvider}: ${event.error.message}`
          )
        );
        return;
      }

      if (isSelfRestart) {
          const health = this.providerHealth.get(nextIndex);
          const failures = health ? health.consecutiveFailures : 1;
          const delayMs = Math.min(1000 * Math.pow(2, failures - 1), 15000); 
          this.logDebug(`self_failover provider=${previousProvider} delay=${delayMs}ms`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
          this.failoverCount += 1;
          this.getProviderMetric(previousProvider).failovers += 1;
      }

      const nextProvider = this.adapters[nextIndex].name;
      this.logDebug(
        `failover provider=${previousProvider} next=${nextProvider} replayDuration=${this.getReplayDurationMs(replaySnapshot)}ms entries=${replaySnapshot.length} reason="${event.error.message}"`
      );
      
      this.emitTelemetry({
        type: "stt.transition",
        from: event.provider,
        to: this.getActiveProviderName(),
        sourceLabel: this.sourceLabel,
        timestamp: Date.now()
      } as any);

      this.emitTelemetry({
        type: "failover_triggered",
        provider: previousProvider,
        sourceLabel: this.sourceLabel,
        timestamp: Date.now(),
        reason: event.error.message,
        nextProvider,
        replayBufferEntries: replaySnapshot.length,
        replayBufferDurationMs: this.getReplayDurationMs(replaySnapshot),
      });

      await this.activateAdapter(nextIndex, replaySnapshot);
    } catch (error) {
      this.activeAdapterIndex = -1;
      const failure = error instanceof Error ? error : new Error(String(error));
      this.emit(
        "error",
        new Error(
          `[SttSupervisor/${this.sourceLabel}] Failover from ${previousProvider} failed: ${failure.message}`
        )
      );
    }
  }

  private findNextAvailableAdapterIndex(afterIndex: number): number {
    const totalAdapters = this.adapters.length;
    if (totalAdapters === 0) {
      return -1;
    }

    for (let offset = 1; offset <= totalAdapters; offset++) {
      const index = (afterIndex + offset + totalAdapters) % totalAdapters;
      if (this.isProviderUsable(index)) {
        return index;
      }
    }
    return -1;
  }

  private replaySnapshotToActiveAdapter(snapshot: ReplayBufferEntry[]): void {
    let index = 0;
    const batchSize = 16;

    const flushBatch = () => {
      if (!this.started || this.activeAdapterIndex < 0) {
        this.replayInProgress = false;
        this.pendingWrites = [];
        return;
      }

      const active = this.getActiveAdapter();
      if (!active) {
        this.replayInProgress = false;
        this.pendingWrites = [];
        return;
      }

      const end = Math.min(index + batchSize, snapshot.length);
      for (; index < end; index++) {
        const entry = snapshot[index];
        active.write(entry.chunk, entry.timestamp);
      }

      if (index < snapshot.length) {
        setImmediate(flushBatch);
        return;
      }

      const queuedWrites = this.pendingWrites.splice(0);
      this.pendingWriteBytes = 0;
      this.logDebug(
        `replay_complete provider=${this.getActiveProviderName()} entries=${snapshot.length} queuedWrites=${queuedWrites.length} duration=${this.lastReplayStats.durationMs}ms`
      );
      for (const pending of queuedWrites) {
        active.write(pending.chunk, pending.timestamp);
      }
      this.replayInProgress = false;
      this.emitMetrics();
    };

    setImmediate(flushBatch);
  }

  private isProviderUsable(index: number): boolean {
    const adapter = this.adapters[index];
    if (!adapter || !adapter.isAvailable()) {
      return false;
    }

    const health = this.providerHealth.get(index);
    if (!health?.disabledUntil) {
      return true;
    }

    // If this is the only available adapter, do not disable it
    // so we can at least attempt to recover.
    const availableCount = this.adapters.filter(a => a.isAvailable()).length;
    if (availableCount === 1) {
      return true;
    }

    if (health.disabledUntil <= Date.now()) {
      health.disabledUntil = null;
      health.consecutiveFailures = 0;
      return true;
    }

    return false;
  }

  private registerFailure(index: number): ProviderHealthState {
    const current = this.providerHealth.get(index) || {
      consecutiveFailures: 0,
      disabledUntil: null,
      failureTimestamps: [],
    };

    const now = Date.now();
    current.consecutiveFailures += 1;
    current.failureTimestamps.push(now);
    current.failureTimestamps = current.failureTimestamps.filter((timestamp) => now - timestamp <= this.rollingWindowMs);
    if (current.consecutiveFailures >= this.failureThreshold) {
      current.disabledUntil = now + this.providerDisableMs;
      console.warn(
        `[SttSupervisor/${this.sourceLabel}] Temporarily disabling ${this.adapters[index]?.name} for ${this.providerDisableMs}ms after ${current.consecutiveFailures} consecutive failures`
      );
    }

    this.providerHealth.set(index, current);
    return current;
  }

  private resetProviderHealth(index: number): void {
    const existing = this.providerHealth.get(index);
    this.providerHealth.set(index, {
      consecutiveFailures: 0,
      disabledUntil: null,
      failureTimestamps: existing?.failureTimestamps || [],
    });
  }

  private getReplayDurationMs(snapshot: ReplayBufferEntry[]): number {
    if (snapshot.length < 2) {
      return snapshot.length === 1 ? 0 : 0;
    }

    return Math.max(0, snapshot[snapshot.length - 1].timestamp - snapshot[0].timestamp);
  }

  private emitTelemetry(event: SttTelemetryEvent): void {
    this.emit("telemetry", event);
  }

  private emitMetrics(): void {
    this.emit("metrics", this.getMetricsSnapshot());
  }

  private getProviderMetric(provider: string): ProviderMetricState {
    const existing = this.providerMetrics.get(provider);
    if (existing) {
      return existing;
    }

    const created: ProviderMetricState = {
      starts: 0,
      transcripts: 0,
      finalTranscripts: 0,
      failures: 0,
      failovers: 0,
      latencyTotalMs: 0,
      latencySamples: 0,
      successTimestamps: [],
      failureTimestamps: [],
      latencyWindow: [],
    };
    this.providerMetrics.set(provider, created);
    return created;
  }

  private canAttemptFailover(): boolean {
    const now = Date.now();
    while (this.failoverTimestamps.length > 0 && now - this.failoverTimestamps[0] > this.failoverWindowMs) {
      this.failoverTimestamps.shift();
    }

    if (this.failoverTimestamps.length >= this.maxFailoversPerWindow) {
      this.logDebug(`failover_guard active count=${this.failoverTimestamps.length} windowMs=${this.failoverWindowMs}`);
      return false;
    }

    this.failoverTimestamps.push(now);
    return true;
  }

  private logDebug(message: string): void {
    if (this.isDebugEnabled()) {
      console.log(`[STT_DEBUG][Supervisor/${this.sourceLabel}] ${message}`);
    }
  }

  private isDebugEnabled(): boolean {
    return process.env.STT_DEBUG === "true";
  }

  private pruneProviderWindows(metric: ProviderMetricState, now: number): void {
    metric.successTimestamps = metric.successTimestamps.filter((timestamp) => now - timestamp <= this.rollingWindowMs);
    metric.failureTimestamps = metric.failureTimestamps.filter((timestamp) => now - timestamp <= this.rollingWindowMs);
    metric.latencyWindow = metric.latencyWindow.filter((entry) => now - entry.timestamp <= this.rollingWindowMs);
  }

  private enqueuePendingWrite(chunk: Buffer, timestamp: number): void {
    const copy = Buffer.from(chunk);
    const lastQueued = this.pendingWrites[this.pendingWrites.length - 1];
    const canCoalesce = !!lastQueued && lastQueued.chunk.length + copy.length <= 64 * 1024;

    if (canCoalesce) {
      lastQueued.chunk = Buffer.concat([lastQueued.chunk, copy]);
      lastQueued.timestamp = timestamp;
      this.pendingWriteBytes += copy.length;
    } else {
      this.pendingWrites.push({
        chunk: copy,
        timestamp,
      });
      this.pendingWriteBytes += copy.length;
    }

    while (this.pendingWrites.length > this.maxPendingWrites || this.pendingWriteBytes > this.maxPendingBytes) {
      const dropped = this.pendingWrites.shift();
      if (!dropped) {
        break;
      }
      this.pendingWriteBytes = Math.max(0, this.pendingWriteBytes - dropped.chunk.length);
      this.droppedPendingWrites += 1;
      this.backpressureEvents += 1;
      this.emitTelemetry({
        type: "stt.buffer_drop",
        provider: this.getActiveProviderName(),
        sourceLabel: this.sourceLabel,
        timestamp: Date.now(),
        droppedBytes: dropped.chunk.length,
        queueLength: this.pendingWrites.length,
      } as any);
      this.logDebug(`backpressure_drop oldestChunkBytes=${dropped.chunk.length} queueLength=${this.pendingWrites.length}`);
    }
  }

  private startMaintenanceTimer(): void {
    if (this.maintenanceTimer) {
      return;
    }

    this.maintenanceTimer = setInterval(() => {
      this.runMaintenance();
    }, this.maintenanceIntervalMs);
  }

  private stopMaintenanceTimer(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
  }

  private runMaintenance(): void {
    this.replayBuffer.pruneNow();
    const now = Date.now();

    const activeCutoff = now - this.failoverWindowMs;
    while (this.failoverTimestamps.length > 0 && this.failoverTimestamps[0] < activeCutoff) {
      this.failoverTimestamps.shift();
    }

    const memory = process.memoryUsage();
    this.memorySamples.push({
      timestamp: now,
      heapUsed: memory.heapUsed,
      rss: memory.rss,
    });
    this.memorySamples = this.memorySamples.filter((sample) => now - sample.timestamp <= this.rollingWindowMs);

    if (this.memorySamples.length >= 3) {
      const first = this.memorySamples[0];
      const last = this.memorySamples[this.memorySamples.length - 1];
      const heapGrowthMb = (last.heapUsed - first.heapUsed) / (1024 * 1024);
      if (heapGrowthMb > 64) {
        console.warn(
          `[SttSupervisor/${this.sourceLabel}] Memory growth detected over rolling window: +${heapGrowthMb.toFixed(1)}MB heap`
        );
      }
    }

    this.logDebug(
      `maintenance replayBytes=${this.replayBuffer.getTotalBytes()} pendingWrites=${this.pendingWrites.length} pendingBytes=${this.pendingWriteBytes} rss=${Math.round(memory.rss / (1024 * 1024))}MB`
    );
    this.emitMetrics();
  }
}
