import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function providerSettingsDisclosureBody(settings: string): string {
    const start = settings.indexOf('function ProviderSettingsDisclosure');
    const end = settings.indexOf('const ModelSelect');

    assert.notEqual(start, -1);
    assert.notEqual(end, -1);

    return settings.slice(start, end);
}

test('Sprint 9 Phase C settings analytics disclosures lazily mount collapsed content', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');
    const disclosure = providerSettingsDisclosureBody(settings);

    assert.match(disclosure, /const \[hasMountedContent, setHasMountedContent\] = useState\(false\)/);
    assert.match(disclosure, /const handleDisclosureToggle = \(event: React\.SyntheticEvent<HTMLDetailsElement>\)/);
    assert.match(disclosure, /event\.currentTarget\.open/);
    assert.match(disclosure, /setHasMountedContent\(true\)/);
    assert.match(disclosure, /data-provider-settings-render="lazy"/);
    assert.match(disclosure, /onToggle=\{handleDisclosureToggle\}/);
    assert.match(disclosure, /\{hasMountedContent && \(\s*<div className="border-t border-border-subtle p-4">/s);
});

test('Sprint 9 Phase C settings render optimization preserves analytics wiring', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');
    const operationsStart = settings.indexOf('aria-label="Provider operations"');
    const cloudProvidersStart = settings.indexOf('{/* Cloud Providers */}');
    const operationsBody = settings.slice(operationsStart, cloudProvidersStart);

    assert.match(operationsBody, /<ProviderHealthStatusSurface readModel=\{providerHealthReadModel\} \/>/);
    assert.match(operationsBody, /<ProviderDiagnosticsSurface readModel=\{providerDiagnosticsReadModel\} \/>/);
    assert.match(operationsBody, /<ProviderRoutingTransparencySurface readModel=\{providerRoutingReadModel\} \/>/);
    assert.match(operationsBody, /<ProviderFallbackAnalyticsSurface readModel=\{providerFallbackReadModel\} \/>/);
    assert.match(operationsBody, /<ProviderTelemetrySurface readModel=\{providerTelemetryReadModel\} \/>/);
    assert.match(operationsBody, /<ProviderPersonalizationImpactSurface readModel=\{providerPersonalizationReadModel\} \/>/);
    assert.match(operationsBody, /<ProviderResponseDrilldownSurface/);
    assert.match(settings, /buildProviderRoutingReadModel\(\{\s*responses: providerAnalyticsSnapshot\.responses,\s*activeResponseId: providerAnalyticsSnapshot\.activeResponseId,/s);
    assert.match(settings, /buildProviderFallbackReadModel\(\{\s*responses: providerAnalyticsSnapshot\.responses,\s*activeResponseId: providerAnalyticsSnapshot\.activeResponseId,/s);
    assert.match(settings, /buildProviderTelemetryReadModel\(\{\s*responses: providerAnalyticsSnapshot\.responses,\s*activeResponseId: providerAnalyticsSnapshot\.activeResponseId,/s);
    assert.match(settings, /buildProviderPersonalizationReadModel\(\{\s*responses: providerAnalyticsSnapshot\.responses,\s*activeResponseId: providerAnalyticsSnapshot\.activeResponseId,/s);
});

test('Sprint 9 Phase C does not introduce settings persistence, routing, or code-split architecture', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');
    const disclosure = providerSettingsDisclosureBody(settings);

    assert.doesNotMatch(disclosure, /React\.lazy|Suspense|import\(/);
    assert.doesNotMatch(disclosure, /localStorage|writeFile|setProviderPreferredModel|setDefaultModel|setProviderAnalyticsSessionSnapshot/);
    assert.doesNotMatch(disclosure, /buildProviderRoutingReadModel|buildProviderFallbackReadModel|buildProviderTelemetryReadModel|buildProviderPersonalizationReadModel/);
});
