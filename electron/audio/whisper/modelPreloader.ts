// electron/audio/whisper/modelPreloader.ts
// Pre-warms a Whisper worker thread so the first inference is fast.
// Maintains at most one warm worker at a time.

import { Worker } from 'worker_threads';
import { buildWorkerInitMessage } from './inferenceConfig';
import { resolveWhisperWorkerPath } from './workerPathResolver';

export class ModelPreloader {
  private warmWorker: Worker | null = null;
  private warmModelId: string | null = null;
  private loadingWorker: Worker | null = null;
  private pendingModelId: string | null = null;
  private loading = false;

  /**
   * Warm up a worker for the given model ID.
   * No-ops if already warm or loading for the same model.
   * Cancels an in-progress load if a different model is requested.
   */
  preload(modelId: string): void {
    if (this.warmModelId === modelId && this.warmWorker) return;
    if (this.pendingModelId === modelId && this.loading) return;

    // Cancel any in-progress load
    if (this.loadingWorker) {
      this.loadingWorker.terminate();
      this.loadingWorker = null;
    }
    if (this.warmWorker) {
      this.warmWorker.terminate();
      this.warmWorker = null;
      this.warmModelId = null;
    }

    this.loading = true;
    this.pendingModelId = modelId;
    console.log(`[ModelPreloader] Warming worker for ${modelId}...`);

    const workerPath = resolveWhisperWorkerPath();
    const w = new Worker(workerPath);
    this.loadingWorker = w;

    w.on('message', (msg: any) => {
      if (msg.type === 'ready') {
        console.log(`[ModelPreloader] Worker warm for ${modelId}`);
        this.warmWorker = w;
        this.loadingWorker = null;
        this.warmModelId = modelId;
        this.pendingModelId = null;
        this.loading = false;
      } else if (msg.type === 'error') {
        console.warn(`[ModelPreloader] Worker init failed: ${msg.message}`);
        w.terminate();
        this.loadingWorker = null;
        this.pendingModelId = null;
        this.loading = false;
      }
    });

    w.on('error', (err: Error) => {
      console.warn('[ModelPreloader] Worker error:', err.message);
      this.loadingWorker = null;
      this.pendingModelId = null;
      this.loading = false;
    });

    w.postMessage(buildWorkerInitMessage(modelId));
  }

  /**
   * Hand off the warm worker to a caller and clear the cache.
   * Returns null if no warm worker is available for that model.
   */
  takeWarmWorker(modelId: string): Worker | null {
    if (this.warmModelId === modelId && this.warmWorker) {
      const w = this.warmWorker;
      this.warmWorker = null;
      this.warmModelId = null;
      console.log(`[ModelPreloader] Handing off warm worker for ${modelId}`);
      return w;
    }
    return null;
  }

  isWarm(modelId: string): boolean {
    return this.warmModelId === modelId && this.warmWorker !== null;
  }

  terminate(): void {
    this.loadingWorker?.terminate();
    this.loadingWorker = null;
    this.warmWorker?.terminate();
    this.warmWorker = null;
    this.warmModelId = null;
    this.pendingModelId = null;
    this.loading = false;
  }
}

/** Singleton preloader instance. */
export const modelPreloader = new ModelPreloader();
