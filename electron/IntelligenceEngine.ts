// IntelligenceEngine.ts
// LLM mode routing and orchestration.
// Extracted from IntelligenceManager to decouple LLM logic from state management.

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { SessionTracker, TranscriptSegment, SuggestionTrigger, ContextItem } from './SessionTracker';
import {
    AnswerLLM, AssistLLM, BrainstormLLM, ClarifyLLM, CodeHintLLM, FollowUpLLM, RecapLLM,
    FollowUpQuestionsLLM, SystemDesignTradeoffsLLM, WhatToAnswerLLM,
    prepareTranscriptForWhatToAnswer, buildTemporalContext,
    AssistantResponse as LLMAssistantResponse, classifyIntent, getAnswerShapeGuidance,
    buildBoundedRecapContext
} from './llm';
import type { ConversationIntent } from './llm';

// Mode types
export type IntelligenceMode = 'idle' | 'assist' | 'what_to_say' | 'follow_up' | 'recap' | 'clarify' | 'manual' | 'follow_up_questions' | 'code_hint' | 'brainstorm' | 'system_design_tradeoffs';

// Refinement intent detection (refined to avoid false positives)
function detectRefinementIntent(userText: string): { isRefinement: boolean; intent: string } {
    const lowercased = userText.toLowerCase().trim();
    const refinementPatterns = [
        { pattern: /make it longer|expand on this|elaborate more/i, intent: 'expand' },
        { pattern: /rephrase that|say it differently|put it another way/i, intent: 'rephrase' },
        { pattern: /give me an example|provide an instance/i, intent: 'add_example' },
        { pattern: /make it more confident|be more assertive|sound stronger/i, intent: 'more_confident' },
        { pattern: /make it casual|be less formal|sound relaxed/i, intent: 'more_casual' },
        { pattern: /make it formal|be more professional|sound professional/i, intent: 'more_formal' },
        { pattern: /simplify this|make it simpler|explain specifically/i, intent: 'simplify' },
    ];

    for (const { pattern, intent } of refinementPatterns) {
        if (pattern.test(lowercased)) {
            return { isRefinement: true, intent };
        }
    }

    return { isRefinement: false, intent: '' };
}

// Events emitted by IntelligenceEngine
export interface IntelligenceModeEvents {
    'assist_update': (insight: string, requestId?: string | null) => void;
    'suggested_answer': (answer: string, question: string, confidence: number, requestId?: string | null) => void;
    'suggested_answer_token': (token: string, question: string, confidence: number, requestId?: string | null) => void;
    'refined_answer': (answer: string, intent: string, requestId?: string | null) => void;
    'refined_answer_token': (token: string, intent: string, requestId?: string | null) => void;
    'recap': (summary: string, requestId?: string | null) => void;
    'recap_token': (token: string, requestId?: string | null) => void;
    'clarify': (clarification: string, requestId?: string | null) => void;
    'clarify_token': (token: string, requestId?: string | null) => void;
    'follow_up_questions_update': (questions: string, requestId?: string | null) => void;
    'follow_up_questions_token': (token: string, requestId?: string | null) => void;
    'system_design_tradeoffs': (answer: string, requestId?: string | null) => void;
    'system_design_tradeoffs_token': (token: string, requestId?: string | null) => void;
    'manual_answer_started': (requestId?: string | null) => void;
    'manual_answer_result': (answer: string, question: string, requestId?: string | null) => void;
    'mode_changed': (mode: IntelligenceMode) => void;
    'error': (error: Error, mode: IntelligenceMode, requestId?: string | null) => void;
}

export class IntelligenceEngine extends EventEmitter {
    // Mode state
    private activeMode: IntelligenceMode = 'idle';

    // Mode-specific LLMs
    private answerLLM: AnswerLLM | null = null;
    private assistLLM: AssistLLM | null = null;
    private clarifyLLM: ClarifyLLM | null = null;
    private followUpLLM: FollowUpLLM | null = null;
    private recapLLM: RecapLLM | null = null;
    private followUpQuestionsLLM: FollowUpQuestionsLLM | null = null;
    private whatToAnswerLLM: WhatToAnswerLLM | null = null;
    private codeHintLLM: CodeHintLLM | null = null;
    private brainstormLLM: BrainstormLLM | null = null;
    private systemDesignTradeoffsLLM: SystemDesignTradeoffsLLM | null = null;

