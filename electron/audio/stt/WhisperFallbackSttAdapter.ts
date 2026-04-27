import { app } from "electron";
import path from "path";
import { Worker } from "worker_threads";
import { StreamingSttAdapter, SttFatalEvent, SttTranscriptEvent } from "./SttAdapter";

type TranscriptCallback = (event: SttTranscriptEvent) => void;
type FatalCallback = (event: SttFatalEvent) => void;

interface QueuedSegment {
  requestId: string;
  audio: Buffer;
  sampleRate: number;
  channelCount: number;
  queuedAt: number;
}

export class WhisperFallbackSttAdapter implements StreamingSttAdapter {
  public readonly name = "whisper-local";
  public readonly sourceLabel: string;

  private transcriptListeners = new Set<TranscriptCallback>();
  private fatalListeners = new Set<FatalCallback>();
  private readonly enabled: boolean;
  private readonly modelId: string;
  private readonly allowRemoteModels: boolean;
  private readonly modelPath: string;
  private recognitionLanguage = "english-us";
  private sampleRate = 16_000;
  private audioChannelCount = 1;
  private started = false;
  private destroyed = false;
  private currentBuffers: Buffer[] = [];
  private bufferedBytes = 0;
  private segmentQueue: QueuedSegment[] = [];
  private transcriptionInFlight = false;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private loadPromise: Promise<void> | null = null;
  private worker: Worker | null = null;
  private workerReady = false;
  private requestResolvers = new Map<string, {
    resolve: (payload: { text: string; latencyMs: number }) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private requestCounter = 0;
  private readonly timeoutMs = Math.max(2_000, Number(process.env.STT_WHISPER_TIMEOUT_MS || 15_000));
  private readonly maxBufferedBytes = Math.max(256 * 1024, Number(process.env.STT_WHISPER_MAX_BUFFERED_BYTES || 4 * 1024 * 1024));
  private readonly maxQueuedSegments = Math.max(1, Number(process.env.STT_WHISPER_MAX_QUEUED_SEGMENTS || 4));

  constructor(params: { sourceLabel: string; enabled?: boolean; modelId?: string }) {
    this.sourceLabel = params.sourceLabel;
    this.enabled = params.enabled ?? process.env.ENABLE_WHISPER_STT === "true";
    this.modelId = params.modelId || process.env.STT_WHISPER_MODEL || "Xenova/whisper-tiny.en";
    this.allowRemoteModels = process.env.STT_WHISPER_ALLOW_REMOTE === "true";
    this.modelPath = path.join(
      app.isPackaged ? process.resourcesPath : path.join(__dirname, "../../../../resources"),
      "models",
    );
  }

  public isAvailable(): boolean {
    return this.enabled;
  }

  public start(): void {
    if (!this.enabled) {
      this.emitFatal(new Error("Local Whisper fallback is disabled"), false);
      return;
    }

    this.started = true;
    this.destroyed = false;
    this.logDebug("start");
    this.warmup();
  }

  public write(chunk: Buffer): void {
    if (!this.started || this.destroyed || chunk.length === 0) {
      return;
    }

    const copy = Buffer.from(chunk);
    this.currentBuffers.push(copy);
    this.bufferedBytes += copy.length;
    this.trimBufferedAudio();

    if (this.getBufferedDurationMs() >= 20_000) {
      this.flushCurrentSegment();
      return;
    }

    this.scheduleInactivityFlush();
  }

  public stop(): void {
    this.started = false;
    this.clearInactivityTimer();
    this.currentBuffers = [];
    this.bufferedBytes = 0;
    this.segmentQueue = [];
    this.transcriptionInFlight = false;
    this.rejectPendingRequests(new Error("Whisper fallback stopped"));
    this.terminateWorker();
    this.logDebug("stop cleanup_complete");
  }

  public destroy(): void {
    this.stop();
    this.destroyed = true;
    this.terminateWorker();
    this.transcriptListeners.clear();
    this.fatalListeners.clear();
    this.logDebug("destroy listeners_cleared");
  }

  public onTranscript(callback: TranscriptCallback): () => void {
    this.transcriptListeners.add(callback);
    return () => {
      this.transcriptListeners.delete(callback);
    };
  }

  public onFatal(callback: FatalCallback): () => void {
    this.fatalListeners.add(callback);
    return () => {
      this.fatalListeners.delete(callback);
    };
  }

  public setSampleRate(rate: number): void {
    this.sampleRate = rate;
  }

  public setAudioChannelCount(count: number): void {
    this.audioChannelCount = Math.max(1, count);
  }

  public setRecognitionLanguage(key: string): void {
    this.recognitionLanguage = key;
  }

  public notifySpeechEnded(): void {
    this.flushCurrentSegment();
  }

  public finalize(): void {
    this.flushCurrentSegment();
  }

  private warmup(): void {
    void this.ensureLoaded().catch((error) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.emitFatal(failure, false);
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.worker && this.workerReady) {
      return;
    }

    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    this.loadPromise = (async () => {
      const workerPath = path.join(__dirname, "WhisperWorker.js");
      this.worker = new Worker(workerPath);
      this.workerReady = false;

      this.worker.on("message", (message: any) => {
        if (message?.type === "ready") {
          this.workerReady = true;
          return;
        }

        const requestId = typeof message?.requestId === "string" ? message.requestId : "";
        const pending = this.requestResolvers.get(requestId);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeout);
        this.requestResolvers.delete(requestId);

        if (message?.type === "result") {
          pending.resolve({
            text: typeof message.text === "string" ? message.text : "",
            latencyMs: Number(message.latencyMs || 0),
          });
          return;
        }

        pending.reject(new Error(typeof message?.message === "string" ? message.message : "Whisper worker error"));
      });

      this.worker.on("error", (error) => {
        this.rejectPendingRequests(error instanceof Error ? error : new Error(String(error)));
      });

      this.worker.on("exit", (code) => {
        this.workerReady = false;
        this.worker = null;
        if (code !== 0) {
          this.rejectPendingRequests(new Error(`Whisper worker exited with code ${code}`));
        }
      });

      await new Promise<void>((resolve, reject) => {
        if (!this.worker) {
          reject(new Error("Whisper worker not initialized"));
          return;
        }

        const initTimeout = setTimeout(() => {
          this.worker?.off("message", readyHandler);
          reject(new Error(`Whisper worker init timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs);

        const readyHandler = (message: any) => {
          if (message?.type === "ready") {
            this.worker?.off("message", readyHandler);
            clearTimeout(initTimeout);
            resolve();
          }
        };

        const errorHandler = (error: Error) => {
          this.worker?.off("message", readyHandler);
          this.worker?.off("error", errorHandler);
          clearTimeout(initTimeout);
          reject(error);
        };

        this.worker.on("message", readyHandler);
        this.worker.once("error", errorHandler);
        this.worker.postMessage({
          type: "init",
          modelId: this.modelId,
          modelPath: this.modelPath,
          allowRemoteModels: this.allowRemoteModels,
        });
      });
    })();

    try {
      await this.loadPromise;
    } catch (error) {
      this.loadPromise = null;
      throw error;
    }
  }

  private scheduleInactivityFlush(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      this.flushCurrentSegment();
    }, 1_200);
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  private flushCurrentSegment(): void {
    if (!this.started || this.destroyed || this.currentBuffers.length === 0) {
      return;
    }

    this.clearInactivityTimer();

    const audio = Buffer.concat(this.currentBuffers);
    const segment: QueuedSegment = {
      requestId: `${this.sourceLabel}-${Date.now()}-${this.requestCounter++}`,
      audio,
      sampleRate: this.sampleRate,
      channelCount: this.audioChannelCount,
      queuedAt: Date.now(),
    };

    this.currentBuffers = [];
    this.bufferedBytes = 0;
    this.enqueueSegment(segment);
    this.processQueue();
  }

  private processQueue(): void {
    if (this.transcriptionInFlight || this.segmentQueue.length === 0 || !this.started || this.destroyed) {
      return;
    }

    this.transcriptionInFlight = true;
    setImmediate(() => {
      void this.runQueuedTranscription();
    });
  }

  private async runQueuedTranscription(): Promise<void> {
    const segment = this.segmentQueue.shift();
    if (!segment) {
      this.transcriptionInFlight = false;
      return;
    }

    try {
      await this.ensureLoaded();
      const audio = this.toFloat32Mono(segment.audio, segment.channelCount);
      const { text, latencyMs } = await this.transcribeWithTimeout(segment.requestId, audio, segment.sampleRate);

      const normalized = text.trim();
      if (this.started && !this.destroyed && normalized.length > 0) {
        if (this.isDebugEnabled()) {
          console.log(
            `[STT_DEBUG][Whisper/${this.sourceLabel}] transcript latency=${latencyMs}ms queueWait=${Date.now() - segment.queuedAt}ms`
          );
        }
        for (const listener of this.transcriptListeners) {
          listener({
            text: normalized,
            isFinal: true,
            confidence: 0.55,
            provider: this.name,
            sourceLabel: this.sourceLabel,
            latencyMs,
          });
        }
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const retryable = /timed out|timeout/i.test(failure.message);
      this.emitFatal(
        new Error(`[Whisper/${this.sourceLabel}] ${failure.message} (${this.recognitionLanguage})`),
        retryable,
      );
    } finally {
      this.transcriptionInFlight = false;
      if (this.segmentQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  private transcribeWithTimeout(requestId: string, audio: Float32Array, sampleRate: number): Promise<{ text: string; latencyMs: number }> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Whisper worker is not available"));
        return;
      }

      const timeout = setTimeout(() => {
        this.requestResolvers.delete(requestId);
        this.terminateWorker();
        reject(new Error(`Whisper transcription timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.requestResolvers.set(requestId, {
        resolve,
        reject,
        timeout,
      });

      const transferBuffer = audio.buffer.slice(
        audio.byteOffset,
        audio.byteOffset + audio.byteLength,
      ) as ArrayBuffer;

      this.worker.postMessage({
        type: "transcribe",
        requestId,
        audioBuffer: transferBuffer,
        sampleRate,
      }, [transferBuffer]);
    });
  }

  private getBufferedDurationMs(): number {
    const sampleBytes = 2 * Math.max(1, this.audioChannelCount);
    if (sampleBytes <= 0 || this.sampleRate <= 0) {
      return 0;
    }

    return Math.round((this.bufferedBytes / sampleBytes / this.sampleRate) * 1000);
  }

  private toFloat32Mono(buffer: Buffer, channelCount: number): Float32Array {
    const normalizedChannels = Math.max(1, channelCount);
    const sampleCount = Math.floor(buffer.length / 2);
    const frameCount = Math.floor(sampleCount / normalizedChannels);
    const output = new Float32Array(frameCount);

    let outIndex = 0;
    for (let sampleIndex = 0; sampleIndex < frameCount * normalizedChannels; sampleIndex += normalizedChannels) {
      let mixed = 0;
      for (let channelIndex = 0; channelIndex < normalizedChannels; channelIndex++) {
        const byteOffset = (sampleIndex + channelIndex) * 2;
        mixed += buffer.readInt16LE(byteOffset) / 32768;
      }
      output[outIndex++] = mixed / normalizedChannels;
    }

    return output;
  }

  private emitFatal(error: Error, retryable: boolean): void {
    const payload: SttFatalEvent = {
      error,
      provider: this.name,
      sourceLabel: this.sourceLabel,
      retryable,
    };

    setImmediate(() => {
      for (const listener of this.fatalListeners) {
        listener(payload);
      }
    });
  }

  private rejectPendingRequests(error: Error): void {
    for (const [requestId, pending] of this.requestResolvers) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.requestResolvers.delete(requestId);
    }
  }

  private terminateWorker(): void {
    if (this.worker) {
      void this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
    this.loadPromise = null;
  }

  private isDebugEnabled(): boolean {
    return process.env.STT_DEBUG === "true";
  }

  private enqueueSegment(segment: QueuedSegment): void {
    if (this.segmentQueue.length >= this.maxQueuedSegments) {
      const latest = this.segmentQueue[this.segmentQueue.length - 1];
      if (latest && latest.audio.length + segment.audio.length <= this.maxBufferedBytes) {
        latest.audio = Buffer.concat([latest.audio, segment.audio]);
        latest.queuedAt = segment.queuedAt;
        this.logDebug(`backpressure_coalesce queue=${this.segmentQueue.length}`);
        return;
      }

      const dropped = this.segmentQueue.shift();
      this.logDebug(`backpressure_drop_segment droppedBytes=${dropped?.audio.length || 0}`);
    }

    this.segmentQueue.push(segment);
  }

  private trimBufferedAudio(): void {
    while (this.bufferedBytes > this.maxBufferedBytes && this.currentBuffers.length > 0) {
      const dropped = this.currentBuffers.shift();
      this.bufferedBytes = Math.max(0, this.bufferedBytes - (dropped?.length || 0));
      this.logDebug(`buffer_trim droppedBytes=${dropped?.length || 0}`);
    }
  }

  private logDebug(message: string): void {
    if (this.isDebugEnabled()) {
      console.log(`[STT_DEBUG][Whisper/${this.sourceLabel}] ${message}`);
    }
  }
}
