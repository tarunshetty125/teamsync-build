import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildProviderPersonalizationReadModel,
    type ProviderPersonalizationReadModel,
} from '../../src/lib/providers/providerPersonalizationReadModel.ts';
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
    personalization: {
        resolvedCodingLanguage?: string;
        providerPreference?: string;
        responseStyle?: string;
        interviewFocus?: string;
        personalizationVersion?: number;
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
            resolvedCodingLanguage: personalization.resolvedCodingLanguage,
            providerPreference: personalization.providerPreference,
            responseStyle: personalization.responseStyle,
            interviewFocus: personalization.interviewFocus,
            personalizationVersion: personalization.personalizationVersion,
        },
    };
}

function buildModel(responses: ProviderRoutingMessage[], activeResponseId?: string): ProviderPersonalizationReadModel {
    return buildProviderPersonalizationReadModel({
        responses,
        activeResponseId,
        now: 2000,
    });
}

test('Sprint 7 Phase F projects applied provider preference snapshots from ResponseOwnership', () => {
    const model = buildModel([
        ownershipMessage(
            'response-applied',
            {
                requestedProvider: 'groq',
                requestedModel: 'llama-3.3-70b-versatile',
            },
            {
                resolvedCodingLanguage: 'JavaScript',
                providerPreference: 'groq',
                responseStyle: 'detailed',
                interviewFocus: 'coding',
                personalizationVersion: 1,
            },
        ),
    ], 'response-applied');
    const entry = model.activeEntry;

    assert.equal(model.generatedAt, 2000);
    assert.equal(entry?.responseId, 'response-applied');
    assert.equal(entry?.source, 'ownership');
    assert.equal(entry?.personalizationVersion, 1);
    assert.equal(entry?.resolvedCodingLanguage, 'JavaScript');
    assert.equal(entry?.providerPreference, 'groq');
    assert.equal(entry?.responseStyle, 'detailed');
    assert.equal(entry?.interviewFocus, 'coding');
    assert.equal(entry?.requestedProvider, 'groq');
    assert.equal(entry?.actualProvider, 'groq');
    assert.equal(entry?.providerPreferenceCaptured, true);
    assert.equal(entry?.requestedMatchesPreference, true);
    assert.equal(entry?.actualMatchesPreference, true);
    assert.equal(entry?.providerPreferenceStatus, 'applied');
    assert.equal(entry?.fallbackUsed, false);
    assert.equal(model.summary.totalResponses, 1);
    assert.equal(model.summary.capturedCount, 1);
    assert.equal(model.summary.appliedCount, 1);
    assert.equal(model.summary.byProviderPreference.groq, 1);
    assert.equal(model.summary.byResponseStyle.detailed, 1);
    assert.equal(model.summary.byInterviewFocus.coding, 1);
    assert.equal(model.summary.byCodingLanguage.JavaScript, 1);
    assert.equal(model.summary.byVersion['1'], 1);
});

test('Sprint 7 Phase F shows preferred provider fallback without modifying routing truth', () => {
    const model = buildModel([
        ownershipMessage(
            'response-fallback',
            {
                requestedProvider: 'bedrock',
                requestedModel: 'openai.gpt-oss-120b-1:0',
                actualProvider: 'groq',
                actualModel: 'llama-3.3-70b-versatile',
                routingReason: 'bedrock_auth_expired_fallback',
            },
            {
                providerPreference: 'bedrock',
                responseStyle: 'balanced',
                interviewFocus: 'system_design',
                personalizationVersion: 1,
            },
        ),
    ], 'response-fallback');
    const entry = model.activeEntry;

    assert.equal(entry?.providerPreference, 'bedrock');
    assert.equal(entry?.requestedProvider, 'bedrock');
    assert.equal(entry?.actualProvider, 'groq');
    assert.equal(entry?.routingReason, 'bedrock_auth_expired_fallback');
    assert.equal(entry?.fallbackUsed, true);
    assert.equal(entry?.fallbackCategory, 'auth_expired');
    assert.equal(entry?.requestedMatchesPreference, true);
    assert.equal(entry?.actualMatchesPreference, false);
    assert.equal(entry?.providerPreferenceStatus, 'fallback');
    assert.equal(model.summary.fallbackCount, 1);
    assert.equal(model.summary.byStatus.fallback, 1);
    assert.equal(model.summary.byProviderPreference.bedrock, 1);
});

test('Sprint 7 Phase F treats auto provider preference as captured but not applied', () => {
    const model = buildModel([
        ownershipMessage(
            'response-auto',
            {
                requestedProvider: 'openai',
                requestedModel: 'gpt-5.4',
            },
            {
                providerPreference: 'auto',
                responseStyle: 'concise',
                interviewFocus: 'mixed',
                personalizationVersion: 1,
            },
        ),
    ], 'response-auto');
    const entry = model.activeEntry;

    assert.equal(entry?.source, 'ownership');
    assert.equal(entry?.providerPreference, 'auto');
    assert.equal(entry?.providerPreferenceCaptured, true);
    assert.equal(entry?.providerPreferenceStatus, 'auto');
    assert.equal(entry?.requestedMatchesPreference, false);
    assert.equal(entry?.actualMatchesPreference, false);
    assert.equal(model.summary.autoCount, 1);
    assert.equal(model.summary.appliedCount, 0);
    assert.equal(model.summary.byProviderPreference.auto, 1);
});