    // Concurrency tracking
    private assistCancellationToken: AbortController | null = null;
    private currentGenerationId: number = 0;
    private currentClientRequestId: string | null = null;

    // Per-request AbortController map — cancel(requestId) only cancels that request
    private requestAbortControllers = new Map<string, AbortController>();

    // Keep reference to LLMHelper for client access
    private llmHelper: LLMHelper;

    // Reference to SessionTracker for context
    private session: SessionTracker;

    // Timestamps for tracking
    private lastTranscriptTime: number = 0;
    private lastTriggerTime: number = 0;
    private readonly triggerCooldown: number = 3000; // 3 seconds

    constructor(llmHelper: LLMHelper, session: SessionTracker) {
        super();
        this.llmHelper = llmHelper;
        this.session = session;
        this.initializeLLMs();
    }

    getLLMHelper(): LLMHelper {
        return this.llmHelper;
    }

    getCurrentRequestId(): string | null {
        return this.currentClientRequestId;
    }

    /**
     * Cancel a specific request by its requestId.
     * Only aborts that request — no global abort.
     */
    cancelRequest(requestId: string): void {
        const controller = this.requestAbortControllers.get(requestId);
        if (controller) {
            controller.abort();
            this.requestAbortControllers.delete(requestId);
            console.log(`[IntelligenceEngine] Cancelled request: ${requestId}`);
        }
    }

    /**
     * Create an AbortController for a request and register it.
     * Returns the AbortController for signal checking.
     */
    private registerRequestAbort(requestId: string): AbortController {
        // Clean up any existing controller for this request
        this.requestAbortControllers.get(requestId)?.abort();
        const controller = new AbortController();
        this.requestAbortControllers.set(requestId, controller);
        return controller;
    }

    /**
     * Clean up AbortController after request completes.
     */
    private cleanupRequestAbort(requestId: string | null): void {
        if (requestId) {
            this.requestAbortControllers.delete(requestId);
        }
    }

    /**
     * FINAL EMIT GUARD
     * Enforces two conditions before any completion-level emit:
     *   1. The request signal is not aborted
     *   2. The requestId still exists in the map (not cleaned up or cancelled)
     * Token-level emits are already guarded by the stream loop itself.
     */
    private safeEmit(
        signal: AbortSignal | undefined,
        requestId: string | null,
        event: string,
        ...args: any[]
    ): boolean {
        if (signal?.aborted) return false;
        if (requestId && !this.requestAbortControllers.has(requestId)) return false;
        return this.emit(event, ...args, requestId);
    }


    getRecapLLM(): RecapLLM | null {
        return this.recapLLM;
    }

    // ============================================
    // LLM Initialization
    // ============================================

    /**
     * Initialize or Re-Initialize mode-specific LLMs with shared Gemini client and Groq client
     * Must be called after API keys are updated.
     */
    initializeLLMs(): void {
        console.log(`[IntelligenceEngine] Initializing LLMs with LLMHelper`);
        this.answerLLM = new AnswerLLM(this.llmHelper);
        this.assistLLM = new AssistLLM(this.llmHelper);
        this.clarifyLLM = new ClarifyLLM(this.llmHelper);
        this.followUpLLM = new FollowUpLLM(this.llmHelper);
        this.recapLLM = new RecapLLM(this.llmHelper);
        this.followUpQuestionsLLM = new FollowUpQuestionsLLM(this.llmHelper);
        this.whatToAnswerLLM = new WhatToAnswerLLM(this.llmHelper);
        this.codeHintLLM = new CodeHintLLM(this.llmHelper);
        this.brainstormLLM = new BrainstormLLM(this.llmHelper);
        this.systemDesignTradeoffsLLM = new SystemDesignTradeoffsLLM(this.llmHelper);

        // Sync RecapLLM reference to SessionTracker for epoch compaction
        this.session.setRecapLLM(this.recapLLM);
    }

    reinitializeLLMs(): void {
        this.initializeLLMs();
    }

    // ============================================
    // Transcript Handling (delegates to SessionTracker)
    // ============================================

    /**
     * Process transcript from native audio, and trigger follow-up if appropriate
     */
    handleTranscript(segment: TranscriptSegment, skipRefinementCheck: boolean = false): void {
        const result = this.session.handleTranscript(segment);
        this.lastTranscriptTime = Date.now();

        // Check for follow-up intent if user is speaking
        if (result && !skipRefinementCheck && result.role === 'user' && this.session.getLastAssistantMessage()) {
            const { isRefinement, intent } = detectRefinementIntent(segment.text.trim());
            if (isRefinement) {
                this.runFollowUp(intent, segment.text.trim());
            }
        }
    }

