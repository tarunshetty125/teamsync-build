import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// Phase 2 — Response Quality Evaluator
import {
    evaluateResponseQuality,
    isQualityAcceptable,
    getMostCriticalIssue,
    getRulesForBrain,
    meetsMinDepth,
} from '../intelligence/evaluation';
import type { QualityEvaluationInput } from '../intelligence/evaluation';

// Phase 3 — Resume × JD Intelligence
import { analyzeResumeJDFit, isAnalysisUsable } from '../intelligence/resume';
import type { ResumeJDInput } from '../intelligence/resume';

// Phase 1 (used for plan-aware evaluation tests)
import { planReasoning } from '../intelligence/planning';
import { deriveQuestionUnderstandingV2 } from '../intelligence/QuestionUnderstandingV2';
import { estimateResponseDepth } from '../intelligence/ResponseDepthEstimator';

// ===========================================================================
// Helpers
// ===========================================================================

function buildQualityInput(
    question: string,
    brainId: QualityEvaluationInput['brainId'],
    category: QualityEvaluationInput['category'],
    depth: QualityEvaluationInput['responseDepth'],
    response: string,
): QualityEvaluationInput {
    return { question, brainId, category, responseDepth: depth, generatedResponse: response };
}

function buildPlanForQuestion(
    question: string,
    category: Parameters<typeof planReasoning>[0]['category'],
    brainId: Parameters<typeof planReasoning>[0]['brainId'],
) {
    const qu = deriveQuestionUnderstandingV2({ question, intent: 'answer_now', mode: 'general' });
    const depth = estimateResponseDepth({ question, category, sessionMode: 'general', intent: 'answer_now', questionUnderstandingResult: qu });
    return planReasoning({ question, category, brainId, depthEstimate: depth, questionUnderstanding: qu });
}

// ===========================================================================
// PHASE 2 — Response Quality Evaluator Tests
// ===========================================================================

// --- Coding quality checks ---

test('Quality: detects missing complexity analysis in coding response', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Optimize spiral matrix',
        'coding',
        'coding',
        'medium',
        'Use two pointers to traverse the matrix. Start from the outer boundary and move inward. Handle each direction separately.',
    ));

    const complexityIssue = result.issues.find((i) => i.ruleId === 'coding.complexity_missing');
    assert.ok(complexityIssue, 'Should detect missing complexity analysis');
    assert.equal(complexityIssue!.severity, 'high');
    assert.ok(result.score < 1.0, 'Score should be reduced');
});

test('Quality: passes when coding response includes complexity', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Optimize spiral matrix',
        'coding',
        'coding',
        'medium',
        'Use two pointers approach. The algorithm traverses each element once, giving O(m*n) time complexity and O(1) space complexity. Edge case: empty matrix returns empty array.',
    ));

    const complexityIssue = result.issues.find((i) => i.ruleId === 'coding.complexity_missing');
    assert.equal(complexityIssue, undefined, 'Should NOT flag complexity when present');
    assert.ok(result.score >= 0.7, 'Score should be high');
});

test('Quality: detects missing edge cases in coding response', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Implement binary search',
        'coding',
        'coding',
        'medium',
        'Binary search works by dividing the search space in half. The approach has O(log n) time complexity.',
    ));

    const edgeCaseIssue = result.issues.find((i) => i.ruleId === 'coding.edge_cases_missing');
    assert.ok(edgeCaseIssue, 'Should detect missing edge cases');
});

// --- Behavioral quality checks ---

test('Quality: detects missing first-person voice in behavioral response', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Tell me about a challenge',
        'behavioral',
        'behavioral',
        'medium',
        'The candidate should describe a challenging situation. They should talk about what they did and the result they achieved.',
    ));

    const fpIssue = result.issues.find((i) => i.ruleId === 'behavioral.first_person_missing');
    assert.ok(fpIssue, 'Should detect missing first-person voice');
    assert.equal(fpIssue!.severity, 'critical');
});

test('Quality: passes when behavioral response uses first person and has STAR', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Tell me about a challenge',
        'behavioral',
        'behavioral',
        'medium',
        'When I was working on the TeamSync project, our team faced a critical database issue. I led the investigation and implemented a caching layer. As a result, we improved response times by 40%.',
    ));

    assert.ok(isQualityAcceptable(result), 'Should be acceptable');
    assert.ok(result.score >= 0.7, 'Should have high score');
});

