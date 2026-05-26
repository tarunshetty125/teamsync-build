import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    getRecommendedOverlayAction,
    getOverlayQuickActions,
    resolveOverlayCopilotMode,
} from '../../src/lib/modes/overlayCopilotConfig.ts';
import { resolveRecommendedOverlayAction } from '../../src/lib/overlay/overlayRecommendationResolver.ts';
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

test('loose intent catches casual coding phrasing', () => {
    const text = 'how would you solve this with an array';
    const { nextType } = detectQuestionType(text, 'general', 'general');
    assert.equal(nextType, 'coding');
});

test('loose intent catches partial system design phrasing', () => {
    const text = 'how would you architect this for more traffic and scale';
    const { nextType } = detectQuestionType(text, 'general', 'general');
    assert.equal(nextType, 'system_design');
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

test('resolveRecommendedOverlayAction always returns a visible quick action', () => {
    const scenarios: Array<{ template: 'technical-interview' | 'general' | 'sales'; session: 'coding' | 'general' }> = [
        { template: 'technical-interview', session: 'coding' },
        { template: 'technical-interview', session: 'general' },
        { template: 'general', session: 'general' },
        { template: 'sales', session: 'general' },
    ];

    for (const { template, session } of scenarios) {
        const copilotMode = resolveOverlayCopilotMode(template, session);
        const actions = getOverlayQuickActions(copilotMode, true);
        const visible = actions.map((a) => a.id);
        const recommended = resolveRecommendedOverlayAction(
            copilotMode,
            'tell me about yourself and your background',
            visible,
            { detectedQuestionType: session },
        );
        assert.ok(
            visible.includes(recommended),
            `recommended ${recommended} must be visible in ${copilotMode}, got [${visible.join(', ')}]`,
        );
    }
});

test('sales mode highlights pricing from transcript', () => {
    const visible = getOverlayQuickActions('sales', true).map((a) => a.id);
    const recommended = resolveRecommendedOverlayAction(
        'sales',
        normalizeTranscript('your price is above our budget and we need a discount'),
        visible,
        { detectedQuestionType: 'general' },
    );
    assert.equal(recommended, 'sales_pricing');
});

test('introduce yourself maps to what_to_answer when answer_now is not visible', () => {
    const visible = getOverlayQuickActions('general', true).map((a) => a.id);
    assert.ok(!visible.includes('answer_now' as never));
    const recommended = resolveRecommendedOverlayAction(
        'general',
        normalizeTranscript('tell me about yourself'),
        visible,
        { detectedQuestionType: 'behavioral' },
    );
    assert.equal(recommended, 'what_to_answer');
});

test('intent fallback highlights tech optimal when coding detected in general mode', () => {
    const visible = getOverlayQuickActions('coding', true).map((a) => a.id);
    const recommended = resolveRecommendedOverlayAction(
        'coding',
        normalizeTranscript('okay um let us continue'),
        visible,
        { detectedQuestionType: 'coding' },
    );
    assert.equal(recommended, 'tech_optimal_solution');
});

test('lecture mode highlights summary from transcript', () => {
    const visible = getOverlayQuickActions('lecture', true).map((a) => a.id);
    const recommended = resolveRecommendedOverlayAction(
        'lecture',
        normalizeTranscript('can you summarize what we covered so far'),
        visible,
        { detectedQuestionType: 'general' },
    );
    assert.equal(recommended, 'lecture_summary');
});

test('recruiting mode highlights red flag from transcript', () => {
    const visible = getOverlayQuickActions('recruiting', true).map((a) => a.id);
    const recommended = resolveRecommendedOverlayAction(
        'recruiting',
        normalizeTranscript('I see a red flag in their answer about leadership'),
        visible,
        { detectedQuestionType: 'behavioral' },
    );
    assert.equal(recommended, 'recruiting_red_flag');
});

test('team-meet mode highlights action items', () => {
    const visible = getOverlayQuickActions('team-meet', true).map((a) => a.id);
    const recommended = resolveRecommendedOverlayAction(
        'team-meet',
        normalizeTranscript('what are the action items and next steps'),
        visible,
        { detectedQuestionType: 'follow_up' },
    );
    assert.equal(recommended, 'team_action_item');
});

test('looking-for-work maps introduce yourself to job star', () => {
    const visible = getOverlayQuickActions('looking-for-work', true).map((a) => a.id);
    const recommended = resolveRecommendedOverlayAction(
        'looking-for-work',
        normalizeTranscript('tell me about yourself'),
        visible,
        { detectedQuestionType: 'behavioral' },
    );
    assert.equal(recommended, 'job_star');
});

test('sales mode uses intent fallback when transcript is vague', () => {
    const visible = getOverlayQuickActions('sales', true).map((a) => a.id);
    const recommended = resolveRecommendedOverlayAction(
        'sales',
        normalizeTranscript('okay sure'),
        visible,
        { detectedQuestionType: 'behavioral' },
    );
    assert.equal(recommended, 'sales_discovery');
});
