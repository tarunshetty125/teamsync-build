import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    buildInterviewDecisionTraceReadModel,
    type BuildInterviewDecisionTraceReadModelInput,
} from '../../src/lib/interview/interviewDecisionTraceReadModel.ts';
import type { ResponseOwnership } from '../../src/lib/overlay/actionContextTypes.ts';
import {
    buildProviderRoutingReadModel,
    type ProviderRoutingMessage,
} from '../../src/lib/providers/providerRoutingReadModel.ts';

function ownership(responseId: string, overrides: Partial<ResponseOwnership> = {}): ResponseOwnership {
    return {
        responseId,
        questionTurnId: `turn-${responseId}`,
        transcriptVersion: 1,
        contextTarget: 'active_context',
        actionId: 'manual_chat',
        mode: 'coding',
        createdAt: 1000,
        requestedProvider: 'openai',
        requestedModel: 'gpt-4.1-mini',
        actualProvider: 'openai',
        actualModel: 'gpt-4.1-mini',
        routingReason: 'requested_model',
        resolvedCodingLanguage: 'JavaScript',
        responseStyle: 'balanced',
        interviewFocus: 'coding',
        personalizationVersion: 1,
        ...overrides,
    };
}

function baseTraceInput(overrides: Partial<BuildInterviewDecisionTraceReadModelInput> = {}): BuildInterviewDecisionTraceReadModelInput {
    return {
        generatedAt: 5000,
        responseId: 'response-coding',
        requestId: 'request-coding',
        questionTurnId: 'turn-response-coding',
        actionId: 'manual_chat',
        ownership: ownership('response-coding'),
        questionUnderstanding: {
            detectedCategory: 'coding',
            confidence: 0.92,
            classificationSource: 'regex',
            matchedSignals: ['coding.algorithm', 'coding.implementation'],
        },
        contextSelection: {
            selectedSections: ['question', 'transcript', 'action_contract'],
            excludedSections: ['rag'],
            contextPriorityOrdering: ['question', 'transcript', 'previous_response'],
            priorities: {
                transcript: 'critical',
                previous_response: 'high',
                rag: 'ignore',
            },
            tokenBudget: {
                budgetName: 'cloud',
                providerFamily: 'openai',
                maxInputTokens: 12000,
                estimatedInputTokens: 1800,
                estimatedContextTokens: 900,
                selectedContextTokens: 700,
                omittedContextTokens: 200,
                truncated: true,
                trimmedSections: ['transcript'],
            },
        },
        brainSelection: {
            selectedBrain: 'coding',
            candidateBrains: [
                { brain: 'coding', score: 0.92, reason: 'category_match' },
                { brain: 'general', score: 0.08 },
            ],
            selectionReason: 'category_match',
        },
        strategy: {
            responseProfile: 'coding',
            strategyType: 'technical_interview',
            planningMode: 'deterministic',
            depth: 'medium',
            tone: 'technical',
            maxWords: 250,
            bulletRange: [2, 4],
            streamStrategy: 'collect_validate',
            actionContract: 'optimal_solution',
            reasoningPlan: {
                steps: ['algorithm', 'complexity_analysis', 'edge_cases'],
                confidence: 0.88,
                matchedRuleIds: ['coding.algorithm_deep'],
            },
        },
        providerDecision: {
            requestedProvider: 'openai',
            requestedModel: 'gpt-4.1-mini',
            actualProvider: 'openai',
            actualModel: 'gpt-4.1-mini',
            routingReason: 'requested_model',
            status: 'direct',
        },
        validation: {
            valid: true,
            outcome: 'valid',
            contractOutcome: 'contract_satisfied',
            actionContract: 'optimal_solution',
        },
        qualityEvaluation: {
            score: 0.86,
            confidence: 0.8,
            rulesChecked: 6,
            rulesPassed: 5,
        },
        ...overrides,
    };
}

function subcategoryTags(input: BuildInterviewDecisionTraceReadModelInput): string[] {
    return buildInterviewDecisionTraceReadModel(input).questionUnderstanding.subcategoryTags;
}

function subcategoryEvidenceIds(input: BuildInterviewDecisionTraceReadModelInput, tag: string): string[] {
    const trace = buildInterviewDecisionTraceReadModel(input);
    return trace.questionUnderstanding.subcategoryEvidence.find((entry) => entry.tag === tag)?.evidenceIds ?? [];
}

function reasonCodes(trace: ReturnType<typeof buildInterviewDecisionTraceReadModel>, source: string): string[] {
    return trace.contextSelection.selectionReasons
        .filter((entry) => entry.source === source)
        .map((entry) => entry.reason);
}

function strategyReasonCodes(trace: ReturnType<typeof buildInterviewDecisionTraceReadModel>): string[] {
    return trace.strategyPolicy.strategyReasons.map((entry) => entry.reason);
}

