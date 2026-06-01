import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Bedrock credential persistence APIs and secure fields are present', () => {
    const source = read('electron/services/CredentialsManager.ts');

    assert.match(source, /type BedrockAuthMode = 'aws_cli' \| 'access_keys'/);
    assert.match(source, /interface BedrockCredentials/);
    assert.match(source, /setBedrockCredentials/);
    assert.match(source, /getBedrockCredentials/);
    assert.match(source, /hasBedrockCredentials/);
    assert.match(source, /testBedrockConnection/);
    assert.match(source, /fetchBedrockModels/);
    const logLines = source.split('\n').filter(line => line.includes('console.log'));
    assert.ok(logLines.every(line => !line.includes('secretAccessKey')));
    assert.ok(logLines.every(line => !line.includes('sessionToken')));
});

test('Bedrock client supports CLI auth, access-key auth, dynamic model fetching, and streaming deltas', () => {
    const source = read('electron/services/BedrockClient.ts');

    assert.match(source, /fromNodeProviderChain/);
    assert.match(source, /profile: credentials\.profileName/);
    assert.match(source, /accessKeyId/);
    assert.match(source, /secretAccessKey/);
    assert.match(source, /ListFoundationModelsCommand/);
    assert.match(source, /responseStreamingSupported === true/);
    assert.match(source, /ConverseCommand/);
    assert.match(source, /ConverseStreamCommand/);
    assert.match(source, /contentBlockDelta\?\.delta\?\.text/);
});

test('Invalid Bedrock credentials are rejected before persistence in IPC flow', () => {
    const source = read('electron/ipcHandlers.ts');
    const testHandler = source.slice(
        source.indexOf('safeHandle("test-bedrock-connection"'),
        source.indexOf('safeHandle("fetch-bedrock-models"'),
    );
    const saveHandler = source.slice(
        source.indexOf('safeHandle("set-bedrock-credentials"'),
        source.indexOf('safeHandle("test-bedrock-connection"'),
    );

    assert.match(testHandler, /await cm\.testBedrockConnection\(nextCredentials\)/);
    assert.match(testHandler, /cm\.setBedrockCredentials\(nextCredentials\)/);
    assert.ok(
        testHandler.indexOf('await cm.testBedrockConnection(nextCredentials)') <
        testHandler.indexOf('cm.setBedrockCredentials(nextCredentials)'),
        'test must happen before auto-save',
    );
    assert.match(saveHandler, /await cm\.testBedrockConnection\(nextCredentials\)/);
});

test('Bedrock GPT-OSS aliases are normalized before becoming the default runtime model', () => {
    const source = read('electron/ipcHandlers.ts');
    const defaultHandler = source.slice(
        source.indexOf('safeHandle("set-default-model"'),
        source.indexOf('safeHandle("get-default-model"'),
    );

    assert.match(defaultHandler, /isBedrockModelId\(modelId, bedrockPreferred\)/);
    assert.match(defaultHandler, /resolveBedrockModelId\(modelId, bedrockPreferred\)/);
    assert.match(defaultHandler, /cm\.setDefaultModel\(finalModelId\)/);
    assert.match(defaultHandler, /llmHelper\.setModel\(finalModelId, allProviders\)/);
});

test('Bedrock is routed as a first-class LLMHelper provider without changing Groq-first fallback', () => {
    const source = read('electron/LLMHelper.ts');
    const modelIds = read('electron/llm/BedrockModelIds.ts');
    const prompts = read('electron/llm/ProviderPromptBuilder.ts');

    assert.match(source, /public isBedrockModel/);
    assert.match(source, /public async generateWithBedrock/);
    assert.match(source, /public async \* streamWithBedrock/);
    assert.match(source, /\[BEDROCK_ROUTE\]/);
    assert.match(modelIds, /openai\./);
    assert.match(modelIds, /openai\/gpt-oss-/);
    assert.match(source, /if \(this\.isBedrockModel\(modelId\)\) return false;/);
    assert.match(prompts, /isBedrockModelId\(normalized\)/);

    const textFallback = source.slice(
        source.indexOf('// TEXT-ONLY: [TeamSync] -> Groq -> Gemini Flash -> Gemini Pro -> OpenAI -> Claude'),
        source.indexOf('if (providers.length === 0)', source.indexOf('// TEXT-ONLY: [TeamSync] -> Groq -> Gemini Flash -> Gemini Pro -> OpenAI -> Claude')),
    );
    assert.ok(textFallback.indexOf('Groq (${textGroq})') < textFallback.indexOf('Bedrock (${this.bedrockCredentials.preferredModel})'));
});

