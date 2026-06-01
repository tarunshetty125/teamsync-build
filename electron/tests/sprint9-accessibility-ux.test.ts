import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Sprint 9 Phase B adds accessible keyboard contracts to custom dropdowns', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');
    const providerCard = read('src/components/settings/ProviderCard.tsx');
    const modelSelector = read('src/components/ModelSelectorWindow.tsx');

    for (const source of [settings, providerCard, modelSelector]) {
        assert.match(source, /role="combobox"/);
        assert.match(source, /aria-expanded/);
        assert.match(source, /aria-controls/);
        assert.match(source, /aria-activedescendant/);
        assert.match(source, /role="listbox"/);
        assert.match(source, /role="option"/);
        assert.match(source, /aria-selected/);
        assert.match(source, /ArrowDown/);
        assert.match(source, /ArrowUp/);
        assert.match(source, /Escape/);
        assert.match(source, /Enter/);
    }

    assert.match(settings, /handleComboboxKeyDown/);
    assert.match(providerCard, /handleModelComboboxKeyDown/);
    assert.match(modelSelector, /handleModelListKeyDown/);
});

test('Sprint 9 Phase B adds valid table cell semantics to provider analytics surfaces', () => {
    const surfaces = [
        read('src/components/settings/ProviderHealthStatusSurface.tsx'),
        read('src/components/settings/ProviderRoutingTransparencySurface.tsx'),
        read('src/components/settings/ProviderFallbackAnalyticsSurface.tsx'),
        read('src/components/settings/ProviderTelemetrySurface.tsx'),
        read('src/components/settings/ProviderPersonalizationImpactSurface.tsx'),
        read('src/components/settings/ProviderResponseDrilldownSurface.tsx'),
    ];

    for (const surface of surfaces) {
        assert.match(surface, /role="table"/);
        assert.match(surface, /role="row"/);
        assert.match(surface, /role="columnheader"/);
        assert.match(surface, /role="rowheader"|cellRole="rowheader"/);
        assert.match(surface, /role="cell"|cellRole = 'cell'/);
    }
});

test('Sprint 9 Phase B hardens diagram comparison tab semantics and keyboard navigation', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(surface, /role="tablist"/);
    assert.match(surface, /role="tab"/);
    assert.match(surface, /role="tabpanel"/);
    assert.match(surface, /aria-controls=\{controlsId\}/);
    assert.match(surface, /aria-labelledby/);
    assert.match(surface, /tabIndex=\{tabIndex\}/);
    assert.match(surface, /ArrowRight/);
    assert.match(surface, /ArrowLeft/);
    assert.match(surface, /Home/);
    assert.match(surface, /End/);
    assert.match(surface, /requestAnimationFrame/);
});

test('Sprint 9 Phase B adds shared focus-visible treatment', () => {
    const globalCss = read('src/index.css');
    const proCss = read('src/components/pro-v2/pro-v2.css');

    assert.match(globalCss, /:where\(button, \[role="button"\], \[role="combobox"\], \[role="tab"\], summary, select, input, textarea\):focus-visible/);
    assert.match(globalCss, /outline: 2px solid rgba\(125, 211, 252, 0\.86\)/);
    assert.match(proCss, /\.v2-diagram-timeline-version:focus-visible/);
    assert.match(proCss, /\.v2-response-switcher-btn:focus-visible/);
    assert.match(proCss, /\.v2-diagram-comparison-mode:focus-visible/);
    assert.match(proCss, /\.v2-diagram-node-drawer:focus-visible/);
});

test('Sprint 9 Phase B adds node drawer focus transfer, Escape close, and focus restoration', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(surface, /drawerRef/);
    assert.match(surface, /previousFocusRef/);
    assert.match(surface, /drawerRef\.current\?\.focus/);
    assert.match(surface, /previousFocusRef\.current\?\.focus/);
    assert.match(surface, /event\.key !== 'Escape'/);
    assert.match(surface, /tabIndex=\{-1\}/);
    assert.match(surface, /onKeyDown=\{handleDrawerKeyDown\}/);
});