    /**
     * Handle suggestion trigger from native audio service
     * This is the primary auto-trigger path
     */
    async handleSuggestionTrigger(trigger: SuggestionTrigger): Promise<void> {
        if (trigger.confidence < 0.5) {
            return;
        }
        await this.runWhatShouldISay(trigger.lastQuestion, trigger.confidence);
    }

    // ============================================
    // Mode Executors
    // ============================================

    /**
     * Global LLM entry point. All NEW LLM invocations MUST use this wrapper.
     * Handles: abort registration, generation tracking, cleanup.
     * Existing modes use inline abort patterns (equivalent safety).
     */
    protected async runLLMGuarded<T>(
        requestId: string | null,
        mode: IntelligenceMode,
        fn: (signal: AbortSignal | undefined, generationId: number) => Promise<T>
    ): Promise<T | null> {
        this.currentClientRequestId = requestId;
        this.setMode(mode);

        const controller = requestId ? this.registerRequestAbort(requestId) : null;
        const signal = controller?.signal;
        const generationId = ++this.currentGenerationId;

        try {
            const result = await fn(signal, generationId);
            if (signal?.aborted) return null;
            return result;
        } catch (error) {
            if (signal?.aborted || (error as Error).name === 'AbortError') return null;
            this.emit('error', error as Error, mode, requestId);
            return null;
        } finally {
            this.cleanupRequestAbort(requestId);
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
        }
    }

    /**
     * MODE 1: Assist (Passive)
     * Low-priority observational insights
     */
    async runAssistMode(): Promise<string | null> {
        if (this.activeMode !== 'idle' && this.activeMode !== 'assist') {
            return null;
        }

        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
        }

        this.assistCancellationToken = new AbortController();
        this.setMode('assist');

