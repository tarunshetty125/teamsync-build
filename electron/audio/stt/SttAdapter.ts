export interface SttTranscriptEvent {
  text: string;
  isFinal: boolean;
  confidence: number;
  provider?: string;
  sourceLabel?: string;
  latencyMs?: number;
}

export interface SttFatalEvent {
  error: Error;
  provider: string;
  sourceLabel: string;
  retryable: boolean;
}

export type SttTelemetryEventType =
  | "provider_started"
  | "provider_failed"
  | "failover_triggered"
  | "debug_failure_injected";

export interface SttTelemetryEvent {
  type: SttTelemetryEventType;
  provider: string;
  sourceLabel: string;
  timestamp: number;
  reason?: string;
  nextProvider?: string;
  consecutiveFailures?: number;
  disabledUntil?: number | null;
  replayBufferEntries?: number;
  replayBufferDurationMs?: number;
}

export interface SttProviderMetrics {
  provider: string;
  starts: number;
  transcripts: number;
  finalTranscripts: number;
  failures: number;
  failovers: number;
  successRate: number;
  cooldownUntil: number | null;
  lastLatencyMs?: number;
  averageLatencyMs?: number;
}

export interface SttMetricsSnapshot {
  sourceLabel: string;
  activeProvider: string;
  started: boolean;
  replayInProgress: boolean;
  pendingWrites: number;
  replayBufferEntries: number;
  replayBufferDurationMs: number;
  failoverCount: number;
  totalTranscripts: number;
  totalFinalTranscripts: number;
  transcriptsPerSecond: number;
  providers: SttProviderMetrics[];
}

export interface StreamingSttAdapter {
  readonly name: string;
  readonly sourceLabel: string;

  start(): Promise<void> | void;
  write(chunk: Buffer, timestamp?: number): void;
  stop(): Promise<void> | void;

  onTranscript(callback: (event: SttTranscriptEvent) => void): () => void;
  onFatal(callback: (event: SttFatalEvent) => void): () => void;

  isAvailable(): boolean;

  setSampleRate?(rate: number): void;
  setAudioChannelCount?(count: number): void;
  setRecognitionLanguage?(key: string): void;
  setCredentials?(path: string): void;
  notifySpeechEnded?(): void;
  finalize?(): void;
  destroy?(): void;
}
