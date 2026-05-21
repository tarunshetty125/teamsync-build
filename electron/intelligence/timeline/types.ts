// electron/intelligence/timeline/types.ts
// Types for the intelligence timeline and event bus.
// IMPORTANT: This file must have ZERO runtime dependencies.

// ---------------------------------------------------------------------------
// Signal Types
// ---------------------------------------------------------------------------

/** Categorizes the type of intelligence signal */
export type SignalType =
    | 'mode_prediction'
    | 'buying_signal'
    | 'objection'
    | 'decision'
    | 'action_item'
    | 'blocker'
    | 'risk'
    | 'ownership'
    | 'deadline'
    | 'red_flag'
    | 'confidence_shift'
    | 'insight';

/** Severity level for signals */
export type SignalSeverity = 'info' | 'warning' | 'critical';

// ---------------------------------------------------------------------------
// Signal & Timeline
// ---------------------------------------------------------------------------

/**
 * A single intelligence signal emitted by a subsystem.
 */
export interface IntelligenceSignal {
    readonly id: string;
    readonly type: SignalType;
    readonly label: string;
    readonly confidence: number;
    readonly timestamp: number;
    readonly severity: SignalSeverity;
    readonly modeId?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A signal placed in a timeline batch with rendering metadata.
 */
export interface TimelineEntry extends IntelligenceSignal {
    readonly batchId: string;
    readonly renderOrder: number;
}

/**
 * A batch of timeline entries flushed together.
 */
export interface TimelineBatch {
    readonly id: string;
    readonly entries: readonly TimelineEntry[];
    readonly timestamp: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Runtime-tunable timeline configuration.
 */
export interface TimelineConfig {
    /** Circular buffer size for signals (default 500) */
    readonly maxSignals: number;
    /** Deduplication time window in ms (default 5000) */
    readonly dedupeWindowMs: number;
    /** Batching interval in ms (default 2000) */
    readonly batchIntervalMs: number;
    /** Maximum signals per batch (default 3) */
    readonly maxBatchSize: number;
}
