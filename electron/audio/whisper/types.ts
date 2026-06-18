// electron/audio/whisper/types.ts
// Type definitions for the Whisper subsystem.

/** Message types sent from main thread → worker. */
export interface WorkerInitMessage {
  type: 'init';
  modelId: string;
  cacheDir: string;
  executionProviders: string[];
  dtype: string | Record<string, string>;
}

export interface WorkerTranscribeMessage {
  type: 'transcribe';
  taskId: string;
  audio: Float32Array;
  language: string;
  streaming?: boolean;
}

export interface WorkerSetPromptMessage {
  type: 'setPrompt';
  prompt: string;
}

export type WorkerInboundMessage =
  | WorkerInitMessage
  | WorkerTranscribeMessage
  | WorkerSetPromptMessage;

/** Message types sent from worker → main thread. */
export interface WorkerReadyMessage {
  type: 'ready';
}

export interface WorkerProgressMessage {
  type: 'progress';
  modelId: string;
  progress: number;
}

export interface WorkerResultMessage {
  type: 'result' | 'partial';
  taskId: string;
  text: string;
}

export interface WorkerErrorMessage {
  type: 'error';
  taskId?: string;
  message: string;
}

export type WorkerOutboundMessage =
  | WorkerReadyMessage
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

/** Speech segment from VAD. */
export interface SpeechSegment {
  samples: Float32Array;
  durationMs: number;
}

/** Model catalog entry. */
export interface WhisperModelInfo {
  id: string;
  name: string;
  sizeMb: number;
  speed: 'very-fast' | 'fast' | 'medium' | 'slow';
  accuracy: 'decent' | 'good' | 'high' | 'very-high';
  multilingual: boolean;
  status: 'available' | 'missing';
  streaming?: boolean;
  distilled?: boolean;
  requiresAppleSilicon?: boolean;
}

/** Hardware detection result. */
export interface HardwareInfo {
  arch: string;
  platform: string;
  cpuModel: string;
  isAppleSilicon: boolean;
  totalRamGb: number;
  tier: 'excellent' | 'good' | 'limited';
  recommendation: string;
  recommendedModel: string;
}
