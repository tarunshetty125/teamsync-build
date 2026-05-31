const test: typeof import('node:test').test = require('node:test').test;
const assert: typeof import('node:assert').strict = require('node:assert').strict;
const path: typeof import('node:path') = require('node:path');

const {
    buildContextLayers,
    buildIntentPrompt,
    buildTranscriptContext,
    serializePromptObject,
} = require(path.join(process.cwd(), 'electron/ActionContextBuilder')) as typeof import('../ActionContextBuilder');

export {};

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

test('buildTranscriptContext omits transcript for standalone manual chat questions', () => {
    const session = createSession('[INTERVIEWER]: Charlie Daniels.\n[ME]: Respect you.');

    const result = buildTranscriptContext(
        session,
        'manual_chat',
        'who are you',
        'general'
    );

    assert.equal(result.content, '[NO TRANSCRIPT AVAILABLE]');
    assert.equal(result.approxTokens, 0);
});

test('buildTranscriptContext keeps transcript for follow-up manual chat questions', () => {
    const transcript = '[INTERVIEWER]: Tell me about your project.\n[ME]: I built the backend.';
    const session = createSession(transcript);

    const result = buildTranscriptContext(
        session,
        'manual_chat',
        'can you elaborate on that?',
        'general'
    );

    assert.equal(result.content, transcript);
    assert.ok(result.approxTokens > 0);
});

test('transcriptOverride replaces hidden session transcript', () => {
    const session = createSession('[INTERVIEWER]: hidden transcript B');

    const result = buildTranscriptContext(
        session,
        'what_to_answer',
        'Design Uber ride matching',
        'system_design',
        { transcriptOverride: '[INTERVIEWER]: frozen visible transcript A' }
    );

    assert.equal(result.content, '[INTERVIEWER]: frozen visible transcript A');
    assert.doesNotMatch(result.content, /hidden transcript B/);
});

test('hint action contract cannot ask for a full coding solution', () => {
    const instructions = buildIntentPrompt(
        'what_to_answer',
        'coding',
        undefined,
        'solve two sum',
        false,
        'hint_only'
    );
    const contract = instructions.find((instruction) => instruction.key === 'output_contract');

    assert.ok(contract);
    assert.match(contract!.content, /Return hints only/);
    assert.match(contract!.content, /Do NOT provide a full solution/i);
    assert.doesNotMatch(contract!.content, /FULL working code in one fenced markdown block/i);
    assert.doesNotMatch(contract!.content, /\*\*Solution:\*\*/i);
});

test('complexity action contract cannot ask for an answer or implementation', () => {
    const instructions = buildIntentPrompt(
        'clarify',
        'coding',
        undefined,
        'reverse linked list',
        false,
        'complexity_only'
    );
    const contract = instructions.find((instruction) => instruction.key === 'output_contract');

    assert.ok(contract);
    assert.match(contract!.content, /complexity analysis only/i);
    assert.match(contract!.content, /Do NOT provide the full answer/i);
    assert.doesNotMatch(contract!.content, /FULL working code in one fenced markdown block/i);
});

test('edge case action contract cannot ask for a full solution', () => {
    const instructions = buildIntentPrompt(
        'brainstorm',
        'coding',
        undefined,
        'merge intervals',
        false,
        'edge_cases_only'
    );
    const contract = instructions.find((instruction) => instruction.key === 'output_contract');

    assert.ok(contract);
    assert.match(contract!.content, /edge cases and test cases only/i);
    assert.match(contract!.content, /Do NOT provide a full solution/i);
    assert.doesNotMatch(contract!.content, /FULL working code in one fenced markdown block/i);
});

test('buildContextLayers applies action contract before prompt serialization', async () => {
    const session = createSession('[INTERVIEWER]: hidden session transcript');
    const layers = await buildContextLayers({
        session,
        intent: 'screen_scan',
        mode: 'coding',
        message: 'solve two sum',
        transcriptOverride: '[INTERVIEWER]: solve two sum',
        actionContract: 'hint_only',
    });
    const serialized = serializePromptObject(layers.promptObject);

    assert.match(serialized.systemPrompt, /Return hints only/);
    assert.doesNotMatch(serialized.systemPrompt, /FULL working code in one fenced markdown block/i);
    assert.match(serialized.context, /\[INTERVIEWER\]: solve two sum/);
    assert.doesNotMatch(serialized.context, /hidden session transcript/);
});
