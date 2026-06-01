import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildProviderPersonalizationReadModel } from '../../src/lib/providers/providerPersonalizationReadModel.ts';
import type { ProviderRoutingMessage } from '../../src/lib/providers/providerRoutingReadModel.ts';
import { ProviderPersonalizationImpactSurface } from '../../src/components/settings/ProviderPersonalizationImpactSurface.tsx';

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
            actionId: 'manual_chat',
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

function samplePersonalizationMessages(): ProviderRoutingMessage[] {
    return [
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
        ownershipMessage(
            'response-remapped',
            {
                requestedProvider: 'bedrock',
                requestedModel: 'openai.gpt-oss-120b-1:0',
                actualProvider: 'claude',
                actualModel: 'claude-sonnet-4-6',
                routingReason: 'vision_required_model_remap',
            },
            {
                providerPreference: 'bedrock',
                responseStyle: 'balanced',
                interviewFocus: 'system_design',
                personalizationVersion: 1,
            },
        ),
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
        {
            id: 'response-none',
            provider: 'gemini',
            model: 'gemini-3.1-flash-lite-preview',
            intent: 'manual_chat',
        },
    ];
}

test('Sprint 7 UI-F personalization impact surface consumes ProviderPersonalizationReadModel only', () => {
    const surface = read('src/components/settings/ProviderPersonalizationImpactSurface.tsx');

    assert.match(surface, /ProviderPersonalizationImpactSurfaceProps/);
    assert.match(surface, /readModel: ProviderPersonalizationReadModel/);
    assert.match(surface, /readModel\.entries/);
    assert.match(surface, /readModel\.summary\.capturedCount/);
    assert.match(surface, /readModel\.summary\.autoCount/);
    assert.match(surface, /readModel\.summary\.remapCount/);
    assert.match(surface, /readModel\.summary\.fallbackCount/);
    assert.match(surface, /readModel\.summary\.bypassedCount/);
    assert.match(surface, /readModel\.summary\.satisfiedByActualCount/);
    assert.match(surface, /aria-label="Provider personalization impact"/);
    assert.match(surface, /Preferred Provider/);
    assert.match(surface, /Preferred Model/);
    assert.match(surface, /Requested Provider/);
    assert.match(surface, /Requested Model/);
    assert.match(surface, /Actual Provider/);
    assert.match(surface, /Actual Model/);
    assert.match(surface, /Auto Route/);
    assert.match(surface, /Remapped/);
    assert.match(surface, /Fallback Used/);
    assert.match(surface, /Preference Honored/);
    assert.match(surface, /Preference Bypassed/);
    assert.doesNotMatch(surface, /buildProviderHealthReadModel|buildProviderRoutingReadModel|buildProviderFallbackReadModel|buildProviderTelemetryReadModel|buildProviderDiagnosticsReadModel/);
    assert.doesNotMatch(surface, /CredentialsManager|LLMHelper|BenchmarkManager|ipcRenderer|ipcMain|safeHandle/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB|recharts|Chart|LineChart|BarChart/);
    assert.doesNotMatch(surface, /<button|onClick|setPersonalization|setProviderPreferredModel|setDefaultModel|switchProvider|Switch Provider/);
});

test('Sprint 7 UI-F renders provider preference impact rows and statuses', () => {
    const model = buildProviderPersonalizationReadModel({
        responses: samplePersonalizationMessages(),
        activeResponseId: 'response-fallback',
        now: 2000,
    });
    const html = renderToStaticMarkup(React.createElement(ProviderPersonalizationImpactSurface, { readModel: model }));

    assert.equal(model.summary.totalResponses, 7);
    assert.equal(model.summary.capturedCount, 6);
    assert.equal(model.summary.autoCount, 1);
    assert.equal(model.summary.appliedCount, 1);
    assert.equal(model.summary.fallbackCount, 1);
    assert.equal(model.summary.remapCount, 1);
    assert.equal(model.summary.bypassedCount, 1);
    assert.equal(model.summary.satisfiedByActualCount, 1);
    assert.match(html, /Provider personalization impact/);
    assert.match(html, /Preferred Provider/);
    assert.match(html, /Preferred Model/);
    assert.match(html, /Requested Provider/);
    assert.match(html, /Requested Model/);
    assert.match(html, /Actual Provider/);
    assert.match(html, /Actual Model/);
    assert.match(html, /Auto Route/);
    assert.match(html, /Remapped/);
    assert.match(html, /Fallback Used/);
    assert.match(html, /Preference Honored/);
    assert.match(html, /Preference Bypassed/);
    assert.match(html, /llama-3\.3-70b-versatile/);
    assert.match(html, /openai\.gpt-oss-120b-1:0/);
    assert.match(html, /gpt-5\.4/);
    assert.match(html, /Applied/);
    assert.match(html, /Auto/);
    assert.match(html, /Remapped/);
    assert.match(html, /Fallback/);
    assert.match(html, /Bypassed/);
    assert.match(html, /Satisfied By Actual/);
    assert.match(html, /Not Captured/);
    assert.match(html, /data-personalization-status="applied"/);
    assert.match(html, /data-personalization-status="auto"/);
    assert.match(html, /data-personalization-status="remapped"/);
    assert.match(html, /data-personalization-status="fallback"/);
    assert.match(html, /data-personalization-status="bypassed"/);
    assert.match(html, /data-personalization-status="satisfied_by_actual"/);
    assert.match(html, /data-personalization-status="not_captured"/);
});

