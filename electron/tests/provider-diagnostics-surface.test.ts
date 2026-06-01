import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    buildProviderDiagnosticsReadModel,
    type ProviderDiagnosticEntry,
    type ProviderDiagnosticsReadModel,
} from '../../src/lib/providers/providerDiagnosticsReadModel.ts';
import { buildProviderHealthReadModel } from '../../src/lib/providers/providerHealthReadModel.ts';
import { ProviderDiagnosticsSurface } from '../../src/components/settings/ProviderDiagnosticsSurface.tsx';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function diagnostic(
    id: string,
    category: ProviderDiagnosticEntry['category'],
    severity: ProviderDiagnosticEntry['severity'],
    message: string,
    provider?: string,
): ProviderDiagnosticEntry {
    return {
        id,
        provider,
        category,
        severity,
        title: category,
        message,
        source: category === 'routing_remap' ? 'routing' : category === 'request_cancelled' || category === 'request_failed' ? 'telemetry' : 'fallback',
        actionable: false,
    };
}

function manualReadModel(diagnostics: ProviderDiagnosticEntry[]): ProviderDiagnosticsReadModel {
    return {
        diagnostics,
        byId: Object.fromEntries(diagnostics.map((entry) => [entry.id, entry])),
        byResponseId: {},
        byProvider: {},
        activeDiagnostics: [],
        summary: {
            totalDiagnostics: diagnostics.length,
            infoCount: diagnostics.filter((entry) => entry.severity === 'info').length,
            warningCount: diagnostics.filter((entry) => entry.severity === 'warning').length,
            errorCount: diagnostics.filter((entry) => entry.severity === 'error').length,
            actionableCount: 0,
            byCategory: {},
            byProvider: {},
            bySource: {},
        },
        generatedAt: 2000,
    };
}

test('Sprint 7 UI-B diagnostics surface consumes ProviderDiagnosticsReadModel only', () => {
    const surface = read('src/components/settings/ProviderDiagnosticsSurface.tsx');

    assert.match(surface, /ProviderDiagnosticsSurfaceProps/);
    assert.match(surface, /readModel: ProviderDiagnosticsReadModel/);
    assert.match(surface, /readModel\.diagnostics/);
    assert.match(surface, /aria-label="Provider diagnostics"/);
    assert.match(surface, /aria-label="Provider diagnostics list"/);
    assert.match(surface, /data-diagnostic-category=\{diagnostic\.category\}/);
    assert.match(surface, /data-diagnostic-severity=\{diagnostic\.severity\}/);
    assert.doesNotMatch(surface, /buildProviderHealthReadModel|buildProviderRoutingReadModel|buildProviderFallbackReadModel|buildProviderTelemetryReadModel|buildProviderPersonalizationReadModel/);
    assert.doesNotMatch(surface, /CredentialsManager|LLMHelper|BenchmarkManager|ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB|recharts|Chart/);
    assert.doesNotMatch(surface, /<button|onClick|actionLabel|retry|Retry/);
});

test('Sprint 7 UI-B renders the approved diagnostic categories as a read-only list', () => {
    const model = manualReadModel([
        diagnostic('aws-reauth', 'auth_expired', 'error', 'AWS session expired.', 'bedrock'),
        diagnostic('missing-creds', 'not_configured', 'warning', 'OpenAI is not configured.', 'openai'),
        diagnostic('provider-unavailable', 'provider_unavailable', 'error', 'Ollama server not responding.', 'ollama'),
        diagnostic('model-unavailable', 'model_unavailable', 'error', 'Model access failed.', 'bedrock'),
        diagnostic('fallback', 'fallback_activated', 'warning', 'Bedrock routed to Groq.', 'bedrock'),
        diagnostic('safe-fallback', 'safe_fallback', 'error', 'Safe fallback response used.', 'local'),
        diagnostic('validation', 'validation_failed', 'error', 'Provider output failed validation.', 'gemini'),
        diagnostic('remap', 'routing_remap', 'info', 'Text model routed to vision model.', 'bedrock'),
        diagnostic('cancelled', 'request_cancelled', 'info', 'Provider request cancelled.', 'gemini'),
        diagnostic('direct-failure', 'request_failed', 'error', 'Groq request failed.', 'groq'),
    ]);
    const html = renderToStaticMarkup(React.createElement(ProviderDiagnosticsSurface, { readModel: model }));

    assert.match(html, /AWS Reauth Required/);
    assert.match(html, /Missing Credentials/);
    assert.match(html, /Provider Unavailable/);
    assert.match(html, /Model Unavailable/);
    assert.match(html, /Fallback Activated/);
    assert.match(html, /Safe Fallback Activated/);
    assert.match(html, /Validation Failure/);
    assert.match(html, /Route Remap/);
    assert.match(html, /Cancellation/);
    assert.match(html, /Direct Provider Failure/);
    assert.match(html, /Error/);
    assert.match(html, /Warning/);
    assert.match(html, /Info/);
    assert.doesNotMatch(html, /Re-authenticate AWS|Configure provider|Review provider logs|Retry/);
});

test('Sprint 7 UI-B settings integration derives diagnostics from the existing health read model', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');

    assert.match(settings, /import \{ buildProviderDiagnosticsReadModel \}/);
    assert.match(settings, /import \{ ProviderDiagnosticsSurface \}/);
    assert.match(settings, /const providerDiagnosticsReadModel = useMemo/);
    assert.match(settings, /buildProviderDiagnosticsReadModel\(\{ health: providerHealthReadModel \}\)/);
    assert.match(settings, /<ProviderDiagnosticsSurface readModel=\{providerDiagnosticsReadModel\} \/>/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderDiagnostics|setProviderDiagnostics|providerDiagnosticsState/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderPersonalization|setProviderPersonalization|providerPersonalizationState/);
});

test('Sprint 7 UI-B read model projects health diagnostics for the settings surface', () => {
    const health = buildProviderHealthReadModel({
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
                error: 'Model unavailable in this region',
            },
        },
    });
    const model = buildProviderDiagnosticsReadModel({ health, now: 2000 });

    assert.equal(model.diagnostics.length >= 2, true);
    assert.equal(model.diagnostics.some((entry) => entry.category === 'auth_expired' && entry.provider === 'bedrock'), true);
    assert.equal(model.diagnostics.some((entry) => entry.category === 'model_unavailable' || entry.category === 'provider_unavailable'), true);
    assert.equal(model.summary.bySource.health >= 2, true);
});

test('Sprint 7 UI-B does not modify routing, ownership, diagnostics flow, benchmark, or persistence systems', () => {
    const surface = read('src/components/settings/ProviderDiagnosticsSurface.tsx');
    const routing = read('src/lib/providers/providerRoutingReadModel.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');
    const helper = read('electron/LLMHelper.ts');

    assert.match(surface, /ProviderDiagnosticsSurface/);
    assert.match(routing, /buildProviderRoutingReadModel/);
    assert.match(ownership, /requestedProvider\?: string/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
    assert.match(helper, /bedrock:reauthentication-required/);
    assert.doesNotMatch(surface, /electron-store|new Store|safeHandle|ipcMain|ipcRenderer/);
});
