import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { SessionTracker } from '../SessionTracker';
import { normalizeTranscriptSegmentForPersistence } from '../MeetingPersistence';
import { prepareTranscriptForWhatToAnswer } from '../llm/transcriptCleaner';
import { buildTemporalContext } from '../llm/TemporalContextBuilder';

const { IntelligenceEngine } = require('../IntelligenceEngine') as typeof import('../IntelligenceEngine');

class FakeSession {
    sessionId = 'speaker-test-session';

    setRecapLLM(): void {}
    getMode() { return 'general' as const; }
    getLastAssistantMessage(): string | null { return null; }
    getLastInterviewerTurn(): string | null { return null; }
    getRollingWindowTranscript(): string { return ''; }
    getFormattedContext(): string { return ''; }
    addAssistantMessage(): void {}
    addUserMessage(): void {}
    pushUsage(): void {}
    estimateTokenCount(text: string): number { return Math.ceil(text.length / 4); }
}

class FakeLLMHelper {
    getKnowledgeOrchestrator(): null { return null; }
    getCustomNotesEnabled() { return true; }
    getCurrentModel() { return 'gpt-4o-mini'; }
    hasClaude() { return false; }
    hasOpenai() { return true; }
    hasGroq() { return false; }
    streamStructuredPrompt() {
        return (async function* () {
            yield 'ok';
        })();
    }
}

test('SessionTracker keeps distinct interviewer turns when diarized speakers differ', () => {
    const session = new SessionTracker();
    const timestamp = Date.now();

    session.addTranscript({
        speaker: 'interviewer',
        speakerId: 'speaker_1',
        speakerLabel: 'Recruiter',
        text: 'Thanks for joining.',
        timestamp,
        final: true,
        _sessionId: session.sessionId,
    });

    session.addTranscript({
        speaker: 'interviewer',
        speakerId: 'speaker_2',
        speakerLabel: 'Hiring Manager',
        text: 'Thanks for joining.',
        timestamp,
        final: true,
        _sessionId: session.sessionId,
    });

    const transcript = session.getFullTranscript();
    assert.equal(transcript.length, 2);
    assert.match(session.getCappedFullTranscript(200), /\[Recruiter\]: Thanks for joining\./);
    assert.match(session.getCappedFullTranscript(200), /\[Hiring Manager\]: Thanks for joining\./);
});

test('normalizeTranscriptSegmentForPersistence preserves canonical speaker and explicit label', () => {
    const normalized = normalizeTranscriptSegmentForPersistence({
        speaker: 'interviewer',
        speakerId: 'speaker_2',
        speakerLabel: 'Hiring Manager',
        text: 'Tell me about a project you led.',
        timestamp: 123,
        final: true,
    });

    assert.equal(normalized.speaker, 'interviewer');
    assert.equal(normalized.speakerId, 'speaker_2');
    assert.equal(normalized.speakerLabel, 'Hiring Manager');
});

test('prepareTranscriptForWhatToAnswer preserves speaker labels in formatted transcript', () => {
    const transcript = prepareTranscriptForWhatToAnswer([
        {
            role: 'interviewer',
            speakerId: 'speaker_1',
            speakerLabel: 'Recruiter',
            text: 'Walk me through your background.',
            timestamp: 1,
        },
        {
            role: 'user',
            speakerId: 'speaker_you',
            speakerLabel: 'You',
            text: 'I have six years of backend experience.',
            timestamp: 2,
        },
    ]);

    assert.match(transcript, /\[Recruiter\]: walk me through your background\./);
    assert.match(transcript, /\[You\]: i have six years of backend experience\./);
});

test('buildTemporalContext keeps speaker labels in recent transcript', () => {
    const temporal = buildTemporalContext([
        {
            role: 'interviewer',
            speakerId: 'speaker_1',
            speakerLabel: 'Recruiter',
            text: 'What kind of role are you looking for?',
            timestamp: Date.now(),
        },
        {
            role: 'user',
            speakerId: 'speaker_you',
            speakerLabel: 'You',
            text: 'Senior backend roles.',
            timestamp: Date.now(),
        },
    ], []);

    assert.match(temporal.recentTranscript, /\[Recruiter – IMPORTANT\]: What kind of role are you looking for\?/);
    assert.match(temporal.recentTranscript, /\[You\]: Senior backend roles\./);
});

test('technical-interview mode forces the coding brain unless a stronger category is detected', () => {
    const engine = new IntelligenceEngine(new FakeLLMHelper() as any, new FakeSession() as any) as any;

    assert.equal(
        engine.resolveForcedBrainId('technical-interview', { category: 'general' }, 'what_to_answer'),
        'coding'
    );
    assert.equal(
        engine.resolveForcedBrainId('technical-interview', { category: 'system_design' }, 'what_to_answer'),
        'system_design'
    );
    assert.equal(
        engine.resolveForcedBrainId('technical-interview', { category: 'behavioral' }, 'what_to_answer'),
        'behavioral'
    );
});
