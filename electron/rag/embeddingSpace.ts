// electron/rag/embeddingSpace.ts
// Embedding-space key generation & legacy-provider model mapping.
// Used by VectorStore and DatabaseManager to namespace vectors.

export function normalizeModel(model: string): string {
  return model.replace(/^models\//, '').trim().toLowerCase();
}

export interface EmbeddingSpaceParams {
  name: string;
  model: string;
  dimensions: number;
}

/** Generate a unique space key like "gemini:gemini-embedding-001:768". */
export function embeddingSpaceKey(p: EmbeddingSpaceParams): string {
  return `${p.name}:${normalizeModel(p.model)}:${p.dimensions}`;
}

/** Default model for each embedding provider (pre-migration rows). */
export const LEGACY_PROVIDER_MODEL: Record<string, string> = {
  gemini: 'gemini-embedding-001',
  ollama: 'nomic-embed-text',
  openai: 'text-embedding-3-small',
  local: 'xenova/all-minilm-l6-v2',
};

/** Build a SQL CASE expression for legacy-provider → model mapping. */
export function buildLegacySpaceCaseSql(): string {
  return Object.entries(LEGACY_PROVIDER_MODEL)
    .map(([provider, model]) => `WHEN '${provider}' THEN '${model}'`)
    .join('\n                          ');
}

/** Build the legacy embedding-space key for a provider. */
export function legacySpaceForProvider(name: string, dims?: number): string {
  const model = LEGACY_PROVIDER_MODEL[name] ?? 'unknown';
  return `${name}:${model}:${dims ?? 'unknown'}`;
}
