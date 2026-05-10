// electron/intelligence/adapters.ts
// Adapter functions that bridge existing legacy types to the new intelligence interfaces.
//
// These adapters are the key to the Strangler Fig migration pattern:
//   - Existing code continues to produce legacy types (IntentResult, QuestionResponseProfile, etc.)
//   - New pipeline stages consume the new types (QuestionAnalysis, ContextBundle, etc.)
//   - Adapters translate between the two at the boundary
//
// As legacy code is gradually replaced, these adapters will shrink and eventually be removed.

import type { IntentResult, ConversationIntent } from '../llm/IntentClassifier';
import type { QuestionCategory, QuestionDepth, ClassificationSource } from './types';
import type { ResponseDepth } from './types';
import type { QuestionAnalysis, createDefaultAnalysis } from './QuestionAnalysis';
import type { ContextBundle, ContextSource } from './ContextBundle';
import type { BuiltContextLayers, ProfilePolicy } from '../ActionContextBuilder';

// ---------------------------------------------------------------------------
// Intent → QuestionCategory mapping
// ---------------------------------------------------------------------------

/**
 * Maps a legacy ConversationIntent to the new unified QuestionCategory.
 *
 * Mapping decisions:
 *   - 'deep_dive' → 'general' (depth is handled by ResponseStrategy, not category)
 *   - 'example_request' → 'behavioral' (asking for examples is a behavioral pattern)
 *   - 'summary_probe' → 'general' (summaries are a general skill, not a category)
 */
const INTENT_TO_CATEGORY: Record<ConversationIntent, QuestionCategory> = {
    coding: 'coding',
    system_design: 'system_design',
    behavioral: 'behavioral',
    clarification: 'clarification',
    follow_up: 'follow_up',
    deep_dive: 'general',
    example_request: 'behavioral',
    summary_probe: 'general',
    general: 'general',
};

/**
 * Maps a legacy QuestionResponseProfile string to QuestionCategory.
 */
const PROFILE_TO_CATEGORY: Record<string, QuestionCategory> = {
    coding: 'coding',
    system_design: 'system_design',
    resume_or_jd: 'resume_jd',
    follow_up: 'follow_up',
    fresh_general: 'general',
    general: 'general',
};

// ---------------------------------------------------------------------------
// Depth estimation
// ---------------------------------------------------------------------------

/**
 * Estimate question depth from the raw intent.
 * This is a rough heuristic; the full ResponseStrategyCalculator will be more sophisticated.
 */
function estimateDepthFromIntent(intent: ConversationIntent): QuestionDepth {
    switch (intent) {
        case 'deep_dive':
        case 'system_design':
            return 'deep';
        case 'coding':
        case 'behavioral':
            return 'moderate';
        case 'clarification':
        case 'summary_probe':
        case 'follow_up':
            return 'shallow';
        default:
            return 'moderate';
    }
}

// ---------------------------------------------------------------------------
// Public adapter functions
// ---------------------------------------------------------------------------

/**
 * Map QuestionDepth (shallow | moderate | deep) to ResponseDepth (short | medium | deep).
 * These are intentionally separate types — question complexity is not the same as answer length.
 */
const DEPTH_MAP: Record<QuestionDepth, ResponseDepth> = {
    shallow: 'short',
    moderate: 'medium',
    deep: 'deep',
};

export function questionDepthToResponseDepth(depth: QuestionDepth): ResponseDepth {
    return DEPTH_MAP[depth] ?? 'medium';
}

/**
 * Convert a legacy IntentResult (from IntentClassifier.classifyIntent())
 * into the new QuestionAnalysis type.
 *
 * @param result - Legacy IntentResult from the existing classifier
 * @param overrides - Optional overrides for specific fields
 * @returns A QuestionAnalysis object compatible with the new pipeline
 */
export function intentResultToQuestionAnalysis(
    result: IntentResult,
    overrides?: Partial<QuestionAnalysis>,
): QuestionAnalysis {
    const category = INTENT_TO_CATEGORY[result.intent] ?? 'general';

    return {
        category,
        confidence: result.confidence,
        isFollowUp: result.intent === 'follow_up',
        referencesContext: result.intent === 'follow_up' || result.intent === 'deep_dive',
        estimatedDepth: estimateDepthFromIntent(result.intent),
        answerShape: result.answerShape,
        rawIntent: result.intent,
        classificationSource: result.confidence >= 0.85 ? 'regex' : 'slm',
        ...overrides,
    };
}

/**
 * Convert a legacy QuestionResponseProfile string
 * into a QuestionCategory.
 *
 * @param profile - Legacy profile string from ActionContextBuilder.getQuestionResponseProfile()
 * @returns The corresponding QuestionCategory
 */
export function profileToCategory(profile: string): QuestionCategory {
    return PROFILE_TO_CATEGORY[profile] ?? 'general';
}

/**
 * Convert a legacy BuiltContextLayers (from ActionContextBuilder.buildContext())
 * into the new ContextBundle type.
 *
 * This adapter wraps the existing context layers as ContextSources,
 * preserving all data while fitting the new interface.
 *
 * @param layers - Legacy BuiltContextLayers from ActionContextBuilder
 * @returns A ContextBundle compatible with the new pipeline
 */
export function builtLayersToContextBundle(layers: BuiltContextLayers): ContextBundle {
    const sources: ContextSource[] = [];

    // Transcript source
    if (layers.promptObject.transcript?.content) {
        sources.push({
            id: `transcript_${layers.transcriptStrategy}`,
            type: 'transcript',
            title: layers.promptObject.transcript.title,
            content: layers.promptObject.transcript.content,
            approxTokens: layers.transcriptApproxTokens,
            relevanceScore: 1.0, // Transcript is always highly relevant
            freshness: 1.0,
        });
    }

    // Profile intelligence source
    if (layers.profileApplied && layers.promptObject.profile?.used) {
        sources.push({
            id: 'profile_intelligence',
            type: 'profile_intelligence',
            title: layers.promptObject.profile.title,
            content: layers.promptObject.profile.context,
            approxTokens: layers.promptObject.profile.approxTokens,
            relevanceScore: 0.8,
            freshness: 0.5, // Profile data is semi-static
        });
    }

    // RAG source
    if (layers.promptObject.rag?.content) {
        sources.push({
            id: 'rag_memory',
            type: 'rag_memory',
            title: layers.promptObject.rag.title,
            content: layers.promptObject.rag.content,
            approxTokens: layers.promptObject.rag.approxTokens,
            relevanceScore: 0.7,
            freshness: 0.8,
        });
    }

    // Supplemental context source
    if (layers.promptObject.supplemental?.content) {
        sources.push({
            id: 'supplemental',
            type: 'supplemental',
            title: layers.promptObject.supplemental.title,
            content: layers.promptObject.supplemental.content,
            approxTokens: layers.promptObject.supplemental.approxTokens,
            relevanceScore: 0.6,
            freshness: 0.9,
        });
    }

    const totalTokens = sources.reduce((sum, s) => sum + s.approxTokens, 0);

    return {
        sources,
        totalTokens,
        profileApplied: layers.profileApplied,
        resolvedProfilePolicy: layers.profilePolicy,
        directResponse: layers.directResponse,
    };
}
