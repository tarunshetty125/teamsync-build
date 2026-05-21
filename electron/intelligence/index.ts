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

// ---------------------------------------------------------------------------
// Phase 1: Intelligence Architecture v2
// ---------------------------------------------------------------------------

// Capability Registry (§1)
export type {
    IntelligenceCapabilityKey,
    IntelligenceCapabilitySet,
    CapabilityChangeEvent,
    CapabilityConfig,
} from './capability/types';
export { CapabilityRegistry } from './capability/CapabilityRegistry';
export { assertCapability, withCapability, withCapabilityAsync, guardCapability } from './capability/CapabilityResolver';

// Confidence Engine (§3)
export type {
    ConfidenceFactor,
    ConfidenceResult,
    ConfidenceConfig,
    ConfidenceThresholdResult,
} from './confidence/types';
export { computeConfidence, applyHallucinationPenalty, DEFAULT_CONFIDENCE_CONFIG } from './confidence/ConfidenceEngine';
export { normalizeModelConfidence, normalizeTemperatureAdjusted, clampConfidence } from './confidence/ConfidenceNormalizer';
export { filterByThreshold, filterResults } from './confidence/ThresholdFilter';

// Evidence Layer (§4)
export type {
    Evidence,
    EvidenceSource,
    EvidenceChain,
    EvidenceExtractionConfig,
} from './evidence/types';
export { extractEvidence, extractEvidenceFromSegments, computeKeywordOverlap } from './evidence/EvidenceExtractor';
export { linkEvidence, mergeEvidenceChains, computeSupportStrength } from './evidence/EvidenceLinker';

// Timeline Event Bus (§5)
export type {
    SignalType,
    SignalSeverity,
    IntelligenceSignal,
    TimelineEntry,
    TimelineBatch,
    TimelineConfig,
} from './timeline/types';
export { IntelligenceEventBus } from './timeline/IntelligenceEventBus';
export { emitSignal, emitModePrediction } from './timeline/SignalEmitter';
export { TimelineManager } from './timeline/TimelineManager';

// Adaptive Mode — Shadow (§6)
export type {
    ModeConfidenceScore,
    ModePrediction,
    ShadowModeTelemetry,
    ModeClassifierConfig,
} from './adaptive/types';
export { classifyMode } from './adaptive/ModeClassifier';
export { ModeConfidenceEngine } from './adaptive/ModeConfidenceEngine';
export { ModePredictor } from './adaptive/ModePredictor';

// Multi-Brain (Phase 2 — §7)
export type {
    SubBrain,
    SubBrainInput,
    SubBrainInsight,
    SubBrainOutput,
    MergedInsightSet,
    SubBrainExecutionResult,
} from './multibrain/types';
export { SubBrainRegistry } from './multibrain/SubBrainRegistry';
export { ParallelExecutor } from './multibrain/ParallelExecutor';
export { OutputMerger } from './multibrain/OutputMerger';
export { createSubBrainRegistry } from './multibrain/createMultiBrainLayer';
export { MultiBrainTelemetry } from './multibrain/MultiBrainTelemetry';
export type { MultiBrainTelemetryRecord, MultiBrainStats } from './multibrain/MultiBrainTelemetry';

// Mode Memory (Phase 3 — §8)
export type {
    MemoryEntry,
    MemoryQuery,
    ScoredMemory,
    ModeMemory,
    MemoryMetadata,
} from './memory/types';
export { ModeMemoryManager } from './memory/ModeMemoryManager';
export { rankMemories, computeRecencyBoost, computeFinalScore } from './memory/MemoryRetriever';

// Explainability (Phase 3 — §9)
export type {
    Explanation,
    ExplanationFactor,
} from './explainability/types';
export { explain, explainAll } from './explainability/ExplainabilityEngine';
export { formatCompact, formatExpanded, formatAll } from './explainability/ExplanationFormatter';

// Intelligence IPC (Phase 4 — §10)
export type {
    AdaptiveModeSuggestionPayload,
    TimelineBatchPayload,
    TimelineSignalPayload,
    ExplanationPayload,
    ExplanationFactorPayload,
    PremiumUXMetadata,
} from './ipc/types';
export { AdaptiveModeIPC } from './ipc/AdaptiveModeIPC';
export { TimelineIPC } from './ipc/TimelineIPC';
export { ExplainabilityIPC } from './ipc/ExplainabilityIPC';
export { buildPremiumUXMetadata } from './ipc/PremiumUXMetadata';
