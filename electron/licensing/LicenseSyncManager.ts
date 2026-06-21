/**
 * LicenseSyncManager — Centralized license state orchestrator.
 *
 * Architecture decisions:
 * - EntitlementVerifier remains the crypto/validation layer.
 * - LicenseSyncManager orchestrates *when* syncs happen, manages the state machine,
 *   event bus, backoff, telemetry, and tamper detection.
 * - Renderer NEVER computes license state. It receives frozen snapshots via IPC.
 * - All state transitions emit typed events for reactive UI updates.
 * - All exposed state is Object.freeze'd before leaving the main process boundary.
 *
 * State machine: FREE → ACTIVATING → ACTIVE → OFFLINE_GRACE → EXPIRED → REVOKED → INVALID → TAMPERED
 */

import { EventEmitter } from 'events';
import { BrowserWindow, powerMonitor } from 'electron';
import { EntitlementVerifier, type EntitlementStatus, type SyncReason } from './EntitlementVerifier';
import { LicenseTelemetry } from './LicenseTelemetry';
import { TamperDetector } from './TamperDetector';

// ── State Machine ──────────────────────────────────────────────────────────────

export type LicenseState =
  | 'FREE'
  | 'ACTIVATING'
  | 'ACTIVE'
  | 'OFFLINE_GRACE'
  | 'EXPIRED'
  | 'REVOKED'
  | 'INVALID'
  | 'TAMPERED';

// ── License Events ─────────────────────────────────────────────────────────────

export type LicenseEventType =
  | 'license:state_changed'
  | 'license:tier_changed'
  | 'license:expired'
  | 'license:revoked'
  | 'license:offline_grace_started'
  | 'license:offline_grace_expired'
  | 'license:sync_started'
  | 'license:sync_completed'
  | 'license:sync_failed'
  | 'license:tampered';

// ── Sync State (exposed to renderer) ───────────────────────────────────────────
// This is the SINGLE authoritative snapshot. Renderer subscribes to this via
// the 'license:state' IPC channel. It must never compute state itself.

export interface LicenseSyncState {
  readonly status: LicenseState;
  readonly capabilities: readonly string[];
  readonly tier: string;
  readonly lastSync: string | null;
  readonly nextSync: string | null;
  readonly offlineGraceRemaining: number;
  readonly syncInProgress: boolean;
  readonly serverReachable: boolean;
  readonly plan: string;
  readonly isPremium: boolean;
  readonly trial: boolean;
  readonly features: readonly string[];
  readonly expiresAt?: string;
  readonly graceUntil?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const BACKOFF_SCHEDULE_MINUTES = [5, 10, 20, 30, 60] as const;
const FOCUS_INACTIVITY_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
/** Maximum telemetry events uploaded per successful sync to avoid oversized payloads */
const TELEMETRY_BATCH_LIMIT = 50;

export class LicenseSyncManager extends EventEmitter {
  private static instance: LicenseSyncManager | null = null;

  private readonly verifier: EntitlementVerifier;
  private readonly telemetry: LicenseTelemetry;
  private readonly tamperDetector: TamperDetector;

  private currentState: LicenseState = 'FREE';
  private previousTier: string = 'free';
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures: number = 0;
  private serverReachable: boolean = true;
  private syncInProgress: boolean = false;
  private lastFocusAt: number = 0;
  private pendingDowngrade: boolean = false;
  private isMeetingActiveCallback: (() => boolean) | null = null;
  private initialized: boolean = false;

  constructor(options: {
    verifier?: EntitlementVerifier;
    telemetry?: LicenseTelemetry;
    tamperDetector?: TamperDetector;
  } = {}) {
    super();
    this.verifier = options.verifier || EntitlementVerifier.getInstance();
    this.telemetry = options.telemetry || LicenseTelemetry.getInstance();
    this.tamperDetector = options.tamperDetector || TamperDetector.getInstance();
  }

  static getInstance(): LicenseSyncManager {
    if (!LicenseSyncManager.instance) {
      LicenseSyncManager.instance = new LicenseSyncManager();
    }
    return LicenseSyncManager.instance;
  }

  /** Reset singleton for testing. */
  static resetInstance(): void {
    if (LicenseSyncManager.instance) {
      LicenseSyncManager.instance.shutdown();
      LicenseSyncManager.instance = null;
    }
  }

