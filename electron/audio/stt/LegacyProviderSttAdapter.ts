import { EventEmitter } from "events";
import { ElevenLabsStreamingSTT } from "../ElevenLabsStreamingSTT";
import { OpenAIStreamingSTT } from "../OpenAIStreamingSTT";
import { RestSTT, type RestSttProvider } from "../RestSTT";
import { SonioxStreamingSTT } from "../SonioxStreamingSTT";
import { TeamSyncProSTT } from "../TeamSyncProSTT";
import { StreamingSttAdapter, SttFatalEvent, SttTranscriptEvent } from "./SttAdapter";

type TranscriptCallback = (event: SttTranscriptEvent) => void;
type FatalCallback = (event: SttFatalEvent) => void;

export type LegacyPrimarySttProvider =
  | "groq"
  | "openai"
  | "elevenlabs"
  | "azure"
  | "ibmwatson"
  | "soniox"
  | "teamsync";

type LegacyProviderInstance =
  | RestSTT
  | OpenAIStreamingSTT
  | ElevenLabsStreamingSTT
  | SonioxStreamingSTT
  | TeamSyncProSTT;

interface LegacyProviderSttAdapterParams {
  provider: LegacyPrimarySttProvider;
  sourceLabel: string;
  apiKey?: string;
  region?: string;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    const message =
      (typeof candidate.message === "string" && candidate.message)
      || (typeof candidate.error === "string" && candidate.error)
      || JSON.stringify(candidate);
    return new Error(message || "Unknown STT provider error");
  }

  return new Error("Unknown STT provider error");
}

function classifyLegacyError(provider: LegacyPrimarySttProvider, error: Error, sourceLabel: string): SttFatalEvent {
  const message = error.message.toLowerCase();
  const retryable =
    !(
      message.includes("401")
      || message.includes("403")
      || message.includes("404")
      || message.includes("auth")
      || message.includes("invalid")
      || message.includes("forbidden")
      || message.includes("permission")
      || message.includes("quota")
      || message.includes("scope")
      || message.includes("subscription")
      || message.includes("unauthorized")
    )
    && (
      message.includes("closed")
      || message.includes("connect")
      || message.includes("deadline")
      || message.includes("eai_again")
      || message.includes("econn")
      || message.includes("enotfound")
      || message.includes("epipe")
      || message.includes("max reconnect")
      || message.includes("network")
      || message.includes("rate limit")
      || message.includes("socket")
      || message.includes("stream")
      || message.includes("timeout")
      || message.includes("upstream")
      || message.includes("ws")
    );

  return {
    error,
    provider,
    sourceLabel,
    retryable,
  };
}

export class LegacyProviderSttAdapter implements StreamingSttAdapter {
  public readonly name: LegacyPrimarySttProvider;
  public readonly sourceLabel: string;

  private readonly apiKey?: string;
  private readonly region?: string;
  private provider: LegacyProviderInstance | null = null;
  private transcriptListeners = new Set<TranscriptCallback>();
  private fatalListeners = new Set<FatalCallback>();
  private recognitionLanguage = "english-us";
  private sampleRate = 16_000;
  private audioChannelCount = 1;

  constructor(params: LegacyProviderSttAdapterParams) {
    this.name = params.provider;
    this.sourceLabel = params.sourceLabel;
    this.apiKey = params.apiKey?.trim() || undefined;
    this.region = params.region?.trim() || undefined;
  }

  public isAvailable(): boolean {
    return !!this.apiKey;
  }

  public start(): void {
    if (!this.apiKey) {
      this.emitFatal(new Error(`${this.name} STT API key not configured`), false);
      return;
    }

    this.ensureProvider().start();
  }

  public write(chunk: Buffer): void {
    this.provider?.write(chunk);
  }

  public stop(): void {
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
    this.provider?.setSampleRate?.(rate);
  }

  public setAudioChannelCount(count: number): void {
    this.audioChannelCount = count;
    this.provider?.setAudioChannelCount?.(count);
  }

  public setRecognitionLanguage(key: string): void {
    this.recognitionLanguage = key;
    this.provider?.setRecognitionLanguage?.(key);
  }

  public setCredentials(_path: string): void {
    // These providers do not use file-based credentials.
  }

  public notifySpeechEnded(): void {
    const provider = this.provider as (LegacyProviderInstance & {
      notifySpeechEnded?: () => void;
      finalize?: () => void;
    }) | null;

    if (typeof provider?.notifySpeechEnded === "function") {
      provider.notifySpeechEnded();
      return;
    }
    if (typeof provider?.finalize === "function") {
      provider.finalize();
    }
  }

  public finalize(): void {
    this.notifySpeechEnded();
  }

  public destroy(): void {
    this.provider?.removeAllListeners?.();
    this.provider?.stop();
    this.provider = null;
    this.transcriptListeners.clear();
    this.fatalListeners.clear();
  }

  private ensureProvider(): LegacyProviderInstance {
    if (this.provider) {
      return this.provider;
    }

    const provider = this.createProvider();
    provider.setRecognitionLanguage?.(this.recognitionLanguage);
    provider.setSampleRate?.(this.sampleRate);
    provider.setAudioChannelCount?.(this.audioChannelCount);

    provider.on("transcript", (event: SttTranscriptEvent) => {
      for (const listener of this.transcriptListeners) {
        listener({
          ...event,
          provider: this.name,
          sourceLabel: this.sourceLabel,
        });
      }
    });

    provider.on("error", (error: unknown) => {
      const normalized = normalizeError(error);
      const classified = classifyLegacyError(this.name, normalized, this.sourceLabel);
      for (const listener of this.fatalListeners) {
        listener(classified);
      }
    });

    this.provider = provider;
    return provider;
  }

  private createProvider(): LegacyProviderInstance {
    const apiKey = this.apiKey!;

    switch (this.name) {
      case "groq":
      case "azure":
      case "ibmwatson":
        return new RestSTT(this.name as RestSttProvider, apiKey, undefined, this.region);
      case "openai":
        return new OpenAIStreamingSTT(apiKey);
      case "elevenlabs":
        return new ElevenLabsStreamingSTT(apiKey);
      case "soniox":
        return new SonioxStreamingSTT(apiKey);
      case "teamsync":
        return new TeamSyncProSTT(apiKey, this.sourceLabel === "interviewer" ? "system" : "mic");
      default:
        throw new Error(`Unsupported legacy STT provider: ${this.name}`);
    }
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
}
