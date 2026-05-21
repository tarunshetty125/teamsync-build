// electron/intelligence/memory/ModeMemoryManager.ts
// Local mode memory manager for recruiting + sales intelligence.
//
// Architecture:
//   Save:     Insight → MemoryEntry → EmbeddingPipeline.getEmbedding() → VectorStore
//   Retrieve: query → EmbeddingPipeline.getEmbeddingForQuery() → VectorStore.searchSimilar()
//             → recency weighting → top-K
//
// Integration:
//   - Reuses existing VectorStore (SQLite + sqlite-vec / JS fallback)
//   - Reuses existing EmbeddingPipeline (Ollama / Gemini / OpenAI / local)
//   - Mode-scoped via virtual meeting namespace: "memory:{modeId}"
//   - Local-only, privacy-safe, no cloud
//
// Performance:
//   - Save is fully async via queueMicrotask (never blocks runAction)
//   - Retrieval is async (embedding + VectorStore search)
//   - Only persists insights with confidence >= 0.75
//   - Embedding cache avoids redundant calls
//
// Safety:
//   - Capability-gated via CapabilityRegistry ('modeMemory')
//   - Silent failure — never affects runAction()
//   - All public methods wrapped in try/catch

import type { VectorStore } from '../../rag/VectorStore';
import type { EmbeddingPipeline } from '../../rag/EmbeddingPipeline';
import type { Chunk } from '../../rag/SemanticChunker';
import type { MemoryEntry, MemoryQuery, ScoredMemory, ModeMemory } from './types';
import { computeRecencyBoost, computeFinalScore } from './MemoryRetriever';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

/** Virtual meeting ID namespace — scopes memory entries in VectorStore */
const MEMORY_MEETING_PREFIX = 'memory:';

/** Max entries per mode (oldest evicted when exceeded) */
const MAX_ENTRIES_PER_MODE = 500;

/** Min confidence to persist an insight */
const MIN_PERSIST_CONFIDENCE = 0.75;

/** Default top-K for retrieval */
const DEFAULT_TOP_K = 5;

/** Default recency weight in final score */
const DEFAULT_RECENCY_WEIGHT = 0.2;

// ---------------------------------------------------------------------------
// ModeMemoryManager
// ---------------------------------------------------------------------------

export class ModeMemoryManager {
    private static instance: ModeMemoryManager | null = null;

    private vectorStore: VectorStore | null = null;
    private embeddingPipeline: EmbeddingPipeline | null = null;

    /** In-memory index of entry metadata (lightweight, no embeddings) */
    private entryIndex: Map<string, MemoryEntry> = new Map();

    /** Per-mode chunk counter for VectorStore chunk_index */
    private chunkCounters: Map<string, number> = new Map();

    private constructor() {}

    static getInstance(): ModeMemoryManager {
        if (!ModeMemoryManager.instance) {
            ModeMemoryManager.instance = new ModeMemoryManager();
        }
        return ModeMemoryManager.instance;
    }