  /**
   * Initialize the sync manager. Call once during app startup.
   * Wires event listeners and starts background sync.
   */
  async initialize(): Promise<LicenseSyncState> {
    if (this.initialized) return this.getState();

    // Set up telemetry device hash
    this.telemetry.setDeviceIdHash(this.verifier.getDeviceId());

    // Run tamper detection (non-blocking, non-fatal)
    const tamperStatus = this.tamperDetector.verify();
    if (tamperStatus === 'tampered') {
      this.currentState = 'TAMPERED';
      this.telemetry.record('tamper', this.previousTier);
      this.broadcastState();
      this.initialized = true;
      return this.getState();
    }

    // Listen for entitlement changes from the verifier
    this.verifier.on('changed', (status: EntitlementStatus, reason?: SyncReason) => {
      this.reconcileState(status, reason);
    });

    // Initialize the entitlement verifier (startup sync + background timer)
    // We stop the verifier's own background sync — we'll manage it ourselves with backoff
    const initialStatus = await this.verifier.initialize();
    this.verifier.stopBackgroundSync();

    // Derive initial state
    this.reconcileState(initialStatus, 'startup');

    // Start our managed background sync with backoff
    this.scheduleNextSync();

    // Register system event listeners for push-based refresh
    this.registerSystemListeners();

    this.initialized = true;
    return this.getState();
  }

  /**
   * Set callback to check if a meeting is active (for graceful downgrade).
   */
  setMeetingActiveCallback(callback: () => boolean): void {
    this.isMeetingActiveCallback = callback;
  }

  /**
   * Check and apply pending downgrade (call after meeting ends).
   */
  applyPendingDowngrade(): void {
    if (!this.pendingDowngrade) return;
    this.pendingDowngrade = false;
    const status = this.verifier.getStatus();
    this.reconcileState(status, 'manual');
    console.log('[LicenseSyncManager] Pending downgrade applied after meeting end');
  }

  /** Returns true if a downgrade is deferred (meeting in progress). */
  hasPendingDowngrade(): boolean {
    return this.pendingDowngrade;
  }

  /**
   * Get the single authoritative license state snapshot.
   * This is what the renderer consumes — it NEVER computes state itself.
   * Every property is frozen to prevent mutation across the IPC boundary.
   */
  getState(): LicenseSyncState {
    const status = this.verifier.getStatus();
    const offlineGraceRemaining = this.calculateOfflineGraceRemaining(status);
    const capabilities = Object.freeze(status.features.slice());
    const features = Object.freeze(status.features.slice());

    return Object.freeze({
      status: this.currentState,
      capabilities,
      tier: this.verifier.getPlanTier(),
      lastSync: status.lastSuccessfulSyncAt || null,
      nextSync: this.getNextSyncTime(),
      offlineGraceRemaining,
      syncInProgress: this.syncInProgress,
      serverReachable: this.serverReachable,
      plan: status.plan,
      isPremium: status.isPremium,
      trial: status.trial,
      features,
      expiresAt: status.expiresAt,
      graceUntil: status.graceUntil,
    });
  }

  /**
   * Trigger an immediate sync (called by IPC handlers, system events, etc.)
   */
  async triggerSync(reason: SyncReason): Promise<LicenseSyncState> {
    if (this.currentState === 'TAMPERED') {
      // Tampered state: force online verification attempt anyway
      this.telemetry.record('tamper', this.previousTier);
    }

    if (this.syncInProgress) {
      // Prevent concurrent syncs — return current state
      return this.getState();
    }

    this.syncInProgress = true;
    this.emitEvent('license:sync_started');

    const syncStartMs = Date.now();

    try {
      const status = await this.verifier.sync(reason);
      this.syncInProgress = false;
      this.serverReachable = true;
      this.consecutiveFailures = 0;

      // Upload batched telemetry on successful sync
      this.uploadTelemetry();

      this.emitEvent('license:sync_completed');
      this.reconcileState(status, reason);

      // Reset backoff and schedule next sync
      this.scheduleNextSync();

      return this.getState();
    } catch (error: any) {
      this.syncInProgress = false;
      this.serverReachable = false;
      this.consecutiveFailures++;

      this.telemetry.record('sync_failure', this.previousTier, Date.now() - syncStartMs);
      this.emitEvent('license:sync_failed');

      // Schedule next sync with backoff
      this.scheduleNextSync();

      return this.getState();
    }
  }

