import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Sprint 8 Phase D settings keeps provider health visible and collapses analytics density', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');
    const operationsStart = settings.indexOf('aria-label="Provider operations"');
    const cloudProvidersStart = settings.indexOf('{/* Cloud Providers */}');
    const operationsBody = settings.slice(operationsStart, cloudProvidersStart);

    assert.match(settings, /function ProviderSettingsDisclosure/);
    assert.match(settings, /data-provider-settings-density="disclosure"/);
    assert.match(settings, /aria-label="Provider operations"/);
    assert.match(settings, /aria-label="Provider session analytics"/);

    assert.match(operationsBody, /<ProviderHealthStatusSurface readModel=\{providerHealthReadModel\} \/>/);
    assert.match(operationsBody, /<ProviderDiagnosticsSurface readModel=\{providerDiagnosticsReadModel\} \/>/);
    assert.match(operationsBody, /<ProviderSettingsDisclosure\s+title="Routing transparency"\s+summary=\{`\$\{providerRoutingReadModel\.summary\.totalRoutes\} routes`\}/s);
    assert.match(operationsBody, /<ProviderSettingsDisclosure\s+title="Fallback analytics"\s+summary=\{`\$\{providerFallbackReadModel\.summary\.totalFallbacks\} fallbacks`\}/s);
    assert.match(operationsBody, /<ProviderSettingsDisclosure\s+title="Telemetry"\s+summary=\{`\$\{providerTelemetryReadModel\.summary\.requestCount\} requests`\}/s);
    assert.match(operationsBody, /<ProviderSettingsDisclosure\s+title="Personalization impact"\s+summary=\{`\$\{providerPersonalizationReadModel\.summary\.totalResponses\} responses`\}/s);
    assert.match(operationsBody, /<ProviderSettingsDisclosure\s+title="Response provider drilldown"\s+summary=\{`\$\{providerRoutingReadModel\.routes\.length\} responses`\}/s);
});

test('Sprint 8 Phase D settings density cleanup does not add provider controls or new provider state', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');
    const operationsStart = settings.indexOf('aria-label="Provider operations"');
    const cloudProvidersStart = settings.indexOf('{/* Cloud Providers */}');
    const operationsBody = settings.slice(operationsStart, cloudProvidersStart);

    assert.doesNotMatch(operationsBody, /setProviderPreferredModel|setDefaultModel\(provider|setResponseHistory|capResponseHistoryMessages/);
    assert.doesNotMatch(operationsBody, /Retry|Reroute|Switch Provider|Save Preference|Provider Selector|LineChart|BarChart|recharts/);
    assert.doesNotMatch(settings, /useState<[^>]*ProviderSettingsDisclosure|setProviderSettingsDisclosure|analyticsPanelState/);
});
