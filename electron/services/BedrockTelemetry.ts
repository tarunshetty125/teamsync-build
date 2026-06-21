/**
 * BedrockTelemetry — Internal metrics for Bedrock runtime monitoring.
 *
 * Process-level singleton that tracks:
 *   - Request latency (avg, p50, p95, p99)
 *   - RPM (requests per minute)
 *   - Estimated TPM (tokens per minute)
 *   - 429 ThrottlingException count
 *   - Cancel count
 *   - Retry count
 *   - Error count
 *   - Inference profile usage count
 *   - Average stream duration
 *   - Average output tokens
 *
 * Metrics are in-memory only (no persistence). Reset on app restart.
 * Designed for console.log diagnostics and future IPC exposure.
 */

// ─── Sliding Window ──────────────────────────────────────────────────────

const WINDOW_MS = 60_000; // 1-minute sliding window for RPM/TPM

interface TimestampedEntry {
    ts: number;
    latencyMs: number;
    outputTokens: number;
    error: boolean;
}

// ─── Singleton ───────────────────────────────────────────────────────────

class BedrockTelemetryImpl {
    private entries: TimestampedEntry[] = [];
    private throttleCount = 0;
    private cancelCount = 0;
    private retryCount = 0;
    private inferenceProfileCount = 0;
    private totalRequests = 0;
    private totalErrors = 0;

    // ─── Recording ───────────────────────────────────────────────────

    /** Record a completed request (success or error). */
    recordRequest(latencyMs: number, outputTokens: number, error: boolean): void {
        this.totalRequests++;
        if (error) this.totalErrors++;
        this.entries.push({ ts: Date.now(), latencyMs, outputTokens, error });
        this.prune();
    }

    /** Record a 429 ThrottlingException. */
    record429(): void {
        this.throttleCount++;
    }

    /** Record a request cancellation. */
    recordCancel(): void {
        this.cancelCount++;
    }

    /** Record a retry attempt. */
    recordRetry(): void {
        this.retryCount++;
    }

    /** Record an inference profile being used instead of foundation model. */
    recordInferenceProfileUsage(): void {
        this.inferenceProfileCount++;
    }

    // ─── Queries ─────────────────────────────────────────────────────

    /** Get current metrics snapshot. */
    getMetrics(): BedrockMetrics {
        this.prune();
        const recent = this.entries.filter(e => e.ts > Date.now() - WINDOW_MS);
        const successRecent = recent.filter(e => !e.error);

        const latencies = successRecent.map(e => e.latencyMs).sort((a, b) => a - b);
        const tokens = successRecent.map(e => e.outputTokens);

        return {
            // Lifetime
            totalRequests: this.totalRequests,
            totalErrors: this.totalErrors,
            total429s: this.throttleCount,
            totalCancels: this.cancelCount,
            totalRetries: this.retryCount,
            totalInferenceProfileUsages: this.inferenceProfileCount,

            // Sliding window (1 min)
            rpm: recent.length,
            tpm: tokens.reduce((sum, t) => sum + t, 0),
            errorRate: recent.length > 0
                ? recent.filter(e => e.error).length / recent.length
                : 0,

            // Latency percentiles
            avgLatencyMs: latencies.length > 0
                ? Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length)
                : 0,
            p50LatencyMs: percentile(latencies, 0.5),
            p95LatencyMs: percentile(latencies, 0.95),
            p99LatencyMs: percentile(latencies, 0.99),

            // Token stats
            avgOutputTokens: tokens.length > 0
                ? Math.round(tokens.reduce((s, t) => s + t, 0) / tokens.length)
                : 0,
            avgStreamDurationMs: successRecent.length > 0
                ? Math.round(successRecent.reduce((s, e) => s + e.latencyMs, 0) / successRecent.length)
                : 0,
        };
    }

    /** Log current metrics to console (for diagnostics). */
    logMetrics(): void {
        const m = this.getMetrics();
        console.log('[BEDROCK_TELEMETRY]', {
            rpm: m.rpm,
            tpm: m.tpm,
            avgLatency: `${m.avgLatencyMs}ms`,
            p95Latency: `${m.p95LatencyMs}ms`,
            errorRate: `${(m.errorRate * 100).toFixed(1)}%`,
            total429s: m.total429s,
            cancels: m.totalCancels,
            retries: m.totalRetries,
            inferenceProfiles: m.totalInferenceProfileUsages,
            avgOutputTokens: m.avgOutputTokens,
        });
    }

    // ─── Internal ────────────────────────────────────────────────────

    /** Prune entries older than 5 minutes to bound memory. */
    private prune(): void {
        const cutoff = Date.now() - 5 * 60_000;
        const firstValid = this.entries.findIndex(e => e.ts > cutoff);
        if (firstValid > 0) {
            this.entries = this.entries.slice(firstValid);
        } else if (firstValid === -1 && this.entries.length > 0) {
            this.entries = [];
        }
    }
}

// ─── Metrics Interface ───────────────────────────────────────────────────

export interface BedrockMetrics {
    // Lifetime counters
    totalRequests: number;
    totalErrors: number;
    total429s: number;
    totalCancels: number;
    totalRetries: number;
    totalInferenceProfileUsages: number;

    // Sliding window (1 min)
    rpm: number;
    tpm: number;
    errorRate: number;

    // Latency
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;

    // Output
    avgOutputTokens: number;
    avgStreamDurationMs: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

// ─── Export Singleton ────────────────────────────────────────────────────

export const BedrockTelemetry = new BedrockTelemetryImpl();
