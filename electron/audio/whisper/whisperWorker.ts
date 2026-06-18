// electron/audio/whisper/whisperWorker.ts
// Worker thread that runs @huggingface/transformers Whisper pipeline.
// Receives init/transcribe/setPrompt messages from the main thread.
// Posts back ready/result/partial/error/progress messages.

import { parentPort } from 'worker_threads';

/* ── Language map ─────────────────────────────────────────── */

const LANG_MAP: Record<string, string | null> = {
  'auto': null,
  'en-US': 'english', 'en-GB': 'english',
  'fr-FR': 'french', 'de-DE': 'german', 'es-ES': 'spanish',
  'ja-JP': 'japanese', 'ko-KR': 'korean',
  'zh-CN': 'chinese', 'zh-TW': 'chinese',
  'pt-BR': 'portuguese', 'it-IT': 'italian', 'ru-RU': 'russian',
  'ar': 'arabic', 'hi-IN': 'hindi',
};

const ENGLISH_ONLY_MODELS = new Set([
  'onnx-community/moonshine-tiny-ONNX', 'onnx-community/moonshine-base-ONNX',
  'distil-whisper/distil-small.en', 'distil-whisper/distil-medium.en',
  'distil-whisper/distil-large-v2', 'distil-whisper/distil-large-v3',
  'Xenova/whisper-tiny.en', 'Xenova/whisper-base.en',
  'Xenova/whisper-small.en', 'Xenova/whisper-medium.en',
]);

const isMoonshineModel = (id: string) => /\/moonshine-/i.test(id);
const PROMPT_TOKEN_CAP = 224;

/* ── State ────────────────────────────────────────────────── */

let pipe: any = null;
let loadedModelId = '';
let cachedPromptText = '';
let cachedPromptIds: number[] | null = null;

/* ── Prompt cache ─────────────────────────────────────────── */

async function updatePromptCache(promptText: string): Promise<void> {
  const trimmed = (promptText ?? '').trim();
  if (!trimmed) { cachedPromptText = ''; cachedPromptIds = null; return; }
  if (trimmed === cachedPromptText && cachedPromptIds !== null) return;
  if (!pipe?.tokenizer) return;

  // Moonshine doesn't support prompt biasing
  if (isMoonshineModel(loadedModelId)) {
    cachedPromptText = trimmed;
    cachedPromptIds = null;
    return;
  }

  try {
    const encoded = await pipe.tokenizer(trimmed, { add_special_tokens: false });
    const raw: any[] = encoded?.input_ids?.tolist?.()?.[0] ?? [];
    cachedPromptIds = raw.slice(0, PROMPT_TOKEN_CAP).map((n: any) => {
      const v = Number(n);
      if (!Number.isSafeInteger(v)) {
        throw new Error(`Token id ${n} exceeds Number.MAX_SAFE_INTEGER — cannot use as prompt_id`);
      }
      return v;
    });
    cachedPromptText = trimmed;
    if (cachedPromptIds.length === 0) {
      console.debug('[WhisperWorker] Prompt tokenized to 0 ids — biasing disabled');
    }
  } catch (e: any) {
    console.warn('[WhisperWorker] Prompt tokenization failed:', e.message);
    cachedPromptText = '';
    cachedPromptIds = null;
  }
}

/* ── Dynamic import for ESM-only transformers ─────────────── */

async function loadTransformers(): Promise<any> {
  return new Function('return import("@huggingface/transformers")')();
}

/* ── Message handler ──────────────────────────────────────── */

if (!parentPort) throw new Error('whisperWorker must be run as a Worker thread');

parentPort.on('message', async (msg: any) => {
  if (msg.type === 'init') {
    if (msg.dtype === undefined || msg.dtype === null) {
      parentPort!.postMessage({ type: 'error', message: 'init.dtype is required (use resolveInferenceConfig().dtype)' });
      return;
    }
    try {
      const { pipeline, env } = await loadTransformers();
      env.cacheDir = msg.cacheDir;
      env.allowRemoteModels = true;
      const providers: string[] = msg.executionProviders ?? ['cpu'];
      if (env.backends?.onnx) {
        env.backends.onnx.executionProviders = providers;
      }
      const dtype = msg.dtype;
      const dtypeDesc = typeof dtype === 'string'
        ? dtype
        : 'mixed:' + Object.entries(dtype).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
      console.log(`[WhisperWorker] Loading ${msg.modelId} | providers=${providers.join(',')} | dtype=${dtypeDesc}`);

      // Progress tracking
      const fileProgress = new Map<string, number>();
      let lastPostedPct = 0;

      pipe = await pipeline('automatic-speech-recognition', msg.modelId, {
        dtype,
        progress_callback: (data: any) => {
          const key = data.file ?? data.name;
          if (!key) return;
          let val: number | null = null;
          if (data.status === 'initiate' || data.status === 'download' || data.status === 'downloading') {
            if (!fileProgress.has(key)) val = 0;
          } else if (data.status === 'progress') {
            const p = Number(data.progress);
            if (!Number.isNaN(p)) val = Math.min(100, Math.max(0, p));
          } else if (data.status === 'done') {
            val = 100;
          } else { return; }

          if (val !== null) {
            const prev = fileProgress.get(key) ?? 0;
            fileProgress.set(key, Math.max(prev, val));
          }
          if (fileProgress.size === 0) return;
          let sum = 0;
          for (const v of fileProgress.values()) sum += v;
          const avg = sum / fileProgress.size;
          const rounded = Math.min(99, Math.floor(avg));
          const next = Math.max(lastPostedPct, rounded);
          if (next === lastPostedPct) return;
          lastPostedPct = next;
          parentPort!.postMessage({ type: 'progress', modelId: msg.modelId, progress: next });
        },
      });
      loadedModelId = msg.modelId;
      cachedPromptText = '';
      cachedPromptIds = null;
      parentPort!.postMessage({ type: 'ready' });
    } catch (e: any) {
      parentPort!.postMessage({ type: 'error', message: `Failed to load model: ${e.message}` });
    }
  } else if (msg.type === 'setPrompt') {
    await updatePromptCache(msg.prompt);
  } else if (msg.type === 'transcribe') {
    if (!pipe) {
      parentPort!.postMessage({ type: 'error', message: 'Model not loaded' });
      return;
    }
    try {
      let language = LANG_MAP[msg.language] ?? null;
      const streaming = !!msg.streaming;

      if (ENGLISH_ONLY_MODELS.has(loadedModelId)) {
        language = 'english';
      }

      const opts: Record<string, any> = streaming
        ? {
            sampling_rate: 16_000, task: 'transcribe', temperature: 0,
            no_speech_threshold: 0.6, compression_ratio_threshold: 2.4,
            condition_on_previous_text: false, return_timestamps: false,
          }
        : {
            sampling_rate: 16_000, task: 'transcribe',
            condition_on_previous_text: false, compression_ratio_threshold: 2.4,
            logprob_threshold: -1, no_speech_threshold: 0.6,
          };

      if (language) opts.language = language;
      if (cachedPromptIds && cachedPromptIds.length > 0 && !isMoonshineModel(loadedModelId)) {
        opts.prompt_ids = cachedPromptIds;
      }

      const result = await pipe(msg.audio, opts);
      parentPort!.postMessage({
        type: streaming ? 'partial' : 'result',
        taskId: msg.taskId,
        text: result.text ?? '',
      });
    } catch (e: any) {
      parentPort!.postMessage({ type: 'error', taskId: msg.taskId, message: `Transcription failed: ${e.message}` });
    }
  }
});
