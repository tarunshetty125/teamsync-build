/**
 * BedrockCredentialHealthMonitor — Proactive credential validation.
 *
 * Periodically validates Bedrock credentials with a lightweight
 * ListFoundationModels call (maxResults=1) before they expire.
 * Surfaces health status to the UI via IPC instead of discovering
 * expired credentials during user requests.
 *
 * Health states:
 *   - green:   Credentials valid, API reachable
 *   - yellow:  Last check failed but within grace period (< 2 consecutive failures)
 *   - red:     Credentials expired/invalid (2+ consecutive failures)
 *   - unknown: Never checked or Bedrock not configured
 */

import { BrowserWindow } from 'electron';

// ─── Types ───────────────────────────────────────────────────────────────

export type CredentialHealthStatus = 'green' | 'yellow' | 'red' | 'unknown';

export interface CredentialHealthState {
    status: CredentialHealthStatus;
    lastCheckAt: number;
    lastSuccessAt: number;
    consecutiveFailures: number;
    lastError?: string;
}

// ─── Config ──────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 5 * 60_000;            // 5 minutes
const FAILURE_THRESHOLD_FOR_RED = 2;              // 2+ consecutive = red
const STALE_THRESHOLD_MS = 15 * 60_000;           // No check in 15min = unknown

// ─── Monitor ─────────────────────────────────────────────────────────────

class BedrockCredentialHealthMonitorImpl {
    private state: CredentialHealthState = {
        status: 'unknown',
        lastCheckAt: 0,
        lastSuccessAt: 0,
        consecutiveFailures: 0,
    };

    private intervalId: ReturnType<typeof setInterval> | null = null;
    private checkFn: (() => Promise<void>) | null = null;

    /**
     * Start the periodic health monitor.
     *
     * @param checkFn - A function that throws if credentials are invalid.
     *                  Typically: () => bedrockClient.validate()
     */
    start(checkFn: () => Promise<void>): void {
        this.checkFn = checkFn;
        this.stop(); // Clear any existing interval

        // Run first check immediately (non-blocking)
        this.runCheck().catch(() => {});

        this.intervalId = setInterval(() => {
            this.runCheck().catch(() => {});
        }, CHECK_INTERVAL_MS);

        console.log('[BedrockHealthMonitor] Started (interval: 5min)');
    }

    /** Stop the periodic monitor. */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /** Force an immediate health check. */
    async checkNow(): Promise<CredentialHealthState> {
        await this.runCheck();
        return this.getState();
    }

    /** Get current health state. */
    getState(): CredentialHealthState {
        // If no check has happened in STALE_THRESHOLD_MS, mark as unknown
        if (this.state.lastCheckAt > 0 &&
            Date.now() - this.state.lastCheckAt > STALE_THRESHOLD_MS) {
            return { ...this.state, status: 'unknown' };
        }
        return { ...this.state };
    }

    /** Reset to unknown (when credentials are changed/cleared). */
    reset(): void {
        this.state = {
            status: 'unknown',
            lastCheckAt: 0,
            lastSuccessAt: 0,
            consecutiveFailures: 0,
        };
        this.notifyUI();
    }

    // ─── Internal ────────────────────────────────────────────────────

    private async runCheck(): Promise<void> {
        if (!this.checkFn) return;

        try {
            await this.checkFn();
            this.state = {
                status: 'green',
                lastCheckAt: Date.now(),
                lastSuccessAt: Date.now(),
                consecutiveFailures: 0,
            };
            console.log('[BedrockHealthMonitor] ✅ Credentials valid');
        } catch (err: any) {
            const failures = this.state.consecutiveFailures + 1;
            this.state = {
                status: failures >= FAILURE_THRESHOLD_FOR_RED ? 'red' : 'yellow',
                lastCheckAt: Date.now(),
                lastSuccessAt: this.state.lastSuccessAt,
                consecutiveFailures: failures,
                lastError: err?.message || 'Unknown error',
            };
            console.warn(`[BedrockHealthMonitor] ⚠️ Check failed (${failures} consecutive): ${err?.message}`);
        }

        this.notifyUI();
    }

    /** Push health state to renderer via IPC. */
    private notifyUI(): void {
        try {
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
                if (!win.isDestroyed()) {
                    win.webContents.send('bedrock-credential-health', this.getState());
                }
            }
        } catch {
            // IPC may not be available during early boot or after window close
        }
    }
}

// ─── Export Singleton ────────────────────────────────────────────────────

export const BedrockCredentialHealthMonitor = new BedrockCredentialHealthMonitorImpl();
