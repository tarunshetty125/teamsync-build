import type { ActionContract, ResponseOwnership } from '../overlay/actionContextTypes';
import type {
    ProviderRoutingEntry,
    ProviderRoutingReadModel,
    ProviderRoutingStatus,
} from '../providers/providerRoutingReadModel';
import { deriveValidationRepairPolicy, type ValidationRepairOutcome } from '../diagnostics/validationRepairPolicy';

export type InterviewQuestionCategory =
    | 'coding'
    | 'behavioral'
    | 'system_design'
    | 'resume_jd'
    | 'follow_up'
    | 'clarification'
    | 'general'
    | string;

export type InterviewDecisionBrainId =
    | 'coding'
    | 'behavioral'
    | 'system_design'
    | 'resume'
    | 'general'
    | 'sales'
    | 'lecture'
    | 'recruiting'
    | 'team_meeting'
    | 'looking_for_work'
    | 'screen_analysis'
    | string;

export type InterviewDecisionContextSection =
    | 'question'
    | 'transcript'
    | 'profile'
    | 'rag'
    | 'supplemental'
    | 'screen'
    | 'session_history'
    | 'previous_response'
    | 'action_contract'
    | 'mode_custom'
    | string;

export type InterviewDecisionPriorityLevel = 'critical' | 'high' | 'medium' | 'low' | 'ignore' | string;

export type InterviewDecisionValidationOutcome = 'valid' | 'warning' | 'invalid' | 'unknown';

export type InterviewStrategyPolicyType =
    | 'implementation_focused'
    | 'debugging_focused'
    | 'optimization_focused'
    | 'tradeoff_focused'
    | 'star_focused'
    | 'leadership_focused'
    | 'conflict_resolution_focused'
    | 'stakeholder_focused'
    | 'architecture_focused'
    | 'scalability_focused'
    | 'reliability_focused'
    | 'cloud_focused'
    | 'prioritization_focused'
    | 'product_sense_focused'
    | 'deployment_focused'
    | 'observability_focused'
    | 'incident_response_focused';

export type InterviewStrategyReasonCode =
    | 'category_alignment'
    | 'subcategory_alignment'
    | 'context_alignment'
    | 'interview_stage_alignment'
    | 'seniority_alignment'
    | 'difficulty_alignment';

export type InterviewDifficultyLevel = 'easy' | 'medium' | 'hard' | 'unknown' | string;

export type InterviewSeniorityLevel = 'junior' | 'mid' | 'senior' | 'staff' | 'leadership' | 'unknown' | string;

export type InterviewStage = 'screening' | 'technical_round' | 'onsite' | 'final_round' | 'manager_round' | 'unknown' | string;

export type InterviewContextSelectionReasonCode =
    | 'interview_relevance'
    | 'coding_relevance'
    | 'behavioral_relevance'
    | 'system_design_relevance'
    | 'follow_up_relevance'
    | 'personalization_relevance'
    | 'ownership_relevance'
    | 'validation_relevance'
    | 'diagram_relevance';

export type InterviewContextExclusionReasonCode =
    | 'lower_priority'
    | 'budget_trimmed'
    | 'duplicate_context'
    | 'irrelevant_to_category'
    | 'unavailable'
    | 'empty_source';

export type InterviewSubcategoryTag =
    | 'debugging'
    | 'optimization'
    | 'algorithms'
    | 'data_structures'
    | 'concurrency'
    | 'databases'
    | 'architecture'
    | 'scalability'
    | 'reliability'
    | 'distributed_systems'
    | 'cloud'
    | 'security'
    | 'behavioral_star'
    | 'behavioral_conflict'
    | 'behavioral_failure'
    | 'behavioral_success'
    | 'leadership'
    | 'mentorship'
    | 'stakeholder_management'
    | 'product_tradeoff'
    | 'prioritization'
    | 'product_sense'
    | 'deployment'
    | 'observability'
    | 'ci_cd'
    | 'incident_response'
    | 'cloud_architecture'
    | 'cloud_operations';

export type InterviewSubcategoryEvidenceSource =
    | 'classification_evidence'
    | 'explicit'
    | 'legacy_subcategory';

export interface InterviewSubcategoryEvidenceInput {
    tag?: string;
    evidenceIds?: string[];
    source?: string;
    confidence?: number;
}

export interface InterviewClassificationEvidenceInput {
    id?: string;
    signal?: string;
    type?: string;
    source?: string;
    category?: string;
    bucket?: string;
    confidence?: number;
    weight?: number;
    matched?: boolean;
}

export interface InterviewQuestionUnderstandingTraceInput {
    detectedCategory?: InterviewQuestionCategory;
    category?: InterviewQuestionCategory;
    detectedSubcategory?: string;
    subcategory?: string;
    confidence?: number;
    classificationSource?: string;
    source?: string;
    fallbackUsed?: boolean;
    evidence?: Array<InterviewClassificationEvidenceInput | string>;
    matchedSignals?: string[];
    subcategoryTags?: string[];
    subcategoryEvidence?: InterviewSubcategoryEvidenceInput[];
}

export interface InterviewTokenBudgetTraceInput {
    budgetName?: string;
    providerFamily?: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    estimatedInputTokens?: number;
    estimatedContextTokens?: number;
    selectedContextTokens?: number;
    omittedContextTokens?: number;
    truncated?: boolean;
    compressionApplied?: boolean;
    omittedAllContext?: boolean;
    trimmedSections?: InterviewDecisionContextSection[];
}

export interface InterviewContextReasonInput {
    source?: InterviewDecisionContextSection;
    section?: InterviewDecisionContextSection;
    reason?: string;
    evidenceIds?: string[];
    priority?: InterviewDecisionPriorityLevel;
    score?: number;
}

export interface InterviewContextPriorityRankingInput {
    source: InterviewDecisionContextSection;
    rank?: number;
    priorityScore?: number;
    priority?: InterviewDecisionPriorityLevel;
    rankingReason?: string;
}

export interface InterviewContextBudgetAllocationInput {
    source?: InterviewDecisionContextSection;
    section?: InterviewDecisionContextSection;
    allocatedTokens?: number;
    requestedTokens?: number;
    reason?: string;
}

export interface InterviewContextBudgetAllocationTraceInput {
    availableBudget?: number;
    allocatedBudget?: number;
    trimmedBudget?: number;
    allocationSummary?: string;
    allocations?: InterviewContextBudgetAllocationInput[];
}

export interface InterviewContextBudgetTrimInput {
    source?: InterviewDecisionContextSection;
    section?: InterviewDecisionContextSection;
    trimmedTokens?: number;
    reason?: string;
}

export interface InterviewContextBudgetTrimmingTraceInput {
    trimmedBudget?: number;
    trimmingReason?: string;
    trimmedSections?: InterviewDecisionContextSection[];
    trims?: InterviewContextBudgetTrimInput[];
}

export interface InterviewContextContributionInput {
    source?: InterviewDecisionContextSection;
    section?: InterviewDecisionContextSection;
    contributionCategory?: string;
    contributionReason?: string;
    selected?: boolean;
}

export interface InterviewContextSelectionTraceInput {
    selectedSections?: InterviewDecisionContextSection[];
    excludedSections?: InterviewDecisionContextSection[];
    availableSections?: InterviewDecisionContextSection[];
    contextPriorityOrdering?: InterviewDecisionContextSection[];
    priorityOrdering?: InterviewDecisionContextSection[];
    priorities?: Record<string, InterviewDecisionPriorityLevel | undefined>;
    excludedSources?: InterviewDecisionContextSection[];
    tokenBudget?: InterviewTokenBudgetTraceInput | null;
    selectionReasons?: InterviewContextReasonInput[];
    exclusionReasons?: InterviewContextReasonInput[];
    priorityRanking?: InterviewContextPriorityRankingInput[];
    budgetAllocation?: InterviewContextBudgetAllocationTraceInput | null;
    budgetTrimming?: InterviewContextBudgetTrimmingTraceInput | null;
    contributionMetadata?: InterviewContextContributionInput[];
}

export interface InterviewBrainCandidateInput {
    brain: InterviewDecisionBrainId;
    score?: number;
    reason?: string;
}

export interface InterviewBrainSelectionTraceInput {
    selectedBrain?: InterviewDecisionBrainId;
    brainId?: InterviewDecisionBrainId;
    candidateBrains?: Array<InterviewDecisionBrainId | InterviewBrainCandidateInput>;
    selectionReason?: string;
    reason?: string;
    forced?: boolean;
}

export interface InterviewReasoningPlanTraceInput {
    steps?: string[];
    planSteps?: string[];
    confidence?: number;
    matchedRuleIds?: string[];
    fallbackUsed?: boolean;
}

export interface InterviewStrategyTraceInput {
    responseProfile?: string;
    strategyType?: string;
    planningMode?: string;
    depth?: string;
    tone?: string;
    maxWords?: number;
    bulletRange?: [number, number];
    streamStrategy?: string;
    actionContract?: ActionContract | string;
    reasoningPlan?: InterviewReasoningPlanTraceInput | null;
}

export interface InterviewStrategySignalInput {
    value?: string;
    signal?: string;
    indicators?: string[];
    source?: string;
    confidence?: number;
}

export interface InterviewCandidateStrategyInput {
    strategyType?: string;
    strategy?: string;
    score?: number;
    selected?: boolean;
    selectionReason?: string;
    evidenceIds?: string[];
}

export interface InterviewStrategyReasonInput {
    reason?: string;
    evidenceIds?: string[];
    source?: string;
    score?: number;
}

export interface InterviewStrategyConfidenceMetadataInput {
    confidence?: number;
    source?: string;
    signalCount?: number;
    reasonCount?: number;
    candidateCount?: number;
}

export interface InterviewStrategyPolicyTraceInput {
    strategyType?: string;
    responseProfile?: string;
    planningMode?: string;
    difficultySignals?: InterviewStrategySignalInput[];
    inferredDifficulty?: string;
    complexityIndicators?: string[];
    challengeIndicators?: string[];
    senioritySignals?: InterviewStrategySignalInput[];
    inferredSeniority?: string;
    seniorityIndicators?: string[];
    interviewStageSignals?: InterviewStrategySignalInput[];
    inferredStage?: string;
    stageIndicators?: string[];
    strategyReasons?: InterviewStrategyReasonInput[];
    candidateStrategies?: InterviewCandidateStrategyInput[];
    selectedStrategy?: string;
    confidenceMetadata?: InterviewStrategyConfidenceMetadataInput | null;
}

export interface InterviewProviderDecisionTraceInput {
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    model?: string;
    routingReason?: string;
    status?: ProviderRoutingStatus | string;
    fallbackUsed?: boolean;
    remapped?: boolean;
    routeChanged?: boolean;
    fallbackChainLength?: number;
}

export interface InterviewValidationTraceInput {
    outcome?: InterviewDecisionValidationOutcome;
    valid?: boolean;
    contractOutcome?: string;
    actionContract?: ActionContract | string;
    repairApplied?: boolean;
    repairOutcome?: ValidationRepairOutcome | string;
    status?: string;
    warnings?: string[];
    issues?: string[];
}

export interface InterviewQualityFindingInput {
    ruleId?: string;
    code?: string;
    severity?: string;
    weight?: number;
}

export interface InterviewQualityEvaluationTraceInput {
    score?: number;
    confidence?: number;
    rulesChecked?: number;
    rulesPassed?: number;
    findings?: InterviewQualityFindingInput[];
    issues?: InterviewQualityFindingInput[];
    warnings?: string[];
    suggestionCount?: number;
}

export interface BuildInterviewDecisionTraceReadModelInput {
    responseId?: string;
    requestId?: string;
    questionTurnId?: string;
    actionId?: string;
    generatedAt?: number;
    ownership?: Partial<ResponseOwnership> | null;
    questionUnderstanding?: InterviewQuestionUnderstandingTraceInput | null;
    contextSelection?: InterviewContextSelectionTraceInput | null;
    brainSelection?: InterviewBrainSelectionTraceInput | null;
    strategy?: InterviewStrategyTraceInput | null;
    strategyPolicy?: InterviewStrategyPolicyTraceInput | null;
    providerDecision?: InterviewProviderDecisionTraceInput | null;
    providerRouting?: ProviderRoutingEntry | ProviderRoutingReadModel | null;
    validation?: InterviewValidationTraceInput | null;
    qualityEvaluation?: InterviewQualityEvaluationTraceInput | null;
}

