const test: typeof import('node:test').test = require('node:test').test;
const assert: typeof import('node:assert').strict = require('node:assert').strict;
const path: typeof import('node:path') = require('node:path');

const { resolveActionContext } = require(path.join(process.cwd(), 'src/lib/overlay/actionContextResolver')) as typeof import('../../src/lib/overlay/actionContextResolver');

export {};

const latestTurn = {
    questionTurnId: 'turn-14',
    transcriptVersion: 3,
    currentTurnText: 'Tell me about yourself',
    lastFinalSentence: 'Tell me about yourself',
    finalizedTranscript: 'Design WhatsApp  ·  Tell me about yourself',
    rollingTranscript: 'Design WhatsApp  ·  Tell me about yourself',
    mode: 'general',
};

test('latest_turn routing targets newest STT instead of an older active response', () => {
    const resolved = resolveActionContext({
        action: {
            id: 'tech_hint',
            intent: 'what_to_answer',
            contextTarget: 'latest_turn',
            actionContract: 'hint_only',
        },
        latestTurn: {
            ...latestTurn,
            questionTurnId: 'turn-20',
            transcriptVersion: 1,
            currentTurnText: 'Design a ride matching system',
            lastFinalSentence: 'Design a ride matching system',
        },
        activeResponse: {
            id: 'response-a',
            question: 'Design WhatsApp',
            text: 'Use websocket gateways and fanout workers.',
        },
    });

    assert.equal(resolved.contextTarget, 'latest_turn');
    assert.equal(resolved.message, 'Design a ride matching system');
    assert.equal(resolved.questionTurnId, 'turn-20');
    assert.equal(resolved.transcriptVersion, 1);
    assert.equal(resolved.parentResponseId, undefined);
    assert.equal(resolved.actionContract, 'hint_only');
});

test('active_context routing targets the selected history response', () => {
    const resolved = resolveActionContext({
        action: {
            id: 'clarify',
            intent: 'clarify',
            contextTarget: 'active_context',
        },
        latestTurn,
        activeResponse: {
            id: 'response-a',
            question: 'Design WhatsApp',
            text: 'Use websocket gateways and fanout workers.',
            ownership: {
                responseId: 'response-a',
                questionTurnId: 'turn-whatsapp',
                transcriptVersion: 2,
                contextTarget: 'latest_turn',
                actionId: 'system_tradeoffs',
                createdAt: 1000,
            },
        },
    });

    assert.equal(resolved.contextTarget, 'active_context');
    assert.equal(resolved.previewLabel, 'Current Response');
    assert.equal(resolved.message, 'Design WhatsApp');
    assert.equal(resolved.questionTurnId, 'turn-whatsapp');
    assert.equal(resolved.transcriptVersion, 2);
    assert.equal(resolved.parentResponseId, 'response-a');
    assert.match(resolved.additionalContext ?? '', /ACTIVE RESPONSE CONTEXT/);
    assert.equal(resolved.transcriptOverride, '[NO TRANSCRIPT AVAILABLE]');
});

test('response history navigation keeps Clarify on the selected response despite newer STT', () => {
    const selectedHistoryResponse = {
        id: 'response-a',
        question: 'Design WhatsApp',
        text: 'A selected prior answer about WhatsApp architecture.',
        ownership: {
            responseId: 'response-a',
            questionTurnId: 'turn-whatsapp',
            transcriptVersion: 1,
            contextTarget: 'latest_turn' as const,
            createdAt: 1000,
        },
    };

    const resolved = resolveActionContext({
        action: {
            id: 'clarify',
            intent: 'clarify',
            contextTarget: 'active_context',
        },
        latestTurn: {
            ...latestTurn,
            questionTurnId: 'turn-about-yourself',
            transcriptVersion: 1,
            currentTurnText: 'Tell me about yourself',
            lastFinalSentence: 'Tell me about yourself',
        },
        activeResponse: selectedHistoryResponse,
    });

    assert.equal(resolved.contextTarget, 'active_context');
    assert.equal(resolved.message, 'Design WhatsApp');
    assert.equal(resolved.parentResponseId, 'response-a');
    assert.equal(resolved.questionTurnId, 'turn-whatsapp');
    assert.notEqual(resolved.message, 'Tell me about yourself');
});

test('transcript routing uses the visible transcript without forcing a question', () => {
    const resolved = resolveActionContext({
        action: {
            id: 'recap',
            intent: 'recap',
            contextTarget: 'transcript',
        },
        latestTurn,
        activeResponse: {
            id: 'response-a',
            question: 'Design WhatsApp',
            text: 'Old answer.',
        },
    });

    assert.equal(resolved.contextTarget, 'transcript');
    assert.equal(resolved.message, undefined);
    assert.match(resolved.transcriptOverride ?? '', /\[INTERVIEWER\]: Design WhatsApp/);
    assert.match(resolved.transcriptOverride ?? '', /\[INTERVIEWER\]: Tell me about yourself/);
});

test('paused transcript snapshot is the action source of truth', () => {
    const frozenVisibleSnapshot = {
        questionTurnId: 'turn-visible',
        transcriptVersion: 7,
        currentTurnText: 'Design Uber ride matching',
        lastFinalSentence: 'Design Uber ride matching',
        finalizedTranscript: 'Design Uber ride matching',
        rollingTranscript: 'Design Uber ride matching',
    };

    const resolved = resolveActionContext({
        action: {
            id: 'tech_complexity',
            intent: 'clarify',
            contextTarget: 'latest_turn',
            actionContract: 'complexity_only',
        },
        latestTurn: frozenVisibleSnapshot,
    });

    assert.equal(resolved.message, 'Design Uber ride matching');
    assert.equal(resolved.questionTurnId, 'turn-visible');
    assert.equal(resolved.transcriptVersion, 7);
    assert.doesNotMatch(resolved.transcriptOverride ?? '', /hidden/i);
});
