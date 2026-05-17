// SessionTracker.ts
// Manages session state, transcript arrays, context windows, and epoch compaction.
// Extracted from IntelligenceManager to decouple state management from LLM orchestration.

import { RecapLLM } from './llm';
import { isVerboseLogging } from './verboseLog';

export interface TranscriptSegment {
    marker?: string;
    speaker: string;
    text: string;
    timestamp: number;
    final: boolean;
    confidence?: number;
    _sessionId?: string;
}

export interface SuggestionTrigger {
    context: string;
    lastQuestion: string;
    confidence: number;
}

// Context item matching Swift ContextManager structure
export interface ContextItem {
    role: 'interviewer' | 'user' | 'assistant';
    text: string;
    timestamp: number;
}

export interface AssistantResponse {
    text: string;
    timestamp: number;
    questionContext: string;
}

export type SessionMode = 'behavioral' | 'coding' | 'follow_up' | 'general' | 'system_design';

export class SessionTracker {
    // Context management (mirrors Swift ContextManager)
    private contextItems: ContextItem[] = [];
    private readonly contextWindowDuration: number = 120; // 120 seconds
    private readonly maxContextItems: number = 500;

    // Unique ID for the current session to guard against cross-contamination from buffered STT events
    public sessionId: string = Date.now().toString();

    // Last assistant message for follow-up mode
    private lastAssistantMessage: string | null = null;
    private isCompacting = false;
    private currentGenerationId = 0;

    // Temporal RAG: Track all assistant responses in session for anti-repetition
    private assistantResponseHistory: AssistantResponse[] = [];

    // Meeting metadata
    private currentMeetingMetadata: {
        title?: string;
        calendarEventId?: string;
        source?: 'manual' | 'calendar';
    } | null = null;

    // Full Session Tracking (Persisted)
    private fullTranscript: TranscriptSegment[] = [];
    private fullUsage: any[] = []; // UsageInteraction
    private sessionStartTime: number = Date.now();
    private sessionMode: SessionMode = 'general';

    // Rolling summarization: epoch summaries preserve early context when arrays are compacted
    private static readonly MAX_EPOCH_SUMMARIES = 5;
    private transcriptEpochSummaries: string[] = [];


    // Track interim interviewer segment
    private lastInterimInterviewer: TranscriptSegment | null = null;

    // Detected coding question from transcript or screenshot extraction
    private detectedCodingQuestion: string | null = null;
    private codingQuestionSource: 'screenshot' | 'transcript' | null = null;
    private codingQuestionSetAt: number | null = null;

    // Rolling buffer for multi-segment interviewer question detection
    private recentInterviewerBuffer: { text: string; timestamp: number }[] = [];
    private static readonly INTERVIEWER_BUFFER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    // Screenshot-detected question stays sticky for 3 min before transcript can override
    private static readonly SCREENSHOT_STALE_MS = 3 * 60 * 1000;
    private static readonly DEFAULT_FULL_TRANSCRIPT_TOKENS = 2800;
    private static readonly DEFAULT_ROLLING_TRANSCRIPT_TOKENS = 1600;

    // Reference to RecapLLM for epoch summarization (injected later)
    private recapLLM: RecapLLM | null = null;

    // Guard against duplicate transcript bursts during failover overlap
    private lastTranscriptHash: string | null = null;

    // ============================================
    // Configuration
    // ============================================

    public setRecapLLM(recapLLM: RecapLLM | null): void {
        this.recapLLM = recapLLM;
    }

    public setMeetingMetadata(metadata: any): void {
        this.currentMeetingMetadata = metadata;
    }

    public getMeetingMetadata() {
        return this.currentMeetingMetadata;
    }

    public clearMeetingMetadata(): void {
        this.currentMeetingMetadata = null;
    }

    // ============================================
    // Coding Question Tracking
    // ============================================

