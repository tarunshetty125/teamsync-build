import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildTranscriptContext } from '../ActionContextBuilder';

function createSession(transcript: string) {
    return {
        getRollingWindowTranscript: () => transcript,
        getCappedFullTranscript: () => transcript,
        estimateTokenCount: (text: string) => Math.ceil(text.length / 4),
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
