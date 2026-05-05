import { createHash } from 'crypto';
import type { PromptObject } from './ActionContextBuilder';

export interface ActionCacheEntry {
    content: string;
    expiresAt: number;
    createdAt: number;
}

export interface ActionCacheGetResult {
    key: string;
    hit: boolean;
    content?: string;
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
    return `{${entries.join(',')}}`;
}

export class ActionResponseCache {
    private readonly ttlMs: number;
    private readonly store = new Map<string, ActionCacheEntry>();

    constructor(ttlMs: number = 2 * 60 * 1000) {
        this.ttlMs = ttlMs;
    }

    buildKey(prompt: PromptObject, sessionScope: string): string {
        const serialized = stableStringify({
            sessionScope,
            mode: prompt.mode,
            intent: prompt.intent,
            question: prompt.question,
            transcript: prompt.transcript,
            profile: prompt.profile,
            instructions: prompt.instructions,
        });
        return createHash('sha256').update(serialized).digest('hex');
    }

    get(prompt: PromptObject, sessionScope: string): ActionCacheGetResult {
        this.evictExpired();
        const key = this.buildKey(prompt, sessionScope);
        const entry = this.store.get(key);
        if (!entry || entry.expiresAt <= Date.now()) {
            if (entry) {
                this.store.delete(key);
            }
            return { key, hit: false };
        }
        return {
            key,
            hit: true,
            content: entry.content,
        };
    }

    set(prompt: PromptObject, sessionScope: string, content: string): string {
        const key = this.buildKey(prompt, sessionScope);
        this.store.set(key, {
            content,
            createdAt: Date.now(),
            expiresAt: Date.now() + this.ttlMs,
        });
        this.evictExpired();
        return key;
    }

    clear(): void {
        this.store.clear();
    }

    private evictExpired(): void {
        const now = Date.now();
        for (const [key, entry] of this.store.entries()) {
            if (entry.expiresAt <= now) {
                this.store.delete(key);
            }
        }
    }
}
