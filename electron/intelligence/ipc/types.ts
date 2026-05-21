// electron/intelligence/ipc/types.ts
// IPC payload types for intelligence surface layer.
//
// These types define the shape of data sent from main process → renderer
// via IPC channels. They are the contract between backend intelligence
// and frontend UI components.
//
// IMPORTANT: Zero runtime dependencies. Pure type definitions.

// ---------------------------------------------------------------------------
// Adaptive Mode Suggestion
// ---------------------------------------------------------------------------

/**
 * IPC payload for adaptive mode suggestions.
 * Sent via 'intelligence:adaptive-mode-suggestion' channel.
 */
export interface AdaptiveModeSuggestionPayload {
    /** Predicted mode ID */
    readonly predictedMode: string;
    /** Human-readable mode name */
    readonly predictedModeName: string;
    /** Current mode ID */
    readonly currentMode: string;
    /** Confidence score (0.0–1.0, only sent when >= 0.85) */
    readonly confidence: number;
    /** Timestamp (unix ms) */
    readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Timeline Batch
// ---------------------------------------------------------------------------

/**
 * A single timeline signal in the batch payload.
 */
export interface TimelineSignalPayload {
    /** Signal type (e.g., 'buying_signal', 'objection') */
    readonly type: string;
    /** Human-readable label */
    readonly label: string;
    /** Confidence (0.0–1.0) */
    readonly confidence: number;
    /** Severity ('info' | 'warning' | 'critical') */
    readonly severity: string;
    /** Timestamp (unix ms) */
    readonly timestamp: number;
    /** Optional mode context */
    readonly modeId?: string;
}

/**
 * IPC payload for batched timeline signals.
 * Sent via 'intelligence:timeline-batch' channel.
 */
export interface TimelineBatchPayload {
    /** Batch ID for deduplication */
    readonly batchId: string;
    /** Signals in this batch */
    readonly signals: readonly TimelineSignalPayload[];
    /** Batch timestamp */
    readonly timestamp: number;
    /** Total signal count in backend buffer */
    readonly totalCount: number;
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

/**
 * A single explanation factor in the payload.
 */
export interface ExplanationFactorPayload {
    readonly name: string;
    readonly impact: 'positive' | 'negative' | 'neutral';
    readonly detail: string;
}

/**
 * IPC payload for explainability data.
 * Sent via 'intelligence:explanation' channel.
 */
export interface ExplanationPayload {
    /** Summary of the explanation */
    readonly summary: string;
    /** Confidence score (0.0–1.0) */
    readonly score: number;
    /** Contributing factors */
    readonly factors: readonly ExplanationFactorPayload[];
    /** Concerns/caveats */
    readonly concerns: readonly string[];
    /** Source brain ID */
    readonly sourceBrain: string;
    /** Compact formatted string (pre-rendered) */
    readonly compact: string;
    /** Expanded formatted string (pre-rendered) */
    readonly expanded: string;
}

// ---------------------------------------------------------------------------
// Premium UX Metadata
// ---------------------------------------------------------------------------

/**
 * Premium UX metadata attached to intelligence responses.
 * Renderer can use this to enhance the UI for premium users.
 */
export interface PremiumUXMetadata {
    /** Overall confidence of the intelligence response (0.0–1.0) */
    readonly confidence: number;
    /** Signal strength indicator ('strong' | 'moderate' | 'weak') */
    readonly signalStrength: 'strong' | 'moderate' | 'weak';
    /** Current mode recommendation (null if no change suggested) */
    readonly modeRecommendation: string | null;
    /** Number of timeline signals in the current session */
    readonly timelineCount: number;
    /** Whether multi-brain insights were injected */
    readonly multiBrainActive: boolean;
    /** Number of memory entries retrieved for context */
    readonly memoryHits: number;
}
