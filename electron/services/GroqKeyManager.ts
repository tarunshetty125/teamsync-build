/**
 * GroqKeyManager - Centralized Groq API key pool manager
 *
 * Responsibilities:
 *   • Load all GROQ_API_KEY_1 … GROQ_API_KEY_10 from process.env
 *   • Accept a primary key from CredentialsManager at runtime
 *   • Round-robin key selection, skipping exhausted / cooling-down / invalid keys
 *   • Per-key state tracking (exhausted, cooldown, request count, last used, invalid)
 *   • Automatic cooldown recovery (default 5 min)
 *   • Thread-safe (single-threaded Node, but reentrant-safe via sync selection)
 *   • Masked key logging — never exposes a full API key
 */

import Groq from 'groq-sdk';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface GroqKeyState {
  apiKey: string;
  exhausted: boolean;
  cooldownUntil: number | null;
  requestCount: number;
  lastUsed: number;
  /** Permanently disabled — key returned 401 or is otherwise invalid */
  invalid: boolean;
  /** Lazily created Groq SDK client for this key */
  client: Groq;
}

export interface GroqKeyHealthReport {
  totalKeys: number;
  availableKeys: number;
  exhaustedKeys: number;
  coolingDownKeys: number;
  invalidKeys: number;
  keys: Array<{
    index: number;
    masked: string;
    exhausted: boolean;
    invalid: boolean;
    cooldownUntil: number | null;
    requestCount: number;
    lastUsed: number;
  }>;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Default cooldown period in milliseconds (5 minutes) */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/** Maximum number of env key slots scanned */
const MAX_ENV_KEY_SLOTS = 10;

// ─────────────────────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────────────────────

export class GroqKeyManager {
  private static instance: GroqKeyManager | null = null;

  private keys: GroqKeyState[] = [];
  private roundRobinIndex: number = 0;
  private cooldownMs: number = DEFAULT_COOLDOWN_MS;

  /** Recovery timer — periodically checks if cooled-down keys can be re-enabled */
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;

  // ── Construction ────────────────────────────────────────────

  private constructor() {
    // Start the recovery loop (checks every 30 s)
    this.recoveryTimer = setInterval(() => this.recoverKeys(), 30_000);
  }

  public static getInstance(): GroqKeyManager {
    if (!GroqKeyManager.instance) {
      GroqKeyManager.instance = new GroqKeyManager();
    }
    return GroqKeyManager.instance;
  }

  // ── Initialisation ─────────────────────────────────────────

  /**
   * Load keys from process.env.
   * Scans GROQ_API_KEY_1 … GROQ_API_KEY_10.
   * Also accepts the legacy single GROQ_API_KEY if present (inserted first).
   * Ignores empty / whitespace-only values and deduplicates.
   */
  public loadFromEnv(): void {
    const seen = new Set<string>();
    const newKeys: string[] = [];

    // Legacy single key (lowest priority — appended at end so numbered keys take precedence)
    const legacyKey = process.env.GROQ_API_KEY?.trim();

    for (let i = 1; i <= MAX_ENV_KEY_SLOTS; i++) {
      const raw = process.env[`GROQ_API_KEY_${i}`]?.trim();
      if (raw && !seen.has(raw)) {
        seen.add(raw);
        newKeys.push(raw);
      }
    }

    // Append legacy key if it wasn't already included via numbered slots
    if (legacyKey && !seen.has(legacyKey)) {
      seen.add(legacyKey);
      newKeys.push(legacyKey);
    }

    // Merge: preserve state for keys that already exist, add new ones
    const existingMap = new Map(this.keys.map(k => [k.apiKey, k]));
    const merged: GroqKeyState[] = [];

    for (const key of newKeys) {
      const existing = existingMap.get(key);
      if (existing) {
        merged.push(existing);
      } else {
        merged.push(this.createKeyState(key));
      }
    }

    this.keys = merged;
    console.log(`[Groq] KeyManager loaded ${this.keys.length} key(s) from environment`);
    this.keys.forEach((k, i) => {
      console.log(`[Groq]   Key ${i + 1}: ${this.maskKey(k.apiKey)}`);
    });
  }

  /**
   * Add (or update) a key supplied at runtime (e.g. from CredentialsManager UI).
   * If the key already exists in the pool it is a no-op.
   */
  public addKey(apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) return;

    const exists = this.keys.find(k => k.apiKey === trimmed);
    if (exists) return;

    this.keys.push(this.createKeyState(trimmed));
    console.log(`[Groq] Key added at runtime: ${this.maskKey(trimmed)} (pool size: ${this.keys.length})`);
  }

  /**
   * Replace the entire pool with a single key.
   * Used when the user sets a key via the Settings UI and numbered env keys are absent.
   */
  public setSingleKey(apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) return;

    // If this key is already the only one, no-op
    if (this.keys.length === 1 && this.keys[0].apiKey === trimmed) return;

    // If numbered keys exist, just add this one (don't wipe the pool)
    if (this.keys.length > 1) {
      this.addKey(trimmed);
      return;
    }