test('Bedrock auth expiry emits a reauthentication warning before fallback', () => {
    const helper = read('electron/LLMHelper.ts');
    const engine = read('electron/IntelligenceEngine.ts');
    const preload = read('electron/preload.ts');
    const app = read('src/App.tsx');
    const electronTypes = read('src/types/electron.d.ts');

    assert.match(helper, /isBedrockReauthenticationError/);
    assert.match(helper, /BEDROCK_AUTH_WARNING_DEDUPE_MS = 45_000/);
    assert.match(helper, /expiredtoken/);
    assert.match(helper, /security token included in the request is expired/);
    assert.match(helper, /notifyBedrockReauthenticationRequired\(error, model\)/);
    assert.match(helper, /bedrock:reauthentication-required/);
    assert.match(engine, /BEDROCK_AUTH_EXPIRED_ROUTING_REASON = 'bedrock_auth_expired_fallback'/);
    assert.match(engine, /requestedProvider: primaryProvider/);
    assert.match(engine, /reason: BEDROCK_AUTH_EXPIRED_ROUTING_REASON/);
    assert.match(preload, /onBedrockReauthenticationRequired/);
    assert.match(electronTypes, /onBedrockReauthenticationRequired/);
    assert.match(app, /AWS session expired/);
    assert.match(app, /bedrockAuthToast/);
});

test('Provider prompt builder preserves provider-specific prompts and gives Bedrock a moderate cap', () => {
    const builder = read('electron/llm/ProviderPromptBuilder.ts');
    const engine = read('electron/IntelligenceEngine.ts');

    assert.match(builder, /GROQ REALTIME PROFILE/);
    assert.match(builder, /BEDROCK GPT-OSS REASONING PROFILE/);
    assert.match(builder, /CLAUDE STRUCTURED PROFILE/);
    assert.match(builder, /GEMINI CONCISE PROFILE/);
    assert.match(builder, /OLLAMA LOCAL PROFILE/);
    assert.match(builder, /bedrock: 6000/);
    assert.match(builder, /family === 'bedrock' && args\.isSystemDesign[\s\S]*\? 6144[\s\S]*: baseOutputTokens/);
    assert.match(engine, /buildProviderPrompt/);
    assert.match(engine, /maxPromptTokens = Math\.min\(adaptiveBudget\.maxTokens, providerPreview\.maxInputTokens\)/);
});

test('Existing provider regression guard: provider checks and model constants remain intact', () => {
    const helper = read('electron/LLMHelper.ts');
    const modelUtils = read('src/utils/modelUtils.ts');

    assert.match(helper, /const GROQ_MODEL = "llama-3\.3-70b-versatile"/);
    assert.match(helper, /const OPENAI_MODEL = "gpt-5\.4"/);
    assert.match(helper, /const CLAUDE_MODEL = "claude-sonnet-4-6"/);
    assert.match(helper, /isOpenAiModel\(modelId: string\)/);
    assert.match(helper, /isClaudeModel\(modelId: string\)/);
    assert.match(helper, /isGroqModel\(modelId: string\)/);
    assert.match(helper, /isGeminiModel\(modelId: string\)/);

    assert.match(modelUtils, /gemini:/);
    assert.match(modelUtils, /openai:/);
    assert.match(modelUtils, /claude:/);
    assert.match(modelUtils, /groq:/);
    assert.match(modelUtils, /bedrock:/);
});
