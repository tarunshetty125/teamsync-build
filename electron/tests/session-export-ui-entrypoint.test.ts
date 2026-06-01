import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Sprint 10 Phase F exposes a Pro V2 export entry point from retained response history', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const shell = read('src/components/pro-v2/TeamSyncCluelyOverlay.tsx');

    assert.match(surface, /responseHistory: V2Message\[\]/);
    assert.match(shell, /responseHistory=\{bridge\.responseHistory\}/);
    assert.match(surface, /buildSessionExportReadModel/);
    assert.match(surface, /responses: responseHistory/);
    assert.match(surface, /activeResponseId/);
    assert.match(surface, /diagramTimeline/);
    assert.match(surface, /parentCurrentEvolution: parentEvolutionSummary/);
    assert.match(surface, /rootCurrentEvolution: rootEvolutionSummary/);
    assert.match(surface, /diagramGuardrails/);
});

test('Sprint 10 Phase F export entry point generates Markdown and HTML reports only on user action', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(surface, /generateSessionExportMarkdownReport\(exportModel\)/);
    assert.match(surface, /generateSessionExportHtmlReport\(exportModel\)/);
    assert.match(surface, /navigator\.clipboard\.writeText\(report\.content\)/);
    assert.match(surface, /Copy Markdown session report/);
    assert.match(surface, /Copy HTML session report/);
    assert.match(surface, /onClick=\{\(\) => handleCopyExportReport\('markdown'\)\}/);
    assert.match(surface, /onClick=\{\(\) => handleCopyExportReport\('html'\)\}/);
});

test('Sprint 10 Phase F preserves provider and diagram read-model boundaries', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(surface, /buildProviderRoutingReadModel\(\{\s*responses: responseHistory,/s);
    assert.match(surface, /buildProviderFallbackReadModel\(\{\s*responses: responseHistory,/s);
    assert.match(surface, /buildProviderTelemetryReadModel\(\{\s*responses: responseHistory,/s);
    assert.match(surface, /buildProviderDiagnosticsReadModel\(\{\s*responses: responseHistory,/s);
    assert.match(surface, /buildProviderPersonalizationReadModel\(\{\s*responses: responseHistory,/s);
    assert.doesNotMatch(surface, /setResponseSelection\(|capResponseHistoryMessages\(|resolveNextActiveResponseSelection\(/);
});

test('Sprint 10 Phase F remains UI-only without IPC, persistence, or file export actions', () => {
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');
    const css = read('src/components/pro-v2/pro-v2.css');

    assert.match(css, /\.v2-export-actions/);
    assert.match(css, /\.v2-export-btn/);
    assert.match(css, /\.v2-panel-btn:focus-visible/);
    assert.doesNotMatch(surface, /ipcMain|ipcRenderer|safeHandle|preload/);
    assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB|electron-store|writeFile|appendFile/);
    assert.doesNotMatch(surface, /showSaveFilePicker|createObjectURL|download=|BrowserWindow|pdfkit|html2pdf|puppeteer/);
});
