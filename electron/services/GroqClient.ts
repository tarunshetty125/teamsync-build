/**
 * GroqClient - Fault-tolerant Groq API client with automatic key rotation
 *
 * Responsibilities:
 *   • Execute Groq chat.completions (streaming & non-streaming)
 *   • Inject the active API key from GroqKeyManager
 *   • Auto-retry on rate limit / quota / network errors
 *   • Seamless failover to the next key in the pool
 *   • Bounded retry count (max = pool size) — prevents infinite loops
 *   • Zero changes to request payload or response format
 */

import Groq from 'groq-sdk';
import { GroqKeyManager } from './GroqKeyManager';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** Parameters for a non-streaming chat completion call */
export interface GroqChatParams {
  model: string;
  messages: Array<{ role: string; content: any }>;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  top_p?: number;
  stop?: string | string[] | null;
  stream?: false;
}

/** Parameters for a streaming chat completion call */
export interface GroqStreamParams {
  model: string;
  messages: Array<{ role: string; content: any }>;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  top_p?: number;
  stop?: string | string[] | null;
  stream: true;
}

// ─────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────

export class GroqClient {
  private keyManager: GroqKeyManager;

  constructor(keyManager?: GroqKeyManager) {
    this.keyManager = keyManager ?? GroqKeyManager.getInstance();
  }

  // ── Non-streaming ──────────────────────────────────────────

  /**
   * Execute a non-streaming chat completion with automatic key rotation.
   * Returns the full Groq ChatCompletion response object.
   *
   * @throws Error if all keys are exhausted after max retries
   */
  public async chatCompletion(params: GroqChatParams): Promise<any> {
    const maxRetries = Math.max(this.keyManager.getPoolSize(), 1);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const slot = this.keyManager.getNextClient();
      if (!slot) {
        throw new Error(
          `[Groq] All ${this.keyManager.getPoolSize()} API keys are exhausted, invalid, or cooling down. ` +
          `No available keys to fulfil the request.`
        );
      }

      const { client, keyIndex } = slot;

      try {
        console.log(`[Groq] Request attempt ${attempt}/${maxRetries} using key ${keyIndex + 1}`);

        const response = await client.chat.completions.create({
          ...params,
          stream: false,
        } as any);

        return response;
      } catch (error: any) {
        console.error(
          `[Groq] Key ${keyIndex + 1} failed: ${error.message?.substring(0, 120) || 'Unknown error'}`
        );

        // 401 / invalid key → permanently disable, then retry with next key
        if (this.keyManager.isInvalidKeyError(error)) {
          this.keyManager.markInvalid(keyIndex);

          if (attempt < maxRetries && this.keyManager.hasAvailableKey()) {
            console.log(`[Groq] Retrying with next key (${attempt + 1}/${maxRetries})`);
            await this.sleep(100);
            continue;
          }

          throw new Error(
            `[Groq] All Groq API keys are invalid or unavailable. Last error: ${error.message}`
          );
        }

        // Rate limit / quota / network → cooldown + retry
        if (this.keyManager.isRotatableError(error)) {
          const cooldown = this.keyManager.getCooldownForError(error);
          this.keyManager.markExhausted(keyIndex, cooldown);

          if (attempt < maxRetries) {
            console.log(`[Groq] Switching to next key — retry attempt ${attempt + 1}/${maxRetries}`);
            await this.sleep(200);
            continue;
          }
        }

        // Non-rotatable error or last attempt — propagate
        if (attempt === maxRetries) {
          throw new Error(
            `[Groq] All ${maxRetries} key(s) failed. Last error: ${error.message}`
          );
        }

        // Non-rotatable error on non-last attempt — throw immediately
        throw error;
      }
    }

    // Unreachable, but satisfies TypeScript
    throw new Error('[Groq] Exhausted all retry attempts');
  }

  // ── Streaming ──────────────────────────────────────────────

  /**
   * Execute a streaming chat completion with automatic key rotation.
   * Returns an AsyncGenerator that yields content strings.
   *
   * Streaming retries: if the stream creation itself fails with a rotatable
   * error, we rotate keys and retry. Once the stream is established and
   * starts yielding chunks, failures mid-stream are NOT retried (to avoid
   * duplicate content).
   */
  public async *chatCompletionStream(params: GroqStreamParams): AsyncGenerator<string, void, unknown> {
    const maxRetries = Math.max(this.keyManager.getPoolSize(), 1);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const slot = this.keyManager.getNextClient();
      if (!slot) {
        throw new Error(
          `[Groq] All ${this.keyManager.getPoolSize()} API keys are exhausted, invalid, or cooling down. ` +
          `No available keys to fulfil the streaming request.`
        );
      }

      const { client, keyIndex } = slot;

      try {
        console.log(`[Groq] Stream attempt ${attempt}/${maxRetries} using key ${keyIndex + 1}`);

        const stream = await client.chat.completions.create({
          ...params,
          stream: true,
        } as any) as unknown as AsyncIterable<any>;

        // Stream established — yield chunks
        for await (const chunk of stream) {
          const content = chunk?.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        }

        // Stream completed successfully
        return;
      } catch (error: any) {
        console.error(
          `[Groq] Stream key ${keyIndex + 1} failed: ${error.message?.substring(0, 120) || 'Unknown error'}`
        );

        // 401 / invalid key → permanently disable, then retry with next key
        if (this.keyManager.isInvalidKeyError(error)) {
          this.keyManager.markInvalid(keyIndex);

          if (attempt < maxRetries && this.keyManager.hasAvailableKey()) {
            console.log(`[Groq] Stream retrying with next key (${attempt + 1}/${maxRetries})`);
            await this.sleep(100);
            continue;
          }

          throw new Error(
            `[Groq] All Groq API keys are invalid or unavailable. Last error: ${error.message}`
          );
        }

        // Rate limit / quota / network → cooldown + retry
        if (this.keyManager.isRotatableError(error)) {
          const cooldown = this.keyManager.getCooldownForError(error);
          this.keyManager.markExhausted(keyIndex, cooldown);

          if (attempt < maxRetries) {
            console.log(`[Groq] Stream switching to next key — retry attempt ${attempt + 1}/${maxRetries}`);
            await this.sleep(200);
            continue;
          }
        }

        // Non-rotatable error or last attempt — propagate
        if (attempt === maxRetries) {
          throw new Error(
            `[Groq] All ${maxRetries} key(s) failed for streaming. Last error: ${error.message}`
          );
        }

        throw error;
      }
    }

    throw new Error('[Groq] Exhausted all streaming retry attempts');
  }

  // ── Convenience: raw client access (for edge cases) ───────

  /**
   * Get a raw Groq SDK client for the next available key.
   * The caller is responsible for error handling.
   * Returns `{ client, keyIndex }` or null.
   */
  public getRawClient(): { client: Groq; keyIndex: number } | null {
    return this.keyManager.getNextClient();
  }

  // ── Internal helpers ───────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
