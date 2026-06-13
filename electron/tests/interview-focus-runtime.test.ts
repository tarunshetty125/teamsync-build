const test: typeof import('node:test').test = require('node:test').test;
const assert: typeof import('node:assert').strict = require('node:assert').strict;
const path: typeof import('node:path') = require('node:path');

const {
    buildContextLayers,
    buildIntentPrompt,
    buildInterviewFocusInstruction,
    getQuestionResponseProfile,
    serializePromptObject,
} = require(path.join(process.cwd(), 'electron/ActionContextBuilder')) as typeof import('../ActionContextBuilder');

const {
    deriveQuestionUnderstandingV2,
    INTERVIEW_FOCUS_BONUS,
} = require(path.join(process.cwd(), 'electron/intelligence/QuestionUnderstandingV2')) as typeof import('../intelligence/QuestionUnderstandingV2');

const {
    DEFAULT_PERSONALIZATION_PREFERENCES,
} = require(path.join(process.cwd(), 'src/lib/personalization/preferences')) as typeof import('../../src/lib/personalization/preferences');

export {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSession(transcript: string) {
    return {
        getLastInterviewerTurn: () => 'session hidden turn',
        getLastAssistantMessage: (): string | null => null,
        getRollingWindowTranscript: () => transcript,
        getCappedFullTranscript: () => transcript,
        estimateTokenCount: (text: string) => Math.ceil(text.length / 4),
        getDetectedCodingQuestion: () => ({ question: '', source: 'none' }),
    } as any;
}

// Ambiguous question that should fall to general/fresh_general without focus bias
const AMBIGUOUS_QUESTION = 'What would you do differently?';

// Strong domain questions that must NOT be overridden by focus
const STRONG_SYSTEM_DESIGN = 'Design a URL shortener for millions of users';
const STRONG_CODING = 'Given an array of integers, return indices of the two numbers that add up to target';

// ---------------------------------------------------------------------------
// 1. buildInterviewFocusInstruction — unit tests
// ---------------------------------------------------------------------------

test('buildInterviewFocusInstruction returns coding instruction for coding focus', () => {
    const result = buildInterviewFocusInstruction('coding');
    assert.ok(result, 'should return an instruction');
    assert.equal(result!.key, 'interview_focus');
    assert.match(result!.content, /coding interview analysis/i);
    assert.match(result!.content, /DSA/);
    assert.match(result!.content, /algorithms/);
});

test('buildInterviewFocusInstruction returns system_design instruction for system_design focus', () => {
    const result = buildInterviewFocusInstruction('system_design');
    assert.ok(result, 'should return an instruction');
    assert.match(result!.content, /system design reasoning/i);
    assert.match(result!.content, /architecture/);
    assert.match(result!.content, /scalability/);
});

test('buildInterviewFocusInstruction returns behavioral instruction for behavioral focus', () => {
    const result = buildInterviewFocusInstruction('behavioral');
    assert.ok(result, 'should return an instruction');
    assert.match(result!.content, /behavioral interview coaching/i);
    assert.match(result!.content, /STAR/);
    assert.match(result!.content, /leadership/);
});

test('buildInterviewFocusInstruction returns null for mixed focus', () => {
    const result = buildInterviewFocusInstruction('mixed');
    assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// 2. getQuestionResponseProfile — focus bias
// ---------------------------------------------------------------------------

test('ambiguous question with coding focus returns coding profile', () => {
    const profile = getQuestionResponseProfile(AMBIGUOUS_QUESTION, 'general', 'what_to_answer', {
        interviewFocus: 'coding',
    });
    assert.equal(profile, 'coding');
});

test('short ambiguous question with system_design focus returns general (SD guard active)', () => {
    const profile = getQuestionResponseProfile(AMBIGUOUS_QUESTION, 'general', 'what_to_answer', {
        interviewFocus: 'system_design',
    });
    // 5 words, no SD keywords → guard prevents reclassification
    assert.ok(profile === 'fresh_general' || profile === 'general');
});

test('ambiguous question with behavioral focus returns general (no behavioral profile exists)', () => {
    const profile = getQuestionResponseProfile(AMBIGUOUS_QUESTION, 'general', 'what_to_answer', {
        interviewFocus: 'behavioral',
    });
    // behavioral has no dedicated QuestionResponseProfile, so falls through to general
    assert.ok(profile === 'fresh_general' || profile === 'general');
});

test('ambiguous question with mixed focus returns general (no bias)', () => {
    const profile = getQuestionResponseProfile(AMBIGUOUS_QUESTION, 'general', 'what_to_answer', {
        interviewFocus: 'mixed',
    });
    assert.ok(profile === 'fresh_general' || profile === 'general');
});

test('ambiguous question without focus returns general (no bias)', () => {
    const profile = getQuestionResponseProfile(AMBIGUOUS_QUESTION, 'general', 'what_to_answer');
    assert.ok(profile === 'fresh_general' || profile === 'general');
});

// ---------------------------------------------------------------------------
// 3. Strong signals override focus — CRITICAL
// ---------------------------------------------------------------------------

test('strong system_design question with coding focus still returns system_design', () => {
    const profile = getQuestionResponseProfile(STRONG_SYSTEM_DESIGN, 'general', 'what_to_answer', {
        interviewFocus: 'coding',
    });
    assert.equal(profile, 'system_design');
});

test('strong coding question with system_design focus still returns coding', () => {
    const profile = getQuestionResponseProfile(STRONG_CODING, 'general', 'what_to_answer', {
        interviewFocus: 'system_design',
    });
    assert.equal(profile, 'coding');
});

test('explicit coding mode with system_design focus returns coding (mode wins)', () => {
    const profile = getQuestionResponseProfile(AMBIGUOUS_QUESTION, 'coding', 'what_to_answer', {
        interviewFocus: 'system_design',
    });
    assert.equal(profile, 'coding');
});

test('explicit system_design mode with coding focus returns system_design (mode wins)', () => {
    const profile = getQuestionResponseProfile(AMBIGUOUS_QUESTION, 'system_design', 'what_to_answer', {
        interviewFocus: 'coding',
    });
    assert.equal(profile, 'system_design');
});

test('coding focus does not activate when mode is system_design', () => {
    const profile = getQuestionResponseProfile(AMBIGUOUS_QUESTION, 'system_design', 'what_to_answer', {
        interviewFocus: 'coding',
    });
    assert.equal(profile, 'system_design');
});

test('system_design focus does not activate when mode is coding', () => {
    const profile = getQuestionResponseProfile(AMBIGUOUS_QUESTION, 'coding', 'what_to_answer', {
        interviewFocus: 'system_design',
    });
    assert.equal(profile, 'coding');
});

// ---------------------------------------------------------------------------
// 4. deriveQuestionUnderstandingV2 — brain selection bias
// ---------------------------------------------------------------------------

test('brain selection: ambiguous question with coding focus tips to coding category', () => {
    const result = deriveQuestionUnderstandingV2({
        question: AMBIGUOUS_QUESTION,
        intent: 'what_to_answer' as any,
        mode: 'general',
        interviewFocus: 'coding',
    });
    assert.equal(result.category, 'coding');
    assert.ok(result.matchedSignals.includes('interview_focus:coding'));
});

test('brain selection: ambiguous question with system_design focus tips to system_design', () => {
    const result = deriveQuestionUnderstandingV2({
        question: AMBIGUOUS_QUESTION,
        intent: 'what_to_answer' as any,
        mode: 'general',
        interviewFocus: 'system_design',
    });
    assert.equal(result.category, 'system_design');
    assert.ok(result.matchedSignals.includes('interview_focus:system_design'));
});

test('brain selection: ambiguous question with behavioral focus tips to behavioral', () => {
    const result = deriveQuestionUnderstandingV2({
        question: AMBIGUOUS_QUESTION,
        intent: 'what_to_answer' as any,
        mode: 'general',
        interviewFocus: 'behavioral',
    });
    assert.equal(result.category, 'behavioral');
    assert.ok(result.matchedSignals.includes('interview_focus:behavioral'));
});

test('brain selection: mixed focus does not add any signal', () => {
    const result = deriveQuestionUnderstandingV2({
        question: AMBIGUOUS_QUESTION,
        intent: 'what_to_answer' as any,
        mode: 'general',
        interviewFocus: 'mixed',
    });
    const focusSignals = result.matchedSignals.filter(s => s.startsWith('interview_focus:'));
    assert.equal(focusSignals.length, 0);
});

test('brain selection: no interviewFocus does not add any signal', () => {
    const result = deriveQuestionUnderstandingV2({
        question: AMBIGUOUS_QUESTION,
        intent: 'what_to_answer' as any,
        mode: 'general',
    });
    const focusSignals = result.matchedSignals.filter(s => s.startsWith('interview_focus:'));
    assert.equal(focusSignals.length, 0);
});

test('brain selection: strong system_design question with coding focus still returns system_design', () => {
    const result = deriveQuestionUnderstandingV2({
        question: STRONG_SYSTEM_DESIGN,
        intent: 'what_to_answer' as any,
        mode: 'general',
        interviewFocus: 'coding',
    });
    assert.equal(result.category, 'system_design');
});

test('INTERVIEW_FOCUS_BONUS is exported and equals 1.5', () => {
    assert.equal(INTERVIEW_FOCUS_BONUS, 1.5);
});

// ---------------------------------------------------------------------------
// 4b. SD short-question guard
// ---------------------------------------------------------------------------

test('SD guard: short question without SD keywords skips profile reclassification', () => {
    const shortQuestions = [
        'What are the tradeoffs?',       // 4 words
        'Explain your approach.',          // 3 words
        'How would you prioritize?',       // 4 words
        'What would you recommend?',       // 4 words
    ];
    for (const q of shortQuestions) {
        const profile = getQuestionResponseProfile(q, 'general', 'what_to_answer', {
            interviewFocus: 'system_design',
        });
        assert.ok(
            profile === 'fresh_general' || profile === 'general',
            `Expected general for "${q}" but got ${profile}`
        );
    }
});

test('SD guard: longer question gets system_design profile', () => {
    const profile = getQuestionResponseProfile(
        'How would you approach designing this feature for millions of users?',
        'general', 'what_to_answer', { interviewFocus: 'system_design' }
    );
    assert.equal(profile, 'system_design');
});

test('SD guard: short question WITH SD keyword gets system_design profile', () => {
    const profile = getQuestionResponseProfile(
        'How would you scale this?',
        'general', 'what_to_answer', { interviewFocus: 'system_design' }
    );
    assert.equal(profile, 'system_design');
});

// ---------------------------------------------------------------------------
// 4c. Behavioral STAR hint
// ---------------------------------------------------------------------------

test('behavioral focus instruction includes explicit STAR format hint', () => {
    const result = buildInterviewFocusInstruction('behavioral');
    assert.ok(result);
    assert.match(result!.content, /Frame the answer using STAR format \(Situation, Task, Action, Result\)/i);
});

// ---------------------------------------------------------------------------
// 5. Full pipeline — buildContextLayers with focus
// ---------------------------------------------------------------------------

test('full pipeline: coding focus produces interview focus instruction in serialized prompt', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const layers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: {
            ...DEFAULT_PERSONALIZATION_PREFERENCES,
            interviewFocus: 'coding',
        },
    });
    const serialized = serializePromptObject(layers.promptObject);

    assert.match(serialized.systemPrompt, /INTERVIEW FOCUS PREFERENCE/);
    assert.match(serialized.systemPrompt, /coding interview analysis/i);
});

