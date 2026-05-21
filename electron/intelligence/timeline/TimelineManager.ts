// electron/intelligence/timeline/TimelineManager.ts
// Batched timeline management.
//
// Collects signals, batches them at a configurable interval,
// and stores batches in a circular buffer.
//
// NO UI, NO IPC — backend-only foundation.
//
// Usage:
//   const manager = new TimelineManager();
//   manager.addSignal(signal);
//   const batch = manager.flush(); // force flush
//   manager.destroy(); // cleanup

import type {
    IntelligenceSignal,
    TimelineBatch,
    TimelineConfig,
    TimelineEntry,
} from './types';

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Readonly<TimelineConfig> = {
    maxSignals: 500,
    dedupeWindowMs: 5_000,
    batchIntervalMs: 2_000,
    maxBatchSize: 3,
};

// ---------------------------------------------------------------------------
// TimelineManager
// ---------------------------------------------------------------------------

export class TimelineManager {
    private readonly config: Readonly<TimelineConfig>;
    private pendingSignals: IntelligenceSignal[] = [];
    private batches: TimelineBatch[] = [];
    private batchCounter: number = 0;
    private flushTimer: ReturnType<typeof setInterval> | null = null;

    private static readonly MAX_BATCHES = 100;

    constructor(config?: Partial<TimelineConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startAutoFlush();
    }

    // ---------------------------------------------------------------------------
    // API
    // ---------------------------------------------------------------------------

    /**
     * Add a signal to the pending batch.
     */
    addSignal(signal: IntelligenceSignal): void {
        this.pendingSignals.push(signal);

        // Auto-flush if batch is full
        if (this.pendingSignals.length >= this.config.maxBatchSize) {
            this.flush();
        }
    }

    /**
     * Flush pending signals into a batch.
     * Returns the batch, or null if nothing was pending.
     */
    flush(): TimelineBatch | null {
        if (this.pendingSignals.length === 0) {
            return null;
        }

        // Take up to maxBatchSize signals
        const batchSignals = this.pendingSignals.splice(0, this.config.maxBatchSize);

        this.batchCounter++;
        const batchId = `batch_${Date.now()}_${this.batchCounter}`;

        const entries: TimelineEntry[] = batchSignals.map((signal, index) => ({
            ...signal,
            batchId,
            renderOrder: index,
        }));

        const batch: TimelineBatch = {
            id: batchId,
            entries,
            timestamp: Date.now(),
        };

        this.batches.push(batch);
        if (this.batches.length > TimelineManager.MAX_BATCHES) {
            this.batches = this.batches.slice(-TimelineManager.MAX_BATCHES);
        }

        return batch;
    }

    /**
     * Get the flattened timeline of all entries.
     */
    getTimeline(limit: number = 50): TimelineEntry[] {
        const allEntries: TimelineEntry[] = [];
        for (const batch of this.batches) {
            allEntries.push(...batch.entries);
        }

        return allEntries.slice(-limit);
    }

    /**
     * Get recent batches.
     */
    getRecentBatches(limit: number = 10): TimelineBatch[] {
        return this.batches.slice(-limit);
    }

    /**
     * Clear all batches and pending signals.
     */
    clear(): void {
        this.pendingSignals = [];
        this.batches = [];
        this.batchCounter = 0;
    }

    /**
     * Destroy the manager — clears the flush timer and all data.
     */
    destroy(): void {
        if (this.flushTimer !== null) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        this.clear();
    }

    // ---------------------------------------------------------------------------
    // Private
    // ---------------------------------------------------------------------------

    private startAutoFlush(): void {
        if (this.flushTimer !== null) return;

        this.flushTimer = setInterval(() => {
            this.flush();
        }, this.config.batchIntervalMs);

        // Prevent the timer from keeping the process alive
        if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
            (this.flushTimer as NodeJS.Timeout).unref();
        }
    }
}
