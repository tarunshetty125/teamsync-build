// electron/intelligence/ipc/AdaptiveModeIPC.ts
// IPC bridge for adaptive mode suggestions.
//
// Exposes existing ModePredictor predictions to the renderer as
// dismissible, non-blocking suggestions.
//
// Rules:
//   - Only emits when confidence >= 0.85
//   - Only emits when predictedMode !== currentMode
//   - Debounced: minimum 10s between suggestions
//   - Capability-gated via 'adaptiveModeUI'
//   - No auto-switching — suggestion only
//   - No forced mode changes
//   - Dismissed modes are suppressed for 5 minutes (persisted locally)
//
// IPC Channel: 'intelligence:adaptive-mode-suggestion'

import { BrowserWindow } from 'electron';
import Store from 'electron-store';
import type { AdaptiveModeSuggestionPayload } from './types';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum confidence to surface a suggestion */
const MIN_SUGGESTION_CONFIDENCE = 0.85;

/** Minimum time between suggestions (ms) */
const SUGGESTION_DEBOUNCE_MS = 10_000;

/** Dismiss cooldown duration (ms) — 5 minutes */
const DISMISS_COOLDOWN_MS = 5 * 60 * 1000;

/** IPC channel name */
const CHANNEL = 'intelligence:adaptive-mode-suggestion';

/** electron-store key for persisted dismiss cooldowns */
const STORE_KEY = 'intelligence.adaptiveMode.dismissCooldowns';

// ---------------------------------------------------------------------------
// Mode name lookup
// ---------------------------------------------------------------------------

const MODE_NAMES: Readonly<Record<string, string>> = {
    technical_interview: 'Technical Interview',
    sales: 'Sales',
    recruiting: 'Recruiting',
    team_meeting: 'Team Meeting',
    lecture: 'Lecture',
    looking_for_work: 'Looking for Work',
    general: 'General',
};

// ---------------------------------------------------------------------------
// AdaptiveModeIPC
// ---------------------------------------------------------------------------

export class AdaptiveModeIPC {
    private static instance: AdaptiveModeIPC | null = null;

    private lastSuggestionAt: number = 0;

    /** The mode from the most recently emitted suggestion, used by dismiss() */
    private lastSuggestedMode: string | null = null;

    /**
     * Per-mode dismiss cooldowns.
     * Key = mode ID, Value = unix ms timestamp until which the mode is suppressed.
     * Bounded: at most 7 entries (one per known mode).
     */
    private dismissCooldownByMode: Map<string, number> = new Map();

    /** Local persistence store (lazy, privacy-safe) */
    private store: Store | null = null;

    private constructor() {
        this.loadPersistedCooldowns();
    }

    static getInstance(): AdaptiveModeIPC {
        if (!AdaptiveModeIPC.instance) {
            AdaptiveModeIPC.instance = new AdaptiveModeIPC();
        }
        return AdaptiveModeIPC.instance;
    }

    // -----------------------------------------------------------------------
    // Dismiss cooldown
    // -----------------------------------------------------------------------

    /**
     * Dismiss the most recently suggested mode.
     * Suppresses that mode for DISMISS_COOLDOWN_MS (5 minutes).
     * Called from the 'intelligence:dismiss-suggestion' IPC handler.
     *
     * Returns the dismissed mode ID, or null if nothing to dismiss.
     */
    dismiss(): string | null {
        const mode = this.lastSuggestedMode;
        if (!mode) return null;

        const until = Date.now() + DISMISS_COOLDOWN_MS;
        this.dismissCooldownByMode.set(mode, until);
        this.persistCooldowns();

        return mode;
    }

    /**
     * Check whether a mode is currently under dismiss cooldown.
     */
    private isModeOnCooldown(mode: string): boolean {
        const until = this.dismissCooldownByMode.get(mode);
        if (until === undefined) return false;

        if (Date.now() >= until) {
            // Cooldown expired — clean up
            this.dismissCooldownByMode.delete(mode);
            return false;
        }

        return true;
    }

    // -----------------------------------------------------------------------
    // Persistence (electron-store, local-only, privacy-safe)
    // -----------------------------------------------------------------------

    private getStore(): Store {
        if (!this.store) {
            this.store = new Store({ name: 'intelligence-adaptive-mode' });
        }
        return this.store;
    }

    private loadPersistedCooldowns(): void {
        try {
            const raw = this.getStore().get(STORE_KEY) as Record<string, number> | undefined;
            if (!raw || typeof raw !== 'object') return;

            const now = Date.now();
            for (const [mode, until] of Object.entries(raw)) {
                if (typeof until === 'number' && until > now) {
                    this.dismissCooldownByMode.set(mode, until);
                }
            }
        } catch {
            // Silent — persistence failure is non-fatal
        }
    }

    private persistCooldowns(): void {
        try {
            const record: Record<string, number> = {};
            const now = Date.now();
            for (const [mode, until] of this.dismissCooldownByMode.entries()) {
                if (until > now) {
                    record[mode] = until;
                }
            }
            this.getStore().set(STORE_KEY, record);
        } catch {
            // Silent — persistence failure is non-fatal
        }
    }

    // -----------------------------------------------------------------------
    // Suggestion emission
    // -----------------------------------------------------------------------

    /**
     * Attempt to surface an adaptive mode suggestion.
     *
     * Call this after ModePredictor.predict() returns a result.
     * Only emits IPC if all thresholds are met.
     *
     * Returns true if a suggestion was sent, false if suppressed.
     */
    maybeSuggest(params: {
        readonly predictedMode: string;
        readonly currentMode: string;
        readonly confidence: number;
    }): boolean {
        // Capability gate
        if (!CapabilityRegistry.getInstance().isEnabled('adaptiveModeUI')) {
            return false;
        }

        // Confidence threshold
        if (params.confidence < MIN_SUGGESTION_CONFIDENCE) {
            return false;
        }

        // Same mode — no suggestion needed
        if (params.predictedMode === params.currentMode) {
            return false;
        }

        // Dismiss cooldown — mode was recently dismissed by user
        if (this.isModeOnCooldown(params.predictedMode)) {
            return false;
        }

        // Debounce
        const now = Date.now();
        if (now - this.lastSuggestionAt < SUGGESTION_DEBOUNCE_MS) {
            return false;
        }

        this.lastSuggestionAt = now;
        this.lastSuggestedMode = params.predictedMode;

        const payload: AdaptiveModeSuggestionPayload = {
            predictedMode: params.predictedMode,
            predictedModeName: MODE_NAMES[params.predictedMode] ?? params.predictedMode,
            currentMode: params.currentMode,
            confidence: params.confidence,
            timestamp: now,
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

        return true;
    }
}