test('Sprint 15 Phase B builds a coding interview decision trace', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput());

    assert.equal(trace.generatedAt, 5000);
    assert.equal(trace.responseId, 'response-coding');
    assert.equal(trace.questionUnderstanding.primaryCategory, 'coding');
    assert.equal(trace.questionUnderstanding.detectedCategory, 'coding');
    assert.equal(trace.questionUnderstanding.detectedSubcategory, 'algorithm');
    assert.deepEqual(trace.questionUnderstanding.subcategoryTags, ['algorithms']);
    assert.deepEqual(
        trace.questionUnderstanding.subcategoryEvidence.find((entry) => entry.tag === 'algorithms')?.evidenceIds,
        ['coding.algorithm'],
    );
    assert.equal(trace.questionUnderstanding.confidence, 0.92);
    assert.deepEqual(
        trace.contextSelection.selectedSections,
        ['question', 'transcript', 'action_contract'],
    );
    assert.deepEqual(trace.contextSelection.excludedSections, ['rag']);
    assert.equal(trace.contextSelection.tokenBudget.truncated, true);
    assert.deepEqual(reasonCodes(trace, 'action_contract'), ['validation_relevance']);
    assert.deepEqual(reasonCodes(trace, 'question'), ['coding_relevance']);
    assert.deepEqual(
        trace.contextSelection.exclusionReasons.map((entry) => `${entry.source}:${entry.reason}`),
        ['rag:irrelevant_to_category'],
    );
    assert.deepEqual(
        trace.contextSelection.priorityRanking.map((entry) => `${entry.rank}:${entry.source}:${entry.priorityScore}`),
        ['1:question:undefined', '2:transcript:5', '3:previous_response:4'],
    );
    assert.equal(trace.contextSelection.budgetAllocation.availableBudget, 12000);
    assert.equal(trace.contextSelection.budgetAllocation.allocatedBudget, 700);
    assert.equal(trace.contextSelection.budgetAllocation.trimmedBudget, 200);
    assert.equal(trace.contextSelection.budgetAllocation.allocationSummary, 'context_trimmed');
    assert.deepEqual(
        trace.contextSelection.budgetTrimming.trims.map((entry) => `${entry.source}:${entry.reason}`),
        ['transcript:budget_trimmed'],
    );
    assert.equal(trace.brainSelection.selectedBrain, 'coding');
    assert.equal(trace.strategy.actionContract, 'optimal_solution');
    assert.deepEqual(trace.strategy.reasoningSummary.steps, ['algorithm', 'complexity_analysis', 'edge_cases']);
    assert.equal(trace.providerDecision.status, 'direct');
    assert.equal(trace.validation.outcome, 'valid');
    assert.equal(trace.qualityEvaluation.score, 0.86);
    assert.equal(trace.summary.selectedContextCount, 3);
});

test('Sprint 15 Phase B builds a behavioral trace with leadership subcategory', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        responseId: 'response-behavioral',
        ownership: ownership('response-behavioral', { mode: 'behavioral', actionId: 'what_to_answer' }),
        questionUnderstanding: {
            category: 'behavioral',
            confidence: 0.81,
            source: 'regex',
            matchedSignals: ['behavioral.leadership', 'behavioral.soft_skills'],
        },
        contextSelection: {
            selectedSections: ['question', 'profile', 'transcript'],
            excludedSections: ['rag'],
            priorities: {
                resume: 'critical',
                jd: 'high',
                transcript: 'critical',
                rag: 'ignore',
            },
        },
        brainSelection: {
            selectedBrain: 'behavioral',
            candidateBrains: ['behavioral', 'general'],
            selectionReason: 'category_match',
        },
        strategy: {
            responseProfile: 'follow_up',
            strategyType: 'star_answer',
            planningMode: 'deterministic',
            depth: 'short',
            tone: 'conversational',
            reasoningPlan: {
                steps: ['star_structure', 'project_grounding'],
                confidence: 0.7,
                matchedRuleIds: ['behavioral.star'],
            },
        },
    }));

    assert.equal(trace.questionUnderstanding.detectedCategory, 'behavioral');
    assert.equal(trace.questionUnderstanding.detectedSubcategory, 'leadership');
    assert.deepEqual(trace.questionUnderstanding.subcategoryTags, ['leadership']);
    assert.equal(trace.brainSelection.selectedBrain, 'behavioral');
    assert.equal(trace.strategy.strategyType, 'star_answer');
    assert.equal(trace.contextSelection.priorityBySource.resume, 'critical');
});

