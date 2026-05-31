// IntelligenceManager.ts
// Thin facade that delegates to focused sub-modules.
// Maintains full backward compatibility — all existing callers continue to work unchanged.
//
// Sub-modules:
//   SessionTracker     — state, transcript arrays, context management, epoch compaction
//   IntelligenceEngine — LLM mode routing (6 modes), event emission
//   MeetingPersistence — meeting stop/save/recovery

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { SessionTracker, type SessionMode } from './SessionTracker';
import { IntelligenceEngine } from './IntelligenceEngine';
import { MeetingPersistence } from './MeetingPersistence';
import type { ConversationIntent, ScreenContentMode } from './llm';
import type { ActionRagContext, UnifiedActionIntent } from './ActionContextBuilder';

type UserControlledMode = 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design';

// Re-export types for backward compatibility
export type { TranscriptSegment, SuggestionTrigger, ContextItem } from './SessionTracker';
export type { IntelligenceMode, IntelligenceModeEvents } from './IntelligenceEngine';

export const GEMINI_FLASH_MODEL = "gemini-3.1-flash-lite-preview";

/**
 * IntelligenceManager - Facade for the intelligence layer.
 * 
 * Delegates to:
 * - SessionTracker:     context, transcripts, epoch summaries
 * - IntelligenceEngine: LLM modes (assist, whatToSay, followUp, recap, clarify, manual, followUpQuestions)
 * - MeetingPersistence: meeting stop/save/recovery
 */
export class IntelligenceManager extends EventEmitter {
    private session: SessionTracker;
    private engine: IntelligenceEngine;
    private persistence: MeetingPersistence;

    constructor(llmHelper: LLMHelper) {
        super();
        this.session = new SessionTracker();
        this.engine = new IntelligenceEngine(llmHelper, this.session);
        this.persistence = new MeetingPersistence(this.session, llmHelper);

        // Forward all engine events through the facade
        this.forwardEngineEvents();
    }

    /**
     * Forward all events from IntelligenceEngine through this facade
     * so existing listeners on IntelligenceManager continue to work.
     */
    private forwardEngineEvents(): void {
        const events = [
            'assist_update', 'suggested_answer', 'suggested_answer_token',
            'refined_answer', 'refined_answer_token',
            'recap', 'recap_token', 'clarify', 'clarify_token',
            'follow_up_questions_update', 'follow_up_questions_token',
            'system_design_tradeoffs', 'system_design_tradeoffs_token',
            'screen_scan_result', 'screen_scan_token',
            'manual_answer_started', 'manual_answer_result',
            'action_token', 'action_result',
            'mode_changed', 'error'
        ];

        for (const event of events) {
            this.engine.on(event, (...args: any[]) => {
                this.emit(event, ...args);
            });
        }
    }

    // ============================================
    // LLM Initialization (delegates to engine)
    // ============================================

    initializeLLMs(): void {
        // Cancel any in-flight streams before swapping LLM clients
        this.engine.reset();
        this.engine.initializeLLMs();
    }

    reinitializeLLMs(): void {
        this.engine.reset();
        this.engine.reinitializeLLMs();
    }

    // ============================================
    // Context Management (delegates to session)
    // ============================================

    setMeetingMetadata(metadata: any): void {
        this.session.setMeetingMetadata(metadata);
    }

    addTranscript(segment: import('./SessionTracker').TranscriptSegment, skipRefinementCheck: boolean = false): void {
        if (skipRefinementCheck) {
            // Direct add without refinement detection
            this.session.addTranscript(segment);
        } else {
            // Let the engine handle transcript + refinement detection
            this.engine.handleTranscript(segment, false);
        }
    }

    addAssistantMessage(text: string): void {
        this.session.addAssistantMessage(text);
    }

    getContext(lastSeconds: number = 120) {
        return this.session.getContext(lastSeconds);
    }

    getLastAssistantMessage(): string | null {
        return this.session.getLastAssistantMessage();
    }

    getCurrentRequestId(): string | null {
        return this.engine.getCurrentRequestId();
    }

    /**
     * Expose the engine for targeted per-request cancellation.
     * Prefer using facade methods; this is only for cancel-intelligence-by-request IPC.
     */
    getEngine(): IntelligenceEngine {
        return this.engine;
    }

    getSessionId(): string {
        return this.session.sessionId;
    }

    getSessionMode(): SessionMode {
        return this.session.getMode();
    }

    setSessionMode(mode: SessionMode): void {
        this.session.setMode(mode);
    }

    getFormattedContext(lastSeconds: number = 120): string {
        return this.session.getFormattedContext(lastSeconds);
    }

    getLastInterviewerTurn(): string | null {
        return this.session.getLastInterviewerTurn();
    }

    logUsage(type: string, question: string, answer: string): void {
        this.session.logUsage(type, question, answer);
    }

    // ============================================
    // Transcript Handling (delegates to engine)
    // ============================================

    handleTranscript(segment: import('./SessionTracker').TranscriptSegment): void {
        this.engine.handleTranscript(segment);
    }