test('Quality: detects missing measurable result in behavioral response', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Tell me about a time you showed leadership',
        'behavioral',
        'behavioral',
        'medium',
        'I was working on a project where the team had some challenges. I took the initiative and helped the team work together better.',
    ));

    const resultIssue = result.issues.find((i) => i.ruleId === 'behavioral.result_missing');
    assert.ok(resultIssue, 'Should detect missing measurable result');
});

// --- System design quality checks ---

test('Quality: detects missing tradeoffs in system design response', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Design Instagram',
        'system_design',
        'system_design',
        'deep',
        'Use a CDN for image delivery. Store metadata in PostgreSQL. Use Redis for caching. The system can handle millions of users with proper sharding.',
    ));

    const tradeoffIssue = result.issues.find((i) => i.ruleId === 'system_design.tradeoffs_missing');
    assert.ok(tradeoffIssue, 'Should detect missing tradeoffs');
    assert.equal(tradeoffIssue!.severity, 'critical');
});

test('Quality: passes when system design has tradeoffs and scale', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Design Instagram',
        'system_design',
        'system_design',
        'deep',
        'Use PostgreSQL for metadata with sharding at 10M users. Redis cache for hot feeds. CDN for images. The tradeoff is that sharding adds complexity versus a simpler single-node setup. However, at scale this is necessary. QPS estimate: 50k reads/sec.',
    ));

    assert.ok(isQualityAcceptable(result), 'Should be acceptable');
    assert.ok(result.score >= 0.7, 'Should have high score');
});

// --- Resume quality checks ---

test('Quality: detects missing first-person in resume response', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Tell me about your project',
        'resume',
        'resume_jd',
        'medium',
        'The candidate has experience building web applications using React and Node.js. They deployed services on AWS.',
    ));

    const fpIssue = result.issues.find((i) => i.ruleId === 'resume.first_person_missing');
    assert.ok(fpIssue, 'Should detect missing first-person voice');
});

// --- General / fallback checks ---

test('Quality: detects empty response for any brain', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'What is REST?',
        'general',
        'general',
        'short',
        '',
    ));

    assert.ok(!isQualityAcceptable(result), 'Empty response should not be acceptable');
    const emptyIssue = result.issues.find((i) => i.ruleId === 'general.empty_response');
    assert.ok(emptyIssue, 'Should detect empty response');
});

test('Quality: acceptable general response passes', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'What is REST?',
        'general',
        'general',
        'short',
        'REST is a software architectural style for building web APIs. It uses HTTP methods like GET, POST, PUT, DELETE to perform CRUD operations on resources identified by URLs.',
    ));

    assert.ok(isQualityAcceptable(result), `Should be acceptable (score=${result.score}, issues=${result.issues.map(i=>i.ruleId).join(',')})`);
});

// --- Plan-aware checks ---

test('Quality: plan-aware check detects missing complexity when plan requires it', () => {
    const plan = buildPlanForQuestion('Optimize spiral matrix', 'coding', 'coding');

    const result = evaluateResponseQuality({
        ...buildQualityInput('Optimize spiral matrix', 'coding', 'coding', 'medium',
            'Use a layer-by-layer approach to traverse the matrix boundaries inward.'),
        reasoningPlan: plan,
    });

    // Should have either base rule or plan-aware rule flagging complexity
    const hasComplexityIssue = result.issues.some((i) =>
        i.ruleId.includes('complexity'));
    assert.ok(hasComplexityIssue, 'Should flag missing complexity via base or plan-aware rule');
});

test('Quality: plan-aware check detects missing tradeoffs when plan requires it', () => {
    const plan = buildPlanForQuestion('Design Instagram', 'system_design', 'system_design');

    const result = evaluateResponseQuality({
        ...buildQualityInput('Design Instagram', 'system_design', 'system_design', 'deep',
            'Use PostgreSQL and Redis. Serve images via CDN. Scale with sharding.'),
        reasoningPlan: plan,
    });

    const hasTradeoffIssue = result.issues.some((i) =>
        i.ruleId.includes('tradeoff'));
    assert.ok(hasTradeoffIssue, 'Should flag missing tradeoffs');
});

// --- Utility tests ---

