// electron/intelligence/QuestionAnalysis.ts
// Output type of the QuestionUnderstandingEngine.
// Consumed by: KnowledgeOrchestrator, PlanningEngine, BrainSelector.
//
// This type UNIFIES the two previously disconnected classifiers:
//   1. IntentClassifier.classifyIntent() → IntentResult (used only in runWhatShouldISay)
//   2. ActionContextBuilder.getQuestionResponseProfile() → QuestionResponseProfile (used in prompt building)
//
// All downstream consumers should depend on QuestionAnalysis, never on the raw legacy types.

import type {
    QuestionCategory,
    QuestionDepth,
    ClassificationSource,
    SessionMode,
} from './types';

// ---------------------------------------------------------------------------
// QuestionInput — what goes INTO the understanding engine
// ---------------------------------------------------------------------------

/**
 * Raw input to the QuestionUnderstandingEngine.
 * Aggregates all signals available at the point of question arrival.
 */
export interface QuestionInput {
    /** The question text (from transcript, chat, or screen OCR) */
    text: string;

    /** Recent formatted transcript for context-based heuristic */
    recentTranscript?: string;

    /** Number of previous assistant responses in this session */
    assistantResponseCount?: number;

    /** User-selected session mode (always wins for category override) */
    sessionMode?: SessionMode;

    /** Whether the input includes images (affects brain selection) */
    hasImages?: boolean;

    /** Source of the input — influences confidence scoring */
    source: 'transcript' | 'chat' | 'screen' | 'shortcut';
}

// ---------------------------------------------------------------------------
// QuestionAnalysis — what comes OUT of the understanding engine
// ---------------------------------------------------------------------------

/**
 * Rich classification result produced by the QuestionUnderstandingEngine.
 *
 * Downstream consumers:
 *   - KnowledgeOrchestrator: uses `category` for context priority ordering
 *   - ReasoningPlanner: uses `category` + `estimatedDepth` for brain/strategy selection
 *   - PromptAssembler: uses `answerShape` for prompt injection
 *   - Metrics: uses `classificationSource` + `confidence` for observability
 */
export interface QuestionAnalysis {
    /** Primary category — drives Brain selection */
    category: QuestionCategory;

    /** Confidence in the classification (0-1) */
    confidence: number;

    /** Whether this is a follow-up to a previous answer */
    isFollowUp: boolean;

    /** Whether the question references prior context ("you mentioned...") */
    referencesContext: boolean;

    /** Estimated complexity / depth needed for the answer */
    estimatedDepth: QuestionDepth;

    /** Answer shape guidance string for prompt injection */
    answerShape: string;

    /**
     * Raw intent string from the legacy IntentClassifier.
     * Preserved for backward compatibility and debugging.
     * Should NOT be used for logic decisions — use `category` instead.
     */
    rawIntent: string;

    /** Source of the classification decision — for metrics/debugging */
    classificationSource: ClassificationSource;
}

// ---------------------------------------------------------------------------
// Factory helpers (pure functions, no side effects)
// ---------------------------------------------------------------------------

/**
 * Create a default QuestionAnalysis for when classification is skipped
 * or the input is too short/empty to classify meaningfully.
 */
export function createDefaultAnalysis(overrides?: Partial<QuestionAnalysis>): QuestionAnalysis {
    return {
        category: 'general',
        confidence: 0.5,
        isFollowUp: false,
        referencesContext: false,
        estimatedDepth: 'moderate',
        answerShape: 'Respond naturally based on context. Keep it conversational and direct.',
        rawIntent: 'general',
        classificationSource: 'context_heuristic',
        ...overrides,
    };
}
