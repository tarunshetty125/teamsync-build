// IntelligenceEngine.ts
// LLM mode routing and orchestration.
// Extracted from IntelligenceManager to decouple LLM logic from state management.

import { EventEmitter } from 'events';
import { LLMHelper } from './LLMHelper';
import { SessionTracker, TranscriptSegment, SuggestionTrigger, ContextItem } from './SessionTracker';
import {
    type ActionRagContext,
    buildContext,
    getQuestionResponseProfile,
    serializePromptObject,
    type PromptInstruction,
    type PromptObject,
    type ProfilePreference,
    type UnifiedActionIntent,
} from './ActionContextBuilder';
import { logPrompt } from './PromptDebugLogger';
import { enforceTokenBudget } from './TokenBudgetEnforcer';
import { validatePromptObject } from './PromptValidator';
import { logActionMetrics } from './ActionMetricsLogger';
import { ActionResponseCache } from './ActionResponseCache';
import { buildRepairInstruction, buildSafeActionFallback, validateActionOutput } from './ActionOutputValidator';
import {
    AnswerLLM, AssistLLM, BrainstormLLM, ClarifyLLM, CodeHintLLM, FollowUpLLM, RecapLLM,
    FollowUpQuestionsLLM, SystemDesignTradeoffsLLM, WhatToAnswerLLM,
    ScreenScanLLM,
    prepareTranscriptForWhatToAnswer, buildTemporalContext,
    AssistantResponse as LLMAssistantResponse, classifyIntent, getAnswerShapeGuidance,
    buildBoundedRecapContext,
    detectScreenContentMode, MODE_BEHAVIOR
} from './llm';
import type { ConversationIntent, ScreenContentMode } from './llm';

// Brain layer (Phase 4/5) — domain-specific intelligence
import { createBrainLayer, type BrainLayer } from './intelligence/brains/createBrainLayer';
import { builtLayersToContextBundle, intentResultToQuestionAnalysis, profileToCategory } from './intelligence/adapters';
import { createStrategy, type ResponseStrategy } from './intelligence/ResponseStrategy';
import type { BrainOutput } from './intelligence/brains/Brain';
import type { QuestionAnalysis } from './intelligence/QuestionAnalysis';
import type { QuestionCategory, BrainId } from './intelligence/types';
import { deriveQuestionUnderstandingV2 } from './intelligence/QuestionUnderstandingV2';
import { estimateResponseDepth } from './intelligence/ResponseDepthEstimator';
import {
    deriveContextPriority,
    getPromptContextOrder,
    shouldExcludePromptSection,
    type ContextPriorityLevel,
    type ContextPriorityResult,
    type ContextPrioritySource,
} from './intelligence/ContextPriorityEngine';
import { planReasoning, isPlanConfident } from './intelligence/planning';
import type { ReasoningPlan } from './intelligence/planning';
import { evaluateResponseQuality, isQualityAcceptable, getMostCriticalIssue } from './intelligence/evaluation';
import type { QualityEvaluationResult } from './intelligence/evaluation';
import { compileTinyPrompt } from './intelligence/TinyPromptCompiler';
import { adaptPromptBudget } from './intelligence/AdaptivePromptBudgeter';
import { BenchmarkManager, countHallucinationIndicators, hasConfidenceSignal } from './intelligence/BenchmarkManager';
import { ModesManager } from './services/ModesManager';
import type { ModeTemplateId } from '../src/lib/modes/types';

type UserControlledMode = Extract<ConversationIntent, 'behavioral' | 'coding' | 'follow_up' | 'general' | 'system_design'>;

// Mode types
export type IntelligenceMode = 'idle' | 'assist' | 'what_to_say' | 'follow_up' | 'recap' | 'clarify' | 'manual' | 'follow_up_questions' | 'code_hint' | 'brainstorm' | 'system_design_tradeoffs' | 'screen_scan' | 'answer_now';

export interface RunAnswerNowOptions {
    imagePaths?: string[];
    context?: string;
    mode?: UserControlledMode;
    requestId?: string;
    rag?: ActionRagContext | null;
    profilePreference?: ProfilePreference;
}

interface UnifiedActionEventPayload {
    intent: UnifiedActionIntent;
    requestId?: string | null;
    content?: string;
    token?: string;
    mode: UserControlledMode;
    profileApplied?: boolean;
}

function getEngineModeForAction(intent: UnifiedActionIntent): IntelligenceMode {
    switch (intent) {
        case 'recap':
            return 'recap';
        case 'clarify':
            return 'clarify';
        case 'brainstorm':
            return 'brainstorm';
        case 'follow_up_questions':
            return 'follow_up_questions';
        case 'answer_now':
            return 'answer_now';
        case 'manual_chat':
            return 'manual';
        case 'code_hint':
            return 'code_hint';
        case 'system_design_tradeoffs':
            return 'system_design_tradeoffs';
        case 'screen_scan':
            return 'screen_scan';
        case 'what_to_answer':
        default:
            return 'what_to_say';
    }
}

const MAX_ACTION_PROMPT_TOKENS = 8000;
const ACTION_CACHE_TTL_MS = 2 * 60 * 1000;
const ACTION_DEBOUNCE_MS = 250;
const ACTION_MAX_PRIMARY_ATTEMPTS = 2;
const ACTION_MAX_FALLBACK_ATTEMPTS = 1;
const ACTION_EMIT_CHUNK_SIZE = 3;
const ACTION_EMIT_CHUNK_DELAY_MS = 18;
const ACTION_STREAM_IDLE_TIMEOUT_MS = 30_000;

function isFailureResponseText(content: string): boolean {
    const normalized = content.trim().toLowerCase();
    return normalized.includes('all ai services are currently unavailable')
        || normalized.includes('please check your api keys')
        || normalized.includes('i could not generate a response')
        || normalized.includes('no ai providers configured');
}

function getIntentResultForMode(mode: UserControlledMode) {
    return {
        intent: mode,
        confidence: 1,
        answerShape: getAnswerShapeGuidance(mode),
    };
}

function buildUserControlledModeContext(mode: UserControlledMode): string {
    switch (mode) {
        case 'behavioral':
            return 'MODE: behavioral\nAnswer in first person with a concrete example and a crisp STAR-style structure.';
        case 'coding':
            return 'MODE: coding\nPrioritize implementation details, correctness, and concise technical reasoning.';
        case 'follow_up':
            return 'MODE: follow_up\nContinue naturally from the latest context without restarting from scratch.';
        case 'system_design':
            return 'MODE: system_design\nFocus on architecture, tradeoffs, scalability, and failure handling.';
        case 'general':
        default:
            return 'MODE: general\nAnswer directly and concisely without changing task type.';
    }
}

function responseDepthToQuestionDepth(depth: 'short' | 'medium' | 'deep'): 'shallow' | 'moderate' | 'deep' {
    switch (depth) {
        case 'short':
            return 'shallow';
        case 'deep':
            return 'deep';
        case 'medium':
        default:
            return 'moderate';
    }
}

function namespaceBrainInstructions(brainId: string, instructions: PromptInstruction[]): PromptInstruction[] {
    return instructions.map((instruction) => ({
        ...instruction,
        key: `brain:${brainId}:${instruction.key}`,
    }));
}

