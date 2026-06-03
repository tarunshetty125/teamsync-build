import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    getRecommendedOverlayAction,
    getOverlayQuickActions,
    resolveOverlayCopilotMode,
} from '../../src/lib/modes/overlayCopilotConfig.ts';
import { resolveRecommendedOverlayAction } from '../../src/lib/overlay/overlayRecommendationResolver.ts';
import {
    detectQuestionType,
    intentReducer,
    normalizeTranscript,
    type DetectedQuestionType,
    type IntentState,
} from '../../src/lib/overlay/overlayIntent.ts';
import { looksLikeCodingInterviewQuestion } from '../intelligence/codingQuestionHeuristics.ts';

function classifyRolling(segments: string[], initial: DetectedQuestionType = 'general'): DetectedQuestionType {
    let current = initial;
    for (let i = 0; i < segments.length; i++) {
        const combined = segments.slice(Math.max(0, i - 7), i + 1).join(' ');
        current = detectQuestionType(combined, current, current).nextType;
    }
    return current;
}

function reduceRolling(segments: string[], initial: DetectedQuestionType = 'general'): IntentState {
    let state: IntentState = {
        detectedType: initial,
        lastStrongType: initial,
        lastStrongAt: 0,
        seq: 0,
    };
    for (let i = 0; i < segments.length; i++) {
        const combined = segments.slice(Math.max(0, i - 7), i + 1).join(' ');
        state = intentReducer(state, {
            type: 'EVALUATE',
            combinedText: combined,
            now: (i + 1) * 1000,
            seq: i + 1,
        });
    }
    return state;
}

test('resolveOverlayCopilotMode maps coding detection under technical-interview', () => {
    const mode = resolveOverlayCopilotMode('technical-interview', 'coding');
    assert.equal(mode, 'coding');
});

test('resolveOverlayCopilotMode keeps general template dynamic for system design', () => {
    const mode = resolveOverlayCopilotMode('general', 'system_design');
    assert.equal(mode, 'system_design');
});

test('resolveOverlayCopilotMode only locks non-adaptive templates', () => {
    assert.equal(resolveOverlayCopilotMode('sales', 'system_design'), 'sales');
    assert.equal(resolveOverlayCopilotMode('lecture', 'coding'), 'lecture');
    assert.equal(resolveOverlayCopilotMode('recruiting', 'salary'), 'recruiting');
    assert.equal(resolveOverlayCopilotMode('team-meet', 'system_design'), 'team-meet');
    assert.equal(resolveOverlayCopilotMode('looking-for-work', 'system_design'), 'system_design');
    assert.equal(resolveOverlayCopilotMode('looking-for-work', 'general'), 'looking-for-work');
});

test('coding transcript switches quick actions to tech set', () => {
    const actions = getOverlayQuickActions('coding', true);
    assert.deepEqual(
        actions.map((a) => a.id),
        ['tech_hint', 'tech_optimal_solution', 'tech_complexity', 'tech_edge_case', 'follow_up_questions', 'job_improvement'],
    );
});

test('behavioral interview workflow exposes STAR, Improve, Confidence, Clarify, and Brainstorm together', () => {
    const actions = getOverlayQuickActions('behavioral', true);
    assert.deepEqual(
        actions.map((a) => a.id),
        ['job_star', 'job_improvement', 'job_confidence', 'clarify', 'brainstorm', 'follow_up_questions'],
    );
});