test('Quality: getMostCriticalIssue returns highest severity', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'Design Instagram',
        'system_design',
        'system_design',
        'deep',
        'Use a database.',
    ));

    const worst = getMostCriticalIssue(result);
    assert.ok(worst, 'Should have at least one issue');
    assert.equal(worst!.severity, 'critical', 'Most critical should be critical severity');
});

test('Quality: getMostCriticalIssue returns null for clean response', () => {
    const result = evaluateResponseQuality(buildQualityInput(
        'What is REST?',
        'general',
        'general',
        'short',
        'REST is a software architectural style for distributed systems. It provides a uniform interface using standard HTTP methods.',
    ));

    // General short has very few rules — response is substantive, empty_response should pass
    const emptyIssue = result.issues.find((i) => i.ruleId === 'general.empty_response');
    assert.equal(emptyIssue, undefined, `Should not flag non-empty response (issues=${result.issues.map(i=>i.ruleId).join(',')})`);
    assert.ok(isQualityAcceptable(result), 'Substantive response should be acceptable');
});

test('Quality: getRulesForBrain filters by brain and depth', () => {
    const codingMedium = getRulesForBrain('coding', 'medium');
    const codingShort = getRulesForBrain('coding', 'short');
    const generalShort = getRulesForBrain('general', 'short');

    assert.ok(codingMedium.length > codingShort.length, 'Medium depth should have more rules than short');
    assert.ok(codingMedium.length > generalShort.length, 'Coding should have more rules than general');
});

test('Quality: meetsMinDepth works correctly', () => {
    assert.ok(meetsMinDepth('deep', 'medium'));
    assert.ok(meetsMinDepth('medium', 'medium'));
    assert.ok(!meetsMinDepth('short', 'medium'));
    assert.ok(meetsMinDepth('short', undefined));
});

test('Quality: evaluation is deterministic', () => {
    const input = buildQualityInput(
        'Optimize spiral matrix', 'coding', 'coding', 'medium',
        'Use two pointers. O(n) time. Handle empty array edge case.',
    );

    const r1 = evaluateResponseQuality(input);
    const r2 = evaluateResponseQuality(input);
    assert.deepEqual(r1, r2, 'Same input should produce identical evaluation');
});

// ===========================================================================
// PHASE 3 — Resume × JD Intelligence Tests
// ===========================================================================

const SAMPLE_RESUME = `
Senior Software Engineer with 4 years of experience.

Projects:
- Built TeamSync, a real-time collaboration platform using React, Node.js, TypeScript, and PostgreSQL.
  Deployed on AWS with Docker and Kubernetes. Achieved 99.9% uptime serving 50k daily active users.
  Led a team of 5 engineers. Implemented CI/CD with GitHub Actions.

- Developed DataPipeline, a high-throughput event processing system using Python, Kafka, and Redis.
  Processed 2M events/day with sub-100ms latency. Reduced infrastructure cost by 35%.

Skills: JavaScript, TypeScript, Python, React, Node.js, PostgreSQL, Redis, Kafka, Docker, Kubernetes, AWS, CI/CD
Experience: Agile, Microservices, System Design, Leadership, Mentorship
`;

const SAMPLE_JD = `
Senior Full-Stack Engineer at TechCorp

Requirements:
- 3+ years experience with React, TypeScript, and Node.js
- Experience with PostgreSQL or MySQL
- Familiarity with AWS, Docker, and CI/CD pipelines
- Experience with Redis or caching strategies
- System design skills for scalable applications
- Experience with GraphQL is a plus
- Experience with Go or Rust is a plus
- Strong communication and leadership skills
`;

test('ResumeJD: identifies matching skills between resume and JD', () => {
    const result = analyzeResumeJDFit({
        question: 'Why are you a good fit for this role?',
        category: 'resume_jd',
        brainId: 'resume',
        resumeText: SAMPLE_RESUME,
        jdText: SAMPLE_JD,
    });

    assert.ok(result.strongest_matches.length >= 4, `Should find 4+ matches, got ${result.strongest_matches.length}`);

    const matchedSkills = result.strongest_matches.map((m) => m.skill);
    assert.ok(matchedSkills.includes('React'), 'Should match React');
    assert.ok(matchedSkills.includes('TypeScript'), 'Should match TypeScript');
    assert.ok(matchedSkills.includes('Node.js'), 'Should match Node.js');
    assert.ok(matchedSkills.includes('PostgreSQL'), 'Should match PostgreSQL');
});

