import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { planReasoning, isPlanConfident, createFallbackPlan, planContains, planContainsAny, planContainsAll } from '../intelligence/planning';
import type { PlanningInput } from '../intelligence/planning';
import { deriveQuestionUnderstandingV2 } from '../intelligence/QuestionUnderstandingV2';
import { estimateResponseDepth } from '../intelligence/ResponseDepthEstimator';
import { defaultStrategy } from '../intelligence/ResponseStrategy';
import { CodingBrain } from '../intelligence/brains/CodingBrain';
import { SystemDesignBrain } from '../intelligence/brains/SystemDesignBrain';
import { BehavioralBrain } from '../intelligence/brains/BehavioralBrain';
import { ResumeBrain } from '../intelligence/brains/ResumeBrain';
import { GeneralBrain } from '../intelligence/brains/GeneralBrain';
import { deriveContextPriority } from '../intelligence/ContextPriorityEngine';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildPlanningInput(
    question: string,
    category: PlanningInput['category'],
    brainId: PlanningInput['brainId'],
): PlanningInput {
    const questionUnderstanding = deriveQuestionUnderstandingV2({
        question,
        intent: 'answer_now',
        mode: 'general',
    });

    const depthEstimate = estimateResponseDepth({
        question,
        category,
        sessionMode: 'general',
        intent: 'answer_now',
        questionUnderstandingResult: questionUnderstanding,
    });

    return {
        question,
        category,
        brainId,
        depthEstimate,
        questionUnderstanding,
    };
}

function createAnalysis(category: string) {
    return {
        category: category as any,
        confidence: 0.99,
        isFollowUp: false,
        referencesContext: false,
        estimatedDepth: 'moderate' as const,
        answerShape: '',
        rawIntent: 'general',
        classificationSource: 'context_heuristic' as const,
    };
}

// ===========================================================================
// 1. Deterministic plan generation
// ===========================================================================

test('PlanningEngine: "What is REST?" → quick_definition + example', () => {
    const plan = planReasoning(buildPlanningInput('What is REST?', 'general', 'general'));

    assert.ok(planContains(plan, 'quick_definition'), 'Should contain quick_definition');
    assert.ok(planContains(plan, 'example'), 'Should contain example');
    assert.ok(isPlanConfident(plan), 'Should be confident');
    assert.equal(plan.estimatedVerbosity, 'concise');

    // Determinism check
    const plan2 = planReasoning(buildPlanningInput('What is REST?', 'general', 'general'));
    assert.deepEqual(plan, plan2, 'Same input should produce identical plan');
});

test('PlanningEngine: "Optimize spiral matrix" → algorithm + optimization + complexity_analysis + edge_cases', () => {
    const plan = planReasoning(buildPlanningInput('Optimize spiral matrix', 'coding', 'coding'));

    assert.ok(planContains(plan, 'algorithm'), 'Should contain algorithm');
    assert.ok(planContains(plan, 'optimization'), 'Should contain optimization');
    assert.ok(planContains(plan, 'complexity_analysis'), 'Should contain complexity_analysis');
    assert.ok(planContains(plan, 'edge_cases'), 'Should contain edge_cases');
    assert.ok(isPlanConfident(plan), 'Should be confident');
    assert.equal(plan.estimatedVerbosity, 'moderate');
});

test('PlanningEngine: "Design Instagram" → full system design plan', () => {
    const plan = planReasoning(buildPlanningInput('Design Instagram', 'system_design', 'system_design'));

    assert.ok(planContains(plan, 'requirements'), 'Should contain requirements');
    assert.ok(planContains(plan, 'architecture'), 'Should contain architecture');
    assert.ok(planContains(plan, 'tradeoffs'), 'Should contain tradeoffs');
    assert.ok(planContains(plan, 'failure_handling'), 'Should contain failure_handling');
    assert.ok(isPlanConfident(plan), 'Should be confident');
    assert.equal(plan.estimatedVerbosity, 'detailed');
});