test('looking-for-work workflow keeps job actions and adds clarify and brainstorm', () => {
    const actions = getOverlayQuickActions('looking-for-work', true);
    assert.deepEqual(
        actions.map((a) => a.id),
        ['job_star', 'job_resume_alignment', 'job_confidence', 'job_improvement', 'clarify', 'brainstorm'],
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

test('casual write-me DSA prompts switch to coding', () => {
    for (const text of [
        'dsa write me merge sort in c',
        'write me a solution for two sum',
        'give me code for reverse linked list in c',
        'create a program for quick sort',
        'solve this in js for leetcode',
        'codeforces style solution in c++',
        'write accepted answer in kotlin for hacker rank',
        'give me node.js solution for valid parentheses',
        'gfg solution using java',
        'atcoder answer in rust',
    ]) {
        assert.equal(detectQuestionType(text, 'general', 'general').nextType, 'coding', text);
        assert.equal(looksLikeCodingInterviewQuestion(text), true, text);
    }
});

test('interviewer STT coding prompts switch to coding without exact coding keyword', () => {
    for (const text of [
        'can you write a program to check palindrome',
        'could you implement the logic for longest substring',
        'please complete the function and return the array',
        'given an array of integers return the maximum sum',
        'take input from stdin and print output for all test cases',
        'start with the function signature and then dry run it',
        'now solve valid parentheses using stack',
        'find duplicate number in the list',
    ]) {
        assert.equal(detectQuestionType(text, 'general', 'general').nextType, 'coding', text);
        assert.equal(looksLikeCodingInterviewQuestion(text), true, text);
    }
});

test('named DSA problem titles switch buttons to coding', () => {
    for (const text of [
        'n queen',
        'n queens in c',
        'lru cache',
        'word ladder',
        'coin change',
        'trapping rain water',
        'rotting oranges',
        'clone graph',
        'sudoku solver',
        'house robber',
        'koko eating bananas',
        'merge k sorted lists',
        'topological sort',
    ]) {
        assert.equal(detectQuestionType(text, 'general', 'general').nextType, 'coding', text);
        assert.equal(looksLikeCodingInterviewQuestion(text), true, text);
    }
});

test('DSA topic categories switch buttons to coding', () => {
    const topics = [
        'arrays',
        'strings',
        'hashing hashmap hashset',
        'two pointers',
        'sliding window',
        'prefix sum',
        'sorting',
        'greedy algorithms',
        'recursion',
        'backtracking',
        'linked list',
        'stack',
        'queue',
        'monotonic stack',
        'binary search',
        'trees',
        'binary trees',
        'binary search trees bst',
        'heap priority queue',
        'trie',
        'graphs',
        'bfs breadth first search',
        'dfs depth first search',
        'topological sort',
        'union find disjoint set dsu',
        'shortest path algorithms',
        'minimum spanning tree mst',
        'dynamic programming dp',
        '1d dynamic programming',
        '2d dynamic programming',
        'knapsack dp',
        'interval dp',
        'bit manipulation',
        'bitmasking',
        'math number theory',
        'matrix grid problems',
        'geometry',
        'segment tree',
        'fenwick tree binary indexed tree',
        'memoization',
        'monotonic queue',
        'divide and conquer',
        'simulation',
        'coding design problems',
        'string matching algorithms',
        'game theory',
        'reservoir sampling',
        'randomized algorithms',
        'line sweep',
        'computational geometry',
    ];

    for (const topic of topics) {
        const text = `solve ${topic} problem`;
        assert.equal(detectQuestionType(text, 'general', 'general').nextType, 'coding', topic);
        assert.equal(looksLikeCodingInterviewQuestion(text), true, topic);
    }
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

test('system design accumulates weak interview signals across finalized chunks', () => {
    const nextType = classifyRolling([
        'Suppose we suddenly have millions of users',
        'traffic spikes',
        'how would backend handle this',
    ]);
    assert.equal(nextType, 'system_design');
});

test('system design catches failure recovery from fragmented speech', () => {
    const nextType = classifyRolling([
        'Redis fails',
        'what happens',
        'how do we recover',
    ]);
    assert.equal(nextType, 'system_design');
});

test('system design catches architecture-only shard and cache prompts', () => {
    assert.equal(detectQuestionType('How would you shard database', 'general', 'general').nextType, 'system_design');
    assert.equal(detectQuestionType('How would caching work here', 'general', 'general').nextType, 'system_design');
});

test('system design catches big-tech backend design prompts', () => {
    assert.equal(detectQuestionType('Design Uber backend', 'general', 'general').nextType, 'system_design');
});

test('system design catches HLD and LLD product prompts', () => {
    assert.equal(detectQuestionType('design lld for whatsapp', 'general', 'general').nextType, 'system_design');
    assert.equal(detectQuestionType('design HLD for Uber', 'general', 'general').nextType, 'system_design');
    assert.equal(detectQuestionType('design an llf for flipkrat', 'general', 'general').nextType, 'system_design');
    assert.equal(detectQuestionType('design low level design for ecommerce checkout', 'general', 'general').nextType, 'system_design');
    assert.equal(detectQuestionType('how would you design a real time chat app', 'general', 'general').nextType, 'system_design');
});

test('system design suppresses OOP, DSA, traversal, and normalization false positives', () => {
    assert.notEqual(detectQuestionType('Explain singleton pattern', 'general', 'general').nextType, 'system_design');
    assert.notEqual(detectQuestionType('Difference between BFS and DFS', 'general', 'general').nextType, 'system_design');
    assert.notEqual(detectQuestionType('Binary tree traversal', 'general', 'general').nextType, 'system_design');
    assert.notEqual(detectQuestionType('How would database normalization work', 'general', 'general').nextType, 'system_design');
    assert.notEqual(detectQuestionType('database', 'general', 'general').nextType, 'system_design');
});

test('system design catches retry follow-up after backend discussion', () => {
    const nextType = classifyRolling([
        'we are discussing the backend service and database path',
        'how would retries work',
    ]);
    assert.equal(nextType, 'system_design');
});

test('behavioral interview prompts bypass generic concept explanation guard', () => {
    for (const text of [
        'Tell me about a time you handled conflict',
        'Tell me about a time when you had to lead',
        'Tell me about a time where you missed a deadline',
        'Describe a situation where you led a team',
        'Describe a situation when you had to prioritize',
        'Walk me through your resume',
        'Walk me through your background',
    ]) {
        assert.equal(detectQuestionType(text, 'system_design', 'system_design').nextType, 'behavioral', text);
    }
});

test('generic explanation prompts retain general classification', () => {
    for (const text of [
        'Tell me about Redis',
        'Tell me about CAP theorem',
        'Tell me about time complexity',
        'Compare BFS and DFS',
        'Describe binary tree traversal',
        'Explain reverse linked list',
    ]) {
        assert.equal(detectQuestionType(text, 'system_design', 'system_design').nextType, 'general', text);
    }
});

test('intent reducer switches rapidly coding to system design to behavioral', () => {
    let state = reduceRolling(['implement binary search on an array']);
    assert.equal(state.detectedType, 'coding');

    state = intentReducer(state, {
        type: 'EVALUATE',
        combinedText: 'How would you scale this API for high traffic',
        now: 2000,
        seq: 2,
    });
    assert.equal(state.detectedType, 'system_design');

    state = intentReducer(state, {
        type: 'EVALUATE',
        combinedText: 'Tell me about a time you handled conflict on your team',
        now: 3000,
        seq: 3,
    });
    assert.equal(state.detectedType, 'behavioral');
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
