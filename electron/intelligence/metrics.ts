// electron/intelligence/metrics.ts
// Observability layer for the intelligence pipeline.
// Tracks P95 latency across modular boundaries.
//
// Used by IntelligenceEngine to log brain selection, execution time,
// and prompt overhead for monitoring and regression detection.

// ---------------------------------------------------------------------------
// Metric Types
// ---------------------------------------------------------------------------

export interface BrainExecutionMetric {
    /** Which brain was selected */
    brainId: string;

    /** Question category that drove the selection */
    category: string;

    /** Brain.execute() time in ms (should be <1ms for pure logic brains) */
    brainExecutionMs: number;

    /** Number of instructions the brain produced */
    instructionCount: number;

    /** Stream strategy selected by the brain */
    streamStrategy: string;

    /** Whether a preferred model was specified */
    preferredModel?: string;

    /** Total runAction latency (end-to-end) */
    totalLatencyMs: number;

    /** Whether the brain layer was enabled */
    brainLayerEnabled: boolean;

    /** Timestamp */
    timestamp: number;
}

export interface PipelineLatencyMetric {
    /** Action intent */
    intent: string;

    /** Session mode */
    mode: string;

    /** Context building time (buildContext) */
    contextBuildMs: number;

    /** Brain selection + execution time */
    brainMs: number;

    /** Token budget enforcement time */
    budgetEnforceMs: number;

    /** Prompt serialization time */
    serializeMs: number;

    /** LLM streaming time (first token to last token) */
    llmStreamMs: number;

    /** Total end-to-end time */
    totalMs: number;

    /** Timestamp */
    timestamp: number;
}

// ---------------------------------------------------------------------------
// Metric Collector
// ---------------------------------------------------------------------------

/**
 * Simple in-memory metric collector with circular buffer.
 * Stores the last N metrics for each type and computes P50/P95/P99.
 */
export class MetricCollector {
    private brainMetrics: BrainExecutionMetric[] = [];
    private pipelineMetrics: PipelineLatencyMetric[] = [];
    private readonly maxEntries: number;

    constructor(maxEntries: number = 500) {
        this.maxEntries = maxEntries;
    }

    recordBrainExecution(metric: BrainExecutionMetric): void {
        this.brainMetrics.push(metric);
        if (this.brainMetrics.length > this.maxEntries) {
            this.brainMetrics = this.brainMetrics.slice(-this.maxEntries);
        }
    }

    recordPipelineLatency(metric: PipelineLatencyMetric): void {
        this.pipelineMetrics.push(metric);
        if (this.pipelineMetrics.length > this.maxEntries) {
            this.pipelineMetrics = this.pipelineMetrics.slice(-this.maxEntries);
        }
    }

    /**
     * Compute percentile from a sorted array of numbers.
     */
    private percentile(sorted: number[], p: number): number {
        if (sorted.length === 0) return 0;
        const index = Math.ceil(sorted.length * (p / 100)) - 1;
        return sorted[Math.max(0, index)];
    }

    /**
     * Get brain execution statistics.
     */
    getBrainStats(): {
        count: number;
        p50Ms: number;
        p95Ms: number;
        p99Ms: number;
        byBrain: Record<string, { count: number; avgMs: number }>;
    } {
        const times = this.brainMetrics.map(m => m.brainExecutionMs).sort((a, b) => a - b);
        const byBrain: Record<string, { count: number; totalMs: number }> = {};

        for (const m of this.brainMetrics) {
            if (!byBrain[m.brainId]) {
                byBrain[m.brainId] = { count: 0, totalMs: 0 };
            }
            byBrain[m.brainId].count++;
            byBrain[m.brainId].totalMs += m.brainExecutionMs;
        }

        const byBrainAvg: Record<string, { count: number; avgMs: number }> = {};
        for (const [id, stats] of Object.entries(byBrain)) {
            byBrainAvg[id] = {
                count: stats.count,
                avgMs: Math.round((stats.totalMs / stats.count) * 100) / 100,
            };
        }

        return {
            count: times.length,
            p50Ms: this.percentile(times, 50),
            p95Ms: this.percentile(times, 95),
            p99Ms: this.percentile(times, 99),
            byBrain: byBrainAvg,
        };
    }

    /**
     * Get pipeline latency statistics.
     */
    getPipelineStats(): {
        count: number;
        p50Ms: number;
        p95Ms: number;
        p99Ms: number;
        avgBreakdown: {
            contextBuildMs: number;
            brainMs: number;
            budgetEnforceMs: number;
            serializeMs: number;
            llmStreamMs: number;
        };
    } {
        const times = this.pipelineMetrics.map(m => m.totalMs).sort((a, b) => a - b);
        const count = this.pipelineMetrics.length || 1;

        return {
            count: this.pipelineMetrics.length,
            p50Ms: this.percentile(times, 50),
            p95Ms: this.percentile(times, 95),
            p99Ms: this.percentile(times, 99),
            avgBreakdown: {
                contextBuildMs: Math.round(this.pipelineMetrics.reduce((s, m) => s + m.contextBuildMs, 0) / count),
                brainMs: Math.round(this.pipelineMetrics.reduce((s, m) => s + m.brainMs, 0) / count),
                budgetEnforceMs: Math.round(this.pipelineMetrics.reduce((s, m) => s + m.budgetEnforceMs, 0) / count),
                serializeMs: Math.round(this.pipelineMetrics.reduce((s, m) => s + m.serializeMs, 0) / count),
                llmStreamMs: Math.round(this.pipelineMetrics.reduce((s, m) => s + m.llmStreamMs, 0) / count),
            },
        };
    }

    /**
     * Get a formatted summary string (for logging).
     */
    getSummary(): string {
        const brain = this.getBrainStats();
        const pipeline = this.getPipelineStats();

        const lines = [
            `\n══════ Intelligence Pipeline Metrics ══════`,
            `Brain Executions: ${brain.count}  |  P50: ${brain.p50Ms}ms  P95: ${brain.p95Ms}ms  P99: ${brain.p99Ms}ms`,
        ];

        for (const [id, stats] of Object.entries(brain.byBrain)) {
            lines.push(`  ${id}: ${stats.count} calls, avg ${stats.avgMs}ms`);
        }

        lines.push(`Pipeline Latency: ${pipeline.count}  |  P50: ${pipeline.p50Ms}ms  P95: ${pipeline.p95Ms}ms  P99: ${pipeline.p99Ms}ms`);

        if (pipeline.count > 0) {
            const bd = pipeline.avgBreakdown;
            lines.push(`  Avg breakdown: context=${bd.contextBuildMs}ms  brain=${bd.brainMs}ms  budget=${bd.budgetEnforceMs}ms  serialize=${bd.serializeMs}ms  llm=${bd.llmStreamMs}ms`);
        }

        lines.push(`══════════════════════════════════════════\n`);
        return lines.join('\n');
    }

    /**
     * Clear all collected metrics.
     */
    clear(): void {
        this.brainMetrics = [];
        this.pipelineMetrics = [];
    }
}

// ---------------------------------------------------------------------------
// Singleton (for convenience — can also be instantiated per-engine)
// ---------------------------------------------------------------------------

let _defaultCollector: MetricCollector | null = null;

export function getDefaultMetricCollector(): MetricCollector {
    if (!_defaultCollector) {
        _defaultCollector = new MetricCollector();
    }
    return _defaultCollector;
}
