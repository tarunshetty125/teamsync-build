// electron/intelligence/multibrain/MultiBrainTelemetry.ts
// Hidden telemetry for measuring multi-brain quality before public exposure.
//
// Local only. No UI. No analytics. No cloud.
//
// Tracks:
//   - brainId, executionMs, insightCount, confidenceAverage
//   - failureRate, falsePositiveLikelihood, timestamp
//
// Persistence:
//   - Circular buffer (max 500 entries)
//   - Debounced flush to electron-store (2s coalesce)
//   - Write coalescing — multiple records batched per flush
//
// Safety:
//   - All methods wrapped in try/catch
//   - Silent failure — never affects the hot path
//   - No capability gate (telemetry runs whenever multiBrain runs)

import Store from 'electron-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MultiBrainTelemetryRecord {
    /** Schema version for forward compatibility */
    readonly version: number;
    /** Sub-brain ID */
    readonly brainId: string;
    /** Execution time in ms */
    readonly executionMs: number;
    /** Number of insights produced */
    readonly insightCount: number;
    /** Average confidence of insights (0.0–1.0) */
    readonly confidenceAverage: number;
    /** Whether execution failed */
    readonly failed: boolean;
    /**
     * Heuristic false positive likelihood (0.0–1.0).
     * Higher = more likely to be a false positive.
     * Computed as: low confidence + high insight count = suspicious
     */
    readonly falsePositiveLikelihood: number;
    /** Timestamp (unix ms) */
    readonly timestamp: number;
}

/** Aggregate stats for a single brain */
export interface MultiBrainStats {
    readonly brainId: string;
    readonly totalRuns: number;
    readonly totalFailures: number;
    readonly failureRate: number;
    readonly avgExecutionMs: number;
    readonly avgInsightCount: number;
    readonly avgConfidence: number;
    readonly avgFalsePositiveLikelihood: number;
}

// ---------------------------------------------------------------------------
// Store Schema
// ---------------------------------------------------------------------------

interface TelemetryStoreState {
    version: number;
    records: MultiBrainTelemetryRecord[];
}

const SCHEMA_VERSION = 1;
const STORE_NAME = 'teamsync-multibrain-telemetry';
const MAX_RECORDS = 500;
const FLUSH_DEBOUNCE_MS = 2_000;

// ---------------------------------------------------------------------------
// MultiBrainTelemetry
// ---------------------------------------------------------------------------

export class MultiBrainTelemetry {
    private static instance: MultiBrainTelemetry | null = null;

    private readonly store: Store<TelemetryStoreState>;
    private buffer: MultiBrainTelemetryRecord[];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    private constructor() {
        this.store = new Store<TelemetryStoreState>({
            name: STORE_NAME,
            defaults: {
                version: SCHEMA_VERSION,
                records: [],
            },
        });

        // Hydrate from persistent store
        this.buffer = this.store.get('records', []).slice(-MAX_RECORDS);
    }

    static getInstance(): MultiBrainTelemetry {
        if (!MultiBrainTelemetry.instance) {
            MultiBrainTelemetry.instance = new MultiBrainTelemetry();
        }
        return MultiBrainTelemetry.instance;
    }

    // ---------------------------------------------------------------------------
    // Recording
    // ---------------------------------------------------------------------------

    /**
     * Record telemetry for a single sub-brain execution.
     * Silent failure — never throws.
     */
    record(params: {
        readonly brainId: string;
        readonly executionMs: number;
        readonly insightCount: number;
        readonly confidenceAverage: number;
        readonly failed: boolean;
    }): void {
        try {
            const record: MultiBrainTelemetryRecord = {
                version: SCHEMA_VERSION,
                brainId: params.brainId,
                executionMs: params.executionMs,
                insightCount: params.insightCount,
                confidenceAverage: params.confidenceAverage,
                failed: params.failed,
                falsePositiveLikelihood: computeFalsePositiveLikelihood(
                    params.confidenceAverage,
                    params.insightCount,
                ),
                timestamp: Date.now(),
            };

            this.buffer.push(record);

            // Enforce circular buffer
            if (this.buffer.length > MAX_RECORDS) {
                this.buffer = this.buffer.slice(-MAX_RECORDS);
            }

            this.scheduleFlush();
        } catch {
            // Silent — telemetry failure is non-fatal
        }
    }

    /**
     * Record telemetry for a batch of sub-brain execution results.
     * Convenience method for the runSubBrains() integration point.
     */
    recordBatch(results: ReadonlyArray<{
        readonly brainId: string;
        readonly executionMs: number;
        readonly status: string;
        readonly output?: { readonly insights: ReadonlyArray<{ readonly confidence: number }> };
    }>): void {
        for (const result of results) {
            const failed = result.status !== 'success';
            const insights = result.output?.insights ?? [];
            const insightCount = insights.length;
            const confidenceAverage = insightCount > 0
                ? insights.reduce((sum, i) => sum + i.confidence, 0) / insightCount
                : 0;

            this.record({
                brainId: result.brainId,
                executionMs: result.executionMs,
                insightCount,
                confidenceAverage,
                failed,
            });
        }
    }

    // ---------------------------------------------------------------------------
    // Stats
    // ---------------------------------------------------------------------------

    /**
     * Get aggregate stats per brain.
     */
    getStats(): MultiBrainStats[] {
        const grouped = new Map<string, MultiBrainTelemetryRecord[]>();

        for (const record of this.buffer) {
            const existing = grouped.get(record.brainId);
            if (existing) {
                existing.push(record);
            } else {
                grouped.set(record.brainId, [record]);
            }
        }

        const stats: MultiBrainStats[] = [];

        for (const [brainId, records] of grouped) {
            const totalRuns = records.length;
            const totalFailures = records.filter(r => r.failed).length;

            stats.push({
                brainId,
                totalRuns,
                totalFailures,
                failureRate: totalRuns > 0 ? totalFailures / totalRuns : 0,
                avgExecutionMs: avg(records.map(r => r.executionMs)),
                avgInsightCount: avg(records.map(r => r.insightCount)),
                avgConfidence: avg(records.map(r => r.confidenceAverage)),
                avgFalsePositiveLikelihood: avg(records.map(r => r.falsePositiveLikelihood)),
            });
        }

        return stats.sort((a, b) => a.brainId.localeCompare(b.brainId));
    }

    /**
     * Get raw record count.
     */
    getRecordCount(): number {
        return this.buffer.length;
    }

    // ---------------------------------------------------------------------------
    // Private
    // ---------------------------------------------------------------------------

    private scheduleFlush(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
        }
        this.flushTimer = setTimeout(() => {
            this.flushToDisk();
        }, FLUSH_DEBOUNCE_MS);
    }

    private flushToDisk(): void {
        try {
            this.store.set('version', SCHEMA_VERSION);
            this.store.set('records', this.buffer);
        } catch {
            // Non-fatal
        }
        this.flushTimer = null;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic false positive likelihood.
 *
 * High insight count + low confidence = suspicious (likely false positives).
 * Low insight count + high confidence = likely genuine.
 */
function computeFalsePositiveLikelihood(
    confidenceAverage: number,
    insightCount: number,
): number {
    if (insightCount === 0) return 0;

    // Base: inverse of confidence (low confidence = high FP likelihood)
    const confidencePenalty = 1.0 - confidenceAverage;

    // Volume penalty: many low-confidence insights = very suspicious
    const volumePenalty = insightCount > 3 ? 0.2 : 0;

    return Math.min(1.0, confidencePenalty * 0.7 + volumePenalty + 0.1);
}

function avg(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}
