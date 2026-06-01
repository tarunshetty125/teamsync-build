import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildProviderDiagnosticsReadModel,
    type ProviderDiagnosticsReadModel,
} from '../../src/lib/providers/providerDiagnosticsReadModel.ts';
import {
    buildProviderHealthReadModel,
    type ProviderHealthReadModel,
} from '../../src/lib/providers/providerHealthReadModel.ts';
import type { ProviderRoutingMessage } from '../../src/lib/providers/providerRoutingReadModel.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function ownershipMessage(
    id: string,
    routing: {
        requestedProvider: string;
        requestedModel: string;
        actualProvider?: string;
        actualModel?: string;
        routingReason?: string;
    },
): ProviderRoutingMessage {
    return {
        id,
        timestamp: 1000,
        ownership: {
            responseId: id,
            questionTurnId: `turn-${id}`,
            transcriptVersion: 1,
            contextTarget: 'latest_turn',
            actionId: 'what_to_answer',
            mode: 'coding',
            createdAt: 1000,
            sourceProvider: routing.requestedProvider,
            sourceModel: routing.requestedModel,
            requestedProvider: routing.requestedProvider,
            requestedModel: routing.requestedModel,
            actualProvider: routing.actualProvider ?? routing.requestedProvider,
            actualModel: routing.actualModel ?? routing.requestedModel,
            routingReason: routing.routingReason,
        },
    };
}

function buildModel(args: {
    responses?: ProviderRoutingMessage[];
    activeResponseId?: string;
    health?: ProviderHealthReadModel;
}): ProviderDiagnosticsReadModel {
    return buildProviderDiagnosticsReadModel({
        responses: args.responses,
        activeResponseId: args.activeResponseId,
        health: args.health,
        now: 2000,
    });
}

