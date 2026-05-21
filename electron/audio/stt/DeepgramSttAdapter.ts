import { DeepgramStreamingSTT } from "../DeepgramStreamingSTT";
import { SttActivityEvent, StreamingSttAdapter, SttFatalEvent, SttTranscriptEvent } from "./SttAdapter";

type TranscriptCallback = (event: SttTranscriptEvent) => void;
type FatalCallback = (event: SttFatalEvent) => void;
type ActivityCallback = (event: SttActivityEvent) => void;

function classifyDeepgramError(error: Error, sourceLabel: string): SttFatalEvent {
  const message = error.message.toLowerCase();
  const retryable =
    message.includes("timeout")
    || message.includes("network")
    || message.includes("socket")
    || message.includes("econn")
    || message.includes("epipe")
    || message.includes("enotfound")
    || message.includes("eai_again")
    || message.includes("closed")
    || message.includes("max reconnect attempts");

  return {
    error,
    provider: "deepgram",
    sourceLabel,
    retryable,
  };
}

export class DeepgramSttAdapter implements StreamingSttAdapter {
  public readonly name = "deepgram";
  public readonly sourceLabel: string;

  private readonly apiKey?: string;
  private provider: DeepgramStreamingSTT | null = null;
  private transcriptListeners = new Set<TranscriptCallback>();
  private fatalListeners = new Set<FatalCallback>();
  private activityListeners = new Set<ActivityCallback>();
  private recognitionLanguage = "english-us";
  private sampleRate = 16_000;
  private audioChannelCount = 1;

  constructor(params: { apiKey?: string; sourceLabel: string }) {
    this.apiKey = params.apiKey?.trim() || undefined;
    this.sourceLabel = params.sourceLabel;
  }

  public isAvailable(): boolean {
    return !!this.apiKey;
  }

  public start(): void {
    if (!this.apiKey) {
      this.emitFatal(new Error("Deepgram API key not configured"), false);
      return;
    }

    const provider = this.ensureProvider();
    this.logDebug("start");
    provider.start();
  }

  public write(chunk: Buffer): void {
    this.provider?.write(chunk);
  }

  public stop(): void {
    this.logDebug("stop");
    this.provider?.stop();
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

  public onActivity(callback: ActivityCallback): () => void {
    this.activityListeners.add(callback);
    return () => {
      this.activityListeners.delete(callback);
    };
  }

  public setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.provider?.setSampleRate(rate);
  }

  public setAudioChannelCount(count: number): void {
    this.audioChannelCount = count;
    this.provider?.setAudioChannelCount(count);
  }

  public setRecognitionLanguage(key: string): void {
    this.recognitionLanguage = key;
    this.provider?.setRecognitionLanguage(key);
  }

  public setCredentials(_path: string): void {
    // Deepgram does not use credential files.
  }

  public notifySpeechEnded(): void {
    // Deepgram handles VAD server-side.
  }

  public destroy(): void {
    this.provider?.removeAllListeners();
    this.provider?.stop();
    this.provider = null;
    this.transcriptListeners.clear();
    this.fatalListeners.clear();
    this.logDebug("destroy listeners_cleared");
  }

  private ensureProvider(): DeepgramStreamingSTT {
    if (this.provider) {
      return this.provider;
    }

    const provider = new DeepgramStreamingSTT(this.apiKey!);
    provider.setRecognitionLanguage(this.recognitionLanguage);
    provider.setSampleRate(this.sampleRate);
    provider.setAudioChannelCount(this.audioChannelCount);

    provider.on("transcript", (event: SttTranscriptEvent) => {
      for (const listener of this.transcriptListeners) {
        listener({
          ...event,
          provider: this.name,
          sourceLabel: this.sourceLabel,
        });
      }
    });

    provider.on("error", (error: Error) => {
      const classified = classifyDeepgramError(error, this.sourceLabel);
      for (const listener of this.fatalListeners) {
        listener(classified);
      }
    });

    provider.on("activity", (event: Omit<SttActivityEvent, "provider" | "sourceLabel">) => {
      for (const listener of this.activityListeners) {
        listener({
          ...event,
          provider: this.name,
          sourceLabel: this.sourceLabel,
        });
      }
    });

    this.provider = provider;
    return provider;
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

  private logDebug(message: string): void {
    if (process.env.STT_DEBUG === "true") {
      console.log(`[STT_DEBUG][Deepgram/${this.sourceLabel}] ${message}`);
    }
  }
}
