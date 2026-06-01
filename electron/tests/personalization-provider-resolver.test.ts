import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { resolveModelForPreferredProvider } from '../personalization/ProviderPreferenceResolver';

test('preferred provider resolves to stored preferred provider model', () => {
    const result = resolveModelForPreferredProvider({
        currentModel: 'gemini-3.1-flash-lite-preview',
        currentProvider: 'gemini',
        preferredProvider: 'groq',
        getPreferredModel: (provider) => provider === 'groq' ? 'llama-3.3-70b-versatile' : null,
    });

    assert.equal(result.applied, true);
    assert.equal(result.model, 'llama-3.3-70b-versatile');
    assert.equal(result.reason, 'preferred_provider_model');
});

test('explicit model override wins over preferred provider', () => {
    const result = resolveModelForPreferredProvider({
        currentModel: 'gemini-3.1-pro-preview',
        currentProvider: 'gemini',
        preferredProvider: 'groq',
        explicitModelOverride: true,
        getPreferredModel: () => 'llama-3.3-70b-versatile',
    });

    assert.equal(result.applied, false);
    assert.equal(result.model, 'gemini-3.1-pro-preview');
    assert.equal(result.reason, 'explicit_model_override');
});

test('preferred provider uses provider default only through known provider metadata', () => {
    const result = resolveModelForPreferredProvider({
        currentModel: 'gemini-3.1-flash-lite-preview',
        currentProvider: 'gemini',
        preferredProvider: 'claude',
    });

    assert.equal(result.applied, true);
    assert.equal(result.model, 'claude-sonnet-4-6');
    assert.equal(result.reason, 'provider_default_model');
});

test('unsupported provider preference does not invent routing model', () => {
    const result = resolveModelForPreferredProvider({
        currentModel: 'gemini-3.1-flash-lite-preview',
        currentProvider: 'gemini',
        preferredProvider: 'ollama',
    });

    assert.equal(result.applied, false);
    assert.equal(result.model, 'gemini-3.1-flash-lite-preview');
    assert.equal(result.reason, 'unsupported_provider_preference');
});
