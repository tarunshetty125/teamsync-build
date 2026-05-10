// electron/intelligence/index.ts
// Barrel export for the intelligence module.
// All new intelligence types and utilities are accessible from this single import:
//
//   import { QuestionAnalysis, ContextBundle, Brain, BrainRegistry } from './intelligence';

// Core types
export type {
    QuestionCategory,
    QuestionDepth,
    ClassificationSource,
    ResponseDepth,
    ResponseTone,
    BrainId,
    StreamStrategy,
    ContextSourceType,
} from './types';

// Re-exported legacy types (convenience)
export type {
    SessionMode,
    UnifiedActionIntent,
    ProfilePolicy,
    ProfilePreference,
    TranscriptStrategy,
    RAGScope,
    ConversationIntent,
    IntentResult,
    ScreenContentMode,
    TemporalContext,
    ToneSignal,
} from './types';

// QuestionAnalysis
export type { QuestionInput, QuestionAnalysis } from './QuestionAnalysis';
export { createDefaultAnalysis } from './QuestionAnalysis';

// ContextBundle
export type { ContextSource, ContextBundle } from './ContextBundle';
export { createEmptyBundle } from './ContextBundle';

// ResponseStrategy
export type { ResponseStrategy, DepthPreset } from './ResponseStrategy';
export { DEPTH_PRESETS, createStrategy, defaultStrategy } from './ResponseStrategy';

// Brain interface & registry
export type { BrainInput, BrainOutput, Brain } from './brains/Brain';
export { BrainRegistry } from './brains/BrainRegistry';

// Brain implementations (Phase 4)
export { GeneralBrain } from './brains/GeneralBrain';
export { CodingBrain } from './brains/CodingBrain';
export { BehavioralBrain } from './brains/BehavioralBrain';
export { SystemDesignBrain } from './brains/SystemDesignBrain';
export { ResumeBrain } from './brains/ResumeBrain';
export { ScreenAnalysisBrain } from './brains/ScreenAnalysisBrain';

// BrainSelector & factory (Phase 4)
export { BrainSelector } from './brains/BrainSelector';
export { createBrainLayer } from './brains/createBrainLayer';
export type { BrainLayer } from './brains/createBrainLayer';

// ContextPrioritizer (Phase 3)
export {
    prioritizeSources,
    packIntoBudget,
    getPriorityTable,
} from './ContextPrioritizer';

// KnowledgeOrchestratorV2 (Phase 3)
export { KnowledgeOrchestratorV2 } from './KnowledgeOrchestratorV2';
export type { KnowledgeOrchestratorLike, RetrieveContextParams } from './KnowledgeOrchestratorV2';

// PromptAssembler (Phase 3)
export { PromptAssembler } from './PromptAssembler';
export type { AssembleParams } from './PromptAssembler';

// Adapters (legacy → new type bridges)
export {
    intentResultToQuestionAnalysis,
    profileToCategory,
    builtLayersToContextBundle,
} from './adapters';

// Metrics & Observability (Phase 6)
export type { BrainExecutionMetric, PipelineLatencyMetric } from './metrics';
export { MetricCollector, getDefaultMetricCollector } from './metrics';