  /** Expose current state for testing. */
  getCurrentState(): LicenseState {
    return this.currentState;
  }

  /** Expose the verifier for direct access in IPC handlers. */
  getVerifier(): EntitlementVerifier {
    return this.verifier;
  }

  // ── Private: State Machine ─────────────────────────────────────────────────

  private reconcileState(status: EntitlementStatus, _reason?: SyncReason): void {
    const newState = this.deriveState(status);
    const newTier = this.verifier.getPlanTier();
    const previousState = this.currentState;

    // Graceful downgrade: if transitioning to a lower state while meeting is active,
    // defer the downgrade until the meeting ends.
    // This prevents interrupting an active meeting when a license expires mid-session.
    if (
      this.isMeetingActiveCallback?.() &&
      this.isDowngrade(previousState, newState)
    ) {
      this.pendingDowngrade = true;
      console.log('[LicenseSyncManager] Downgrade deferred — meeting in progress');
      return;
    }

    if (newState !== previousState) {
      this.currentState = newState;
      this.emitEvent('license:state_changed');

      // Emit specific transition events for targeted subscriber responses
      if (newState === 'EXPIRED' && previousState === 'ACTIVE') {
        this.emitEvent('license:expired');
        this.telemetry.record('downgrade', newTier);
      }
      if (newState === 'REVOKED') {
        this.emitEvent('license:revoked');
        this.telemetry.record('revocation', newTier);
      }
      if (newState === 'OFFLINE_GRACE' && previousState === 'ACTIVE') {
        this.emitEvent('license:offline_grace_started');
        this.telemetry.record('offline_grace_started', newTier);
      }
      if (newState === 'EXPIRED' && previousState === 'OFFLINE_GRACE') {
        this.emitEvent('license:offline_grace_expired');
        this.telemetry.record('offline_grace_expired', newTier);
      }
      if (newState === 'TAMPERED') {
        this.emitEvent('license:tampered');
        this.telemetry.record('tamper', newTier);
      }
    }

    if (newTier !== this.previousTier) {
      this.emitEvent('license:tier_changed');
      this.previousTier = newTier;
    }

    this.broadcastState();
  }

  private deriveState(status: EntitlementStatus): LicenseState {
    if (this.tamperDetector.getStatus() === 'tampered') return 'TAMPERED';

    switch (status.status) {
      case 'active': return 'ACTIVE';
      case 'free': return 'FREE';
      case 'offline_grace': return 'OFFLINE_GRACE';
      case 'expired': return 'EXPIRED';
      case 'revoked': return 'REVOKED';
      case 'invalid_signature':
      case 'device_mismatch':
      case 'sync_required':
        return 'INVALID';
      case 'clock_rollback':
        this.telemetry.record('clock_rollback', this.previousTier);
        return 'INVALID';
      case 'tampered':
        return 'TAMPERED';
      default:
        return 'FREE';
    }
  }

  private isDowngrade(from: LicenseState, to: LicenseState): boolean {
    const hierarchy: Record<LicenseState, number> = {
      TAMPERED: 0,
      INVALID: 0,
      REVOKED: 0,
      EXPIRED: 1,
      FREE: 2,
      OFFLINE_GRACE: 3,
      ACTIVATING: 4,
      ACTIVE: 5,
    };
    return (hierarchy[to] ?? 0) < (hierarchy[from] ?? 0);
  }

  // ── Private: Sync Scheduling with Backoff ──────────────────────────────────

  private scheduleNextSync(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    const backoffIndex = Math.min(this.consecutiveFailures, BACKOFF_SCHEDULE_MINUTES.length - 1);
    const intervalMinutes = BACKOFF_SCHEDULE_MINUTES[backoffIndex];
    const intervalMs = intervalMinutes * 60 * 1000;

    this.syncTimer = setTimeout(() => {
      this.triggerSync('background').catch(err => {
        console.warn('[LicenseSyncManager] Background sync failed:', err?.message || err);
      });
    }, intervalMs);

    // Allow process to exit cleanly
    this.syncTimer.unref?.();
  }