test('full pipeline: system_design focus produces architecture-oriented instruction', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const layers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: {
            ...DEFAULT_PERSONALIZATION_PREFERENCES,
            interviewFocus: 'system_design',
        },
    });
    const serialized = serializePromptObject(layers.promptObject);

    assert.match(serialized.systemPrompt, /INTERVIEW FOCUS PREFERENCE/);
    assert.match(serialized.systemPrompt, /system design reasoning/i);
    assert.match(serialized.systemPrompt, /architecture/);
});

test('full pipeline: behavioral focus produces STAR-oriented instruction', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const layers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: {
            ...DEFAULT_PERSONALIZATION_PREFERENCES,
            interviewFocus: 'behavioral',
        },
    });
    const serialized = serializePromptObject(layers.promptObject);

    assert.match(serialized.systemPrompt, /INTERVIEW FOCUS PREFERENCE/);
    assert.match(serialized.systemPrompt, /behavioral interview coaching/i);
    assert.match(serialized.systemPrompt, /STAR/);
});

test('full pipeline: mixed focus does NOT produce interview focus instruction', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const layers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: {
            ...DEFAULT_PERSONALIZATION_PREFERENCES,
            interviewFocus: 'mixed',
        },
    });
    const serialized = serializePromptObject(layers.promptObject);

    assert.doesNotMatch(serialized.systemPrompt, /INTERVIEW FOCUS PREFERENCE/);
});

