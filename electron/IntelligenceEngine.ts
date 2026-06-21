// IntelligenceEngine.ts
// LLM mode routing and orchestration.
// Extracted from IntelligenceManager to decouple LLM logic from state management.

import { EventEmitter } from 'events';
import { isBedrockReauthenticationError, LLMHelper } from './LLMHelper';
import { SessionTracker, TranscriptSegment, SuggestionTrigger, ContextItem, type SessionMode } from './SessionTracker';
import {
    type ActionRagContext,
    buildContext,
    buildQuestionResponseProfileOptions,
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
import { buildRepairInstruction, buildSafeActionFallback, validateActionOutput, type ActionOutputValidationResult } from './ActionOutputValidator';
import {
    AnswerLLM, AssistLLM, BrainstormLLM, ClarifyLLM, CodeHintLLM, FollowUpLLM, RecapLLM,
    FollowUpQuestionsLLM, SystemDesignTradeoffsLLM, WhatToAnswerLLM,
    ScreenScanLLM,
    AssistantResponse as LLMAssistantResponse, getAnswerShapeGuidance,
    buildBoundedRecapContext,
    detectScreenContentMode, detectCodingPlatform, MODE_BEHAVIOR
} from './llm';
import type { ConversationIntent, ScreenContentMode } from './llm';
import { detectVisibleScreenLanguage } from './llm/prompts';

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
import { buildProviderPrompt } from './llm/ProviderPromptBuilder';
import { BenchmarkManager, countHallucinationIndicators, hasConfidenceSignal } from './intelligence/BenchmarkManager';
import { ModesManager } from './services/ModesManager';
import { SettingsManager } from './services/SettingsManager';
import { CredentialsManager } from './services/CredentialsManager';
import { resolveModelForPreferredProvider } from './personalization/ProviderPreferenceResolver';
import type { ModeTemplateId } from '../src/lib/modes/types';
import {
    actionContractAllowsCode,
    resolveEffectiveActionContract,
    type ActionContract,
    type ContextTarget,
} from '../src/lib/overlay/actionContextTypes';
import {
    DEFAULT_PERSONALIZATION_PREFERENCES,
    normalizePersonalizationPreferences,
    type PersonalizationPreferences,
    type PreferredProvider,
    type ResolvedPersonalizationSnapshot,
} from '../src/lib/personalization/preferences';
import {
    buildProviderFallbackCandidatePlan,
    formatProviderFallbackCandidateSkipReason,
    type ProviderFallbackCandidate,
    type ProviderFallbackCandidateHealthInput,
} from '../src/lib/providers/providerFallbackCandidatePolicy';
import { ModePredictor } from './intelligence/adaptive/ModePredictor';
import {
    emitActionComplete,
    emitFallback,
    emitModelSelection,
    emitValidationResult,
    type ActionTelemetry,
    type FallbackChainEntry,
    type RoutingDecision,
    type ValidationOutcome,
} from './ActionTelemetry';

type UserControlledMode = 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design';
const BEDROCK_AUTH_EXPIRED_ROUTING_REASON = 'bedrock_auth_expired_fallback';

function getPromptResponseProfileOptions(prompt: PromptObject) {
    return buildQuestionResponseProfileOptions({
        actionId: prompt.actionId,
        additionalContext: prompt.supplemental?.content,
    });
}

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
    debugMetadata?: ActionDebugMetadata;
}

interface ActionDebugMetadata {
    telemetry: ActionTelemetry;
    routing: RoutingDecision;
    fallbackChain: FallbackChainEntry[];
    validation: ValidationOutcome;
    personalization?: ResolvedPersonalizationSnapshot;
}