    async handleSuggestionTrigger(trigger: import('./SessionTracker').SuggestionTrigger): Promise<void> {
        return this.engine.handleSuggestionTrigger(trigger);
    }

    // ============================================
    // Mode Executors (delegates to engine)
    // ============================================

    async runAssistMode(): Promise<string | null> {
        return this.engine.runAssistMode();
    }

    async runAction(params: {
        intent: UnifiedActionIntent;
        message?: string;
        imagePaths?: string[];
        requestId?: string;
        profilePreference?: 'default' | 'force_on' | 'force_off';
        additionalContext?: string;
	        rag?: ActionRagContext | null;
	        modeOverride?: UserControlledMode;
	        screenScanMode?: ScreenContentMode;
	        modelOverride?: string;
    }): Promise<string | null> {
        return this.engine.runAction(params);
    }

    async handleAction(
        intent: UnifiedActionIntent,
        options: {
            message?: string;
            imagePaths?: string[];
            requestId?: string;
            profilePreference?: 'default' | 'force_on' | 'force_off';
            additionalContext?: string;
	            rag?: ActionRagContext | null;
	            modeOverride?: UserControlledMode;
	            screenScanMode?: ScreenContentMode;
	            modelOverride?: string;
        } = {}
    ): Promise<string | null> {
        return this.runAction({
            intent,
            message: options.message,
            imagePaths: options.imagePaths,
            requestId: options.requestId,
            profilePreference: options.profilePreference,
            additionalContext: options.additionalContext,
	            rag: options.rag,
	            modeOverride: options.modeOverride,
	            screenScanMode: options.screenScanMode,
	            modelOverride: options.modelOverride,
	        });
    }

    async runWhatShouldISay(question?: string, confidence?: number, imagePaths?: string[], mode?: UserControlledMode, requestId?: string): Promise<string | null> {
        return this.engine.runWhatShouldISay(question, confidence, imagePaths, mode, requestId);
    }

    async runFollowUp(intent: string, userRequest?: string, requestId?: string): Promise<string | null> {
        return this.engine.runFollowUp(intent, userRequest, requestId);
    }

    async runRecap(requestId?: string): Promise<string | null> {
        return this.handleAction('recap', { requestId, profilePreference: 'force_off' });
    }

    async runClarify(requestId?: string): Promise<string | null> {
        return this.handleAction('clarify', { requestId, profilePreference: 'force_off' });
    }

    async runFollowUpQuestions(requestId?: string): Promise<string | null> {
        return this.handleAction('follow_up_questions', { requestId, profilePreference: 'force_off' });
    }

    async runSystemDesignTradeoffs(requestId?: string): Promise<string | null> {
        return this.engine.runSystemDesignTradeoffs(requestId);
    }

    async runManualAnswer(question: string, requestId?: string): Promise<string | null> {
        return this.handleAction('manual_chat', {
            message: question,
            requestId,
        });
    }

    async runCodeHint(imagePaths?: string[], problemStatement?: string, requestId?: string): Promise<string | null> {
        return this.engine.runCodeHint(imagePaths, problemStatement, requestId);
    }

    setCodingQuestion(question: string, source: 'screenshot' | 'transcript'): void {
        this.session.setCodingQuestion(question, source);
    }

    getDetectedCodingQuestion(): { question: string | null; source: 'screenshot' | 'transcript' | null } {
        return this.session.getDetectedCodingQuestion();
    }

    clearCodingQuestion(): void {
        this.session.clearCodingQuestion();
    }

    async runBrainstorm(imagePaths?: string[], problemStatement?: string, requestId?: string): Promise<string | null> {
        return this.engine.runBrainstorm(imagePaths, problemStatement, requestId);
    }

    async runScreenScan(imagePaths: string[], extractedText?: string, forcedMode?: import('./llm').ScreenContentMode, requestId?: string): Promise<string | null> {
        return this.engine.runScreenScan(imagePaths, extractedText, forcedMode, requestId);
    }

    // ============================================
    // State Management
    // ============================================

    getActiveMode() {
        return this.engine.getActiveMode();
    }

    setMode(mode: import('./IntelligenceEngine').IntelligenceMode): void {
        // This was private in the original, but kept for compatibility
        (this.engine as any).setMode(mode);
    }

    // ============================================
    // Meeting Lifecycle (delegates to persistence)
    // ============================================

    async stopMeeting(): Promise<string | null> {
        await this.session.finalize();
        return this.persistence.stopMeeting();
    }

    async recoverUnprocessedMeetings(): Promise<void> {
        return this.persistence.recoverUnprocessedMeetings();
    }

    // ============================================
    // Reset (resets all sub-modules)
    // ============================================

    /**
     * resetEngine: Cancel in-flight LLM streams WITHOUT touching session state.
     * Use this when swapping API keys or providers mid-session so the transcript
     * is not wiped. (full reset() also clears the session — only use that at
     * end of meeting or explicit session teardown.)
     */
    resetEngine(): void {
        this.engine.reset();
    }

    reset(): void {
        this.session.reset();
        this.engine.reset();
    }
}