test('Sprint 15 Phase B builds a system design trace with architecture metadata', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        responseId: 'response-system',
        ownership: ownership('response-system', { mode: 'system_design', actionId: 'system_deep_dive' }),
        questionUnderstanding: {
            detectedCategory: 'system_design',
            confidence: 0.95,
            classificationSource: 'regex',
            matchedSignals: ['system.design_prompt', 'system.scale', 'system.infrastructure'],
        },
        contextSelection: {
            selectedSections: ['question', 'transcript', 'rag', 'previous_response'],
            contextPriorityOrdering: ['question', 'previous_response', 'rag', 'transcript'],
            priorities: {
                transcript: 'critical',
                rag: 'high',
                previous_response: 'high',
                screen: 'high',
            },
        },
        brainSelection: {
            selectedBrain: 'system_design',
            candidateBrains: ['system_design', 'general'],
            selectionReason: 'system_design_category',
        },
        strategy: {
            responseProfile: 'system_design',
            strategyType: 'architecture_deep_dive',
            planningMode: 'deterministic',
            depth: 'deep',
            tone: 'technical',
            reasoningPlan: {
                steps: ['requirements', 'scale_estimation', 'failure_handling', 'tradeoffs'],
                confidence: 0.91,
                matchedRuleIds: ['system_design.general'],
            },
        },
    }));

    assert.equal(trace.questionUnderstanding.detectedCategory, 'system_design');
    assert.equal(trace.questionUnderstanding.detectedSubcategory, 'infrastructure');
    assert.deepEqual(trace.questionUnderstanding.subcategoryTags, ['architecture', 'scalability']);
    assert.equal(trace.brainSelection.selectedBrain, 'system_design');
    assert.equal(trace.strategy.reasoningSummary.stepCount, 4);
    assert.equal(trace.contextSelection.priorityBySource.rag, 'high');
});

test('Sprint 15 Phase C adds coding subtype tags without changing the primary category', () => {
    const input = baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'coding',
            confidence: 0.9,
            matchedSignals: [
                'coding.bugfix',
                'coding.optimize',
                'coding.algorithm',
                'coding.structure',
                'coding.concurrency',
                'coding.database',
            ],
        },
    });
    const trace = buildInterviewDecisionTraceReadModel(input);

    assert.equal(trace.questionUnderstanding.primaryCategory, 'coding');
    assert.equal(trace.questionUnderstanding.detectedCategory, 'coding');
    assert.deepEqual(trace.questionUnderstanding.subcategoryTags, [
        'debugging',
        'optimization',
        'algorithms',
        'data_structures',
        'concurrency',
        'databases',
    ]);
    assert.deepEqual(subcategoryEvidenceIds(input, 'debugging'), ['coding.bugfix']);
});

test('Sprint 15 Phase C adds system-design subtype tags without changing the primary category', () => {
    const input = baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'system_design',
            confidence: 0.93,
            matchedSignals: [
                'system.architecture',
                'system.scale',
                'system.reliability',
                'system.distributed_systems',
                'system.security',
            ],
        },
    });
    const trace = buildInterviewDecisionTraceReadModel(input);

    assert.equal(trace.questionUnderstanding.primaryCategory, 'system_design');
    assert.equal(trace.questionUnderstanding.detectedCategory, 'system_design');
    assert.deepEqual(trace.questionUnderstanding.subcategoryTags, [
        'architecture',
        'scalability',
        'reliability',
        'distributed_systems',
        'security',
    ]);
});

test('Sprint 15 Phase C adds behavioral subtype tags without changing the primary category', () => {
    const input = baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'behavioral',
            confidence: 0.88,
            matchedSignals: [
                'behavioral.time_story',
                'behavioral.challenge',
                'behavioral.failure',
                'behavioral.success',
                'behavioral.leadership',
                'behavioral.mentorship',
                'behavioral.stakeholder_management',
            ],
        },
    });
    const trace = buildInterviewDecisionTraceReadModel(input);

    assert.equal(trace.questionUnderstanding.primaryCategory, 'behavioral');
    assert.equal(trace.questionUnderstanding.detectedCategory, 'behavioral');
    assert.deepEqual(trace.questionUnderstanding.subcategoryTags, [
        'behavioral_star',
        'behavioral_conflict',
        'behavioral_failure',
        'behavioral_success',
        'leadership',
        'mentorship',
        'stakeholder_management',
    ]);
});

test('Sprint 15 Phase C tags product questions as metadata without creating a new primary category', () => {
    const input = baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'general',
            confidence: 0.72,
            matchedSignals: ['product.tradeoff', 'product.prioritization', 'product.sense'],
        },
        brainSelection: {
            selectedBrain: 'general',
            candidateBrains: ['general'],
            selectionReason: 'primary_category_general',
        },
    });
    const trace = buildInterviewDecisionTraceReadModel(input);

    assert.equal(trace.questionUnderstanding.primaryCategory, 'general');
    assert.equal(trace.questionUnderstanding.detectedCategory, 'general');
    assert.deepEqual(trace.questionUnderstanding.subcategoryTags, [
        'product_tradeoff',
        'prioritization',
        'product_sense',
    ]);
    assert.equal(trace.brainSelection.selectedBrain, 'general');
});

test('Sprint 15 Phase C tags DevOps questions as metadata without creating a new primary category', () => {
    const input = baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'general',
            confidence: 0.7,
            matchedSignals: [
                'devops.deployment',
                'devops.observability',
                'devops.ci_cd',
                'devops.incident_response',
            ],
        },
    });

    assert.deepEqual(subcategoryTags(input), [
        'deployment',
        'observability',
        'ci_cd',
        'incident_response',
    ]);
});

