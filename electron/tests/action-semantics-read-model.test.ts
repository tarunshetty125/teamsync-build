import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildActionSemanticsReadModel,
    type ActionSemanticsReadModel,
} from '../../src/lib/overlay/actionSemanticsReadModel.ts';
import {
    getOverlayQuickActions,
    type OverlayCopilotModeId,
} from '../../src/lib/modes/overlayCopilotConfig.ts';

const MODE_DISCOVERY_ORDER: OverlayCopilotModeId[] = [
    'general',
    'behavioral',
    'coding',
    'follow_up',
    'system_design',
    'technical-interview',
    'sales',
    'lecture',
    'recruiting',
    'team-meet',
    'looking-for-work',
    'salary',
];

function model(): ActionSemanticsReadModel {
    return buildActionSemanticsReadModel({ generatedAt: 1700000000000 });
}

test('ActionSemanticsReadModel covers core actions', () => {
    const readModel = model();

    assert.equal(readModel.byActionId.what_to_answer.displayLabel, 'Suggest');
    assert.equal(readModel.byActionId.what_to_answer.taxonomyCategory, 'user_intent');
    assert.equal(readModel.byActionId.what_to_answer.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.what_to_answer.actionContractMode, 'none');
    assert.equal(readModel.byActionId.what_to_answer.outputShape, 'structured_answer_profile_dependent');
    assert.equal(readModel.byActionId.what_to_answer.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.recap.taxonomyCategory, 'output_shape');
    assert.equal(readModel.byActionId.recap.outputShape, 'bullet_summary');
    assert.equal(readModel.byActionId.recap.validationShape, 'recap_bullets');
    assert.equal(readModel.byActionId.recap.tinyPromptShape, 'bullets');

    assert.equal(readModel.byActionId.clarify.taxonomyCategory, 'workflow_state');
    assert.equal(readModel.byActionId.clarify.runtimeIntent, 'clarify');
    assert.equal(readModel.byActionId.clarify.validationShape, 'one_clarifying_question_or_coding_contract');
    assert.equal(readModel.byActionId.clarify.ambiguityLevel, 'medium');

    assert.equal(readModel.byActionId.follow_up_questions.taxonomyCategory, 'output_shape');
    assert.equal(readModel.byActionId.follow_up_questions.validationShape, 'bullet_questions');
    assert.equal(readModel.byActionId.follow_up_questions.ambiguityLevel, 'none');
});

test('ActionSemanticsReadModel covers coding contract actions', () => {
    const readModel = model();

    assert.equal(readModel.byActionId.tech_hint.displayLabel, 'Hint');
    assert.equal(readModel.byActionId.tech_hint.taxonomyCategory, 'contract_mode');
    assert.equal(readModel.byActionId.tech_hint.actionContractMode, 'hint_only');
    assert.equal(readModel.byActionId.tech_hint.outputShape, 'hint_bullets_no_solution');
    assert.equal(readModel.byActionId.tech_hint.validationShape, 'coding_contract_hint_only');
    assert.equal(readModel.byActionId.tech_hint.repairShape, 'repair_to_hints_only_no_code');
    assert.equal(readModel.byActionId.tech_hint.tinyPromptShape, 'contract_preserved_hints_only');
    assert.equal(readModel.byActionId.tech_hint.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.tech_optimal_solution.actionContractMode, 'optimal_solution');
    assert.equal(readModel.byActionId.tech_optimal_solution.outputShape, 'strongest_complete_answer_profile_dependent');
    assert.equal(readModel.byActionId.tech_optimal_solution.tinyPromptShape, 'contract_preserved_optimal_solution');

    assert.equal(readModel.byActionId.tech_complexity.actionContractMode, 'complexity_only');
    assert.equal(readModel.byActionId.tech_complexity.runtimeIntent, 'clarify');
    assert.equal(readModel.byActionId.tech_complexity.taxonomyCategory, 'contract_mode');
    assert.equal(readModel.byActionId.tech_complexity.ambiguityLevel, 'low');

    assert.equal(readModel.byActionId.tech_edge_case.actionContractMode, 'edge_cases_only');
    assert.equal(readModel.byActionId.tech_edge_case.runtimeIntent, 'brainstorm');
    assert.equal(readModel.byActionId.tech_edge_case.ambiguityLevel, 'low');
});

