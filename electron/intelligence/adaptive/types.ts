// electron/intelligence/adaptive/types.ts
// Types for the adaptive mode detection system.
// IMPORTANT: This file must have ZERO runtime dependencies.

import type { ModeTemplateId } from '../../../src/lib/modes/types';

// ---------------------------------------------------------------------------
// Mode Confidence
// ---------------------------------------------------------------------------

/** Confidence score for a single mode */
export interface ModeConfidenceScore {
    readonly modeId: ModeTemplateId;
    readonly confidence: number;
    readonly signalCount: number;
    readonly topKeywords: readonly string[];
}

/** Full prediction result */
export interface ModePrediction {
    readonly scores: readonly ModeConfidenceScore[];
    readonly recommended: ModeTemplateId | null;
    readonly currentMode: ModeTemplateId | null;
    readonly confidenceThreshold: number;
    readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Shadow Telemetry
// ---------------------------------------------------------------------------

/** Telemetry record logged silently in shadow mode */
export interface ShadowModeTelemetry {
    /** Schema version — increment when adding fields to avoid breaking old stores */
    readonly version: number;
    readonly predictedMode: ModeTemplateId | null;
    readonly currentMode: ModeTemplateId | null;
    readonly confidence: number;
    readonly timestamp: number;
    readonly modeMatch: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Classifier and predictor configuration */
export interface ModeClassifierConfig {
    /** Minimum confidence to recommend a mode switch (default 0.6) */
    readonly confidenceThreshold: number;
    /** EMA smoothing window size (default 5) */
    readonly smoothingWindowSize: number;
    /** Minimum ms between predictions (default 2000) */
    readonly debounceMs: number;
    /** Minimum text chars before classifying (default 50) */
    readonly minTranscriptLength: number;
}
