import { strict as assert } from "node:assert";
import { test } from "node:test";

import { SttSupervisor } from "../audio/stt/SttSupervisor";
import type { SttActivityEvent, StreamingSttAdapter, SttFatalEvent, SttTranscriptEvent } from "../audio/stt/SttAdapter";

class FakeStreamingAdapter implements StreamingSttAdapter {
  public readonly sourceLabel = "interviewer";
  public startCount = 0;
  public stopCount = 0;

  private transcriptListeners = new Set<(event: SttTranscriptEvent) => void>();
  private fatalListeners = new Set<(event: SttFatalEvent) => void>();
  private activityListeners = new Set<(event: SttActivityEvent) => void>();

  constructor(
    public readonly name: string,
    private readonly available = true,
  ) {}

  public start(): void {
    this.startCount += 1;
    this.emitActivity({
      kind: "provider_open",
      provider: this.name,
      sourceLabel: this.sourceLabel,
      timestamp: Date.now(),
    });
  }

  public stop(): void {
    this.stopCount += 1;
  }

  public write(): void {}

  public isAvailable(): boolean {
    return this.available;
  }

  public onTranscript(callback: (event: SttTranscriptEvent) => void): () => void {
    this.transcriptListeners.add(callback);
    return () => this.transcriptListeners.delete(callback);
  }

  public onFatal(callback: (event: SttFatalEvent) => void): () => void {
    this.fatalListeners.add(callback);
    return () => this.fatalListeners.delete(callback);
  }

  public onActivity(callback: (event: SttActivityEvent) => void): () => void {
    this.activityListeners.add(callback);
    return () => this.activityListeners.delete(callback);
  }

  public emitTranscript(event: SttTranscriptEvent): void {
    for (const listener of this.transcriptListeners) {
      listener(event);
    }
  }

  public emitFatal(reason: string, retryable: boolean = true): void {
    const error = new Error(reason);
    for (const listener of this.fatalListeners) {
      listener({
        error,
        provider: this.name,
        sourceLabel: this.sourceLabel,
        retryable,
      });
    }
  }

  private emitActivity(event: SttActivityEvent): void {
    for (const listener of this.activityListeners) {
      listener(event);
    }
  }
}

const flush = async (rounds: number = 4) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const waitFor = async (predicate: () => boolean, message: string) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flush(1);
  }

  assert.ok(predicate(), message);
};

const withImmediateTimers = async (fn: () => Promise<void>) => {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = ((callback: (...args: any[]) => void, _delay?: number, ...args: any[]) => {
    return originalSetTimeout(callback, 0, ...args);
  }) as typeof global.setTimeout;

  try {
    await fn();
  } finally {
    global.setTimeout = originalSetTimeout;
  }
};

test("Deepgram retries once before falling back to Google", async () => {
  await withImmediateTimers(async () => {
    const deepgram = new FakeStreamingAdapter("deepgram");
    const google = new FakeStreamingAdapter("google");
    const whisper = new FakeStreamingAdapter("whisper");
    const supervisor = new SttSupervisor({
      sourceLabel: "interviewer",
      adapters: [deepgram, google, whisper],
      failureThreshold: 2,
      maintenanceIntervalMs: 60_000,
    });

    try {
      supervisor.on("error", () => {});
      supervisor.start("deepgram-retry");
      await waitFor(() => supervisor.getActiveProviderName() === "deepgram", "expected Deepgram to become active");

      assert.equal(supervisor.getActiveProviderName(), "deepgram");
      assert.equal(deepgram.startCount, 1);

      deepgram.emitFatal("socket closed");
      await waitFor(() => deepgram.startCount >= 2 && supervisor.getActiveProviderName() === "deepgram", "expected Deepgram soft restart");
      assert.equal(supervisor.getActiveProviderName(), "deepgram");
      assert.equal(deepgram.startCount, 2);
      assert.equal(google.startCount, 0);

      deepgram.emitFatal("socket closed again");
      await waitFor(() => supervisor.getActiveProviderName() === "google", "expected Google fallback after repeated Deepgram failures");
      assert.equal(supervisor.getActiveProviderName(), "google");
      assert.equal(google.startCount, 1);

      const deepgramMetrics = supervisor.getMetricsSnapshot().providers.find((provider) => provider.provider === "deepgram");
      assert.ok(deepgramMetrics?.cooldownUntil, "expected Deepgram cooldown after repeated failures");
    } finally {
      supervisor.stop();
      await flush();
    }
  });
});

