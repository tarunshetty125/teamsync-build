import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildActionSemanticsReadModel,
    type ActionSemanticsEntry,
} from '../../src/lib/overlay/actionSemanticsReadModel.ts';

type ActionSemanticsSnapshot = Pick<
    ActionSemanticsEntry,
    | 'actionId'
    | 'displayLabel'
    | 'taxonomyCategory'
    | 'runtimeIntent'
    | 'actionContractMode'
    | 'outputShape'
    | 'validationShape'
    | 'repairShape'
    | 'ambiguityLevel'
>;

function buildModel() {
    return buildActionSemanticsReadModel({ generatedAt: 1700000000000 });
}

function projectSnapshot(action: ActionSemanticsEntry): ActionSemanticsSnapshot {
    return {
        actionId: action.actionId,
        displayLabel: action.displayLabel,
        taxonomyCategory: action.taxonomyCategory,
        runtimeIntent: action.runtimeIntent,
        actionContractMode: action.actionContractMode,
        outputShape: action.outputShape,
        validationShape: action.validationShape,
        repairShape: action.repairShape,
        ambiguityLevel: action.ambiguityLevel,
    };
}

function assertActionSnapshot(actionId: string, expected: ActionSemanticsSnapshot): void {
    const action = buildModel().byActionId[actionId];
    assert.ok(action, `Expected action ${actionId} to exist`);
    assert.deepEqual(projectSnapshot(action), expected);
}

