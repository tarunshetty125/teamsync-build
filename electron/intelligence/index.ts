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
export { SalesBrain, LectureBrain, RecruitingBrain, TeamMeetingBrain, LookingForWorkBrain } from './brains/ModeBrains';

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

// ContextPriorityEngine (live prompt prioritization)
export type {
    ContextPrioritySource,
    ContextPriorityLevel,
    ContextPriorityResult,
    ContextPriorityInput,
    PromptContextOrderKey,
} from './ContextPriorityEngine';
export {
    deriveContextPriority,
    getOrderedContextSources,
    getPromptContextOrder,
    shouldExcludePromptSection,
} from './ContextPriorityEngine';

// KnowledgeOrchestratorV2 (Phase 3)
export { KnowledgeOrchestratorV2 } from './KnowledgeOrchestratorV2';
export type { KnowledgeOrchestratorLike, RetrieveContextParams } from './KnowledgeOrchestratorV2';

// Adapters (legacy → new type bridges)
export {
    intentResultToQuestionAnalysis,
    profileToCategory,
    builtLayersToContextBundle,
} from './adapters';

// Planning (Brain Planning V1)
export type { PlanStep, ReasoningPlan, PlanningInput } from './planning';
export {
    planReasoning,
    isPlanConfident,
    planContains,
    planContainsAny,
    planContainsAll,
    createFallbackPlan,
} from './planning';

// Evaluation (Response Quality V1)
export type { QualityIssue, QualityRule, QualityEvaluationInput, QualityEvaluationResult } from './evaluation';
export {
    evaluateResponseQuality,
    isQualityAcceptable,
    getMostCriticalIssue,
    QUALITY_RULES,
    getRulesForBrain,
} from './evaluation';

// Resume × JD Intelligence (V2)
export type { FitSignal, ResumeJDAnalysis, ResumeJDInput } from './resume';
export { analyzeResumeJDFit, isAnalysisUsable } from './resume';

// Metrics & Observability (Phase 6)
export type { BrainExecutionMetric, PipelineLatencyMetric } from './metrics';
export { MetricCollector, getDefaultMetricCollector } from './metrics';