function formatContextPriorityLabel(source: ContextPrioritySource): string {
    switch (source) {
        case 'session_history':
            return 'SESSION HISTORY';
        case 'previous_response':
            return 'PREVIOUS RESPONSE';
        default:
            return source.replace(/_/g, ' ').toUpperCase();
    }
}

function buildContextPriorityInstruction(priorityResult: ContextPriorityResult): PromptInstruction {
    const levels: ContextPriorityLevel[] = ['critical', 'high', 'medium', 'low'];
    const lines = levels
        .map((level) => {
            const sources = (Object.entries(priorityResult.priorities) as Array<[ContextPrioritySource, ContextPriorityLevel]>)
                .filter(([, candidateLevel]) => candidateLevel === level)
                .map(([source]) => formatContextPriorityLabel(source));

            return sources.length > 0
                ? `${level.toUpperCase()}: ${sources.join(', ')}`
                : '';
        })
        .filter(Boolean);

    if (priorityResult.excludedSources.length > 0) {
        lines.push(`IGNORE: ${priorityResult.excludedSources.map((source) => formatContextPriorityLabel(source)).join(', ')}`);
    }

    return {
        key: 'context_priority_engine',
        title: 'CONTEXT PRIORITY ENGINE',
        content: lines.join('\n'),
    };
}