test('Sprint 17 Phase D snapshots formerly high-ambiguity action mappings after alignment', () => {
    assertActionSnapshot('system_tradeoffs', {
        actionId: 'system_tradeoffs',
        displayLabel: 'Tradeoffs',
        taxonomyCategory: 'output_shape',
        runtimeIntent: 'system_design_tradeoffs',
        actionContractMode: 'none',
        outputShape: 'system_design_tradeoff_bullets',
        validationShape: 'brainstorm_bullets',
        repairShape: 'repair_to_concise_tradeoff_bullets',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('system_deep_dive', {
        actionId: 'system_deep_dive',
        displayLabel: 'Deep Dive',
        taxonomyCategory: 'output_shape',
        runtimeIntent: 'what_to_answer',
        actionContractMode: 'none',
        outputShape: 'profile_dependent_answer_may_include_full_architecture',
        validationShape: 'profile_dependent_structured_or_system_design_contract',
        repairShape: 'repair_to_profile_dependent_contract',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('lecture_explain', {
        actionId: 'lecture_explain',
        displayLabel: 'Explain Concept',
        taxonomyCategory: 'user_intent',
        runtimeIntent: 'what_to_answer',
        actionContractMode: 'none',
        outputShape: 'structured_answer_profile_dependent',
        validationShape: 'profile_dependent_structured_answer',
        repairShape: 'repair_to_profile_dependent_contract',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('team_action_item', {
        actionId: 'team_action_item',
        displayLabel: 'Action Item',
        taxonomyCategory: 'output_shape',
        runtimeIntent: 'what_to_answer',
        actionContractMode: 'none',
        outputShape: 'structured_answer_profile_dependent',
        validationShape: 'profile_dependent_structured_answer',
        repairShape: 'repair_to_profile_dependent_contract',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('job_resume_alignment', {
        actionId: 'job_resume_alignment',
        displayLabel: 'Resume Alignment',
        taxonomyCategory: 'user_intent',
        runtimeIntent: 'what_to_answer',
        actionContractMode: 'none',
        outputShape: 'structured_answer_profile_dependent',
        validationShape: 'profile_dependent_structured_answer',
        repairShape: 'repair_to_profile_dependent_contract',
        ambiguityLevel: 'none',
    });
});

test('Sprint 17 Phase D aligns formerly high-risk actions away from question-only validators', () => {
    const readModel = buildModel();

    for (const actionId of [
        'system_tradeoffs',
        'system_deep_dive',
        'lecture_explain',
        'team_action_item',
        'job_resume_alignment',
    ]) {
        assert.equal(readModel.byActionId[actionId].ambiguityLevel, 'none', actionId);
        assert.notEqual(readModel.byActionId[actionId].runtimeIntent, 'clarify', actionId);
        assert.notEqual(readModel.byActionId[actionId].runtimeIntent, 'follow_up_questions', actionId);
        assert.notEqual(readModel.byActionId[actionId].validationShape, 'bullet_questions', actionId);
        assert.notEqual(readModel.byActionId[actionId].validationShape, 'one_clarifying_question_or_coding_contract', actionId);
    }

    assert.equal(readModel.byActionId.system_tradeoffs.runtimeIntent, 'system_design_tradeoffs');
    assert.equal(readModel.byActionId.system_tradeoffs.validationShape, 'brainstorm_bullets');
});

test('Sprint 17 Phase F snapshots remaining medium-target action mappings', () => {
    assertActionSnapshot('clarify', {
        actionId: 'clarify',
        displayLabel: 'Clarify',
        taxonomyCategory: 'workflow_state',
        runtimeIntent: 'clarify',
        actionContractMode: 'none',
        outputShape: 'clarifying_question_or_coding_full_answer',
        validationShape: 'one_clarifying_question_or_coding_contract',
        repairShape: 'repair_to_one_question_or_coding_contract',
        ambiguityLevel: 'medium',
    });

    assertActionSnapshot('brainstorm', {
        actionId: 'brainstorm',
        displayLabel: 'Brainstorm',
        taxonomyCategory: 'output_shape',
        runtimeIntent: 'brainstorm',
        actionContractMode: 'none',
        outputShape: 'approach_bullets_or_coding_full_answer',
        validationShape: 'brainstorm_bullets_or_coding_contract',
        repairShape: 'repair_to_bullets_or_coding_contract',
        ambiguityLevel: 'medium',
    });

    assertActionSnapshot('job_improvement', {
        actionId: 'job_improvement',
        displayLabel: 'Behavioral Optimize',
        taxonomyCategory: 'user_intent',
        runtimeIntent: 'what_to_answer',
        actionContractMode: 'none',
        outputShape: 'structured_answer_profile_dependent',
        validationShape: 'profile_dependent_structured_answer',
        repairShape: 'repair_to_profile_dependent_contract',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('lecture_question', {
        actionId: 'lecture_question',
        displayLabel: 'Ask Clarification',
        taxonomyCategory: 'workflow_state',
        runtimeIntent: 'follow_up_questions',
        actionContractMode: 'none',
        outputShape: 'follow_up_question_bullets',
        validationShape: 'bullet_questions',
        repairShape: 'repair_to_bullet_questions',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('recruiting_strength', {
        actionId: 'recruiting_strength',
        displayLabel: 'Candidate Strength',
        taxonomyCategory: 'user_intent',
        runtimeIntent: 'what_to_answer',
        actionContractMode: 'none',
        outputShape: 'structured_answer_profile_dependent',
        validationShape: 'profile_dependent_structured_answer',
        repairShape: 'repair_to_profile_dependent_contract',
        ambiguityLevel: 'none',
    });
});

test('Sprint 17 Phase F snapshots aligned salary, recruiting, and team actions', () => {
    for (const actionId of [
        'salary_anchor',
        'salary_confidence',
        'recruiting_red_flag',
        'team_risk',
    ]) {
        const action = buildModel().byActionId[actionId];
        assert.equal(action.runtimeIntent, 'what_to_answer', actionId);
        assert.equal(action.taxonomyCategory, 'user_intent', actionId);
        assert.equal(action.outputShape, 'structured_answer_profile_dependent', actionId);
        assert.equal(action.validationShape, 'profile_dependent_structured_answer', actionId);
        assert.equal(action.repairShape, 'repair_to_profile_dependent_contract', actionId);
        assert.equal(action.ambiguityLevel, 'none', actionId);
    }

    assert.equal(buildModel().byActionId.salary_anchor.displayLabel, 'Anchor');
    assert.equal(buildModel().byActionId.salary_confidence.displayLabel, 'Confidence');
    assert.equal(buildModel().byActionId.recruiting_red_flag.displayLabel, 'Red Flag');
    assert.equal(buildModel().byActionId.team_risk.displayLabel, 'Blocker');
});

test('Sprint 17 Phase C snapshots reference and low-ambiguity action mappings', () => {
    assertActionSnapshot('recap', {
        actionId: 'recap',
        displayLabel: 'Recap',
        taxonomyCategory: 'output_shape',
        runtimeIntent: 'recap',
        actionContractMode: 'none',
        outputShape: 'bullet_summary',
        validationShape: 'recap_bullets',
        repairShape: 'repair_to_bullet_summary',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('follow_up_questions', {
        actionId: 'follow_up_questions',
        displayLabel: 'Follow Up',
        taxonomyCategory: 'output_shape',
        runtimeIntent: 'follow_up_questions',
        actionContractMode: 'none',
        outputShape: 'follow_up_question_bullets',
        validationShape: 'bullet_questions',
        repairShape: 'repair_to_bullet_questions',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('tech_hint', {
        actionId: 'tech_hint',
        displayLabel: 'Hint',
        taxonomyCategory: 'contract_mode',
        runtimeIntent: 'what_to_answer',
        actionContractMode: 'hint_only',
        outputShape: 'hint_bullets_no_solution',
        validationShape: 'coding_contract_hint_only',
        repairShape: 'repair_to_hints_only_no_code',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('tech_optimal_solution', {
        actionId: 'tech_optimal_solution',
        displayLabel: 'Optimal',
        taxonomyCategory: 'contract_mode',
        runtimeIntent: 'what_to_answer',
        actionContractMode: 'optimal_solution',
        outputShape: 'strongest_complete_answer_profile_dependent',
        validationShape: 'profile_dependent_optimal_contract',
        repairShape: 'repair_to_originating_profile_contract',
        ambiguityLevel: 'none',
    });

    assertActionSnapshot('tech_complexity', {
        actionId: 'tech_complexity',
        displayLabel: 'Complexity',
        taxonomyCategory: 'contract_mode',
        runtimeIntent: 'clarify',
        actionContractMode: 'complexity_only',
        outputShape: 'complexity_analysis_only',
        validationShape: 'coding_contract_complexity_only',
        repairShape: 'repair_to_complexity_only_no_code',
        ambiguityLevel: 'low',
    });

    assertActionSnapshot('tech_edge_case', {
        actionId: 'tech_edge_case',
        displayLabel: 'Edge Case',
        taxonomyCategory: 'contract_mode',
        runtimeIntent: 'brainstorm',
        actionContractMode: 'edge_cases_only',
        outputShape: 'edge_cases_and_tests_only',
        validationShape: 'coding_contract_edge_cases_only',
        repairShape: 'repair_to_edge_cases_only_no_code',
        ambiguityLevel: 'low',
    });
});

test('Sprint 17 Phase C snapshots taxonomy and ambiguity counts', () => {
    const readModel = buildModel();

    assert.deepEqual(readModel.summary, {
        totalActions: 42,
        taxonomyCounts: {
            user_intent: 16,
            output_shape: 16,
            contract_mode: 5,
            workflow_state: 5,
        },
        ambiguityCounts: {
            none: 34,
            low: 6,
            medium: 2,
            high: 0,
        },
    });

    assert.equal(readModel.byTaxonomy.user_intent.length, 16);
    assert.equal(readModel.byTaxonomy.output_shape.length, 16);
    assert.equal(readModel.byTaxonomy.contract_mode.length, 5);
    assert.equal(readModel.byTaxonomy.workflow_state.length, 5);
    assert.equal(readModel.byAmbiguity.medium.length, 2);
    assert.equal(readModel.byAmbiguity.high.length, 0);
});

test('Sprint 17 Phase C snapshots are deterministic', () => {
    const first = buildActionSemanticsReadModel({ generatedAt: 1111 });
    const second = buildActionSemanticsReadModel({ generatedAt: 1111 });

    assert.deepEqual(first, second);
    assert.deepEqual(
        first.actions.map((action) => projectSnapshot(action)),
        second.actions.map((action) => projectSnapshot(action)),
    );
});

test('Sprint 17 Phase C preserves backward-compatible targeted action aliases', () => {
    const readModel = buildModel();
    const aliases = {
        behavioral_optimize: 'job_improvement',
        ask_clarification: 'lecture_question',
        candidate_strength: 'recruiting_strength',
        hint: 'tech_hint',
        optimal: 'tech_optimal_solution',
        complexity: 'tech_complexity',
        edge_case: 'tech_edge_case',
    };

    for (const [alias, actionId] of Object.entries(aliases)) {
        assert.ok(readModel.byActionId[actionId], `Expected ${alias} alias target ${actionId} to exist`);
    }

    assert.equal(readModel.byActionId.job_improvement.displayLabel, 'Behavioral Optimize');
    assert.equal(readModel.byActionId.lecture_question.displayLabel, 'Ask Clarification');
    assert.equal(readModel.byActionId.recruiting_strength.displayLabel, 'Candidate Strength');
});