test('PlanningEngine: "Tell me about a challenge" → STAR plan', () => {
    const plan = planReasoning(buildPlanningInput('Tell me about a challenge', 'behavioral', 'behavioral'));

    assert.ok(planContains(plan, 'star_situation'), 'Should contain star_situation');
    assert.ok(planContains(plan, 'star_task'), 'Should contain star_task');
    assert.ok(planContains(plan, 'star_action'), 'Should contain star_action');
    assert.ok(planContains(plan, 'star_result'), 'Should contain star_result');
    assert.ok(isPlanConfident(plan), 'Should be confident');
});

test('PlanningEngine: "Tell me about your project" → project_grounding + jd_alignment', () => {
    const plan = planReasoning(buildPlanningInput('Tell me about your project', 'resume_jd', 'resume'));

    assert.ok(planContains(plan, 'project_grounding'), 'Should contain project_grounding');
    assert.ok(planContains(plan, 'jd_alignment'), 'Should contain jd_alignment');
    assert.ok(isPlanConfident(plan), 'Should be confident');
});

// ===========================================================================
// 2. Fallback safety
// ===========================================================================

test('PlanningEngine: unknown prompt → safe fallback plan', () => {
    const plan = planReasoning(buildPlanningInput('hmm okay sure', 'general', 'general'));

    // Should still produce a plan (catch-all rule), but with low confidence
    assert.ok(plan.steps.length >= 1, 'Should have at least one step');
    assert.ok(plan.confidence <= 0.5, 'Should have low confidence for ambiguous input');
    assert.match(plan.reasoning, /general/, 'Reasoning should mention general category');
});

test('createFallbackPlan returns safe defaults', () => {
    const fallback = createFallbackPlan();

    assert.deepEqual(fallback.steps, ['core_explanation', 'example']);
    assert.equal(fallback.confidence, 0.3);
    assert.equal(fallback.estimatedVerbosity, 'concise');
    assert.ok(!isPlanConfident(fallback), 'Fallback plan should not be confident');
});

// ===========================================================================
// 3. Confidence scoring
// ===========================================================================

test('PlanningEngine: high-weight rules produce higher confidence than catch-all rules', () => {
    const specificPlan = planReasoning(buildPlanningInput('Design whatsapp', 'system_design', 'system_design'));
    const vaguePlan = planReasoning(buildPlanningInput('hmm tell me more', 'general', 'general'));

    assert.ok(specificPlan.confidence > vaguePlan.confidence,
        `Specific (${specificPlan.confidence}) should be more confident than vague (${vaguePlan.confidence})`);
});

test('PlanningEngine: isPlanConfident returns false for low-confidence plans', () => {
    const fallback = createFallbackPlan();
    assert.equal(isPlanConfident(fallback), false);

    const confident = planReasoning(buildPlanningInput('Design whatsapp', 'system_design', 'system_design'));
    assert.equal(isPlanConfident(confident), true);
});

// ===========================================================================
// 4. Depth interaction
// ===========================================================================

test('PlanningEngine: short depth trims steps to at most 2', () => {
    // "What is a hashmap?" → coding definition → short depth → at most 2 steps
    const input = buildPlanningInput('What is a hashmap?', 'coding', 'coding');
    // Force short depth
    input.depthEstimate = { ...input.depthEstimate, depth: 'short' };

    const plan = planReasoning(input);
    assert.ok(plan.steps.length <= 2, `Short depth should trim to ≤2 steps, got ${plan.steps.length}`);
});

test('PlanningEngine: deep depth with 4+ steps appends summary', () => {
    const input = buildPlanningInput('Design Instagram', 'system_design', 'system_design');
    // Ensure deep depth
    input.depthEstimate = { ...input.depthEstimate, depth: 'deep' };

    const plan = planReasoning(input);
    assert.ok(plan.steps.length >= 5, `Deep design should have 5+ steps, got ${plan.steps.length}`);
    assert.ok(planContains(plan, 'summary'), 'Deep plan with 4+ steps should include summary');
});

// ===========================================================================
// 5. Brain integration — plans influence instructions
// ===========================================================================

