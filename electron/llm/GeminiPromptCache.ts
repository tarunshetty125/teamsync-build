// electron/llm/GeminiPromptCache.ts
// Caches Gemini system-prompt prefixes to reduce latency and cost.
// Uses the Gemini caches.create API with TTL-based expiry and
// background warming for the latency-critical streaming path.

import * as crypto from 'crypto';

/* ── Constants ────────────────────────────────────────────── */

const MIN_PROMPT_CHARS = 4500;
const CACHE_TTL_SECONDS = 3600;
const RENEWAL_WINDOW_MS = 5 * 60 * 1000;

/* ── Types ────────────────────────────────────────────────── */

interface CacheEntry {
  name: string;  // Gemini cache resource name (empty string = creation failed, on cooldown)
  expiresAt: number;
}

/** Minimal Gemini client interface for cache operations. */
export interface GeminiCacheClient {
  caches: {
    create(params: {
      model: string;
      config: {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
        systemInstruction: { parts: Array<{ text: string }> };
        ttl: string;
        displayName: string;
      };
    }): Promise<{ name?: string }>;
  };
}

/* ── Cache ─────────────────────────────────────────────────── */

export class GeminiPromptCache {
  private entries = new Map<string, CacheEntry>();
  /** In-flight creation promises keyed by hash — for dedupe under concurrency. */
  private inflight = new Map<string, Promise<string | null>>();

  /**
   * Return the cache resource name for (model, systemPrompt), creating it if
   * absent or near-expired. Returns null when caching is not viable —
   * callers must fall back to passing `systemInstruction` directly.
   */
  async getOrCreate(client: GeminiCacheClient, model: string, systemPrompt: string): Promise<string | null> {
    if (!systemPrompt || systemPrompt.length < MIN_PROMPT_CHARS) return null;

    const key = this.hashKey(model, systemPrompt);
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing) {
      if (!existing.name && existing.expiresAt > now) return null;
      if (existing.name && existing.expiresAt - now > RENEWAL_WINDOW_MS) {
        return existing.name;
      }
    }

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const creation = this.create(client, model, systemPrompt, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, creation);
    return creation;
  }

  /**
   * NON-BLOCKING variant for the latency-critical streaming path.
   *
   * Returns an already-live cache name SYNCHRONOUSLY if one exists (cache hit).
   * On a MISS it returns null immediately and kicks off create() in the
   * BACKGROUND so the cache is warm for the NEXT request.
   */
  getCachedOrWarmInBackground(client: GeminiCacheClient, model: string, systemPrompt: string): string | null {
    if (!systemPrompt || systemPrompt.length < MIN_PROMPT_CHARS) return null;

    const key = this.hashKey(model, systemPrompt);
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing) {
      if (!existing.name && existing.expiresAt > now) return null;
      if (existing.name && existing.expiresAt - now > RENEWAL_WINDOW_MS) {
        return existing.name;
      }
    }

    // Fire-and-forget background creation
    if (!this.inflight.has(key)) {
      const creation = this.create(client, model, systemPrompt, key).finally(() => {
        this.inflight.delete(key);
      });
      this.inflight.set(key, creation);
      creation.catch(() => { /* swallow — background warming */ });
    }

    return null;
  }

  /**
   * Drop a stale entry when the server reports the cache no longer exists.
   */
  invalidate(name: string): void {
    for (const [k, v] of this.entries) {
      if (v.name === name) {
        this.entries.delete(k);
        return;
      }
    }
  }

  /**
   * Drop every entry. Call this when the Gemini API key changes.
   */
  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  /** For diagnostics. */
  size(): number {
    return this.entries.size;
  }

  /* ── Internal ─────────────────────────────────────────── */

  private async create(client: GeminiCacheClient, model: string, systemPrompt: string, key: string): Promise<string | null> {
    try {
      const response = await client.caches.create({
        model,
        config: {
          contents: [{ role: 'user', parts: [{ text: '_' }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          ttl: `${CACHE_TTL_SECONDS}s`,
          displayName: `teamsync-sys-${key.slice(0, 8)}`,
        },
      });

      const name = response?.name;
      if (!name) {
        console.warn('[GeminiPromptCache] caches.create returned no name; skipping cache');
        return null;
      }

      this.entries.set(key, {
        name,
        expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
      });
      console.log(`[GeminiPromptCache] created ${name} for model=${model} (${systemPrompt.length} chars)`);
      return name;
    } catch (err: any) {
      console.warn(
        `[GeminiPromptCache] caches.create failed for model=${model}: ${err?.message || err}. Falling back to systemInstruction.`
      );
      this.entries.set(key, {
        name: '',
        expiresAt: Date.now() + 5 * 60 * 1000, // 5min cooldown before retrying create
      });
      return null;
    }
  }

  private hashKey(model: string, systemPrompt: string): string {
    return crypto.createHash('sha1').update(model).update('\0').update(systemPrompt).digest('hex');
  }
}