test("Provider fail chain advances Deepgram to Google to Whisper before degraded mode", async () => {
  await withImmediateTimers(async () => {
    const deepgram = new FakeStreamingAdapter("deepgram");
    const google = new FakeStreamingAdapter("google");
    const whisper = new FakeStreamingAdapter("whisper");
    const supervisor = new SttSupervisor({
      sourceLabel: "interviewer",
      adapters: [deepgram, google, whisper],
      failureThreshold: 1,
      maintenanceIntervalMs: 60_000,
    });

    try {
      let lastError = "";
      supervisor.on("error", (error: Error) => {
        lastError = error.message;
      });

      supervisor.start("provider-chain");
      await waitFor(() => supervisor.getActiveProviderName() === "deepgram", "expected Deepgram to become active");
      assert.equal(supervisor.getActiveProviderName(), "deepgram");

      deepgram.emitFatal("deepgram down");
      await waitFor(() => supervisor.getActiveProviderName() === "google", "expected Google fallback");
      assert.equal(supervisor.getActiveProviderName(), "google");

      google.emitFatal("google down");
      await waitFor(() => supervisor.getActiveProviderName() === "whisper", "expected Whisper fallback");
      assert.equal(supervisor.getActiveProviderName(), "whisper");

      whisper.emitFatal("whisper down");
      await waitFor(() => supervisor.getActiveProviderName() === "inactive", "expected degraded mode after Whisper failure");
      assert.equal(supervisor.getActiveProviderName(), "inactive");
      assert.match(lastError, /Speech recognition temporarily unavailable/);
    } finally {
      supervisor.stop();
      await flush();
    }
  });
});

test("Transcript continuity suppresses duplicate finals across provider failover", async () => {
  await withImmediateTimers(async () => {
    const deepgram = new FakeStreamingAdapter("deepgram");
    const google = new FakeStreamingAdapter("google");
    const whisper = new FakeStreamingAdapter("whisper");
    const supervisor = new SttSupervisor({
      sourceLabel: "interviewer",
      adapters: [deepgram, google, whisper],
      failureThreshold: 1,
      maintenanceIntervalMs: 60_000,
    });

    const finals: string[] = [];
    supervisor.on("transcript", (event: SttTranscriptEvent) => {
      if (event.isFinal) {
        finals.push(event.text);
      }
    });

    try {
      supervisor.on("error", () => {});
      supervisor.start("continuity");
      await waitFor(() => supervisor.getActiveProviderName() === "deepgram", "expected Deepgram to become active");

      deepgram.emitTranscript({
        text: "let's walk through the cache design",
        isFinal: true,
        confidence: 0.92,
        provider: "deepgram",
      });
      await flush();

      deepgram.emitFatal("deepgram lost websocket");
      await waitFor(() => supervisor.getActiveProviderName() === "google", "expected Google fallback");
      assert.equal(supervisor.getActiveProviderName(), "google");

      google.emitTranscript({
        text: "let's walk through the cache design",
        isFinal: true,
        confidence: 0.91,
        provider: "google",
      });
      google.emitTranscript({
        text: "now let's talk about eviction",
        isFinal: true,
        confidence: 0.93,
        provider: "google",
      });
      await flush();

      assert.deepEqual(finals, [
        "let's walk through the cache design",
        "now let's talk about eviction",
      ]);
    } finally {
      supervisor.stop();
      await flush();
    }
  });
});

test("Reconnect storm quarantines Deepgram before another immediate retry loop", async () => {
  await withImmediateTimers(async () => {
    const deepgram = new FakeStreamingAdapter("deepgram");
    const google = new FakeStreamingAdapter("google");
    const supervisor = new SttSupervisor({
      sourceLabel: "interviewer",
      adapters: [deepgram, google],
      failureThreshold: 3,
      providerDisableMs: 90_000,
      maintenanceIntervalMs: 60_000,
    });

    try {
      supervisor.on("error", () => {});
      supervisor.start("storm");
      await waitFor(() => supervisor.getActiveProviderName() === "deepgram", "expected Deepgram to become active");

      deepgram.emitFatal("1006 abnormal closure");
      await waitFor(() => deepgram.startCount >= 2 && supervisor.getActiveProviderName() === "deepgram", "expected first Deepgram restart");
      assert.equal(supervisor.getActiveProviderName(), "deepgram");

      deepgram.emitFatal("EPIPE on send");
      await waitFor(() => deepgram.startCount >= 3 && supervisor.getActiveProviderName() === "deepgram", "expected second Deepgram restart");
      assert.equal(supervisor.getActiveProviderName(), "deepgram");

      deepgram.emitFatal("timeout");
      await waitFor(() => supervisor.getActiveProviderName() === "google", "expected Google takeover after storm");
      assert.equal(supervisor.getActiveProviderName(), "google");

      const deepgramMetrics = supervisor.getMetricsSnapshot().providers.find((provider) => provider.provider === "deepgram");
      assert.ok(deepgramMetrics?.cooldownUntil && deepgramMetrics.cooldownUntil > Date.now());
    } finally {
      supervisor.stop();
      await flush();
    }
  });
});
