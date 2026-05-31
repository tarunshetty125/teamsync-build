const { test }: typeof import('node:test') = require('node:test');
const assert: typeof import('node:assert').strict = require('node:assert').strict;
const fs: typeof import('node:fs') = require('node:fs');
const path: typeof import('node:path') = require('node:path');
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
    assert.match(streams, /if \(typeof data\.content === 'string'\) \{\s*hydrateFinalMessage\(ctx, requestId, data\.content\);/s);
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
