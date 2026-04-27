import fs from "fs";
import { GoogleSTT } from "../GoogleSTT";
import { StreamingSttAdapter, SttFatalEvent, SttTranscriptEvent } from "./SttAdapter";

type TranscriptCallback = (event: SttTranscriptEvent) => void;
type FatalCallback = (event: SttFatalEvent) => void;

function resolveGoogleCredentialsPath(): string | null {
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  try {
    // Lazy require keeps the adapter usable in tests without bootstrapping Electron services.
    const { CredentialsManager } = require("../../services/CredentialsManager");
    const savedPath = CredentialsManager.getInstance().getGoogleServiceAccountPath?.();
    if (savedPath && fs.existsSync(savedPath)) {
      return savedPath;
    }
  } catch {
    // Ignore resolver failures and fall through to unavailable state.
  }

  return null;
}

function classifyGoogleError(error: Error, sourceLabel: string): SttFatalEvent {
  const message = error.message.toLowerCase();
  const retryable =
    message.includes("timeout")
    || message.includes("network")
    || message.includes("socket")
    || message.includes("econn")
    || message.includes("epipe")
    || message.includes("unavailable")
    || message.includes("deadline")
    || message.includes("stream closed")
    || message.includes("closed");

  return {
    error,
    provider: "google",
    sourceLabel,
    retryable,
  };
}

export class GoogleStreamingSttAdapter implements StreamingSttAdapter {
  public readonly name = "google";
  public readonly sourceLabel: string;

  private provider: GoogleSTT | null = null;
  private transcriptListeners = new Set<TranscriptCallback>();
  private fatalListeners = new Set<FatalCallback>();
  private recognitionLanguage = "english-us";
  private sampleRate = 16_000;
  private audioChannelCount = 1;
  private credentialsPath: string | null = null;

  constructor(params: { sourceLabel: string }) {
    this.sourceLabel = params.sourceLabel;
    this.credentialsPath = resolveGoogleCredentialsPath();
  }

  public isAvailable(): boolean {
    return !!this.credentialsPath;
  }

  public start(): void {
    this.credentialsPath = this.credentialsPath || resolveGoogleCredentialsPath();
    if (!this.credentialsPath) {
      this.emitFatal(new Error("Google Streaming STT credentials not configured"), false);
      return;
    }

    process.env.GOOGLE_APPLICATION_CREDENTIALS = this.credentialsPath;

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

  public setCredentials(path: string): void {
    this.credentialsPath = path && fs.existsSync(path) ? path : null;
    if (this.credentialsPath) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = this.credentialsPath;
      if (this.provider) {
        this.provider.setCredentials(this.credentialsPath);
      }
    }
  }

  public notifySpeechEnded(): void {
    this.provider?.notifySpeechEnded();
  }

  public destroy(): void {
    this.provider?.removeAllListeners();
    this.provider?.stop();
    this.provider = null;
    this.transcriptListeners.clear();
    this.fatalListeners.clear();
    this.logDebug("destroy listeners_cleared");
  }

  private ensureProvider(): GoogleSTT {
    if (this.provider) {
      return this.provider;
    }

    const provider = new GoogleSTT(this.sourceLabel);
    if (this.credentialsPath) {
      provider.setCredentials(this.credentialsPath);
    }
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
      const classified = classifyGoogleError(error, this.sourceLabel);
      for (const listener of this.fatalListeners) {
        listener(classified);
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
      console.log(`[STT_DEBUG][Google/${this.sourceLabel}] ${message}`);
    }
  }
}
