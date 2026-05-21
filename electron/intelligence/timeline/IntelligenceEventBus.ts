// electron/intelligence/timeline/IntelligenceEventBus.ts
// Central event bus for intelligence signals.
//
// Backend-only — NO IPC, NO renderer communication.
// Provides deduplication, circular buffer storage, and typed subscription.
//
// Usage:
//   const bus = IntelligenceEventBus.getInstance();
//   const unsub = bus.on('buying_signal', (signal) => { ... });
//   bus.emit({ id: '...', type: 'buying_signal', ... });

import type { IntelligenceSignal, SignalType, TimelineConfig } from './types';

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

const DEFAULT_TIMELINE_CONFIG: Readonly<TimelineConfig> = {
    maxSignals: 500,
    dedupeWindowMs: 5_000,
    batchIntervalMs: 2_000,
    maxBatchSize: 3,
};

// ---------------------------------------------------------------------------
// IntelligenceEventBus
// ---------------------------------------------------------------------------

type SignalHandler = (signal: IntelligenceSignal) => void;

export class IntelligenceEventBus {
    private static instance: IntelligenceEventBus;

    private readonly config: Readonly<TimelineConfig>;
    private signals: IntelligenceSignal[] = [];
    private readonly handlers: Map<string, Set<SignalHandler>> = new Map();
    private readonly recentFingerprints: Set<string> = new Set();

    constructor(config?: Partial<TimelineConfig>) {
        this.config = { ...DEFAULT_TIMELINE_CONFIG, ...config };
    }

    static getInstance(): IntelligenceEventBus {
        if (!IntelligenceEventBus.instance) {
            IntelligenceEventBus.instance = new IntelligenceEventBus();
        }
        return IntelligenceEventBus.instance;
    }

    // ---------------------------------------------------------------------------
    // Subscription
    // ---------------------------------------------------------------------------

    /**
     * Subscribe to signals of a specific type, or '*' for all.
     * Returns an unsubscribe function.
     */
    on(type: SignalType | '*', handler: SignalHandler): () => void {
        const key = type;
        if (!this.handlers.has(key)) {
            this.handlers.set(key, new Set());
        }
        this.handlers.get(key)!.add(handler);

        return () => {
            this.handlers.get(key)?.delete(handler);
        };
    }

    // ---------------------------------------------------------------------------
    // Emission
    // ---------------------------------------------------------------------------

    /**
     * Emit a signal. Returns false if deduplicated (duplicate within window).
     */
    emit(signal: IntelligenceSignal): boolean {
        // Deduplication check
        const fingerprint = this.computeFingerprint(signal);
        if (this.recentFingerprints.has(fingerprint)) {
            return false;
        }

        // Track fingerprint and schedule cleanup
        this.recentFingerprints.add(fingerprint);
        setTimeout(() => {
            this.recentFingerprints.delete(fingerprint);
        }, this.config.dedupeWindowMs);

        // Store in circular buffer
        this.signals.push(signal);
        if (this.signals.length > this.config.maxSignals) {
            this.signals = this.signals.slice(-this.config.maxSignals);
        }

        // Notify handlers
        this.notifyHandlers(signal);

        return true;
    }

    // ---------------------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------------------

    /**
     * Get the most recent signals.
     */
    getRecent(limit: number = 20): IntelligenceSignal[] {
        return this.signals.slice(-limit);
    }

    /**
     * Get signals of a specific type.
     */
    getByType(type: SignalType, limit: number = 20): IntelligenceSignal[] {
        const filtered = this.signals.filter(s => s.type === type);
        return filtered.slice(-limit);
    }

    /**
     * Get event bus statistics.
     */
    getStats(): { total: number; byType: Record<string, number> } {
        const byType: Record<string, number> = {};
        for (const signal of this.signals) {
            byType[signal.type] = (byType[signal.type] || 0) + 1;
        }
        return { total: this.signals.length, byType };
    }

    /**
     * Clear all stored signals and fingerprints.
     */
    clear(): void {
        this.signals = [];
        this.recentFingerprints.clear();
    }

    // ---------------------------------------------------------------------------
    // Private
    // ---------------------------------------------------------------------------

    private computeFingerprint(signal: IntelligenceSignal): string {
        const bucket = Math.floor(signal.timestamp / this.config.dedupeWindowMs);
        return `${signal.type}:${signal.label}:${bucket}`;
    }

    private notifyHandlers(signal: IntelligenceSignal): void {
        // Notify type-specific handlers
        const typeHandlers = this.handlers.get(signal.type);
        if (typeHandlers) {
            for (const handler of typeHandlers) {
                try {
                    handler(signal);
                } catch (err) {
                    console.warn('[IntelligenceEventBus] Handler error:', err);
                }
            }
        }

        // Notify wildcard handlers
        const wildcardHandlers = this.handlers.get('*');
        if (wildcardHandlers) {
            for (const handler of wildcardHandlers) {
                try {
                    handler(signal);
                } catch (err) {
                    console.warn('[IntelligenceEventBus] Wildcard handler error:', err);
                }
            }
        }
    }
}