test('Sprint 7 Phase F falls back to debug personalization metadata when ownership is absent', () => {
    const model = buildModel([
        {
            id: 'response-debug',
            requestId: 'request-debug',
            intelligenceMetadata: {
                routing: {
                    requestedProvider: 'claude',
                    requestedModel: 'claude-sonnet-4-6',
                    actualProvider: 'claude',
                    actualModel: 'claude-sonnet-4-6',
                    reason: 'requested_model',
                },
                personalization: {
                    resolvedCodingLanguage: 'TypeScript',
                    providerPreference: 'claude',
                    responseStyle: 'concise',
                    interviewFocus: 'behavioral',
                    personalizationVersion: 1,
                },
            },
        },
    ], 'response-debug');
    const entry = model.activeEntry;

    assert.equal(entry?.source, 'debug_metadata');
    assert.equal(entry?.requestId, 'request-debug');
    assert.equal(entry?.resolvedCodingLanguage, 'TypeScript');
    assert.equal(entry?.providerPreference, 'claude');
    assert.equal(entry?.responseStyle, 'concise');
    assert.equal(entry?.interviewFocus, 'behavioral');
    assert.equal(entry?.providerPreferenceStatus, 'applied');
    assert.equal(model.summary.capturedCount, 1);
    assert.equal(model.summary.byCodingLanguage.TypeScript, 1);
});

test('Sprint 7 Phase F distinguishes bypassed and satisfied-by-actual provider preferences', () => {
    const model = buildModel([
        ownershipMessage(
            'response-bypassed',
            {
                requestedProvider: 'openai',
                requestedModel: 'gpt-5.4',
            },
            {
                providerPreference: 'claude',
                responseStyle: 'balanced',
                interviewFocus: 'coding',
                personalizationVersion: 1,
            },
        ),
        ownershipMessage(
            'response-satisfied',
            {
                requestedProvider: 'openai',
                requestedModel: 'gpt-5.4',
                actualProvider: 'claude',
                actualModel: 'claude-sonnet-4-6',
                routingReason: 'manual_provider_route',
            },
            {
                providerPreference: 'claude',
                responseStyle: 'balanced',
                interviewFocus: 'coding',
                personalizationVersion: 1,
            },
        ),
    ], 'response-satisfied');

    assert.equal(model.byResponseId['response-bypassed'].providerPreferenceStatus, 'bypassed');
    assert.equal(model.byResponseId['response-bypassed'].requestedMatchesPreference, false);
    assert.equal(model.byResponseId['response-bypassed'].actualMatchesPreference, false);
    assert.equal(model.byResponseId['response-satisfied'].providerPreferenceStatus, 'satisfied_by_actual');
    assert.equal(model.byResponseId['response-satisfied'].requestedMatchesPreference, false);
    assert.equal(model.byResponseId['response-satisfied'].actualMatchesPreference, true);
    assert.equal(model.summary.bypassedCount, 1);
    assert.equal(model.summary.satisfiedByActualCount, 1);
    assert.equal(model.summary.byStatus.bypassed, 1);
    assert.equal(model.summary.byStatus.satisfied_by_actual, 1);
});

test('Sprint 7 Phase F reports uncaptured personalization and missing active response cleanly', () => {
    const model = buildModel([
        {
            id: 'response-none',
            provider: 'gemini',
            model: 'gemini-3.1-flash-lite-preview',
            intent: 'manual_chat',
        },
    ], 'missing-response');
    const entry = model.byResponseId['response-none'];

    assert.equal(model.activeResponseId, 'missing-response');
    assert.equal(model.activeEntry, null);
    assert.equal(entry.source, 'none');
    assert.equal(entry.providerPreferenceCaptured, false);
    assert.equal(entry.providerPreferenceStatus, 'not_captured');
    assert.equal(model.summary.uncapturedCount, 1);
    assert.equal(model.summary.byStatus.not_captured, 1);
});

test('Sprint 7 Phase F remains a read model without provider routing, preferences, ownership, or persistence changes', () => {
    const helper = read('src/lib/providers/providerPersonalizationReadModel.ts');
    const resolver = read('electron/personalization/ProviderPreferenceResolver.ts');
    const settings = read('electron/services/SettingsManager.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');

    assert.match(helper, /buildProviderPersonalizationReadModel/);
    assert.doesNotMatch(helper, /CredentialsManager/);
    assert.doesNotMatch(helper, /SettingsManager/);
    assert.doesNotMatch(helper, /LLMHelper/);
    assert.doesNotMatch(helper, /BenchmarkManager/);
    assert.doesNotMatch(helper, /ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(helper, /electron-store|new Store/);
    assert.match(resolver, /resolveModelForPreferredProvider/);
    assert.match(settings, /getPersonalizationPreferences/);
    assert.match(ownership, /providerPreference\?: string/);
});