        try {
            if (!this.assistLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(60);
            if (!context) {
                this.setMode('idle');
                return null;
            }

            const generationId = ++this.currentGenerationId;
            const timeoutPromise = new Promise<string | null>((_, reject) => { setTimeout(() => reject(new Error("LLM timeout")), 15000); });
            const insight = await Promise.race([this.assistLLM.generate(context), timeoutPromise]).catch((): any => null);

            if (this.assistCancellationToken?.signal.aborted) {
                return null;
            }
            // V3 Fix: discard result if a newer generation started while awaiting
            if (this.currentGenerationId !== generationId) {
                return null;
            }

            if (insight) {
                this.emit('assist_update', insight, null);
            }
            this.setMode('idle');
            return insight;

        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                return null;
            }
            this.emit('error', error as Error, 'assist', null);
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 2: What Should I Say (Primary)
     * Manual trigger - uses clean transcript pipeline for question inference
     * NEVER returns null - always provides a usable response
     */
    async runWhatShouldISay(question?: string, confidence: number = 0.8, imagePaths?: string[], forcedIntent?: ConversationIntent, requestId?: string): Promise<string | null> {
        const now = Date.now();
        const activeRequestId = requestId ?? null;
        this.currentClientRequestId = activeRequestId;

        // Bypass cooldown when the user explicitly attached images (capture-and-process intent).
        // The cooldown exists to debounce auto-triggers, not explicit shortcuts with context.
        const hasImages = imagePaths && imagePaths.length > 0;
        if (!hasImages && now - this.lastTriggerTime < this.triggerCooldown) {
            return null;
        }

        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        this.setMode('what_to_say');
        this.lastTriggerTime = now;

        // Register per-request AbortController
        const _abortWTS = activeRequestId ? this.registerRequestAbort(activeRequestId) : null;
        const _signalWTS = _abortWTS?.signal;

        try {
            if (!this.whatToAnswerLLM) {
                if (!this.answerLLM) {
                    this.setMode('idle');
                    return "Please configure your API Keys in Settings to use this feature.";
                }
                const context = this.session.getFormattedContext(180);
                const timeoutPromise = new Promise<string | null>((_, reject) => { setTimeout(() => reject(new Error("LLM timeout")), 15000); });
                const answer = await Promise.race([this.answerLLM.generate(question || '', context), timeoutPromise]).catch((): any => null);
                if (answer) {
                    this.session.addAssistantMessage(answer);
                    this.safeEmit(undefined, activeRequestId, 'suggested_answer', answer, question || 'inferred', confidence);
                }
                this.setMode('idle');
                return answer || "Could you repeat that? I want to make sure I address your question properly.";
            }

            const contextItems = this.session.getContext(180);

            // Inject latest interim transcript if available
            const lastInterim = this.session.getLastInterimInterviewer();
            if (lastInterim && lastInterim.text.trim().length > 0) {
                const lastItem = contextItems[contextItems.length - 1];
                const isDuplicate = lastItem &&
                    lastItem.role === 'interviewer' &&
                    (lastItem.text === lastInterim.text || Math.abs(lastItem.timestamp - lastInterim.timestamp) < 1000);

                if (!isDuplicate) {
                    console.log(`[IntelligenceEngine] Injecting interim transcript: "${lastInterim.text.substring(0, 50)}..."`);
                    contextItems.push({
                        role: 'interviewer',
                        text: lastInterim.text,
                        timestamp: lastInterim.timestamp
                    });
                }
            }

            const transcriptTurns = contextItems.map(item => ({
                role: item.role,
                text: item.text,
                timestamp: item.timestamp
            }));

            const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns, 12);

            const temporalContext = buildTemporalContext(
                contextItems,
                this.session.getAssistantResponseHistory(),
                180
            );

            const lastInterviewerTurn = this.session.getLastInterviewerTurn();
            const classifiedIntent = await classifyIntent(
                lastInterviewerTurn,
                preparedTranscript,
                this.session.getAssistantResponseHistory().length
            );
            const intentResult = forcedIntent
                ? {
                    intent: forcedIntent,
                    confidence: 1,
                    answerShape: getAnswerShapeGuidance(forcedIntent),
                }
                : classifiedIntent;

            console.log(`[IntelligenceEngine] Temporal RAG: ${temporalContext.previousResponses.length} responses, tone: ${temporalContext.toneSignals[0]?.type || 'neutral'}, intent: ${intentResult.intent}${imagePaths?.length ? `, with ${imagePaths.length} image(s)` : ''}`);

            const generationId = ++this.currentGenerationId;
            let fullAnswer = "";
            // RC-03 fix: hold a reference to the generator so we can call .return()
            // to properly terminate the network request when a new generation starts.
            const stream = this.whatToAnswerLLM.generateStream(preparedTranscript, temporalContext, intentResult, imagePaths);
            let streamAborted = false;

            for await (const token of stream) {
                if (_signalWTS?.aborted || this.currentGenerationId !== generationId) {
                    console.log('[GENERATION_DISCARDED] _what_to_say stream aborted by new generation');
                    // RC-03 fix: .return() signals the generator to clean up and stops
                    // the underlying network request (SDK generators honour this).
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('suggested_answer_token', token, question || 'inferred', confidence, activeRequestId);
                fullAnswer += token;
            }

            if (streamAborted) {
                // Aborted mid-stream — don't update session or emit final event
                this.setMode('idle');
                return null;
            }

            if (!fullAnswer || fullAnswer.trim().length < 5) {
                fullAnswer = "Could you repeat that? I want to make sure I address your question properly.";
            }

            this.session.addAssistantMessage(fullAnswer);

            this.session.pushUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: question || 'What to Answer',
                answer: fullAnswer
            });

            // CQ-05 fix: only emit the "complete" event after a non-aborted stream.
            if (_signalWTS?.aborted) {
                this.cleanupRequestAbort(activeRequestId);
                this.setMode('idle');
                return null;
            }
            // The renderer already has all tokens — this is for metadata only (e.g. copying, history).
            this.safeEmit(_signalWTS, activeRequestId, 'suggested_answer', fullAnswer, question || 'What to Answer', confidence);

            this.cleanupRequestAbort(activeRequestId);
            this.setMode('idle');
            return fullAnswer;

        } catch (error) {
            this.cleanupRequestAbort(activeRequestId);
            this.emit('error', error as Error, 'what_to_say', activeRequestId); // error path: emit always
            this.setMode('idle');
            return "Could you repeat that? I want to make sure I address your question properly.";
        }
    }

    /**
     * MODE 3: Follow-Up (Refinement)
     * Modify the last assistant message
     */
    async runFollowUp(intent: string, userRequest?: string, requestId?: string): Promise<string | null> {
        console.log(`[IntelligenceEngine] runFollowUp called with intent: ${intent}`);
        const activeRequestId = requestId ?? null;
        this.currentClientRequestId = activeRequestId;
        const lastMsg = this.session.getLastAssistantMessage();
        if (!lastMsg) {
            console.warn('[IntelligenceEngine] No lastAssistantMessage found for follow-up');
            return null;
        }

        this.setMode('follow_up');
        const _abortFU = activeRequestId ? this.registerRequestAbort(activeRequestId) : null;
        const _signalFU = _abortFU?.signal;

        try {
            if (!this.followUpLLM) {
                console.error('[IntelligenceEngine] FollowUpLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(60);
            const refinementRequest = userRequest || intent;

            const generationId = ++this.currentGenerationId;
            let fullRefined = "";
            const stream = this.followUpLLM.generateStream(
                lastMsg,
                refinementRequest,
                context
            );
            let streamAborted = false;

            for await (const token of stream) {
                if (_signalFU?.aborted || this.currentGenerationId !== generationId) {
                    console.log('[GENERATION_DISCARDED] _follow_up stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('refined_answer_token', token, intent, activeRequestId);
                fullRefined += token;
            }

            if (!streamAborted && !_signalFU?.aborted && fullRefined) {
                this.session.addAssistantMessage(fullRefined);
                this.safeEmit(_signalFU, activeRequestId, 'refined_answer', fullRefined, intent);

                const intentMap: Record<string, string> = {
                    'expand': 'Expand Answer',
                    'rephrase': 'Rephrase Answer',
                    'add_example': 'Add Example',
                    'more_confident': 'Make More Confident',
                    'more_casual': 'Make More Casual',
                    'more_formal': 'Make More Formal',
                    'simplify': 'Simplify Answer'
                };

                const displayQuestion = userRequest || intentMap[intent] || `Refining: ${intent}`;

                this.session.pushUsage({
                    type: 'followup',
                    timestamp: Date.now(),
                    question: displayQuestion,
                    answer: fullRefined
                });
            }

            this.setMode('idle');
            return fullRefined;

        } catch (error) {
            this.cleanupRequestAbort(activeRequestId);
            this.emit('error', error as Error, 'follow_up', activeRequestId);
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 4: Recap (Summary)
     * Neutral conversation summary
     */
    async runRecap(requestId?: string): Promise<string | null> {
        console.log('[IntelligenceEngine] runRecap called');
        const activeRequestId = requestId ?? null;
        this.currentClientRequestId = activeRequestId;
        this.setMode('recap');

        // Register per-request AbortController
        const _abortRecap = activeRequestId ? this.registerRequestAbort(activeRequestId) : null;
        const _signalRecap = _abortRecap?.signal;

        try {
            if (!this.recapLLM) {
                console.error('[IntelligenceEngine] RecapLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
            if (!context) {
                console.warn('[IntelligenceEngine] No context available for recap');
                this.setMode('idle');
                return null;
            }

            // CONTEXT STRATEGY: Recap uses bounded reverse accumulation (max 3000 tokens)
            // Never sends full transcript — only most recent content within budget
            const boundedContext = buildBoundedRecapContext(context, 3000);

            const generationId = ++this.currentGenerationId;
            let fullSummary = "";
            const stream = this.recapLLM.generateStream(boundedContext);
            let streamAborted = false;

            for await (const token of stream) {
                if (_signalRecap?.aborted || this.currentGenerationId !== generationId) {
                    console.log('[GENERATION_DISCARDED] _recap stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('recap_token', token, activeRequestId);
                fullSummary += token;
            }

            // Only emit final if not aborted
            if (!streamAborted && !_signalRecap?.aborted && fullSummary && this.currentGenerationId === generationId) {
                this.safeEmit(_signalRecap, activeRequestId, 'recap', fullSummary);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Recap Meeting',
                    answer: fullSummary
                });
            }
            if (this.currentGenerationId === generationId) {
                this.cleanupRequestAbort(activeRequestId);
                this.setMode('idle');
            }
            return fullSummary;

        } catch (error) {
            this.cleanupRequestAbort(activeRequestId);
            this.emit('error', error as Error, 'recap', activeRequestId);
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE: Clarify
     * Ask a clarifying question to the interviewer
     */
    async runClarify(requestId?: string): Promise<string | null> {
        console.log('[IntelligenceEngine] runClarify called');
        const activeRequestId = requestId ?? null;
        this.currentClientRequestId = activeRequestId;
        this.setMode('clarify');
        const _abortClarify = activeRequestId ? this.registerRequestAbort(activeRequestId) : null;
        const _signalClarify = _abortClarify?.signal;

        try {
            if (!this.clarifyLLM) {
                console.error('[IntelligenceEngine] ClarifyLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const rawContext = this.session.getFormattedContext(180);
            // If no transcript yet, use a generic prompt — the LLM will ask a scoping question
            const context = rawContext || '[No transcript available yet. The candidate just joined the interview. Generate an opening clarifying question to understand the scope and constraints of the upcoming problem.]';

            const generationId = ++this.currentGenerationId;
            let fullClarification = "";
            const stream = this.clarifyLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (_signalClarify?.aborted || this.currentGenerationId !== generationId) {
                    console.log('[GENERATION_DISCARDED] _clarify stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('clarify_token', token, activeRequestId);
                fullClarification += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            // Only update history and emit final if not aborted
            if (fullClarification && !_signalClarify?.aborted && this.currentGenerationId === generationId) {
                this.safeEmit(_signalClarify, activeRequestId, 'clarify', fullClarification);
                this.session.addAssistantMessage(fullClarification);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: 'Clarify Question',
                    answer: fullClarification
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
            return fullClarification;

        } catch (error) {
            this.cleanupRequestAbort(activeRequestId);
            this.emit('error', error as Error, 'clarify', activeRequestId);
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 6: Follow-Up Questions
     * Suggest strategic questions for the user to ask
     */
    async runFollowUpQuestions(requestId?: string): Promise<string | null> {
        console.log('[IntelligenceEngine] runFollowUpQuestions called');
        const activeRequestId = requestId ?? null;
        this.currentClientRequestId = activeRequestId;
        this.setMode('follow_up_questions');
        const _abortFUQ = activeRequestId ? this.registerRequestAbort(activeRequestId) : null;
        const _signalFUQ = _abortFUQ?.signal;

        try {
            if (!this.followUpQuestionsLLM) {
                console.error('[IntelligenceEngine] FollowUpQuestionsLLM not initialized');
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
            if (!context) {
                console.warn('[IntelligenceEngine] No context available for follow-up questions');
                this.setMode('idle');
                return null;
            }

            const generationId = ++this.currentGenerationId;
            let fullQuestions = "";
            const stream = this.followUpQuestionsLLM.generateStream(context);

            for await (const token of stream) {
                if (_signalFUQ?.aborted || this.currentGenerationId !== generationId) {
                    console.log('[GENERATION_DISCARDED] _follow_up_questions stream aborted by new generation');
                    await stream.return(undefined); // FIX §3.6: cancel underlying request immediately
                    break;
                }
                this.emit('follow_up_questions_token', token, activeRequestId);
                fullQuestions += token;
            }

            if (fullQuestions && !_signalFUQ?.aborted && this.currentGenerationId === generationId) {
                this.safeEmit(_signalFUQ, activeRequestId, 'follow_up_questions_update', fullQuestions);
                this.session.pushUsage({
                    type: 'followup_questions',
                    timestamp: Date.now(),
                    question: 'Generate Follow-up Questions',
                    answer: fullQuestions
                });
            }
            if (this.currentGenerationId === generationId) {
                this.setMode('idle');
            }
            return fullQuestions;

        } catch (error) {
            this.cleanupRequestAbort(activeRequestId);
            this.emit('error', error as Error, 'follow_up_questions', activeRequestId);
            this.setMode('idle');
            return null;
        }
    }

    async runSystemDesignTradeoffs(requestId?: string): Promise<string | null> {
        console.log('[IntelligenceEngine] runSystemDesignTradeoffs called');
        const activeRequestId = requestId ?? null;
        this.currentClientRequestId = activeRequestId;
        this.setMode('system_design_tradeoffs');
        const _abortSDT = activeRequestId ? this.registerRequestAbort(activeRequestId) : null;
        const _signalSDT = _abortSDT?.signal;

        try {
            if (!this.systemDesignTradeoffsLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(180);
            if (!context) {
                this.setMode('idle');
                return null;
            }

            const generationId = ++this.currentGenerationId;
            let fullAnswer = '';
            const stream = this.systemDesignTradeoffsLLM.generateStream(context);
            let streamAborted = false;

            for await (const token of stream) {
                if (_signalSDT?.aborted || this.currentGenerationId !== generationId) {
                    console.log('[GENERATION_DISCARDED] system_design_tradeoffs stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('system_design_tradeoffs_token', token, activeRequestId);
                fullAnswer += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            if (fullAnswer && !_signalSDT?.aborted) {
                this.session.addAssistantMessage(fullAnswer);
                this.session.pushUsage({
                    type: 'assist',
                    timestamp: Date.now(),
                    question: 'System Design Trade-offs',
                    answer: fullAnswer
                });
                this.safeEmit(_signalSDT, activeRequestId, 'system_design_tradeoffs', fullAnswer);
            }

            this.setMode('idle');
            return fullAnswer;
        } catch (error) {
            this.cleanupRequestAbort(activeRequestId);
            this.emit('error', error as Error, 'system_design_tradeoffs', activeRequestId);
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 5: Manual Answer (Fallback)
     * Explicit bypass when auto-detection fails
     */
    async runManualAnswer(question: string, requestId?: string): Promise<string | null> {
        const activeRequestId = requestId ?? null;
        this.currentClientRequestId = activeRequestId;
        this.emit('manual_answer_started', activeRequestId);
        this.setMode('manual');

        try {
            if (!this.answerLLM) {
                this.setMode('idle');
                return null;
            }

            const context = this.session.getFormattedContext(120);
            const generationId = ++this.currentGenerationId;
            const timeoutPromise = new Promise<string | null>((_, reject) => { setTimeout(() => reject(new Error("LLM timeout")), 15000); });
            const answer = await Promise.race([this.answerLLM.generate(question, context), timeoutPromise]).catch((): any => null);

            // V3 Fix: discard if a new generation (or session reset) fired while awaiting
            if (this.currentGenerationId !== generationId) {
                this.setMode('idle');
                return null;
            }

            if (answer) {
                this.session.addAssistantMessage(answer);
                this.safeEmit(undefined, activeRequestId, 'manual_answer_result', answer, question);

                this.session.pushUsage({
                    type: 'chat',
                    timestamp: Date.now(),
                    question: question,
                    answer: answer
                });
            }

            this.setMode('idle');
            return answer;

        } catch (error) {
            this.emit('error', error as Error, 'manual', activeRequestId);
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 7: Code Hint (Live Code Reviewer)
     * Analyzes a screenshot of partially written code against the detected/provided question
     * and returns a short targeted hint. Question comes from (priority order):
     *   1. problemStatement passed in from ipcHandler (screenshot extraction — highest confidence)
     *   2. session.detectedCodingQuestion (detected from interviewer transcript)
     *   3. transcriptContext (last N seconds of conversation — fallback for inference)
     */
    async runCodeHint(imagePaths?: string[], problemStatement?: string, requestId?: string): Promise<string | null> {
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        const activeRequestId = requestId ?? null;
        this.currentClientRequestId = activeRequestId;
        this.setMode('code_hint');
        const _abortCH = activeRequestId ? this.registerRequestAbort(activeRequestId) : null;
        const _signalCH = _abortCH?.signal;

        try {
            if (!this.codeHintLLM) {
                this.setMode('idle');
                return "Please configure your API Keys in Settings to use this feature.";
            }

            // Resolve question context from available sources (priority order)
            const sessionQuestion = this.session.getDetectedCodingQuestion();
            const questionContext = problemStatement ?? sessionQuestion.question ?? null;
            const questionSource = problemStatement
                ? 'screenshot'
                : sessionQuestion.source;

            // Pull transcript as fallback context when no question is pinned
            const transcriptContext = questionContext === null
                ? this.session.getFormattedContext(180)
                : null;

            console.log(`[IntelligenceEngine] Code hint — question source: ${questionContext ? (questionSource ?? 'passed') : 'none'}, transcript lines: ${transcriptContext ? transcriptContext.split('\n').length : 0}, images: ${imagePaths?.length ?? 0}`);

            const generationId = ++this.currentGenerationId;
            let fullHint = "";
            const stream = this.codeHintLLM.generateStream(
                imagePaths,
                questionContext ?? undefined,
                questionSource,
                transcriptContext ?? undefined
            );

            let streamAborted = false;
            for await (const token of stream) {
                if (_signalCH?.aborted || this.currentGenerationId !== generationId) {
                    console.log('[GENERATION_DISCARDED] code_hint stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('suggested_answer_token', token, 'Code Hint', 1.0, activeRequestId);
                fullHint += token;
            }

            // V4 Fix: match brainstorm/recap pattern — abort before writing session state
            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            if (!fullHint || fullHint.trim().length < 5) {
                fullHint = "I couldn't detect any code in the screenshot. Try screenshotting your code editor directly.";
            }

            this.session.addAssistantMessage(fullHint);
            this.session.pushUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: 'Code Hint',
                answer: fullHint
            });

            this.safeEmit(_signalCH, activeRequestId, 'suggested_answer', fullHint, 'Code Hint', 1.0);
            this.setMode('idle');
            return fullHint;

        } catch (error) {
            this.cleanupRequestAbort(activeRequestId);
            this.emit('error', error as Error, 'code_hint', activeRequestId);
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 8: Brainstorm (Strategic Approach Generator)
     * Generates a spoken script outlining 2-3 problem-solving approaches with trade-offs.
     */
    async runBrainstorm(imagePaths?: string[], problemStatement?: string, requestId?: string): Promise<string | null> {
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }

        const activeRequestId = requestId ?? null;
        this.currentClientRequestId = activeRequestId;
        this.setMode('brainstorm');
        const _abortBS = activeRequestId ? this.registerRequestAbort(activeRequestId) : null;
        const _signalBS = _abortBS?.signal;

        try {
            if (!this.brainstormLLM) {
                this.setMode('idle');
                return "Please configure your API Keys in Settings to use this feature.";
            }

            let context = this.session.getFormattedContext(180);
            // Prepend the problem statement so the LLM knows exactly what to brainstorm
            const resolvedProblem = problemStatement?.trim() ||
                this.session.getDetectedCodingQuestion().question?.trim();

            if (!context.trim() && !resolvedProblem && (!imagePaths || imagePaths.length === 0)) {
                this.setMode('idle');
                const msg = "There's nothing to brainstorm right now. Make sure your question is visible or spoken aloud, then try again.";
                this.session.addAssistantMessage(msg);
                this.safeEmit(undefined, activeRequestId, 'suggested_answer', msg, 'Brainstorming Approaches', 1.0);
                return msg;
            }

            if (resolvedProblem) {
                context = `<problem_statement>\n${resolvedProblem}\n</problem_statement>\n\n${context}`;
            }
            const generationId = ++this.currentGenerationId;
            let fullResult = "";
            const stream = this.brainstormLLM.generateStream(context, imagePaths);
            let streamAborted = false;

            for await (const token of stream) {
                if (_signalBS?.aborted || this.currentGenerationId !== generationId) {
                    console.log('[GENERATION_DISCARDED] brainstorm stream aborted by new generation');
                    await stream.return(undefined);
                    streamAborted = true;
                    break;
                }
                this.emit('suggested_answer_token', token, 'Brainstorming Approaches', 1.0, activeRequestId);
                fullResult += token;
            }

            if (streamAborted) {
                this.setMode('idle');
                return null;
            }

            if (!fullResult || fullResult.trim().length < 5) {
                fullResult = "I couldn't generate brainstorm approaches. Make sure your question is visible and try again.";
            }

            this.session.addAssistantMessage(fullResult);
            this.session.pushUsage({
                type: 'assist',
                timestamp: Date.now(),
                question: 'Brainstorm',
                answer: fullResult
            });

            this.safeEmit(_signalBS, activeRequestId, 'suggested_answer', fullResult, 'Brainstorming Approaches', 1.0);
            this.setMode('idle');
            return fullResult;

        } catch (error) {
            this.emit('error', error as Error, 'brainstorm', activeRequestId);
            this.setMode('idle');
            return null;
        }
    }

    // ============================================
    // State Management
    // ============================================

    private setMode(mode: IntelligenceMode): void {
        if (this.activeMode !== mode) {
            this.activeMode = mode;
            this.emit('mode_changed', mode);
        }
    }

    getActiveMode(): IntelligenceMode {
        return this.activeMode;
    }

    /**
     * Reset engine state (cancels any in-flight operations)
     */
    reset(): void {
        this.activeMode = 'idle';
        this.currentClientRequestId = null;
        this.currentGenerationId++; // Increment to break all active LLM streams
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }
        // Abort all per-request controllers
        for (const [requestId, controller] of this.requestAbortControllers) {
            controller.abort();
        }
        this.requestAbortControllers.clear();
    }
}
