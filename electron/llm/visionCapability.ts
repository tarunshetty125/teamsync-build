// electron/llm/visionCapability.ts
// Detects model vision capabilities for Ollama models and custom providers.

/* ── Ollama Vision Detection ──────────────────────────────── */

const OLLAMA_VISION_NAME_RE = /(llava|bakllava|moondream|llama-?3\.2-vision|llama3\.2-vision|gemma3|minicpm-v|qwen2\.5-vl|qwen2-vl|pixtral|llama-?4|granite3\.2-vision|mistral-small3\.1|llama-?guard3-vision)/i;

/**
 * Checks if an Ollama model supports vision based on its name.
 */
export function isOllamaVisionModelByName(modelId: string): boolean {
  return !!modelId && OLLAMA_VISION_NAME_RE.test(modelId.toLowerCase());
}

/**
 * Checks the `capabilities` field from Ollama's `/api/show` response.
 * Returns `true` if vision is listed, `null` if no capabilities field.
 */
export function ollamaVisionFromShow(showJson: { capabilities?: string[] } | undefined): boolean | null {
  const caps = showJson?.capabilities;
  if (Array.isArray(caps)) {
    return caps.some(c => typeof c === 'string' && c.toLowerCase() === 'vision');
  }
  return null;
}

/**
 * Resolves Ollama vision support: prefers probed result over name-based detection.
 */
export function resolveOllamaVision(modelId: string, probed: boolean | null): boolean {
  if (probed !== null) return probed;
  return isOllamaVisionModelByName(modelId);
}

/* ── Custom Provider Detection ────────────────────────────── */

export interface CustomProvider {
  multimodal?: boolean;
  localOnly?: boolean;
  curlCommand?: string;
}

/**
 * Whether a custom provider supports vision input.
 */
export function customProviderSupportsVision(provider: CustomProvider | undefined): boolean {
  if (!provider) return false;
  if (typeof provider.multimodal === 'boolean') return provider.multimodal;

  const curl = provider.curlCommand || '';
  if (!curl) return false;
  if (/\{\{\s*IMAGE_BASE64\s*\}\}/i.test(curl)) return true;

  const hasMessagesArray = /"messages"\s*:\s*\[/.test(curl);
  const hasUserRole = /"role"\s*:\s*"user"/.test(curl);
  return hasMessagesArray && hasUserRole;
}

/**
 * Whether a custom provider points to a local endpoint.
 */
export function customProviderIsLocal(provider: CustomProvider | undefined): boolean {
  if (!provider) return false;
  if (typeof provider.localOnly === 'boolean') return provider.localOnly;

  const curl = provider.curlCommand || '';
  const m = curl.match(/https?:\/\/[^\s'"`]+/i);
  if (!m) return false;

  let host: string;
  try {
    host = new URL(m[0]).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local')) return true;
  if (host.startsWith('169.254.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (host.startsWith('172.')) {
    const second = parseInt(host.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}
