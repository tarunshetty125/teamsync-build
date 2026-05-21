import { strict as assert } from "node:assert";
import { test } from "node:test";

import { SttSupervisor } from "../audio/stt/SttSupervisor";
import type { SttActivityEvent, StreamingSttAdapter, SttFatalEvent, SttTranscriptEvent } from "../audio/stt/SttAdapter";

class FakeStreamingAdapter implements StreamingSttAdapter {
  public readonly name = "deepgram";
  public readonly sourceLabel = "interviewer";

  private transcriptListeners = new Set<(event: SttTranscriptEvent) => void>();
  private fatalListeners = new Set<(event: SttFatalEvent) => void>();
  private activityListeners = new Set<(event: SttActivityEvent) => void>();

  public start(): void {}
  public stop(): void {}
  public write(): void {}
  public isAvailable(): boolean { return true; }

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

  public emitActivity(event: SttActivityEvent): void {
    for (const listener of this.activityListeners) {
      listener(event);
    }
  }
}

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test("STT watchdog trips when speech starts but no transcript ever arrives", async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;

  const adapter = new FakeStreamingAdapter();
  const supervisor = new SttSupervisor({
    sourceLabel: "interviewer",
    adapters: [adapter],
    maintenanceIntervalMs: 60_000,
  });

  try {
    let lastError = "";
    supervisor.on("error", (error: Error) => {
      lastError = error.message;
    });

    supervisor.start("watchdog-stall");
    await tick();

    adapter.emitActivity({ kind: "provider_open", provider: "deepgram", sourceLabel: "interviewer", timestamp: now });
    adapter.emitActivity({ kind: "speech_started", provider: "deepgram", sourceLabel: "interviewer", timestamp: now });

    now += 8_500;
    (supervisor as any).runMaintenance();
    await tick();

    assert.match(lastError, /watchdog detected (speech_stalled_without_transcript|provider_activity_stalled|dead_websocket)/);
  } finally {
    supervisor.stop();
    Date.now = originalNow;
  }
});

test("STT watchdog stays quiet when VAD and final transcript arrive normally", async () => {
  const originalNow = Date.now;
  let now = 5_000;
  Date.now = () => now;

  const adapter = new FakeStreamingAdapter();
  const supervisor = new SttSupervisor({
    sourceLabel: "interviewer",
    adapters: [adapter],
    maintenanceIntervalMs: 60_000,
  });

  try {
    let errorCount = 0;
    supervisor.on("error", () => {
      errorCount += 1;
    });

    supervisor.start("watchdog-healthy");
    await tick();

    adapter.emitActivity({ kind: "provider_open", provider: "deepgram", sourceLabel: "interviewer", timestamp: now });
    adapter.emitActivity({ kind: "speech_started", provider: "deepgram", sourceLabel: "interviewer", timestamp: now });

    now += 10;
    adapter.emitTranscript({ text: "how would you design", isFinal: false, confidence: 0.88, provider: "deepgram", sourceLabel: "interviewer" });

    now += 10;
    adapter.emitActivity({ kind: "utterance_end", provider: "deepgram", sourceLabel: "interviewer", timestamp: now });
    adapter.emitTranscript({ text: "how would you design this cache?", isFinal: true, confidence: 0.92, provider: "deepgram", sourceLabel: "interviewer" });

    now += 8_500;
    (supervisor as any).runMaintenance();
    await tick();

    assert.equal(errorCount, 0);
  } finally {
    supervisor.stop();
    Date.now = originalNow;
  }
});
