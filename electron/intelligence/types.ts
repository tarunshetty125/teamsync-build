// electron/intelligence/types.ts
// Core shared types for the modular intelligence pipeline.
// These types form the contract between all pipeline stages.
//
// IMPORTANT: This file must have ZERO runtime dependencies.
// It is imported by every intelligence module and must never cause circular imports.

// ---------------------------------------------------------------------------
// Question Understanding
// ---------------------------------------------------------------------------

/**
 * Primary question category — drives Brain selection.
 * Unifies the previously separate `ConversationIntent` (9 types) and
 * `QuestionResponseProfile` (6 types) into a single taxonomy.
 *
 * Mapping from legacy types:
 *   ConversationIntent.coding             → 'coding'
 *   ConversationIntent.behavioral         → 'behavioral'
 *   ConversationIntent.system_design      → 'system_design'
 *   ConversationIntent.follow_up          → 'follow_up'
 *   ConversationIntent.clarification      → 'clarification'
 *   ConversationIntent.deep_dive          → 'general' (depth=deep)
 *   ConversationIntent.example_request    → 'behavioral' (shape override)
 *   ConversationIntent.summary_probe      → 'general' (shape override)
 *   ConversationIntent.general            → 'general'
 *   QuestionResponseProfile.resume_or_jd  → 'resume_jd'
 *   QuestionResponseProfile.fresh_general → 'general'
 */
export type QuestionCategory =
    | 'coding'
    | 'behavioral'
    | 'system_design'
    | 'resume_jd'
    | 'follow_up'
    | 'clarification'
    | 'general';

/**
 * Estimated depth/complexity of the question.
 * Used by the ResponseStrategy calculator to determine answer length.
 */
export type QuestionDepth = 'shallow' | 'moderate' | 'deep';

/**
 * Classification source — for debugging and metrics.
 */
export type ClassificationSource = 'regex' | 'slm' | 'context_heuristic' | 'user_override';

// ---------------------------------------------------------------------------
// Response Strategy
// ---------------------------------------------------------------------------

/**
 * Response depth level — controls output length and structure.
 *   short:  50-120 words, 1-2 bullets
 *   medium: 120-250 words, 2-4 bullets
 *   deep:   250-500 words, 4-6 bullets
 */
export type ResponseDepth = 'short' | 'medium' | 'deep';

/**
 * Response tone — influences language register in the prompt.
 */
export type ResponseTone = 'conversational' | 'technical' | 'formal';

// ---------------------------------------------------------------------------
// Brain
// ---------------------------------------------------------------------------

/**
 * Unique brain identifier. Maps 1:1 to QuestionCategory,
 * plus 'screen_analysis' for the dedicated screen scan brain.
 */
export type BrainId =
    | 'coding'
    | 'behavioral'
    | 'system_design'
    | 'resume'
    | 'general'
    | 'screen_analysis';

/**
 * Stream strategy determines how the StreamingEngine delivers tokens:
 *   'direct'           — tokens are emitted as they arrive (lowest latency)
 *   'collect_validate' — full response is collected, validated, then emitted
 *                        (required when output format must be enforced, e.g. code blocks)
 */
export type StreamStrategy = 'direct' | 'collect_validate';

// ---------------------------------------------------------------------------
// Context Sources
// ---------------------------------------------------------------------------

/**
 * Identifies the origin of a context source for priority scoring.
 */
export type ContextSourceType =
    | 'transcript'
    | 'profile_intelligence'
    | 'rag_memory'
    | 'screen_content'
    | 'session_memory'
    | 'supplemental'
    | 'mode_custom';

// ---------------------------------------------------------------------------
// Re-exports from existing types (for convenience — avoids deep imports)
// ---------------------------------------------------------------------------

// These are re-exported so that new intelligence modules can import
// everything from 'intelligence/types' without reaching into legacy modules.
// The actual type definitions remain in their original files to avoid
// breaking existing imports.

export type { SessionMode } from '../SessionTracker';
export type { UnifiedActionIntent, ProfilePolicy, ProfilePreference, TranscriptStrategy, RAGScope } from '../ActionContextBuilder';
export type { ConversationIntent, IntentResult } from '../llm/IntentClassifier';
export type { ScreenContentMode } from '../llm/ScreenScanLLM';
export type { TemporalContext, ToneSignal } from '../llm/TemporalContextBuilder';