test('Sprint 15 Phase C tags cloud questions as metadata without changing system-design category', () => {
    const input = baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'system_design',
            confidence: 0.84,
            matchedSignals: ['system.cloud', 'cloud.architecture', 'cloud.operations'],
        },
    });
    const trace = buildInterviewDecisionTraceReadModel(input);

    assert.equal(trace.questionUnderstanding.primaryCategory, 'system_design');
    assert.deepEqual(trace.questionUnderstanding.subcategoryTags, [
        'cloud',
        'cloud_architecture',
        'cloud_operations',
    ]);
});

test('Sprint 15 Phase C preserves backward compatibility for category-only traces', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'follow_up',
            confidence: 1,
            matchedSignals: [],
        },
    }));

    assert.equal(trace.questionUnderstanding.primaryCategory, 'follow_up');
    assert.equal(trace.questionUnderstanding.detectedCategory, 'follow_up');
    assert.equal(trace.questionUnderstanding.detectedSubcategory, undefined);
    assert.deepEqual(trace.questionUnderstanding.subcategoryTags, []);
    assert.deepEqual(trace.questionUnderstanding.subcategoryEvidence, []);
    assert.equal(trace.brainSelection.selectedBrain, 'coding');
});

test('Sprint 15 Phase D explains coding context selection without changing decisions', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        contextSelection: {
            selectedSections: ['question', 'transcript', 'action_contract', 'previous_response'],
            excludedSections: ['rag', 'profile'],
            contextPriorityOrdering: ['question', 'transcript', 'previous_response', 'action_contract', 'profile', 'rag'],
            priorities: {
                transcript: 'critical',
                previous_response: 'high',
                action_contract: 'high',
                profile: 'low',
                rag: 'ignore',
            },
            tokenBudget: {
                maxInputTokens: 12000,
                selectedContextTokens: 900,
                omittedContextTokens: 350,
                truncated: true,
                trimmedSections: ['profile', 'rag'],
            },
        },
    }));

    assert.equal(trace.questionUnderstanding.primaryCategory, 'coding');
    assert.equal(trace.brainSelection.selectedBrain, 'coding');
    assert.deepEqual(reasonCodes(trace, 'transcript'), ['coding_relevance']);
    assert.deepEqual(reasonCodes(trace, 'previous_response'), ['ownership_relevance']);
    assert.deepEqual(reasonCodes(trace, 'action_contract'), ['validation_relevance']);
    assert.deepEqual(
        trace.contextSelection.exclusionReasons.map((entry) => `${entry.source}:${entry.reason}`),
        ['profile:budget_trimmed', 'rag:irrelevant_to_category'],
    );
    assert.deepEqual(
        trace.contextSelection.budgetAllocation.allocations.map((entry) => `${entry.source}:${entry.reason}`),
        [
            'action_contract:validation_relevance',
            'previous_response:ownership_relevance',
            'question:coding_relevance',
            'transcript:coding_relevance',
        ],
    );
});

test('Sprint 15 Phase D explains behavioral context selection and personalization contribution', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'behavioral',
            matchedSignals: ['behavioral.leadership'],
            confidence: 0.84,
        },
        contextSelection: {
            selectedSections: ['question', 'profile', 'transcript', 'previous_response'],
            excludedSections: ['rag'],
            priorities: {
                profile: 'critical',
                transcript: 'critical',
                previous_response: 'medium',
                rag: 'ignore',
            },
        },
        brainSelection: {
            selectedBrain: 'behavioral',
            candidateBrains: ['behavioral', 'general'],
            selectionReason: 'category_match',
        },
    }));

    assert.equal(trace.questionUnderstanding.primaryCategory, 'behavioral');
    assert.equal(trace.brainSelection.selectedBrain, 'behavioral');
    assert.deepEqual(reasonCodes(trace, 'profile'), ['personalization_relevance']);
    assert.deepEqual(reasonCodes(trace, 'transcript'), ['behavioral_relevance']);
    assert.equal(
        trace.contextSelection.contributionMetadata.find((entry) => entry.source === 'profile')?.contributionCategory,
        'personalization',
    );
});

test('Sprint 15 Phase D explains system-design context selection and diagram contribution', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'system_design',
            matchedSignals: ['system.design_prompt', 'system.scale'],
            confidence: 0.9,
        },
        contextSelection: {
            selectedSections: ['question', 'architecture', 'rag', 'previous_response'],
            excludedSections: ['profile'],
            priorities: {
                architecture: 'high',
                rag: 'high',
                previous_response: 'high',
                profile: 'low',
            },
        },
        brainSelection: {
            selectedBrain: 'system_design',
            candidateBrains: ['system_design', 'general'],
            selectionReason: 'category_match',
        },
    }));

    assert.equal(trace.questionUnderstanding.primaryCategory, 'system_design');
    assert.equal(trace.brainSelection.selectedBrain, 'system_design');
    assert.deepEqual(reasonCodes(trace, 'architecture'), ['diagram_relevance']);
    assert.deepEqual(reasonCodes(trace, 'rag'), ['system_design_relevance']);
    assert.equal(
        trace.contextSelection.contributionMetadata.find((entry) => entry.source === 'architecture')?.contributionReason,
        'diagram_relevance',
    );
});

