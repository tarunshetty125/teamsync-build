// electron/intelligence/adaptive/ModePredictor.ts
// Orchestrator for adaptive mode prediction.
//
// Runs the full pipeline: classify → smooth → predict.
// In Phase 1, this operates in SHADOW MODE only:
//   - No mode switching
//   - No UI updates
//   - No suggestions
//   - Logs telemetry to electron-store (local, privacy-safe)
//
// Behind the 'adaptiveMode' capability gate — returns null immediately
// if the capability is disabled.
//
// Persistence follows the BenchmarkManager pattern:
//   - In-memory circular buffer for hot reads
//   - Debounced flush to electron-store (1s coalesce)
//   - Hydrates from store on construction
//
// Usage:
//   const predictor = new ModePredictor();
//   const telemetry = predictor.predictShadow({ text: '...', currentMode: 'sales' });

import Store from 'electron-store';
import type { ModeTemplateId } from '../../../src/lib/modes/types';
import type {
    ModeClassifierConfig,
    ModePrediction,
    ShadowModeTelemetry,
} from './types';
import { classifyMode, classifyModeV2 } from './ModeClassifier';
import { ModeConfidenceEngine } from './ModeConfidenceEngine';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';
import { emitModePrediction } from '../timeline/SignalEmitter';
import { AdaptiveModeIPC } from '../ipc/AdaptiveModeIPC';
import { LatencyTracker } from '../LatencyTracker';

// ---------------------------------------------------------------------------
// Store Schema
// ---------------------------------------------------------------------------

interface ShadowTelemetryStoreState {
    version: number;
    records: ShadowModeTelemetry[];
}

const STORE_VERSION = 1;
const STORE_NAME = 'teamsync-shadow-telemetry';

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Readonly<ModeClassifierConfig> = {
    confidenceThreshold: 0.6,
    smoothingWindowSize: 5,
    debounceMs: 2_000,
    minTranscriptLength: 50,
};

// ---------------------------------------------------------------------------
// ModePredictor
// ---------------------------------------------------------------------------

export class ModePredictor {
    private readonly config: Readonly<ModeClassifierConfig>;
    private readonly confidenceEngine: ModeConfidenceEngine;
    private telemetryBuffer: ShadowModeTelemetry[] = [];
    private lastPredictionAt: number = 0;
    private flushTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly store: Store<ShadowTelemetryStoreState>;

    private static readonly MAX_TELEMETRY = 200;

    constructor(config?: Partial<ModeClassifierConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.confidenceEngine = new ModeConfidenceEngine(this.config.smoothingWindowSize);

        // Hydrate from persistent store
        this.store = new Store<ShadowTelemetryStoreState>({
            name: STORE_NAME,
            defaults: {
                version: STORE_VERSION,
                records: [],
            },
        });
        this.telemetryBuffer = this.store.get('records', []).slice(-ModePredictor.MAX_TELEMETRY);
    }

    // ---------------------------------------------------------------------------
    // Prediction
    // ---------------------------------------------------------------------------

    /**
     * Run the full prediction pipeline.
     *
     * Returns null if:
     *   - Capability is disabled
     *   - Debounce period hasn't elapsed
     *   - Text is too short
     */
    predict(params: {
        readonly text: string;
        readonly currentMode: ModeTemplateId | null;
    }): ModePrediction | null {
        // Capability gate
        if (!CapabilityRegistry.getInstance().isEnabled('adaptiveMode')) {
            return null;
        }

        // Debounce
        const now = Date.now();
        if (now - this.lastPredictionAt < this.config.debounceMs) {
            return null;
        }

        // Minimum text length
        if (params.text.length < this.config.minTranscriptLength) {
            return null;
        }

        this.lastPredictionAt = now;

        // Classify → Smooth
        LatencyTracker.getInstance().start('prediction');
        const useV2 = CapabilityRegistry.getInstance().isEnabled('predictorV2');
        const rawScores = useV2 ? classifyModeV2(params.text, this.config) : classifyMode(params.text, this.config);
        const smoothedScores = this.confidenceEngine.update(rawScores);
        LatencyTracker.getInstance().end('prediction');

        // Determine recommendation
        const topScore = smoothedScores[0];
        let recommended: ModeTemplateId | null = null;

        if (
            topScore &&
            topScore.confidence >= this.config.confidenceThreshold &&
            topScore.modeId !== params.currentMode
        ) {
            recommended = topScore.modeId;
        }

        return {
            scores: smoothedScores,
            recommended,
            currentMode: params.currentMode,
            confidenceThreshold: this.config.confidenceThreshold,
            timestamp: now,
        };
    }