interface FinalizedActionOutput {
    content: string;
    validation: ValidationOutcome;
    rawLength: number;
    parsedLength: number;
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
    if (mode === 'salary') {
        return {
            intent: 'general' as const,
            confidence: 1,
            answerShape: 'Answer like a compensation negotiation copilot: stay direct, confident, and specific about tradeoffs, range framing, and next-step wording.',
        };
    }

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
        case 'salary':
            return 'MODE: salary\nFocus on compensation framing, negotiation leverage, anchoring, and confident but professional phrasing.';
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

const CONTROLLED_PROMPT_SECTION_TITLES = new Set([
    'OUTPUT CONTRACT',
    'CONTEXT PRIORITY',
    'FORMAT CONTRACT',
    'CODING CONTRACT',
]);

function consolidateControlledPromptSections(instructions: PromptInstruction[]): PromptInstruction[] {
    const claimed = new Set<string>();
    const output: PromptInstruction[] = [];
    let removed = 0;

    for (const instruction of instructions) {
        const title = instruction.title.trim().toUpperCase();
        if (CONTROLLED_PROMPT_SECTION_TITLES.has(title)) {
            if (claimed.has(title)) {
                removed += 1;
                continue;
            }
            claimed.add(title);
        }
        output.push(instruction);
    }

    if (removed > 0) {
        console.log(`[PROMPT_OWNERSHIP] removedDuplicateControlledSections=${removed}`);
    }
    return output;
}

function validationToOutcome(result: ActionOutputValidationResult, repairApplied: boolean = false): ValidationOutcome {
    const warningIssues = result.issues.filter((issue) => /warning|ignored/i.test(issue));
    const blockingIssues = result.valid
        ? result.issues.filter((issue) => !warningIssues.includes(issue))
        : result.issues;
    return {
        valid: result.valid,
        warnings: [
            ...(result.warnings ?? []),
            ...warningIssues,
            ...(result.autoCorrected && result.valid ? ['auto_corrected'] : []),
        ],
        issues: blockingIssues,
        repairApplied: repairApplied || result.repairApplied === true || (!result.valid && result.autoCorrected === true),
    };
}

function validationStatus(outcome: ValidationOutcome): string {
    if (outcome.valid && outcome.repairApplied) return 'valid_repaired';
    if (outcome.valid && outcome.warnings.length > 0) return 'valid_with_warnings';
    return outcome.valid ? 'valid' : 'invalid';
}

function extractPreferredCodingLanguageForRepair(prompt: PromptObject): string | null {
    const outputContract = prompt.instructions.find((instruction) => (
        instruction.key === 'output_contract'
        || instruction.title.trim().toUpperCase() === 'OUTPUT CONTRACT'
    ))?.content ?? '';
    const preferredMatch = outputContract.match(/Required solution language for this prompt:\s*([^,\n]+),\s*from the user preferred coding language setting/i);
    return preferredMatch?.[1]?.trim() || null;
}

function createTelemetryRequestId(requestId: string | null, actionType: string): string {
    return requestId ?? `${actionType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCodeFenceLanguage(language: string | null | undefined): string | null {
    if (!language) return null;
    const normalized = language.trim().toLowerCase().replace(/\s+/g, '');
    if (!normalized) return null;
    if (['unknown', 'infer', 'inferred', 'visibleeditorlanguage:unknown'].includes(normalized)) return null;
    if (normalized.startsWith('inferfromvisible')) return null;
    if (['py', 'python3'].includes(normalized)) return 'python';
    if (['js', 'node', 'node.js', 'nodejs'].includes(normalized)) return 'javascript';
    if (['ts'].includes(normalized)) return 'typescript';
    if (['c++', 'cpp', 'g++'].includes(normalized)) return 'cpp';
    if (['c#', 'csharp'].includes(normalized)) return 'csharp';
    if (['golang'].includes(normalized)) return 'go';
    return normalized;
}

function extractRequiredScreenScanFence(prompt: PromptObject): string | null {
    if (prompt.intent !== 'screen_scan') return null;
    const sources = [
        prompt.question,
        prompt.supplemental?.content ?? '',
        ...prompt.instructions.map((instruction) => instruction.content),
    ].join('\n');

    const fenceMatch = sources.match(/(?:REQUIRED CODE FENCE|Required solution code fence):\s*```([a-zA-Z0-9_+#.-]+)/i);
    if (fenceMatch?.[1]) {
        return normalizeCodeFenceLanguage(fenceMatch[1]);
    }

    const visibleLanguageMatch = sources.match(/(?:VISIBLE EDITOR LANGUAGE|Visible editor language|REQUIRED SOLUTION LANGUAGE):\s*([^\n]+)/i);
    if (!visibleLanguageMatch?.[1]) return null;

    const language = visibleLanguageMatch[1].trim();
    if (/^(unknown|infer\b|inferred\b)/i.test(language)) return null;
    const labelToFence: Record<string, string> = {
        python: 'python',
        python3: 'python',
        javascript: 'javascript',
        js: 'javascript',
        typescript: 'typescript',
        ts: 'typescript',
        java: 'java',
        'c++': 'cpp',
        cpp: 'cpp',
        'c#': 'csharp',
        csharp: 'csharp',
        c: 'c',
        go: 'go',
        golang: 'go',
        rust: 'rust',
        kotlin: 'kotlin',
        swift: 'swift',
        ruby: 'ruby',
        scala: 'scala',
        php: 'php',
        dart: 'dart',
        elixir: 'elixir',
        erlang: 'erlang',
        racket: 'racket',
    };
    return labelToFence[language.toLowerCase()] ?? normalizeCodeFenceLanguage(language);
}

function getFencedCodeLanguages(content: string): string[] {
    return [...content.matchAll(/```([a-zA-Z0-9_+#.-]*)/g)]
        .map((match) => normalizeCodeFenceLanguage(match[1]))
        .filter((language): language is string => Boolean(language))
        .filter((language) => !['mermaid', 'architecture_json', 'json', 'text', 'txt'].includes(language));
}

function buildScreenScanLanguageMismatchIssue(prompt: PromptObject, content: string): string | null {
    const expectedFence = extractRequiredScreenScanFence(prompt);
    if (!expectedFence) return null;
    const actualFences = getFencedCodeLanguages(content);
    if (actualFences.includes(expectedFence)) return null;
    const actual = actualFences[0] ?? 'missing_code_fence';
    return `screen_scan_language_mismatch_expected_${expectedFence}_actual_${actual}`;
}

async function detectEditorLanguageFromScreenCrop(imagePaths?: string[]): Promise<{ label: string; fence: string } | null> {
    if (!imagePaths?.length) return null;
    const sharp = require('sharp');
    const Tesseract = require('tesseract.js');

    for (const imagePath of imagePaths) {
        try {
            const metadata = await sharp(imagePath).metadata();
            const width = Number(metadata?.width || 0);
            const height = Number(metadata?.height || 0);
            if (!width || !height) continue;

            const crops = [
                {
                    label: 'leetcode_code_header',
                    left: Math.round(width * 0.235),
                    top: Math.round(height * 0.195),
                    width: Math.round(width * 0.22),
                    height: Math.round(height * 0.06),
                },
                {
                    label: 'leetcode_code_top',
                    left: Math.round(width * 0.235),
                    top: Math.round(height * 0.195),
                    width: Math.round(width * 0.42),
                    height: Math.round(height * 0.20),
                },
            ];

            for (const crop of crops) {
                const safeCrop = {
                    left: Math.max(0, Math.min(crop.left, width - 1)),
                    top: Math.max(0, Math.min(crop.top, height - 1)),
                    width: Math.max(1, Math.min(crop.width, width - crop.left)),
                    height: Math.max(1, Math.min(crop.height, height - crop.top)),
                };
                const buffer = await sharp(imagePath)
                    .extract(safeCrop)
                    .resize({ width: safeCrop.width * 3 })
                    .grayscale()
                    .normalize()
                    .png()
                    .toBuffer();
                const result = await Tesseract.recognize(buffer, 'eng', {
                    logger: (): any => undefined,
                });
                const text = result?.data?.text ?? '';
                const detected = detectVisibleScreenLanguage(text);
                if (detected) return detected;
            }
        } catch (error: any) {
            // Best-effort OCR crop fallback; whole-screen OCR remains the primary path.
        }
    }

    return null;
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
        title: 'CONTEXT ROUTING SIGNALS',
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
    private activeActionRequestIds = new Set<string>();
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

    // Phase 1: Shadow mode predictor (silent telemetry, no side effects)
    private modePredictor: ModePredictor;

    // Timestamps for tracking
    private lastTranscriptTime: number = 0;
    private lastTriggerTime: number = 0;
    private readonly triggerCooldown: number = 3000; // 3 seconds

    constructor(llmHelper: LLMHelper, session: SessionTracker) {
        super();
        this.llmHelper = llmHelper;
        this.session = session;
        this.brainLayer = createBrainLayer();
        // Phase 1: Shadow mode predictor (silent telemetry only)
        this.modePredictor = new ModePredictor();
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

    private getPersonalizationPreferences(): PersonalizationPreferences {
        try {
            return SettingsManager.getInstance().getPersonalizationPreferences();
        } catch (error: any) {
            if (process.env.NODE_ENV === 'development') {
                console.warn('[IntelligenceEngine] Falling back to default personalization preferences:', error?.message || error);
            }
            return DEFAULT_PERSONALIZATION_PREFERENCES;
        }
    }

    private getPreferredModelForProvider(provider: PreferredProvider): string | null {
        if (!['gemini', 'groq', 'openai', 'claude', 'bedrock'].includes(provider)) {
            return null;
        }

        try {
            const credentials = CredentialsManager.getInstance();
            return credentials.getPreferredModel(provider as 'gemini' | 'groq' | 'openai' | 'claude' | 'bedrock') || null;
        } catch {
            return null;
        }
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
        transcriptOverride?: string;
        actionContract?: ActionContract;
        actionId?: string;
        contextTarget?: ContextTarget;
        rag?: ActionRagContext | null;
        modeOverride?: UserControlledMode;
        screenScanMode?: ScreenContentMode;
        modelOverride?: string;
        reuseRequestLifecycle?: boolean;
	    }): Promise<string | null> {
        // ── Universal OCR fallback for text-only models ──
        // When the selected model has no vision capability and images are attached,
        // redirect to runScreenScan which has the perfect prompt pipeline:
        // content detection, signal extraction, coding/interview context prefixes,
        // editor language detection — all already battle-tested.
        // The UI still shows thumbnails — the redirect is transparent.
        if (params.imagePaths?.length && !this.llmHelper.currentModelSupportsVision()) {
            console.log(`[IntelligenceEngine] OCR fallback: model is text-only, redirecting ${params.imagePaths.length} image(s) to runScreenScan pipeline`);
            return this.runScreenScan(
                params.imagePaths,
                undefined,       // let runScreenScan do its own OCR
                undefined,       // auto-detect content mode
                params.requestId,
            );
        }

        const activeRequestId = params.requestId ?? null;
        const telemetryRequestId = createTelemetryRequestId(activeRequestId, params.intent);
        const sessionMode = params.modeOverride ?? this.session.getMode();
        const actionStartedAt = Date.now();
        const personalizationPreferences = normalizePersonalizationPreferences(this.getPersonalizationPreferences());
        const requestedModel = this.llmHelper.normalizeModelId(params.modelOverride ?? this.llmHelper.getCurrentModel());
        const providerPreferenceResolution = resolveModelForPreferredProvider({
            currentModel: requestedModel,
            currentProvider: this.llmHelper.getProviderForModel(requestedModel),
            preferredProvider: personalizationPreferences.preferredProvider,
            explicitModelOverride: Boolean(params.modelOverride),
            getPreferredModel: (provider) => this.getPreferredModelForProvider(provider),
        });
        const selectedModel = this.llmHelper.normalizeModelId(providerPreferenceResolution.model);
        const selectedProvider = this.llmHelper.getProviderForModel(selectedModel);
        const fingerprint = `${params.intent}::${(params.message || '').trim()}`;
        const sessionIdSnapshot = this.session.sessionId;
        let personalizationSnapshot: ResolvedPersonalizationSnapshot = {
            personalizationVersion: personalizationPreferences.personalizationVersion,
            providerPreference: personalizationPreferences.preferredProvider,
            responseStyle: personalizationPreferences.responseStyle,
            interviewFocus: personalizationPreferences.interviewFocus,
            interviewFocusApplied: personalizationPreferences.interviewFocus,
            focusBiasApplied: personalizationPreferences.interviewFocus !== 'mixed',
        };

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
                        transcriptOverride: params.transcriptOverride,
                        actionContract: params.actionContract,
                        actionId: params.actionId,
                        contextTarget: params.contextTarget,
                        rag: params.rag,
                        includeModeCustomContext: this.llmHelper.getCustomNotesEnabled?.() ?? true,
                        screenScanMode: params.screenScanMode,
                        personalization: personalizationPreferences,
                    });
                    personalizationSnapshot = builtContext.layers.personalization ?? personalizationSnapshot;
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

                            if (params.intent !== 'screen_scan') {
                                contextLayers.promptObject.instructions = [
                                    buildContextPriorityInstruction(contextPriority),
                                    ...contextLayers.promptObject.instructions,
                                ];
                            }

                            // Prepend brain instructions to the prompt object
                            const ownedBrainInstructions = brainOutput.instructions.filter((instruction) => {
                                const title = instruction.title.trim().toUpperCase();
                                return !CONTROLLED_PROMPT_SECTION_TITLES.has(title);
                            });
                            if (ownedBrainInstructions.length > 0) {
                                const namespacedInstructions = namespaceBrainInstructions(brain.id, ownedBrainInstructions);
                                contextLayers.promptObject.instructions = [
                                    ...namespacedInstructions,
                                    ...contextLayers.promptObject.instructions,
                                ];
                                console.log(`[IntelligenceEngine] Brain '${brain.id}' injected ${namespacedInstructions.length} instructions (stream: ${brainOutput.streamStrategy})`);
                            }
                            contextLayers.promptObject.instructions = consolidateControlledPromptSections(contextLayers.promptObject.instructions);
                        } catch (brainError: any) {
                            // Brain layer failure is non-fatal — legacy path continues
                            console.warn('[IntelligenceEngine] Brain layer failed (non-fatal):', brainError?.message);
                        }
                    }
                    // ──── End Brain Layer Injection ────

                    // ──── Shadow Mode Prediction (Phase 1 — telemetry only) ────
                    // Scheduled off the hot path via queueMicrotask. Never blocks runAction.
                    // No mode switching, no UI. Silent failure.
                    {
                        const shadowText = contextLayers?.promptObject?.question;
                        if (shadowText) {
                            const shadowMode = this.getActiveModeTemplateType();
                            const predictor = this.modePredictor;
                            queueMicrotask(() => {
                                try {
                                    predictor.predictShadow({
                                        text: shadowText,
                                        currentMode: shadowMode,
                                    });
                                } catch {
                                    // Shadow prediction failure is completely silent
                                }
                            });
                        }
                    }
                    // ──── End Shadow Mode Prediction ────

                    contextLayers.promptObject.instructions = consolidateControlledPromptSections(contextLayers.promptObject.instructions);

                    const preTinyPrompt = contextLayers.promptObject;
                    const preTinySerialized = serializePromptObject(preTinyPrompt);
                    promptBeforeTokens = this.session.estimateTokenCount(preTinySerialized.finalPrompt);
	                    const tinyPrompt = await compileTinyPrompt({
	                        prompt: preTinyPrompt,
	                        activeTemplateType,
	                        currentModel: selectedModel,
	                        provider: selectedProvider as any,
	                    });
                    const adaptiveBudget = adaptPromptBudget({
                        originalPrompt: preTinyPrompt,
                        compiledPrompt: tinyPrompt.prompt,
                        tinyPromptApplied: tinyPrompt.applied,
                        tinyPromptMode: tinyPrompt.mode,
	                        currentModel: selectedModel,
	                        provider: selectedProvider as any,
                    });
                    contextLayers.promptObject = adaptiveBudget.prompt;
                    const providerPreviewProfileOptions = getPromptResponseProfileOptions(contextLayers.promptObject);
	                    const providerPreview = buildProviderPrompt({
	                        prompt: contextLayers.promptObject,
	                        model: selectedModel,
	                        provider: selectedProvider,
                        isSystemDesign: getQuestionResponseProfile(contextLayers.promptObject.question, contextLayers.promptObject.mode, contextLayers.promptObject.intent, providerPreviewProfileOptions) === 'system_design',
                    });
                    maxPromptTokens = Math.min(adaptiveBudget.maxTokens, providerPreview.maxInputTokens);

                    const budgeted = enforceTokenBudget({
                        prompt: contextLayers.promptObject,
                        maxTokens: maxPromptTokens,
                    });
                    validatePromptObject(budgeted.prompt, { maxTokens: maxPromptTokens });
                    const providerPromptProfileOptions = getPromptResponseProfileOptions(budgeted.prompt);
	                    const providerPrompt = buildProviderPrompt({
	                        prompt: budgeted.prompt,
	                        model: selectedModel,
	                        provider: selectedProvider,
                        isSystemDesign: getQuestionResponseProfile(budgeted.prompt.question, budgeted.prompt.mode, budgeted.prompt.intent, providerPromptProfileOptions) === 'system_design',
                    });
                    inputTokens = this.session.estimateTokenCount(providerPrompt.finalPrompt);
                    promptAfterTokens = inputTokens;

	                    logPrompt({
	                        requestId: telemetryRequestId,
	                        intent: params.intent,
                        mode: sessionMode,
                        transcriptStrategy: contextLayers.transcriptStrategy,
                        transcriptLength: budgeted.prompt.transcript.content.length,
                        transcriptApproxTokens: budgeted.transcriptTokens,
                        profileUsed: contextLayers.profileApplied,
                        profilePolicy: contextLayers.profilePolicy,
                        finalPrompt: providerPrompt.finalPrompt,
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
	                        const routing: RoutingDecision = {
	                            requestedModel: selectedModel,
	                            requestedProvider: selectedProvider,
	                            actualModel: 'cache_hit',
	                            actualProvider: 'cache',
	                            reason: 'cache_hit',
	                        };
	                        const validation: ValidationOutcome = {
	                            valid: true,
	                            warnings: [],
	                            issues: [],
	                            repairApplied: false,
	                        };
	                        emitModelSelection({
	                            requestId: telemetryRequestId,
	                            actionType: params.intent,
	                            routing,
	                        });
	                        emitValidationResult({
	                            requestId: telemetryRequestId,
	                            actionType: params.intent,
	                            outcome: validation,
	                            rawLength: cachedContent.length,
	                            parsedLength: cachedContent.length,
	                        });
	                        const telemetry: ActionTelemetry = {
	                            requestId: telemetryRequestId,
	                            actionType: params.intent,
	                            selectedModel,
	                            selectedProvider,
	                            actualInvokedModel: routing.actualModel,
	                            actualInvokedProvider: routing.actualProvider,
	                            fallbackUsed: false,
	                            validationResult: 'cache_hit',
	                            rawLength: cachedContent.length,
	                            parsedLength: cachedContent.length,
	                            promptTokens: inputTokens,
	                            completionTokens: this.session.estimateTokenCount(cachedContent),
	                            startedAt: actionStartedAt,
	                            completedAt: Date.now(),
	                        };
	                        emitActionComplete(telemetry);
	                        this.safeEmitAction(signal, activeRequestId, generationId, 'action_result', {
	                            intent: params.intent,
	                            requestId: activeRequestId,
	                            content: cachedContent,
	                            mode: sessionMode,
	                            profileApplied: contextLayers.profileApplied,
	                            debugMetadata: {
	                                telemetry,
	                                routing,
	                                fallbackChain: [],
	                                validation,
	                                personalization: personalizationSnapshot,
	                            },
	                        }, sessionIdSnapshot);
                        return cachedContent;
                    }

	                    const primaryDirect = contextLayers.directResponse?.trim();
	                    llmStartedAt = primaryDirect ? null : Date.now();
	                    const directRouting: RoutingDecision = {
	                        requestedModel: selectedModel,
	                        requestedProvider: selectedProvider,
	                        actualModel: 'direct_response',
	                        actualProvider: 'direct_response',
	                        reason: 'direct_response',
	                    };
	                    const executionResult = primaryDirect
	                        ? {
	                            content: primaryDirect,
	                            retryCount: 0,
	                            fallbackUsed: false,
	                            requestedModel: selectedModel,
	                            actualInvokedModel: 'direct_response',
	                            actualInvokedProvider: 'direct_response',
	                            fallbackReason: null,
	                            previewStreamed: false,
	                            routing: directRouting,
	                            fallbackChain: [] as FallbackChainEntry[],
	                        }
	                        : await this.executeActionWithRetry({
	                            prompt: budgeted.prompt,
	                            imagePaths: params.imagePaths,
                            skipCustomNotesInjection: contextLayers.profileApplied,
                            signal,
	                            generationId,
	                            requestId: activeRequestId,
	                            telemetryRequestId,
	                            sessionIdSnapshot,
	                            actionType: params.intent,
	                            selectedModel,
	                            selectedProvider,
	                            previewStream: getQuestionResponseProfile(budgeted.prompt.question, budgeted.prompt.mode, budgeted.prompt.intent, getPromptResponseProfileOptions(budgeted.prompt)) === 'system_design'
                                ? {
                                    intent: params.intent,
                                    mode: sessionMode,
                                    profileApplied: contextLayers.profileApplied,
                                }
                                : undefined,
	                        });
	
	                    if (!executionResult || !isOwnedRequest()) {
	                        return null;
	                    }
	                    if (primaryDirect) {
	                        emitModelSelection({
	                            requestId: telemetryRequestId,
	                            actionType: params.intent,
	                            routing: executionResult.routing,
	                        });
	                    }

	                    const finalizedOutput = await this.ensureValidActionOutput({
	                        prompt: budgeted.prompt,
	                        content: executionResult.content,
                        maxTokens: maxPromptTokens,
                        imagePaths: params.imagePaths,
                        skipCustomNotesInjection: contextLayers.profileApplied,
                        signal,
                        generationId,
	                        requestId: activeRequestId,
	                        telemetryRequestId,
	                        actionType: params.intent,
	                        sessionIdSnapshot,
	                        requestedModel: executionResult.requestedModel,
	                        actualInvokedModel: executionResult.actualInvokedModel,
	                        actualInvokedProvider: executionResult.actualInvokedProvider,
	                        fallbackUsed: executionResult.fallbackUsed,
	                        fallbackReason: executionResult.fallbackReason,
	                    });
	
	                    if (!finalizedOutput?.content || !isOwnedRequest()) {
	                        return null;
	                    }
	                    const finalContent = finalizedOutput.content;

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

	                    if (!executionResult.previewStreamed) {
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
	                    }
	                    emitValidationResult({
	                        requestId: telemetryRequestId,
	                        actionType: params.intent,
	                        outcome: finalizedOutput.validation,
	                        rawLength: finalizedOutput.rawLength,
	                        parsedLength: finalizedOutput.parsedLength,
	                    });
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
	                    const finalValidation = validateActionOutput(
	                        budgeted.prompt.intent,
	                        budgeted.prompt.mode,
	                        finalContent,
	                        budgeted.prompt.question,
	                        budgeted.prompt.actionContract,
                            getPromptResponseProfileOptions(budgeted.prompt)
	                    );
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
	                    const telemetry: ActionTelemetry = {
	                        requestId: telemetryRequestId,
	                        actionType: params.intent,
	                        selectedModel,
	                        selectedProvider,
	                        actualInvokedModel: executionResult.actualInvokedModel,
	                        actualInvokedProvider: executionResult.actualInvokedProvider,
	                        fallbackUsed: executionResult.fallbackUsed,
	                        fallbackReason: executionResult.fallbackReason ?? undefined,
	                        validationResult: validationStatus(finalizedOutput.validation),
	                        rawLength: finalizedOutput.rawLength,
	                        parsedLength: finalizedOutput.parsedLength,
	                        promptTokens: inputTokens,
	                        completionTokens: this.session.estimateTokenCount(finalContent),
	                        startedAt: actionStartedAt,
	                        completedAt: Date.now(),
	                    };
	                    emitActionComplete(telemetry);
	                    this.safeEmitAction(signal, activeRequestId, generationId, 'action_result', {
	                        intent: params.intent,
	                        requestId: activeRequestId,
	                        content: finalContent,
	                        mode: sessionMode,
	                        profileApplied: contextLayers.profileApplied,
	                        debugMetadata: {
	                            telemetry,
	                            routing: executionResult.routing,
	                            fallbackChain: executionResult.fallbackChain,
	                            validation: finalizedOutput.validation,
	                            personalization: personalizationSnapshot,
	                        },
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
	                        params.message || this.session.getLastInterviewerTurn() || 'the latest question',
	                        resolveEffectiveActionContract({
	                            intent: params.intent,
	                            actionId: params.actionId,
	                            actionContract: params.actionContract,
	                        })
	                    );
	                    const fallbackReason = error?.message || String(error);
	                    const fallbackValidation: ValidationOutcome = {
	                        valid: false,
	                        warnings: [],
	                        issues: ['hard_pipeline_failure'],
	                        repairApplied: false,
	                    };
	                    emitFallback({
	                        requestId: telemetryRequestId,
	                        actionType: params.intent,
	                        primaryModel: selectedModel,
	                        failureReason: fallbackReason,
	                    });
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
	                    const routing: RoutingDecision = {
	                        requestedModel: selectedModel,
	                        requestedProvider: selectedProvider,
	                        actualModel: 'safe_action_fallback',
	                        actualProvider: 'local',
	                        reason: 'hard_pipeline_failure',
	                    };
	                    const telemetry: ActionTelemetry = {
	                        requestId: telemetryRequestId,
	                        actionType: params.intent,
	                        selectedModel,
	                        selectedProvider,
	                        actualInvokedModel: 'safe_action_fallback',
	                        actualInvokedProvider: 'local',
	                        fallbackUsed: true,
	                        fallbackReason,
	                        validationResult: 'fallback',
	                        rawLength: 0,
	                        parsedLength: safeFallback.length,
	                        promptTokens: inputTokens,
	                        completionTokens: this.session.estimateTokenCount(safeFallback),
	                        startedAt: actionStartedAt,
	                        completedAt: Date.now(),
	                    };
	                    emitValidationResult({
	                        requestId: telemetryRequestId,
	                        actionType: params.intent,
	                        outcome: fallbackValidation,
	                        rawLength: 0,
	                        parsedLength: safeFallback.length,
	                    });
	                    emitActionComplete(telemetry);
	                    this.safeEmitAction(signal, activeRequestId, generationId, 'action_result', {
	                        intent: params.intent,
	                        requestId: activeRequestId,
	                        content: safeFallback,
	                        mode: sessionMode,
	                        profileApplied: false,
	                        debugMetadata: {
	                            telemetry,
	                            routing,
	                            fallbackChain: [{
	                                model: selectedModel,
	                                provider: selectedProvider,
	                                result: 'failure',
	                                reason: fallbackReason,
	                            }],
	                            validation: fallbackValidation,
	                            personalization: personalizationSnapshot,
	                        },
	                    }, sessionIdSnapshot);
                    return safeFallback;
                }
            },
            { reuseExistingController: params.reuseRequestLifecycle === true }
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
            this.requestAbortRefCounts.delete(requestId);
            this.activeActionRequestIds.delete(requestId);
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
    private requestAbortRefCounts = new Map<string, number>();

    private registerRequestAbort(requestId: string, options?: { reuseExistingController?: boolean }): AbortController {
        const existing = this.requestAbortControllers.get(requestId);
        if (options?.reuseExistingController && existing && !existing.signal.aborted) {
            const nextCount = (this.requestAbortRefCounts.get(requestId) ?? 1) + 1;
            this.requestAbortRefCounts.set(requestId, nextCount);
            console.log(`[REQUEST_LIFECYCLE] requestId=${requestId} action=reuse refCount=${nextCount}`);
            return existing;
        }

        if (existing) {
            existing.abort();
            this.requestAbortRefCounts.delete(requestId);
            console.log(`[REQUEST_LIFECYCLE] requestId=${requestId} action=replace`);
        }
        const controller = new AbortController();
        this.requestAbortControllers.set(requestId, controller);
        this.requestAbortRefCounts.set(requestId, 1);
        console.log(`[REQUEST_LIFECYCLE] requestId=${requestId} action=create refCount=1`);
        return controller;
    }

    /**
     * Clean up AbortController after request completes.
     */
    private cleanupRequestAbort(requestId: string | null): void {
        if (requestId) {
            const currentCount = this.requestAbortRefCounts.get(requestId) ?? 1;
            if (currentCount > 1) {
                const nextCount = currentCount - 1;
                this.requestAbortRefCounts.set(requestId, nextCount);
                console.log(`[REQUEST_LIFECYCLE] requestId=${requestId} action=release refCount=${nextCount}`);
                return;
            }
            this.requestAbortControllers.delete(requestId);
            this.requestAbortRefCounts.delete(requestId);
            this.activeActionRequestIds.delete(requestId);
            console.log(`[REQUEST_LIFECYCLE] requestId=${requestId} action=cleanup refCount=0`);
        }
    }

    private claimActionRequestOwnership(requestId: string | null): void {
        if (!requestId) {
            this.activeActionRequestId = null;
            return;
        }
        this.activeActionRequestId = requestId;
        this.activeActionRequestIds.add(requestId);
    }

    private isOwnedActionRequest(
        requestId: string | null,
        generationId: number,
        signal?: AbortSignal,
        expectedSessionId?: string
    ): boolean {
        if (signal?.aborted) return false;
        if (expectedSessionId && this.session.sessionId !== expectedSessionId) return false;
        if (!requestId) {
            if (this.currentGenerationId !== generationId) return false;
            return this.activeActionRequestId === null;
        }
        return this.activeActionRequestIds.has(requestId) && this.requestAbortControllers.has(requestId);
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
        const containsArchitectureJson = /```[ \t]*architecture_json\b/i.test(content);
        const chunkSize = containsArchitectureJson ? 96 : ACTION_EMIT_CHUNK_SIZE;
        const chunkDelayMs = containsArchitectureJson ? 6 : ACTION_EMIT_CHUNK_DELAY_MS;

        for (let index = 0; index < content.length; index += chunkSize) {
            const token = content.slice(index, index + chunkSize);
            if (!this.safeEmitAction(signal, requestId, generationId, 'action_token', {
                intent,
                requestId,
                token,
                mode,
                profileApplied,
            }, expectedSessionId)) {
                return;
            }

            if (index + chunkSize < content.length) {
                const shouldContinue = await this.waitWithBackoff(chunkDelayMs, signal);
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

    private buildFallbackCandidateHealthSignals(): Record<string, ProviderFallbackCandidateHealthInput> {
        const configured = (provider: string): ProviderFallbackCandidateHealthInput => ({
            configured: true,
            reachable: true,
            authenticated: true,
            degraded: false,
            lastDiagnostic: {
                category: 'configured',
                message: `${provider} is configured for fallback.`,
                source: 'fallback-candidate-policy',
            },
        });
        const notConfigured = (provider: string): ProviderFallbackCandidateHealthInput => ({
            configured: false,
            reachable: false,
            authenticated: false,
            degraded: false,
            lastDiagnostic: {
                category: 'not_configured',
                message: `${provider} is not configured for fallback.`,
                source: 'fallback-candidate-policy',
            },
        });
        const health: Record<string, ProviderFallbackCandidateHealthInput> = {
            claude: this.llmHelper.hasClaude() ? configured('claude') : notConfigured('claude'),
            openai: this.llmHelper.hasOpenai() ? configured('openai') : notConfigured('openai'),
            gemini: this.llmHelper.hasGemini() ? configured('gemini') : notConfigured('gemini'),
        };

        try {
            const groqHealth = this.llmHelper.getGroqKeyManager().getHealthReport();
            if (groqHealth.totalKeys <= 0) {
                health.groq = {
                    ...notConfigured('groq'),
                    lastDiagnostic: {
                        category: 'not_configured',
                        message: 'Groq has no configured fallback keys.',
                        source: 'groq-key-manager',
                    },
                };
            } else if (groqHealth.availableKeys <= 0) {
                const allInvalid = groqHealth.invalidKeys >= groqHealth.totalKeys;
                health.groq = {
                    configured: true,
                    reachable: false,
                    authenticated: !allInvalid,
                    degraded: true,
                    lastDiagnostic: {
                        category: allInvalid
                            ? 'invalid_keys'
                            : groqHealth.coolingDownKeys > 0
                                ? 'cooldown'
                                : 'no_available_keys',
                        message: 'Groq has no fallback keys available.',
                        source: 'groq-key-manager',
                    },
                };
            } else {
                health.groq = {
                    configured: true,
                    reachable: true,
                    authenticated: true,
                    degraded: groqHealth.invalidKeys > 0 || groqHealth.exhaustedKeys > 0 || groqHealth.coolingDownKeys > 0,
                    lastDiagnostic: {
                        category: groqHealth.invalidKeys > 0
                            ? 'invalid_keys'
                            : groqHealth.coolingDownKeys > 0
                                ? 'cooldown'
                                : 'ok',
                        message: `Groq has ${groqHealth.availableKeys} fallback key(s) available.`,
                        source: 'groq-key-manager',
                    },
                };
            }
        } catch {
            health.groq = this.llmHelper.hasGroq() ? configured('groq') : notConfigured('groq');
        }

        let hasTeamSync = this.llmHelper.hasTeamSyncApi();
        try {
            hasTeamSync = hasTeamSync || Boolean(CredentialsManager.getInstance().getTeamSyncApiKey());
        } catch {
            // Keep the passive in-memory signal if credential lookup is unavailable.
        }
        health.teamsync = hasTeamSync ? configured('teamsync') : notConfigured('teamsync');

        return health;
    }

    private resolveFallbackCandidates(primaryModel: string): ProviderFallbackCandidate[] {
        const candidates: string[] = [];
        const lower = primaryModel.toLowerCase();

	        if (!lower.includes('claude')) candidates.push(this.llmHelper.normalizeModelId('claude'));
	        if (!lower.includes('gpt') && !lower.includes('openai')) candidates.push('gpt-4o-mini');
	        if (!lower.includes('gemini')) candidates.push(this.llmHelper.normalizeModelId('gemini'));
	        if (!lower.includes('llama') && !lower.includes('groq')) candidates.push(this.llmHelper.normalizeModelId('llama'));
        candidates.push('teamsync');

        const uniqueCandidates = new Set<string>();
        return candidates
            .map((model) => this.llmHelper.normalizeModelId(model))
            .filter((model) => model !== primaryModel)
            .filter((model) => {
                if (uniqueCandidates.has(model)) return false;
                uniqueCandidates.add(model);
                return true;
            })
            .map((model) => ({
                model,
                provider: this.llmHelper.getProviderForModel(model),
            }));
    }

	    private async collectStreamResponseForPrompt(args: {
	        prompt: PromptObject;
	        imagePaths?: string[];
	        routing: RoutingDecision;
	        skipCustomNotesInjection?: boolean;
	        signal?: AbortSignal;
	        generationId: number;
	        requestId: string | null;
	        telemetryRequestId: string;
	        actionType: string;
	        sessionIdSnapshot: string;
	        previewStream?: {
            intent: UnifiedActionIntent;
            mode: UserControlledMode;
            profileApplied: boolean;
        };
    }): Promise<string | null> {
	        const { prompt, imagePaths, routing, skipCustomNotesInjection, signal, generationId, requestId, sessionIdSnapshot, previewStream } = args;
	        const isSystemDesignOutput = getQuestionResponseProfile(prompt.question, prompt.mode, prompt.intent, getPromptResponseProfileOptions(prompt)) === 'system_design';
	  
	        try {
	            if (!this.isOwnedActionRequest(requestId, generationId, signal, sessionIdSnapshot)) {
	                return null;
	            }
	            emitModelSelection({
	                requestId: args.telemetryRequestId,
	                actionType: args.actionType,
	                routing,
	            });
	            const providerPrompt = buildProviderPrompt({
	                prompt,
	                model: routing.actualModel,
	                provider: routing.actualProvider,
	                isSystemDesign: isSystemDesignOutput,
	            });

            let fullResponse = '';
            const stream = this.llmHelper.invoke({
                model: routing.actualModel,
                provider: routing.actualProvider,
                requestContext: {
                    requestId,
                    actionType: args.actionType,
                },
                prompt:
	                {
	                    question: prompt.question,
	                    context: providerPrompt.context,
	                    systemPrompt: providerPrompt.systemPrompt,
	                },
                imagePaths,
                runtimeOptions: {
	                    ignoreKnowledgeMode: true,
	                    skipKnowledgeInjection: true,
	                    skipModeInjection: true,
	                    skipCustomNotesInjection,
	                    maxOutputTokens: providerPrompt.maxOutputTokens,
	                    signal,
	                },
            });

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

                const token = nextChunk.value || '';
                fullResponse += token;
                if (previewStream && token) {
                    this.safeEmitAction(signal, requestId, generationId, 'action_token', {
                        intent: previewStream.intent,
                        requestId,
                        token,
                        mode: previewStream.mode,
                        profileApplied: previewStream.profileApplied,
                    }, sessionIdSnapshot);
                }
            }
	
	            return fullResponse.trim();
	        } finally {}
	    }

    private async executeActionWithRetry(args: {
        prompt: PromptObject;
        imagePaths?: string[];
        skipCustomNotesInjection?: boolean;
	        signal?: AbortSignal;
	        generationId: number;
	        requestId: string | null;
	        telemetryRequestId: string;
	        actionType: UnifiedActionIntent;
	        selectedModel: string;
	        selectedProvider: string;
	        sessionIdSnapshot: string;
        previewStream?: {
            intent: UnifiedActionIntent;
            mode: UserControlledMode;
            profileApplied: boolean;
        };
    }): Promise<{
        content: string;
        retryCount: number;
        fallbackUsed: boolean;
        requestedModel: string;
	        actualInvokedModel: string;
	        actualInvokedProvider: string;
	        fallbackReason: string | null;
	        previewStreamed: boolean;
	        routing: RoutingDecision;
	        fallbackChain: FallbackChainEntry[];
	    } | null> {
	        const { prompt, imagePaths, skipCustomNotesInjection, signal, generationId, requestId, telemetryRequestId, actionType, sessionIdSnapshot, previewStream } = args;
	        const primaryModel = this.llmHelper.normalizeModelId(args.selectedModel);
	        const primaryProvider = args.selectedProvider;
	        const fallbackPlan = buildProviderFallbackCandidatePlan(
	            this.resolveFallbackCandidates(primaryModel),
	            this.buildFallbackCandidateHealthSignals(),
	        );
	        const fallbackModel = fallbackPlan.selectedCandidate?.model ?? null;
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
	        const fallbackChain: FallbackChainEntry[] = [];
	        let fallbackCandidateMetadataRecorded = false;
	        const recordSkippedFallbackCandidates = () => {
	            if (fallbackCandidateMetadataRecorded) return;
	            fallbackCandidateMetadataRecorded = true;
	            fallbackPlan.skippedCandidates.forEach((evaluation) => {
	                const reason = formatProviderFallbackCandidateSkipReason(evaluation);
	                fallbackChain.push({
	                    model: evaluation.candidate.model,
	                    provider: evaluation.candidate.provider,
	                    result: 'skipped',
	                    reason,
	                    completedAt: Date.now(),
	                });
	                failureReasons.push(reason);
	            });
	        };
        let bedrockAuthExpiredDuringPrimary = false;
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
	                if (attempt.fallbackUsed) {
	                    recordSkippedFallbackCandidates();
	                    emitFallback({
	                        requestId: telemetryRequestId,
	                        actionType,
	                        primaryModel,
	                        failureReason: failureReasons.join(' | ') || 'primary_model_failed',
	                        fallbackModel: attempt.model,
	                        fallbackProvider: this.llmHelper.getProviderForModel(attempt.model),
	                    });
	                }
	                const attemptStartedAt = Date.now();
	                const routing = await this.llmHelper.resolveRoutingDecision({
	                    requestedModel: attempt.model,
	                    imagePaths,
	                });
	                const content = await this.collectStreamResponseForPrompt({
	                    prompt,
	                    imagePaths,
	                    routing,
	                    skipCustomNotesInjection,
	                    signal,
	                    generationId,
	                    requestId,
	                    telemetryRequestId,
	                    actionType,
	                    sessionIdSnapshot,
	                    previewStream,
	                });
	                if (content && content.trim() && !isFailureResponseText(content)) {
                    const routingForOwnership: RoutingDecision = attempt.fallbackUsed && bedrockAuthExpiredDuringPrimary
                        ? {
                            requestedModel: primaryModel,
                            requestedProvider: primaryProvider,
                            actualModel: routing.actualModel,
                            actualProvider: routing.actualProvider,
                            reason: BEDROCK_AUTH_EXPIRED_ROUTING_REASON,
                        }
                        : routing;
                    const fallbackReason = attempt.fallbackUsed
                        ? bedrockAuthExpiredDuringPrimary
                            ? BEDROCK_AUTH_EXPIRED_ROUTING_REASON
                            : (failureReasons.join(' | ') || 'primary_model_failed')
                        : null;
	                    fallbackChain.push({
	                        model: routing.actualModel,
	                        provider: routing.actualProvider,
	                        result: 'success',
	                        reason: routing.reason,
	                        startedAt: attemptStartedAt,
	                        completedAt: Date.now(),
	                    });
	                    return {
	                        content: content.trim(),
	                        retryCount: attemptIndex,
	                        fallbackUsed: attempt.fallbackUsed,
	                        requestedModel: primaryModel,
	                        actualInvokedModel: routing.actualModel,
	                        actualInvokedProvider: routing.actualProvider,
	                        fallbackReason,
	                        previewStreamed: Boolean(previewStream),
	                        routing: routingForOwnership,
	                        fallbackChain,
	                    };
	                }
	                const failureReason = `attempt_${attemptIndex + 1}:invalid_or_empty_response(${attempt.model})`;
	                fallbackChain.push({
	                    model: routing.actualModel,
	                    provider: routing.actualProvider,
	                    result: 'failure',
	                    reason: failureReason,
	                    startedAt: attemptStartedAt,
	                    completedAt: Date.now(),
	                });
	                failureReasons.push(failureReason);
	            } catch (error: any) {
	                const provider = this.llmHelper.getProviderForModel(attempt.model);
	                const isBedrockAuthExpired = provider === 'bedrock' && isBedrockReauthenticationError(error);
	                if (!attempt.fallbackUsed && isBedrockAuthExpired) {
	                    bedrockAuthExpiredDuringPrimary = true;
	                }
	                const reason = isBedrockAuthExpired
	                    ? BEDROCK_AUTH_EXPIRED_ROUTING_REASON
	                    : error?.message || String(error);
	                fallbackChain.push({
	                    model: attempt.model,
	                    provider,
	                    result: 'failure',
	                    reason,
	                    completedAt: Date.now(),
	                });
	                failureReasons.push(`attempt_${attemptIndex + 1}:${attempt.model}:${reason}`);
	                console.warn('[IntelligenceEngine] Action attempt failed:', reason);
	            }
	        }
	        recordSkippedFallbackCandidates();
	        console.warn('[IntelligenceEngine] Action retries exhausted:', failureReasons.join(' | '));
	        emitFallback({
	            requestId: telemetryRequestId,
	            actionType,
	            primaryModel,
	            failureReason: failureReasons.join(' | ') || 'all_attempts_failed',
	        });
	        const safeRouting: RoutingDecision = {
	            requestedModel: primaryModel,
	            requestedProvider: primaryProvider,
	            actualModel: 'safe_action_fallback',
	            actualProvider: 'local',
	            reason: bedrockAuthExpiredDuringPrimary ? BEDROCK_AUTH_EXPIRED_ROUTING_REASON : 'all_attempts_failed',
	        };
	        return {
	            content: buildSafeActionFallback(prompt.intent, prompt.mode, prompt.question, prompt.actionContract),
	            retryCount: Math.max(0, attempts.length - 1),
	            fallbackUsed: true,
	            requestedModel: primaryModel,
	            actualInvokedModel: 'safe_action_fallback',
	            actualInvokedProvider: 'local',
	            fallbackReason: bedrockAuthExpiredDuringPrimary ? BEDROCK_AUTH_EXPIRED_ROUTING_REASON : (failureReasons.join(' | ') || 'all_attempts_failed'),
	            previewStreamed: false,
	            routing: safeRouting,
	            fallbackChain,
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
	        telemetryRequestId: string;
	        actionType: UnifiedActionIntent;
	        sessionIdSnapshot: string;
	        requestedModel?: string;
	        actualInvokedModel?: string;
	        actualInvokedProvider?: string;
	        fallbackUsed?: boolean;
	        fallbackReason?: string | null;
	    }): Promise<FinalizedActionOutput | null> {
        const { prompt, content, maxTokens, imagePaths, skipCustomNotesInjection, signal, generationId, requestId, sessionIdSnapshot } = args;
        const profileOptions = getPromptResponseProfileOptions(prompt);
        const isSystemDesignPrompt = getQuestionResponseProfile(prompt.question, prompt.mode, prompt.intent, profileOptions) === 'system_design';
        const logSystemDesignDiagramAudit = (
            stage: string,
            draft: string,
            validationResult: ReturnType<typeof validateActionOutput>
        ) => {
            if (!isSystemDesignPrompt) return;
            console.log('[SYSTEM_DESIGN_DIAGRAM_AUDIT]', JSON.stringify({
                stage,
                intent: prompt.intent,
                mode: prompt.mode,
                requestId,
                valid: validationResult.valid,
                issues: validationResult.issues,
                length: draft.length,
                hasArchitectureJsonFence: /```[ \t]*architecture_json\b/i.test(draft),
                hasDiagramKey: /"diagram"\s*:/i.test(draft),
                hasMermaid: /```[ \t]*mermaid\b/i.test(draft),
                questionLength: prompt.question.length,
                redacted: true,
            }));
        };
        const validation = this.enforceScreenScanLanguageCompliance(
            prompt,
            content,
	            validateActionOutput(prompt.intent, prompt.mode, content, prompt.question, prompt.actionContract, profileOptions)
        );
        if (isSystemDesignPrompt) {
            console.log(`[SYSTEM_DESIGN_RAW_OUTPUT] requestedModel=${args.requestedModel ?? 'unknown'} actualInvokedModel=${args.actualInvokedModel ?? this.llmHelper.getCurrentModel()} fallbackUsed=${args.fallbackUsed === true} fallbackReason=${args.fallbackReason ?? 'none'} intent=${prompt.intent} requestId=${requestId ?? 'none'} length=${content.length} redacted=true [SYSTEM_DESIGN_RAW_OUTPUT_END]`);
        }
	        logSystemDesignDiagramAudit('initial', validation.correctedContent || content, validation);
	        if (validation.valid) {
	            const parsed = validation.correctedContent.trim();
	            return {
	                content: parsed,
	                validation: validationToOutcome(validation),
	                rawLength: content.length,
	                parsedLength: parsed.length,
	            };
	        }

        if (validation.correctedContent.trim()) {
            const correctedValidation = this.enforceScreenScanLanguageCompliance(
                prompt,
                validation.correctedContent,
                validateActionOutput(prompt.intent, prompt.mode, validation.correctedContent, prompt.question, prompt.actionContract, profileOptions)
            );
	            logSystemDesignDiagramAudit('corrected', correctedValidation.correctedContent || validation.correctedContent, correctedValidation);
	            if (correctedValidation.valid) {
	                const parsed = correctedValidation.correctedContent.trim();
	                return {
	                    content: parsed,
	                    validation: validationToOutcome(correctedValidation, true),
	                    rawLength: content.length,
	                    parsedLength: parsed.length,
	                };
	            }
	        }

        const invalidDraftForRepair = this.compactRepairDraft(content);
        const repairPrompt: PromptObject = {
            ...prompt,
            instructions: [
                ...prompt.instructions,
                {
                    key: 'output_repair',
                    title: 'OUTPUT REPAIR',
                    content: [
                        buildRepairInstruction(
                            prompt.intent,
                            validation.issues,
                            prompt.actionContract,
                            prompt.question,
                            extractPreferredCodingLanguageForRepair(prompt)
                        ),
                        this.buildScreenScanLanguageRepairInstruction(prompt),
                        `INVALID DRAFT EXCERPT:\n${invalidDraftForRepair}`,
                    ].filter(Boolean).join('\n\n'),
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
	            routing: {
	                requestedModel: args.requestedModel ?? this.llmHelper.getCurrentModel(),
	                requestedProvider: this.llmHelper.getProviderForModel(args.requestedModel ?? this.llmHelper.getCurrentModel()),
	                actualModel: args.actualInvokedModel ?? this.llmHelper.getCurrentModel(),
	                actualProvider: args.actualInvokedProvider ?? this.llmHelper.getCurrentProvider(),
	                reason: 'validation_repair',
	            },
	            skipCustomNotesInjection,
	            signal,
	            generationId,
	            requestId,
	            telemetryRequestId: args.telemetryRequestId,
	            actionType: args.actionType,
	            sessionIdSnapshot,
	        });
	        if (!repaired?.trim()) {
	            const fallback = buildSafeActionFallback(prompt.intent, prompt.mode, prompt.question, prompt.actionContract);
	            return {
	                content: fallback,
	                validation: {
	                    valid: false,
	                    warnings: [],
	                    issues: [...validation.issues, 'repair_empty'],
	                    repairApplied: true,
	                },
	                rawLength: content.length,
	                parsedLength: fallback.length,
	            };
	        }

        const repairedValidation = this.enforceScreenScanLanguageCompliance(
            prompt,
            repaired,
            validateActionOutput(prompt.intent, prompt.mode, repaired, prompt.question, prompt.actionContract, profileOptions)
        );
	        logSystemDesignDiagramAudit('repair', repairedValidation.correctedContent || repaired, repairedValidation);
	        if (repairedValidation.valid) {
	            const parsed = repairedValidation.correctedContent.trim();
	            return {
	                content: parsed,
	                validation: validationToOutcome(repairedValidation, true),
	                rawLength: content.length,
	                parsedLength: parsed.length,
	            };
	        }
        if (repairedValidation.correctedContent.trim()) {
            const correctedRepairValidation = this.enforceScreenScanLanguageCompliance(
                prompt,
                repairedValidation.correctedContent,
                validateActionOutput(prompt.intent, prompt.mode, repairedValidation.correctedContent, prompt.question, prompt.actionContract, profileOptions)
            );
	            logSystemDesignDiagramAudit('corrected_repair', correctedRepairValidation.correctedContent || repairedValidation.correctedContent, correctedRepairValidation);
	            if (correctedRepairValidation.valid) {
	                const parsed = correctedRepairValidation.correctedContent.trim();
	                return {
	                    content: parsed,
	                    validation: validationToOutcome(correctedRepairValidation, true),
	                    rawLength: content.length,
	                    parsedLength: parsed.length,
	                };
	            }
	        }
	        const fallback = buildSafeActionFallback(prompt.intent, prompt.mode, prompt.question, prompt.actionContract);
	        return {
	            content: fallback,
	            validation: {
	                valid: false,
	                warnings: [],
	                issues: [...validation.issues, ...repairedValidation.issues, 'repair_invalid'],
	                repairApplied: true,
	            },
	            rawLength: content.length,
	            parsedLength: fallback.length,
	        };
	    }

    private enforceScreenScanLanguageCompliance(
        prompt: PromptObject,
        content: string,
        validation: ActionOutputValidationResult
    ): ActionOutputValidationResult {
        if (prompt.actionContract && !actionContractAllowsCode(prompt.actionContract)) return validation;
        const issue = buildScreenScanLanguageMismatchIssue(prompt, validation.correctedContent || content);
        if (!issue) return validation;
        return {
            ...validation,
            valid: false,
            correctedContent: validation.correctedContent || content,
            issues: [...validation.issues, issue],
        };
    }

    private buildScreenScanLanguageRepairInstruction(prompt: PromptObject): string {
        const expectedFence = extractRequiredScreenScanFence(prompt);
        if (!expectedFence) return '';
        return [
            'SCREEN SCAN LANGUAGE REPAIR:',
            `The visible editor language requires the final solution to use the \`\`\`${expectedFence} code fence.`,
            'Rewrite the Solution code in that exact language. Do not return Python unless the required fence is ```python.',
            'Keep the same Problem and Approach content unless it needs language-specific adjustment.',
        ].join('\n');
    }

    private compactRepairDraft(content: string, maxChars = 2800): string {
        const trimmed = content.trim();
        if (trimmed.length <= maxChars) return trimmed;

        const head = trimmed.slice(0, Math.floor(maxChars * 0.58));
        const tail = trimmed.slice(-Math.floor(maxChars * 0.32));
        return `${head}\n\n[...invalid draft truncated for repair...]\n\n${tail}`;
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

	    private logDirectPipelineTelemetry(args: {
	        pipeline: IntelligenceMode | UnifiedActionIntent | string;
	        intent?: UnifiedActionIntent | string;
	        mode?: UserControlledMode | SessionMode | string;
        raw: string;
        final: string;
	        validatorResult?: ActionOutputValidationResult;
	        fallbackReason?: string;
	    }): void {
	        const requestId = createTelemetryRequestId(null, String(args.intent ?? args.pipeline));
	        const outcome = args.validatorResult
	            ? validationToOutcome(args.validatorResult)
	            : {
	                valid: !args.fallbackReason,
	                warnings: [],
	                issues: args.fallbackReason ? [args.fallbackReason] : [],
	                repairApplied: false,
	            };
	        emitValidationResult({
	            requestId,
	            actionType: String(args.intent ?? args.pipeline),
	            outcome,
	            rawLength: args.raw.length,
	            parsedLength: args.final.length,
	        });
	        if (args.fallbackReason) {
	            emitFallback({
	                requestId,
	                actionType: String(args.intent ?? args.pipeline),
	                primaryModel: this.llmHelper.getCurrentModel(),
	                failureReason: args.fallbackReason,
	            });
	        }
	        emitActionComplete({
	            requestId,
	            actionType: String(args.intent ?? args.pipeline),
	            selectedModel: this.llmHelper.getCurrentModel(),
	            selectedProvider: this.llmHelper.getCurrentProvider(),
	            actualInvokedModel: this.llmHelper.getCurrentModel(),
	            actualInvokedProvider: this.llmHelper.getCurrentProvider(),
	            fallbackUsed: Boolean(args.fallbackReason),
	            fallbackReason: args.fallbackReason,
	            validationResult: validationStatus(outcome),
	            rawLength: args.raw.length,
	            parsedLength: args.final.length,
	            startedAt: Date.now(),
	            completedAt: Date.now(),
	        });
	    }
	  
	    private logDirectModelSelection(pipeline: string): void {
	        const model = this.llmHelper.getCurrentModel();
	        const provider = this.llmHelper.getCurrentProvider();
	        emitModelSelection({
	            requestId: createTelemetryRequestId(null, pipeline),
	            actionType: pipeline,
	            routing: {
	                requestedModel: model,
	                requestedProvider: provider,
	                actualModel: model,
	                actualProvider: provider,
	                reason: 'direct_pipeline',
	            },
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
        fn: (signal: AbortSignal | undefined, generationId: number) => Promise<T>,
        options?: { reuseExistingController?: boolean }
    ): Promise<T | null> {
        this.currentClientRequestId = requestId;
        this.setMode(mode);

        const controller = requestId ? this.registerRequestAbort(requestId, options) : null;
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
        const requestId = `assist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const resultBridge = (payload: UnifiedActionEventPayload) => {
            if (payload.intent !== 'what_to_answer' || payload.requestId !== requestId) return;
            this.emit('assist_update', payload.content || '', requestId);
        };
        this.on('action_result', resultBridge);
        try {
            return await this.runAction({
                intent: 'what_to_answer',
                message: this.session.getLastInterviewerTurn() || 'Provide one concise, useful passive insight from the latest meeting context.',
                requestId,
                profilePreference: 'force_off',
            });
        } finally {
            this.off('action_result', resultBridge);
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
        const hasImages = Boolean(imagePaths?.length);
        if (!hasImages && now - this.lastTriggerTime < this.triggerCooldown) {
            return null;
        }
        this.lastTriggerTime = now;

        const tokenBridge = (payload: UnifiedActionEventPayload) => {
            if (payload.intent !== 'what_to_answer' || payload.requestId !== activeRequestId) return;
            this.emit('suggested_answer_token', payload.token || '', question || 'inferred', confidence, activeRequestId, 'what_to_answer');
        };
        const resultBridge = (payload: UnifiedActionEventPayload) => {
            if (payload.intent !== 'what_to_answer' || payload.requestId !== activeRequestId) return;
            this.emit('suggested_answer', payload.content || '', question || 'What to Answer', confidence, activeRequestId, 'what_to_answer');
        };

        this.on('action_token', tokenBridge);
        this.on('action_result', resultBridge);
        try {
            return await this.runAction({
                intent: 'what_to_answer',
                message: question,
                imagePaths,
                requestId,
                modeOverride: selectedMode,
            });
        } finally {
            this.off('action_token', tokenBridge);
            this.off('action_result', resultBridge);
        }
    }

    /**
     * MODE 3: Follow-Up (Refinement)
     * Modify the last assistant message
     */
    async runFollowUp(intent: string, userRequest?: string, requestId?: string): Promise<string | null> {
        const activeRequestId = requestId ?? null;
        const lastMsg = this.session.getLastAssistantMessage();
        if (!lastMsg) {
            console.warn('[IntelligenceEngine] No lastAssistantMessage found for follow-up');
            return null;
        }
        const tokenBridge = (payload: UnifiedActionEventPayload) => {
            if (payload.intent !== 'manual_chat' || payload.requestId !== activeRequestId) return;
            this.emit('refined_answer_token', payload.token || '', intent, activeRequestId);
        };
        const resultBridge = (payload: UnifiedActionEventPayload) => {
            if (payload.intent !== 'manual_chat' || payload.requestId !== activeRequestId) return;
            this.emit('refined_answer', payload.content || '', intent, activeRequestId);
        };
        this.on('action_token', tokenBridge);
        this.on('action_result', resultBridge);
        try {
            return await this.runAction({
                intent: 'manual_chat',
                message: userRequest || intent,
                requestId,
                modeOverride: 'follow_up',
                additionalContext: [
                    'REFINE THE PREVIOUS ASSISTANT ANSWER.',
                    `REFINEMENT INTENT: ${intent}`,
                    `PREVIOUS ASSISTANT ANSWER:\n${lastMsg}`,
                ].join('\n\n'),
            });
        } finally {
            this.off('action_token', tokenBridge);
            this.off('action_result', resultBridge);
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
        const activeRequestId = requestId ?? null;
        const tokenBridge = (payload: UnifiedActionEventPayload) => {
            if (payload.intent !== 'system_design_tradeoffs' || payload.requestId !== activeRequestId) return;
            this.emit('system_design_tradeoffs_token', payload.token || '', activeRequestId);
        };
        const resultBridge = (payload: UnifiedActionEventPayload) => {
            if (payload.intent !== 'system_design_tradeoffs' || payload.requestId !== activeRequestId) return;
            this.emit('system_design_tradeoffs', payload.content || '', activeRequestId);
        };
        this.on('action_token', tokenBridge);
        this.on('action_result', resultBridge);
        try {
            return await this.runAction({
                intent: 'system_design_tradeoffs',
                requestId,
                profilePreference: 'force_off',
                modeOverride: 'system_design',
            });
        } finally {
            this.off('action_token', tokenBridge);
            this.off('action_result', resultBridge);
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
        const sessionQuestion = this.session.getDetectedCodingQuestion();
        const questionContext = problemStatement?.trim() || sessionQuestion.question?.trim() || undefined;
        const transcriptContext = questionContext ? undefined : this.session.getFormattedContext(180);
        console.log(`[IntelligenceEngine] Code hint — unified runAction path, question: ${questionContext ? 'yes' : 'none'}, transcript chars: ${transcriptContext?.length ?? 0}, images: ${imagePaths?.length ?? 0}`);

        const onToken = (payload: any) => {
            if (payload?.intent !== 'code_hint' || payload?.requestId !== activeRequestId) return;
            this.emit('suggested_answer_token', payload.token || '', 'Code Hint', 1.0, activeRequestId, 'code_hint');
        };
        const onResult = (payload: any) => {
            if (payload?.intent !== 'code_hint' || payload?.requestId !== activeRequestId) return;
            this.emit('suggested_answer', payload.content || '', 'Code Hint', 1.0, activeRequestId, 'code_hint');
        };

        this.on('action_token', onToken);
        this.on('action_result', onResult);
        try {
            return await this.runAction({
                intent: 'code_hint',
                message: questionContext || 'Review the visible code and give the next useful hint.',
                additionalContext: transcriptContext,
                imagePaths,
                requestId,
                modeOverride: 'coding',
                actionContract: 'hint_only',
                profilePreference: 'force_off',
            });
        } finally {
            this.off('action_token', onToken);
            this.off('action_result', onResult);
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
        const context = this.session.getFormattedContext(180);
        const resolvedProblem = problemStatement?.trim() || this.session.getDetectedCodingQuestion().question?.trim() || undefined;

        if (!context.trim() && !resolvedProblem && (!imagePaths || imagePaths.length === 0)) {
            const msg = "There's nothing to brainstorm right now. Make sure your question is visible or spoken aloud, then try again.";
            this.logDirectPipelineTelemetry({
                pipeline: 'brainstorm',
                intent: 'brainstorm',
                mode: this.session.getMode(),
                raw: '',
                final: msg,
                fallbackReason: 'brainstorm_no_context',
            });
            this.session.addAssistantMessage(msg);
            this.emit('suggested_answer', msg, 'Brainstorming Approaches', 1.0, activeRequestId, 'brainstorm');
            return msg;
        }

        const onToken = (payload: any) => {
            if (payload?.intent !== 'brainstorm' || payload?.requestId !== activeRequestId) return;
            this.emit('suggested_answer_token', payload.token || '', 'Brainstorming Approaches', 1.0, activeRequestId, 'brainstorm');
        };
        const onResult = (payload: any) => {
            if (payload?.intent !== 'brainstorm' || payload?.requestId !== activeRequestId) return;
            this.emit('suggested_answer', payload.content || '', 'Brainstorming Approaches', 1.0, activeRequestId, 'brainstorm');
        };

        this.on('action_token', onToken);
        this.on('action_result', onResult);
        try {
            return await this.runAction({
                intent: 'brainstorm',
                message: resolvedProblem,
                additionalContext: context.trim() ? context : undefined,
                imagePaths,
                requestId,
                profilePreference: 'force_off',
            });
        } finally {
            this.off('action_token', onToken);
            this.off('action_result', onResult);
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
            const MAX_SCREEN_CHARS = 6000;
            if (!this.screenScanLLM) {
                const fallback = "Please configure your API Keys in Settings to use Screen Scan.";
                this.logDirectPipelineTelemetry({
                    pipeline: 'screen_scan',
                    intent: 'screen_scan',
                    mode: this.session.getMode(),
                    raw: '',
                    final: fallback,
                    fallbackReason: 'screen_scan_llm_not_initialized',
                });
                this.safeEmit(signal, activeRequestId, 'screen_scan_result', fallback, 'ui_general');
                return fallback;
            }

            if (!imagePaths || imagePaths.length === 0) {
                const fallback = "No screenshot available. Capture your screen first.";
                this.logDirectPipelineTelemetry({
                    pipeline: 'screen_scan',
                    intent: 'screen_scan',
                    mode: this.session.getMode(),
                    raw: '',
                    final: fallback,
                    fallbackReason: 'screen_scan_no_screenshot',
                });
                this.safeEmit(signal, activeRequestId, 'screen_scan_result', fallback, 'ui_general');
                return fallback;
            }

            try {
                const rawText = extractedText?.trim()
                    ? extractedText.trim()
                    : await this.llmHelper.extractScreenTextHybrid(imagePaths);
                if (rawText === '__NO_CHANGE__') {
                    const noChange = "No visible screen changes detected.";
                    this.logDirectPipelineTelemetry({
                        pipeline: 'screen_scan',
                        intent: 'screen_scan',
                        mode: this.session.getMode(),
                        raw: rawText,
                        final: noChange,
                        fallbackReason: 'screen_scan_no_change',
                    });
                    this.safeEmit(signal, activeRequestId, 'screen_scan_result', noChange, 'ui_general');
                    return noChange;
                }
                const screenText = rawText
                    .replace(/\s+/g, ' ')
                    .replace(/[^\x20-\x7E\n]/g, '')
                    .trim()
                    .slice(0, MAX_SCREEN_CHARS);

                console.log(`[OCR_SCAN] textLength=${screenText.length} redacted=true [OCR_SCAN_END]`);

                if (screenText.length < 50) {
                    const fallback = "I couldn't detect enough readable text on screen. Try capturing a clearer area.";
                    this.logDirectPipelineTelemetry({
                        pipeline: 'screen_scan',
                        intent: 'screen_scan',
                        mode: this.session.getMode(),
                        raw: screenText,
                        final: fallback,
                        fallbackReason: 'screen_scan_ocr_too_short',
                    });
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
                const detectedEditorLanguage = (detectedMode === 'coding' || detectedMode === 'interview_question')
                    ? (detectVisibleScreenLanguage(screenText) ?? await detectEditorLanguageFromScreenCrop(imagePaths))
                    : null;
                const screenTextForPrompt = detectedEditorLanguage
                    ? [
                        `VISIBLE EDITOR LANGUAGE: ${detectedEditorLanguage.label}`,
                        `REQUIRED SOLUTION LANGUAGE: ${detectedEditorLanguage.label}`,
                        `REQUIRED CODE FENCE: \`\`\`${detectedEditorLanguage.fence}`,
                        screenText,
                    ].join('\n')
                    : screenText;

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
                        message: screenTextForPrompt,
                        imagePaths: undefined,
                        requestId: activeRequestId ?? undefined,
                        modeOverride: (detectedMode === 'coding' || detectedMode === 'interview_question') ? 'coding' : this.session.getMode(),
                        profilePreference: 'force_off',
                        additionalContext: [
                            `SCREEN MODE: ${detectedMode}`,
                            (detectedMode === 'coding' || detectedMode === 'interview_question')
                                ? (() => {
                                    const platform = detectCodingPlatform(screenText);
                                    return platform
                                        ? `DETECTED PLATFORM: ${platform}\nYou MUST include the platform name "${platform}" and the problem number in your response header.`
                                        : null;
                                })()
                                : null,
                            detectedEditorLanguage
                                ? [
                                    `VISIBLE EDITOR LANGUAGE: ${detectedEditorLanguage.label}`,
                                    `REQUIRED SOLUTION LANGUAGE: ${detectedEditorLanguage.label}`,
                                    `REQUIRED CODE FENCE: \`\`\`${detectedEditorLanguage.fence}`,
                                    'Use this detected LeetCode/editor language for the final solution. Do not default to Python while this language evidence is present.',
                                ].join('\n')
                                : null,
                        ].filter(Boolean).join('\n\n'),
                        screenScanMode: detectedMode,
                        reuseRequestLifecycle: true,
                    });

                    if (!fullResult || fullResult.trim().length < 5) {
                        const fallback = "I couldn't detect meaningful content on screen. Try capturing a different area.";
                        this.logDirectPipelineTelemetry({
                            pipeline: 'screen_scan',
                            intent: 'screen_scan',
                            mode: detectedMode === 'coding' || detectedMode === 'interview_question' ? 'coding' : this.session.getMode(),
                            raw: fullResult || '',
                            final: fallback,
                            fallbackReason: 'screen_scan_action_empty',
                        });
                        this.safeEmit(signal, activeRequestId, 'screen_scan_result', fallback, detectedMode);
                        return fallback;
                    }

                    console.log(`[SCREEN_SCAN_LIFECYCLE] requestId=${activeRequestId ?? 'none'} finalDelivered=true mode=${detectedMode} length=${fullResult.length}`);
                    return fullResult;
                } finally {
                    this.off('action_token', actionTokenListener);
                    this.off('action_result', actionResultListener);
                }
            } finally {
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

    clearActionResponseCache(): void {
        this.actionResponseCache.clear();
    }

    /**
     * Reset engine state (cancels any in-flight operations)
     */
    reset(): void {
        this.activeMode = 'idle';
        this.activeActionRequestId = null;
        this.activeActionRequestIds.clear();
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