test('ActionSemanticsReadModel covers system-design actions and runtime tradeoffs', () => {
    const readModel = model();

    assert.equal(readModel.byActionId.system_tradeoffs.displayLabel, 'Tradeoffs');
    assert.equal(readModel.byActionId.system_tradeoffs.runtimeIntent, 'system_design_tradeoffs');
    assert.equal(readModel.byActionId.system_tradeoffs.taxonomyCategory, 'output_shape');
    assert.equal(readModel.byActionId.system_tradeoffs.outputShape, 'system_design_tradeoff_bullets');
    assert.equal(readModel.byActionId.system_tradeoffs.validationShape, 'brainstorm_bullets');
    assert.equal(readModel.byActionId.system_tradeoffs.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.system_design_tradeoffs.displayLabel, 'System Design Tradeoffs');
    assert.equal(readModel.byActionId.system_design_tradeoffs.source, 'runtime_action');
    assert.equal(readModel.byActionId.system_design_tradeoffs.runtimeIntent, 'system_design_tradeoffs');
    assert.equal(readModel.byActionId.system_design_tradeoffs.outputShape, 'system_design_tradeoff_bullets');
    assert.equal(readModel.byActionId.system_design_tradeoffs.validationShape, 'brainstorm_bullets');
    assert.equal(readModel.byActionId.system_design_tradeoffs.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.system_clarify.taxonomyCategory, 'workflow_state');
    assert.equal(readModel.byActionId.system_clarify.validationShape, 'one_clarifying_question_or_coding_contract');

    assert.equal(readModel.byActionId.system_approaches.taxonomyCategory, 'output_shape');
    assert.equal(readModel.byActionId.system_approaches.validationShape, 'brainstorm_bullets_or_coding_contract');

    assert.equal(readModel.byActionId.system_deep_dive.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.system_deep_dive.validationShape, 'profile_dependent_structured_or_system_design_contract');
    assert.equal(readModel.byActionId.system_deep_dive.ambiguityLevel, 'none');
});

test('ActionSemanticsReadModel covers lecture actions', () => {
    const readModel = model();

    assert.equal(readModel.byActionId.lecture_explain.displayLabel, 'Explain Concept');
    assert.equal(readModel.byActionId.lecture_explain.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.lecture_explain.taxonomyCategory, 'user_intent');
    assert.equal(readModel.byActionId.lecture_explain.tinyPromptShape, 'mode_dependent_answer_format');
    assert.equal(readModel.byActionId.lecture_explain.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.lecture_summary.taxonomyCategory, 'output_shape');
    assert.equal(readModel.byActionId.lecture_summary.outputShape, 'bullet_summary');

    assert.equal(readModel.byActionId.lecture_question.taxonomyCategory, 'workflow_state');
    assert.equal(readModel.byActionId.lecture_question.displayLabel, 'Questions to Ask');
    assert.equal(readModel.byActionId.lecture_question.runtimeIntent, 'follow_up_questions');
    assert.equal(readModel.byActionId.lecture_question.validationShape, 'bullet_questions');
});

test('ActionSemanticsReadModel covers team actions', () => {
    const readModel = model();

    assert.equal(readModel.byActionId.team_decision.taxonomyCategory, 'user_intent');
    assert.equal(readModel.byActionId.team_decision.runtimeIntent, 'what_to_answer');

    assert.equal(readModel.byActionId.team_action_item.displayLabel, 'Action Item');
    assert.equal(readModel.byActionId.team_action_item.taxonomyCategory, 'output_shape');
    assert.equal(readModel.byActionId.team_action_item.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.team_action_item.validationShape, 'profile_dependent_structured_answer');
    assert.equal(readModel.byActionId.team_action_item.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.team_risk.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.team_risk.taxonomyCategory, 'user_intent');
    assert.equal(readModel.byActionId.team_risk.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.team_owner.runtimeIntent, 'brainstorm');
    assert.equal(readModel.byActionId.team_owner.ambiguityLevel, 'low');
});

