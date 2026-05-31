import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
    buildIntentPrompt,
    type PromptObject,
} from '../ActionContextBuilder';
import { buildProviderPrompt } from '../llm/ProviderPromptBuilder';
import type { ActionContract } from '../../src/lib/overlay/actionContextTypes';

function createCodingPrompt(actionContract: ActionContract = 'optimal_solution'): PromptObject {
    return {
        mode: 'coding',
        intent: 'what_to_answer',
        actionContract,
        question: 'implement two sum',
        transcript: {
            title: 'TRANSCRIPT',
            content: '[INTERVIEWER]: implement two sum',
            strategy: 'rolling_window',
            approxTokens: 8,
        },
        profile: null,
        supplemental: null,
        rag: null,
        instructions: buildIntentPrompt(
            'what_to_answer',
            'coding',
            undefined,
            'implement two sum',
            false,
            actionContract,
        ),
    };
}

test('provider prompt snapshot preserves coding contract for Groq', () => {
    const prompt = buildProviderPrompt({
        prompt: createCodingPrompt(),
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
    });

    assert.equal(prompt.providerFamily, 'groq');
    assert.equal(prompt.maxOutputTokens, 3072);
    assert.match(prompt.systemPrompt, /GROQ REALTIME PROFILE/);
    assert.match(prompt.systemPrompt, /FULL working code in one fenced markdown block/);
    assert.match(prompt.finalPrompt, /\[USER QUESTION\]\nimplement two sum/);
});

test('provider prompt snapshot preserves coding contract for GPT-OSS on Bedrock', () => {
    const prompt = buildProviderPrompt({
        prompt: createCodingPrompt(),
        provider: 'bedrock',
        model: 'openai.gpt-oss-120b-1:0',
    });

    assert.equal(prompt.providerFamily, 'bedrock');
    assert.equal(prompt.maxOutputTokens, 4096);
    assert.match(prompt.systemPrompt, /BEDROCK GPT-OSS REASONING PROFILE/);
    assert.match(prompt.systemPrompt, /FULL working code in one fenced markdown block/);
});

test('provider prompt snapshot preserves coding contract for Claude', () => {
    const prompt = buildProviderPrompt({
        prompt: createCodingPrompt(),
        provider: 'claude',
        model: 'claude-sonnet-4-6',
    });

    assert.equal(prompt.providerFamily, 'claude');
    assert.equal(prompt.maxOutputTokens, 6400);
    assert.match(prompt.systemPrompt, /CLAUDE STRUCTURED PROFILE/);
    assert.match(prompt.systemPrompt, /FULL working code in one fenced markdown block/);
});

test('provider prompt snapshot preserves coding contract for Gemini', () => {
    const prompt = buildProviderPrompt({
        prompt: createCodingPrompt(),
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite-preview',
    });

    assert.equal(prompt.providerFamily, 'gemini');
    assert.equal(prompt.maxOutputTokens, 4096);
    assert.match(prompt.systemPrompt, /GEMINI CONCISE PROFILE/);
    assert.match(prompt.systemPrompt, /FULL working code in one fenced markdown block/);
});

