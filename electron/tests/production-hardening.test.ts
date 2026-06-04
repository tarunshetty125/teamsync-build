const { test }: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert').strict = require('node:assert').strict;
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
const Module = require('node:module');
const ts: typeof import('typescript') = require('typescript');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithTsExtension(request: string, parent: any, isMain: boolean, options: any) {
    try {
        return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
        if ((request.startsWith('.') || request.startsWith('/')) && !path.extname(request)) {
            return originalResolveFilename.call(this, `${request}.ts`, parent, isMain, options);
        }
        throw error;
    }
};

(require as any).extensions['.ts'] = function compileTsForNodeTest(module: any, filename: string) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;
    module._compile(output, filename);
};

const { auditPromptText, emitModelSelection } = require('../ActionTelemetry') as typeof import('../ActionTelemetry');

const repoRoot = path.resolve(__dirname, '..', '..');

function readRepoFile(file: string): string {
    return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

function captureLogs(fn: () => void): string[] {
    const original = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
    };
    try {
        fn();
    } finally {
        console.log = original;
    }
    return logs;
}

test('routing telemetry emits requested and actual model at runtime', () => {
    const logs = captureLogs(() => emitModelSelection({
        requestId: 'req-gpt-oss',
        actionType: 'answer_now',
        routing: {
            requestedModel: 'openai.gpt-oss-120b-1:0',
            requestedProvider: 'bedrock',
            actualModel: 'openai.gpt-oss-120b-1:0',
            actualProvider: 'bedrock',
            reason: 'requested_model',
        },
    }));

    assert.ok(logs.some((line) => line.includes('[MODEL_SELECTION]')));
    assert.ok(logs.some((line) => line.includes('requested=openai.gpt-oss-120b-1:0 actual=openai.gpt-oss-120b-1:0')));
});

test('prompt ownership audit detects single controlled contracts', () => {
    const audit = auditPromptText([
        '## INTENT',
        'Answer.',
        '## CONTEXT PRIORITY',
        'Answer latest question first.',
        '## OUTPUT CONTRACT',
        'Return a complete coding interview answer with these sections in order:',
    ].join('\n'));

    assert.equal(audit.outputContractCount, 1);
    assert.equal(audit.codingContractCount, 1);
    assert.equal(audit.contextPriorityCount, 1);
    assert.equal(audit.duplicateSectionCount, 0);
});