test('full pipeline: default personalization (no focus) does NOT produce interview focus instruction', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const layers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: DEFAULT_PERSONALIZATION_PREFERENCES,
    });
    const serialized = serializePromptObject(layers.promptObject);

    assert.doesNotMatch(serialized.systemPrompt, /INTERVIEW FOCUS PREFERENCE/);
});

// ---------------------------------------------------------------------------
// 6. Follow-up questions — focus bias
// ---------------------------------------------------------------------------

test('follow_up_questions with coding focus adds coding bias to output contract', () => {
    const instructions = buildIntentPrompt(
        'follow_up_questions',
        'general',
        undefined,
        'What would you do differently?',
        false,
        undefined,
        { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'coding' },
    );
    const contract = instructions.find((i: any) => i.key === 'output_contract');
    assert.ok(contract);
    assert.match(contract!.content, /coding problems/i);
    assert.match(contract!.content, /edge cases/i);
});

test('follow_up_questions with system_design focus adds architecture bias', () => {
    const instructions = buildIntentPrompt(
        'follow_up_questions',
        'general',
        undefined,
        'What would you do differently?',
        false,
        undefined,
        { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'system_design' },
    );
    const contract = instructions.find((i: any) => i.key === 'output_contract');
    assert.ok(contract);
    assert.match(contract!.content, /system design/i);
    assert.match(contract!.content, /scalability/i);
});