function categoryToConversationIntent(category: QuestionCategory): ConversationIntent {
    switch (category) {
        case 'coding':
            return 'coding';
        case 'system_design':
            return 'system_design';
        case 'behavioral':
        case 'resume_jd':
            return 'behavioral';
        case 'follow_up':
            return 'follow_up';
        case 'clarification':
            return 'clarification';
        case 'general':
        default:
            return 'general';
    }
}

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
    'suggested_answer': (answer: string, question: string, confidence: number, requestId?: string | null, intent?: string | null) => void;
    'suggested_answer_token': (token: string, question: string, confidence: number, requestId?: string | null, intent?: string | null) => void;
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
    'screen_scan_result': (answer: string, mode: string, requestId?: string | null) => void;
    'screen_scan_token': (token: string, mode: string, requestId?: string | null) => void;
    'manual_answer_started': (requestId?: string | null) => void;
    'manual_answer_result': (answer: string, question: string, requestId?: string | null) => void;
    'action_token': (payload: UnifiedActionEventPayload) => void;
    'action_result': (payload: UnifiedActionEventPayload) => void;
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
    private screenScanLLM: ScreenScanLLM | null = null;
    private activeScreenScanRequestId: string | null = null;

    // Concurrency tracking
    private assistCancellationToken: AbortController | null = null;
    private currentGenerationId: number = 0;
    private currentClientRequestId: string | null = null;

    // Per-request AbortController map — cancel(requestId) only cancels that request
    private requestAbortControllers = new Map<string, AbortController>();
    private activeActionRequestId: string | null = null;
    private readonly actionResponseCache = new ActionResponseCache(ACTION_CACHE_TTL_MS);
    private lastActionAcceptedAt: number = 0;
    private lastActionFingerprint: string | null = null;

    // Keep reference to LLMHelper for client access
    private llmHelper: LLMHelper;

    // Reference to SessionTracker for context
    private session: SessionTracker;

    // Brain layer (Phase 4/5) — domain-specific intelligence
    private brainLayer: BrainLayer;
    private useBrainLayer: boolean = true;

    // Timestamps for tracking
    private lastTranscriptTime: number = 0;
    private lastTriggerTime: number = 0;
    private readonly triggerCooldown: number = 3000; // 3 seconds

    constructor(llmHelper: LLMHelper, session: SessionTracker) {
        super();
        this.llmHelper = llmHelper;
        this.session = session;
        this.brainLayer = createBrainLayer();
        this.initializeLLMs();
    }

    /**
     * Enable or disable the Brain layer at runtime.
     * When disabled, runAction() uses the legacy prompt path only.
     */
    setBrainLayerEnabled(enabled: boolean): void {
        this.useBrainLayer = enabled;
        console.log(`[IntelligenceEngine] Brain layer ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }

    getLLMHelper(): LLMHelper {
        return this.llmHelper;
    }

    getCurrentRequestId(): string | null {
        return this.currentClientRequestId;
    }

    private buildBrainAnalysis(params: {
        intent: UnifiedActionIntent;
        mode: UserControlledMode;
        question: string;
    }): QuestionAnalysis {
        const semanticResult = deriveQuestionUnderstandingV2({
            question: params.question,
            intent: params.intent,
            mode: params.mode,
        });
        const modeIntent = getIntentResultForMode(params.mode);
        const baseAnalysis = intentResultToQuestionAnalysis(modeIntent);
        const responseProfile = getQuestionResponseProfile(params.question, params.mode, params.intent);
        const legacyCategory = profileToCategory(responseProfile);
        const category = semanticResult.category;
        const depthEstimate = estimateResponseDepth({
            question: params.question,
            category,
            sessionMode: params.mode,
            intent: params.intent,
            questionUnderstandingResult: semanticResult,
        });
        const rawIntent: ConversationIntent = semanticResult.fallbackUsed
            ? (baseAnalysis.rawIntent as ConversationIntent)
            : categoryToConversationIntent(category);
        const answerShape = getAnswerShapeGuidance(rawIntent);

        return {
            ...baseAnalysis,
            category,
            confidence: semanticResult.confidence,
            estimatedDepth: responseDepthToQuestionDepth(depthEstimate.depth),
            isFollowUp: category === 'follow_up' || baseAnalysis.isFollowUp,
            referencesContext: category === 'follow_up' || baseAnalysis.referencesContext,
            answerShape,
            rawIntent,
            classificationSource: params.mode !== 'general'
                ? 'user_override'
                : semanticResult.fallbackUsed
                    ? (legacyCategory === category ? 'context_heuristic' : baseAnalysis.classificationSource)
                    : 'regex',
        };
    }

    private buildBrainStrategy(params: {
        intent: UnifiedActionIntent;
        mode: UserControlledMode;
        question: string;
        analysis: QuestionAnalysis;
    }): ResponseStrategy {
        const questionUnderstandingResult = deriveQuestionUnderstandingV2({
            question: params.question,
            intent: params.intent,
            mode: params.mode,
        });
        const estimate = estimateResponseDepth({
            question: params.question,
            category: params.analysis.category,
            sessionMode: params.mode,
            intent: params.intent,
            questionUnderstandingResult,
        });

        const strategy = createStrategy(estimate.depth);

        switch (params.analysis.category) {
            case 'coding':
                return createStrategy(estimate.depth, {
                    tone: 'technical',
                    includeComplexity: true,
                    bulletRange: estimate.depth === 'short' ? [1, 3] : estimate.depth === 'deep' ? [4, 6] : [2, 4],
                    maxWords: estimate.depth === 'short' ? 140 : estimate.depth === 'deep' ? 420 : 240,
                });
            case 'behavioral':
                return createStrategy(estimate.depth, {
                    tone: 'conversational',
                    bulletRange: estimate.depth === 'short' ? [1, 2] : estimate.depth === 'deep' ? [3, 5] : [2, 3],
                    maxWords: estimate.depth === 'short' ? 120 : estimate.depth === 'deep' ? 320 : 220,
                });
            case 'resume_jd':
                return createStrategy(estimate.depth, {
                    tone: 'conversational',
                    bulletRange: estimate.depth === 'short' ? [1, 2] : estimate.depth === 'deep' ? [3, 5] : [2, 3],
                    maxWords: estimate.depth === 'short' ? 130 : estimate.depth === 'deep' ? 320 : 220,
                });
            case 'system_design':
                return createStrategy(estimate.depth, {
                    tone: 'technical',
                    bulletRange: estimate.depth === 'short' ? [2, 3] : estimate.depth === 'deep' ? [4, 6] : [3, 4],
                    maxWords: estimate.depth === 'short' ? 180 : estimate.depth === 'deep' ? 500 : 300,
                    includeComplexity: estimate.depth === 'deep',
                });
            case 'general':
            case 'clarification':
            case 'follow_up':
            default:
                return strategy;
        }
    }

    private getActiveModeTemplateType(): ModeTemplateId | null {
        try {
            return ModesManager.getInstance().getActiveMode()?.templateType ?? null;
        } catch {
            return null;
        }
    }

    private resolveForcedBrainId(
        activeTemplateType: ModeTemplateId | null,
        analysis: QuestionAnalysis,
        intent: UnifiedActionIntent,
    ): BrainId | undefined {
        if (!activeTemplateType || activeTemplateType === 'general' || intent === 'screen_scan') {
            return undefined;
        }

        if (activeTemplateType === 'looking-for-work' && (analysis.category === 'coding' || analysis.category === 'system_design')) {
            return undefined;
        }

        if (activeTemplateType === 'technical-interview') {
            switch (analysis.category) {
                case 'system_design':
                    return 'system_design';
                case 'behavioral':
                    return 'behavioral';
                case 'resume_jd':
                    return 'resume';
                default:
                    return 'coding';
            }
        }

        switch (activeTemplateType) {
            case 'sales':
                return 'sales';
            case 'lecture':
                return 'lecture';
            case 'recruiting':
                return 'recruiting';
            case 'team-meet':
                return 'team_meeting';
            case 'looking-for-work':
                return 'looking_for_work';
            default:
                return undefined;
        }
    }

    async runAction(params: {
        intent: UnifiedActionIntent;
        message?: string;
        imagePaths?: string[];
        requestId?: string;
        profilePreference?: ProfilePreference;
        additionalContext?: string;
        rag?: ActionRagContext | null;
        modeOverride?: UserControlledMode;
        screenScanMode?: ScreenContentMode;
    }): Promise<string | null> {
        const activeRequestId = params.requestId ?? null;
        const sessionMode = params.modeOverride ?? this.session.getMode();
        const actionStartedAt = Date.now();
        const fingerprint = `${params.intent}::${(params.message || '').trim()}`;
        const sessionIdSnapshot = this.session.sessionId;

        const debounceDelayMs = this.getDebounceDelay(actionStartedAt, fingerprint);
        if (debounceDelayMs > 0) {
            console.warn(`[IntelligenceEngine] Rapid repeat action detected for intent "${params.intent}" (${debounceDelayMs}ms window); latest request will replace the previous one deterministically.`);
        }

        this.claimActionRequestOwnership(activeRequestId);
        this.lastActionAcceptedAt = actionStartedAt;
        this.lastActionFingerprint = fingerprint;

        return this.runLLMGuarded(
            activeRequestId,
            getEngineModeForAction(params.intent),
            async (signal, generationId) => {
                const isOwnedRequest = () => this.isOwnedActionRequest(activeRequestId, generationId, signal, sessionIdSnapshot);
                let inputTokens = 0;
                let brainOutput: BrainOutput | null = null;
                let contextLayers: Awaited<ReturnType<typeof buildContext>>['layers'] | null = null;
                let analysis: QuestionAnalysis | null = null;
                let strategy: ResponseStrategy | null = null;
                let reasoningPlan: ReasoningPlan | undefined;
                let maxPromptTokens = MAX_ACTION_PROMPT_TOKENS;
                let promptBeforeTokens = 0;
                let promptAfterTokens = 0;
                let llmStartedAt: number | null = null;
                let qualityScore: number | null = null;
                const activeTemplateType = this.getActiveModeTemplateType();

                try {
                    const builtContext = await buildContext({
                        session: this.session,
                        intent: params.intent,
                        mode: sessionMode,
                        profile: this.llmHelper.getKnowledgeOrchestrator?.() ?? null,
                        message: params.message,
                        imagePaths: params.imagePaths,
                        profilePreference: params.profilePreference,
                        additionalContext: params.additionalContext,
                        rag: params.rag,
                        includeModeCustomContext: this.llmHelper.getCustomNotesEnabled?.() ?? true,
                        screenScanMode: params.screenScanMode,
                    });
                    contextLayers = builtContext.layers;

                    if (!isOwnedRequest()) {
                        return null;
                    }

                    if ((params.intent === 'answer_now' || params.intent === 'manual_chat') && params.message?.trim()) {
                        this.session.addUserMessage(params.message.trim());
                    }

                    // ──── Brain Layer Injection (Phase 5) ────
                    // Runs the Brain layer to produce domain-specific prompt instructions.
                    // These instructions are PREPENDED to the existing prompt instructions,
                    // giving the Brain's domain expertise highest attention priority.
                    // The existing ActionContextBuilder instructions remain untouched.
                    if (this.useBrainLayer) {
                        try {
                            analysis = this.buildBrainAnalysis({
                                intent: params.intent,
                                mode: sessionMode,
                                question: contextLayers.promptObject.question,
                            });
                            strategy = this.buildBrainStrategy({
                                intent: params.intent,
                                mode: sessionMode,
                                question: contextLayers.promptObject.question,
                                analysis,
                            });
                            const forcedBrainId = this.resolveForcedBrainId(activeTemplateType, analysis, params.intent);
                            const brain = this.brainLayer.selector.select(analysis, {
                                forceBrainId: forcedBrainId,
                                isScreenScan: params.intent === 'screen_scan',
                                hasImages: !!(params.imagePaths && params.imagePaths.length > 0),
                            });
                            const contextPriority = deriveContextPriority({
                                question: contextLayers.promptObject.question,
                                questionCategory: analysis.category,
                                responseDepth: strategy.depth,
                                brainId: brain.id,
                                intent: params.intent,
                                sessionMode,
                                hasScreenContext: params.intent === 'screen_scan'
                                    || Boolean(params.imagePaths?.length)
                                    || /screen mode:|screen ocr:|ocr/i.test(params.additionalContext ?? ''),
                            });

                            // ──── Planning Engine (V1) ────
                            // Generate a deterministic reasoning plan BEFORE brain execution.
                            // The plan tells the Brain which reasoning steps the answer should cover.
                            // Safe: wrapped in try/catch, confidence-gated, < 1ms overhead.
                            reasoningPlan = undefined;
                            try {
                                const questionUnderstandingResult = deriveQuestionUnderstandingV2({
                                    question: contextLayers.promptObject.question,
                                    intent: params.intent,
                                    mode: sessionMode,
                                });
                                const depthEstimate = estimateResponseDepth({
                                    question: contextLayers.promptObject.question,
                                    category: analysis.category,
                                    sessionMode,
                                    intent: params.intent,
                                    questionUnderstandingResult,
                                });
                                const plan = planReasoning({
                                    question: contextLayers.promptObject.question,
                                    category: analysis.category,
                                    brainId: brain.id,
                                    depthEstimate,
                                    questionUnderstanding: questionUnderstandingResult,
                                });
                                if (isPlanConfident(plan)) {
                                    reasoningPlan = plan;
                                    console.log(`[PlanningEngine] ${brain.id}: plan=${plan.steps.join(',')} confidence=${plan.confidence} verbosity=${plan.estimatedVerbosity}`);
                                } else {
                                    console.log(`[PlanningEngine] ${brain.id}: low confidence (${plan.confidence}), skipping plan`);
                                }
                            } catch (planError: any) {
                                // Planning failure is non-fatal — Brain uses default behavior
                                console.warn('[PlanningEngine] Planning failed (non-fatal):', planError?.message);
                                reasoningPlan = undefined;
                            }
                            // ──── End Planning Engine ────

                            brainOutput = brain.execute({
                                analysis,
                                context: builtLayersToContextBundle(contextLayers),
                                strategy,
                                sessionMode,
                                contextPriority,
                                reasoningPlan,
                                previousAnswer: this.session.getLastAssistantMessage() ?? undefined,
                                userMessage: contextLayers.promptObject.question,
                                imagePaths: params.imagePaths,
                            });

                            contextLayers.promptObject.contextOrder = getPromptContextOrder(contextPriority);
                            if (shouldExcludePromptSection(contextPriority, 'rag')) {
                                contextLayers.promptObject.rag = null;
                            }

                            contextLayers.promptObject.instructions = [
                                buildContextPriorityInstruction(contextPriority),
                                ...contextLayers.promptObject.instructions,
                            ];

                            // Prepend brain instructions to the prompt object
                            if (brainOutput.instructions.length > 0) {
                                const namespacedInstructions = namespaceBrainInstructions(brain.id, brainOutput.instructions);
                                contextLayers.promptObject.instructions = [
                                    ...namespacedInstructions,
                                    ...contextLayers.promptObject.instructions,
                                ];
                                console.log(`[IntelligenceEngine] Brain '${brain.id}' injected ${namespacedInstructions.length} instructions (stream: ${brainOutput.streamStrategy})`);
                            }
                        } catch (brainError: any) {
                            // Brain layer failure is non-fatal — legacy path continues
                            console.warn('[IntelligenceEngine] Brain layer failed (non-fatal):', brainError?.message);
                        }
                    }
                    // ──── End Brain Layer Injection ────

                    const preTinyPrompt = contextLayers.promptObject;
                    const preTinySerialized = serializePromptObject(preTinyPrompt);
                    promptBeforeTokens = this.session.estimateTokenCount(preTinySerialized.finalPrompt);
                    const tinyPrompt = await compileTinyPrompt({
                        prompt: preTinyPrompt,
                        activeTemplateType,
                        currentModel: this.llmHelper.getCurrentModel(),
                        provider: this.llmHelper.getCurrentProvider(),
                    });
                    const adaptiveBudget = adaptPromptBudget({
                        originalPrompt: preTinyPrompt,
                        compiledPrompt: tinyPrompt.prompt,
                        tinyPromptApplied: tinyPrompt.applied,
                        tinyPromptMode: tinyPrompt.mode,
                        currentModel: this.llmHelper.getCurrentModel(),
                        provider: this.llmHelper.getCurrentProvider(),
                    });
                    contextLayers.promptObject = adaptiveBudget.prompt;
                    maxPromptTokens = adaptiveBudget.maxTokens;

                    const budgeted = enforceTokenBudget({
                        prompt: contextLayers.promptObject,
                        maxTokens: maxPromptTokens,
                    });
                    validatePromptObject(budgeted.prompt, { maxTokens: maxPromptTokens });
                    const serializedPrompt = serializePromptObject(budgeted.prompt);
                    inputTokens = this.session.estimateTokenCount(serializedPrompt.finalPrompt);
                    promptAfterTokens = inputTokens;

                    logPrompt({
                        intent: params.intent,
                        mode: sessionMode,
                        transcriptStrategy: contextLayers.transcriptStrategy,
                        transcriptLength: budgeted.prompt.transcript.content.length,
                        transcriptApproxTokens: budgeted.transcriptTokens,
                        profileUsed: contextLayers.profileApplied,
                        profilePolicy: contextLayers.profilePolicy,
                        finalPrompt: serializedPrompt.finalPrompt,
                    });

                    if (!isOwnedRequest()) {
                        return null;
                    }

                    const cacheLookup = this.actionResponseCache.get(budgeted.prompt, sessionIdSnapshot);
                    if (cacheLookup.hit && cacheLookup.content) {
                        const cachedContent = cacheLookup.content.trim();
                        if (!isOwnedRequest()) {
                            return null;
                        }
                        this.persistActionResult(params.intent, budgeted.prompt.question, cachedContent);
                        await this.emitBufferedActionContent(
                            signal,
                            activeRequestId,
                            generationId,
                            params.intent,
                            sessionMode,
                            contextLayers.profileApplied,
                            cachedContent,
                            sessionIdSnapshot
                        );
                        logActionMetrics({
                            intent: params.intent,
                            mode: sessionMode,
                            latencyMs: Date.now() - actionStartedAt,
                            inputTokens,
                            outputTokens: this.session.estimateTokenCount(cachedContent),
                            cacheHit: true,
                            retryCount: 0,
                            fallbackUsed: false,
                            profileUsed: contextLayers.profileApplied,
                            profilePolicy: contextLayers.profilePolicy,
                            transcriptStrategy: contextLayers.transcriptStrategy,
                            requestId: activeRequestId,
                        });
                        this.safeEmitAction(signal, activeRequestId, generationId, 'action_result', {
                            intent: params.intent,
                            requestId: activeRequestId,
                            content: cachedContent,
                            mode: sessionMode,
                            profileApplied: contextLayers.profileApplied,
                        }, sessionIdSnapshot);
                        return cachedContent;
                    }

                    const primaryDirect = contextLayers.directResponse?.trim();
                    llmStartedAt = primaryDirect ? null : Date.now();
                    const executionResult = primaryDirect
                        ? {
                            content: primaryDirect,
                            retryCount: 0,
                            fallbackUsed: false,
                        }
                        : await this.executeActionWithRetry({
                            prompt: budgeted.prompt,
                            imagePaths: params.imagePaths,
                            skipCustomNotesInjection: contextLayers.profileApplied,
                            signal,
                            generationId,
                            requestId: activeRequestId,
                            sessionIdSnapshot,
                        });

                    if (!executionResult || !isOwnedRequest()) {
                        return null;
                    }

                    const finalContent = await this.ensureValidActionOutput({
                        prompt: budgeted.prompt,
                        content: executionResult.content,
                        maxTokens: maxPromptTokens,
                        imagePaths: params.imagePaths,
                        skipCustomNotesInjection: contextLayers.profileApplied,
                        signal,
                        generationId,
                        requestId: activeRequestId,
                        sessionIdSnapshot,
                    });

                    if (!finalContent || !isOwnedRequest()) {
                        return null;
                    }

                    this.persistActionResult(params.intent, budgeted.prompt.question, finalContent);
                    if (!isFailureResponseText(finalContent)) {
                        this.actionResponseCache.set(budgeted.prompt, sessionIdSnapshot, finalContent);
                    }

                    // ──── Response Quality Evaluation (V1) ────
                    // Post-generation quality check. Observation-only — does NOT modify
                    // or block the response. Logs quality score for monitoring.
                    try {
                        const qualityResult = evaluateResponseQuality({
                            question: budgeted.prompt.question,
                            brainId: (brainOutput?.instructions?.[0]?.key?.split(':')?.[1] ?? 'general') as BrainId,
                            category: analysis?.category ?? 'general',
                            responseDepth: strategy?.depth ?? 'medium',
                            generatedResponse: finalContent,
                            reasoningPlan: reasoningPlan,
                        });
                        qualityScore = qualityResult.score;
                        if (!isQualityAcceptable(qualityResult)) {
                            const worst = getMostCriticalIssue(qualityResult);
                            console.warn(`[QualityEvaluator] Below threshold: score=${qualityResult.score} issue=${worst?.ruleId ?? 'unknown'} (${worst?.description ?? ''})`);
                        } else {
                            console.log(`[QualityEvaluator] OK: score=${qualityResult.score} rules=${qualityResult.rulesChecked}/${qualityResult.rulesPassed}`);
                        }
                    } catch (qualityError: any) {
                        // Quality evaluation failure is non-fatal
                        console.warn('[QualityEvaluator] Evaluation failed (non-fatal):', qualityError?.message);
                    }
                    // ──── End Response Quality Evaluation ────

                    await this.emitBufferedActionContent(
                        signal,
                        activeRequestId,
                        generationId,
                        params.intent,
                        sessionMode,
                        contextLayers.profileApplied,
                        finalContent,
                        sessionIdSnapshot
                    );
                    logActionMetrics({
                        intent: params.intent,
                        mode: sessionMode,
                        latencyMs: Date.now() - actionStartedAt,
                        inputTokens,
                        outputTokens: this.session.estimateTokenCount(finalContent),
                        cacheHit: false,
                        retryCount: executionResult.retryCount,
                        fallbackUsed: executionResult.fallbackUsed,
                        profileUsed: contextLayers.profileApplied,
                        profilePolicy: contextLayers.profilePolicy,
                        transcriptStrategy: contextLayers.transcriptStrategy,
                        requestId: activeRequestId,
                    });
                    const finalValidation = validateActionOutput(budgeted.prompt.intent, budgeted.prompt.mode, finalContent);
                    this.recordBenchmark({
                        activeTemplateType,
                        sessionMode,
                        intent: params.intent,
                        promptBeforeTokens,
                        promptAfterTokens,
                        inputTokens,
                        content: finalContent,
                        cacheHit: false,
                        fallbackUsed: executionResult.fallbackUsed,
                        retryCount: executionResult.retryCount,
                        actionStartedAt,
                        llmStartedAt,
                        structuredOutputCompliant: finalValidation.valid,
                        qualityScore,
                        hasImages: Boolean(params.imagePaths?.length),
                    });
                    this.safeEmitAction(signal, activeRequestId, generationId, 'action_result', {
                        intent: params.intent,
                        requestId: activeRequestId,
                        content: finalContent,
                        mode: sessionMode,
                        profileApplied: contextLayers.profileApplied,
                    }, sessionIdSnapshot);
                    return finalContent;
                } catch (error: any) {
                    console.error('[IntelligenceEngine] Action pipeline failed hard:', error?.message || error);
                    if (!isOwnedRequest()) {
                        return null;
                    }
                    const safeFallback = buildSafeActionFallback(
                        params.intent,
                        sessionMode,
                        params.message || this.session.getLastInterviewerTurn() || 'the latest question'
                    );
                    this.persistActionResult(params.intent, params.message || 'safe fallback', safeFallback);
                    await this.emitBufferedActionContent(
                        signal,
                        activeRequestId,
                        generationId,
                        params.intent,
                        sessionMode,
                        false,
                        safeFallback,
                        sessionIdSnapshot
                    );
                    logActionMetrics({
                        intent: params.intent,
                        mode: sessionMode,
                        latencyMs: Date.now() - actionStartedAt,
                        inputTokens,
                        outputTokens: this.session.estimateTokenCount(safeFallback),
                        cacheHit: false,
                        retryCount: 0,
                        fallbackUsed: true,
                        profileUsed: false,
                        profilePolicy: contextLayers?.profilePolicy ?? 'never',
                        transcriptStrategy: contextLayers?.transcriptStrategy ?? 'rolling_window',
                        requestId: activeRequestId,
                    });
                    this.recordBenchmark({
                        activeTemplateType,
                        sessionMode,
                        intent: params.intent,
                        promptBeforeTokens,
                        promptAfterTokens,
                        inputTokens,
                        content: safeFallback,
                        cacheHit: false,
                        fallbackUsed: true,
                        retryCount: 0,
                        actionStartedAt,
                        llmStartedAt,
                        structuredOutputCompliant: false,
                        qualityScore,
                        hasImages: Boolean(params.imagePaths?.length),
                    });
                    this.safeEmitAction(signal, activeRequestId, generationId, 'action_result', {
                        intent: params.intent,
                        requestId: activeRequestId,
                        content: safeFallback,
                        mode: sessionMode,
                        profileApplied: false,
                    }, sessionIdSnapshot);
                    return safeFallback;
                }
            }
        );
    }

    private getDebounceDelay(now: number, fingerprint: string): number {
        if (this.lastActionFingerprint !== fingerprint) return 0;
        const elapsed = now - this.lastActionAcceptedAt;
        return elapsed < ACTION_DEBOUNCE_MS ? ACTION_DEBOUNCE_MS - elapsed : 0;
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
        if (this.activeActionRequestId === requestId) {
            this.activeActionRequestId = null;
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

    private claimActionRequestOwnership(requestId: string | null): void {
        if (!requestId) {
            this.activeActionRequestId = null;
            return;
        }

        if (this.activeActionRequestId && this.activeActionRequestId !== requestId) {
            this.cancelRequest(this.activeActionRequestId);
        }

        this.activeActionRequestId = requestId;
    }

    private isOwnedActionRequest(
        requestId: string | null,
        generationId: number,
        signal?: AbortSignal,
        expectedSessionId?: string
    ): boolean {
        if (signal?.aborted) return false;
        if (expectedSessionId && this.session.sessionId !== expectedSessionId) return false;
        if (this.currentGenerationId !== generationId) return false;
        if (!requestId) return this.activeActionRequestId === null;
        if (this.activeActionRequestId !== requestId) return false;
        return this.requestAbortControllers.has(requestId);
    }

    private async emitBufferedActionContent(
        signal: AbortSignal | undefined,
        requestId: string | null,
        generationId: number,
        intent: UnifiedActionIntent,
        mode: UserControlledMode,
        profileApplied: boolean,
        content: string,
        expectedSessionId: string
    ): Promise<void> {
        for (let index = 0; index < content.length; index += ACTION_EMIT_CHUNK_SIZE) {
            const token = content.slice(index, index + ACTION_EMIT_CHUNK_SIZE);
            if (!this.safeEmitAction(signal, requestId, generationId, 'action_token', {
                intent,
                requestId,
                token,
                mode,
                profileApplied,
            }, expectedSessionId)) {
                return;
            }

            if (index + ACTION_EMIT_CHUNK_SIZE < content.length) {
                const shouldContinue = await this.waitWithBackoff(ACTION_EMIT_CHUNK_DELAY_MS, signal);
                if (!shouldContinue) {
                    return;
                }
            }
        }
    }

    private async waitWithBackoff(delayMs: number, signal?: AbortSignal): Promise<boolean> {
        if (delayMs <= 0) return true;
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve(true);
            }, delayMs);
            const onAbort = () => {
                clearTimeout(timeout);
                resolve(false);
            };
            if (signal) {
                signal.addEventListener('abort', onAbort, { once: true });
            }
        });
    }

    private resolveFallbackModel(primaryModel: string): string | null {
        const candidates: string[] = [];
        const lower = primaryModel.toLowerCase();

        if (!lower.includes('claude') && this.llmHelper.hasClaude()) candidates.push('claude');
        if (!lower.includes('gpt') && !lower.includes('openai') && this.llmHelper.hasOpenai()) candidates.push('gpt-4o-mini');
        if (!lower.includes('gemini')) candidates.push('gemini');
        if (!lower.includes('llama') && !lower.includes('groq') && this.llmHelper.hasGroq()) candidates.push('llama');
        candidates.push('teamsync');

        return candidates.find((candidate) => candidate !== primaryModel) ?? null;
    }

    private async collectStreamResponseForPrompt(args: {
        prompt: PromptObject;
        imagePaths?: string[];
        modelOverride?: string | null;
        skipCustomNotesInjection?: boolean;
        signal?: AbortSignal;
        generationId: number;
        requestId: string | null;
        sessionIdSnapshot: string;
    }): Promise<string | null> {
        const { prompt, imagePaths, modelOverride, skipCustomNotesInjection, signal, generationId, requestId, sessionIdSnapshot } = args;
        const originalModel = this.llmHelper.getCurrentModel();
        const serialized = serializePromptObject(prompt);

        try {
            if (!this.isOwnedActionRequest(requestId, generationId, signal, sessionIdSnapshot)) {
                return null;
            }
            if (modelOverride && modelOverride !== originalModel) {
                this.llmHelper.setModel(modelOverride);
            }

            let fullResponse = '';
            const stream = this.llmHelper.streamStructuredPrompt(
                {
                    question: prompt.question,
                    context: serialized.context,
                    systemPrompt: serialized.systemPrompt,
                },
                imagePaths,
                {
                    ignoreKnowledgeMode: true,
                    skipKnowledgeInjection: true,
                    skipModeInjection: true,
                    skipCustomNotesInjection,
                }
            );

            const iterator = stream[Symbol.asyncIterator]();
            while (true) {
                let timeoutId: NodeJS.Timeout | null = null;
                const nextChunk = await Promise.race([
                    iterator.next(),
                    new Promise<IteratorResult<string, void>>((_, reject) => {
                        timeoutId = setTimeout(() => reject(new Error('LLM stream timeout')), ACTION_STREAM_IDLE_TIMEOUT_MS);
                    }),
                ]);
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }

                if (!this.isOwnedActionRequest(requestId, generationId, signal, sessionIdSnapshot)) {
                    await iterator.return?.(undefined);
                    return null;
                }

                if (nextChunk.done) {
                    break;
                }

                fullResponse += nextChunk.value || '';
            }

            return fullResponse.trim();
        } finally {
            if (modelOverride && modelOverride !== originalModel) {
                this.llmHelper.setModel(originalModel);
            }
        }
    }

    private async executeActionWithRetry(args: {
        prompt: PromptObject;
        imagePaths?: string[];
        skipCustomNotesInjection?: boolean;
        signal?: AbortSignal;
        generationId: number;
        requestId: string | null;
        sessionIdSnapshot: string;
    }): Promise<{ content: string; retryCount: number; fallbackUsed: boolean } | null> {
        const { prompt, imagePaths, skipCustomNotesInjection, signal, generationId, requestId, sessionIdSnapshot } = args;
        const primaryModel = this.llmHelper.getCurrentModel();
        const fallbackModel = this.resolveFallbackModel(primaryModel);
        const attempts: Array<{ model: string; fallbackUsed: boolean }> = [];

        for (let i = 0; i < ACTION_MAX_PRIMARY_ATTEMPTS; i++) {
            attempts.push({ model: primaryModel, fallbackUsed: false });
        }
        if (fallbackModel) {
            for (let i = 0; i < ACTION_MAX_FALLBACK_ATTEMPTS; i++) {
                attempts.push({ model: fallbackModel, fallbackUsed: true });
            }
        }

        const failureReasons: string[] = [];
        for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
            const attempt = attempts[attemptIndex];
            if (!this.isOwnedActionRequest(requestId, generationId, signal, sessionIdSnapshot)) {
                return null;
            }

            if (attemptIndex > 0) {
                const ready = await this.waitWithBackoff(250 * Math.pow(2, attemptIndex - 1), signal);
                if (!ready) return null;
            }

            try {
                const content = await this.collectStreamResponseForPrompt({
                    prompt,
                    imagePaths,
                    modelOverride: attempt.model,
                    skipCustomNotesInjection,
                    signal,
                    generationId,
                    requestId,
                    sessionIdSnapshot,
                });
                if (content && content.trim() && !isFailureResponseText(content)) {
                    return {
                        content: content.trim(),
                        retryCount: attemptIndex,
                        fallbackUsed: attempt.fallbackUsed,
                    };
                }
                failureReasons.push(`attempt_${attemptIndex + 1}:invalid_or_empty_response(${attempt.model})`);
            } catch (error: any) {
                const reason = error?.message || String(error);
                failureReasons.push(`attempt_${attemptIndex + 1}:${attempt.model}:${reason}`);
                console.warn('[IntelligenceEngine] Action attempt failed:', reason);
            }
        }

        console.warn('[IntelligenceEngine] Action retries exhausted:', failureReasons.join(' | '));
        return {
            content: buildSafeActionFallback(prompt.intent, prompt.mode, prompt.question),
            retryCount: Math.max(0, attempts.length - 1),
            fallbackUsed: attempts.some((attempt) => attempt.fallbackUsed),
        };
    }

    private async ensureValidActionOutput(args: {
        prompt: PromptObject;
        content: string;
        maxTokens: number;
        imagePaths?: string[];
        skipCustomNotesInjection?: boolean;
        signal?: AbortSignal;
        generationId: number;
        requestId: string | null;
        sessionIdSnapshot: string;
    }): Promise<string | null> {
        const { prompt, content, maxTokens, imagePaths, skipCustomNotesInjection, signal, generationId, requestId, sessionIdSnapshot } = args;
        const validation = validateActionOutput(prompt.intent, prompt.mode, content);
        if (validation.valid) {
            return validation.correctedContent.trim();
        }

        if (validation.correctedContent.trim()) {
            const correctedValidation = validateActionOutput(prompt.intent, prompt.mode, validation.correctedContent);
            if (correctedValidation.valid) {
                return correctedValidation.correctedContent.trim();
            }
        }

        const repairPrompt: PromptObject = {
            ...prompt,
            instructions: [
                ...prompt.instructions,
                {
                    key: 'output_repair',
                    title: 'OUTPUT REPAIR',
                    content: `${buildRepairInstruction(prompt.intent, validation.issues)}\n\nINVALID DRAFT:\n${content}`,
                },
            ],
        };
        const repairBudgeted = enforceTokenBudget({
            prompt: repairPrompt,
            maxTokens,
        });
        validatePromptObject(repairBudgeted.prompt, { maxTokens });

        const repaired = await this.collectStreamResponseForPrompt({
            prompt: repairBudgeted.prompt,
            imagePaths,
            skipCustomNotesInjection,
            signal,
            generationId,
            requestId,
            sessionIdSnapshot,
        });
        if (!repaired?.trim()) {
            return buildSafeActionFallback(prompt.intent, prompt.mode, prompt.question);
        }

        const repairedValidation = validateActionOutput(prompt.intent, prompt.mode, repaired);
        if (repairedValidation.valid) {
            return repairedValidation.correctedContent.trim();
        }
        if (repairedValidation.correctedContent.trim()) {
            const correctedRepairValidation = validateActionOutput(prompt.intent, prompt.mode, repairedValidation.correctedContent);
            if (correctedRepairValidation.valid) {
                return correctedRepairValidation.correctedContent.trim();
            }
        }
        return buildSafeActionFallback(prompt.intent, prompt.mode, prompt.question);
    }

    private persistActionResult(intent: UnifiedActionIntent, question: string, answer: string): void {
        const shouldTrackAsLastAssistant = intent !== 'recap' && intent !== 'follow_up_questions';
        this.session.addAssistantMessage(answer, {
            trackAsLastMessage: shouldTrackAsLastAssistant,
        });

        this.session.pushUsage({
            type: intent,
            timestamp: Date.now(),
            question,
            answer,
        });
    }

    private recordBenchmark(args: {
        activeTemplateType: ModeTemplateId | null;
        sessionMode: UserControlledMode;
        intent: UnifiedActionIntent;
        promptBeforeTokens: number;
        promptAfterTokens: number;
        inputTokens: number;
        content: string;
        cacheHit: boolean;
        fallbackUsed: boolean;
        retryCount: number;
        actionStartedAt: number;
        llmStartedAt: number | null;
        structuredOutputCompliant: boolean;
        qualityScore: number | null;
        hasImages: boolean;
    }): void {
        if (!args.llmStartedAt) return;

        const promptBeforeTokens = Math.max(args.promptBeforeTokens, args.promptAfterTokens, args.inputTokens);
        const promptAfterTokens = Math.max(0, args.inputTokens || args.promptAfterTokens);
        const compressionRatio = promptBeforeTokens > 0
            ? Math.max(0, (1 - (promptAfterTokens / promptBeforeTokens)) * 100)
            : 0;

        BenchmarkManager.getInstance().record({
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            model: this.llmHelper.getCurrentModel(),
            provider: this.llmHelper.getCurrentProvider(),
            mode: args.activeTemplateType ?? args.sessionMode,
            intent: args.intent,
            latencyMs: Math.max(0, Date.now() - args.llmStartedAt),
            totalLatencyMs: Math.max(0, Date.now() - args.actionStartedAt),
            promptBeforeTokens,
            promptAfterTokens,
            compressionRatio,
            inputTokens: promptAfterTokens,
            outputTokens: this.session.estimateTokenCount(args.content),
            responseLength: args.content.length,
            cacheHit: args.cacheHit,
            fallbackUsed: args.fallbackUsed,
            retryCount: args.retryCount,
            confidenceSignalPresent: hasConfidenceSignal(args.content),
            structuredOutputCompliant: args.structuredOutputCompliant,
            hallucinationIndicatorCount: countHallucinationIndicators(args.content, { hasImages: args.hasImages }),
            qualityScore: args.qualityScore,
        });
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

    private safeEmitAction(
        signal: AbortSignal | undefined,
        requestId: string | null,
        generationId: number,
        event: 'action_token' | 'action_result',
        payload: UnifiedActionEventPayload,
        expectedSessionId: string
    ): boolean {
        if (!this.isOwnedActionRequest(requestId, generationId, signal, expectedSessionId)) return false;
        return this.emit(event, payload);
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
        this.screenScanLLM = new ScreenScanLLM(this.llmHelper);

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
            if (this.activeActionRequestId === requestId) {
                this.activeActionRequestId = null;
            }
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
    async runWhatShouldISay(question?: string, confidence: number = 0.8, imagePaths?: string[], selectedMode: UserControlledMode = 'general', requestId?: string): Promise<string | null> {
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
                        speakerId: lastInterim.speakerId,
                        speakerLabel: lastInterim.speakerLabel,
                        text: lastInterim.text,
                        timestamp: lastInterim.timestamp
                    });
                }
            }

            const transcriptTurns = contextItems.map(item => ({
                role: item.role,
                speakerId: item.speakerId,
                speakerLabel: item.speakerLabel,
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
            if (classifiedIntent.intent !== selectedMode) {
                console.debug('[IntelligenceEngine] Ignoring classified intent mismatch', {
                    classifiedIntent: classifiedIntent.intent,
                    sessionMode: selectedMode,
                });
            }
            const intentResult = getIntentResultForMode(selectedMode);

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
                this.emit('suggested_answer_token', token, question || 'inferred', confidence, activeRequestId, 'what_to_answer');
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
            this.safeEmit(_signalWTS, activeRequestId, 'suggested_answer', fullAnswer, question || 'What to Answer', confidence, 'what_to_answer');

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
        return this.runAction({
            intent: 'recap',
            requestId,
            profilePreference: 'force_off',
        });
    }

    /**
     * MODE: Clarify
     * Ask a clarifying question to the interviewer
     */
    async runClarify(requestId?: string): Promise<string | null> {
        return this.runAction({
            intent: 'clarify',
            requestId,
            profilePreference: 'force_off',
        });
    }

    /**
     * MODE 6: Follow-Up Questions
     * Suggest strategic questions for the user to ask
     */
    async runFollowUpQuestions(requestId?: string): Promise<string | null> {
        return this.runAction({
            intent: 'follow_up_questions',
            requestId,
            profilePreference: 'force_off',
        });
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

    async runAnswerNow(question: string, options?: RunAnswerNowOptions): Promise<string | null> {
        return this.runAction({
            intent: 'answer_now',
            message: question.trim() || 'Analyze this screenshot',
            imagePaths: options?.imagePaths,
            requestId: options?.requestId,
            additionalContext: [
                options?.mode ? buildUserControlledModeContext(options.mode) : '',
                options?.context?.trim() || '',
            ].filter(Boolean).join('\n\n'),
            rag: options?.rag,
            modeOverride: options?.mode,
            profilePreference: options?.profilePreference ?? 'default',
        });
    }

    /**
     * MODE 5: Manual Answer (Fallback)
     * Explicit bypass when auto-detection fails
     */
    async runManualAnswer(question: string, requestId?: string): Promise<string | null> {
        const activeRequestId = requestId ?? null;
        this.emit('manual_answer_started', activeRequestId);
        const answer = await this.runAction({
            intent: 'manual_chat',
            message: question,
            requestId,
        });
        if (answer) {
            this.safeEmit(undefined, activeRequestId, 'manual_answer_result', answer, question);
        }
        return answer;
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
                this.emit('suggested_answer_token', token, 'Code Hint', 1.0, activeRequestId, 'code_hint');
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

            this.safeEmit(_signalCH, activeRequestId, 'suggested_answer', fullHint, 'Code Hint', 1.0, 'code_hint');
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
                this.safeEmit(undefined, activeRequestId, 'suggested_answer', msg, 'Brainstorming Approaches', 1.0, 'brainstorm');
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
                this.emit('suggested_answer_token', token, 'Brainstorming Approaches', 1.0, activeRequestId, 'brainstorm');
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

            this.safeEmit(_signalBS, activeRequestId, 'suggested_answer', fullResult, 'Brainstorming Approaches', 1.0, 'brainstorm');
            this.setMode('idle');
            return fullResult;

        } catch (error) {
            this.emit('error', error as Error, 'brainstorm', activeRequestId);
            this.setMode('idle');
            return null;
        }
    }

    /**
     * MODE 9: Screen Scan (Context-Aware Screen Intelligence)
     * Captures screen → detects content type → routes to mode-specific prompt → streams response.
     * Does NOT use transcript or session history — ONLY screen content + detected mode.
     */
    async runScreenScan(imagePaths: string[], extractedText?: string, forcedMode?: ScreenContentMode, requestId?: string): Promise<string | null> {
        if (this.assistCancellationToken) {
            this.assistCancellationToken.abort();
            this.assistCancellationToken = null;
        }
        const activeRequestId = requestId ?? null;
        if (this.activeScreenScanRequestId && this.activeScreenScanRequestId !== activeRequestId) {
            this.cancelRequest(this.activeScreenScanRequestId);
        }
        this.activeScreenScanRequestId = activeRequestId;

        return this.runLLMGuarded(activeRequestId, 'screen_scan', async (signal, generationId) => {
            const previousKnowledgeOrchestrator = this.llmHelper.getKnowledgeOrchestrator();
            const MAX_SCREEN_CHARS = 6000;
            if (!this.screenScanLLM) {
                const fallback = "Please configure your API Keys in Settings to use Screen Scan.";
                this.safeEmit(signal, activeRequestId, 'screen_scan_result', fallback, 'ui_general');
                return fallback;
            }

            if (!imagePaths || imagePaths.length === 0) {
                const fallback = "No screenshot available. Capture your screen first.";
                this.safeEmit(signal, activeRequestId, 'screen_scan_result', fallback, 'ui_general');
                return fallback;
            }

            this.llmHelper.setKnowledgeOrchestrator(null);

            try {
                const rawText = extractedText?.trim()
                    ? extractedText.trim()
                    : await this.llmHelper.extractScreenTextHybrid(imagePaths);
                if (rawText === '__NO_CHANGE__') {
                    const noChange = "No visible screen changes detected.";
                    this.safeEmit(signal, activeRequestId, 'screen_scan_result', noChange, 'ui_general');
                    return noChange;
                }
                const screenText = rawText
                    .replace(/\s+/g, ' ')
                    .replace(/[^\x20-\x7E\n]/g, '')
                    .trim()
                    .slice(0, MAX_SCREEN_CHARS);

                console.log(`[OCR_SCAN] Retrieved Text:\n${screenText}\n[OCR_SCAN_END]`);

                if (screenText.length < 50) {
                    const fallback = "I couldn't detect enough readable text on screen. Try capturing a clearer area.";
                    this.safeEmit(signal, activeRequestId, 'screen_scan_result', fallback, 'ui_general');
                    return fallback;
                }

                // Always detect mode from actual screen content — never let frontend override
                // The frontend sends session-based mode (e.g. 'ui_general' when in general mode)
                // which prevents coding problem detection. The OCR text is the ground truth.
                const heuristicMode: ScreenContentMode = screenText
                    ? detectScreenContentMode(screenText)
                    : 'ui_general';
                const detectedMode: ScreenContentMode = heuristicMode !== 'ui_general'
                    ? heuristicMode          // heuristic found something specific — trust it
                    : (forcedMode || 'ui_general');  // heuristic inconclusive — fall back to frontend hint

                const behavior = MODE_BEHAVIOR[detectedMode];
                console.log(
                    `[IntelligenceEngine] Screen Scan — mode: ${detectedMode} (${behavior.label}), images: ${imagePaths.length}, textLength: ${screenText.length}`
                );
                const actionTokenListener = (payload: any) => {
                    if (payload?.intent !== 'screen_scan' || payload?.requestId !== activeRequestId) return;
                    this.safeEmit(signal, activeRequestId, 'screen_scan_token', payload.token || '', detectedMode);
                };
                const actionResultListener = (payload: any) => {
                    if (payload?.intent !== 'screen_scan' || payload?.requestId !== activeRequestId) return;
                    this.safeEmit(signal, activeRequestId, 'screen_scan_result', payload.content || '', detectedMode);
                };

                this.on('action_token', actionTokenListener);
                this.on('action_result', actionResultListener);

                try {
                    const fullResult = await this.runAction({
                        intent: 'screen_scan',
                        message: screenText,
                        imagePaths,
                        requestId: activeRequestId ?? undefined,
                        modeOverride: (detectedMode === 'coding' || detectedMode === 'interview_question') ? 'coding' : this.session.getMode(),
                        profilePreference: 'force_off',
                        additionalContext: [
                            `SCREEN MODE: ${detectedMode}`,
                            `OBJECTIVE: ${behavior.objective}`,
                            `FORMAT: ${behavior.format}`,
                        ].join('\n'),
                        screenScanMode: detectedMode,
                    });

                    if (!fullResult || fullResult.trim().length < 5) {
                        const fallback = "I couldn't detect meaningful content on screen. Try capturing a different area.";
                        this.safeEmit(signal, activeRequestId, 'screen_scan_result', fallback, detectedMode);
                        return fallback;
                    }

                    this.session.pushUsage({
                        type: 'screen_scan',
                        timestamp: Date.now(),
                        question: `Screen Scan (${detectedMode})`,
                        answer: fullResult
                    });

                    return fullResult;
                } finally {
                    this.off('action_token', actionTokenListener);
                    this.off('action_result', actionResultListener);
                }
            } finally {
                this.llmHelper.setKnowledgeOrchestrator(previousKnowledgeOrchestrator);
                if (this.activeScreenScanRequestId === activeRequestId) {
                    this.activeScreenScanRequestId = null;
                }
            }
        });
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
        this.activeActionRequestId = null;
        this.currentClientRequestId = null;
        this.lastActionAcceptedAt = 0;
        this.lastActionFingerprint = null;
        this.actionResponseCache.clear();
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