test('CodingBrain emits plan_emphasis when plan contains complexity_analysis', () => {
    const plan = planReasoning(buildPlanningInput('Optimize spiral matrix', 'coding', 'coding'));
    const brain = new CodingBrain();

    const output = brain.execute({
        analysis: createAnalysis('coding'),
        context: { sources: [], totalTokens: 0, profileApplied: false, resolvedProfilePolicy: 'never' },
        strategy: defaultStrategy('medium'),
        sessionMode: 'general',
        contextPriority: deriveContextPriority({
            question: 'Optimize spiral matrix',
            questionCategory: 'coding',
            responseDepth: 'medium',
            brainId: 'coding',
            intent: 'manual_chat',
            sessionMode: 'general',
        }),
        reasoningPlan: plan,
    });

    const planEmphasis = output.instructions.find((i) => i.key === 'plan_emphasis');
    assert.ok(planEmphasis, 'Should have plan_emphasis instruction');
    assert.ok(planEmphasis!.content.includes('Big-O'), 'Should emphasize Big-O for complexity_analysis');
    assert.ok(planEmphasis!.content.includes('edge cases'), 'Should emphasize edge cases');
});

test('CodingBrain falls back safely when no plan is provided', () => {
    const brain = new CodingBrain();

    const output = brain.execute({
        analysis: createAnalysis('coding'),
        context: { sources: [], totalTokens: 0, profileApplied: false, resolvedProfilePolicy: 'never' },
        strategy: defaultStrategy('medium'),
        sessionMode: 'general',
    });

    const planEmphasis = output.instructions.find((i) => i.key === 'plan_emphasis');
    assert.equal(planEmphasis, undefined, 'Should NOT have plan_emphasis when no plan is provided');
    assert.ok(output.instructions.length >= 2, 'Should still have base instructions');
});

test('SystemDesignBrain emits plan_emphasis when plan contains scale_estimation', () => {
    const plan = planReasoning(buildPlanningInput('Design Instagram', 'system_design', 'system_design'));
    const brain = new SystemDesignBrain();

    const output = brain.execute({
        analysis: { ...createAnalysis('system_design'), estimatedDepth: 'deep' },
        context: { sources: [], totalTokens: 0, profileApplied: false, resolvedProfilePolicy: 'never' },
        strategy: defaultStrategy('deep'),
        sessionMode: 'general',
        contextPriority: deriveContextPriority({
            question: 'Design Instagram',
            questionCategory: 'system_design',
            responseDepth: 'deep',
            brainId: 'system_design',
            intent: 'answer_now',
            sessionMode: 'general',
        }),
        reasoningPlan: plan,
    });

    const planEmphasis = output.instructions.find((i) => i.key === 'plan_emphasis');
    assert.ok(planEmphasis, 'Should have plan_emphasis instruction');
    assert.ok(planEmphasis!.content.includes('scale assumptions') || planEmphasis!.content.includes('QPS'),
        'Should emphasize scale assumptions');
    assert.ok(planEmphasis!.content.includes('failure modes'),
        'Should emphasize failure handling');
});

test('BehavioralBrain emits STAR plan_emphasis when plan contains star steps', () => {
    const plan = planReasoning(buildPlanningInput('Tell me about a challenge', 'behavioral', 'behavioral'));
    const brain = new BehavioralBrain();

    const output = brain.execute({
        analysis: createAnalysis('behavioral'),
        context: { sources: [], totalTokens: 0, profileApplied: false, resolvedProfilePolicy: 'never' },
        strategy: defaultStrategy('medium'),
        sessionMode: 'general',
        reasoningPlan: plan,
    });

    const planEmphasis = output.instructions.find((i) => i.key === 'plan_emphasis');
    assert.ok(planEmphasis, 'Should have plan_emphasis instruction');
    assert.ok(planEmphasis!.content.includes('STAR'), 'Should reference STAR framework');
    assert.ok(planEmphasis!.content.includes('first person'), 'Should enforce first person');
});