test('Sprint 15 Phase D preserves explicit budget, exclusion, ranking, and contribution metadata', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        contextSelection: {
            selectedSections: ['question', 'transcript'],
            excludedSections: ['profile', 'rag'],
            selectionReasons: [
                { source: 'transcript', reason: 'interview_relevance', evidenceIds: ['latest_turn'], score: 0.91 },
            ],
            exclusionReasons: [
                { source: 'profile', reason: 'unavailable' },
                { source: 'rag', reason: 'duplicate_context' },
            ],
            priorityRanking: [
                { source: 'transcript', rank: 2, priority: 'critical', priorityScore: 0.95, rankingReason: 'latest_turn' },
                { source: 'question', rank: 1, priority: 'critical', priorityScore: 1, rankingReason: 'direct_question' },
            ],
            tokenBudget: {
                maxInputTokens: 8000,
                selectedContextTokens: 1200,
                omittedContextTokens: 300,
                truncated: true,
            },
            budgetAllocation: {
                availableBudget: 8000,
                allocatedBudget: 1200,
                trimmedBudget: 300,
                allocationSummary: 'manual_allocation',
                allocations: [
                    { source: 'transcript', allocatedTokens: 800, requestedTokens: 1100, reason: 'interview_relevance' },
                    { source: 'question', allocatedTokens: 400, requestedTokens: 400, reason: 'coding_relevance' },
                ],
            },
            budgetTrimming: {
                trimmedBudget: 300,
                trimmingReason: 'budget_trimmed',
                trimmedSections: ['transcript'],
                trims: [
                    { source: 'transcript', trimmedTokens: 300, reason: 'budget_trimmed' },
                ],
            },
            contributionMetadata: [
                {
                    source: 'transcript',
                    contributionCategory: 'latest_interviewer_turn',
                    contributionReason: 'interview_relevance',
                    selected: true,
                },
            ],
        },
    }));

    assert.deepEqual(
        trace.contextSelection.exclusionReasons.map((entry) => `${entry.source}:${entry.reason}`),
        ['profile:unavailable', 'rag:duplicate_context'],
    );
    assert.deepEqual(
        trace.contextSelection.priorityRanking.map((entry) => `${entry.rank}:${entry.source}:${entry.priorityScore}:${entry.rankingReason}`),
        ['1:question:1:direct_question', '2:transcript:0.95:latest_turn'],
    );
    assert.equal(trace.contextSelection.budgetAllocation.allocationSummary, 'manual_allocation');
    assert.equal(trace.contextSelection.budgetAllocation.allocations[0]?.allocatedTokens, 400);
    assert.equal(trace.contextSelection.budgetTrimming.trimmedBudget, 300);
    assert.equal(trace.contextSelection.contributionMetadata.find((entry) => entry.source === 'transcript')?.contributionCategory, 'latest_interviewer_turn');
});

test('Sprint 15 Phase D keeps minimal context traces backward compatible', () => {
    const trace = buildInterviewDecisionTraceReadModel({
        generatedAt: 9000,
        questionUnderstanding: {
            detectedCategory: 'general',
        },
    });

    assert.deepEqual(trace.contextSelection.selectedSections, []);
    assert.deepEqual(trace.contextSelection.selectionReasons, []);
    assert.deepEqual(trace.contextSelection.exclusionReasons, []);
    assert.deepEqual(trace.contextSelection.priorityRanking, []);
    assert.equal(trace.contextSelection.budgetAllocation.allocationSummary, 'no_context_selected');
    assert.equal(trace.contextSelection.budgetTrimming.trimmingReason, 'none');
    assert.deepEqual(trace.contextSelection.contributionMetadata, []);
    assert.equal(trace.strategyPolicy.selectedStrategy, undefined);
    assert.deepEqual(trace.strategyPolicy.candidateStrategies, []);
});

test('Sprint 15 Phase E projects coding strategy policy metadata', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'coding',
            confidence: 0.91,
            matchedSignals: ['coding.bugfix', 'coding.optimize', 'coding.algorithm'],
        },
        strategy: {
            responseProfile: 'coding',
            strategyType: 'technical_interview',
            planningMode: 'deterministic',
            depth: 'deep',
            reasoningPlan: {
                steps: ['implementation', 'complexity_analysis', 'optimization'],
                confidence: 0.84,
            },
        },
    }));

    assert.equal(trace.strategyPolicy.responseProfile, 'coding');
    assert.equal(trace.strategyPolicy.planningMode, 'deterministic');
    assert.equal(trace.strategyPolicy.selectedStrategy, 'debugging_focused');
    assert.equal(trace.strategyPolicy.strategyType, 'debugging_focused');
    assert.deepEqual(
        trace.strategyPolicy.candidateStrategies.map((candidate) => candidate.strategyType),
        ['implementation_focused', 'debugging_focused', 'optimization_focused'],
    );
    assert.equal(
        trace.strategyPolicy.candidateStrategies.find((candidate) => candidate.strategyType === 'debugging_focused')?.selected,
        true,
    );
    assert.equal(trace.strategyPolicy.difficultySignals.inferredDifficulty, 'hard');
    assert.deepEqual(trace.strategyPolicy.difficultySignals.complexityIndicators, ['complexity_analysis', 'optimization']);
    assert.deepEqual(trace.strategyPolicy.difficultySignals.challengeIndicators, ['debugging', 'optimization']);
    assert.deepEqual(strategyReasonCodes(trace), [
        'category_alignment',
        'subcategory_alignment',
        'context_alignment',
        'interview_stage_alignment',
        'difficulty_alignment',
    ]);
});