test('ActionSemanticsReadModel covers behavioral and job actions', () => {
    const readModel = model();

    assert.equal(readModel.byActionId.job_star.displayLabel, 'STAR Response');
    assert.equal(readModel.byActionId.job_star.taxonomyCategory, 'user_intent');
    assert.equal(readModel.byActionId.job_star.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.job_star.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.job_resume_alignment.displayLabel, 'Resume Alignment');
    assert.equal(readModel.byActionId.job_resume_alignment.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.job_resume_alignment.taxonomyCategory, 'user_intent');
    assert.equal(readModel.byActionId.job_resume_alignment.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.job_confidence.runtimeIntent, 'brainstorm');
    assert.equal(readModel.byActionId.job_confidence.ambiguityLevel, 'low');

    assert.equal(readModel.byActionId.job_improvement.displayLabel, 'Improve');
    assert.equal(readModel.byActionId.job_improvement.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.job_improvement.taxonomyCategory, 'user_intent');
    assert.equal(readModel.byActionId.job_improvement.ambiguityLevel, 'none');
});

test('ActionSemanticsReadModel covers Phase F salary and recruiting alignments', () => {
    const readModel = model();

    assert.equal(readModel.byActionId.salary_anchor.displayLabel, 'Anchor');
    assert.equal(readModel.byActionId.salary_anchor.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.salary_anchor.validationShape, 'profile_dependent_structured_answer');
    assert.equal(readModel.byActionId.salary_anchor.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.salary_confidence.displayLabel, 'Confidence');
    assert.equal(readModel.byActionId.salary_confidence.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.salary_confidence.taxonomyCategory, 'user_intent');
    assert.equal(readModel.byActionId.salary_confidence.ambiguityLevel, 'none');

    assert.equal(readModel.byActionId.recruiting_red_flag.displayLabel, 'Red Flag');
    assert.equal(readModel.byActionId.recruiting_red_flag.runtimeIntent, 'what_to_answer');
    assert.equal(readModel.byActionId.recruiting_red_flag.validationShape, 'profile_dependent_structured_answer');
    assert.equal(readModel.byActionId.recruiting_red_flag.ambiguityLevel, 'none');
});

test('ActionSemanticsReadModel classifies ambiguity buckets', () => {
    const readModel = model();

    assert.equal(readModel.byAmbiguity.high.length, 0);
    assert.ok(readModel.byAmbiguity.none.some((action) => action.actionId === 'system_tradeoffs'));
    assert.ok(readModel.byAmbiguity.none.some((action) => action.actionId === 'lecture_explain'));
    assert.ok(readModel.byAmbiguity.medium.some((action) => action.actionId === 'clarify'));
    assert.ok(readModel.byAmbiguity.low.some((action) => action.actionId === 'tech_complexity'));
    assert.ok(readModel.byAmbiguity.none.some((action) => action.actionId === 'tech_hint'));

    assert.equal(
        readModel.summary.ambiguityCounts.high,
        readModel.byAmbiguity.high.length,
    );
    assert.equal(
        readModel.summary.taxonomyCounts.contract_mode,
        readModel.byTaxonomy.contract_mode.length,
    );
});

test('ActionSemanticsReadModel is deterministic', () => {
    const first = buildActionSemanticsReadModel({ generatedAt: 123 });
    const second = buildActionSemanticsReadModel({ generatedAt: 123 });

    assert.deepEqual(first, second);
    assert.deepEqual(
        first.actions.map((action) => action.actionId),
        [...first.actions.map((action) => action.actionId)].sort(),
    );
});

test('ActionSemanticsReadModel preserves existing user-facing action ids', () => {
    const readModel = model();
    const expectedActionIds = new Set<string>();

    for (const modeId of MODE_DISCOVERY_ORDER) {
        for (const action of getOverlayQuickActions(modeId, true)) {
            expectedActionIds.add(action.id);
        }
    }

    for (const runtimeActionId of ['answer_now', 'manual_chat', 'screen_scan', 'code_hint', 'system_design_tradeoffs']) {
        expectedActionIds.add(runtimeActionId);
    }

    assert.deepEqual(
        readModel.actions.map((action) => action.actionId),
        [...expectedActionIds].sort(),
    );

    assert.equal(readModel.summary.totalActions, expectedActionIds.size);
    assert.equal(new Set(readModel.actions.map((action) => action.actionId)).size, readModel.actions.length);
});
