import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildProviderHealthReadModel,
    type ProviderHealthReadModelInput,
} from '../../src/lib/providers/providerHealthReadModel.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Sprint 7 Phase A projects all supported provider health entries from existing signals', () => {
    const model = buildProviderHealthReadModel({
        credentials: {
            hasBedrockCredentials: true,
            hasGroqKey: true,
            hasGeminiKey: true,
            hasOpenaiKey: true,
            hasClaudeKey: true,
        },
        bedrock: { modelCount: 3 },
        groqHealth: {
            totalKeys: 2,
            availableKeys: 2,
            exhaustedKeys: 0,
            coolingDownKeys: 0,
            invalidKeys: 0,
        },
        connectionTests: {
            gemini: { success: true, checkedAt: 1000 },
            openai: { success: true, checkedAt: 1001 },
            claude: { success: true, checkedAt: 1002 },
        },
        ollama: {
            status: 'detected',
            models: ['llama3.2'],
            checkedAt: 1003,
        },
        now: 1234,
    });

    assert.deepEqual(
        model.orderedProviders.map((entry) => entry.provider),
        ['bedrock', 'groq', 'gemini', 'openai', 'claude', 'ollama'],
    );
    assert.equal(model.configuredCount, 6);
    assert.equal(model.degradedCount, 0);
    assert.equal(model.generatedAt, 1234);
    for (const entry of model.orderedProviders) {
        assert.equal(entry.configured, true, entry.provider);
        assert.equal(entry.reachable, true, entry.provider);
        assert.equal(entry.authenticated, true, entry.provider);
        assert.equal(entry.degraded, false, entry.provider);
        assert.ok(entry.lastDiagnostic);
    }
});

test('Sprint 7 Phase A maps Bedrock auth-expired diagnostics without changing routing metadata', () => {
    const model = buildProviderHealthReadModel({
        credentials: { hasBedrockCredentials: true },
        bedrock: {
            authExpired: true,
            checkedAt: 2000,
        },
    });
    const bedrock = model.providers.bedrock;

    assert.equal(bedrock.configured, true);
    assert.equal(bedrock.reachable, false);
    assert.equal(bedrock.authenticated, false);
    assert.equal(bedrock.degraded, true);
    assert.equal(bedrock.lastDiagnostic?.category, 'auth_expired');
    assert.equal(bedrock.lastDiagnostic?.source, 'bedrock:reauthentication-required');
    assert.equal(bedrock.lastDiagnostic?.at, 2000);
});

test('Sprint 7 Phase A projects Groq key-pool degradation from runtime health only', () => {
    const partial = buildProviderHealthReadModel({
        credentials: { hasGroqKey: true },
        groqHealth: {
            totalKeys: 3,
            availableKeys: 1,
            exhaustedKeys: 1,
            coolingDownKeys: 1,
            invalidKeys: 1,
        },
    }).providers.groq;

    assert.equal(partial.configured, true);
    assert.equal(partial.reachable, true);
    assert.equal(partial.authenticated, true);
    assert.equal(partial.degraded, true);
    assert.equal(partial.lastDiagnostic?.category, 'invalid_keys');
    assert.match(partial.lastDiagnostic?.message ?? '', /partially degraded/i);

    const exhausted = buildProviderHealthReadModel({
        groqHealth: {
            totalKeys: 2,
            availableKeys: 0,
            exhaustedKeys: 2,
            coolingDownKeys: 2,
            invalidKeys: 0,
        },
    }).providers.groq;

    assert.equal(exhausted.configured, true);
    assert.equal(exhausted.reachable, false);
    assert.equal(exhausted.authenticated, true);
    assert.equal(exhausted.degraded, true);
    assert.equal(exhausted.lastDiagnostic?.category, 'cooldown');

    const invalid = buildProviderHealthReadModel({
        groqHealth: {
            totalKeys: 2,
            availableKeys: 0,
            exhaustedKeys: 0,
            coolingDownKeys: 0,
            invalidKeys: 2,
        },
    }).providers.groq;

    assert.equal(invalid.authenticated, false);
    assert.equal(invalid.lastDiagnostic?.category, 'invalid_keys');
});

test('Sprint 7 Phase A classifies cloud provider connection and model-fetch failures', () => {
    const model = buildProviderHealthReadModel({
        credentials: {
            hasGeminiKey: true,
            hasOpenaiKey: true,
            hasClaudeKey: true,
        },
        connectionTests: {
            gemini: {
                success: false,
                error: 'API key is invalid',
                checkedAt: 3000,
            },
            openai: {
                success: false,
                error: '429 rate limit exceeded',
                checkedAt: 3001,
            },
        },
        modelFetches: {
            claude: {
                error: 'Model fetch failed: network timeout',
                checkedAt: 3002,
            },
        },
    });

    assert.equal(model.providers.gemini.degraded, true);
    assert.equal(model.providers.gemini.authenticated, false);
    assert.equal(model.providers.gemini.lastDiagnostic?.category, 'auth_failed');
    assert.equal(model.providers.openai.degraded, true);
    assert.equal(model.providers.openai.authenticated, true);
    assert.equal(model.providers.openai.lastDiagnostic?.category, 'rate_limited');
    assert.equal(model.providers.claude.degraded, true);
    assert.equal(model.providers.claude.reachable, false);
    assert.equal(model.providers.claude.lastDiagnostic?.category, 'provider_unavailable');
});

test('Sprint 7 Phase A supports Ollama local availability without provider auth assumptions', () => {
    const detected = buildProviderHealthReadModel({
        ollama: {
            status: 'detected',
            models: ['llama3.2', 'qwen2.5'],
        },
    }).providers.ollama;

    assert.equal(detected.configured, true);
    assert.equal(detected.reachable, true);
    assert.equal(detected.authenticated, true);
    assert.equal(detected.degraded, false);
    assert.equal(detected.lastDiagnostic?.category, 'ok');

    const unavailable = buildProviderHealthReadModel({
        ollama: {
            configured: true,
            status: 'not-found',
            error: 'Ollama server not responding',
        },
    }).providers.ollama;

    assert.equal(unavailable.configured, true);
    assert.equal(unavailable.reachable, false);
    assert.equal(unavailable.authenticated, false);
    assert.equal(unavailable.degraded, true);
    assert.equal(unavailable.lastDiagnostic?.category, 'ollama_unavailable');
});

test('Sprint 7 Phase A remains a read model without routing, ownership, diagnostics, or benchmark mutations', () => {
    const helper = read('src/lib/providers/providerHealthReadModel.ts');
    const routing = read('electron/LLMHelper.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');

    assert.match(helper, /buildProviderHealthReadModel/);
    assert.doesNotMatch(helper, /CredentialsManager/);
    assert.doesNotMatch(helper, /LLMHelper/);
    assert.doesNotMatch(helper, /BenchmarkManager/);
    assert.doesNotMatch(helper, /ipcRenderer|ipcMain|safeHandle/);
    assert.match(routing, /resolveRoutingDecision/);
    assert.match(ownership, /requestedProvider\?: string/);
});
