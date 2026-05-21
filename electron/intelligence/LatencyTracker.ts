// electron/intelligence/LatencyTracker.ts
// Measures and reports latency of intelligence subsystems.
//
// API: start(subsystem) / end(subsystem) — explicit, no abstraction creep.
// Deterministic, lightweight, minimal overhead.
//
// Gated by 'latencyOptimization' capability.
//
// Persistence:
//   - Circular buffer (max 200 entries)
//   - Non-blocking: records via queueMicrotask
//   - No disk writes (in-memory only — latency data is ephemeral)

import { CapabilityRegistry } from './capability/CapabilityRegistry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LatencySubsystem =
    | 'subBrains'
    | 'memoryRetrieval'
    | 'explainability'
    | 'prediction'
    | 'promptInjection';

export interface LatencyMeasurement {
    readonly subsystem: LatencySubsystem;
    readonly durationMs: number;
    readonly timestamp: number;
}

export interface LatencyReport {
    readonly subsystem: LatencySubsystem;
    readonly count: number;
    readonly avgMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly maxMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MEASUREMENTS = 200;

// ---------------------------------------------------------------------------
// LatencyTracker
// ---------------------------------------------------------------------------

export class LatencyTracker {
    private static instance: LatencyTracker | null = null;

    private measurements: LatencyMeasurement[] = [];
    private pendingStarts: Map<LatencySubsystem, number> = new Map();

    private constructor() {}

    static getInstance(): LatencyTracker {
        if (!LatencyTracker.instance) {
            LatencyTracker.instance = new LatencyTracker();
        }
        return LatencyTracker.instance;
    }

    // ---------------------------------------------------------------------------
    // Start / End API
    // ---------------------------------------------------------------------------

    /**
     * Mark the start of a subsystem measurement.
     * No-op if capability is disabled.
     */
    start(subsystem: LatencySubsystem): void {
        if (!CapabilityRegistry.getInstance().isEnabled('latencyOptimization')) {
            return;
        }
        this.pendingStarts.set(subsystem, performance.now());
    }

    /**
     * Mark the end of a subsystem measurement and record the duration.
     * No-op if capability is disabled or start was not called.
     */
    end(subsystem: LatencySubsystem): void {
        if (!CapabilityRegistry.getInstance().isEnabled('latencyOptimization')) {
            return;
        }

        const startTime = this.pendingStarts.get(subsystem);
        if (startTime === undefined) return;

        this.pendingStarts.delete(subsystem);
        const durationMs = Math.round((performance.now() - startTime) * 100) / 100;

        // Non-blocking record
        const measurement: LatencyMeasurement = {
            subsystem,
            durationMs,
            timestamp: Date.now(),
        };

        this.measurements.push(measurement);
        if (this.measurements.length > MAX_MEASUREMENTS) {
            this.measurements = this.measurements.slice(-MAX_MEASUREMENTS);
        }
    }

    // ---------------------------------------------------------------------------
    // Reports
    // ---------------------------------------------------------------------------

    /**
     * Get aggregated latency report per subsystem.
     */
    getReport(): LatencyReport[] {
        const grouped = new Map<LatencySubsystem, number[]>();

        for (const m of this.measurements) {
            const existing = grouped.get(m.subsystem);
            if (existing) {
                existing.push(m.durationMs);
            } else {
                grouped.set(m.subsystem, [m.durationMs]);
            }
        }

        const reports: LatencyReport[] = [];

        for (const [subsystem, durations] of grouped) {
            const sorted = [...durations].sort((a, b) => a - b);
            const count = sorted.length;

            reports.push({
                subsystem,
                count,
                avgMs: Math.round((sorted.reduce((a, b) => a + b, 0) / count) * 100) / 100,
                p50Ms: sorted[Math.floor(count * 0.5)] ?? 0,
                p95Ms: sorted[Math.floor(count * 0.95)] ?? 0,
                maxMs: sorted[count - 1] ?? 0,
            });
        }

        return reports.sort((a, b) => a.subsystem.localeCompare(b.subsystem));
    }

    /**
     * Get total intelligence overhead (sum of all subsystem averages).
     */
    getTotalOverhead(): number {
        const report = this.getReport();
        return report.reduce((sum, r) => sum + r.avgMs, 0);
    }

    /**
     * Get measurement count.
     */
    getMeasurementCount(): number {
        return this.measurements.length;
    }

    /**
     * Clear all measurements and pending starts.
     */
    reset(): void {
        this.measurements = [];
        this.pendingStarts.clear();
    }
}
