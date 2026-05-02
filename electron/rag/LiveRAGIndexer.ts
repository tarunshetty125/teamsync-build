// electron/rag/LiveRAGIndexer.ts
// JIT RAG: Incrementally indexes transcript during a live meeting.
//
// Architecture:
// - Background timer (30s) chunks & embeds NEW transcript segments
// - Embedding is fire-and-forget — never blocks the query path
// - At query time, VectorStore already has indexed chunks for fast search
// - Falls back gracefully if embedding API unavailable

import { preprocessTranscript, RawSegment } from './TranscriptPreprocessor';
import { chunkTranscript, Chunk } from './SemanticChunker';
import { VectorStore } from './VectorStore';
import { EmbeddingPipeline } from './EmbeddingPipeline';

const INDEXING_INTERVAL_MS = 30_000;  // 30 seconds
const MIN_NEW_SEGMENTS = 3;           // Don't chunk unless we have enough new content

export class LiveRAGIndexer {
    private vectorStore: VectorStore;
    private embeddingPipeline: EmbeddingPipeline;
    private meetingId: string | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private allSegments: RawSegment[] = [];
    private indexedSegmentCount = 0;  // High-water mark: segments already chunked
    private chunkCounter = 0;         // Running chunk index
    private indexedChunkCount = 0;    // Total chunks with embeddings
    private isProcessing = false;     // Guard against concurrent ticks
    private isActive = false;

    constructor(vectorStore: VectorStore, embeddingPipeline: EmbeddingPipeline) {
        this.vectorStore = vectorStore;
        this.embeddingPipeline = embeddingPipeline;
    }

    /**
     * Start live indexing for a meeting.
     * Begins a background timer that periodically chunks & embeds new transcript.
     */
    start(meetingId: string): void {
        if (this.isActive) {
            this.stop();
        }

        this.meetingId = meetingId;
        this.allSegments = [];
        this.indexedSegmentCount = 0;
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;
        this.isProcessing = false;
        this.isActive = true;

        console.log(`[LiveRAGIndexer] Started for meeting ${meetingId}`);

        this.timer = setInterval(() => {
            this.tick().catch(err => {
                console.error('[LiveRAGIndexer] Tick error:', err);
            });
        }, INDEXING_INTERVAL_MS);
    }

    /**
     * Feed new transcript segments from the live meeting.
     * Called by SessionTracker whenever new transcript arrives.
     * This is append-only — segments are never modified after being fed.
     */
    feedSegments(segments: RawSegment[], sessionId?: string): void {
        if (!this.isActive || !this.meetingId) return;
        
        // Final ultimate safeguard: drop segments that leaked from old sessions
        const validSegments = sessionId ? segments.filter(s => {
            if (s._sessionId !== sessionId) {
                console.log(`[STALE_REJECTED] [LiveRAGIndexer] Dropped leaked segment from old session (${s._sessionId})`);
                return false;
            }
            return true;
        }) : segments;
        if (validSegments.length === 0) return;

        this.allSegments.push(...validSegments);
    }