test('unified action path does not temporarily mutate global model state for fallback', () => {
    const engine = readRepoFile('electron/IntelligenceEngine.ts');
    const collectStart = engine.indexOf('private async collectStreamResponseForPrompt');
    const executeStart = engine.indexOf('private async executeActionWithRetry');
    assert.ok(collectStart > 0 && executeStart > collectStart);
    const collectBody = engine.slice(collectStart, executeStart);

    assert.doesNotMatch(collectBody, /\.setModel\(/);
    assert.match(collectBody, /this\.llmHelper\.invoke\(\{/);
    assert.match(collectBody, /model: routing\.actualModel/);

    const validateStart = engine.indexOf('private async ensureValidActionOutput');
    const executeBody = engine.slice(executeStart, validateStart);
    assert.match(executeBody, /const primaryModel = this\.llmHelper\.normalizeModelId\(args\.selectedModel\)/);
    assert.doesNotMatch(executeBody, /const primaryModel = this\.llmHelper\.getCurrentModel\(\)/);
});

test('legacy AI wrappers bridge through runAction instead of direct LLM streams', () => {
    const engine = readRepoFile('electron/IntelligenceEngine.ts');
    const systemDesignStart = engine.indexOf('async runSystemDesignTradeoffs');
    const answerStart = engine.indexOf('async runAnswerNow');
    const systemDesignBody = engine.slice(systemDesignStart, answerStart);
    assert.match(systemDesignBody, /return await this\.runAction\(\{/);
    assert.doesNotMatch(systemDesignBody, /systemDesignTradeoffsLLM\.generateStream/);

    const whatToSayStart = engine.indexOf('async runWhatShouldISay');
    const followUpStart = engine.indexOf('async runFollowUp');
    const whatToSayBody = engine.slice(whatToSayStart, followUpStart);
    assert.match(whatToSayBody, /return await this\.runAction\(\{/);
    assert.doesNotMatch(whatToSayBody, /whatToAnswerLLM\.generateStream/);
});

test('final action result always hydrates streamed V2 output with validated content', () => {
    const streams = readRepoFile('src/components/pro-v2/useOverlayIpcStreams.ts');
    assert.match(streams, /if \(typeof data\.content === 'string'\) \{\s*hydrateFinalMessage\(ctx, requestId, data\.content, data\.debugMetadata\);/s);
    assert.doesNotMatch(streams, /if \(isScreenScan && typeof data\.content === 'string'\)/);
});

test('screen analysis sends OCR text only into runAction', () => {
    const engine = readRepoFile('electron/IntelligenceEngine.ts');
    const screenStart = engine.indexOf('async runScreenScan');
    const screenBody = engine.slice(screenStart);
    assert.match(screenBody, /intent: 'screen_scan'/);
    assert.match(screenBody, /message: screenTextForPrompt/);
    assert.match(screenBody, /imagePaths: undefined/);
});

test('STT finalization is awaited before voice transcript is read', () => {
    const ui = readRepoFile('src/components/TeamSyncInterface.tsx');
    const finalizeIndex = ui.indexOf('await window.electronAPI.finalizeMicSTT()');
    const questionIndex = ui.indexOf('const question = (voiceInputRef.current');
    assert.ok(finalizeIndex > 0);
    assert.ok(questionIndex > finalizeIndex);
});

test('concurrent action requests are tracked by requestId set, not a singleton owner', () => {
    const engine = readRepoFile('electron/IntelligenceEngine.ts');
    assert.match(engine, /private activeActionRequestIds = new Set<string>\(\)/);
    assert.match(engine, /this\.activeActionRequestIds\.add\(requestId\)/);
    assert.match(engine, /return this\.activeActionRequestIds\.has\(requestId\) && this\.requestAbortControllers\.has\(requestId\)/);
    assert.doesNotMatch(engine, /cancelRequest\(this\.activeActionRequestId\)/);
});

test('fallback debug metadata is attached to final action results', () => {
    const engine = readRepoFile('electron/IntelligenceEngine.ts');
    const telemetry = readRepoFile('electron/ActionTelemetry.ts');
    assert.match(engine, /debugMetadata: \{\s*telemetry,\s*routing: executionResult\.routing,\s*fallbackChain: executionResult\.fallbackChain,\s*validation: finalizedOutput\.validation,/s);
    assert.match(telemetry, /\[FALLBACK\]/);
    assert.match(engine, /fallbackChain: FallbackChainEntry\[\]/);
});

test('reverse engineering hardening does not expose raw provider secrets or debug IPC', () => {
    const ipc = readRepoFile('electron/ipcHandlers.ts');
    const preload = readRepoFile('electron/preload.ts');
    const rendererTypes = readRepoFile('src/types/electron.d.ts');

    const credentialHandlerStart = ipc.indexOf('safeHandle("get-stored-credentials"');
    const credentialHandlerEnd = ipc.indexOf('// ==========================================', credentialHandlerStart);
    const credentialHandler = ipc.slice(credentialHandlerStart, credentialHandlerEnd);

    assert.match(credentialHandler, /sttKeys/);
    assert.match(credentialHandler, /secretStatus\(creds\.groqSttApiKey\)/);
    assert.match(credentialHandler, /tavilyKey: secretStatus\(creds\.tavilyApiKey\)/);

    for (const rawField of [
        'sttGroqKey',
        'sttOpenaiKey',
        'sttDeepgramKey',
        'sttElevenLabsKey',
        'sttAzureKey',
        'sttIbmKey',
        'sttSonioxKey',
    ]) {
        assert.doesNotMatch(credentialHandler, new RegExp(rawField));
        assert.doesNotMatch(rendererTypes, new RegExp(`${rawField}\\?:`));
    }

    assert.doesNotMatch(preload, /getTavilyKey/);
    assert.doesNotMatch(preload, /testReleaseFetch/);
    assert.doesNotMatch(ipc, /test-release-fetch/);
});

test('production devtools and profile file ingestion are hardened', () => {
    const keybinds = readRepoFile('electron/services/KeybindManager.ts');
    const windowHelper = readRepoFile('electron/WindowHelper.ts');
    const ipc = readRepoFile('electron/ipcHandlers.ts');

    assert.match(keybinds, /const shouldExposeDevTools = \(\): boolean => !app\.isPackaged/);
    assert.match(keybinds, /shouldExposeDevTools\(\)[\s\S]*role: 'toggleDevTools'/);
    assert.match(windowHelper, /!\s*app\.isPackaged[\s\S]*Developer Console/);

    assert.match(ipc, /selectedProfileFiles = new Map/);
    assert.match(ipc, /createProfileFileToken/);
    assert.match(ipc, /resolveProfileFileToken/);
    assert.match(ipc, /safeHandle\("profile:upload-resume", async \(_, fileToken: string\)/);
    assert.match(ipc, /safeHandle\("profile:upload-jd", async \(_, fileToken: string\)/);
});