test('Sprint 15 Phase E projects behavioral leadership strategy metadata', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'behavioral',
            confidence: 0.83,
            matchedSignals: ['behavioral.leadership', 'behavioral.stakeholder_management'],
        },
        strategy: {
            responseProfile: 'follow_up',
            strategyType: 'star_answer',
            planningMode: 'deterministic',
            depth: 'short',
            reasoningPlan: {
                steps: ['star_structure', 'leadership_scope'],
            },
        },
    }));

    assert.equal(trace.strategyPolicy.selectedStrategy, 'leadership_focused');
    assert.equal(trace.strategyPolicy.difficultySignals.inferredDifficulty, 'easy');
    assert.equal(trace.strategyPolicy.senioritySignals.inferredSeniority, 'leadership');
    assert.deepEqual(trace.strategyPolicy.senioritySignals.indicators, ['leadership', 'stakeholder_management']);
    assert.equal(trace.strategyPolicy.interviewStageSignals.inferredStage, 'screening');
    assert.ok(strategyReasonCodes(trace).includes('seniority_alignment'));
});

test('Sprint 15 Phase E projects system-design strategy metadata', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'system_design',
            confidence: 0.9,
            matchedSignals: ['system.cloud', 'cloud.architecture', 'system.reliability', 'system.scale'],
        },
        strategy: {
            responseProfile: 'system_design',
            strategyType: 'architecture_deep_dive',
            planningMode: 'deterministic',
            depth: 'deep',
            reasoningPlan: {
                steps: ['requirements', 'scale_estimation', 'failure_handling', 'tradeoffs'],
            },
        },
    }));

    assert.equal(trace.strategyPolicy.selectedStrategy, 'scalability_focused');
    assert.deepEqual(
        trace.strategyPolicy.candidateStrategies.map((candidate) => candidate.strategyType),
        ['architecture_focused', 'scalability_focused', 'reliability_focused', 'cloud_focused'],
    );
    assert.equal(trace.strategyPolicy.difficultySignals.inferredDifficulty, 'hard');
    assert.deepEqual(trace.strategyPolicy.difficultySignals.challengeIndicators, [
        'reliability',
        'cloud',
        'cloud_architecture',
    ]);
    assert.equal(trace.strategyPolicy.senioritySignals.inferredSeniority, 'staff');
    assert.equal(trace.strategyPolicy.interviewStageSignals.inferredStage, 'technical_round');
});

test('Sprint 15 Phase E projects product strategy metadata as additive tags', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'general',
            confidence: 0.76,
            matchedSignals: ['product.prioritization', 'product.sense', 'product.tradeoff'],
        },
        brainSelection: {
            selectedBrain: 'general',
            candidateBrains: ['general'],
        },
        strategy: {
            responseProfile: 'general',
            planningMode: 'deterministic',
            reasoningPlan: {
                steps: ['tradeoffs'],
            },
        },
    }));

    assert.equal(trace.questionUnderstanding.primaryCategory, 'general');
    assert.equal(trace.strategyPolicy.selectedStrategy, 'tradeoff_focused');
    assert.deepEqual(
        trace.strategyPolicy.candidateStrategies.map((candidate) => candidate.strategyType),
        ['tradeoff_focused', 'prioritization_focused', 'product_sense_focused'],
    );
    assert.deepEqual(strategyReasonCodes(trace), [
        'category_alignment',
        'subcategory_alignment',
        'context_alignment',
        'interview_stage_alignment',
        'difficulty_alignment',
    ]);
});

test('Sprint 15 Phase E projects DevOps strategy metadata as additive tags', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        questionUnderstanding: {
            detectedCategory: 'general',
            confidence: 0.74,
            matchedSignals: ['devops.deployment', 'devops.observability', 'devops.incident_response'],
        },
        strategy: {
            responseProfile: 'general',
            planningMode: 'deterministic',
            reasoningPlan: {
                steps: ['deployment_plan', 'incident_response'],
            },
        },
    }));

    assert.equal(trace.strategyPolicy.selectedStrategy, 'deployment_focused');
    assert.deepEqual(
        trace.strategyPolicy.candidateStrategies.map((candidate) => candidate.strategyType),
        ['deployment_focused', 'observability_focused', 'incident_response_focused'],
    );
    assert.deepEqual(trace.strategyPolicy.difficultySignals.challengeIndicators, ['incident_response']);
    assert.ok(strategyReasonCodes(trace).includes('subcategory_alignment'));
});

