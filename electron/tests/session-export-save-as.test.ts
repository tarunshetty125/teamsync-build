import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
    SESSION_EXPORT_DELIVERY_IPC,
    SESSION_EXPORT_PDF_RUNTIME_BUDGETS,
    buildSessionExportIpcBoundaryDiagnostic,
    buildSessionExportDefaultFileName,
    getSessionExportFileExtension,
    sanitizeSessionExportDeliveryError,
    validateSessionExportClipboardRequest,
    validateSessionExportPdfBuffer,
    validateSessionExportPdfSaveRequest,
    validateSessionExportSaveRequest,
    type SessionExportSaveResult,
} from '../../src/lib/export/sessionExportDelivery.ts';
import { buildRuntimeDiagnosticsReadModel } from '../../src/lib/diagnostics/runtimeDiagnosticsReadModel.ts';

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

function pdfBytes(size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    bytes.set([0x25, 0x50, 0x44, 0x46], 0);
    return bytes;
}

test('Sprint 11 Phase D defines a dedicated Save-As delivery contract', () => {
    assert.equal(SESSION_EXPORT_DELIVERY_IPC.save, 'session-export:save-report');
    assert.equal(SESSION_EXPORT_DELIVERY_IPC.savePdf, 'session-export:save-pdf-report');
    assert.equal(getSessionExportFileExtension('markdown'), 'md');
    assert.equal(getSessionExportFileExtension('html'), 'html');
    assert.equal(getSessionExportFileExtension('pdf'), 'pdf');
    assert.match(buildSessionExportDefaultFileName('markdown', 2000), /^TeamSync Session Report - .*\.md$/);
    assert.match(buildSessionExportDefaultFileName('html', 2000), /^TeamSync Session Report - .*\.html$/);
    assert.match(buildSessionExportDefaultFileName('pdf', 2000), /^TeamSync Session Report - .*\.pdf$/);
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

test('Sprint 12 Phase C validates PDF export requests from generated HTML only', () => {
    const valid = validateSessionExportPdfSaveRequest({
        sourceFormat: 'html',
        html: '<!doctype html><html><body><main class="export-report">report</main></body></html>',
        generatedAt: 2000,
        guardrailStatus: 'valid',
        blocked: false,
    });
    const warning = validateSessionExportPdfSaveRequest({
        sourceFormat: 'html',
        html: '<!doctype html><html><body>warning report</body></html>',
        guardrailStatus: 'warning',
        blocked: false,
    });
    const blocked = validateSessionExportPdfSaveRequest({
        sourceFormat: 'html',
        html: '<!doctype html><html><body>blocked</body></html>',
        guardrailStatus: 'valid',
        blocked: true,
    });
    const invalidGuardrail = validateSessionExportPdfSaveRequest({
        sourceFormat: 'html',
        html: '<!doctype html><html><body>invalid</body></html>',
        guardrailStatus: 'invalid',
        blocked: false,
    });
    const markdownSource = validateSessionExportPdfSaveRequest({
        sourceFormat: 'markdown',
        html: '# Not HTML',
        guardrailStatus: 'valid',
        blocked: false,
    });
    const unsafeScript = validateSessionExportPdfSaveRequest({
        sourceFormat: 'html',
        html: '<!doctype html><html><script>alert(1)</script></html>',
        guardrailStatus: 'valid',
        blocked: false,
    });
    const localFileUrl = validateSessionExportPdfSaveRequest({
        sourceFormat: 'html',
        html: '<!doctype html><html><body><img src="file:///Users/test/private.png"></body></html>',
        guardrailStatus: 'valid',
        blocked: false,
    });

    assert.equal(valid.valid, true);
    assert.equal(warning.valid, true);
    assert.equal(blocked.valid, false);
    assert.equal(invalidGuardrail.valid, false);
    assert.equal(markdownSource.valid, false);
    assert.equal(unsafeScript.valid, false);
    assert.equal(localFileUrl.valid, false);
});

test('Sprint 12 Phase D validates generated PDF buffers before writing', () => {
    const valid = validateSessionExportPdfBuffer(pdfBytes(16));
    const empty = validateSessionExportPdfBuffer(new Uint8Array());
    const invalidHeader = validateSessionExportPdfBuffer(new TextEncoder().encode('not a pdf'));

    assert.equal(valid.valid, true);
    assert.equal(valid.byteLength, 16);
    assert.equal(empty.valid, false);
    assert.match(empty.error ?? '', /empty/);
    assert.equal(invalidHeader.valid, false);
    assert.match(invalidHeader.error ?? '', /PDF header/);
});

test('Sprint 12 Phase D classifies oversized PDF buffers with warning and error ceilings', () => {
    const warning = validateSessionExportPdfBuffer(pdfBytes(SESSION_EXPORT_PDF_RUNTIME_BUDGETS.warningPdfBytes + 1));
    const oversized = validateSessionExportPdfBuffer(pdfBytes(SESSION_EXPORT_PDF_RUNTIME_BUDGETS.maxPdfBytes + 1));

    assert.equal(warning.valid, true);
    assert.match(warning.warning ?? '', /preferred output budget/);
    assert.equal(oversized.valid, false);
    assert.match(oversized.error ?? '', /output size ceiling/);
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
    assert.match(preload, /saveSessionExportPdfReport/);
    assert.match(preload, /ipcRenderer\.invoke\(SESSION_EXPORT_DELIVERY_IPC\.save, request\)/);
    assert.match(preload, /ipcRenderer\.invoke\(SESSION_EXPORT_DELIVERY_IPC\.savePdf, request\)/);
    assert.match(types, /saveSessionExportReport: \(request: SessionExportSaveRequest\) => Promise<SessionExportSaveResult>/);
    assert.match(types, /saveSessionExportPdfReport: \(request: SessionExportPdfSaveRequest\) => Promise<SessionExportPdfSaveResult>/);
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

test('Sprint 12 Phase C saves PDF through print-ready HTML without a second export pipeline', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const handler = extractBetween(
        ipc,
        'safeHandle(SESSION_EXPORT_DELIVERY_IPC.savePdf',
        'safeHandle("delete-screenshot"',
    );

    assert.match(ipc, /data:text\/html;charset=utf-8/);
    assert.match(ipc, /encodeURIComponent\(html\)/);
    assert.match(ipc, /new BrowserWindow\(\{/);
    assert.match(ipc, /contextIsolation: true/);
    assert.match(ipc, /nodeIntegration: false/);
    assert.match(ipc, /sandbox: true/);
    assert.match(ipc, /printToPDF\(\{/);
    assert.match(ipc, /displayHeaderFooter: false/);
    assert.match(ipc, /printBackground: true/);
    assert.match(ipc, /preferCSSPageSize: true/);
    assert.match(ipc, /SESSION_EXPORT_PDF_RUNTIME_BUDGETS\.renderTimeoutMs/);
    assert.match(ipc, /Promise\.race\(\[renderPromise, timeoutPromise\]\)/);
    assert.match(ipc, /clearTimeout\(timeoutHandle\)/);
    assert.match(ipc, /pdfWindow\.destroy\(\)/);
    assert.match(handler, /validateSessionExportPdfSaveRequest\(request\)/);
    assert.match(handler, /validateSessionExportPdfBuffer\(pdfBuffer\)/);
    assert.match(handler, /Generated PDF failed validation/);
    assert.match(handler, /PDF output warning/);
    assert.match(handler, /dialog\.showSaveDialog/);
    assert.match(handler, /fs\.promises\.writeFile\(selectedPath, pdfBuffer\)/);
    assert.doesNotMatch(ipc, /loadFile\(|writeFile\(.*html|mkdtemp|tmpdir|pdfkit|html2pdf|puppeteer/);
    assert.doesNotMatch(handler, /CredentialsManager|DatabaseManager|BenchmarkManager|electron-store|new Store|localStorage|sessionStorage|indexedDB/);
});

test('Sprint 12 Phase D keeps BrowserWindow cleanup on success, timeout, and exception paths', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const renderer = extractBetween(
        ipc,
        'const renderSessionExportPdfFromHtml = async',
        '/**\n   * Returns true if the user has an active premium license',
    );

    assert.match(renderer, /let timeoutHandle/);
    assert.match(renderer, /try \{/);
    assert.match(renderer, /setTimeout\(\(\) => \{/);
    assert.match(renderer, /PDF render timed out after/);
    assert.match(renderer, /finally \{/);
    assert.match(renderer, /clearTimeout\(timeoutHandle\)/);
    assert.match(renderer, /if \(!pdfWindow\.isDestroyed\(\)\) \{/);
    assert.match(renderer, /pdfWindow\.destroy\(\)/);
});

test('Sprint 14 Phase C normalizes export IPC failures into diagnostics-ready metadata', () => {
    const invalid = validateSessionExportSaveRequest({
        format: 'markdown',
        content: '# blocked',
        guardrailStatus: 'valid',
        blocked: true,
    });
    const invalidDiagnostic = buildSessionExportIpcBoundaryDiagnostic({
        channel: SESSION_EXPORT_DELIVERY_IPC.save,
        operation: 'validate_request',
        code: 'export_save_request_invalid',
        valid: invalid.valid,
        error: invalid.error,
        message: invalid.error,
        timestamp: 14000,
    });
    const writeDiagnostic = buildSessionExportIpcBoundaryDiagnostic({
        channel: SESSION_EXPORT_DELIVERY_IPC.save,
        operation: 'write_file',
        code: 'export_save_failed',
        success: false,
        error: new Error('EACCES: permission denied, open /Users/tarunshetty/private/report.md'),
        timestamp: 14001,
    });
    const pdfDiagnostic = buildSessionExportIpcBoundaryDiagnostic({
        channel: SESSION_EXPORT_DELIVERY_IPC.savePdf,
        operation: 'save_pdf_report',
        code: 'export_pdf_save_failed',
        success: false,
        error: 'PDF render timed out after 30000ms while writing C:\\Users\\tarun\\private\\report.pdf',
        timestamp: 14002,
    });
    const model = buildRuntimeDiagnosticsReadModel({
        ipcBoundary: [invalidDiagnostic, writeDiagnostic, pdfDiagnostic],
        generatedAt: 14003,
    });
    const serialized = JSON.stringify(model);

    assert.equal(model.byDomain['ipc.boundary'].length, 3);
    assert.equal(model.events.some((event) => event.code === 'export_save_request_invalid'), true);
    assert.equal(model.events.some((event) => event.code === 'export_save_failed'), true);
    assert.equal(model.events.some((event) => event.code === 'export_pdf_save_failed'), true);
    assert.equal(model.events.every((event) => event.domain !== 'ipc.boundary' || event.userVisible), true);
    assert.doesNotMatch(serialized, /\/Users\/tarunshetty\/private|C:\\Users\\tarun\\private/);
    assert.match(serialized, /\[local-path-redacted\]/);
});

test('Sprint 14 Phase C keeps save dialog cancellation structured and non-diagnostic', () => {
    const canceled: SessionExportSaveResult = { success: false, canceled: true };
    const model = buildRuntimeDiagnosticsReadModel({
        ipcBoundary: canceled.diagnostic ? [canceled.diagnostic] : [],
        generatedAt: 14010,
    });

    assert.equal(canceled.canceled, true);
    assert.equal(model.events.length, 0);
});

test('Sprint 14 Phase C redacts local paths from export delivery errors', () => {
    const sanitized = sanitizeSessionExportDeliveryError(
        new Error('EPERM: operation not permitted, open /Users/tarunshetty/private/report.html'),
        'Unable to save report.',
    );

    assert.doesNotMatch(sanitized, /\/Users\/tarunshetty\/private/);
    assert.match(sanitized, /\[local-path-redacted\]/);
});

test('Sprint 14 Phase C normalizes Markdown and HTML save failures without changing IPC channels', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const handler = extractBetween(
        ipc,
        'safeHandle(SESSION_EXPORT_DELIVERY_IPC.save,',
        'safeHandle(SESSION_EXPORT_DELIVERY_IPC.savePdf',
    );

    assert.match(handler, /buildSessionExportIpcBoundaryDiagnostic/);
    assert.match(handler, /export_save_request_invalid/);
    assert.match(handler, /export_save_failed/);
    assert.match(handler, /sanitizeSessionExportDeliveryError/);
    assert.match(handler, /catch \(error\)/);
    assert.match(handler, /return \{ success: false, error: message, diagnostic \}/);
    assert.match(handler, /return \{ success: false, canceled: true \}/);
    assert.match(ipc, /SESSION_EXPORT_DELIVERY_IPC\.save/);
    assert.doesNotMatch(handler, /throw error|throw new Error/);
});

test('Sprint 14 Phase C keeps PDF failure handling aligned with export IPC diagnostics', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const handler = extractBetween(
        ipc,
        'safeHandle(SESSION_EXPORT_DELIVERY_IPC.savePdf',
        'safeHandle("delete-screenshot"',
    );

    assert.match(handler, /buildSessionExportIpcBoundaryDiagnostic/);
    assert.match(handler, /export_pdf_save_request_invalid/);
    assert.match(handler, /export_pdf_save_failed/);
    assert.match(handler, /sanitizeSessionExportDeliveryError/);
    assert.match(handler, /return \{ success: false, error: diagnostic\.error \?\? 'Invalid PDF export save request\.', diagnostic \}/);
    assert.match(handler, /return \{ success: false, error: message, diagnostic \}/);
    assert.match(handler, /return \{ success: false, canceled: true \}/);
    assert.match(ipc, /SESSION_EXPORT_DELIVERY_IPC\.savePdf/);
});

test('Sprint 11 Phase D wires Save-As into the preview surface only', () => {
    const component = read('src/components/pro-v2/ExportPreviewSurface.tsx');
    const surface = read('src/components/pro-v2/ProResponseSurface.tsx');

    assert.match(component, /Save As/);
    assert.match(component, /Save PDF/);
    assert.match(component, /saveSessionExportReport/);
    assert.match(component, /saveSessionExportPdfReport/);
    assert.match(component, /buildSessionExportDefaultFileName/);
    assert.match(component, /disabled=\{!canSave \|\| saveState === 'saving'\}/);
    assert.match(component, /disabled=\{!canSavePdf \|\| pdfState === 'saving'\}/);
    assert.match(component, /buildExportPreviewModel\(model, 'html'\)/);
    assert.match(component, /guardrailStatus: preview\.guardrailStatus === 'warning' \? 'warning' : 'valid'/);
    assert.match(component, /guardrailStatus: pdfPreview\.guardrailStatus === 'warning' \? 'warning' : 'valid'/);
    assert.doesNotMatch(component, /showSaveFilePicker|download=|ipcRenderer|ipcMain|writeFile|appendFile|pdfkit|html2pdf/);
    assert.doesNotMatch(surface, /saveSessionExportReport|saveSessionExportPdfReport|SESSION_EXPORT_DELIVERY_IPC|ipcRenderer|ipcMain/);
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