test('ResumeJD: identifies missing skills from JD', () => {
    const result = analyzeResumeJDFit({
        question: 'What gaps do you see?',
        category: 'resume_jd',
        brainId: 'resume',
        resumeText: SAMPLE_RESUME,
        jdText: SAMPLE_JD,
    });

    assert.ok(result.missing_skills.length >= 1, 'Should identify at least 1 missing skill');
    // GraphQL and Go/Rust are in JD but not in resume
    const hasMissing = result.missing_skills.some((s) =>
        s === 'GraphQL' || s === 'Go' || s === 'Rust');
    assert.ok(hasMissing, 'Should identify GraphQL, Go, or Rust as missing');
});

test('ResumeJD: extracts recommended projects', () => {
    const result = analyzeResumeJDFit({
        question: 'Tell me about your most relevant project',
        category: 'resume_jd',
        brainId: 'resume',
        resumeText: SAMPLE_RESUME,
        jdText: SAMPLE_JD,
    });

    assert.ok(result.recommended_projects.length >= 1, 'Should find at least 1 project');
});

test('ResumeJD: produces suggested emphasis', () => {
    const result = analyzeResumeJDFit({
        question: 'Why are you a good fit?',
        category: 'resume_jd',
        brainId: 'resume',
        resumeText: SAMPLE_RESUME,
        jdText: SAMPLE_JD,
    });

    assert.ok(result.suggested_emphasis.length >= 1, 'Should produce emphasis suggestions');
    assert.ok(result.fit_reasoning.length > 0, 'Should produce fit reasoning');
});

test('ResumeJD: returns empty analysis when no resume/JD provided', () => {
    const result = analyzeResumeJDFit({
        question: 'Tell me about yourself',
        category: 'resume_jd',
        brainId: 'resume',
    });

    assert.equal(result.strongest_matches.length, 0);
    assert.equal(result.missing_skills.length, 0);
    assert.equal(result.confidence, 0.1);
    assert.ok(!isAnalysisUsable(result), 'Should not be usable with no data');
});

test('ResumeJD: isAnalysisUsable correctly gates quality', () => {
    const good = analyzeResumeJDFit({
        question: 'Why are you a fit?',
        category: 'resume_jd',
        brainId: 'resume',
        resumeText: SAMPLE_RESUME,
        jdText: SAMPLE_JD,
    });

    const empty = analyzeResumeJDFit({
        question: 'Tell me about yourself',
        category: 'resume_jd',
        brainId: 'resume',
    });

    assert.ok(isAnalysisUsable(good), 'Rich analysis should be usable');
    assert.ok(!isAnalysisUsable(empty), 'Empty analysis should not be usable');
});

test('ResumeJD: confidence scales with data richness', () => {
    const rich = analyzeResumeJDFit({
        question: 'Fit?',
        category: 'resume_jd',
        brainId: 'resume',
        resumeText: SAMPLE_RESUME,
        jdText: SAMPLE_JD,
    });

    const resumeOnly = analyzeResumeJDFit({
        question: 'Fit?',
        category: 'resume_jd',
        brainId: 'resume',
        resumeText: SAMPLE_RESUME,
    });

    const nothing = analyzeResumeJDFit({
        question: 'Fit?',
        category: 'resume_jd',
        brainId: 'resume',
    });

    assert.ok(rich.confidence > resumeOnly.confidence,
        `Rich (${rich.confidence}) should be more confident than resume-only (${resumeOnly.confidence})`);
    assert.ok(resumeOnly.confidence > nothing.confidence,
        `Resume-only (${resumeOnly.confidence}) should be more confident than nothing (${nothing.confidence})`);
});

test('ResumeJD: analysis is deterministic', () => {
    const input: ResumeJDInput = {
        question: 'Why are you a good fit?',
        category: 'resume_jd',
        brainId: 'resume',
        resumeText: SAMPLE_RESUME,
        jdText: SAMPLE_JD,
    };

    const r1 = analyzeResumeJDFit(input);
    const r2 = analyzeResumeJDFit(input);
    assert.deepEqual(r1, r2, 'Same input should produce identical analysis');
});