test('Sprint 15 Phase E preserves explicit strategy-policy signals and reasons', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        strategyPolicy: {
            selectedStrategy: 'cloud_focused',
            strategyType: 'cloud_focused',
            responseProfile: 'system_design',
            planningMode: 'deterministic',
            inferredDifficulty: 'hard',
            complexityIndicators: ['multi_region'],
            challengeIndicators: ['capacity_planning'],
            inferredSeniority: 'staff',
            seniorityIndicators: ['staff_level_design'],
            inferredStage: 'onsite',
            stageIndicators: ['architecture_round'],
            difficultySignals: [
                { value: 'hard', indicators: ['multi_region'], source: 'classification_metadata', confidence: 0.8 },
            ],
            senioritySignals: [
                { value: 'staff', indicators: ['staff_level_design'], source: 'profile_metadata' },
            ],
            interviewStageSignals: [
                { value: 'onsite', indicators: ['architecture_round'], source: 'calendar_metadata' },
            ],
            strategyReasons: [
                { reason: 'difficulty_alignment', evidenceIds: ['difficulty.hard'], source: 'explicit', score: 0.9 },
                { reason: 'seniority_alignment', evidenceIds: ['seniority.staff'], source: 'explicit' },
            ],
            candidateStrategies: [
                { strategyType: 'architecture_focused', score: 0.6 },
                { strategyType: 'cloud_focused', selected: true, score: 0.92, selectionReason: 'subcategory_alignment' },
            ],
            confidenceMetadata: {
                confidence: 0.81,
                source: 'strategy_policy_fixture',
                signalCount: 3,
            },
        },
    }));

    assert.equal(trace.strategyPolicy.strategyType, 'cloud_focused');
    assert.equal(trace.strategyPolicy.selectedStrategy, 'cloud_focused');
    assert.equal(trace.strategyPolicy.difficultySignals.inferredDifficulty, 'hard');
    assert.deepEqual(trace.strategyPolicy.difficultySignals.complexityIndicators, [
        'multi_region',
        'complexity_analysis',
    ]);
    assert.deepEqual(trace.strategyPolicy.senioritySignals.indicators, ['staff_level_design']);
    assert.equal(trace.strategyPolicy.interviewStageSignals.inferredStage, 'onsite');
    assert.equal(trace.strategyPolicy.strategyReasons.find((entry) => entry.reason === 'difficulty_alignment')?.score, 0.9);
    assert.equal(trace.strategyPolicy.candidateStrategies.find((entry) => entry.strategyType === 'cloud_focused')?.selected, true);
    assert.equal(trace.strategyPolicy.confidenceMetadata.confidence, 0.81);
    assert.equal(trace.strategyPolicy.confidenceMetadata.signalCount, 3);
    assert.equal(trace.strategyPolicy.confidenceMetadata.reasonCount, trace.strategyPolicy.strategyReasons.length);
});

test('Sprint 15 Phase B projects provider fallback and remap metadata from routing read model', () => {
    const responses: ProviderRoutingMessage[] = [
        {
            id: 'response-fallback',
            requestId: 'request-fallback',
            timestamp: 2000,
            ownership: ownership('response-fallback', {
                requestedProvider: 'bedrock',
                requestedModel: 'openai.gpt-oss-120b-1:0',
                actualProvider: 'groq',
                actualModel: 'llama-3.3-70b-versatile',
                routingReason: 'bedrock_auth_expired_fallback',
            }),
            intelligenceMetadata: {
                telemetry: { fallbackUsed: true },
            },
        },
    ];
    const routing = buildProviderRoutingReadModel({
        responses,
        activeResponseId: 'response-fallback',
        now: 3000,
    });

    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        responseId: 'response-fallback',
        requestId: 'request-fallback',
        ownership: ownership('response-fallback'),
        providerRouting: routing,
        providerDecision: {
            fallbackChainLength: 2,
        },
    }));

    assert.equal(trace.providerDecision.requestedProvider, 'bedrock');
    assert.equal(trace.providerDecision.actualProvider, 'groq');
    assert.equal(trace.providerDecision.routingReason, 'bedrock_auth_expired_fallback');
    assert.equal(trace.providerDecision.fallbackUsed, true);
    assert.equal(trace.providerDecision.routeChanged, true);
    assert.equal(trace.providerDecision.status, 'fallback');
    assert.equal(trace.providerDecision.fallbackChainLength, 2);
    assert.equal(trace.summary.hasFallback, true);
});