    /**
     * Core indexing tick — processes only NEW segments since last tick.
     * 
     * Flow:
     * 1. Slice segments from high-water mark
     * 2. Preprocess (clean, merge speakers)
     * 3. Chunk (semantic boundaries, 200-400 tokens)
     * 4. Save chunks to VectorStore
     * 5. Embed each chunk via Gemini API
     * 6. Advance high-water mark
     */
    private async tick(forceFlush = false): Promise<void> {
        if (!this.isActive || !this.meetingId) return;
        if (this.isProcessing) return;  // Skip if previous tick still running

        const newSegmentCount = this.allSegments.length - this.indexedSegmentCount;
        if (!forceFlush && newSegmentCount < MIN_NEW_SEGMENTS) return;  // Not enough new content

        this.isProcessing = true;
        const meetingId = this.meetingId;

        try {
            // 1. Get only new segments
            const newSegments = this.allSegments.slice(this.indexedSegmentCount);

            // 2. Preprocess
            const cleaned = preprocessTranscript(newSegments);
            if (cleaned.length === 0) {
                this.indexedSegmentCount = this.allSegments.length;
                return;
            }

            // 3. Chunk with offset index
            const chunks = chunkTranscript(meetingId, cleaned);
            if (chunks.length === 0) {
                this.indexedSegmentCount = this.allSegments.length;
                return;
            }

            // Re-index chunks to continue from where we left off
            const indexedChunks: Chunk[] = chunks.map((chunk, i) => ({
                ...chunk,
                chunkIndex: this.chunkCounter + i,
            }));

            // 4. Save chunks to DB (without embeddings initially)
            const chunkIds = this.vectorStore.saveChunks(indexedChunks);
            this.chunkCounter += indexedChunks.length;

            console.log(`[LiveRAGIndexer] Saved ${indexedChunks.length} chunks (${this.chunkCounter} total) for meeting ${meetingId}`);

            // 5. Embed each chunk (fire-and-forget per chunk, but sequential to avoid rate limits)
            if (this.embeddingPipeline.isReady()) {
                let embeddedCount = 0;
                for (let i = 0; i < chunkIds.length; i++) {
                    try {
                        const embedding = await this.embeddingPipeline.getEmbedding(indexedChunks[i].text);
                        // 🔥 Guard: Abort if the session was cancelled or changed while we were waiting for the LLM API
                        if (this.meetingId !== meetingId) {
                            console.log(`[LiveRAGIndexer] Meeting changed during embedding. Dropping chunk.`);
                            return;
                        }
                        this.vectorStore.storeEmbedding(chunkIds[i], embedding);
                        embeddedCount++;
                    } catch (err) {
                        console.warn(`[LiveRAGIndexer] Failed to embed chunk ${chunkIds[i]}:`, err);
                        // Continue with remaining chunks — partial indexing is better than none
                    }
                }
                this.indexedChunkCount += embeddedCount;
                console.log(`[LiveRAGIndexer] Embedded ${embeddedCount}/${chunkIds.length} chunks (${this.indexedChunkCount} total with embeddings)`);
            } else {
                console.log('[LiveRAGIndexer] Embedding pipeline not ready, chunks saved without embeddings');
            }

            // 6. Advance high-water mark
            this.indexedSegmentCount = this.allSegments.length;

        } catch (err) {
            console.error('[LiveRAGIndexer] Processing error:', err);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Stop live indexing. Flushes any remaining segments.
     */
    async stop(): Promise<void> {
        if (!this.isActive) return;

        console.log(`[LiveRAGIndexer] Stopping for meeting ${this.meetingId}`);

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // Wait for any active background tick to finish before we do the final flush
        const start = Date.now();
        while (this.isProcessing) {
            if (Date.now() - start > 5000) {
                console.warn("[LiveRAGIndexer] Stop timeout reached while waiting for active tick to finish.");
                // NOTE: In the future, emit this to the telemetry pipeline so we can alert on it if it happens often.
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Final flush — process any remaining segments
        await this.tick(true);

        const meetingId = this.meetingId;
        this.isActive = false;
        this.meetingId = null;
        this.allSegments = [];
        this.indexedSegmentCount = 0;
        this.chunkCounter = 0;
        this.indexedChunkCount = 0;

        console.log(`[LiveRAGIndexer] Stopped for meeting ${meetingId}`);
    }

    /**
     * Check if there are any queryable JIT chunks for the current meeting.
     */
    hasIndexedChunks(): boolean {
        return this.indexedChunkCount > 0;
    }

    /**
     * Get the number of chunks with embeddings (queryable).
     */
    getIndexedChunkCount(): number {
        return this.indexedChunkCount;
    }

    /**
     * Get the meeting ID currently being indexed.
     */
    getActiveMeetingId(): string | null {
        return this.meetingId;
    }

    /**
     * Check if actively indexing.
     */
    isRunning(): boolean {
        return this.isActive;
    }
}