export interface InterviewClassificationEvidence {
    id: string;
    type?: string;
    source?: string;
    category?: string;
    bucket?: string;
    confidence?: number;
    weight?: number;
    matched?: boolean;
}

export interface InterviewSubcategoryEvidence {
    tag: InterviewSubcategoryTag;
    evidenceIds: string[];
    source: InterviewSubcategoryEvidenceSource;
    confidence?: number;
}

export interface InterviewQuestionUnderstandingTrace {
    primaryCategory?: InterviewQuestionCategory;
    detectedCategory?: InterviewQuestionCategory;
    detectedSubcategory?: string;
    subcategoryTags: InterviewSubcategoryTag[];
    subcategoryEvidence: InterviewSubcategoryEvidence[];
    confidence?: number;
    classificationSource?: string;
    fallbackUsed: boolean;
    evidence: InterviewClassificationEvidence[];
    evidenceCount: number;
}

export interface InterviewTokenBudgetTrace {
    budgetName?: string;
    providerFamily?: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    estimatedInputTokens?: number;
    estimatedContextTokens?: number;
    selectedContextTokens?: number;
    omittedContextTokens?: number;
    truncated: boolean;
    compressionApplied: boolean;
    omittedAllContext: boolean;
    trimmedSections: InterviewDecisionContextSection[];
}

export interface InterviewContextSelectionReason {
    source: InterviewDecisionContextSection;
    reason: InterviewContextSelectionReasonCode;
    evidenceIds: string[];
    priority?: InterviewDecisionPriorityLevel;
    score?: number;
}

export interface InterviewContextExclusionReason {
    source: InterviewDecisionContextSection;
    reason: InterviewContextExclusionReasonCode;
    evidenceIds: string[];
    priority?: InterviewDecisionPriorityLevel;
    score?: number;
}

export interface InterviewContextPriorityRanking {
    rank: number;
    source: InterviewDecisionContextSection;
    priority?: InterviewDecisionPriorityLevel;
    priorityScore?: number;
    rankingReason?: string;
}

export interface InterviewContextBudgetAllocation {
    source: InterviewDecisionContextSection;
    allocatedTokens?: number;
    requestedTokens?: number;
    reason?: InterviewContextSelectionReasonCode;
}

export interface InterviewContextBudgetAllocationTrace {
    availableBudget?: number;
    allocatedBudget?: number;
    trimmedBudget?: number;
    allocationSummary: string;
    allocations: InterviewContextBudgetAllocation[];
}

export interface InterviewContextBudgetTrim {
    source: InterviewDecisionContextSection;
    trimmedTokens?: number;
    reason: InterviewContextExclusionReasonCode;
}

export interface InterviewContextBudgetTrimmingTrace {
    trimmedBudget?: number;
    trimmingReason: InterviewContextExclusionReasonCode | 'none';
    trimmedSections: InterviewDecisionContextSection[];
    trims: InterviewContextBudgetTrim[];
}

export interface InterviewContextContributionMetadata {
    source: InterviewDecisionContextSection;
    contributionCategory: string;
    contributionReason: InterviewContextSelectionReasonCode;
    selected: boolean;
}

export interface InterviewContextSelectionTrace {
    selectedSections: InterviewDecisionContextSection[];
    excludedSections: InterviewDecisionContextSection[];
    availableSections: InterviewDecisionContextSection[];
    contextPriorityOrdering: InterviewDecisionContextSection[];
    priorityBySource: Record<string, InterviewDecisionPriorityLevel>;
    tokenBudget: InterviewTokenBudgetTrace;
    selectionReasons: InterviewContextSelectionReason[];
    exclusionReasons: InterviewContextExclusionReason[];
    priorityRanking: InterviewContextPriorityRanking[];
    budgetAllocation: InterviewContextBudgetAllocationTrace;
    budgetTrimming: InterviewContextBudgetTrimmingTrace;
    contributionMetadata: InterviewContextContributionMetadata[];
}

export interface InterviewBrainCandidate {
    brain: InterviewDecisionBrainId;
    score?: number;
    reason?: string;
}

export interface InterviewBrainSelectionTrace {
    selectedBrain?: InterviewDecisionBrainId;
    candidateBrains: InterviewBrainCandidate[];
    selectionReason?: string;
    forced: boolean;
}

export interface InterviewReasoningSummaryTrace {
    planningMode?: string;
    steps: string[];
    stepCount: number;
    confidence?: number;
    matchedRuleIds: string[];
    fallbackUsed: boolean;
}

export interface InterviewStrategyTrace {
    responseProfile?: string;
    strategyType?: string;
    depth?: string;
    tone?: string;
    maxWords?: number;
    bulletRange?: [number, number];
    streamStrategy?: string;
    actionContract?: string;
    reasoningSummary: InterviewReasoningSummaryTrace;
}

export interface InterviewStrategySignalTrace {
    value?: string;
    indicators: string[];
    source?: string;
    confidence?: number;
}

export interface InterviewDifficultySignalsTrace {
    inferredDifficulty?: InterviewDifficultyLevel;
    complexityIndicators: string[];
    challengeIndicators: string[];
    signals: InterviewStrategySignalTrace[];
}

export interface InterviewSenioritySignalsTrace {
    inferredSeniority?: InterviewSeniorityLevel;
    indicators: string[];
    signals: InterviewStrategySignalTrace[];
}

export interface InterviewStageSignalsTrace {
    inferredStage?: InterviewStage;
    indicators: string[];
    signals: InterviewStrategySignalTrace[];
}

export interface InterviewStrategyReasonTrace {
    reason: InterviewStrategyReasonCode;
    evidenceIds: string[];
    source?: string;
    score?: number;
}

export interface InterviewCandidateStrategyTrace {
    strategyType: InterviewStrategyPolicyType;
    score?: number;
    selected: boolean;
    selectionReason?: InterviewStrategyReasonCode;
    evidenceIds: string[];
}

export interface InterviewStrategyConfidenceMetadataTrace {
    confidence?: number;
    source?: string;
    signalCount: number;
    reasonCount: number;
    candidateCount: number;
}

export interface InterviewStrategyPolicyTrace {
    strategyType?: InterviewStrategyPolicyType;
    responseProfile?: string;
    planningMode?: string;
    difficultySignals: InterviewDifficultySignalsTrace;
    senioritySignals: InterviewSenioritySignalsTrace;
    interviewStageSignals: InterviewStageSignalsTrace;
    strategyReasons: InterviewStrategyReasonTrace[];
    candidateStrategies: InterviewCandidateStrategyTrace[];
    selectedStrategy?: InterviewStrategyPolicyType;
    confidenceMetadata: InterviewStrategyConfidenceMetadataTrace;
}

export interface InterviewProviderDecisionTrace {
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    routingReason?: string;
    status: string;
    routeChanged: boolean;
    fallbackUsed: boolean;
    remapped: boolean;
    fallbackChainLength: number;
}

export interface InterviewValidationTrace {
    outcome: InterviewDecisionValidationOutcome;
    actionContract?: string;
    contractOutcome?: string;
    repairApplied: boolean;
    repairOutcome?: string;
    repairSeverity?: string;
    repairRecoverable?: boolean;
    warningCount: number;
    issueCount: number;
    warningCodes: string[];
    issueCodes: string[];
}

export interface InterviewQualityFinding {
    code: string;
    severity?: string;
    weight?: number;
}

export interface InterviewQualityEvaluationTrace {
    score?: number;
    confidence?: number;
    rulesChecked?: number;
    rulesPassed?: number;
    findingCount: number;
    warningCount: number;
    findings: InterviewQualityFinding[];
    warningCodes: string[];
}

export interface InterviewDecisionTraceSummary {
    hasQuestionUnderstanding: boolean;
    selectedContextCount: number;
    excludedContextCount: number;
    candidateBrainCount: number;
    hasFallback: boolean;
    hasRouteChange: boolean;
    hasValidationRepair: boolean;
    hasValidationIssues: boolean;
    hasQualityWarnings: boolean;
    privacyRedactionCount: number;
}

export interface InterviewDecisionTracePrivacy {
    metadataOnly: true;
    redactionCount: number;
    excludedFields: string[];
}

export interface InterviewDecisionTraceReadModel {
    generatedAt: number;
    responseId?: string;
    requestId?: string;
    questionTurnId?: string;
    actionId?: string;
    questionUnderstanding: InterviewQuestionUnderstandingTrace;
    contextSelection: InterviewContextSelectionTrace;
    brainSelection: InterviewBrainSelectionTrace;
    strategy: InterviewStrategyTrace;
    strategyPolicy: InterviewStrategyPolicyTrace;
    providerDecision: InterviewProviderDecisionTrace;
    validation: InterviewValidationTrace;
    qualityEvaluation: InterviewQualityEvaluationTrace;
    summary: InterviewDecisionTraceSummary;
    privacy: InterviewDecisionTracePrivacy;
}