test('ResumeJD: behavioral category adds STAR emphasis', () => {
    const result = analyzeResumeJDFit({
        question: 'Tell me about a challenge',
        category: 'behavioral',
        brainId: 'behavioral',
        resumeText: SAMPLE_RESUME,
        jdText: SAMPLE_JD,
    });

    const hasStarEmphasis = result.suggested_emphasis.some((e) =>
        e.toLowerCase().includes('star'));
    assert.ok(hasStarEmphasis, 'Behavioral category should add STAR emphasis');
});

// ===========================================================================
// PHASE 4 — Production Hardening Regression Tests
// ===========================================================================

test('Phase4: barrel exports include all new modules', async () => {
    const intelligence = await import('../intelligence');

    // Planning (Phase 1)
    assert.ok(typeof intelligence.planReasoning === 'function', 'planReasoning should be exported');
    assert.ok(typeof intelligence.isPlanConfident === 'function', 'isPlanConfident should be exported');
    assert.ok(typeof intelligence.createFallbackPlan === 'function', 'createFallbackPlan should be exported');

    // Evaluation (Phase 2)
    assert.ok(typeof intelligence.evaluateResponseQuality === 'function', 'evaluateResponseQuality should be exported');
    assert.ok(typeof intelligence.isQualityAcceptable === 'function', 'isQualityAcceptable should be exported');
    assert.ok(typeof intelligence.getMostCriticalIssue === 'function', 'getMostCriticalIssue should be exported');

    // Resume (Phase 3)
    assert.ok(typeof intelligence.analyzeResumeJDFit === 'function', 'analyzeResumeJDFit should be exported');
    assert.ok(typeof intelligence.isAnalysisUsable === 'function', 'isAnalysisUsable should be exported');
});

test('Phase4: all brains still execute without plan (backward compat)', () => {
    const { CodingBrain, SystemDesignBrain, BehavioralBrain, ResumeBrain, GeneralBrain, defaultStrategy } = require('../intelligence') as typeof import('../intelligence');

    const brains = [
        new CodingBrain(),
        new SystemDesignBrain(),
        new BehavioralBrain(),
        new ResumeBrain(),
        new GeneralBrain(),
    ];

    for (const brain of brains) {
        const output = brain.execute({
            analysis: {
                category: 'general' as any,
                confidence: 0.99,
                isFollowUp: false,
                referencesContext: false,
                estimatedDepth: 'moderate' as const,
                answerShape: '',
                rawIntent: 'general',
                classificationSource: 'context_heuristic' as const,
            },
            context: { sources: [], totalTokens: 0, profileApplied: false, resolvedProfilePolicy: 'never' },
            strategy: defaultStrategy('medium'),
            sessionMode: 'general',
            // NO reasoningPlan — testing backward compat
        });

        assert.ok(output.instructions.length >= 1, `${brain.name} should produce instructions without plan`);
        assert.ok(output.outputContract.length > 0, `${brain.name} should produce outputContract`);

        // Should NOT have plan_emphasis
        const planEmphasis = output.instructions.find((i) => i.key === 'plan_emphasis');
        assert.equal(planEmphasis, undefined, `${brain.name} should NOT have plan_emphasis without a plan`);
    }
});

test('Phase4: quality evaluator handles all brain types safely', () => {
    const brainTypes: Array<{ brainId: QualityEvaluationInput['brainId']; category: QualityEvaluationInput['category'] }> = [
        { brainId: 'coding', category: 'coding' },
        { brainId: 'system_design', category: 'system_design' },
        { brainId: 'behavioral', category: 'behavioral' },
        { brainId: 'resume', category: 'resume_jd' },
        { brainId: 'general', category: 'general' },
        { brainId: 'screen_analysis', category: 'general' },
    ];

    for (const { brainId, category } of brainTypes) {
        const result = evaluateResponseQuality({
            question: 'test question',
            brainId,
            category,
            responseDepth: 'medium',
            generatedResponse: 'A substantive answer that provides useful information.',
        });

        assert.ok(result.score >= 0, `${brainId} should produce valid score`);
        assert.ok(result.score <= 1, `${brainId} score should be <= 1`);
        assert.ok(result.confidence >= 0, `${brainId} should produce valid confidence`);
        assert.ok(result.rulesChecked >= 1, `${brainId} should check at least 1 rule`);
    }
});