    /**
     * Initialize with existing VectorStore + EmbeddingPipeline instances.
     * Called once during app startup (after RAGManager creates these).
     * Idempotent — safe to call multiple times.
     */
    initialize(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline): void {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /**
     * Check if the manager has been initialized with infrastructure.
     */
    isReady(): boolean {
        return this.vectorStore !== null && this.embeddingPipeline !== null;
    }

    // ---------------------------------------------------------------------------
    // Save (Async — never blocks hot path)
    // ---------------------------------------------------------------------------

    /**
     * Save a memory entry from a sub-brain insight.
     *
     * Capability-gated. Silent failure.
     * Fully async: queues embedding + VectorStore write via queueMicrotask.
     * Never blocks runAction().
     */
    saveMemory(entry: Omit<MemoryEntry, 'version' | 'id' | 'timestamp'>): void {
        if (!CapabilityRegistry.getInstance().isEnabled('modeMemory')) {
            return;
        }

        if (!this.isReady()) {
            return;
        }

        if (entry.confidence < MIN_PERSIST_CONFIDENCE) {
            return;
        }

        try {
            const fullEntry: MemoryEntry = {
                ...entry,
                version: SCHEMA_VERSION,
                id: this.generateId(),
                timestamp: Date.now(),
            };

            // Add to in-memory index immediately (sync, fast)
            this.entryIndex.set(fullEntry.id, fullEntry);
            this.enforceLimit(fullEntry.modeId);

            // Async: embed + persist to VectorStore (non-blocking)
            queueMicrotask(() => {
                this.persistToVectorStore(fullEntry).catch(() => {
                    // Silent — embedding/storage failure is non-fatal
                    // Entry remains in entryIndex for keyword-based retrieval
                });
            });
        } catch {
            // Silent — memory failure must NEVER affect the hot path
        }
    }

    // ---------------------------------------------------------------------------
    // Retrieve (Async — uses VectorStore semantic search)
    // ---------------------------------------------------------------------------

    /**
     * Retrieve memory entries using semantic similarity via VectorStore.
     *
     * Flow: queryText → EmbeddingPipeline.getEmbeddingForQuery() →
     *       VectorStore.searchSimilar() → recency weighting → top-K
     *
     * Returns empty array if disabled, not ready, or on failure.
     */
    async retrieveMemory(query: MemoryQuery): Promise<ScoredMemory[]> {
        if (!CapabilityRegistry.getInstance().isEnabled('modeMemory')) {
            return [];
        }

        if (!this.vectorStore || !this.embeddingPipeline) {
            return [];
        }

        try {
            const meetingId = `${MEMORY_MEETING_PREFIX}${query.modeId}`;

            // Generate query embedding
            const queryEmbedding = await this.embeddingPipeline.getEmbeddingForQuery(query.queryText);

            // Search VectorStore with mode-scoped virtual meeting ID
            const results = await this.vectorStore.searchSimilar(queryEmbedding, {
                meetingId,
                limit: (query.topK ?? DEFAULT_TOP_K) * 2, // fetch extra for post-filtering
                minSimilarity: 0.2,
            });

            if (results.length === 0) return [];

            const now = Date.now();
            const recencyWeight = query.recencyWeight ?? DEFAULT_RECENCY_WEIGHT;
            const minConfidence = query.minConfidence ?? 0;

            // Score with recency weighting and convert to ScoredMemory
            const scored: ScoredMemory[] = [];

            for (const chunk of results) {
                // Parse entry metadata from chunk text
                const entry = this.parseEntryFromChunk(chunk, query.modeId);
                if (!entry) continue;

                // Confidence filter
                if (entry.confidence < minConfidence) continue;

                // Tag filter
                if (query.tags && query.tags.length > 0) {
                    const queryTags = new Set(query.tags);
                    if (!entry.tags.some(t => queryTags.has(t))) continue;
                }

                const recencyBoost = computeRecencyBoost(entry.timestamp, now);
                const finalScore = computeFinalScore(chunk.similarity, recencyBoost, recencyWeight);

                scored.push({
                    entry,
                    similarity: chunk.similarity,
                    recencyBoost,
                    finalScore,
                });
            }

            // Sort by finalScore descending, take top-K
            scored.sort((a, b) => {
                const diff = b.finalScore - a.finalScore;
                if (diff !== 0) return diff;
                return b.entry.timestamp - a.entry.timestamp;
            });

            return scored.slice(0, query.topK ?? DEFAULT_TOP_K);
        } catch {
            return [];
        }
    }

    // ---------------------------------------------------------------------------
    // Context Hydration
    // ---------------------------------------------------------------------------

    /**
     * Hydrate context with relevant memories for a mode.
     * Returns a compact string suitable for prompt injection, or null if no
     * relevant memories found.
     *
     * Capability-gated. Silent failure.
     */
    async hydrateContext(params: {
        readonly queryText: string;
        readonly modeId: string;
        readonly maxEntries?: number;
    }): Promise<string | null> {
        if (!CapabilityRegistry.getInstance().isEnabled('modeMemory')) {
            return null;
        }

        try {
            const results = await this.retrieveMemory({
                queryText: params.queryText,
                modeId: params.modeId,
                topK: params.maxEntries ?? 3,
                minConfidence: 0.5,
            });

            if (results.length === 0) return null;

            const lines = results.map(r => {
                const ageHours = Math.round((Date.now() - r.entry.timestamp) / (60 * 60 * 1000));
                const ageStr = ageHours < 1 ? 'just now' :
                    ageHours < 24 ? `${ageHours}h ago` :
                    `${Math.round(ageHours / 24)}d ago`;
                return `• ${r.entry.label}: ${r.entry.content} [${Math.round(r.entry.confidence * 100)}%, ${ageStr}]`;
            });

            return lines.join('\n');
        } catch {
            return null;
        }
    }

    // ---------------------------------------------------------------------------
    // Accessors
    // ---------------------------------------------------------------------------

    /**
     * Get summary of memory state for a mode.
     */
    getModeMemory(modeId: string): ModeMemory {
        const modeEntries = this.getEntriesForMode(modeId);
        const lastEntry = modeEntries.length > 0
            ? modeEntries[modeEntries.length - 1]
            : null;

        return {
            modeId,
            entryCount: modeEntries.length,
            lastUpdated: lastEntry?.timestamp ?? 0,
        };
    }

    /**
     * Get all entries for a mode from in-memory index (for diagnostics).
     */
    getEntries(modeId: string): readonly MemoryEntry[] {
        return this.getEntriesForMode(modeId);
    }

    /**
     * Clear all memory for a mode.
     * Removes entries from in-memory index and VectorStore.
     */
    clearMode(modeId: string): void {
        // Remove from in-memory index
        for (const [id, entry] of this.entryIndex) {
            if (entry.modeId === modeId) {
                this.entryIndex.delete(id);
            }
        }

        // Remove from VectorStore
        if (this.vectorStore) {
            try {
                const meetingId = `${MEMORY_MEETING_PREFIX}${modeId}`;
                this.vectorStore.deleteChunksForMeeting(meetingId);
            } catch {
                // Non-fatal
            }
        }

        this.chunkCounters.delete(modeId);
    }

    // ---------------------------------------------------------------------------
    // Private — VectorStore Integration
    // ---------------------------------------------------------------------------

    /**
     * Persist a memory entry to VectorStore.
     *
     * Maps MemoryEntry → Chunk format:
     *   meetingId   → "memory:{modeId}"
     *   chunkIndex  → auto-increment per mode
     *   speaker     → sourceBrain
     *   startMs     → timestamp
     *   endMs       → timestamp
     *   text        → "{id}|{confidence}|{tags}|{label}: {content}"
     *   tokenCount  → rough estimate
     */
    private async persistToVectorStore(entry: MemoryEntry): Promise<void> {
        if (!this.vectorStore || !this.embeddingPipeline) return;

        const meetingId = `${MEMORY_MEETING_PREFIX}${entry.modeId}`;
        const chunkIndex = this.nextChunkIndex(entry.modeId);

        // Encode metadata into text for later parsing on retrieval
        const encodedText = this.encodeEntryToText(entry);

        const chunk: Chunk = {
            meetingId,
            chunkIndex,
            speaker: entry.sourceBrain,
            startMs: entry.timestamp,
            endMs: entry.timestamp,
            text: encodedText,
            tokenCount: Math.ceil(encodedText.length / 4),
        };

        // Save chunk to SQLite
        const ids = this.vectorStore.saveChunks([chunk]);
        if (ids.length === 0) return;

        // Generate and store embedding
        const embeddingText = `${entry.label}: ${entry.content}`;
        const embedding = await this.embeddingPipeline.getEmbedding(embeddingText);
        this.vectorStore.storeEmbedding(ids[0], embedding);
    }

    /**
     * Encode a MemoryEntry into a chunk text field.
     * Format: "{id}|{version}|{confidence}|{tags}|{sessionId}|{label}: {content}"
     * Parseable on retrieval via parseEntryFromChunk().
     */
    private encodeEntryToText(entry: MemoryEntry): string {
        const tags = entry.tags.join(',');
        const session = entry.sessionId ?? '';
        return `${entry.id}|${entry.version}|${entry.confidence}|${tags}|${session}|${entry.label}: ${entry.content}`;
    }

    /**
     * Parse a MemoryEntry from a VectorStore chunk.
     * Returns null if the chunk doesn't match our encoding format.
     */
    private parseEntryFromChunk(
        chunk: { text: string; speaker: string; startMs: number },
        modeId: string,
    ): MemoryEntry | null {
        try {
            const text = chunk.text;
            const pipeIndex = text.indexOf('|');
            if (pipeIndex === -1) return null;

            const parts = text.split('|');
            if (parts.length < 6) return null;

            const id = parts[0];
            const version = parseInt(parts[1], 10);
            const confidence = parseFloat(parts[2]);
            const tags = parts[3] ? parts[3].split(',') : [];
            const sessionId = parts[4] || undefined;
            const labelContent = parts.slice(5).join('|'); // Rejoin in case content has pipes
            const colonIdx = labelContent.indexOf(': ');
            const label = colonIdx >= 0 ? labelContent.substring(0, colonIdx) : labelContent;
            const content = colonIdx >= 0 ? labelContent.substring(colonIdx + 2) : '';

            return {
                id,
                version: isNaN(version) ? SCHEMA_VERSION : version,
                modeId,
                sourceBrain: chunk.speaker,
                label,
                content,
                confidence: isNaN(confidence) ? 0 : confidence,
                timestamp: chunk.startMs,
                tags,
                sessionId,
            };
        } catch {
            return null;
        }
    }

    // ---------------------------------------------------------------------------
    // Private — Helpers
    // ---------------------------------------------------------------------------

    private getEntriesForMode(modeId: string): MemoryEntry[] {
        const entries: MemoryEntry[] = [];
        for (const entry of this.entryIndex.values()) {
            if (entry.modeId === modeId) entries.push(entry);
        }
        return entries.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Enforce circular buffer limit per mode.
     * Removes oldest entries from in-memory index when a mode exceeds limit.
     * VectorStore entries are NOT deleted (they age out via recency scoring).
     */
    private enforceLimit(modeId: string): void {
        const modeEntries = this.getEntriesForMode(modeId);
        if (modeEntries.length <= MAX_ENTRIES_PER_MODE) return;

        const excess = modeEntries.length - MAX_ENTRIES_PER_MODE;
        for (let i = 0; i < excess; i++) {
            this.entryIndex.delete(modeEntries[i].id);
        }
    }

    private nextChunkIndex(modeId: string): number {
        const current = this.chunkCounters.get(modeId) ?? 0;
        this.chunkCounters.set(modeId, current + 1);
        return current;
    }

    private generateId(): string {
        const ts = Date.now().toString(36);
        const rand = Math.random().toString(36).substring(2, 8);
        return `mem_${ts}_${rand}`;
    }
}
