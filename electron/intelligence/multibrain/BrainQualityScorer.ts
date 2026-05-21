// electron/intelligence/multibrain/BrainQualityScorer.ts
// Computes quality metrics per sub-brain from telemetry data.
//
// Local only. No analytics. No cloud. No auto-learning.
// Pull-based diagnostics: call getReport() or getRecommendation().
// No console spam. No periodic logging.
//
// Persistence:
//   - Circular buffer (max 100 reports)
//   - Coalesced writes to electron-store (2s debounce)
//
// Gated by 'brainQualityScoring' capability.

import Store from 'electron-store';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';
import { MultiBrainTelemetry } from './MultiBrainTelemetry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrainQualityReport {
    readonly brainId: string;
    readonly avgConfidence: number;
    readonly usefulness: number;
    readonly falsePositiveRisk: number;
    readonly precisionEstimate: number;
    readonly recommendedWeight: number;
    readonly recommendation: string;
    readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Store Schema
// ---------------------------------------------------------------------------

interface QualityStoreState {
    version: number;
    reports: BrainQualityReport[];
}

const SCHEMA_VERSION = 1;
const STORE_NAME = 'teamsync-brain-quality';
const MAX_REPORTS = 100;
const FLUSH_DEBOUNCE_MS = 2_000;

/** Threshold above which usefulness is considered acceptable */
const USEFULNESS_THRESHOLD = 0.5;
/** Threshold above which FP risk is considered concerning */
const FP_RISK_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// BrainQualityScorer
// ---------------------------------------------------------------------------

export class BrainQualityScorer {
    private static instance: BrainQualityScorer | null = null;

    private readonly store: Store<QualityStoreState>;
    private reportBuffer: BrainQualityReport[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    private constructor() {
        this.store = new Store<QualityStoreState>({
            name: STORE_NAME,
            defaults: {
                version: SCHEMA_VERSION,
                reports: [],
            },
        });
        this.reportBuffer = this.store.get('reports', []).slice(-MAX_REPORTS);
    }

    static getInstance(): BrainQualityScorer {
        if (!BrainQualityScorer.instance) {
            BrainQualityScorer.instance = new BrainQualityScorer();
        }
        return BrainQualityScorer.instance;
    }

    // ---------------------------------------------------------------------------
    // Report Generation
    // ---------------------------------------------------------------------------

    /**
     * Compute quality reports for all brains from telemetry.
     * Pull-based only — call this when you want the data.
     * Returns null if capability is disabled.
     */
    getReport(): BrainQualityReport[] | null {
        if (!CapabilityRegistry.getInstance().isEnabled('brainQualityScoring')) {
            return null;
        }

        try {
            const telemetry = MultiBrainTelemetry.getInstance();
            const stats = telemetry.getStats();
            const now = Date.now();

            const reports: BrainQualityReport[] = stats.map(stat => {
                const usefulness = stat.avgConfidence > 0
                    ? Math.min(1, stat.avgInsightCount * stat.avgConfidence)
                    : 0;
                const falsePositiveRisk = stat.avgFalsePositiveLikelihood;
                const precisionEstimate = usefulness * (1 - falsePositiveRisk);

                // Soft weight recommendation
                let recommendedWeight: number;
                let recommendation: string;

                if (falsePositiveRisk > FP_RISK_THRESHOLD && usefulness < USEFULNESS_THRESHOLD) {
                    recommendedWeight = Math.max(0.3, 1 - falsePositiveRisk);
                    recommendation = `${stat.brainId} appears over-sensitive (FP risk: ${(falsePositiveRisk * 100).toFixed(0)}%, usefulness: ${(usefulness * 100).toFixed(0)}%). Consider reducing weight to ${recommendedWeight.toFixed(2)}.`;
                } else if (precisionEstimate > 0.7) {
                    recommendedWeight = Math.min(1.0, 0.8 + precisionEstimate * 0.2);
                    recommendation = `${stat.brainId} shows strong precision (${(precisionEstimate * 100).toFixed(0)}%). Current weight is appropriate.`;
                } else {
                    recommendedWeight = 0.7;
                    recommendation = `${stat.brainId} shows moderate quality. Monitor for improvement.`;
                }

                return {
                    brainId: stat.brainId,
                    avgConfidence: Math.round(stat.avgConfidence * 1000) / 1000,
                    usefulness: Math.round(usefulness * 1000) / 1000,
                    falsePositiveRisk: Math.round(falsePositiveRisk * 1000) / 1000,
                    precisionEstimate: Math.round(precisionEstimate * 1000) / 1000,
                    recommendedWeight: Math.round(recommendedWeight * 100) / 100,
                    recommendation,
                    timestamp: now,
                };
            });

            // Persist report snapshot
            if (reports.length > 0) {
                this.reportBuffer.push(...reports);
                if (this.reportBuffer.length > MAX_REPORTS) {
                    this.reportBuffer = this.reportBuffer.slice(-MAX_REPORTS);
                }
                this.scheduleFlush();
            }

            return reports;
        } catch {
            return null;
        }
    }

    /**
     * Get a human-readable recommendation for a specific brain.
     * Pull-based only.
     */
    getRecommendation(brainId: string): string | null {
        const reports = this.getReport();
        if (!reports) return null;

        const report = reports.find(r => r.brainId === brainId);
        return report?.recommendation ?? null;
    }

    /**
     * Get historical reports from the buffer.
     */
    getHistory(): readonly BrainQualityReport[] {
        return this.reportBuffer;
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
                this.store.set('reports', this.reportBuffer.slice(-MAX_REPORTS));
            } catch {
                // Non-fatal
            }
        }, FLUSH_DEBOUNCE_MS);
    }
}