  private getNextSyncTime(): string | null {
    if (!this.syncTimer) return null;
    const backoffIndex = Math.min(this.consecutiveFailures, BACKOFF_SCHEDULE_MINUTES.length - 1);
    const intervalMinutes = BACKOFF_SCHEDULE_MINUTES[backoffIndex];
    return new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString();
  }

  // ── Private: System Event Listeners ────────────────────────────────────────

  private registerSystemListeners(): void {
    // Sleep/wake: sync immediately after system resume
    try {
      powerMonitor.on('resume', () => {
        console.log('[LicenseSyncManager] System resumed from sleep, triggering sync');
        this.triggerSync('sleep_wake').catch(() => {});
      });

      // Screen unlock: sync as a proxy for user returning after inactivity
      powerMonitor.on('unlock-screen', () => {
        this.triggerSync('focus').catch(() => {});
      });
    } catch {
      // powerMonitor may not be available in test environments
    }

    // Window focus after inactivity (10 minutes)
    // This is handled via IPC from the renderer — see ipcHandlers.ts
    this.lastFocusAt = Date.now();
  }

  /**
   * Called by IPC when the renderer reports window focus.
   * Syncs only if the window was inactive for > 10 minutes.
   */
  handleWindowFocus(): void {
    const now = Date.now();
    if (now - this.lastFocusAt > FOCUS_INACTIVITY_THRESHOLD_MS) {
      console.log('[LicenseSyncManager] Window focused after inactivity, triggering sync');
      this.triggerSync('focus').catch(() => {});
    }
    this.lastFocusAt = now;
  }

  /**
   * Called by IPC when the renderer reports internet connectivity restored.
   */
  handleOnline(): void {
    console.log('[LicenseSyncManager] Internet reconnected, triggering sync');
    this.triggerSync('online').catch(() => {});
  }

  // ── Private: Telemetry Upload ──────────────────────────────────────────────

  /**
   * Drain the telemetry ring buffer and upload a limited batch during sync.
   * Any events beyond TELEMETRY_BATCH_LIMIT are restored to the buffer for
   * the next sync cycle. This prevents oversized payloads while ensuring
   * all events are eventually uploaded.
   */
  private uploadTelemetry(): void {
    const events = this.telemetry.drain();
    if (events.length === 0) return;

    // Take at most TELEMETRY_BATCH_LIMIT events per sync
    const batch = events.slice(0, TELEMETRY_BATCH_LIMIT);
    const overflow = events.slice(TELEMETRY_BATCH_LIMIT);

    // Restore overflow events to the buffer for the next sync
    if (overflow.length > 0) {
      this.telemetry.restore(overflow);
    }

    // Telemetry is local-only for now — ready for server upload integration.
    // When server upload is enabled:
    //   try { await uploadToServer(batch); }
    //   catch { this.telemetry.restore(batch); }
    console.log(
      `[LicenseSyncManager] Telemetry: ${batch.length} events processed` +
      (overflow.length > 0 ? `, ${overflow.length} deferred to next sync` : '')
    );
  }

  // ── Private: Offline Grace Calculation ─────────────────────────────────────

  private calculateOfflineGraceRemaining(status: EntitlementStatus): number {
    if (status.status !== 'offline_grace' || !status.graceUntil) return -1;
    const graceUntilMs = Date.parse(status.graceUntil);
    const nowMs = Date.now();
    return Math.max(0, graceUntilMs - nowMs);
  }

  // ── Private: Broadcast ─────────────────────────────────────────────────────

  private broadcastState(): void {
    const state = this.getState();
    try {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send('license:state', state);
        }
      });
    } catch {
      // BrowserWindow may not be available during early bootstrap or tests
    }
  }

  private emitEvent(event: LicenseEventType): void {
    const state = this.getState();
    this.emit(event, state);
    // Also broadcast to renderer via IPC
    try {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
          win.webContents.send(event, state);
        }
      });
    } catch {
      // BrowserWindow may not be available during early bootstrap or tests
    }
  }

  /**
   * Stop all background operations. Call on app quit.
   */
  shutdown(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.verifier.stopBackgroundSync();
    this.removeAllListeners();
  }
}
