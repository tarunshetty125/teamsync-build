import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildProviderHealthReadModel } from '../../src/lib/providers/providerHealthReadModel.ts';
import { ProviderHealthStatusSurface } from '../../src/components/settings/ProviderHealthStatusSurface.tsx';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Sprint 7 UI-A health surface consumes ProviderHealthReadModel only', () => {
    const surface = read('src/components/settings/ProviderHealthStatusSurface.tsx');

    assert.match(surface, /ProviderHealthStatusSurfaceProps/);
    assert.match(surface, /readModel: ProviderHealthReadModel/);
    assert.match(surface, /readModel\.orderedProviders\.map/);
    assert.match(surface, /aria-label="Provider health status"/);
    assert.match(surface, /aria-label="Provider health status table"/);
    assert.match(surface, /Provider/);
    assert.match(surface, /Configured/);
    assert.match(surface, /Reachable/);
    assert.match(surface, /Authenticated/);
    assert.match(surface, /Degraded/);
    assert.match(surface, /Last Diagnostic/);
    assert.match(surface, /data-health-tone=\{tone\}/);
    assert.doesNotMatch(surface, /buildProviderRoutingReadModel|buildProviderFallbackReadModel|buildProviderTelemetryReadModel|buildProviderDiagnosticsReadModel/);
    assert.doesNotMatch(surface, /BenchmarkManager|CredentialsManager|LLMHelper|ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB|recharts|Chart/);
});

test('Sprint 7 UI-A settings integration derives read model without new provider state', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');

    assert.match(settings, /import \{ buildProviderHealthReadModel \}/);
    assert.match(settings, /import \{ ProviderHealthStatusSurface \}/);
    assert.match(settings, /const providerHealthReadModel = useMemo\(\(\) => \{/);
    assert.match(settings, /buildProviderHealthReadModel\(\{/);
    assert.match(settings, /credentials: \{/);
    assert.match(settings, /connectionTests: \{/);
    assert.match(settings, /modelFetches: \{/);
    assert.match(settings, /ollama: \{/);
    assert.match(settings, /<ProviderHealthStatusSurface readModel=\{providerHealthReadModel\} \/>/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderHealth|setProviderHealth|providerHealthState/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderPersonalization|setProviderPersonalization|providerPersonalizationState/);
});

test('Sprint 7 UI-A read model supports all required providers for the surface', () => {
    const model = buildProviderHealthReadModel({
        credentials: {
            hasBedrockCredentials: true,
            hasGroqKey: true,
            hasGeminiKey: true,
            hasOpenaiKey: true,
            hasClaudeKey: true,
        },
        bedrock: { modelCount: 2 },
        groqHealth: {
            totalKeys: 2,
            availableKeys: 2,
            exhaustedKeys: 0,
            coolingDownKeys: 0,
            invalidKeys: 0,
        },
        connectionTests: {
            gemini: { success: true },
            openai: { success: true },
            claude: { success: true },
        },
        ollama: {
            status: 'detected',
            models: ['llama3.2'],
        },
    });

    assert.deepEqual(
        model.orderedProviders.map((entry) => entry.provider),
        ['bedrock', 'groq', 'gemini', 'openai', 'claude', 'ollama'],
    );

    for (const entry of model.orderedProviders) {
        assert.equal(entry.configured, true, entry.provider);
        assert.equal(entry.reachable, true, entry.provider);
        assert.equal(entry.authenticated, true, entry.provider);
        assert.equal(entry.degraded, false, entry.provider);
        assert.ok(entry.lastDiagnostic, entry.provider);
    }
});

test('Sprint 7 UI-A provider health surface renders all provider rows from the read model', () => {
    const model = buildProviderHealthReadModel({
        credentials: {
            hasBedrockCredentials: true,
            hasGroqKey: true,
            hasGeminiKey: true,
            hasOpenaiKey: true,
            hasClaudeKey: true,
        },
        bedrock: { modelCount: 2 },
        groqHealth: {
            totalKeys: 2,
            availableKeys: 2,
            exhaustedKeys: 0,
            coolingDownKeys: 0,
            invalidKeys: 0,
        },
        connectionTests: {
            gemini: { success: true },
            openai: { success: true },
            claude: { success: true },
        },
        ollama: {
            status: 'detected',
            models: ['llama3.2'],
        },
    });
    const html = renderToStaticMarkup(React.createElement(ProviderHealthStatusSurface, { readModel: model }));

    assert.match(html, /Provider health status/);
    assert.match(html, /Amazon Bedrock/);
    assert.match(html, /Groq/);
    assert.match(html, /Gemini/);
    assert.match(html, /OpenAI/);
    assert.match(html, /Claude/);
    assert.match(html, /Ollama/);
    assert.match(html, /Last Diagnostic/);
    assert.match(html, /data-health-tone="normal"/);
});

test('Sprint 7 UI-A projects degraded and unconfigured status without routing analytics', () => {
    const model = buildProviderHealthReadModel({
        credentials: {
            hasBedrockCredentials: true,
            hasGeminiKey: true,
        },
        bedrock: {
            authExpired: true,
            checkedAt: 1000,
        },
        connectionTests: {
            gemini: {
                success: false,
                error: '429 rate limit exceeded',
            },
        },
        ollama: {
            configured: true,
            status: 'not-found',
            error: 'Ollama server not responding',
        },
    });

    assert.equal(model.providers.bedrock.configured, true);
    assert.equal(model.providers.bedrock.degraded, true);
    assert.equal(model.providers.bedrock.authenticated, false);
    assert.equal(model.providers.bedrock.lastDiagnostic?.category, 'auth_expired');
    assert.equal(model.providers.gemini.degraded, true);
    assert.equal(model.providers.gemini.lastDiagnostic?.category, 'rate_limited');
    assert.equal(model.providers.openai.configured, false);
    assert.equal(model.providers.openai.degraded, false);
    assert.equal(model.providers.openai.lastDiagnostic?.category, 'not_configured');
    assert.equal(model.providers.ollama.degraded, true);
    assert.equal(model.providers.ollama.lastDiagnostic?.category, 'ollama_unavailable');
});

test('Sprint 7 UI-A does not modify frozen provider foundation systems', () => {
    const surface = read('src/components/settings/ProviderHealthStatusSurface.tsx');
    const routing = read('src/lib/providers/providerRoutingReadModel.ts');
    const fallback = read('src/lib/providers/providerFallbackReadModel.ts');
    const telemetry = read('src/lib/providers/providerTelemetryReadModel.ts');
    const diagnostics = read('src/lib/providers/providerDiagnosticsReadModel.ts');
    const personalization = read('src/lib/providers/providerPersonalizationReadModel.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');

    assert.match(surface, /ProviderHealthStatusSurface/);
    assert.match(routing, /buildProviderRoutingReadModel/);
    assert.match(fallback, /buildProviderFallbackReadModel/);
    assert.match(telemetry, /buildProviderTelemetryReadModel/);
    assert.match(diagnostics, /buildProviderDiagnosticsReadModel/);
    assert.match(personalization, /buildProviderPersonalizationReadModel/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
    assert.match(ownership, /requestedProvider\?: string/);
});