    /**
     * Shadow mode: predict and persist telemetry silently.
     *
     * No mode switching, no UI, no suggestions.
     * Logs to console, stores in circular buffer, flushes to electron-store.
     */
    predictShadow(params: {
        readonly text: string;
        readonly currentMode: ModeTemplateId | null;
    }): ShadowModeTelemetry | null {
        const prediction = this.predict(params);
        if (!prediction) {
            return null;
        }

        const topScore = prediction.scores[0];
        const predictedMode = topScore?.modeId ?? null;
        const confidence = topScore?.confidence ?? 0;
        const modeMatch = predictedMode === params.currentMode;

        const telemetry: ShadowModeTelemetry = {
            version: 1,
            predictedMode,
            currentMode: params.currentMode,
            confidence,
            timestamp: prediction.timestamp,
            modeMatch,
        };

        // Log
        console.log(
            `[ModePredictor:Shadow] predicted=${predictedMode} current=${params.currentMode} ` +
            `confidence=${confidence.toFixed(3)} match=${modeMatch}`
        );

        // Store in circular buffer
        this.telemetryBuffer.push(telemetry);
        if (this.telemetryBuffer.length > ModePredictor.MAX_TELEMETRY) {
            this.telemetryBuffer = this.telemetryBuffer.slice(-ModePredictor.MAX_TELEMETRY);
        }

        // Schedule debounced flush to disk
        this.scheduleFlush();

        // Emit via timeline (capability-gated inside SignalEmitter)
        if (predictedMode && params.currentMode) {
            emitModePrediction({
                predictedMode,
                currentMode: params.currentMode,
                confidence,
            });

            // Surface adaptive mode suggestion to renderer (capability-gated inside)
            AdaptiveModeIPC.getInstance().maybeSuggest({
                predictedMode,
                currentMode: params.currentMode,
                confidence,
            });
        }

        return telemetry;
    }

    // ---------------------------------------------------------------------------
    // Telemetry Access
    // ---------------------------------------------------------------------------

    /**
     * Get all shadow telemetry records.
     */
    getTelemetry(): readonly ShadowModeTelemetry[] {
        return this.telemetryBuffer;
    }

    /**
     * Get prediction accuracy: % of predictions matching the current mode.
     */
    getAccuracy(): number {
        if (this.telemetryBuffer.length === 0) return 0;

        const matches = this.telemetryBuffer.filter(t => t.modeMatch).length;
        return matches / this.telemetryBuffer.length;
    }

    /**
     * Clear all state, smoothing history, and telemetry.
     * Also clears persisted data.
     */
    reset(): void {
        this.confidenceEngine.reset();
        this.telemetryBuffer = [];
        this.lastPredictionAt = 0;
        this.store.set('records', []);
    }

    // ---------------------------------------------------------------------------
    // Persistence (follows BenchmarkManager.scheduleFlush pattern)
    // ---------------------------------------------------------------------------

    /**
     * Coalesce writes: flush to disk at most once per second.
     * Prevents I/O storms during rapid prediction bursts.
     */
    private scheduleFlush(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            try {
                this.store.set('records', this.telemetryBuffer.slice(-ModePredictor.MAX_TELEMETRY));
            } catch {
                // Persistence failure is non-fatal — in-memory buffer is still valid
            }
        }, 1_000);
    }
}