test('Sprint 7 Phase E projects AWS reauthentication diagnostics from provider health', () => {
    const health = buildProviderHealthReadModel({
        credentials: {
            hasBedrockCredentials: true,
            hasGroqKey: true,
            hasGeminiKey: true,
            hasOpenaiKey: true,
            hasClaudeKey: true,
        },
        bedrock: {
            authExpired: true,
            checkedAt: 1500,
        },
        groqHealth: {
            totalKeys: 1,
            availableKeys: 1,
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
    const model = buildModel({ health });
    const diagnostic = model.diagnostics[0];

    assert.equal(model.generatedAt, 2000);
    assert.equal(model.diagnostics.length, 1);
    assert.equal(diagnostic?.source, 'health');
    assert.equal(diagnostic?.provider, 'bedrock');
    assert.equal(diagnostic?.category, 'auth_expired');
    assert.equal(diagnostic?.severity, 'error');
    assert.equal(diagnostic?.title, 'AWS session expired');
    assert.equal(diagnostic?.actionable, true);
    assert.equal(diagnostic?.actionLabel, 'Re-authenticate AWS');
    assert.match(diagnostic?.message ?? '', /Re-authentication/i);
    assert.equal(model.summary.errorCount, 1);
    assert.equal(model.summary.bySource.health, 1);
});

test('Sprint 7 Phase E projects API key missing diagnostics without reading credentials directly', () => {
    const health = {
        orderedProviders: [
            {
                provider: 'openai',
                label: 'OpenAI',
                configured: false,
                reachable: false,
                authenticated: false,
                degraded: false,
                lastDiagnostic: {
                    category: 'not_configured',
                    message: 'OpenAI is not configured.',
                    source: 'provider-health',
                    at: 1600,
                },
            },
        ],
        providers: {},
        configuredCount: 0,
        degradedCount: 0,
        generatedAt: 1600,
    } as unknown as ProviderHealthReadModel;
    const model = buildModel({ health });
    const diagnostic = model.diagnostics[0];

    assert.equal(model.diagnostics.length, 1);
    assert.equal(diagnostic?.provider, 'openai');
    assert.equal(diagnostic?.category, 'not_configured');
    assert.equal(diagnostic?.severity, 'warning');
    assert.equal(diagnostic?.actionable, true);
    assert.equal(diagnostic?.actionLabel, 'Configure provider');
    assert.equal(model.byProvider.openai.length, 1);
});

test('Sprint 7 Phase E projects fallback diagnostics for active responses', () => {
    const model = buildModel({
        responses: [
            {
                id: 'response-fallback',
                requestId: 'request-fallback',
                intelligenceMetadata: {
                    routing: {
                        requestedProvider: 'bedrock',
                        requestedModel: 'openai.gpt-oss-120b-1:0',
                        actualProvider: 'groq',
                        actualModel: 'llama-3.3-70b-versatile',
                        reason: 'bedrock_auth_expired_fallback',
                    },
                    telemetry: {
                        fallbackUsed: true,
                        fallbackReason: 'bedrock_auth_expired_fallback',
                    },
                    fallbackChain: [
                        { provider: 'bedrock', model: 'openai.gpt-oss-120b-1:0', result: 'failure', reason: 'session expired' },
                        { provider: 'groq', model: 'llama-3.3-70b-versatile', result: 'success' },
                    ],
                },
            },
        ],
        activeResponseId: 'response-fallback',
    });
    const diagnostic = model.activeDiagnostics[0];

    assert.equal(model.activeDiagnostics.length, 1);
    assert.equal(diagnostic?.source, 'fallback');
    assert.equal(diagnostic?.responseId, 'response-fallback');
    assert.equal(diagnostic?.provider, 'bedrock');
    assert.equal(diagnostic?.category, 'auth_expired');
    assert.equal(diagnostic?.severity, 'error');
    assert.equal(diagnostic?.routingReason, 'bedrock_auth_expired_fallback');
    assert.equal(diagnostic?.actionLabel, 'Re-authenticate AWS');
    assert.match(diagnostic?.message ?? '', /routed to Groq/);
    assert.equal(model.byResponseId['response-fallback'].length, 1);
    assert.equal(model.summary.bySource.fallback, 1);
});

test('Sprint 7 Phase E projects routing remaps as informational diagnostics', () => {
    const model = buildModel({
        responses: [
            ownershipMessage('response-remap', {
                requestedProvider: 'bedrock',
                requestedModel: 'openai.gpt-oss-120b-1:0',
                actualProvider: 'bedrock',
                actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                routingReason: 'vision_required_model_remap',
            }),
        ],
        activeResponseId: 'response-remap',
    });
    const diagnostic = model.activeDiagnostics[0];

    assert.equal(diagnostic?.source, 'routing');
    assert.equal(diagnostic?.category, 'routing_remap');
    assert.equal(diagnostic?.severity, 'info');
    assert.equal(diagnostic?.actionable, false);
    assert.equal(diagnostic?.routingReason, 'vision_required_model_remap');
    assert.match(diagnostic?.message ?? '', /routed to Amazon Bedrock/);
    assert.equal(model.summary.infoCount, 1);
});

test('Sprint 7 Phase E projects telemetry cancellation and direct failure diagnostics', () => {
    const model = buildModel({
        responses: [
            {
                id: 'response-cancelled',
                requestId: 'request-cancelled',
                provider: 'gemini',
                model: 'gemini-3.1-flash-lite-preview',
                isStreaming: true,
                cancelled: true,
                intelligenceMetadata: {
                    telemetry: {
                        streamingStarted: true,
                        cancelled: true,
                    },
                },
            } as ProviderRoutingMessage,
            {
                id: 'response-failed',
                requestId: 'request-failed',
                provider: 'groq',
                model: 'llama-3.3-70b-versatile',
                intelligenceMetadata: {
                    telemetry: {
                        success: false,
                        error: 'rate limit',
                    },
                },
            },
        ],
        activeResponseId: 'response-failed',
    });
    const cancellation = model.byResponseId['response-cancelled'][0];
    const failure = model.activeDiagnostics[0];

    assert.equal(cancellation?.category, 'request_cancelled');
    assert.equal(cancellation?.severity, 'info');
    assert.equal(cancellation?.actionable, false);
    assert.equal(failure?.category, 'request_failed');
    assert.equal(failure?.severity, 'error');
    assert.equal(failure?.actionable, true);
    assert.equal(failure?.actionLabel, 'Review provider logs');
    assert.match(failure?.message ?? '', /rate limit/);
    assert.equal(model.summary.bySource.telemetry, 2);
    assert.equal(model.summary.errorCount, 1);
    assert.equal(model.summary.infoCount, 1);
});

test('Sprint 7 Phase E suppresses generic telemetry failures when fallback diagnostics exist', () => {
    const model = buildModel({
        responses: [
            ownershipMessage('response-safe', {
                requestedProvider: 'claude',
                requestedModel: 'claude-sonnet-4-6',
                actualProvider: 'local',
                actualModel: 'safe_action_fallback',
                routingReason: 'all_attempts_failed',
            }),
        ],
        activeResponseId: 'response-safe',
    });
    const diagnostics = model.activeDiagnostics;

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.source, 'fallback');
    assert.equal(diagnostics[0]?.category, 'safe_fallback');
    assert.equal(diagnostics[0]?.severity, 'error');
    assert.equal(model.summary.bySource.fallback, 1);
    assert.equal(model.summary.bySource.telemetry, undefined);
});

test('Sprint 7 Phase E summarizes diagnostics and reports missing active response cleanly', () => {
    const health = {
        orderedProviders: [
            {
                provider: 'groq',
                label: 'Groq',
                configured: true,
                reachable: false,
                authenticated: true,
                degraded: true,
                lastDiagnostic: {
                    category: 'cooldown',
                    message: 'All Groq keys are cooling down.',
                    source: 'groq-vault:get-health',
                    at: 1700,
                },
            },
        ],
        providers: {},
        configuredCount: 1,
        degradedCount: 1,
        generatedAt: 1700,
    } as unknown as ProviderHealthReadModel;
    const model = buildModel({
        health,
        responses: [
            ownershipMessage('response-remap', {
                requestedProvider: 'bedrock',
                requestedModel: 'openai.gpt-oss-120b-1:0',
                actualProvider: 'bedrock',
                actualModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
                routingReason: 'vision_required_model_remap',
            }),
        ],
        activeResponseId: 'missing-response',
    });

    assert.equal(model.activeResponseId, 'missing-response');
    assert.deepEqual(model.activeDiagnostics, []);
    assert.equal(model.summary.totalDiagnostics, 2);
    assert.equal(model.summary.warningCount, 1);
    assert.equal(model.summary.infoCount, 1);
    assert.equal(model.summary.actionableCount, 0);
    assert.equal(model.summary.byCategory.cooldown, 1);
    assert.equal(model.summary.byCategory.routing_remap, 1);
    assert.equal(model.summary.byProvider.groq, 1);
    assert.equal(model.summary.byProvider.bedrock, 1);
    assert.equal(model.summary.bySource.health, 1);
    assert.equal(model.summary.bySource.routing, 1);
});

test('Sprint 7 Phase E remains a read model without provider routing, diagnostics flow, benchmark, or persistence changes', () => {
    const helper = read('src/lib/providers/providerDiagnosticsReadModel.ts');
    const routing = read('electron/LLMHelper.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');
    const app = read('src/App.tsx');

    assert.match(helper, /buildProviderDiagnosticsReadModel/);
    assert.doesNotMatch(helper, /CredentialsManager/);
    assert.doesNotMatch(helper, /LLMHelper/);
    assert.doesNotMatch(helper, /BenchmarkManager/);
    assert.doesNotMatch(helper, /ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(helper, /electron-store|new Store/);
    assert.match(routing, /bedrock:reauthentication-required/);
    assert.match(ownership, /routingReason\?: string/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
    assert.match(app, /AWS session expired/);
});
