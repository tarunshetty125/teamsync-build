// electron/intelligence/IntelligenceBenchmark.ts
// Intelligence-specific benchmarking extension.
//
// Records metrics alongside the existing BenchmarkManager:
//   - brain execution time
//   - prompt growth
//   - memory retrieval latency
//   - prediction accuracy
//
// Local only. Privacy-safe. No renderer changes. No UI.
//
// Persistence:
//   - Circular buffer (max 100 entries)
//   - Coalesced writes to electron-store (2s debounce)

import Store from 'electron-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntelligenceBenchmarkRecord {
    readonly version: number;
    readonly timestamp: number;
    readonly brainExecutionMs: number;
    readonly promptGrowthTokens: number;
    readonly memoryRetrievalMs: number;
    readonly predictionAccuracy: number;
    readonly subBrainCount: number;
    readonly insightsInjected: number;
}

export interface IntelligenceBenchmarkSummary {
    readonly totalRecords: number;
    readonly avgBrainExecutionMs: number;
    readonly avgPromptGrowthTokens: number;
    readonly avgMemoryRetrievalMs: number;
    readonly avgPredictionAccuracy: number;
    readonly avgSubBrainCount: number;
    readonly avgInsightsInjected: number;
}

// ---------------------------------------------------------------------------
// Store Schema
// ---------------------------------------------------------------------------

interface IntelBenchStoreState {
    version: number;
    records: IntelligenceBenchmarkRecord[];
}

const SCHEMA_VERSION = 1;
const STORE_NAME = 'teamsync-intelligence-benchmark';
const MAX_RECORDS = 100;
const FLUSH_DEBOUNCE_MS = 2_000;

// ---------------------------------------------------------------------------
// IntelligenceBenchmark
// ---------------------------------------------------------------------------

export class IntelligenceBenchmark {
    private static instance: IntelligenceBenchmark | null = null;

    private readonly store: Store<IntelBenchStoreState>;
    private buffer: IntelligenceBenchmarkRecord[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    private constructor() {
        this.store = new Store<IntelBenchStoreState>({
            name: STORE_NAME,
            defaults: {
                version: SCHEMA_VERSION,
                records: [],
            },
        });
        this.buffer = this.store.get('records', []).slice(-MAX_RECORDS);
    }

    static getInstance(): IntelligenceBenchmark {
        if (!IntelligenceBenchmark.instance) {
            IntelligenceBenchmark.instance = new IntelligenceBenchmark();
        }
        return IntelligenceBenchmark.instance;
    }

    // ---------------------------------------------------------------------------
    // Recording
    // ---------------------------------------------------------------------------

    /**
     * Record an intelligence benchmark entry.
     * Silent failure — never throws.
     */
    record(params: {
        readonly brainExecutionMs: number;
        readonly promptGrowthTokens: number;
        readonly memoryRetrievalMs: number;
        readonly predictionAccuracy: number;
        readonly subBrainCount: number;
        readonly insightsInjected: number;
    }): void {
        try {
            const record: IntelligenceBenchmarkRecord = {
                version: SCHEMA_VERSION,
                timestamp: Date.now(),
                brainExecutionMs: params.brainExecutionMs,
                promptGrowthTokens: params.promptGrowthTokens,
                memoryRetrievalMs: params.memoryRetrievalMs,
                predictionAccuracy: params.predictionAccuracy,
                subBrainCount: params.subBrainCount,
                insightsInjected: params.insightsInjected,
            };

            this.buffer.push(record);
            if (this.buffer.length > MAX_RECORDS) {
                this.buffer = this.buffer.slice(-MAX_RECORDS);
            }

            this.scheduleFlush();
        } catch {
            // Silent — benchmark failure is non-fatal
        }
    }

    // ---------------------------------------------------------------------------
    // Reports
    // ---------------------------------------------------------------------------

    /**
     * Get summary statistics.
     */
    getSummary(): IntelligenceBenchmarkSummary {
        const records = this.buffer;
        const count = records.length;

        if (count === 0) {
            return {
                totalRecords: 0,
                avgBrainExecutionMs: 0,
                avgPromptGrowthTokens: 0,
                avgMemoryRetrievalMs: 0,
                avgPredictionAccuracy: 0,
                avgSubBrainCount: 0,
                avgInsightsInjected: 0,
            };
        }

        const avg = (fn: (r: IntelligenceBenchmarkRecord) => number) =>
            Math.round((records.reduce((sum, r) => sum + fn(r), 0) / count) * 100) / 100;

        return {
            totalRecords: count,
            avgBrainExecutionMs: avg(r => r.brainExecutionMs),
            avgPromptGrowthTokens: avg(r => r.promptGrowthTokens),
            avgMemoryRetrievalMs: avg(r => r.memoryRetrievalMs),
            avgPredictionAccuracy: avg(r => r.predictionAccuracy),
            avgSubBrainCount: avg(r => r.subBrainCount),
            avgInsightsInjected: avg(r => r.insightsInjected),
        };
    }

    /**
     * Get recent records.
     */
    getRecent(limit: number = 20): readonly IntelligenceBenchmarkRecord[] {
        return this.buffer.slice(-Math.max(1, limit));
    }

    // ---------------------------------------------------------------------------
    // Persistence
    // ---------------------------------------------------------------------------

    private scheduleFlush(): void {
        if (this.flushTimer !== null) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            try {
                this.store.set('version', SCHEMA_VERSION);
                this.store.set('records', this.buffer.slice(-MAX_RECORDS));
            } catch {
                // Non-fatal
            }
        }, FLUSH_DEBOUNCE_MS);
    }
}
