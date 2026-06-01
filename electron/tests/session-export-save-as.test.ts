import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    SESSION_EXPORT_DELIVERY_IPC,
    buildSessionExportDefaultFileName,
    getSessionExportFileExtension,
    validateSessionExportClipboardRequest,
    validateSessionExportSaveRequest,
} from '../../src/lib/export/sessionExportDelivery.ts';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function extractBetween(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
    const endIndex = source.indexOf(end, startIndex);
    assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
    return source.slice(startIndex, endIndex);
}

test('Sprint 11 Phase D defines a dedicated Save-As delivery contract', () => {
    assert.equal(SESSION_EXPORT_DELIVERY_IPC.save, 'session-export:save-report');
    assert.equal(getSessionExportFileExtension('markdown'), 'md');
    assert.equal(getSessionExportFileExtension('html'), 'html');
    assert.match(buildSessionExportDefaultFileName('markdown', 2000), /^TeamSync Session Report - .*\.md$/);
    assert.match(buildSessionExportDefaultFileName('html', 2000), /^TeamSync Session Report - .*\.html$/);
});

test('Sprint 11 Phase D validates export save requests before delivery', () => {
    const valid = validateSessionExportSaveRequest({
        format: 'markdown',
        content: '# TeamSync Session Report',
        generatedAt: 2000,
        guardrailStatus: 'valid',
        blocked: false,
    });
    const warning = validateSessionExportSaveRequest({
        format: 'html',
        content: '<!doctype html><html><body>report</body></html>',
        guardrailStatus: 'warning',
        blocked: false,
    });
    const blocked = validateSessionExportSaveRequest({
        format: 'markdown',
        content: '# blocked',
        guardrailStatus: 'valid',
        blocked: true,
    });
    const invalid = validateSessionExportSaveRequest({
        format: 'markdown',
        content: '# invalid',
        guardrailStatus: 'invalid',
        blocked: false,
    });
    const unsafeHtml = validateSessionExportSaveRequest({
        format: 'html',
        content: '<!doctype html><script>alert(1)</script>',
        guardrailStatus: 'valid',
        blocked: false,
    });

    assert.equal(valid.valid, true);
    assert.equal(warning.valid, true);
    assert.equal(blocked.valid, false);
    assert.equal(invalid.valid, false);
    assert.equal(unsafeHtml.valid, false);
});

test('Sprint 11 Phase E validates clipboard delivery with the same guardrail boundary', () => {
    const valid = validateSessionExportClipboardRequest({
        format: 'markdown',
        content: '# TeamSync Session Report',
        guardrailStatus: 'valid',
        blocked: false,
    });
    const warning = validateSessionExportClipboardRequest({
        format: 'html',
        content: '<!doctype html><html><body>report</body></html>',
        guardrailStatus: 'warning',
        blocked: false,
    });
    const blocked = validateSessionExportClipboardRequest({
        format: 'markdown',
        content: '# blocked',
        guardrailStatus: 'valid',
        blocked: true,
    });
    const invalid = validateSessionExportClipboardRequest({
        format: 'markdown',
        content: '# invalid',
        guardrailStatus: 'invalid',
        blocked: false,
    });
    const empty = validateSessionExportClipboardRequest({
        format: 'markdown',
        content: '',
        guardrailStatus: 'valid',
        blocked: false,
    });

    assert.equal(valid.valid, true);
    assert.equal(warning.valid, true);
    assert.equal(blocked.valid, false);
    assert.equal(invalid.valid, false);
    assert.equal(empty.valid, false);
});

test('Sprint 11 Phase D exposes Save-As through preload without redesigning channels', () => {
    const preload = read('electron/preload.ts');
    const types = read('src/types/electron.d.ts');

    assert.match(preload, /SESSION_EXPORT_DELIVERY_IPC/);
    assert.match(preload, /saveSessionExportReport/);
    assert.match(preload, /ipcRenderer\.invoke\(SESSION_EXPORT_DELIVERY_IPC\.save, request\)/);
    assert.match(types, /saveSessionExportReport: \(request: SessionExportSaveRequest\) => Promise<SessionExportSaveResult>/);
});

test('Sprint 11 Phase D uses a user-selected save dialog and no export persistence store', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const handler = extractBetween(
        ipc,
        'safeHandle(SESSION_EXPORT_DELIVERY_IPC.save',
        'safeHandle("delete-screenshot"',
    );

    assert.match(handler, /validateSessionExportSaveRequest\(request\)/);
    assert.match(handler, /dialog\.showSaveDialog/);
    assert.match(handler, /fs\.promises\.writeFile\(selectedPath, saveRequest\.content, 'utf8'\)/);
    assert.match(handler, /return \{ success: false, canceled: true \}/);
    assert.doesNotMatch(handler, /CredentialsManager|DatabaseManager|BenchmarkManager|electron-store|new Store|localStorage|sessionStorage|indexedDB/);
});

test('Sprint 11 Phase D wires Save-As into the preview surface only', () => {
    const component = read('src/components/pro-v2/ExportPreviewSurface.tsx');
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(component, /Save As/);
    assert.match(component, /saveSessionExportReport/);
    assert.match(component, /buildSessionExportDefaultFileName/);
    assert.match(component, /disabled=\{!canSave \|\| saveState === 'saving'\}/);
    assert.match(component, /guardrailStatus: preview\.guardrailStatus === 'warning' \? 'warning' : 'valid'/);
    assert.doesNotMatch(component, /showSaveFilePicker|download=|ipcRenderer|ipcMain|writeFile|appendFile|pdfkit|html2pdf/);
    assert.doesNotMatch(surface, /saveSessionExportReport|SESSION_EXPORT_DELIVERY_IPC|ipcRenderer|ipcMain/);
});

test('Sprint 11 Phase E hardens clipboard copy from the preview surface only', () => {
    const component = read('src/components/pro-v2/ExportPreviewSurface.tsx');
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(component, /validateSessionExportClipboardRequest/);
    assert.match(component, /navigator\.clipboard\?\.writeText/);
    assert.match(component, /navigator\.clipboard\.writeText\(preview\.contentPreview\)/);
    assert.match(component, /Clipboard access is unavailable/);
    assert.match(component, /Blocked exports cannot be copied/);
    assert.match(component, /Copy is available after preview review/);
    assert.doesNotMatch(surface, /navigator\.clipboard\.writeText\(report\.content\)/);
});
