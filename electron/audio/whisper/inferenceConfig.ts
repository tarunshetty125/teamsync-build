// electron/audio/whisper/inferenceConfig.ts
// Resolves ONNX Runtime execution providers and dtype for the current platform.

/** Mixed dtype for quantized Whisper models. */
const WHISPER_SAFE_DTYPE: Record<string, string> = {
  encoder_model: 'fp32',
  decoder_model: 'q8',
  decoder_model_merged: 'q8',
  decoder_with_past_model: 'q8',
};

export interface InferenceConfig {
  executionProviders: string[];
  dtype: string | Record<string, string>;
}

/** Resolve optimal ONNX execution providers and dtype for the host platform. */
export function resolveInferenceConfig(): InferenceConfig {
  const { platform, arch } = process;

  if (platform === 'darwin' && arch === 'arm64') {
    return { executionProviders: ['coreml', 'cpu'], dtype: 'fp32' };
  }
  if (platform === 'win32') {
    return { executionProviders: ['dml', 'cpu'], dtype: WHISPER_SAFE_DTYPE };
  }
  return { executionProviders: ['cpu'], dtype: WHISPER_SAFE_DTYPE };
}

/** Build the init message to send to the whisper worker thread. */
export function buildWorkerInitMessage(modelId: string) {
  const { executionProviders, dtype } = resolveInferenceConfig();
  // Lazy require to break circular dependency with modelManager
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getModelsDir } = require('./modelManager') as { getModelsDir: () => string };
  return {
    type: 'init' as const,
    modelId,
    cacheDir: getModelsDir(),
    executionProviders,
    dtype,
  };
}

