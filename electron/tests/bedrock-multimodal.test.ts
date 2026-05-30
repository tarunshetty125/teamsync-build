import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Bedrock multimodal routing uses a vision adapter without changing provider prompts', () => {
    const helper = read('electron/LLMHelper.ts');
    const adapter = read('electron/llm/BedrockVisionAdapter.ts');
    const promptBuilder = read('electron/llm/ProviderPromptBuilder.ts');

    assert.match(helper, /resolveBedrockRuntimeRoute/);
    assert.match(adapter, /resolveBedrockVisionModel/);
    assert.match(adapter, /args\.client\.fetchModels\(\)/);
    assert.match(adapter, /No Bedrock multimodal model available/);
    assert.match(promptBuilder, /BEDROCK GPT-OSS REASONING PROFILE/);
    assert.match(promptBuilder, /resolveProviderFamily/);
});

test('Bedrock vision model selection prefers Claude Sonnet, then Nova Pro, then Nova Lite', () => {
    const modelIds = read('electron/llm/BedrockModelIds.ts');
    const client = read('electron/services/BedrockClient.ts');

    assert.match(modelIds, /anthropic\.claude/);
    assert.match(modelIds, /sonnet/);
    assert.match(modelIds, /amazon\.nova-pro/);
    assert.match(modelIds, /amazon\.nova-lite/);
    assert.match(client, /inputModalities: model\.inputModalities/);
    assert.match(modelIds, /supportsBedrockImageInput/);
    assert.match(modelIds, /return 0/);
    assert.match(modelIds, /return 1/);
    assert.match(modelIds, /return 2/);
    assert.match(modelIds, /Number\.POSITIVE_INFINITY/);
});

test('Bedrock image payload supports PNG, JPG/JPEG, and WEBP while rejecting unsupported formats', () => {
    const client = read('electron/services/BedrockClient.ts');

    assert.match(client, /SUPPORTED_IMAGE_FORMATS = \["png", "jpeg", "webp"\]/);
    assert.match(client, /ext === "jpg" \? "jpeg" : ext/);
    assert.doesNotMatch(client, /"gif"/);
    assert.match(client, /Unsupported Bedrock image format/);
    assert.match(client, /Supported formats: png, jpg, jpeg, webp/);
});

test('Bedrock image preparation compresses screenshots before Converse upload', () => {
    const client = read('electron/services/BedrockClient.ts');

    assert.match(client, /MAX_BEDROCK_IMAGE_BYTES = 4 \* 1024 \* 1024/);
    assert.match(client, /MAX_BEDROCK_IMAGE_DIMENSION = 1600/);
    assert.match(client, /sharp\(originalBytes/);
    assert.match(client, /\.resize\(/);
    assert.match(client, /\.jpeg\(\{ quality/);
    assert.match(client, /exceeds 4MB after compression/);
});

test('Bedrock multimodal requests stream through ConverseStreamCommand and log safely', () => {
    const client = read('electron/services/BedrockClient.ts');
    const helper = read('electron/LLMHelper.ts');
    const logMethod = client.slice(
        client.indexOf('private logMultimodalRequest'),
        client.lastIndexOf('}'),
    );

    assert.match(client, /ConverseStreamCommand/);
    assert.match(client, /contentBlockDelta\?\.delta\?\.text/);
    assert.match(client, /\[BEDROCK_MULTIMODAL\]/);
    assert.match(helper, /\[BEDROCK_VISION_ROUTE\]/);
    assert.doesNotMatch(logMethod, /bytes/);
});

test('No-image Bedrock path still resolves the selected GPT-OSS text model', () => {
    const adapter = read('electron/llm/BedrockVisionAdapter.ts');
    const helper = read('electron/LLMHelper.ts');

    assert.match(adapter, /const imageCount = \(args\.imagePaths \|\| \[\]\)\.filter\(Boolean\)\.length/);
    assert.match(adapter, /const textModel = resolveBedrockModelId\(args\.requestedModel, args\.preferredModel\)/);
    assert.match(helper, /modelId \|\| this\.currentModelId/);
    assert.match(helper, /this\.bedrockClient\.stream\(userMessage/);
    assert.match(helper, /this\.bedrockClient\.generate\(userMessage/);
});

test('Bedrock content blocks put images before text for screenshot, UI, and architecture analysis', () => {
    const client = read('electron/services/BedrockClient.ts');
    const buildUserMessage = client.slice(
        client.indexOf('private async buildUserMessage'),
        client.indexOf('private async readImageContent'),
    );

    assert.ok(
        buildUserMessage.indexOf('content.push(await this.readImageContent(imagePath))') <
        buildUserMessage.indexOf('content.push({ text: userMessage })'),
        'image blocks must be added before the text prompt',
    );
});

test('Bedrock settings warn when fetched models do not include a vision-capable model', () => {
    const settings = read('src/components/settings/AIProvidersSettings.tsx');

    assert.match(settings, /BEDROCK_VISION_WARNING/);
    assert.match(settings, /Enable Claude Sonnet or Amazon Nova Pro\/Lite model access/);
    assert.match(settings, /Text-only Bedrock models will still work/);
    assert.match(settings, /getBedrockVisionWarning\(result\.models\)/);
    assert.match(settings, /bedrockVisionWarning/);
});

test('Setup and help guide document Bedrock multimodal setup in the existing theme', () => {
    const help = read('src/components/settings/HelpSettings.tsx');

    assert.match(help, /Amazon Bedrock/);
    assert.match(help, /Enable image understanding/);
    assert.match(help, /Bedrock image and screenshot analysis/);
    assert.match(help, /Claude Sonnet/);
    assert.match(help, /Amazon Nova Pro/);
    assert.match(help, /GPT-OSS stays text-only/);
    assert.match(help, /bg-bg-item-surface/);
    assert.match(help, /border-border-subtle/);
});

test('Setup and help guide document New V2 Pro Overlay as a Pro-only feature', () => {
    const help = read('src/components/settings/HelpSettings.tsx');

    assert.match(help, /New V2 Pro Overlay/);
    assert.match(help, /Pro Only/);
    assert.match(help, /persistent answer history/);
    assert.match(help, /previous\/next response navigation/);
    assert.match(help, /Settings → Interface → New V2 Pro Overlay/);
    assert.match(help, /bg-violet-500\/5/);
});