test('Sprint 15 Phase B normalizes validation repair outcomes', () => {
    const repaired = buildInterviewDecisionTraceReadModel(baseTraceInput({
        responseId: 'response-repaired',
        validation: {
            valid: true,
            repairApplied: true,
            status: 'valid_repaired',
            actionContract: 'optimal_solution',
        },
    }));
    const failed = buildInterviewDecisionTraceReadModel(baseTraceInput({
        responseId: 'response-repair-failed',
        validation: {
            valid: false,
            repairApplied: true,
            issues: ['repair_invalid'],
            actionContract: 'optimal_solution',
        },
    }));

    assert.equal(repaired.validation.repairOutcome, 'repaired');
    assert.equal(repaired.validation.repairSeverity, 'info');
    assert.equal(repaired.validation.repairRecoverable, true);
    assert.equal(repaired.summary.hasValidationRepair, true);
    assert.equal(failed.validation.outcome, 'invalid');
    assert.equal(failed.validation.repairOutcome, 'repair_failed');
    assert.equal(failed.validation.repairSeverity, 'error');
    assert.equal(failed.summary.hasValidationIssues, true);
});

test('Sprint 15 Phase B projects quality findings without response content', () => {
    const trace = buildInterviewDecisionTraceReadModel(baseTraceInput({
        qualityEvaluation: {
            score: 0.42,
            confidence: 0.77,
            rulesChecked: 8,
            rulesPassed: 4,
            findings: [
                { ruleId: 'coding.complexity_missing', severity: 'high', weight: 0.2 },
                { code: 'coding.edge_cases_missing', severity: 'medium', weight: 0.15 },
            ],
            warnings: ['quality_below_threshold'],
            suggestionCount: 2,
        },
    }));

    assert.equal(trace.qualityEvaluation.score, 0.42);
    assert.equal(trace.qualityEvaluation.findingCount, 2);
    assert.deepEqual(
        trace.qualityEvaluation.findings.map((finding) => finding.code),
        ['coding.complexity_missing', 'coding.edge_cases_missing'],
    );
    assert.equal(trace.qualityEvaluation.warningCodes[0], 'quality_below_threshold');
    assert.equal(trace.summary.hasQualityWarnings, true);
});

test('Sprint 15 Phase B decision trace is deterministic when generatedAt is supplied', () => {
    const input = baseTraceInput();

    assert.deepEqual(
        buildInterviewDecisionTraceReadModel(input),
        buildInterviewDecisionTraceReadModel(input),
    );
});

test('Sprint 15 Phase B excludes raw content and local paths from decision traces', () => {
    const hostileInput = {
        ...baseTraceInput(),
        questionUnderstanding: {
            detectedCategory: 'coding',
            confidence: 0.9,
            matchedSignals: ['solve two sum with secret prompt text'],
            evidence: [
                {
                    id: 'coding.algorithm',
                    source: 'regex',
                    // Runtime callers could accidentally include forbidden fields.
                    prompt: 'SECRET_PROMPT',
                } as unknown as { id: string; source: string },
            ],
            rawPrompt: 'SECRET_PROMPT' as never,
        } as unknown as BuildInterviewDecisionTraceReadModelInput['questionUnderstanding'],
        contextSelection: {
            selectedSections: ['question', 'transcript'],
            transcriptText: 'RAW_TRANSCRIPT_VALUE' as never,
            tokenBudget: {
                budgetName: 'cloud',
                localFilesystemPath: '/Users/tarunshetty/private/report.md',
            } as unknown as { budgetName: string },
        } as unknown as BuildInterviewDecisionTraceReadModelInput['contextSelection'],
        strategyPolicy: {
            selectedStrategy: 'implementation_focused',
            difficultySignals: [
                {
                    value: 'hard',
                    indicators: ['SECRET_PROMPT', '/Users/tarunshetty/private/report.md'],
                    source: 'raw strategy prompt with hidden content',
                },
            ],
            rawPrompt: 'SECRET_PROMPT',
            providerPayload: {
                path: '/Users/tarunshetty/private/report.md',
            },
        } as unknown as BuildInterviewDecisionTraceReadModelInput['strategyPolicy'],
        qualityEvaluation: {
            findings: [
                {
                    ruleId: 'quality.response_text_leaked',
                    severity: 'high',
                    description: 'RAW_RESPONSE_TEXT',
                } as unknown as { ruleId: string; severity: string },
            ],
        },
        debugMetadata: {
            prompt: 'SECRET_PROMPT',
            responseText: 'RAW_RESPONSE_TEXT',
            path: '/Users/tarunshetty/private/report.md',
        },
    } as unknown as BuildInterviewDecisionTraceReadModelInput;
    const trace = buildInterviewDecisionTraceReadModel(hostileInput);
    const serialized = JSON.stringify(trace);

    assert.equal(trace.privacy.metadataOnly, true);
    assert.ok(trace.privacy.redactionCount >= 4);
    assert.equal(trace.privacy.excludedFields.some((field) => field.includes('debugMetadata')), true);
    assert.doesNotMatch(serialized, /SECRET_PROMPT/);
    assert.doesNotMatch(serialized, /RAW_TRANSCRIPT_VALUE/);
    assert.doesNotMatch(serialized, /RAW_RESPONSE_TEXT/);
    assert.doesNotMatch(serialized, /\/Users\/tarunshetty\/private/);
    assert.doesNotMatch(serialized, /solve two sum with secret prompt text/);
});