test('ResumeBrain emits plan_emphasis when plan contains jd_alignment', () => {
    const plan = planReasoning(buildPlanningInput('Tell me about your project', 'resume_jd', 'resume'));
    const brain = new ResumeBrain();

    const output = brain.execute({
        analysis: createAnalysis('resume_jd'),
        context: { sources: [], totalTokens: 0, profileApplied: false, resolvedProfilePolicy: 'never' },
        strategy: defaultStrategy('medium'),
        sessionMode: 'general',
        reasoningPlan: plan,
    });

    const planEmphasis = output.instructions.find((i) => i.key === 'plan_emphasis');
    assert.ok(planEmphasis, 'Should have plan_emphasis instruction');
    assert.ok(planEmphasis!.content.includes('role fit') || planEmphasis!.content.includes('JD'),
        'Should optimize for JD alignment');
    assert.ok(planEmphasis!.content.includes('project') || planEmphasis!.content.includes('measurable'),
        'Should force project grounding');
});

test('GeneralBrain emits plan_emphasis when plan contains quick_definition', () => {
    const plan = planReasoning(buildPlanningInput('What is REST?', 'general', 'general'));
    const brain = new GeneralBrain();

    const output = brain.execute({
        analysis: createAnalysis('general'),
        context: { sources: [], totalTokens: 0, profileApplied: false, resolvedProfilePolicy: 'never' },
        strategy: defaultStrategy('short'),
        sessionMode: 'general',
        reasoningPlan: plan,
    });

    const planEmphasis = output.instructions.find((i) => i.key === 'plan_emphasis');
    assert.ok(planEmphasis, 'Should have plan_emphasis instruction');
    assert.ok(planEmphasis!.content.includes('definition'), 'Should emphasize definition');
    assert.ok(planEmphasis!.content.includes('example'), 'Should emphasize example');
});

// ===========================================================================
// 6. Brains ignore low-confidence plans
// ===========================================================================

test('All Brains ignore plans with confidence below threshold', () => {
    const lowConfidencePlan = createFallbackPlan(); // confidence = 0.3

    const brains = [
        { brain: new CodingBrain(), category: 'coding' },
        { brain: new SystemDesignBrain(), category: 'system_design' },
        { brain: new BehavioralBrain(), category: 'behavioral' },
        { brain: new ResumeBrain(), category: 'resume_jd' },
        { brain: new GeneralBrain(), category: 'general' },
    ];

    for (const { brain, category } of brains) {
        const output = brain.execute({
            analysis: createAnalysis(category),
            context: { sources: [], totalTokens: 0, profileApplied: false, resolvedProfilePolicy: 'never' },
            strategy: defaultStrategy('medium'),
            sessionMode: 'general',
            reasoningPlan: lowConfidencePlan,
        });

        const planEmphasis = output.instructions.find((i) => i.key === 'plan_emphasis');
        assert.equal(planEmphasis, undefined,
            `${brain.name} should NOT emit plan_emphasis for low-confidence plan`);
    }
});

// ===========================================================================
// 7. Helper utilities
// ===========================================================================

test('planContains, planContainsAny, planContainsAll work correctly', () => {
    const plan = planReasoning(buildPlanningInput('Optimize spiral matrix', 'coding', 'coding'));

    assert.ok(planContains(plan, 'algorithm'));
    assert.ok(!planContains(plan, 'star_situation'));

    assert.ok(planContainsAny(plan, ['algorithm', 'star_situation']));
    assert.ok(!planContainsAny(plan, ['star_situation', 'star_task']));

    assert.ok(planContainsAll(plan, ['algorithm', 'optimization']));
    assert.ok(!planContainsAll(plan, ['algorithm', 'star_situation']));
});

// ===========================================================================
// 8. Category coverage — all categories produce valid plans
// ===========================================================================