    /**
     * Set the current coding question.
     * Priority rules (avoids stale Q1 blocking Q2 detection in multi-question interviews):
     *  - Screenshot → always stored immediately (explicit user action via Solve)
     *  - Transcript → stored if nothing is known yet, OR if existing question is also from
     *    transcript (newer detection = newer question), OR if screenshot question is stale
     *    (> 3 min old — user likely moved to the next question)
     */
    setCodingQuestion(question: string, source: 'screenshot' | 'transcript'): void {
        const now = Date.now();
        const trimmed = question.trim();
        if (!trimmed) return;

        if (this.detectedCodingQuestion === null) {
            // Nothing stored — accept any source
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question stored (source: ${source}): "${trimmed.substring(0, 80)}..."`);
            return;
        }

        if (source === 'screenshot') {
            // Screenshot always updates immediately (explicit user Solve action)
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question updated via screenshot: "${trimmed.substring(0, 80)}..."`);
            return;
        }

        // source === 'transcript'
        const isStale = this.codingQuestionSetAt !== null
            && (now - this.codingQuestionSetAt) > SessionTracker.SCREENSHOT_STALE_MS;
        const canOverride = this.codingQuestionSource === 'transcript' || isStale;

        if (canOverride) {
            this.detectedCodingQuestion = trimmed;
            this.codingQuestionSource = source;
            this.codingQuestionSetAt = now;
            console.log(`[SessionTracker] Coding question updated via transcript (prev was ${this.codingQuestionSource}, stale=${isStale}): "${trimmed.substring(0, 80)}..."`);
        } else {
            console.log(`[SessionTracker] Transcript question ignored — screenshot question is recent (< ${SessionTracker.SCREENSHOT_STALE_MS / 1000}s)`);
        }
    }

    getDetectedCodingQuestion(): { question: string | null; source: 'screenshot' | 'transcript' | null } {
        return { question: this.detectedCodingQuestion, source: this.codingQuestionSource };
    }

    clearCodingQuestion(): void {
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
    }

    /**
     * Heuristic to decide if an interviewer statement looks like a coding question.
     * Requires ≥2 of the signal patterns and minimum length to avoid false positives
     * on casual conversation ("can you implement X?" → yes, "sounds good!" → no).
     */
    private looksLikeCodingQuestion(text: string): boolean {
        if (text.length < 50) return false;
        const patterns = [
            /\b(implement|write|code|solve|design|build|create)\b/i,
            /\b(given\s+(an?|the)\s+(array|string|list|tree|graph|matrix|number|integer|node|linked list|stack|queue|heap))\b/i,
            /\b(return|find\s+(all|the|a|any)|count|check\s+if|determine|calculate|maximize|minimize|sort)\b/i,
            /\b(function|method|algorithm|data structure|class)\b/i,
            /\b(O\(n\)|time complexity|space complexity|optimal|efficient|brute force)\b/i,
            /\b(two sum|three sum|binary search|dynamic programming|BFS|DFS|palindrome|anagram|substring|subarray|rotation)\b/i,
        ];
        const matchCount = patterns.filter(p => p.test(text)).length;
        return matchCount >= 2;
    }

    // ============================================
    // Context Management
    // ============================================

    /**
     * Add a transcript segment to context.
     * Only stores FINAL transcripts.
     * Returns { role, isRefinementCandidate } so the engine can decide whether to trigger follow-up.
     */
    addTranscript(segment: TranscriptSegment): { role: 'interviewer' | 'user' | 'assistant' } | null {
        // 🔥 Double-Layer Guard: ensure segment wasn't emitted by an old pipeline instance
        if (segment._sessionId !== this.sessionId) {
            console.warn(`[STALE_REJECTED] [SessionTracker] Dropped stale transcript from old session (${segment._sessionId})`);
            return null;
        }

        // 🔥 Chronological Guard: Drop events that were constructed before this session even started
        // Note: Included a 1000ms clock skew tolerance for early event buffers
        if (segment.timestamp < this.sessionStartTime - 1000) {
            console.warn(`[SessionTracker] Dropped chronologically stale transcript (timestamp: ${segment.timestamp} < start: ${this.sessionStartTime - 1000})`);
            return null;
        }

        // 🔥 Duplicate Burst Guard: Prevent identical overlap from multi-provider failover
        // 1. Text normalization (combats provider casing/punctuation drift)
        const norm = segment.text.trim().replace(/\s+/g, ' ').toLowerCase();
        // 2. Timestamp bucketing to 10ms (combats precision differences between STT APIs)
        const ts = Math.round(segment.timestamp / 10) * 10;
        
        const hash = `${segment.speaker}|${norm}|${ts}`;
        if (this.lastTranscriptHash === hash) {
            return null; // Duplicate dropped silently
        }
        this.lastTranscriptHash = hash;

        if (!segment.final) return null;

        const role = this.mapSpeakerToRole(segment.speaker);
        const text = segment.text.trim();

        if (!text) return null;

        // Deduplicate: check if this exact item already exists
        const lastItem = this.contextItems[this.contextItems.length - 1];
        if (lastItem &&
            lastItem.role === role &&
            Math.abs(lastItem.timestamp - segment.timestamp) < 500 &&
            lastItem.text === text) {
            return null;
        }

        this.contextItems.push({
            role,
            text,
            timestamp: segment.timestamp
        });

        this.evictOldEntries();

        // Filter out internal system prompts that might be passed via IPC
        const isInternalPrompt = text.startsWith("You are a real-time interview assistant") ||
            text.startsWith("You are a helper") ||
            text.startsWith("CONTEXT:");

        if (!isInternalPrompt) {
            // Add to session transcript
            this.fullTranscript.push(segment);
            // Compact transcript with summarization instead of losing early context
            // Fire-and-forget: sync context; errors are caught internally
            void this.compactTranscriptIfNeeded().catch(e =>
                console.warn('[SessionTracker] compactTranscript error (non-fatal):', e)
            );
        }

        return { role };
    }

    /**
     * Add assistant-generated message to context
     */
    addAssistantMessage(text: string, options?: { trackAsLastMessage?: boolean }): void {
        console.log(`[SessionTracker] addAssistantMessage called with:`, text.substring(0, 50));

        // TeamSync-style filtering
        if (!text) return;

        const cleanText = text.trim();
        if (cleanText.length < 10) {
            console.warn(`[SessionTracker] Ignored short message (<10 chars)`);
            return;
        }

        if (cleanText.includes("I'm not sure") || cleanText.includes("I can't answer")) {
            console.warn(`[SessionTracker] Ignored fallback message`);
            return;
        }

        this.contextItems.push({
            role: 'assistant',
            text: cleanText,
            timestamp: Date.now()
        });

        // Also add to fullTranscript so it persists in the session history (and summaries)
        this.fullTranscript.push({
            speaker: 'assistant',
            text: cleanText,
            timestamp: Date.now(),
            final: true,
            confidence: 1.0,
            _sessionId: this.sessionId,
        });

        // Compact transcript with summarization instead of losing early context
        // Fire-and-forget: sync context; errors are caught internally
        void this.compactTranscriptIfNeeded().catch(e =>
            console.warn('[SessionTracker] compactTranscript error (non-fatal):', e)
        );

        if (options?.trackAsLastMessage !== false) {
            this.lastAssistantMessage = cleanText;

            // Temporal RAG: Track response history for anti-repetition
            this.assistantResponseHistory.push({
                text: cleanText,
                timestamp: Date.now(),
                questionContext: this.getLastInterviewerTurn() || 'unknown'
            });

            // Keep history bounded (last 10 responses)
            if (this.assistantResponseHistory.length > 10) {
                this.assistantResponseHistory = this.assistantResponseHistory.slice(-10);
            }

            console.log(`[SessionTracker] lastAssistantMessage updated, history size: ${this.assistantResponseHistory.length}`);
        }
        this.evictOldEntries();
    }

    /**
     * Handle incoming transcript from native audio service
     */
    handleTranscript(segment: TranscriptSegment): { role: 'interviewer' | 'user' | 'assistant' } | null {
        if (segment._sessionId !== this.sessionId) {
            return null;
        }

        // Track interim segments for interviewer to prevent data loss on stop
        if (segment.speaker === 'user') {
            if (isVerboseLogging() && (Math.random() < 0.05 || segment.final)) {
                console.log(`[SessionTracker] RX User Segment: Final=${segment.final} Text="${segment.text.substring(0, 50)}..."`);
            }
        }
        if (segment.speaker === 'interviewer') {
            if (isVerboseLogging() && (Math.random() < 0.05 || segment.final)) {
                console.log(`[SessionTracker] RX Interviewer Segment: Final=${segment.final} Text="${segment.text.substring(0, 50)}..."`);
            }

            if (!segment.final) {
                this.lastInterimInterviewer = segment;
            } else {
                this.lastInterimInterviewer = null;

                // Add segment to rolling buffer and evict old entries
                this.recentInterviewerBuffer.push({ text: segment.text, timestamp: segment.timestamp });
                const bufferCutoff = Date.now() - SessionTracker.INTERVIEWER_BUFFER_WINDOW_MS;
                this.recentInterviewerBuffer = this.recentInterviewerBuffer.filter(e => e.timestamp >= bufferCutoff);

                // Test single segment first; if no match, test accumulated recent turns
                // (interviewer may state a problem across multiple speech segments)
                if (this.looksLikeCodingQuestion(segment.text)) {
                    this.setCodingQuestion(segment.text, 'transcript');
                } else if (this.recentInterviewerBuffer.length > 1) {
                    const combinedText = this.recentInterviewerBuffer.map(e => e.text).join(' ');
                    if (this.looksLikeCodingQuestion(combinedText)) {
                        this.setCodingQuestion(combinedText, 'transcript');
                    }
                }
            }
        }

        return this.addTranscript(segment);
    }

    // ============================================
    // Context Accessors
    // ============================================

    /**
     * Get context items within the last N seconds
     */
    getContext(lastSeconds: number = 120): ContextItem[] {
        const cutoff = Date.now() - (lastSeconds * 1000);
        return this.contextItems.filter(item => item.timestamp >= cutoff);
    }

    getLastAssistantMessage(): string | null {
        return this.lastAssistantMessage;
    }

    getMode(): SessionMode {
        return this.sessionMode;
    }

    setMode(mode: SessionMode): void {
        this.sessionMode = mode;
    }

    getAssistantResponseHistory(): AssistantResponse[] {
        return this.assistantResponseHistory;
    }

    getLastInterimInterviewer(): TranscriptSegment | null {
        return this.lastInterimInterviewer;
    }

    /**
     * Get formatted context string for LLM prompts
     */
    getFormattedContext(lastSeconds: number = 120): string {
        const items = this.getContext(lastSeconds);
        let tokens = 0;
        const MAX_SAFE_TOKENS = 1500;
        const recent: string[] = [];

        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            const label = item.role === 'interviewer' ? 'INTERVIEWER' :
                item.role === 'user' ? 'ME' :
                    'ASSISTANT (PREVIOUS SUGGESTION)';
            const textStr = `[${label}]: ${item.text}`;
            const t = this.estimateTokens(textStr);

            if (tokens + t > MAX_SAFE_TOKENS) break;

            recent.unshift(textStr);
            tokens += t;
        }

        return recent.join('\n');
    }

    /**
     * Get the last interviewer turn.
     * Merges consecutive interviewer segments that are within a short gap
     * (≤15s) so that a multi-segment question spoken with natural pauses
     * is returned as a single cohesive turn instead of just the last fragment.
     */
    getLastInterviewerTurn(): string | null {
        // Walk backwards through contextItems and collect consecutive interviewer turns
        const segments: string[] = [];
        let prevTimestamp: number | null = null;
        const MAX_GAP_MS = 15_000; // 15 seconds — treat as same turn if gap is smaller

        for (let i = this.contextItems.length - 1; i >= 0; i--) {
            const item = this.contextItems[i];
            if (item.role !== 'interviewer') {
                // Hit a non-interviewer turn — stop if we already have segments
                if (segments.length > 0) break;
                // Otherwise keep scanning backwards to find the last interviewer block
                continue;
            }

            // If we already collected segments, check the gap
            if (prevTimestamp !== null && (prevTimestamp - item.timestamp) > MAX_GAP_MS) {
                break; // Gap too large — different speaking turn
            }

            segments.unshift(item.text);
            prevTimestamp = item.timestamp;
        }

        if (segments.length === 0) return null;
        return segments.join(' ');
    }

    /**
     * Approximate token estimation (1 token ≈ 3.5 chars)
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 3.5);
    }

    estimateTokenCount(text: string): number {
        return this.estimateTokens(text);
    }

    private contextRoleLabel(role: ContextItem['role']): string {
        return role === 'interviewer' ? 'INTERVIEWER'
            : role === 'user' ? 'ME'
                : 'ASSISTANT';
    }

    private transcriptSpeakerLabel(speaker: TranscriptSegment['speaker']): string {
        const role = this.mapSpeakerToRole(speaker);
        return role === 'interviewer' ? 'INTERVIEWER'
            : role === 'user' ? 'ME'
                : 'ASSISTANT';
    }

    private capFormattedLines(lines: string[], maxTokens: number): string {
        if (maxTokens <= 0) return '';

        let tokens = 0;
        const kept: string[] = [];
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const lineTokens = this.estimateTokens(line);
            if (tokens + lineTokens > maxTokens) {
                break;
            }
            kept.unshift(line);
            tokens += lineTokens;
        }
        return kept.join('\n');
    }

    /**
     * Get full session context from accumulated transcript (User + Interviewer + Assistant)
     */
    getFullSessionContext(): string {
        return this.getCappedFullTranscript(SessionTracker.DEFAULT_FULL_TRANSCRIPT_TOKENS);
    }

    getCappedFullTranscript(maxTokens: number = SessionTracker.DEFAULT_FULL_TRANSCRIPT_TOKENS): string {
        const transcriptLines = this.fullTranscript.map((segment) => {
            return `[${this.transcriptSpeakerLabel(segment.speaker)}]: ${segment.text}`;
        });
        const recentTranscript = this.capFormattedLines(transcriptLines, maxTokens);

        if (this.transcriptEpochSummaries.length === 0) {
            return recentTranscript;
        }

        const recentBlock = recentTranscript ? `[RECENT TRANSCRIPT]\n${recentTranscript}` : '[RECENT TRANSCRIPT]';
        const recentBlockTokens = this.estimateTokens(recentBlock);
        const remainingTokens = Math.max(0, maxTokens - recentBlockTokens);
        const summaryHeader = '[SESSION HISTORY - EARLIER DISCUSSION]\n';
        const summaryHeaderTokens = this.estimateTokens(summaryHeader);

        if (remainingTokens <= summaryHeaderTokens + 20) {
            return recentBlock;
        }

        let epochContext = '';
        let currentTokens = 0;
        const maxSummaryTokens = remainingTokens - summaryHeaderTokens;

        for (let i = this.transcriptEpochSummaries.length - 1; i >= 0; i--) {
            const summary = this.transcriptEpochSummaries[i];
            const summaryWithSeparator = epochContext ? `${summary}\n---\n` : summary;
            const summaryTokens = this.estimateTokens(summaryWithSeparator);
            if (currentTokens + summaryTokens > maxSummaryTokens) {
                break;
            }
            epochContext = summary + (epochContext ? `\n---\n${epochContext}` : '');
            currentTokens += summaryTokens;
        }

        if (!epochContext) {
            return recentBlock;
        }

        return `${summaryHeader}${epochContext}\n\n${recentBlock}`;
    }

    getRollingWindowTranscript(
        lastSeconds: number = 180,
        maxItems: number = 18,
        includeInterim: boolean = true,
        maxTokens: number = SessionTracker.DEFAULT_ROLLING_TRANSCRIPT_TOKENS
    ): string {
        const items = this.getContext(lastSeconds);
        const selected = items.slice(-maxItems);

        if (includeInterim && this.lastInterimInterviewer?.text?.trim()) {
            const lastItem = selected[selected.length - 1];
            const isDuplicate = lastItem
                && lastItem.role === 'interviewer'
                && lastItem.text === this.lastInterimInterviewer.text;

            if (!isDuplicate) {
                selected.push({
                    role: 'interviewer',
                    text: this.lastInterimInterviewer.text.trim(),
                    timestamp: this.lastInterimInterviewer.timestamp,
                });
            }
        }

        const formatted = selected.map((item) => `[${this.contextRoleLabel(item.role)}]: ${item.text}`);
        return this.capFormattedLines(formatted, maxTokens);
    }

    getRollingTranscriptWindow(
        lastSeconds: number = 180,
        maxItems: number = 18,
        includeInterim: boolean = true
    ): string {
        return this.getRollingWindowTranscript(
            lastSeconds,
            maxItems,
            includeInterim,
            SessionTracker.DEFAULT_ROLLING_TRANSCRIPT_TOKENS
        );
    }

    // ============================================
    // Session Data Accessors (for MeetingPersistence)
    // ============================================

    getFullTranscript(): TranscriptSegment[] {
        return this.fullTranscript;
    }

    getFullUsage(): any[] {
        return this.fullUsage;
    }

    getSessionStartTime(): number {
        return this.sessionStartTime;
    }

    // ============================================
    // Usage Tracking
    // ============================================

    /**
     * Cap usage array with simple eviction (usage doesn't need summarization)
     */
    capUsageArray(): void {
        if (this.fullUsage.length > 500) {
            this.fullUsage = this.fullUsage.slice(-500);
        }
    }

    /**
     * Public method to log usage from external sources (e.g. IPC direct chat)
     */
    logUsage(type: string, question: string, answer: string): void {
        this.fullUsage.push({
            type,
            timestamp: Date.now(),
            question,
            answer
        });
    }

    pushUsage(entry: any): void {
        this.fullUsage.push(entry);
        this.capUsageArray();
    }

    addUserMessage(text: string, timestamp: number = Date.now()): void {
        const trimmed = text.trim();
        if (!trimmed) return;

        this.addTranscript({
            speaker: 'user',
            text: trimmed,
            timestamp,
            final: true,
            confidence: 1.0,
            _sessionId: this.sessionId,
        });
    }

    // ============================================
    // Interim Transcript Flush
    // ============================================

    /**
     * Force-save any pending interim transcript (called on meeting stop)
     */
    flushInterimTranscript(): void {
        if (this.lastInterimInterviewer) {
            console.log('[SessionTracker] Force-saving pending interim transcript:', this.lastInterimInterviewer.text);
            const finalSegment = { ...this.lastInterimInterviewer, final: true };
            this.addTranscript(finalSegment);
            this.lastInterimInterviewer = null;
        }
    }

    // ============================================
    // Reset
    // ============================================

    async finalize(): Promise<void> {
        while (this.isCompacting) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    reset(): void {
        this.sessionId = Date.now().toString() + Math.random().toString(36).substring(7);
        this.currentGenerationId++;
        this.contextItems = [];
        this.fullTranscript = [];
        this.fullUsage = [];
        this.sessionMode = 'general';
        this.transcriptEpochSummaries = [];
        this.sessionStartTime = Date.now();
        this.lastAssistantMessage = null;
        this.assistantResponseHistory = [];
        this.lastInterimInterviewer = null;
        this.detectedCodingQuestion = null;
        this.codingQuestionSource = null;
        this.codingQuestionSetAt = null;
        this.recentInterviewerBuffer = [];
        this.lastTranscriptHash = null;
        // FIX §3.4: Clear the compaction lock so the new session is never blocked
        // by an in-flight epoch summarization that was running when reset() fired.
        this.isCompacting = false;
    }

    // ============================================
    // Private Helpers
    // ============================================

    mapSpeakerToRole(speaker: string): 'interviewer' | 'user' | 'assistant' {
        if (speaker === 'user') return 'user';
        if (speaker === 'assistant') return 'assistant';
        return 'interviewer'; // system audio = interviewer
    }

    private evictOldEntries(): void {
        const cutoff = Date.now() - (this.contextWindowDuration * 1000);
        this.contextItems = this.contextItems.filter(item => item.timestamp >= cutoff);

        // Safety limit
        if (this.contextItems.length > this.maxContextItems) {
            this.contextItems = this.contextItems.slice(-this.maxContextItems);
        }
    }

    /**
     * Compact transcript buffer by summarizing oldest entries into an epoch summary.
     * Called instead of raw slice() to preserve early meeting context.
     */
    private async compactTranscriptIfNeeded(): Promise<void> {
        if (this.fullTranscript.length <= 1800 || this.isCompacting) return;

        this.isCompacting = true;
        try {
            // Take the oldest 500 entries to summarize
            const summarizeCount = 500;
            const oldEntries = this.fullTranscript.slice(0, summarizeCount);
            const summaryInput = oldEntries.map(seg => {
                const role = this.mapSpeakerToRole(seg.speaker);
                const label = role === 'interviewer' ? 'INTERVIEWER' :
                    role === 'user' ? 'ME' : 'ASSISTANT';
                return `[${label}]: ${seg.text}`;
            }).join('\n');

            // Fire-and-forget LLM summarization (non-blocking)
            if (this.recapLLM) {
                this.currentGenerationId++;
                const generationId = this.currentGenerationId;
                
                try {
                    const timeoutPromise = new Promise<string>((_, reject): void => { setTimeout((): void => reject(new Error("LLM timeout")), 15000); });
                    const generatePromise = this.recapLLM.generate(
                        [
                            'Summarize this conversation segment into compact long-term memory.',
                            'Return 4-6 concise bullets.',
                            'Preserve key people, systems, entities, requirements, decisions, tradeoffs, and open questions.',
                            'Keep terminology and named components intact.',
                            'Do not add information that was not discussed.',
                            '',
                            summaryInput,
                        ].join('\n')
                    );
                    const epochSummary = await Promise.race([generatePromise, timeoutPromise]);
                    
                    if (generationId !== this.currentGenerationId) {
                        console.log(`[GENERATION_DISCARDED] [SessionTracker] generationId mismatched during compaction`);
                        return;
                    }

                    if (epochSummary && epochSummary.trim().length > 0) {
                        this.transcriptEpochSummaries.push(epochSummary.trim());
                        console.log(`[SessionTracker] Epoch summary created (${this.transcriptEpochSummaries.length} total)`);
                    } else {
                        // Empty LLM response — store a basic marker so context is not lost
                        const marker = `[Earlier discussion summary unavailable: ${oldEntries.length} segments. Preserve topics/entities from: ${oldEntries.slice(0, 3).map(s => s.text.substring(0, 60)).join(' | ')}]`;
                        this.transcriptEpochSummaries.push(marker);
                    }
                } catch (e) {
                    // If summarization fails, store a simple marker
                    const fallback = `[Earlier discussion summary failed: ${oldEntries.length} segments. Key fragments: ${oldEntries.slice(0, 3).map(s => s.text.substring(0, 60)).join(' | ')}]`;
                    this.transcriptEpochSummaries.push(fallback);
                    console.warn('[SessionTracker] Epoch summarization failed, using fallback marker');
                }
            } else {
                // BUG-03 fix: recapLLM not yet available — always push a plain marker so early
                // context is not silently discarded with no record in transcriptEpochSummaries.
                const marker = `[Earlier discussion retained without LLM summary: ${oldEntries.length} segments. Key fragments: ${oldEntries.slice(0, 3).map(s => s.text.substring(0, 60)).join(' | ')}]`;
                this.transcriptEpochSummaries.push(marker);
                console.warn('[SessionTracker] recapLLM not available — storing plain epoch marker');
            }

            // Cap epoch summaries to prevent LLM context window overflow
            if (this.transcriptEpochSummaries.length > SessionTracker.MAX_EPOCH_SUMMARIES) {
                this.transcriptEpochSummaries = this.transcriptEpochSummaries.slice(-SessionTracker.MAX_EPOCH_SUMMARIES);
            }

            // Evict ONLY the exact 500 oldest entries that we just summarized
            this.fullTranscript = this.fullTranscript.slice(summarizeCount);
        } finally {
            this.isCompacting = false;
        }
    }
}
