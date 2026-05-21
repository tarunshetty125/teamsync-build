// electron/intelligence/memory/types.ts
// Types for the local mode memory system.
//
// IMPORTANT: Zero runtime dependencies.
// Schema-versioned for forward compatibility.

// ---------------------------------------------------------------------------
// Memory Entry
// ---------------------------------------------------------------------------

/**
 * A single memory entry stored and retrieved by the mode memory system.
 */
export interface MemoryEntry {
    /** Schema version for forward compatibility */
    readonly version: number;
    /** Unique entry ID (UUID or auto-increment) */
    readonly id: string;
    /** Mode that produced this memory (e.g., 'recruiting', 'sales') */
    readonly modeId: string;
    /** Sub-brain that produced this entry (e.g., 'recruiting_ownership') */
    readonly sourceBrain: string;
    /** Human-readable label (e.g., "Strong ownership language") */
    readonly label: string;
    /** The actual memory content / observation */
    readonly content: string;
    /** Confidence of the original insight (0.0–1.0) */
    readonly confidence: number;
    /** Timestamp when this memory was created (unix ms) */
    readonly timestamp: number;
    /** Semantic tags for lightweight filtering */
    readonly tags: readonly string[];
    /** Optional session/meeting ID for provenance */
    readonly sessionId?: string;
}

// ---------------------------------------------------------------------------
// Memory Metadata
// ---------------------------------------------------------------------------

/**
 * Metadata attached to a stored memory for retrieval scoring.
 */
export interface MemoryMetadata {
    /** Mode scope for retrieval filtering */
    readonly modeId: string;
    /** Tags for lightweight filtering */
    readonly tags: readonly string[];
    /** Timestamp for recency boosting */
    readonly timestamp: number;
    /** Original confidence for quality weighting */
    readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Memory Query
// ---------------------------------------------------------------------------

/**
 * Query parameters for memory retrieval.
 */
export interface MemoryQuery {
    /** Text to search for (used for semantic similarity) */
    readonly queryText: string;
    /** Mode to filter by */
    readonly modeId: string;
    /** Max results to return */
    readonly topK: number;
    /** Optional tag filter (any match) */
    readonly tags?: readonly string[];
    /** Optional minimum confidence threshold */
    readonly minConfidence?: number;
    /** Optional recency weight (0.0–1.0, default 0.2) */
    readonly recencyWeight?: number;
}

// ---------------------------------------------------------------------------
// Scored Memory
// ---------------------------------------------------------------------------

/**
 * A memory entry with retrieval scoring.
 */
export interface ScoredMemory {
    readonly entry: MemoryEntry;
    /** Cosine similarity score (0.0–1.0) */
    readonly similarity: number;
    /** Recency boost (0.0–1.0) */
    readonly recencyBoost: number;
    /** Final combined score */
    readonly finalScore: number;
}

// ---------------------------------------------------------------------------
// Mode Memory
// ---------------------------------------------------------------------------

/**
 * Aggregated memory state for a mode.
 */
export interface ModeMemory {
    readonly modeId: string;
    readonly entryCount: number;
    readonly lastUpdated: number;
}
