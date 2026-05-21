// electron/intelligence/ipc/TimelineIPC.ts
// Batched IPC bridge for timeline signals.
//
// Subscribes to IntelligenceEventBus and flushes batched signals
// to the renderer at a debounced interval.
//
// Rules:
//   - 750ms batching interval
//   - Max 10 signals per batch
//   - Capability-gated via 'timelineUI'
//   - Memory bounded (never accumulates unbounded)
//   - Renderer-safe: single batched IPC per interval
//
// IPC Channel: 'intelligence:timeline-batch'

import { BrowserWindow } from 'electron';
import type { TimelineBatchPayload, TimelineSignalPayload } from './types';
import type { IntelligenceSignal } from '../timeline/types';
import { IntelligenceEventBus } from '../timeline/IntelligenceEventBus';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Batching interval in ms */
const BATCH_INTERVAL_MS = 750;

/** Maximum signals per batch */
const MAX_BATCH_SIZE = 10;

/** IPC channel name */
const CHANNEL = 'intelligence:timeline-batch';

// ---------------------------------------------------------------------------
// TimelineIPC
// ---------------------------------------------------------------------------

export class TimelineIPC {
    private static instance: TimelineIPC | null = null;

    private pendingSignals: TimelineSignalPayload[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribe: (() => void) | null = null;
    private batchCounter: number = 0;
    private started: boolean = false;

    private constructor() {}

    static getInstance(): TimelineIPC {
        if (!TimelineIPC.instance) {
            TimelineIPC.instance = new TimelineIPC();
        }
        return TimelineIPC.instance;
    }

    /**
     * Start listening to IntelligenceEventBus.
     * Idempotent — safe to call multiple times.
     */
    start(): void {
        if (this.started) return;

        this.unsubscribe = IntelligenceEventBus.getInstance().on('*', (signal) => {
            this.onSignal(signal);
        });

        this.started = true;
    }

    /**
     * Stop listening and flush any remaining signals.
     */
    stop(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        this.flush();
        this.started = false;
    }

    // ---------------------------------------------------------------------------
    // Private
    // ---------------------------------------------------------------------------

    private onSignal(signal: IntelligenceSignal): void {
        // Capability gate — if UI is off, don't accumulate
        if (!CapabilityRegistry.getInstance().isEnabled('timelineUI')) {
            return;
        }

        const payload: TimelineSignalPayload = {
            type: signal.type,
            label: signal.label,
            confidence: signal.confidence,
            severity: signal.severity,
            timestamp: signal.timestamp,
            modeId: signal.modeId,
        };

        this.pendingSignals.push(payload);

        // Cap pending buffer
        if (this.pendingSignals.length > MAX_BATCH_SIZE * 3) {
            this.pendingSignals = this.pendingSignals.slice(-MAX_BATCH_SIZE * 3);
        }

        // Schedule flush
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.flushTimer !== null) return; // Already scheduled

        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush();
        }, BATCH_INTERVAL_MS);
    }

    private flush(): void {
        if (this.pendingSignals.length === 0) return;

        // Re-check capability gate at flush time
        if (!CapabilityRegistry.getInstance().isEnabled('timelineUI')) {
            this.pendingSignals = [];
            return;
        }

        // Take up to MAX_BATCH_SIZE signals
        const batch = this.pendingSignals.slice(0, MAX_BATCH_SIZE);
        this.pendingSignals = this.pendingSignals.slice(MAX_BATCH_SIZE);

        this.batchCounter++;
        const batchId = `tb_${Date.now().toString(36)}_${this.batchCounter}`;

        const stats = IntelligenceEventBus.getInstance().getStats();

        const payload: TimelineBatchPayload = {
            batchId,
            signals: batch,
            timestamp: Date.now(),
            totalCount: stats.total,
        };

        // Broadcast to all windows
        try {
            for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) {
                    win.webContents.send(CHANNEL, payload);
                }
            }
        } catch {
            // Silent — IPC failure is non-fatal
        }

        // If more signals remain, schedule another flush
        if (this.pendingSignals.length > 0) {
            this.scheduleFlush();
        }
    }
}