const MAX_CODE_LENGTH = 96;
const LOCAL_PATH_PATTERN = /(?:\/(?:Users|home|private|var|tmp|Applications|Volumes)\/[^\s"'<>]+)|(?:[A-Za-z]:\\[^\s"'<>]+)/g;
const SUBCATEGORY_TAXONOMY_ORDER: InterviewSubcategoryTag[] = [
    'debugging',
    'optimization',
    'algorithms',
    'data_structures',
    'concurrency',
    'databases',
    'architecture',
    'scalability',
    'reliability',
    'distributed_systems',
    'cloud',
    'security',
    'behavioral_star',
    'behavioral_conflict',
    'behavioral_failure',
    'behavioral_success',
    'leadership',
    'mentorship',
    'stakeholder_management',
    'product_tradeoff',
    'prioritization',
    'product_sense',
    'deployment',
    'observability',
    'ci_cd',
    'incident_response',
    'cloud_architecture',
    'cloud_operations',
];
const SUBCATEGORY_TAXONOMY = new Set<InterviewSubcategoryTag>(SUBCATEGORY_TAXONOMY_ORDER);
const FORBIDDEN_FIELD_PATTERNS = [
    'responseText',
    'response_text',
    'generatedResponse',
    'transcript',
    'prompt',
    'rawPrompt',
    'providerPayload',
    'payload',
    'debugMetadata',
    'intelligenceMetadata',
    'markdown',
    'content',
    'screenshot',
    'screenshots',
    'image',
    'images',
    'artifact',
    'artifacts',
    'architectureJson',
    'architecturePayload',
    'diagramPayload',
    'parsedDiagram',
    'parsedArchitecture',
    'filesystem',
    'filePath',
    'path',
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clamp01(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function isForbiddenField(key: string): boolean {
    const normalized = key.toLowerCase();
    return FORBIDDEN_FIELD_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function sanitizeCode(value: unknown, fallback = 'unknown'): string {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return fallback;
    }

    const raw = String(value).replace(LOCAL_PATH_PATTERN, '[local-path-redacted]').trim();
    const normalized = raw
        .toLowerCase()
        .replace(/[^a-z0-9_.:-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return (normalized || fallback).slice(0, MAX_CODE_LENGTH);
}

function safeMetadataString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.replace(LOCAL_PATH_PATTERN, '[local-path-redacted]').trim();
    if (!trimmed) return undefined;
    if (trimmed.length > MAX_CODE_LENGTH) return sanitizeCode(trimmed);
    if (/\s/.test(trimmed) && !/^(mode:|source:|brain:)/i.test(trimmed)) {
        return sanitizeCode(trimmed);
    }
    return trimmed;
}

function uniqueStrings(values: unknown[] | undefined): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values ?? []) {
        const safe = safeMetadataString(value);
        if (!safe || seen.has(safe)) continue;
        seen.add(safe);
        result.push(safe);
    }
    return result;
}

function uniqueMetadataIndicators(values: unknown[] | undefined): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const [index, value] of (values ?? []).entries()) {
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
        const code = sanitizeCode(value, `indicator_${index}`);
        const safe = /\b(?:prompt|transcript|response[-_]?text|debug|payload|secret|filesystem|file[-_]?path|local[-_]?path)\b/.test(code)
            ? `redacted_indicator_${index}`
            : code;
        if (!safe || seen.has(safe)) continue;
        seen.add(safe);
        result.push(safe);
    }
    return result;
}

function countForbiddenFields(value: unknown): number {
    if (!isRecord(value)) return 0;
    let count = 0;
    for (const [key, child] of Object.entries(value)) {
        if (isForbiddenField(key)) {
            count += 1;
            continue;
        }
        if (Array.isArray(child)) {
            count += child.reduce((sum, item) => sum + countForbiddenFields(item), 0);
        } else if (isRecord(child)) {
            count += countForbiddenFields(child);
        }
    }
    return count;
}

function normalizeEvidenceString(value: string, index: number): InterviewClassificationEvidence {
    const id = /\s/.test(value) || value.length > MAX_CODE_LENGTH
        ? `redacted_evidence_${index}`
        : sanitizeCode(value, `evidence_${index}`);
    return { id };
}

function normalizeEvidenceObject(
    value: InterviewClassificationEvidenceInput,
    index: number,
): InterviewClassificationEvidence {
    const id = safeMetadataString(value.id)
        ?? safeMetadataString(value.signal)
        ?? `evidence_${index}`;

    return {
        id: sanitizeCode(id, `evidence_${index}`),
        type: safeMetadataString(value.type),
        source: safeMetadataString(value.source),
        category: safeMetadataString(value.category),
        bucket: safeMetadataString(value.bucket),
        confidence: clamp01(value.confidence),
        weight: finiteNumber(value.weight),
        matched: booleanValue(value.matched),
    };
}

function normalizeEvidence(
    questionUnderstanding?: InterviewQuestionUnderstandingTraceInput | null,
): InterviewClassificationEvidence[] {
    const evidence: InterviewClassificationEvidence[] = [];
    const inputEvidence = questionUnderstanding?.evidence ?? [];

    inputEvidence.forEach((item, index) => {
        if (typeof item === 'string') {
            evidence.push(normalizeEvidenceString(item, index));
            return;
        }
        if (isRecord(item)) {
            evidence.push(normalizeEvidenceObject(item, index));
        }
    });

    for (const signal of questionUnderstanding?.matchedSignals ?? []) {
        if (evidence.some((item) => item.id === signal)) continue;
        evidence.push({
            id: /\s/.test(signal) ? `redacted_signal_${evidence.length}` : sanitizeCode(signal, `signal_${evidence.length}`),
            source: 'matched_signal',
        });
    }

    return evidence.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeTagCode(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeSubcategoryTag(value: unknown): InterviewSubcategoryTag | undefined {
    const normalized = normalizeTagCode(value);
    const alias: Record<string, InterviewSubcategoryTag> = {
        algorithm: 'algorithms',
        algorithms: 'algorithms',
        data_structure: 'data_structures',
        data_structures: 'data_structures',
        database: 'databases',
        databases: 'databases',
        db: 'databases',
        star: 'behavioral_star',
        star_response: 'behavioral_star',
        behavioral_star: 'behavioral_star',
        conflict: 'behavioral_conflict',
        behavioral_conflict: 'behavioral_conflict',
        failure: 'behavioral_failure',
        behavioral_failure: 'behavioral_failure',
        success: 'behavioral_success',
        behavioral_success: 'behavioral_success',
        stakeholder: 'stakeholder_management',
        stakeholder_management: 'stakeholder_management',
        product: 'product_sense',
        product_sense: 'product_sense',
        product_tradeoff: 'product_tradeoff',
        product_tradeoffs: 'product_tradeoff',
        priority: 'prioritization',
        prioritization: 'prioritization',
        devops_deployment: 'deployment',
        deployment: 'deployment',
        monitoring: 'observability',
        observability: 'observability',
        ci: 'ci_cd',
        cd: 'ci_cd',
        ci_cd: 'ci_cd',
        cicd: 'ci_cd',
        incident: 'incident_response',
        incident_response: 'incident_response',
        cloud: 'cloud',
        cloud_architecture: 'cloud_architecture',
        cloud_operations: 'cloud_operations',
    };

    const tag = alias[normalized] ?? normalized;
    return SUBCATEGORY_TAXONOMY.has(tag as InterviewSubcategoryTag)
        ? tag as InterviewSubcategoryTag
        : undefined;
}

interface InterviewSubcategoryRule {
    tag: InterviewSubcategoryTag;
    primaryCategories?: InterviewQuestionCategory[];
    patterns: RegExp[];
}

const SUBCATEGORY_RULES: InterviewSubcategoryRule[] = [
    {
        tag: 'debugging',
        primaryCategories: ['coding'],
        patterns: [/\b(?:debug|bug|bugfix|fix|root[-_.:]?cause|broken|memory[-_.:]?leak)\b/],
    },
    {
        tag: 'optimization',
        primaryCategories: ['coding'],
        patterns: [/\b(?:optimi[sz](?:e|ation)?|performance|runtime|reduce[-_.:]?complexity)\b/],
    },
    {
        tag: 'algorithms',
        primaryCategories: ['coding'],
        patterns: [/\b(?:algorithm|dynamic[-_.:]?programming|binary[-_.:]?search|sliding[-_.:]?window|two[-_.:]?pointers|dfs|bfs|recursion|greedy|sorting)\b/],
    },
    {
        tag: 'data_structures',
        primaryCategories: ['coding'],
        patterns: [/\b(?:data[-_.:]?structure|structure|array|string|tree|graph|linked[-_.:]?list|heap|stack|queue|hash[-_.:]?map|trie|matrix)\b/],
    },
    {
        tag: 'concurrency',
        primaryCategories: ['coding'],
        patterns: [/\b(?:concurrency|thread|mutex|lock|race[-_.:]?condition|deadlock|async|parallel)\b/],
    },
    {
        tag: 'databases',
        primaryCategories: ['coding', 'system_design', 'general'],
        patterns: [/\b(?:database|sql|query|index|transaction|postgres|mysql|mongodb|schema)\b/],
    },
    {
        tag: 'architecture',
        primaryCategories: ['system_design'],
        patterns: [/\b(?:system[-_.:]?architecture|hld|lld|design[-_.:]?prompt|design[-_.:]?verb|high[-_.:]?level|low[-_.:]?level)\b/],
    },
    {
        tag: 'scalability',
        primaryCategories: ['system_design', 'general'],
        patterns: [/\b(?:scale|scalability|scalable|throughput|qps|rps|latency|traffic|capacity)\b/],
    },
    {
        tag: 'reliability',
        primaryCategories: ['system_design', 'general'],
        patterns: [/\b(?:reliability|availability|failure|failover|fault|resilien|retry|recovery|slo|sla|disaster[-_.:]?recovery)\b/],
    },
    {
        tag: 'distributed_systems',
        primaryCategories: ['system_design', 'general'],
        patterns: [/\b(?:distributed[-_.:]?systems?|distributed|microservice|event[-_.:]?driven|pub[-_.:]?sub|kafka|queue|replication|sharding|consistency|partition)\b/],
    },
    {
        tag: 'cloud',
        primaryCategories: ['system_design', 'general'],
        patterns: [/\b(?:cloud|aws|azure|gcp|lambda|s3|ec2|eks|ecs|bedrock|iam|vpc)\b/],
    },
    {
        tag: 'security',
        primaryCategories: ['system_design', 'general'],
        patterns: [/\b(?:security|auth|oauth|jwt|encryption|tls|privacy|threat|permission|rbac)\b/],
    },
    {
        tag: 'behavioral_star',
        primaryCategories: ['behavioral'],
        patterns: [/\b(?:behavioral[-_.:]?(?:time[-_.:]?story|prompt|star)|star|situation|task|action|result)\b/],
    },
    {
        tag: 'behavioral_conflict',
        primaryCategories: ['behavioral'],
        patterns: [/\b(?:conflict|challenge|difficult[-_.:]?teammate|disagree|disagreement)\b/],
    },
    {
        tag: 'behavioral_failure',
        primaryCategories: ['behavioral'],
        patterns: [/\b(?:failure|mistake|setback)\b/],
    },
    {
        tag: 'behavioral_success',
        primaryCategories: ['behavioral'],
        patterns: [/\b(?:success|achievement|impact|accomplishment|win|outcome|results?)\b/],
    },
    {
        tag: 'leadership',
        primaryCategories: ['behavioral'],
        patterns: [/\b(?:leadership|influence|leading|led|lead)\b/],
    },
    {
        tag: 'mentorship',
        primaryCategories: ['behavioral'],
        patterns: [/\b(?:mentor|mentorship|coaching|coach)\b/],
    },
    {
        tag: 'stakeholder_management',
        primaryCategories: ['behavioral', 'general'],
        patterns: [/\b(?:stakeholder[-_.:]?management|stakeholder|cross[-_.:]?functional|alignment|communication|buy[-_.:]?in)\b/],
    },
    {
        tag: 'product_tradeoff',
        primaryCategories: ['general', 'system_design'],
        patterns: [/\b(?:product[-_.:]?tradeoff|tradeoff|trade[-_.:]?off|user[-_.:]?impact|business[-_.:]?impact|metrics?)\b/],
    },
    {
        tag: 'prioritization',
        primaryCategories: ['general', 'system_design'],
        patterns: [/\b(?:prioriti[sz]ation|priority|roadmap|scope|mvp)\b/],
    },
    {
        tag: 'product_sense',
        primaryCategories: ['general', 'system_design'],
        patterns: [/\b(?:product[-_.:]?sense|product|customer|user[-_.:]?need|market|experiment)\b/],
    },
    {
        tag: 'deployment',
        primaryCategories: ['general', 'system_design'],
        patterns: [/\b(?:deployment|deploy|release|rollout|canary|blue[-_.:]?green|kubernetes|docker)\b/],
    },
    {
        tag: 'observability',
        primaryCategories: ['general', 'system_design'],
        patterns: [/\b(?:observability|monitoring|logging|metrics|tracing|alerts?|dashboard)\b/],
    },
    {
        tag: 'ci_cd',
        primaryCategories: ['general', 'system_design'],
        patterns: [/\b(?:ci[-_.:]?cd|cicd|pipeline|github[-_.:]?actions|jenkins|build|test[-_.:]?automation)\b/],
    },
    {
        tag: 'incident_response',
        primaryCategories: ['general', 'system_design'],
        patterns: [/\b(?:incident[-_.:]?response|incident|outage|postmortem|sev|rollback|oncall|runbook)\b/],
    },
    {
        tag: 'cloud_architecture',
        primaryCategories: ['system_design', 'general'],
        patterns: [/\b(?:cloud[-_.:]?architecture|aws[-_.:]?architecture|azure[-_.:]?architecture|gcp[-_.:]?architecture|multi[-_.:]?region|vpc|subnet)\b/],
    },
    {
        tag: 'cloud_operations',
        primaryCategories: ['system_design', 'general'],
        patterns: [/\b(?:cloud[-_.:]?operations|iam|autoscaling|auto[-_.:]?scaling|cost|permissions|capacity|service[-_.:]?limit)\b/],
    },
];

function evidenceSearchText(evidence: InterviewClassificationEvidence): string {
    return [
        evidence.id,
        evidence.type,
        evidence.source,
        evidence.category,
        evidence.bucket,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function mergeSubcategoryEvidence(
    map: Map<InterviewSubcategoryTag, InterviewSubcategoryEvidence>,
    tag: InterviewSubcategoryTag,
    evidenceIds: string[],
    source: InterviewSubcategoryEvidenceSource,
    confidence?: number,
): void {
    const existing = map.get(tag);
    if (!existing) {
        map.set(tag, {
            tag,
            evidenceIds: Array.from(new Set(evidenceIds)).sort(),
            source,
            confidence,
        });
        return;
    }

    existing.evidenceIds = Array.from(new Set([...existing.evidenceIds, ...evidenceIds])).sort();
    if (existing.source !== 'explicit' && source === 'explicit') {
        existing.source = 'explicit';
    }
    existing.confidence = Math.max(existing.confidence ?? 0, confidence ?? 0) || existing.confidence;
}

function deriveSubcategoryEvidence(
    input: InterviewQuestionUnderstandingTraceInput | null | undefined,
    evidence: InterviewClassificationEvidence[],
    primaryCategory: string | undefined,
): InterviewSubcategoryEvidence[] {
    const byTag = new Map<InterviewSubcategoryTag, InterviewSubcategoryEvidence>();

    for (const explicit of input?.subcategoryTags ?? []) {
        const tag = normalizeSubcategoryTag(explicit);
        if (tag) {
            mergeSubcategoryEvidence(byTag, tag, [], 'explicit');
        }
    }

    for (const explicit of input?.subcategoryEvidence ?? []) {
        const tag = normalizeSubcategoryTag(explicit.tag);
        if (!tag) continue;
        mergeSubcategoryEvidence(
            byTag,
            tag,
            uniqueStrings(explicit.evidenceIds),
            'explicit',
            clamp01(explicit.confidence),
        );
    }

    for (const legacy of [input?.detectedSubcategory, input?.subcategory]) {
        const tag = normalizeSubcategoryTag(legacy);
        if (tag) {
            mergeSubcategoryEvidence(byTag, tag, [], 'legacy_subcategory');
        }
    }

    for (const rule of SUBCATEGORY_RULES) {
        if (
            rule.primaryCategories
            && primaryCategory
            && !rule.primaryCategories.includes(primaryCategory)
        ) {
            continue;
        }
        const matchingEvidence = evidence
            .filter((item) => rule.patterns.some((pattern) => pattern.test(evidenceSearchText(item))))
            .map((item) => item.id);
        if (matchingEvidence.length > 0) {
            mergeSubcategoryEvidence(byTag, rule.tag, matchingEvidence, 'classification_evidence');
        }
    }

    return SUBCATEGORY_TAXONOMY_ORDER
        .map((tag) => byTag.get(tag))
        .filter((item): item is InterviewSubcategoryEvidence => Boolean(item));
}

function deriveSubcategory(category: string | undefined, evidence: InterviewClassificationEvidence[]): string | undefined {
    const evidenceIds = evidence.map((item) => item.id);
    const has = (needle: string) => evidenceIds.some((id) => id.includes(needle));

    if (category === 'coding') {
        if (has('bug') || has('debug')) return 'debugging';
        if (has('optimize') || has('optimization')) return 'optimization';
        if (has('complexity')) return 'complexity';
        if (has('algorithm')) return 'algorithm';
        if (has('implementation') || has('write-function') || has('problem-statement')) return 'implementation';
    }

    if (category === 'system_design') {
        if (has('infrastructure')) return 'infrastructure';
        if (has('scale')) return 'scalability';
        if (has('product')) return 'product_architecture';
        if (has('notification')) return 'messaging_architecture';
        return 'architecture';
    }

    if (category === 'behavioral') {
        if (has('leadership')) return 'leadership';
        if (has('failure')) return 'failure';
        if (has('challenge')) return 'conflict_or_challenge';
        if (has('soft-skills') || has('soft_skills')) return 'collaboration';
        return 'star_response';
    }

    if (category === 'resume_jd') return 'resume_alignment';
    return undefined;
}

function normalizeQuestionUnderstanding(
    input?: InterviewQuestionUnderstandingTraceInput | null,
): InterviewQuestionUnderstandingTrace {
    const evidence = normalizeEvidence(input);
    const category = safeMetadataString(input?.detectedCategory ?? input?.category);
    const explicitSubcategory = safeMetadataString(input?.detectedSubcategory ?? input?.subcategory);
    const subcategoryEvidence = deriveSubcategoryEvidence(input, evidence, category);
    const subcategoryTags = subcategoryEvidence.map((item) => item.tag);

    return {
        primaryCategory: category,
        detectedCategory: category,
        detectedSubcategory: explicitSubcategory ?? deriveSubcategory(category, evidence) ?? subcategoryTags[0],
        subcategoryTags,
        subcategoryEvidence,
        confidence: clamp01(input?.confidence),
        classificationSource: safeMetadataString(input?.classificationSource ?? input?.source),
        fallbackUsed: input?.fallbackUsed === true,
        evidence,
        evidenceCount: evidence.length,
    };
}

function normalizeSections(values: unknown[] | undefined): InterviewDecisionContextSection[] {
    return uniqueStrings(values) as InterviewDecisionContextSection[];
}

const PRIORITY_SCORE: Record<string, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    ignore: 0,
};

const SELECTION_REASON_ALIASES: Record<string, InterviewContextSelectionReasonCode> = {
    interview: 'interview_relevance',
    interview_relevance: 'interview_relevance',
    coding: 'coding_relevance',
    coding_relevance: 'coding_relevance',
    behavioral: 'behavioral_relevance',
    behavioral_relevance: 'behavioral_relevance',
    system_design: 'system_design_relevance',
    system_design_relevance: 'system_design_relevance',
    follow_up: 'follow_up_relevance',
    follow_up_relevance: 'follow_up_relevance',
    personalization: 'personalization_relevance',
    personalization_relevance: 'personalization_relevance',
    ownership: 'ownership_relevance',
    ownership_relevance: 'ownership_relevance',
    validation: 'validation_relevance',
    validation_relevance: 'validation_relevance',
    diagram: 'diagram_relevance',
    architecture: 'diagram_relevance',
    diagram_relevance: 'diagram_relevance',
};

const EXCLUSION_REASON_ALIASES: Record<string, InterviewContextExclusionReasonCode> = {
    lower_priority: 'lower_priority',
    budget_trimmed: 'budget_trimmed',
    duplicate_context: 'duplicate_context',
    duplicate: 'duplicate_context',
    irrelevant: 'irrelevant_to_category',
    irrelevant_to_category: 'irrelevant_to_category',
    unavailable: 'unavailable',
    empty: 'empty_source',
    empty_source: 'empty_source',
};

const CONTEXT_SOURCE_NAME_ALLOWLIST = new Set([
    'question',
    'transcript',
    'profile',
    'rag',
    'supplemental',
    'screen',
    'session_history',
    'previous_response',
    'action_contract',
    'mode_custom',
    'diagram',
    'architecture',
    'architecture_artifact',
]);

const STRATEGY_POLICY_ORDER: InterviewStrategyPolicyType[] = [
    'implementation_focused',
    'debugging_focused',
    'optimization_focused',
    'tradeoff_focused',
    'star_focused',
    'leadership_focused',
    'conflict_resolution_focused',
    'stakeholder_focused',
    'architecture_focused',
    'scalability_focused',
    'reliability_focused',
    'cloud_focused',
    'prioritization_focused',
    'product_sense_focused',
    'deployment_focused',
    'observability_focused',
    'incident_response_focused',
];

const STRATEGY_POLICY_SET = new Set<InterviewStrategyPolicyType>(STRATEGY_POLICY_ORDER);

const STRATEGY_POLICY_ALIASES: Record<string, InterviewStrategyPolicyType> = {
    implementation: 'implementation_focused',
    implementation_focused: 'implementation_focused',
    coding: 'implementation_focused',
    technical_interview: 'implementation_focused',
    debugging: 'debugging_focused',
    debug: 'debugging_focused',
    bugfix: 'debugging_focused',
    debugging_focused: 'debugging_focused',
    optimization: 'optimization_focused',
    optimize: 'optimization_focused',
    optimization_focused: 'optimization_focused',
    tradeoff: 'tradeoff_focused',
    tradeoffs: 'tradeoff_focused',
    trade_off: 'tradeoff_focused',
    tradeoff_focused: 'tradeoff_focused',
    star: 'star_focused',
    star_answer: 'star_focused',
    behavioral_star: 'star_focused',
    star_focused: 'star_focused',
    leadership: 'leadership_focused',
    leadership_focused: 'leadership_focused',
    conflict: 'conflict_resolution_focused',
    conflict_resolution: 'conflict_resolution_focused',
    conflict_resolution_focused: 'conflict_resolution_focused',
    stakeholder: 'stakeholder_focused',
    stakeholder_management: 'stakeholder_focused',
    stakeholder_focused: 'stakeholder_focused',
    architecture: 'architecture_focused',
    architecture_deep_dive: 'architecture_focused',
    architecture_focused: 'architecture_focused',
    scalability: 'scalability_focused',
    scalability_focused: 'scalability_focused',
    reliability: 'reliability_focused',
    reliability_focused: 'reliability_focused',
    cloud: 'cloud_focused',
    cloud_architecture: 'cloud_focused',
    cloud_operations: 'cloud_focused',
    cloud_focused: 'cloud_focused',
    prioritization: 'prioritization_focused',
    priority: 'prioritization_focused',
    prioritization_focused: 'prioritization_focused',
    product: 'product_sense_focused',
    product_sense: 'product_sense_focused',
    product_sense_focused: 'product_sense_focused',
    deployment: 'deployment_focused',
    deployment_focused: 'deployment_focused',
    observability: 'observability_focused',
    observability_focused: 'observability_focused',
    incident: 'incident_response_focused',
    incident_response: 'incident_response_focused',
    incident_response_focused: 'incident_response_focused',
};

const STRATEGY_REASON_ALIASES: Record<string, InterviewStrategyReasonCode> = {
    category: 'category_alignment',
    category_alignment: 'category_alignment',
    subcategory: 'subcategory_alignment',
    subcategory_alignment: 'subcategory_alignment',
    context: 'context_alignment',
    context_alignment: 'context_alignment',
    interview_stage: 'interview_stage_alignment',
    interview_stage_alignment: 'interview_stage_alignment',
    seniority: 'seniority_alignment',
    seniority_alignment: 'seniority_alignment',
    difficulty: 'difficulty_alignment',
    difficulty_alignment: 'difficulty_alignment',
};

function normalizeSelectionReason(value: unknown): InterviewContextSelectionReasonCode | undefined {
    const normalized = normalizeTagCode(value);
    return SELECTION_REASON_ALIASES[normalized];
}

function normalizeExclusionReason(value: unknown): InterviewContextExclusionReasonCode | undefined {
    const normalized = normalizeTagCode(value);
    return EXCLUSION_REASON_ALIASES[normalized];
}

function priorityScore(priority?: InterviewDecisionPriorityLevel): number | undefined {
    const normalized = safeMetadataString(priority);
    if (!normalized) return undefined;
    return PRIORITY_SCORE[normalized] ?? undefined;
}

function categorySelectionReason(
    questionUnderstanding?: InterviewQuestionUnderstandingTrace,
): InterviewContextSelectionReasonCode {
    switch (questionUnderstanding?.primaryCategory ?? questionUnderstanding?.detectedCategory) {
        case 'coding':
            return 'coding_relevance';
        case 'behavioral':
        case 'resume_jd':
            return 'behavioral_relevance';
        case 'system_design':
            return 'system_design_relevance';
        case 'follow_up':
        case 'clarification':
            return 'follow_up_relevance';
        default:
            return 'interview_relevance';
    }
}

function sourceSelectionReason(
    source: string,
    questionUnderstanding?: InterviewQuestionUnderstandingTrace,
): InterviewContextSelectionReasonCode {
    if (source === 'profile' || source === 'mode_custom') return 'personalization_relevance';
    if (source === 'previous_response' || source === 'session_history') return 'ownership_relevance';
    if (source === 'action_contract') return 'validation_relevance';
    if (source === 'diagram' || source === 'architecture' || source === 'architecture_artifact') return 'diagram_relevance';
    return categorySelectionReason(questionUnderstanding);
}

function sourceContributionCategory(source: string, questionUnderstanding?: InterviewQuestionUnderstandingTrace): string {
    if (source === 'profile' || source === 'mode_custom') return 'personalization';
    if (source === 'previous_response' || source === 'session_history') return 'ownership';
    if (source === 'action_contract') return 'validation';
    if (source === 'diagram' || source === 'architecture' || source === 'architecture_artifact') return 'diagram';
    return safeMetadataString(questionUnderstanding?.primaryCategory ?? questionUnderstanding?.detectedCategory) ?? 'interview';
}

function normalizeEvidenceIds(values: unknown[] | undefined): string[] {
    return uniqueStrings(values);
}

function normalizePriorityBySource(
    priorities?: Record<string, InterviewDecisionPriorityLevel | undefined>,
): Record<string, InterviewDecisionPriorityLevel> {
    const normalized: Record<string, InterviewDecisionPriorityLevel> = {};
    for (const [key, value] of Object.entries(priorities ?? {})) {
        const source = safeMetadataString(key);
        if (!source) continue;
        if (isForbiddenField(key) && !CONTEXT_SOURCE_NAME_ALLOWLIST.has(source)) continue;
        const priority = safeMetadataString(value);
        if (!priority) continue;
        normalized[source] = priority;
    }
    return Object.fromEntries(Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeTokenBudget(input?: InterviewTokenBudgetTraceInput | null): InterviewTokenBudgetTrace {
    return {
        budgetName: safeMetadataString(input?.budgetName),
        providerFamily: safeMetadataString(input?.providerFamily),
        maxInputTokens: finiteNumber(input?.maxInputTokens),
        maxOutputTokens: finiteNumber(input?.maxOutputTokens),
        estimatedInputTokens: finiteNumber(input?.estimatedInputTokens),
        estimatedContextTokens: finiteNumber(input?.estimatedContextTokens),
        selectedContextTokens: finiteNumber(input?.selectedContextTokens),
        omittedContextTokens: finiteNumber(input?.omittedContextTokens),
        truncated: input?.truncated === true,
        compressionApplied: input?.compressionApplied === true,
        omittedAllContext: input?.omittedAllContext === true,
        trimmedSections: normalizeSections(input?.trimmedSections),
    };
}

function reasonKey(source: string, reason: string): string {
    return `${source}:${reason}`;
}

function normalizeExplicitSelectionReasons(
    input?: InterviewContextReasonInput[],
): InterviewContextSelectionReason[] {
    const reasons: InterviewContextSelectionReason[] = [];
    for (const item of input ?? []) {
        const source = safeMetadataString(item.source ?? item.section);
        const reason = normalizeSelectionReason(item.reason);
        if (!source || !reason) continue;
        const entry: InterviewContextSelectionReason = {
            source,
            reason,
            evidenceIds: normalizeEvidenceIds(item.evidenceIds),
        };
        const priority = safeMetadataString(item.priority);
        const score = finiteNumber(item.score);
        if (priority !== undefined) entry.priority = priority;
        if (score !== undefined) entry.score = score;
        reasons.push(entry);
    }
    return reasons;
}

function normalizeExplicitExclusionReasons(
    input?: InterviewContextReasonInput[],
): InterviewContextExclusionReason[] {
    const reasons: InterviewContextExclusionReason[] = [];
    for (const item of input ?? []) {
        const source = safeMetadataString(item.source ?? item.section);
        const reason = normalizeExclusionReason(item.reason);
        if (!source || !reason) continue;
        const entry: InterviewContextExclusionReason = {
            source,
            reason,
            evidenceIds: normalizeEvidenceIds(item.evidenceIds),
        };
        const priority = safeMetadataString(item.priority);
        const score = finiteNumber(item.score);
        if (priority !== undefined) entry.priority = priority;
        if (score !== undefined) entry.score = score;
        reasons.push(entry);
    }
    return reasons;
}

function buildSelectionReasons(args: {
    input?: InterviewContextSelectionTraceInput | null;
    selectedSections: InterviewDecisionContextSection[];
    priorityBySource: Record<string, InterviewDecisionPriorityLevel>;
    questionUnderstanding?: InterviewQuestionUnderstandingTrace;
}): InterviewContextSelectionReason[] {
    const reasons = new Map<string, InterviewContextSelectionReason>();
    for (const explicit of normalizeExplicitSelectionReasons(args.input?.selectionReasons)) {
        reasons.set(reasonKey(explicit.source, explicit.reason), explicit);
    }

    for (const source of args.selectedSections) {
        const reason = sourceSelectionReason(source, args.questionUnderstanding);
        const entry: InterviewContextSelectionReason = {
            source,
            reason,
            evidenceIds: [],
        };
        const priority = args.priorityBySource[source];
        const score = priorityScore(priority);
        if (priority !== undefined) entry.priority = priority;
        if (score !== undefined) entry.score = score;
        reasons.set(reasonKey(source, reason), reasons.get(reasonKey(source, reason)) ?? entry);
    }

    return Array.from(reasons.values()).sort((left, right) => (
        left.source.localeCompare(right.source)
        || left.reason.localeCompare(right.reason)
    ));
}

function buildExclusionReasons(args: {
    input?: InterviewContextSelectionTraceInput | null;
    excludedSections: InterviewDecisionContextSection[];
    priorityBySource: Record<string, InterviewDecisionPriorityLevel>;
    tokenBudget: InterviewTokenBudgetTrace;
}): InterviewContextExclusionReason[] {
    const reasons = new Map<string, InterviewContextExclusionReason>();
    for (const explicit of normalizeExplicitExclusionReasons(args.input?.exclusionReasons)) {
        reasons.set(reasonKey(explicit.source, explicit.reason), explicit);
    }

    for (const source of args.excludedSections) {
        if (Array.from(reasons.values()).some((entry) => entry.source === source)) {
            continue;
        }
        const priority = args.priorityBySource[source];
        const reason = priority === 'ignore'
            ? 'irrelevant_to_category'
            : args.tokenBudget.trimmedSections.includes(source)
                ? 'budget_trimmed'
                : 'lower_priority';
        const entry: InterviewContextExclusionReason = {
            source,
            reason,
            evidenceIds: [],
        };
        const score = priorityScore(priority);
        if (priority !== undefined) entry.priority = priority;
        if (score !== undefined) entry.score = score;
        reasons.set(reasonKey(source, reason), reasons.get(reasonKey(source, reason)) ?? entry);
    }

    return Array.from(reasons.values()).sort((left, right) => (
        left.source.localeCompare(right.source)
        || left.reason.localeCompare(right.reason)
    ));
}

function normalizePriorityRankingInput(
    input?: InterviewContextPriorityRankingInput[],
): InterviewContextPriorityRanking[] {
    const ranking: InterviewContextPriorityRanking[] = [];
    (input ?? []).forEach((item, index) => {
        const source = safeMetadataString(item.source);
        if (!source) return;
        const priority = safeMetadataString(item.priority);
        const score = finiteNumber(item.priorityScore) ?? priorityScore(priority);
        const rankingReason = safeMetadataString(item.rankingReason);
        const entry: InterviewContextPriorityRanking = {
            rank: finiteNumber(item.rank) ?? index + 1,
            source,
        };
        if (priority !== undefined) entry.priority = priority;
        if (score !== undefined) entry.priorityScore = score;
        if (rankingReason !== undefined) entry.rankingReason = rankingReason;
        ranking.push(entry);
    });
    return ranking.sort((left, right) => left.rank - right.rank || left.source.localeCompare(right.source));
}

function buildPriorityRanking(args: {
    input?: InterviewContextSelectionTraceInput | null;
    contextPriorityOrdering: InterviewDecisionContextSection[];
    priorityBySource: Record<string, InterviewDecisionPriorityLevel>;
}): InterviewContextPriorityRanking[] {
    const explicit = normalizePriorityRankingInput(args.input?.priorityRanking);
    if (explicit.length > 0) {
        return explicit.map((item, index) => ({ ...item, rank: index + 1 }));
    }

    const sources = args.contextPriorityOrdering.length > 0
        ? args.contextPriorityOrdering
        : Object.keys(args.priorityBySource).sort((left, right) => (
            (priorityScore(args.priorityBySource[right]) ?? -1) - (priorityScore(args.priorityBySource[left]) ?? -1)
            || left.localeCompare(right)
        ));

    return sources.map((source, index) => {
        const priority = args.priorityBySource[source];
        const score = priorityScore(priority);
        const entry: InterviewContextPriorityRanking = {
            rank: index + 1,
            source,
        };
        if (priority !== undefined) entry.priority = priority;
        if (score !== undefined) entry.priorityScore = score;
        entry.rankingReason = priority ? `${safeMetadataString(priority)}_priority` : 'explicit_order';
        return entry;
    });
}

function normalizeBudgetAllocation(args: {
    input?: InterviewContextBudgetAllocationTraceInput | null;
    selectedSections: InterviewDecisionContextSection[];
    tokenBudget: InterviewTokenBudgetTrace;
    questionUnderstanding?: InterviewQuestionUnderstandingTrace;
}): InterviewContextBudgetAllocationTrace {
    const explicitAllocations: InterviewContextBudgetAllocation[] = [];
    for (const item of args.input?.allocations ?? []) {
        const source = safeMetadataString(item.source ?? item.section);
        if (!source) continue;
        const allocatedTokens = finiteNumber(item.allocatedTokens);
        const requestedTokens = finiteNumber(item.requestedTokens);
        const entry: InterviewContextBudgetAllocation = {
            source,
            reason: normalizeSelectionReason(item.reason) ?? sourceSelectionReason(source, args.questionUnderstanding),
        };
        if (allocatedTokens !== undefined) entry.allocatedTokens = allocatedTokens;
        if (requestedTokens !== undefined) entry.requestedTokens = requestedTokens;
        explicitAllocations.push(entry);
    }
    const allocations = explicitAllocations.length > 0
        ? explicitAllocations
        : args.selectedSections.map((source) => ({
            source,
            reason: sourceSelectionReason(source, args.questionUnderstanding),
        }));
    const availableBudget = finiteNumber(args.input?.availableBudget) ?? args.tokenBudget.maxInputTokens;
    const allocatedBudget = finiteNumber(args.input?.allocatedBudget) ?? args.tokenBudget.selectedContextTokens;
    const trimmedBudget = finiteNumber(args.input?.trimmedBudget) ?? args.tokenBudget.omittedContextTokens;
    const allocationSummary = safeMetadataString(args.input?.allocationSummary)
        ?? (args.tokenBudget.omittedAllContext
            ? 'context_omitted'
            : args.tokenBudget.truncated || (trimmedBudget ?? 0) > 0
                ? 'context_trimmed'
                : allocations.length > 0
                    ? 'context_allocated'
                    : 'no_context_selected');

    return {
        availableBudget,
        allocatedBudget,
        trimmedBudget,
        allocationSummary,
        allocations: allocations.sort((left, right) => left.source.localeCompare(right.source)),
    };
}

function normalizeBudgetTrimming(args: {
    input?: InterviewContextBudgetTrimmingTraceInput | null;
    tokenBudget: InterviewTokenBudgetTrace;
}): InterviewContextBudgetTrimmingTrace {
    const explicitTrims: InterviewContextBudgetTrim[] = [];
    for (const item of args.input?.trims ?? []) {
        const source = safeMetadataString(item.source ?? item.section);
        if (!source) continue;
        const trimmedTokens = finiteNumber(item.trimmedTokens);
        const entry: InterviewContextBudgetTrim = {
            source,
            reason: normalizeExclusionReason(item.reason) ?? 'budget_trimmed',
        };
        if (trimmedTokens !== undefined) entry.trimmedTokens = trimmedTokens;
        explicitTrims.push(entry);
    }
    const trimmedSections = normalizeSections([
        ...(args.input?.trimmedSections ?? []),
        ...args.tokenBudget.trimmedSections,
    ]);
    const trims = explicitTrims.length > 0
        ? explicitTrims
        : trimmedSections.map((source) => ({ source, reason: 'budget_trimmed' as const }));
    const trimmedBudget = finiteNumber(args.input?.trimmedBudget) ?? args.tokenBudget.omittedContextTokens;
    const trimmingReason = normalizeExclusionReason(args.input?.trimmingReason)
        ?? (args.tokenBudget.truncated || args.tokenBudget.omittedAllContext || trims.length > 0 || (trimmedBudget ?? 0) > 0
            ? 'budget_trimmed'
            : 'none');

    return {
        trimmedBudget,
        trimmingReason,
        trimmedSections,
        trims: trims.sort((left, right) => left.source.localeCompare(right.source)),
    };
}

function normalizeContributionMetadata(args: {
    input?: InterviewContextContributionInput[];
    selectedSections: InterviewDecisionContextSection[];
    questionUnderstanding?: InterviewQuestionUnderstandingTrace;
}): InterviewContextContributionMetadata[] {
    const contributions = new Map<string, InterviewContextContributionMetadata>();
    for (const item of args.input ?? []) {
        const source = safeMetadataString(item.source ?? item.section);
        if (!source) continue;
        contributions.set(source, {
            source,
            contributionCategory: safeMetadataString(item.contributionCategory) ?? sourceContributionCategory(source, args.questionUnderstanding),
            contributionReason: normalizeSelectionReason(item.contributionReason) ?? sourceSelectionReason(source, args.questionUnderstanding),
            selected: item.selected !== false,
        });
    }

    for (const source of args.selectedSections) {
        if (contributions.has(source)) continue;
        contributions.set(source, {
            source,
            contributionCategory: sourceContributionCategory(source, args.questionUnderstanding),
            contributionReason: sourceSelectionReason(source, args.questionUnderstanding),
            selected: true,
        });
    }

    return Array.from(contributions.values()).sort((left, right) => left.source.localeCompare(right.source));
}

function normalizeContextSelection(
    input?: InterviewContextSelectionTraceInput | null,
    questionUnderstanding?: InterviewQuestionUnderstandingTrace,
): InterviewContextSelectionTrace {
    const priorityBySource = normalizePriorityBySource(input?.priorities);
    const priorityIgnoredSections = Object.entries(priorityBySource)
        .filter(([, priority]) => priority === 'ignore')
        .map(([source]) => source);
    const selectedFromPriority = Object.entries(priorityBySource)
        .filter(([, priority]) => priority !== 'ignore')
        .map(([source]) => source);

    const selectedSections = normalizeSections(input?.selectedSections ?? selectedFromPriority);
    const explicitExcluded = [
        ...(input?.excludedSections ?? []),
        ...(input?.excludedSources ?? []),
        ...priorityIgnoredSections,
    ];
    const excludedSections = normalizeSections(explicitExcluded);
    const availableSections = normalizeSections(input?.availableSections);
    const contextPriorityOrdering = normalizeSections(input?.contextPriorityOrdering ?? input?.priorityOrdering);
    const tokenBudget = normalizeTokenBudget(input?.tokenBudget);
    const selectionReasons = buildSelectionReasons({
        input,
        selectedSections,
        priorityBySource,
        questionUnderstanding,
    });
    const exclusionReasons = buildExclusionReasons({
        input,
        excludedSections,
        priorityBySource,
        tokenBudget,
    });
    const priorityRanking = buildPriorityRanking({
        input,
        contextPriorityOrdering,
        priorityBySource,
    });
    const budgetAllocation = normalizeBudgetAllocation({
        input: input?.budgetAllocation,
        selectedSections,
        tokenBudget,
        questionUnderstanding,
    });
    const budgetTrimming = normalizeBudgetTrimming({
        input: input?.budgetTrimming,
        tokenBudget,
    });
    const contributionMetadata = normalizeContributionMetadata({
        input: input?.contributionMetadata,
        selectedSections,
        questionUnderstanding,
    });

    return {
        selectedSections,
        excludedSections,
        availableSections,
        contextPriorityOrdering,
        priorityBySource,
        tokenBudget,
        selectionReasons,
        exclusionReasons,
        priorityRanking,
        budgetAllocation,
        budgetTrimming,
        contributionMetadata,
    };
}

function normalizeBrainCandidate(
    value: InterviewDecisionBrainId | InterviewBrainCandidateInput,
    index: number,
): InterviewBrainCandidate | null {
    if (typeof value === 'string') {
        const brain = safeMetadataString(value);
        return brain ? { brain } : null;
    }
    if (!isRecord(value)) return null;
    const brain = safeMetadataString(value.brain) ?? `candidate_${index}`;
    return {
        brain,
        score: finiteNumber(value.score),
        reason: safeMetadataString(value.reason),
    };
}

function normalizeBrainSelection(input?: InterviewBrainSelectionTraceInput | null): InterviewBrainSelectionTrace {
    const selectedBrain = safeMetadataString(input?.selectedBrain ?? input?.brainId);
    const candidates = (input?.candidateBrains ?? [])
        .map(normalizeBrainCandidate)
        .filter((candidate): candidate is InterviewBrainCandidate => Boolean(candidate));

    if (selectedBrain && !candidates.some((candidate) => candidate.brain === selectedBrain)) {
        candidates.unshift({ brain: selectedBrain, reason: 'selected' });
    }

    return {
        selectedBrain,
        candidateBrains: candidates.sort((left, right) => left.brain.localeCompare(right.brain)),
        selectionReason: safeMetadataString(input?.selectionReason ?? input?.reason),
        forced: input?.forced === true,
    };
}

function normalizeReasoningSummary(
    strategy?: InterviewStrategyTraceInput | null,
): InterviewReasoningSummaryTrace {
    const plan = strategy?.reasoningPlan;
    const steps = uniqueStrings(plan?.steps ?? plan?.planSteps);
    const matchedRuleIds = uniqueStrings(plan?.matchedRuleIds);

    return {
        planningMode: safeMetadataString(strategy?.planningMode),
        steps,
        stepCount: steps.length,
        confidence: clamp01(plan?.confidence),
        matchedRuleIds,
        fallbackUsed: plan?.fallbackUsed === true,
    };
}

function normalizeStrategy(input?: InterviewStrategyTraceInput | null): InterviewStrategyTrace {
    return {
        responseProfile: safeMetadataString(input?.responseProfile),
        strategyType: safeMetadataString(input?.strategyType),
        depth: safeMetadataString(input?.depth),
        tone: safeMetadataString(input?.tone),
        maxWords: finiteNumber(input?.maxWords),
        bulletRange: Array.isArray(input?.bulletRange) && input.bulletRange.length === 2
            ? [Number(input.bulletRange[0]), Number(input.bulletRange[1])]
            : undefined,
        streamStrategy: safeMetadataString(input?.streamStrategy),
        actionContract: safeMetadataString(input?.actionContract),
        reasoningSummary: normalizeReasoningSummary(input),
    };
}

function normalizeStrategyPolicyType(value: unknown): InterviewStrategyPolicyType | undefined {
    const normalized = normalizeTagCode(value);
    const aliased = STRATEGY_POLICY_ALIASES[normalized] ?? normalized;
    return STRATEGY_POLICY_SET.has(aliased as InterviewStrategyPolicyType)
        ? aliased as InterviewStrategyPolicyType
        : undefined;
}

function normalizeStrategyReason(value: unknown): InterviewStrategyReasonCode | undefined {
    const normalized = normalizeTagCode(value);
    return STRATEGY_REASON_ALIASES[normalized];
}

function categoryDefaultStrategy(category?: string): InterviewStrategyPolicyType | undefined {
    switch (category) {
        case 'coding':
            return 'implementation_focused';
        case 'behavioral':
        case 'resume_jd':
            return 'star_focused';
        case 'system_design':
            return 'architecture_focused';
        default:
            return undefined;
    }
}

function strategyFromSubcategoryTag(tag: InterviewSubcategoryTag): InterviewStrategyPolicyType | undefined {
    switch (tag) {
        case 'debugging':
            return 'debugging_focused';
        case 'optimization':
            return 'optimization_focused';
        case 'algorithms':
        case 'data_structures':
        case 'concurrency':
        case 'databases':
            return 'implementation_focused';
        case 'product_tradeoff':
            return 'tradeoff_focused';
        case 'prioritization':
            return 'prioritization_focused';
        case 'product_sense':
            return 'product_sense_focused';
        case 'leadership':
        case 'mentorship':
            return 'leadership_focused';
        case 'behavioral_conflict':
            return 'conflict_resolution_focused';
        case 'stakeholder_management':
            return 'stakeholder_focused';
        case 'behavioral_star':
        case 'behavioral_failure':
        case 'behavioral_success':
            return 'star_focused';
        case 'cloud':
        case 'cloud_architecture':
        case 'cloud_operations':
            return 'cloud_focused';
        case 'reliability':
            return 'reliability_focused';
        case 'scalability':
        case 'distributed_systems':
            return 'scalability_focused';
        case 'architecture':
        case 'security':
            return 'architecture_focused';
        case 'deployment':
        case 'ci_cd':
            return 'deployment_focused';
        case 'observability':
            return 'observability_focused';
        case 'incident_response':
            return 'incident_response_focused';
        default:
            return undefined;
    }
}

function uniqueStrategyTypes(values: Array<InterviewStrategyPolicyType | undefined>): InterviewStrategyPolicyType[] {
    const seen = new Set<InterviewStrategyPolicyType>();
    const result: InterviewStrategyPolicyType[] = [];
    for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result.sort((left, right) => STRATEGY_POLICY_ORDER.indexOf(left) - STRATEGY_POLICY_ORDER.indexOf(right));
}

function strategyCandidatesFromQuestion(
    questionUnderstanding: InterviewQuestionUnderstandingTrace,
): InterviewStrategyPolicyType[] {
    const fromTags = questionUnderstanding.subcategoryTags.map(strategyFromSubcategoryTag);
    const fallback = categoryDefaultStrategy(questionUnderstanding.primaryCategory ?? questionUnderstanding.detectedCategory);
    return uniqueStrategyTypes([...fromTags, fallback]);
}

function selectedStrategyFromQuestion(
    questionUnderstanding: InterviewQuestionUnderstandingTrace,
): InterviewStrategyPolicyType | undefined {
    const seen = new Set<InterviewStrategyPolicyType>();
    for (const tag of questionUnderstanding.subcategoryTags) {
        const strategy = strategyFromSubcategoryTag(tag);
        if (!strategy || seen.has(strategy)) continue;
        return strategy;
    }
    return categoryDefaultStrategy(questionUnderstanding.primaryCategory ?? questionUnderstanding.detectedCategory);
}

function selectedStrategyFromInputs(args: {
    input?: InterviewStrategyPolicyTraceInput | null;
    strategy: InterviewStrategyTrace;
    questionUnderstanding: InterviewQuestionUnderstandingTrace;
}): InterviewStrategyPolicyType | undefined {
    const selectedCandidate = (args.input?.candidateStrategies ?? [])
        .find((candidate) => candidate.selected === true);
    return normalizeStrategyPolicyType(args.input?.selectedStrategy)
        ?? normalizeStrategyPolicyType(selectedCandidate?.strategyType ?? selectedCandidate?.strategy)
        ?? selectedStrategyFromQuestion(args.questionUnderstanding)
        ?? normalizeStrategyPolicyType(args.input?.strategyType)
        ?? normalizeStrategyPolicyType(args.strategy.strategyType)
        ?? strategyCandidatesFromQuestion(args.questionUnderstanding)[0];
}

function normalizeStrategySignal(input: InterviewStrategySignalInput | undefined): InterviewStrategySignalTrace | undefined {
    if (!input) return undefined;
    const value = safeMetadataString(input.value ?? input.signal);
    const indicators = uniqueMetadataIndicators(input.indicators);
    const source = safeMetadataString(input.source);
    const confidence = clamp01(input.confidence);
    if (!value && indicators.length === 0 && !source && confidence === undefined) return undefined;

    const trace: InterviewStrategySignalTrace = {
        indicators,
    };
    if (value !== undefined) trace.value = value;
    if (source !== undefined) trace.source = source;
    if (confidence !== undefined) trace.confidence = confidence;
    return trace;
}

function normalizeStrategySignals(inputs?: InterviewStrategySignalInput[]): InterviewStrategySignalTrace[] {
    return (inputs ?? [])
        .map(normalizeStrategySignal)
        .filter((item): item is InterviewStrategySignalTrace => Boolean(item))
        .sort((left, right) => (
            (left.value ?? '').localeCompare(right.value ?? '')
            || (left.source ?? '').localeCompare(right.source ?? '')
        ));
}

function difficultyFromDepth(depth?: string): InterviewDifficultyLevel | undefined {
    switch (safeMetadataString(depth)) {
        case 'short':
        case 'light':
            return 'easy';
        case 'medium':
        case 'balanced':
            return 'medium';
        case 'deep':
        case 'detailed':
            return 'hard';
        default:
            return undefined;
    }
}

function difficultyIndicatorsFromStrategy(strategy: InterviewStrategyTrace): string[] {
    return uniqueMetadataIndicators(strategy.reasoningSummary.steps.filter((step) => (
        step.includes('complexity')
        || step.includes('scale')
        || step.includes('failure')
        || step.includes('tradeoff')
        || step.includes('optimization')
    )));
}

function challengeIndicatorsFromQuestion(questionUnderstanding: InterviewQuestionUnderstandingTrace): string[] {
    return uniqueMetadataIndicators(questionUnderstanding.subcategoryTags.filter((tag) => [
        'debugging',
        'optimization',
        'concurrency',
        'reliability',
        'distributed_systems',
        'cloud',
        'cloud_architecture',
        'cloud_operations',
        'incident_response',
        'security',
    ].includes(tag)));
}

function normalizeDifficultySignals(args: {
    input?: InterviewStrategyPolicyTraceInput | null;
    strategy: InterviewStrategyTrace;
    questionUnderstanding: InterviewQuestionUnderstandingTrace;
}): InterviewDifficultySignalsTrace {
    const inferredDifficulty = safeMetadataString(args.input?.inferredDifficulty)
        ?? difficultyFromDepth(args.strategy.depth);
    const complexityIndicators = uniqueMetadataIndicators([
        ...(args.input?.complexityIndicators ?? []),
        ...difficultyIndicatorsFromStrategy(args.strategy),
    ]);
    const challengeIndicators = uniqueMetadataIndicators([
        ...(args.input?.challengeIndicators ?? []),
        ...challengeIndicatorsFromQuestion(args.questionUnderstanding),
    ]);
    const signals = normalizeStrategySignals(args.input?.difficultySignals);
    if (signals.length === 0 && (inferredDifficulty || complexityIndicators.length > 0 || challengeIndicators.length > 0)) {
        const derived: InterviewStrategySignalTrace = {
            indicators: uniqueMetadataIndicators([...complexityIndicators, ...challengeIndicators]),
            source: 'strategy_metadata',
        };
        if (inferredDifficulty !== undefined) derived.value = inferredDifficulty;
        signals.push(derived);
    }

    const trace: InterviewDifficultySignalsTrace = {
        complexityIndicators,
        challengeIndicators,
        signals,
    };
    if (inferredDifficulty !== undefined) trace.inferredDifficulty = inferredDifficulty;
    return trace;
}

function inferredSeniorityFromQuestion(questionUnderstanding: InterviewQuestionUnderstandingTrace): InterviewSeniorityLevel | undefined {
    const tags = new Set(questionUnderstanding.subcategoryTags);
    if (tags.has('leadership') || tags.has('stakeholder_management')) return 'leadership';
    if (tags.has('distributed_systems') || tags.has('cloud_architecture') || tags.has('reliability')) return 'staff';
    if ((questionUnderstanding.primaryCategory ?? questionUnderstanding.detectedCategory) === 'system_design') return 'senior';
    return undefined;
}

function seniorityIndicatorsFromQuestion(questionUnderstanding: InterviewQuestionUnderstandingTrace): string[] {
    return uniqueMetadataIndicators(questionUnderstanding.subcategoryTags.filter((tag) => [
        'leadership',
        'mentorship',
        'stakeholder_management',
        'distributed_systems',
        'reliability',
        'cloud_architecture',
        'cloud_operations',
    ].includes(tag)));
}

function normalizeSenioritySignals(args: {
    input?: InterviewStrategyPolicyTraceInput | null;
    questionUnderstanding: InterviewQuestionUnderstandingTrace;
}): InterviewSenioritySignalsTrace {
    const inferredSeniority = safeMetadataString(args.input?.inferredSeniority)
        ?? inferredSeniorityFromQuestion(args.questionUnderstanding);
    const indicators = uniqueMetadataIndicators([
        ...(args.input?.seniorityIndicators ?? []),
        ...seniorityIndicatorsFromQuestion(args.questionUnderstanding),
    ]);
    const signals = normalizeStrategySignals(args.input?.senioritySignals);
    if (signals.length === 0 && (inferredSeniority || indicators.length > 0)) {
        const derived: InterviewStrategySignalTrace = {
            indicators,
            source: 'classification_metadata',
        };
        if (inferredSeniority !== undefined) derived.value = inferredSeniority;
        signals.push(derived);
    }

    const trace: InterviewSenioritySignalsTrace = {
        indicators,
        signals,
    };
    if (inferredSeniority !== undefined) trace.inferredSeniority = inferredSeniority;
    return trace;
}

function inferredStageFromQuestion(questionUnderstanding: InterviewQuestionUnderstandingTrace): InterviewStage | undefined {
    switch (questionUnderstanding.primaryCategory ?? questionUnderstanding.detectedCategory) {
        case 'coding':
        case 'system_design':
            return 'technical_round';
        case 'behavioral':
        case 'resume_jd':
            return 'screening';
        default:
            return undefined;
    }
}

function stageIndicatorsFromQuestion(questionUnderstanding: InterviewQuestionUnderstandingTrace): string[] {
    const category = questionUnderstanding.primaryCategory ?? questionUnderstanding.detectedCategory;
    return category ? [`category:${category}`] : [];
}

function normalizeInterviewStageSignals(args: {
    input?: InterviewStrategyPolicyTraceInput | null;
    questionUnderstanding: InterviewQuestionUnderstandingTrace;
}): InterviewStageSignalsTrace {
    const inferredStage = safeMetadataString(args.input?.inferredStage)
        ?? inferredStageFromQuestion(args.questionUnderstanding);
    const indicators = uniqueMetadataIndicators([
        ...(args.input?.stageIndicators ?? []),
        ...stageIndicatorsFromQuestion(args.questionUnderstanding),
    ]);
    const signals = normalizeStrategySignals(args.input?.interviewStageSignals);
    if (signals.length === 0 && (inferredStage || indicators.length > 0)) {
        const derived: InterviewStrategySignalTrace = {
            indicators,
            source: 'category_metadata',
        };
        if (inferredStage !== undefined) derived.value = inferredStage;
        signals.push(derived);
    }

    const trace: InterviewStageSignalsTrace = {
        indicators,
        signals,
    };
    if (inferredStage !== undefined) trace.inferredStage = inferredStage;
    return trace;
}

function normalizeExplicitStrategyReasons(
    input?: InterviewStrategyReasonInput[],
): InterviewStrategyReasonTrace[] {
    const reasons: InterviewStrategyReasonTrace[] = [];
    for (const item of input ?? []) {
        const reason = normalizeStrategyReason(item.reason);
        if (!reason) continue;
        const entry: InterviewStrategyReasonTrace = {
            reason,
            evidenceIds: normalizeEvidenceIds(item.evidenceIds),
        };
        const source = safeMetadataString(item.source);
        const score = finiteNumber(item.score);
        if (source !== undefined) entry.source = source;
        if (score !== undefined) entry.score = score;
        reasons.push(entry);
    }
    return reasons;
}

function buildStrategyReasons(args: {
    input?: InterviewStrategyPolicyTraceInput | null;
    questionUnderstanding: InterviewQuestionUnderstandingTrace;
    contextSelection: InterviewContextSelectionTrace;
    difficultySignals: InterviewDifficultySignalsTrace;
    senioritySignals: InterviewSenioritySignalsTrace;
    interviewStageSignals: InterviewStageSignalsTrace;
}): InterviewStrategyReasonTrace[] {
    const byReason = new Map<InterviewStrategyReasonCode, InterviewStrategyReasonTrace>();
    for (const explicit of normalizeExplicitStrategyReasons(args.input?.strategyReasons)) {
        byReason.set(explicit.reason, explicit);
    }

    const add = (reason: InterviewStrategyReasonCode, evidenceIds: string[], source: string): void => {
        if (byReason.has(reason)) return;
        byReason.set(reason, {
            reason,
            evidenceIds: uniqueStrings(evidenceIds),
            source,
        });
    };

    if (args.questionUnderstanding.primaryCategory ?? args.questionUnderstanding.detectedCategory) {
        add('category_alignment', [], 'classification_metadata');
    }
    if (args.questionUnderstanding.subcategoryTags.length > 0) {
        add(
            'subcategory_alignment',
            args.questionUnderstanding.subcategoryEvidence.flatMap((item) => item.evidenceIds),
            'subcategory_metadata',
        );
    }
    if (args.contextSelection.selectionReasons.length > 0) {
        add(
            'context_alignment',
            args.contextSelection.selectionReasons.flatMap((item) => item.evidenceIds),
            'context_selection_metadata',
        );
    }
    if (
        args.difficultySignals.inferredDifficulty
        || args.difficultySignals.complexityIndicators.length > 0
        || args.difficultySignals.challengeIndicators.length > 0
    ) {
        add('difficulty_alignment', [], 'strategy_metadata');
    }
    if (args.senioritySignals.inferredSeniority || args.senioritySignals.indicators.length > 0) {
        add('seniority_alignment', [], 'classification_metadata');
    }
    if (args.interviewStageSignals.inferredStage || args.interviewStageSignals.indicators.length > 0) {
        add('interview_stage_alignment', [], 'category_metadata');
    }

    const reasonOrder: InterviewStrategyReasonCode[] = [
        'category_alignment',
        'subcategory_alignment',
        'context_alignment',
        'interview_stage_alignment',
        'seniority_alignment',
        'difficulty_alignment',
    ];
    return Array.from(byReason.values())
        .sort((left, right) => reasonOrder.indexOf(left.reason) - reasonOrder.indexOf(right.reason));
}

function normalizeCandidateStrategies(args: {
    input?: InterviewStrategyPolicyTraceInput | null;
    selectedStrategy?: InterviewStrategyPolicyType;
    questionUnderstanding: InterviewQuestionUnderstandingTrace;
    strategy: InterviewStrategyTrace;
}): InterviewCandidateStrategyTrace[] {
    const byStrategy = new Map<InterviewStrategyPolicyType, InterviewCandidateStrategyTrace>();
    for (const item of args.input?.candidateStrategies ?? []) {
        const strategyType = normalizeStrategyPolicyType(item.strategyType ?? item.strategy);
        if (!strategyType) continue;
        const selectionReason = normalizeStrategyReason(item.selectionReason);
        const entry: InterviewCandidateStrategyTrace = {
            strategyType,
            selected: item.selected === true || strategyType === args.selectedStrategy,
            evidenceIds: normalizeEvidenceIds(item.evidenceIds),
        };
        const score = finiteNumber(item.score);
        if (score !== undefined) entry.score = score;
        if (selectionReason !== undefined) entry.selectionReason = selectionReason;
        byStrategy.set(strategyType, entry);
    }

    for (const strategyType of strategyCandidatesFromQuestion(args.questionUnderstanding)) {
        if (byStrategy.has(strategyType)) continue;
        byStrategy.set(strategyType, {
            strategyType,
            selected: strategyType === args.selectedStrategy,
            selectionReason: 'subcategory_alignment',
            evidenceIds: args.questionUnderstanding.subcategoryEvidence.flatMap((item) => item.evidenceIds),
        });
    }

    const explicitStrategyType = normalizeStrategyPolicyType(args.input?.strategyType)
        ?? normalizeStrategyPolicyType(args.strategy.strategyType);
    if (explicitStrategyType && !byStrategy.has(explicitStrategyType)) {
        byStrategy.set(explicitStrategyType, {
            strategyType: explicitStrategyType,
            selected: explicitStrategyType === args.selectedStrategy,
            selectionReason: 'category_alignment',
            evidenceIds: [],
        });
    }

    if (args.selectedStrategy && !byStrategy.has(args.selectedStrategy)) {
        byStrategy.set(args.selectedStrategy, {
            strategyType: args.selectedStrategy,
            selected: true,
            selectionReason: 'category_alignment',
            evidenceIds: [],
        });
    }

    return Array.from(byStrategy.values())
        .map((entry) => ({ ...entry, selected: entry.strategyType === args.selectedStrategy || entry.selected }))
        .sort((left, right) => STRATEGY_POLICY_ORDER.indexOf(left.strategyType) - STRATEGY_POLICY_ORDER.indexOf(right.strategyType));
}

function normalizeConfidenceMetadata(args: {
    input?: InterviewStrategyConfidenceMetadataInput | null;
    questionUnderstanding: InterviewQuestionUnderstandingTrace;
    difficultySignals: InterviewDifficultySignalsTrace;
    senioritySignals: InterviewSenioritySignalsTrace;
    interviewStageSignals: InterviewStageSignalsTrace;
    strategyReasons: InterviewStrategyReasonTrace[];
    candidateStrategies: InterviewCandidateStrategyTrace[];
}): InterviewStrategyConfidenceMetadataTrace {
    const signalCount = finiteNumber(args.input?.signalCount)
        ?? args.difficultySignals.signals.length
            + args.senioritySignals.signals.length
            + args.interviewStageSignals.signals.length;
    const reasonCount = finiteNumber(args.input?.reasonCount) ?? args.strategyReasons.length;
    const candidateCount = finiteNumber(args.input?.candidateCount) ?? args.candidateStrategies.length;
    const trace: InterviewStrategyConfidenceMetadataTrace = {
        signalCount,
        reasonCount,
        candidateCount,
    };
    const confidence = clamp01(args.input?.confidence) ?? args.questionUnderstanding.confidence;
    const source = safeMetadataString(args.input?.source)
        ?? args.questionUnderstanding.classificationSource
        ?? 'decision_trace_metadata';
    if (confidence !== undefined) trace.confidence = confidence;
    if (source !== undefined) trace.source = source;
    return trace;
}

function normalizeStrategyPolicy(args: {
    input?: InterviewStrategyPolicyTraceInput | null;
    questionUnderstanding: InterviewQuestionUnderstandingTrace;
    contextSelection: InterviewContextSelectionTrace;
    strategy: InterviewStrategyTrace;
}): InterviewStrategyPolicyTrace {
    const selectedStrategy = selectedStrategyFromInputs({
        input: args.input,
        strategy: args.strategy,
        questionUnderstanding: args.questionUnderstanding,
    });
    const difficultySignals = normalizeDifficultySignals({
        input: args.input,
        strategy: args.strategy,
        questionUnderstanding: args.questionUnderstanding,
    });
    const senioritySignals = normalizeSenioritySignals({
        input: args.input,
        questionUnderstanding: args.questionUnderstanding,
    });
    const interviewStageSignals = normalizeInterviewStageSignals({
        input: args.input,
        questionUnderstanding: args.questionUnderstanding,
    });
    const strategyReasons = buildStrategyReasons({
        input: args.input,
        questionUnderstanding: args.questionUnderstanding,
        contextSelection: args.contextSelection,
        difficultySignals,
        senioritySignals,
        interviewStageSignals,
    });
    const candidateStrategies = normalizeCandidateStrategies({
        input: args.input,
        selectedStrategy,
        questionUnderstanding: args.questionUnderstanding,
        strategy: args.strategy,
    });
    const confidenceMetadata = normalizeConfidenceMetadata({
        input: args.input?.confidenceMetadata,
        questionUnderstanding: args.questionUnderstanding,
        difficultySignals,
        senioritySignals,
        interviewStageSignals,
        strategyReasons,
        candidateStrategies,
    });
    const responseProfile = safeMetadataString(args.input?.responseProfile ?? args.strategy.responseProfile);
    const planningMode = safeMetadataString(args.input?.planningMode ?? args.strategy.reasoningSummary.planningMode);
    const strategyType = normalizeStrategyPolicyType(args.input?.strategyType) ?? selectedStrategy;

    const trace: InterviewStrategyPolicyTrace = {
        difficultySignals,
        senioritySignals,
        interviewStageSignals,
        strategyReasons,
        candidateStrategies,
        confidenceMetadata,
    };
    if (strategyType !== undefined) trace.strategyType = strategyType;
    if (responseProfile !== undefined) trace.responseProfile = responseProfile;
    if (planningMode !== undefined) trace.planningMode = planningMode;
    if (selectedStrategy !== undefined) trace.selectedStrategy = selectedStrategy;
    return trace;
}

function isProviderRoutingReadModel(value: unknown): value is ProviderRoutingReadModel {
    return isRecord(value) && Array.isArray(value.routes);
}

function routeFromInput(
    providerRouting: ProviderRoutingEntry | ProviderRoutingReadModel | null | undefined,
    responseId?: string,
): ProviderRoutingEntry | undefined {
    if (!providerRouting) return undefined;
    if (isProviderRoutingReadModel(providerRouting)) {
        return responseId
            ? providerRouting.byResponseId[responseId] ?? providerRouting.activeRoute ?? undefined
            : providerRouting.activeRoute ?? providerRouting.routes[0];
    }
    return providerRouting;
}

function normalizeProviderDecision(args: {
    input?: InterviewProviderDecisionTraceInput | null;
    ownership?: Partial<ResponseOwnership> | null;
    route?: ProviderRoutingEntry;
}): InterviewProviderDecisionTrace {
    const input = args.input;
    const ownership = args.ownership;
    const route = args.route;

    const requestedProvider = safeMetadataString(input?.requestedProvider ?? route?.requestedProvider ?? ownership?.requestedProvider ?? ownership?.sourceProvider);
    const requestedModel = safeMetadataString(input?.requestedModel ?? route?.requestedModel ?? ownership?.requestedModel ?? ownership?.sourceModel);
    const actualProvider = safeMetadataString(input?.actualProvider ?? route?.actualProvider ?? ownership?.actualProvider ?? ownership?.sourceProvider);
    const actualModel = safeMetadataString(input?.actualModel ?? input?.model ?? route?.actualModel ?? ownership?.actualModel ?? ownership?.sourceModel);
    const routingReason = safeMetadataString(input?.routingReason ?? route?.routingReason ?? ownership?.routingReason);
    const routeChanged = input?.routeChanged === true
        || route?.routeChanged === true
        || Boolean(requestedProvider && actualProvider && requestedProvider !== actualProvider)
        || Boolean(requestedModel && actualModel && requestedModel !== actualModel);
    const fallbackUsed = input?.fallbackUsed === true
        || route?.fallbackUsed === true
        || routingReason?.includes('fallback') === true
        || actualProvider === 'local'
        || actualModel === 'safe_action_fallback';

    return {
        requestedProvider,
        requestedModel,
        actualProvider,
        actualModel,
        routingReason,
        status: safeMetadataString(input?.status ?? route?.status) ?? (fallbackUsed ? 'fallback' : routeChanged ? 'remapped' : 'unknown'),
        routeChanged,
        fallbackUsed,
        remapped: input?.remapped === true || (routeChanged && !fallbackUsed),
        fallbackChainLength: finiteNumber(input?.fallbackChainLength) ?? 0,
    };
}

function validationOutcome(input?: InterviewValidationTraceInput | null): InterviewDecisionValidationOutcome {
    if (input?.outcome === 'valid' || input?.outcome === 'warning' || input?.outcome === 'invalid') return input.outcome;
    if (input?.valid === true && (input.warnings?.length ?? 0) > 0) return 'warning';
    if (input?.valid === true) return 'valid';
    if (input?.valid === false) return 'invalid';
    return 'unknown';
}

function normalizeValidation(input?: InterviewValidationTraceInput | null): InterviewValidationTrace {
    const repairPolicy = deriveValidationRepairPolicy({
        valid: input?.valid,
        repairApplied: input?.repairApplied,
        status: input?.status ?? input?.repairOutcome,
        warnings: input?.warnings,
        issues: input?.issues,
        sourceCode: input?.repairOutcome,
    });
    const warningCodes = uniqueStrings(input?.warnings);
    const issueCodes = uniqueStrings(input?.issues);

    return {
        outcome: validationOutcome(input),
        actionContract: safeMetadataString(input?.actionContract),
        contractOutcome: safeMetadataString(input?.contractOutcome ?? input?.status),
        repairApplied: input?.repairApplied === true,
        repairOutcome: safeMetadataString(repairPolicy?.outcome ?? input?.repairOutcome),
        repairSeverity: safeMetadataString(repairPolicy?.severity),
        repairRecoverable: repairPolicy?.recoverable,
        warningCount: warningCodes.length,
        issueCount: issueCodes.length,
        warningCodes,
        issueCodes,
    };
}

function normalizeQualityFinding(
    value: InterviewQualityFindingInput,
    index: number,
): InterviewQualityFinding {
    return {
        code: sanitizeCode(value.ruleId ?? value.code ?? `quality_finding_${index}`, `quality_finding_${index}`),
        severity: safeMetadataString(value.severity),
        weight: finiteNumber(value.weight),
    };
}

function normalizeQualityEvaluation(input?: InterviewQualityEvaluationTraceInput | null): InterviewQualityEvaluationTrace {
    const findings = [
        ...(input?.findings ?? []),
        ...(input?.issues ?? []),
    ].map(normalizeQualityFinding)
        .sort((left, right) => left.code.localeCompare(right.code));
    const warningCodes = uniqueStrings(input?.warnings);

    return {
        score: clamp01(input?.score),
        confidence: clamp01(input?.confidence),
        rulesChecked: finiteNumber(input?.rulesChecked),
        rulesPassed: finiteNumber(input?.rulesPassed),
        findingCount: findings.length,
        warningCount: warningCodes.length,
        findings,
        warningCodes,
    };
}

function collectExcludedFields(input: BuildInterviewDecisionTraceReadModelInput): string[] {
    const excluded = new Set<string>();

    function visit(value: unknown, path: string): void {
        if (!isRecord(value)) return;
        for (const [key, child] of Object.entries(value)) {
            const nextPath = path ? `${path}.${key}` : key;
            if (isForbiddenField(key)) {
                excluded.add(nextPath);
                continue;
            }
            if (Array.isArray(child)) {
                child.forEach((item, index) => visit(item, `${nextPath}[${index}]`));
            } else if (isRecord(child)) {
                visit(child, nextPath);
            }
        }
    }

    visit(input as unknown, '');
    return Array.from(excluded).sort();
}

export function buildInterviewDecisionTraceReadModel(
    input: BuildInterviewDecisionTraceReadModelInput,
): InterviewDecisionTraceReadModel {
    const generatedAt = input.generatedAt ?? Date.now();
    const responseId = safeMetadataString(input.responseId ?? input.ownership?.responseId);
    const requestId = safeMetadataString(input.requestId);
    const questionTurnId = safeMetadataString(input.questionTurnId ?? input.ownership?.questionTurnId);
    const actionId = safeMetadataString(input.actionId ?? input.ownership?.actionId);
    const route = routeFromInput(input.providerRouting, responseId);

    const questionUnderstanding = normalizeQuestionUnderstanding(input.questionUnderstanding);
    const contextSelection = normalizeContextSelection(input.contextSelection, questionUnderstanding);
    const brainSelection = normalizeBrainSelection(input.brainSelection);
    const strategy = normalizeStrategy(input.strategy);
    const strategyPolicy = normalizeStrategyPolicy({
        input: input.strategyPolicy,
        questionUnderstanding,
        contextSelection,
        strategy,
    });
    const providerDecision = normalizeProviderDecision({
        input: input.providerDecision,
        ownership: input.ownership,
        route,
    });
    const validation = normalizeValidation(input.validation);
    const qualityEvaluation = normalizeQualityEvaluation(input.qualityEvaluation);
    const excludedFields = collectExcludedFields(input);
    const privacyRedactionCount = countForbiddenFields(input);

    return {
        generatedAt,
        responseId,
        requestId,
        questionTurnId,
        actionId,
        questionUnderstanding,
        contextSelection,
        brainSelection,
        strategy,
        strategyPolicy,
        providerDecision,
        validation,
        qualityEvaluation,
        summary: {
            hasQuestionUnderstanding: Boolean(questionUnderstanding.detectedCategory),
            selectedContextCount: contextSelection.selectedSections.length,
            excludedContextCount: contextSelection.excludedSections.length,
            candidateBrainCount: brainSelection.candidateBrains.length,
            hasFallback: providerDecision.fallbackUsed,
            hasRouteChange: providerDecision.routeChanged,
            hasValidationRepair: validation.repairApplied || Boolean(validation.repairOutcome),
            hasValidationIssues: validation.outcome === 'invalid' || validation.issueCount > 0,
            hasQualityWarnings: qualityEvaluation.findingCount > 0 || qualityEvaluation.warningCount > 0,
            privacyRedactionCount,
        },
        privacy: {
            metadataOnly: true,
            redactionCount: privacyRedactionCount,
            excludedFields,
        },
    };
}