    // Single key mode — replace
    this.keys = [this.createKeyState(trimmed)];
    this.roundRobinIndex = 0;
    console.log(`[Groq] Single key set: ${this.maskKey(trimmed)}`);
  }

  // ── Key Selection ──────────────────────────────────────────

  /**
   * Get the next available Groq SDK client + key index via round-robin.
   * Skips exhausted, cooling-down, or permanently invalid keys.
   *
   * @returns `{ client, keyIndex }` or `null` if all keys are unavailable.
   */
  public getNextClient(): { client: Groq; keyIndex: number } | null {
    if (this.keys.length === 0) return null;

    // First pass: try to recover any cooled-down keys
    this.recoverKeys();

    const total = this.keys.length;
    for (let attempt = 0; attempt < total; attempt++) {
      const idx = this.roundRobinIndex % total;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % total;

      const key = this.keys[idx];
      if (this.isKeyAvailable(key)) {
        key.lastUsed = Date.now();
        key.requestCount++;
        console.log(`[Groq] Using key ${idx + 1} (${this.maskKey(key.apiKey)})`);
        return { client: key.client, keyIndex: idx };
      }
    }

    console.error('[Groq] All keys exhausted, cooling down, or invalid');
    return null;
  }

  /**
   * Get a specific key's client by index (for retry scenarios where
   * the caller already picked a key and wants to re-use it).
   */
  public getClientByIndex(index: number): Groq | null {
    const key = this.keys[index];
    if (!key || !this.isKeyAvailable(key)) return null;
    return key.client;
  }

  // ── Rate Limit / Exhaustion ────────────────────────────────

  /**
   * Mark a key as exhausted and place it in cooldown.
   * Called when a Groq API call returns a rate-limit or quota error.
   */
  public markExhausted(keyIndex: number, cooldownMs?: number): void {
    const key = this.keys[keyIndex];
    if (!key) return;

    const cooldown = cooldownMs ?? this.cooldownMs;
    key.exhausted = true;
    key.cooldownUntil = Date.now() + cooldown;

    console.warn(
      `[Groq] Key ${keyIndex + 1} (${this.maskKey(key.apiKey)}) exhausted — cooldown ${Math.round(cooldown / 1000)}s until ${new Date(key.cooldownUntil).toISOString()}`
    );
  }

  /**
   * Check if a specific error indicates an invalid/revoked API key.
   * These keys should be permanently disabled, not just cooled down.
   */
  public isInvalidKeyError(error: any): boolean {
    if (!error) return false;

    const status = error.status ?? error.statusCode ?? 0;
    const message = (error.message || '').toLowerCase();

    // HTTP 401 Unauthorized — key is invalid or revoked
    if (status === 401) return true;

    // Groq-specific invalid key messages
    if (message.includes('invalid api key') || message.includes('invalid_api_key')) return true;
    if (message.includes('authentication') && message.includes('failed')) return true;
    if (message.includes('unauthorized')) return true;
    if (message.includes('invalid x-api-key')) return true;
    if (message.includes('api key is invalid')) return true;
    if (message.includes('incorrect api key')) return true;

    return false;
  }

  /**
   * Check if a specific error should trigger key rotation.
   * Now also returns true for invalid key errors (401),
   * so the caller can rotate instead of failing immediately.
   */
  public isRotatableError(error: any): boolean {
    if (!error) return false;

    // Invalid keys are rotatable (caller should use markInvalid, not markExhausted)
    if (this.isInvalidKeyError(error)) return true;

    const status = error.status ?? error.statusCode ?? error.code ?? 0;
    const message = (error.message || '').toLowerCase();
    const errorType = (error.error?.type || '').toLowerCase();

    // HTTP status codes that indicate rate limiting or quota issues
    if (status === 419 || status === 429 || status === 413) return true;

    // Groq-specific error patterns
    if (message.includes('rate_limit') || message.includes('rate limit')) return true;
    if (message.includes('quota exceeded') || message.includes('quota_exceeded')) return true;
    if (message.includes('token limit') || message.includes('tokens_exceeded')) return true;
    if (message.includes('too many requests')) return true;
    if (message.includes('resource_exhausted') || message.includes('resource exhausted')) return true;
    if (message.includes('temporarily unavailable')) return true;
    if (message.includes('service unavailable')) return true;
    if (message.includes('capacity') && message.includes('exceeded')) return true;

    // Error type field (Groq SDK structured errors)
    if (errorType.includes('rate_limit') || errorType.includes('tokens')) return true;

    // Timeout / network failures — worth rotating to a different key
    if (message.includes('timeout') || message.includes('timed out')) return true;
    if (message.includes('econnrefused') || message.includes('econnreset')) return true;
    if (message.includes('fetch failed') || message.includes('network')) return true;
    if (message.includes('socket hang up')) return true;

    return false;
  }

  /**
   * Determine the appropriate cooldown for a specific error.
   * Longer cooldowns for hard quota errors, shorter for transient failures.
   */
  public getCooldownForError(error: any): number {
    const status = error?.status ?? error?.statusCode ?? 0;
    const message = (error?.message || '').toLowerCase();

    // Hard quota — 10 minute cooldown
    if (message.includes('quota exceeded') || message.includes('quota_exceeded')) {
      return 10 * 60 * 1000;
    }

    // Rate limit with retry-after header
    const retryAfter = error?.headers?.['retry-after'] ?? error?.error?.retry_after;
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) {
        // Add 10% buffer
        return Math.ceil(seconds * 1100);
      }
    }

    // Standard rate limit — 5 minute cooldown
    if (status === 429 || status === 419) {
      return DEFAULT_COOLDOWN_MS;
    }

    // Transient network errors — 2 minute cooldown
    if (message.includes('timeout') || message.includes('econnrefused') || message.includes('network')) {
      return 2 * 60 * 1000;
    }

    // Default
    return DEFAULT_COOLDOWN_MS;
  }

  // ── Recovery ───────────────────────────────────────────────

  /**
   * Check all exhausted keys and recover any whose cooldown has expired.
   */
  public recoverKeys(): void {
    const now = Date.now();
    for (const key of this.keys) {
      // Never recover permanently invalid keys
      if (key.invalid) continue;

      if (key.exhausted && key.cooldownUntil !== null && now >= key.cooldownUntil) {
        key.exhausted = false;
        key.cooldownUntil = null;
        console.log(`[Groq] Key recovered: ${this.maskKey(key.apiKey)}`);
      }
    }
  }

  // ── Health / Status ────────────────────────────────────────

  /**
   * Returns the total number of keys in the pool.
   */
  public getPoolSize(): number {
    return this.keys.length;
  }

  /**
   * Returns the number of currently available (non-exhausted, non-cooling) keys.
   */
  public getAvailableCount(): number {
    this.recoverKeys();
    return this.keys.filter(k => this.isKeyAvailable(k)).length;
  }

  /**
   * Returns true if at least one key is available.
   */
  public hasAvailableKey(): boolean {
    return this.getAvailableCount() > 0;
  }

  /**
   * Comprehensive health report for monitoring / debugging.
   */
  public getHealthReport(): GroqKeyHealthReport {
    this.recoverKeys();
    const now = Date.now();

    return {
      totalKeys: this.keys.length,
      availableKeys: this.keys.filter(k => this.isKeyAvailable(k)).length,
      exhaustedKeys: this.keys.filter(k => k.exhausted && !k.invalid).length,
      coolingDownKeys: this.keys.filter(k => k.cooldownUntil !== null && k.cooldownUntil > now).length,
      invalidKeys: this.keys.filter(k => k.invalid).length,
      keys: this.keys.map((k, i) => ({
        index: i + 1,
        masked: this.maskKey(k.apiKey),
        exhausted: k.exhausted,
        invalid: k.invalid,
        cooldownUntil: k.cooldownUntil,
        requestCount: k.requestCount,
        lastUsed: k.lastUsed,
      })),
    };
  }

  // ── Cleanup ────────────────────────────────────────────────

  public destroy(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.keys = [];
    GroqKeyManager.instance = null;
    console.log('[Groq] KeyManager destroyed');
  }

  // ── Internal helpers ───────────────────────────────────────

  private createKeyState(apiKey: string): GroqKeyState {
    return {
      apiKey,
      exhausted: false,
      cooldownUntil: null,
      requestCount: 0,
      lastUsed: 0,
      invalid: false,
      client: new Groq({ apiKey }),
    };
  }

  private isKeyAvailable(key: GroqKeyState): boolean {
    // Permanently invalid keys are never available
    if (key.invalid) return false;

    if (key.exhausted) {
      // Check if cooldown has expired
      if (key.cooldownUntil !== null && Date.now() >= key.cooldownUntil) {
        key.exhausted = false;
        key.cooldownUntil = null;
        console.log(`[Groq] Key auto-recovered: ${this.maskKey(key.apiKey)}`);
        return true;
      }
      return false;
    }
    return true;
  }

  // ── Permanent Invalidation ─────────────────────────────────

  /**
   * Permanently mark a key as invalid (e.g. 401 Unauthorized).
   * The key will never be auto-recovered or re-entered into rotation.
   * Only a full pool reload or app restart can re-enable it.
   */
  public markInvalid(keyIndex: number): void {
    const key = this.keys[keyIndex];
    if (!key) return;

    // Idempotent — don't log again if already invalid
    if (key.invalid) return;

    key.invalid = true;
    key.exhausted = true;
    key.cooldownUntil = null; // No cooldown — permanent

    const remaining = this.keys.filter(k => !k.invalid).length;
    console.warn(
      `[Groq] Key ${keyIndex + 1} (${this.maskKey(key.apiKey)}) permanently disabled (invalid API key). ` +
      `${remaining} valid key(s) remaining.`
    );
  }

  /**
   * Mask an API key for safe logging.
   * Shows first 6 chars + last 3 chars: `gsk_xx...abc`
   */
  public maskKey(apiKey: string): string {
    if (!apiKey || apiKey.length < 12) return '***';
    return `${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 3)}`;
  }
}
