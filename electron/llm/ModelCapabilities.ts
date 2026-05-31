import { isBedrockGptOssModel } from './BedrockModelIds';

export interface ModelCapabilities {
  vision: boolean;
  text: boolean;
}

const TEXT_ONLY_CAPABILITIES: ModelCapabilities = {
  vision: false,
  text: true,
};

const MULTIMODAL_CAPABILITIES: ModelCapabilities = {
  vision: true,
  text: true,
};

const MODEL_CAPABILITY_OVERRIDES: Record<string, ModelCapabilities> = {
  'openai.gpt-oss-120b-1:0': TEXT_ONLY_CAPABILITIES,
  'openai.gpt-oss-20b-1:0': TEXT_ONLY_CAPABILITIES,
  'llama-4-maverick': MULTIMODAL_CAPABILITIES,
  'llama-4-scout': MULTIMODAL_CAPABILITIES,
  'meta-llama/llama-4-scout-17b-16e-instruct': MULTIMODAL_CAPABILITIES,
  'meta-llama/llama-4-maverick-17b-128e-instruct': MULTIMODAL_CAPABILITIES,
  'teamsync': MULTIMODAL_CAPABILITIES,
};

function normalizeModelId(modelId: string | undefined): string {
  return (modelId || '').trim().toLowerCase();
}

function isOpenAiVisionModel(modelId: string): boolean {
  if (modelId.includes('gpt-oss')) return false;
  return (
    modelId.includes('gpt-4o') ||
    modelId.includes('gpt-4.1') ||
    modelId.includes('gpt-5') ||
    modelId.includes('omni')
  );
}

function isGroqVisionModel(modelId: string): boolean {
  return modelId.includes('llama-4-scout') || modelId.includes('llama-4-maverick');
}

function isClaudeVisionModel(modelId: string): boolean {
  return modelId.startsWith('claude-');
}

function isGeminiVisionModel(modelId: string): boolean {
  return modelId.startsWith('gemini-') || modelId.startsWith('models/gemini-');
}

function isBedrockVisionModel(modelId: string): boolean {
  if (isBedrockGptOssModel(modelId)) return false;
  return (
    modelId.includes('anthropic.claude') ||
    modelId.includes('amazon.nova-pro') ||
    modelId.includes('amazon.nova-lite')
  );
}

function isLocalVisionModel(modelId: string): boolean {
  return /(?:llava|bakllava|vision|moondream|minicpm-v|qwen2(?:\.5)?-vl|qwen-vl)/i.test(modelId);
}

export function getModelCapabilities(modelId: string | undefined): ModelCapabilities {
  const normalized = normalizeModelId(modelId);
  if (!normalized) return TEXT_ONLY_CAPABILITIES;

  const override = MODEL_CAPABILITY_OVERRIDES[normalized];
  if (override) return override;

  if (isBedrockVisionModel(normalized)) return MULTIMODAL_CAPABILITIES;
  if (isClaudeVisionModel(normalized)) return MULTIMODAL_CAPABILITIES;
  if (isGeminiVisionModel(normalized)) return MULTIMODAL_CAPABILITIES;
  if (isOpenAiVisionModel(normalized)) return MULTIMODAL_CAPABILITIES;
  if (isGroqVisionModel(normalized)) return MULTIMODAL_CAPABILITIES;
  if (isLocalVisionModel(normalized)) return MULTIMODAL_CAPABILITIES;

  return TEXT_ONLY_CAPABILITIES;
}

export function formatVisionUnsupportedMessage(modelId: string | undefined): string {
  const current = modelId?.trim() || 'Unknown model';
  return [
    'Current model does not support image analysis.',
    '',
    'Screen Capture requires a vision-capable model.',
    '',
    'Recommended:',
    '- Claude Sonnet',
    '- Gemini',
    '- GPT-4o',
    '- Llama Vision',
    '',
    `Current: ${current} (Text Only)`,
  ].join('\n');
}
