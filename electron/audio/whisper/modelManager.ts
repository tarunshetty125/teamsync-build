// electron/audio/whisper/modelManager.ts
// Manages Whisper/Moonshine model downloads, caching, and catalog.

import * as path from 'path';
import * as fs from 'fs';
import type { WhisperModelInfo } from './types';

/* ── Model catalog ────────────────────────────────────────── */

const MODEL_CATALOG: WhisperModelInfo[] = [
  // Moonshine — streaming-native ASR. ~100× lower latency than Whisper Large v3.
  { id: 'onnx-community/moonshine-tiny-ONNX', name: 'Moonshine Tiny', sizeMb: 26, speed: 'very-fast', accuracy: 'good', multilingual: false, status: 'missing', streaming: true },
  { id: 'onnx-community/moonshine-base-ONNX', name: 'Moonshine Base', sizeMb: 60, speed: 'very-fast', accuracy: 'very-high', multilingual: false, status: 'missing', streaming: true },
  // Distil-Whisper — 6× faster at near-equivalent WER. English-only.
  { id: 'distil-whisper/distil-small.en', name: 'Distil Small EN', sizeMb: 164, speed: 'very-fast', accuracy: 'high', multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-medium.en', name: 'Distil Medium EN', sizeMb: 383, speed: 'fast', accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-large-v3', name: 'Distil Large v3', sizeMb: 731, speed: 'medium', accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },
  { id: 'distil-whisper/distil-large-v2', name: 'Distil Large v2', sizeMb: 731, speed: 'medium', accuracy: 'very-high', multilingual: false, status: 'missing', distilled: true },
  // Whisper Large v3 Turbo — 6× faster, multilingual.
  { id: 'onnx-community/whisper-large-v3-turbo-ONNX', name: 'Whisper Large v3 Turbo', sizeMb: 1031, speed: 'medium', accuracy: 'very-high', multilingual: true, status: 'missing' },
  // Standard Whisper
  { id: 'Xenova/whisper-tiny.en', name: 'Tiny English', sizeMb: 39, speed: 'very-fast', accuracy: 'decent', multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-tiny', name: 'Tiny Multilingual', sizeMb: 74, speed: 'very-fast', accuracy: 'decent', multilingual: true, status: 'missing' },
  { id: 'Xenova/whisper-base.en', name: 'Base English', sizeMb: 142, speed: 'fast', accuracy: 'good', multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-base', name: 'Base Multilingual', sizeMb: 145, speed: 'fast', accuracy: 'good', multilingual: true, status: 'missing' },
  { id: 'Xenova/whisper-small.en', name: 'Small English', sizeMb: 244, speed: 'medium', accuracy: 'high', multilingual: false, status: 'missing' },
  { id: 'Xenova/whisper-small', name: 'Small Multilingual', sizeMb: 466, speed: 'medium', accuracy: 'high', multilingual: true, status: 'missing' },
  { id: 'Xenova/whisper-medium.en', name: 'Medium English', sizeMb: 1500, speed: 'slow', accuracy: 'very-high', multilingual: false, status: 'missing', requiresAppleSilicon: true },
  { id: 'Xenova/whisper-medium', name: 'Medium Multilingual', sizeMb: 1530, speed: 'slow', accuracy: 'very-high', multilingual: true, status: 'missing', requiresAppleSilicon: true },
];

const DTYPE_SUFFIX: Record<string, string> = {
  fp32: '', fp16: '_fp16', int8: '_int8', uint8: '_uint8',
  q8: '_quantized', q4: '_q4', q4f16: '_q4f16', bnb4: '_bnb4',
};

/* ── Public API ───────────────────────────────────────────── */

/** Get the on-disk models directory (inside Electron userData). */
export function getModelsDir(): string {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'whisper-models');
}

/** Configure @huggingface/transformers cache directory. */
export function configureTransformersCache(): void {
  new Function('return import("@huggingface/transformers")')()
    .then(({ env }: any) => {
      env.cacheDir = getModelsDir();
      env.allowRemoteModels = true;
    })
    .catch(() => { /* noop — transformers not installed */ });
}

function modelIdToCacheDir(modelId: string): string {
  return modelId;
}

function dtypeForFile(file: string, dtype: string | Record<string, string>): string {
  if (typeof dtype === 'string') return dtype;
  return (dtype as Record<string, string>)[file] ?? 'fp32';
}

function onnxFilename(basename: string, dt: string): string {
  return `${basename}${DTYPE_SUFFIX[dt] ?? ''}.onnx`;
}

function expectedOnnxFiles(dtype: string | Record<string, string>) {
  const enc = onnxFilename('encoder_model', dtypeForFile('encoder_model', dtype));
  const merged = onnxFilename('decoder_model_merged', dtypeForFile('decoder_model_merged', dtype));
  const split = [
    onnxFilename('decoder_model', dtypeForFile('decoder_model', dtype)),
    onnxFilename('decoder_with_past_model', dtypeForFile('decoder_with_past_model', dtype)),
  ];
  return { encoder: enc, decoderOptions: [[merged], split] };
}

/** Check if a model is cached on disk. */
export function isModelCached(modelId: string, dtype?: string | Record<string, string>): boolean {
  const cacheDir = getModelsDir();
  const modelDir = path.join(cacheDir, modelIdToCacheDir(modelId));
  if (!fs.existsSync(modelDir)) return false;
  if (!dtype) {
    try { return fs.readdirSync(modelDir).length > 0; } catch { return false; }
  }
  const onnxDir = path.join(modelDir, 'onnx');
  if (!fs.existsSync(onnxDir)) return false;
  const { encoder, decoderOptions } = expectedOnnxFiles(dtype);
  if (!fs.existsSync(path.join(onnxDir, encoder))) return false;
  return decoderOptions.some(opt => opt.every(f => fs.existsSync(path.join(onnxDir, f))));
}

/** Get the full model catalog with availability status. */
export function getAvailableModels(): WhisperModelInfo[] {
  let dtype: string | Record<string, string> | undefined;
  try {
    const { resolveInferenceConfig } = require('./inferenceConfig');
    dtype = resolveInferenceConfig().dtype;
  } catch { dtype = undefined; }
  return MODEL_CATALOG.map(m => ({
    ...m,
    status: isModelCached(m.id, dtype) ? 'available' as const : 'missing' as const,
  }));
}

/** Delete a model from disk. */
export function deleteModel(modelId: string): void {
  const cacheDir = getModelsDir();
  const modelDir = path.join(cacheDir, modelIdToCacheDir(modelId));
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    console.log(`[modelManager] Deleted model: ${modelId}`);
  }
}
