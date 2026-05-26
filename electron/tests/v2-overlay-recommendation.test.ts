import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    getRecommendedOverlayAction,
    getOverlayQuickActions,
    resolveOverlayCopilotMode,
} from '../../src/lib/modes/overlayCopilotConfig.ts';
import { detectQuestionType, normalizeTranscript } from '../../src/lib/overlay/overlayIntent.ts';

test('resolveOverlayCopilotMode maps coding detection under technical-interview', () => {
    const mode = resolveOverlayCopilotMode('technical-interview', 'coding');
    assert.equal(mode, 'coding');
});

test('coding transcript switches quick actions to tech set', () => {
    const actions = getOverlayQuickActions('coding', true);
    assert.deepEqual(
        actions.map((a) => a.id),
        ['tech_hint', 'tech_optimal_solution', 'tech_complexity', 'tech_edge_case'],
    );
});

test('detectQuestionType classifies DSA phrasing as coding', () => {
    const text = 'implement binary search on a sorted array with O log n time';
    const { nextType } = detectQuestionType(text, 'general', 'general');
    assert.equal(nextType, 'coding');
});

test('recommended action highlights complexity when asked', () => {
    const combined = normalizeTranscript('what is the time complexity of your approach');
    const recommended = getRecommendedOverlayAction('coding', combined);
    assert.equal(recommended, 'tech_complexity');
});

test('system design detection maps to system_design copilot mode', () => {
    const text = 'design a url shortener at scale with caching and load balancing';
    const { nextType } = detectQuestionType(text, 'general', 'general');
    assert.equal(nextType, 'system_design');

    const copilotMode = resolveOverlayCopilotMode('technical-interview', nextType);
    assert.equal(copilotMode, 'system_design');

    const recommended = getRecommendedOverlayAction(
        copilotMode,
        normalizeTranscript(text),
    );
    assert.equal(recommended, 'system_tradeoffs');
});

test('recommended action is always a member of the active quick action list', () => {
    const scenarios: Array<{ template: 'technical-interview' | 'general'; session: 'coding' | 'general' }> = [
        { template: 'technical-interview', session: 'coding' },
        { template: 'technical-interview', session: 'general' },
        { template: 'general', session: 'general' },
    ];

    for (const { template, session } of scenarios) {
        const copilotMode = resolveOverlayCopilotMode(template, session);
        const actions = getOverlayQuickActions(copilotMode, true);
        const recommended = getRecommendedOverlayAction(copilotMode, 'tell me about a challenge');
        assert.ok(
            actions.some((a) => a.id === recommended) || recommended === 'answer_now',
            `recommended ${recommended} should appear in ${copilotMode} actions`,
        );
    }
});