test('PlanningEngine produces valid plans for every question category', () => {
    const categoryCases: Array<{ question: string; category: PlanningInput['category']; brainId: PlanningInput['brainId'] }> = [
        { question: 'What is a hashmap?', category: 'coding', brainId: 'coding' },
        { question: 'Design whatsapp', category: 'system_design', brainId: 'system_design' },
        { question: 'Tell me about a time you failed', category: 'behavioral', brainId: 'behavioral' },
        { question: 'Walk me through your resume', category: 'resume_jd', brainId: 'resume' },
        { question: 'What is REST?', category: 'general', brainId: 'general' },
        { question: 'Can you clarify that?', category: 'clarification', brainId: 'general' },
        { question: 'Can you go deeper?', category: 'follow_up', brainId: 'general' },
    ];

    for (const testCase of categoryCases) {
        const plan = planReasoning(buildPlanningInput(testCase.question, testCase.category, testCase.brainId));

        assert.ok(plan.steps.length >= 1, `${testCase.category} should produce at least 1 step`);
        assert.ok(plan.confidence >= 0, `${testCase.category} should have non-negative confidence`);
        assert.ok(plan.confidence <= 1, `${testCase.category} should have confidence <= 1`);
        assert.ok(plan.reasoning.length > 0, `${testCase.category} should have reasoning string`);
        assert.ok(
            ['concise', 'moderate', 'detailed'].includes(plan.estimatedVerbosity),
            `${testCase.category} should have valid verbosity`,
        );
    }
});

// ===========================================================================
// 9. Determinism across all categories
// ===========================================================================

test('PlanningEngine is fully deterministic across multiple invocations', () => {
    const questions = [
        { q: 'What is REST?', cat: 'general' as const, brain: 'general' as const },
        { q: 'Optimize spiral matrix', cat: 'coding' as const, brain: 'coding' as const },
        { q: 'Design Instagram', cat: 'system_design' as const, brain: 'system_design' as const },
        { q: 'Tell me about a challenge', cat: 'behavioral' as const, brain: 'behavioral' as const },
        { q: 'Tell me about your project', cat: 'resume_jd' as const, brain: 'resume' as const },
    ];

    for (const { q, cat, brain } of questions) {
        const plan1 = planReasoning(buildPlanningInput(q, cat, brain));
        const plan2 = planReasoning(buildPlanningInput(q, cat, brain));
        const plan3 = planReasoning(buildPlanningInput(q, cat, brain));

        assert.deepEqual(plan1, plan2, `${q} should be deterministic (run 1 vs 2)`);
        assert.deepEqual(plan2, plan3, `${q} should be deterministic (run 2 vs 3)`);
    }
});

// ===========================================================================
// 10. Additional coding sub-patterns
// ===========================================================================

test('PlanningEngine: "Debug memory leak" → core_explanation + optimization + edge_cases', () => {
    const plan = planReasoning(buildPlanningInput('Debug memory leak', 'coding', 'coding'));

    assert.ok(planContains(plan, 'core_explanation'), 'Should contain core_explanation');
    assert.ok(planContains(plan, 'optimization'), 'Should contain optimization');
    assert.ok(planContains(plan, 'edge_cases'), 'Should contain edge_cases');
    assert.ok(isPlanConfident(plan), 'Should be confident');
});

test('PlanningEngine: "Explain Redis caching" → core_explanation + example + tradeoffs', () => {
    const plan = planReasoning(buildPlanningInput('Explain Redis caching', 'system_design', 'system_design'));

    assert.ok(planContains(plan, 'core_explanation'), 'Should contain core_explanation');
    assert.ok(planContains(plan, 'example'), 'Should contain example');
    assert.ok(planContains(plan, 'tradeoffs'), 'Should contain tradeoffs');
    assert.ok(isPlanConfident(plan), 'Should be confident');
});

test('PlanningEngine: "Compare REST vs GraphQL" → quick_definition + comparison + tradeoffs', () => {
    const plan = planReasoning(buildPlanningInput('Compare REST vs GraphQL', 'general', 'general'));

    assert.ok(planContains(plan, 'quick_definition') || planContains(plan, 'core_explanation'),
        'Should contain definition or explanation');
    assert.ok(planContains(plan, 'comparison'), 'Should contain comparison');
    assert.ok(planContains(plan, 'tradeoffs'), 'Should contain tradeoffs');
    assert.ok(isPlanConfident(plan), 'Should be confident');
});