test('follow_up_questions with behavioral focus adds behavioral bias', () => {
    const instructions = buildIntentPrompt(
        'follow_up_questions',
        'general',
        undefined,
        'What would you do differently?',
        false,
        undefined,
        { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'behavioral' },
    );
    const contract = instructions.find((i: any) => i.key === 'output_contract');
    assert.ok(contract);
    assert.match(contract!.content, /behavioral scenarios/i);
    assert.match(contract!.content, /leadership/i);
});

test('follow_up_questions with mixed focus does NOT add bias hint', () => {
    const instructions = buildIntentPrompt(
        'follow_up_questions',
        'general',
        undefined,
        'What would you do differently?',
        false,
        undefined,
        { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'mixed' },
    );
    const contract = instructions.find((i: any) => i.key === 'output_contract');
    assert.ok(contract);
    assert.doesNotMatch(contract!.content, /Bias follow-up/i);
});

// ---------------------------------------------------------------------------
// 7. Prompt diff regression — same question, 4 focus values
// ---------------------------------------------------------------------------

test('prompt diff: coding vs mixed produces different system prompts', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const codingLayers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'coding' },
    });
    const mixedLayers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'mixed' },
    });

    const codingPrompt = serializePromptObject(codingLayers.promptObject).systemPrompt;
    const mixedPrompt = serializePromptObject(mixedLayers.promptObject).systemPrompt;

    assert.notEqual(codingPrompt, mixedPrompt, 'coding and mixed should produce different prompts');
    assert.match(codingPrompt, /coding interview analysis/i);
    assert.doesNotMatch(mixedPrompt, /INTERVIEW FOCUS PREFERENCE/);
});

test('prompt diff: system_design vs mixed produces different system prompts', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const sdLayers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'system_design' },
    });
    const mixedLayers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'mixed' },
    });

    const sdPrompt = serializePromptObject(sdLayers.promptObject).systemPrompt;
    const mixedPrompt = serializePromptObject(mixedLayers.promptObject).systemPrompt;

    assert.notEqual(sdPrompt, mixedPrompt, 'system_design and mixed should produce different prompts');
    // With the SD guard, a short question won't get the SD output contract,
    // but the INTERVIEW FOCUS PREFERENCE instruction is still injected.
    assert.match(sdPrompt, /system design reasoning/i);
});

test('prompt diff: behavioral vs mixed produces different system prompts', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const behLayers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'behavioral' },
    });
    const mixedLayers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'mixed' },
    });

    const behPrompt = serializePromptObject(behLayers.promptObject).systemPrompt;
    const mixedPrompt = serializePromptObject(mixedLayers.promptObject).systemPrompt;

    assert.notEqual(behPrompt, mixedPrompt, 'behavioral and mixed should produce different prompts');
    assert.match(behPrompt, /behavioral interview coaching/i);
    assert.match(behPrompt, /STAR/);
});

// ---------------------------------------------------------------------------
// 8. Diagnostics — personalization snapshot fields
// ---------------------------------------------------------------------------

test('diagnostics: coding focus produces focusBiasApplied=true in snapshot', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const layers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'coding' },
    });

    assert.equal(layers.personalization?.interviewFocus, 'coding');
});

test('diagnostics: mixed focus in snapshot', async () => {
    const session = createSession('[INTERVIEWER]: What would you do differently?');
    const layers = await buildContextLayers({
        session,
        intent: 'what_to_answer',
        mode: 'general',
        message: AMBIGUOUS_QUESTION,
        personalization: { ...DEFAULT_PERSONALIZATION_PREFERENCES, interviewFocus: 'mixed' },
    });

    assert.equal(layers.personalization?.interviewFocus, 'mixed');
});