test('Sprint 7 UI-F projects compact summary and read-only impact flags', () => {
    const model = buildProviderPersonalizationReadModel({
        responses: samplePersonalizationMessages(),
        now: 2000,
    });
    const html = renderToStaticMarkup(React.createElement(ProviderPersonalizationImpactSurface, { readModel: model }));

    assert.match(html, /data-personalization-count-key="groq"/);
    assert.match(html, /data-personalization-count-key="bedrock"/);
    assert.match(html, /data-personalization-count-key="claude"/);
    assert.match(html, /data-personalization-count-key="fallback"/);
    assert.match(html, /data-auto-route="true"/);
    assert.match(html, /data-remapped="true"/);
    assert.match(html, /data-fallback-used="true"/);
    assert.match(html, /data-preference-honored="true"/);
    assert.match(html, /data-preference-bypassed="true"/);
    assert.doesNotMatch(html, /<button|Switch Provider|Edit Preference|Provider Selector|Save Preference|Chart|LineChart|BarChart/);
});

test('Sprint 7 UI-F settings integration derives personalization read model without new provider state', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');

    assert.match(settings, /import \{ buildProviderPersonalizationReadModel \}/);
    assert.match(settings, /import \{ ProviderPersonalizationImpactSurface \}/);
    assert.match(settings, /const providerPersonalizationReadModel = useMemo/);
    assert.match(settings, /buildProviderPersonalizationReadModel\(\{ responses: \[\] \}\)/);
    assert.match(settings, /<ProviderPersonalizationImpactSurface readModel=\{providerPersonalizationReadModel\} \/>/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderPersonalization|setProviderPersonalization|providerPersonalizationState/);
    assert.doesNotMatch(settings, /setPersonalizationPreference|setDefaultModel\(providerPersonalization|setProviderPreferredModel\(providerPersonalization/);
});

test('Sprint 7 UI-F empty personalization model renders read-only empty states', () => {
    const model = buildProviderPersonalizationReadModel({ responses: [], now: 2000 });
    const html = renderToStaticMarkup(React.createElement(ProviderPersonalizationImpactSurface, { readModel: model }));

    assert.match(html, /Preferred Provider/);
    assert.match(html, /No provider preferences/);
    assert.match(html, /No personalization statuses/);
    assert.match(html, /No preference context/);
    assert.match(html, /No provider personalization impact/);
    assert.doesNotMatch(html, /<button|onClick|Switch Provider|Edit Preference/);
});

test('Sprint 7 UI-F does not modify routing, personalization settings, ownership, benchmark, or persistence systems', () => {
    const surface = read('src/components/settings/ProviderPersonalizationImpactSurface.tsx');
    const personalization = read('src/lib/providers/providerPersonalizationReadModel.ts');
    const routing = read('src/lib/providers/providerRoutingReadModel.ts');
    const fallback = read('src/lib/providers/providerFallbackReadModel.ts');
    const resolver = read('electron/personalization/ProviderPreferenceResolver.ts');
    const settings = read('electron/services/SettingsManager.ts');
    const ownership = read('src/lib/overlay/actionContextTypes.ts');
    const benchmark = read('electron/intelligence/BenchmarkManager.ts');

    assert.match(surface, /ProviderPersonalizationImpactSurface/);
    assert.match(personalization, /buildProviderPersonalizationReadModel/);
    assert.match(routing, /buildProviderRoutingReadModel/);
    assert.match(fallback, /buildProviderFallbackReadModel/);
    assert.match(resolver, /resolveModelForPreferredProvider/);
    assert.match(settings, /getPersonalizationPreferences/);
    assert.match(ownership, /providerPreference\?: string/);
    assert.match(benchmark, /record\(record: BenchmarkRecord\)/);
    assert.doesNotMatch(surface, /electron-store|new Store|safeHandle|ipcMain|ipcRenderer|SettingsManager|ProviderPreferenceResolver/);
});
