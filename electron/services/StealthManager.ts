/**
 * StealthManager — Hardened Advanced Stealth Mode
 *
 * Consolidates all stealth, disguise, and undetectability logic into a single
 * service with OS-level hardening for macOS and Windows.
 *
 * Layers (applied cumulatively when `advancedStealth` is enabled):
 *
 *   L0  Process Identity   — argv[0] mask, process.title watchdog, env scrub
 *   L1  Window Surface     — contentProtection, windowSharingType, AX suppression
 *   L2  OS Integration     — dock/tray/Mission Control/Exposé hiding
 *   L3  Event Blocking     — Apple Events suppression, Accessibility API evasion
 *   L4  Metadata Hygiene   — app naming, crash metadata, production-safe logs
 *   L5  Resilience         — startup recovery, lifecycle reassertion, clean revert
 *   L6  Platform Parity    — small OS adapters around official Electron APIs
 *
 * Usage:
 *   StealthManager.getInstance().engage()   — enable advanced stealth
 *   StealthManager.getInstance().disengage() — revert to normal
 */

import { app, BrowserWindow, powerMonitor, screen } from 'electron';
import type { EventEmitter } from 'events';
import { SettingsManager } from './SettingsManager';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type StealthLevel = 'off' | 'basic' | 'advanced';

export interface StealthState {
  level: StealthLevel;
  processDisguised: boolean;
  windowsProtected: boolean;
  dockHidden: boolean;
  eventsBlocked: boolean;
  watchdogActive: boolean;
  /** Platform-specific warnings about stealth limitations (e.g. no capture protection on Linux) */
  platformWarnings: string[];
}

export interface StealthConfig {
  /** Current stealth level */
  level: StealthLevel;
  /** Target process name shown in Activity Monitor */
  processName: string;
  /** Whether to scrub Electron-identifying environment variables */
  scrubEnvironment: boolean;
  /** Whether to block Apple Events process enumeration */
  blockAppleEvents: boolean;
  /** Whether to suppress crash reporter metadata */
  suppressCrashReporter: boolean;
  /** How frequently (ms) the watchdog reasserts process identity */
  watchdogIntervalMs: number;
  /** Whether to hide windows from screen capture APIs */
  hideFromScreenCapture: boolean;
  /** Whether to exclude from Mission Control / Exposé */
  excludeFromMissionControl: boolean;
}

type StealthPlatformName = 'darwin' | 'win32' | 'linux';

type StealthPlatformAdapter = {
  readonly name: StealthPlatformName;
  applyOSVisibility: () => void;
  revertOSVisibility: () => void;
  applyOSVisibilityToWindow: (win: BrowserWindow) => void;
  reassertAfterLifecycle: (reason: string) => void;
};

// ─── Default Configuration ──────────────────────────────────────────────────────

const DEFAULT_CONFIG: StealthConfig = {
  level: 'off',
  processName: 'Photos Launcher Service',
  scrubEnvironment: true,
  blockAppleEvents: true,
  suppressCrashReporter: true,
  watchdogIntervalMs: 1500,
  hideFromScreenCapture: true,
  excludeFromMissionControl: true,
};

// Environment variables that identify Electron processes
const ELECTRON_ENV_FINGERPRINTS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'ELECTRON_FORCE_WINDOW_MENU_BAR',
  'ELECTRON_DEFAULT_ERROR_MODE',
  'ELECTRON_TRASH',
  'ELECTRON_RELAUNCH',
  'ELECTRON_IS_DEV',
  'GOOGLE_API_KEY',       // Electron injects this
  'ORIGINAL_XDG_CURRENT_DESKTOP',
];

// ─── Singleton ──────────────────────────────────────────────────────────────────

export class StealthManager {
  private static instance: StealthManager | null = null;

  private config: StealthConfig;
  private _engaged: boolean = false;
  private _transitioning: boolean = false; // Re-entrancy guard
  private _watchdogTimer: NodeJS.Timeout | null = null;
  private _originalProcessTitle: string;
  private _originalArgv0: string;
  private _originalAppName: string;
  private _scrubbedEnvKeys: string[] = [];
  private _scrubbedEnvBackup: Record<string, string> = {};
  private _platformAdapter: StealthPlatformAdapter;
  private _windowsHiddenFromTaskbar: Set<number> = new Set();
  private _lifecycleHandlers: Array<{ target: EventEmitter; event: string; handler: (...args: any[]) => void }> = [];
  private _reassertTimer: NodeJS.Timeout | null = null;
  /** Timestamp of the last engage() call — used to suppress spurious L6 window-focus events
   *  that fire as a side-effect of dock.hide() → focus() during the engagement sequence. */
  private _engageTimestamp: number = 0;
  /** Tracked Apple Event handlers so they can be removed on disengage */
  private _appleEventHandlers: Array<{ event: string; handler: (...args: any[]) => void }> = [];
  /** Tracked browser-window-created handler for cleanup */
  private _windowCreatedHandler: ((event: Electron.Event, win: BrowserWindow) => void) | null = null;

  private constructor() {
    this._originalProcessTitle = process.title;
    this._originalArgv0 = process.argv[0] || '';
    this._originalAppName = (() => { try { return app.getName(); } catch { return 'Quietly'; } })();
    this.config = { ...DEFAULT_CONFIG };
    this._platformAdapter = this._createPlatformAdapter();

    // Rehydrate persisted config — wrapped for safety on first-launch
    try {
      this._rehydrateFromSettings();
    } catch {
      // First launch or corrupted settings — use defaults
    }
  }

  public static getInstance(): StealthManager {
    if (!StealthManager.instance) {
      StealthManager.instance = new StealthManager();
    }
    return StealthManager.instance;
  }

  private _createPlatformAdapter(): StealthPlatformAdapter {
    if (process.platform === 'darwin') {
      return {
        name: 'darwin',
        applyOSVisibility: () => this._applyDarwinOSVisibility(),
        revertOSVisibility: () => this._revertDarwinOSVisibility(),
        applyOSVisibilityToWindow: (_win: BrowserWindow) => {
          // macOS dock/app-switcher visibility is app-level; per-window Mission
          // Control handling belongs to L1 window protection.
        },
        reassertAfterLifecycle: (reason: string) => {
          this._log(`L6: Reasserting macOS visibility after ${reason}`);
          // skipSetName: true — calling app.setName() repeatedly during reassertion
          // causes macOS to re-register the app identity and flash a new dock icon.
          this._applyDarwinOSVisibility({ skipSetName: true });
        },
      };
    }

    if (process.platform === 'win32') {
      return {
        name: 'win32',
        applyOSVisibility: () => this._applyWindowsOSVisibility(),
        revertOSVisibility: () => this._revertWindowsOSVisibility(),
        applyOSVisibilityToWindow: (win: BrowserWindow) => this._applyWindowsOSVisibilityToWindow(win),
        reassertAfterLifecycle: (reason: string) => {
          this._log(`L6: Reasserting Windows visibility after ${reason}`);
          this._applyWindowsOSVisibility();
        },
      };
    }

    return {
      name: 'linux',
      applyOSVisibility: () => this._log('L6: Linux OS visibility best-effort no-op'),
      revertOSVisibility: () => this._log('L6: Linux OS visibility restore no-op'),
      applyOSVisibilityToWindow: (_win: BrowserWindow) => {},
      reassertAfterLifecycle: (reason: string) => this._log(`L6: Linux lifecycle reassert no-op after ${reason}`),
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Engage advanced stealth mode — applies all hardening layers.
   * Idempotent: calling twice is a no-op.
   */
  public engage(): void {
    if (this._engaged || this._transitioning) {
      return;
    }
    this._transitioning = true;

    this._log('▶ Engaging advanced stealth mode');

    // Record timestamp so _scheduleLifecycleReassert() can suppress
    // spurious window-focus events that fire during the engage sequence.
    this._engageTimestamp = Date.now();

    // Set flag BEFORE applying layers so protectWindow() works for
    // windows created during the engage sequence.
    this._engaged = true;
    this.config.level = 'advanced';

    try {
      // L0: Process Identity
      this._applyProcessDisguise();
      this._startWatchdog();

      // L0.5: Environment Scrubbing
      if (this.config.scrubEnvironment) {
        this._scrubEnvironment();
      }

      // L1: Window Surface Protection
      this._applyWindowProtection();
      this._registerWindowCreatedListener();

      // L2: OS Integration Hiding
      this._applyOSHiding();

      // L2.5: Spotlight / LaunchServices Suppression
      try { this._suppressSpotlightAndLaunchServices(); } catch (e) { this._warn('L2.5: Spotlight/LS suppression error:', e); }

      // L3: Event Blocking (macOS only)
      if (this.config.blockAppleEvents && process.platform === 'darwin') {
        this._blockAppleEvents();
      }

      // L4: Forensic Cleanup
      if (this.config.suppressCrashReporter) {
        this._suppressCrashReporter();
      }

      // L5: Resilience / recovery
      this._registerLifecycleRecoveryListeners();
      this._markRuntimeEngaged();

      // Persist
      this._persistToSettings();

      this._log('✅ Advanced stealth engaged');
    } catch (e) {
      // If any layer throws, roll back to prevent half-engaged state
      this._error('⚠ Engage failed, rolling back:', e);
      this._transitioning = false; // Allow disengage to proceed
      try { this.disengage(); } catch { /* best-effort */ }
    } finally {
      this._transitioning = false;
    }
  }

  /**
   * Disengage stealth — reverts all layers back to default.
   */
  public disengage(): void {
    if (!this._engaged) {
      return;
    }
    if (this._transitioning) {
      // Re-entry during rollback — just flip flag and return
      this._engaged = false;
      this.config.level = 'off';
      this._clearRuntimeMarker();
      return;
    }
    this._transitioning = true;

    this._log('◀ Disengaging stealth mode');

    // Stop watchdog first to prevent re-application during revert
    this._stopWatchdog();
    this._removeLifecycleRecoveryListeners();

    // Remove dynamic window listener
    this._removeWindowCreatedListener();

    // Each revert is independently try-caught so a failure in one layer
    // does not prevent the remaining layers from being reverted.
    try { this._revertProcessDisguise(); } catch (e) {
      this._warn('L0 revert error:', e);
    }
    try { this._restoreEnvironment(); } catch (e) {
      this._warn('L0.5 revert error:', e);
    }
    try { this._revertWindowProtection(); } catch (e) {
      this._warn('L1 revert error:', e);
    }
    try { this._revertOSHiding(); } catch (e) {
      this._warn('L2 revert error:', e);
    }
    try { this._restoreSpotlightAndLaunchServices(); } catch (e) {
      this._warn('L2.5 revert error:', e);
    }
    try { this._unblockAppleEvents(); } catch (e) {
      this._warn('L3 revert error:', e);
    }
    try { this._restoreCrashReporter(); } catch (e) {
      this._warn('L4 revert error:', e);
    }

    this._engaged = false;
    this.config.level = 'off';
    this._transitioning = false;
    this._clearRuntimeMarker();
    this._persistToSettings();

    this._log('✅ Stealth disengaged — normal mode restored');
  }

  /**
   * Returns the current stealth state for UI/diagnostics.
   */
  public getState(): StealthState {
    const warnings: string[] = [];
    if (process.platform === 'linux') {
      warnings.push('Screen capture protection is not available on Linux. Your window may be visible during screen shares.');
    }
    if (process.platform === 'win32') {
      const osRelease = require('os').release();
      const build = parseInt(osRelease.split('.')[2], 10) || 0;
      if (build < 19041) { // Windows 10 2004 = build 19041
        warnings.push('Screen capture protection requires Windows 10 version 2004 or later. Your current version may not fully protect the window.');
      }
    }
    if (process.platform === 'darwin') {
      const osRelease = require('os').release();
      const majorKernel = parseInt(osRelease.split('.')[0], 10) || 0;
      if (majorKernel >= 22) { // macOS Ventura = Darwin 22
        warnings.push('Stage Manager may still show the overlay in its sidebar. Consider disabling Stage Manager during sensitive sessions.');
      }
    }
    return {
      level: this.config.level,
      processDisguised: this._engaged,
      windowsProtected: this._engaged && this.config.hideFromScreenCapture,
      dockHidden: this._engaged,
      eventsBlocked: this._engaged && this.config.blockAppleEvents,
      watchdogActive: this._watchdogTimer !== null,
      platformWarnings: warnings,
    };
  }

  /**
   * Returns the full configuration (for settings UI).
   */
  public getConfig(): Readonly<StealthConfig> {
    return { ...this.config };
  }

  /**
   * Update configuration. Automatically re-applies if currently engaged.
   */
  public updateConfig(patch: Partial<StealthConfig>): void {
    // Validate watchdog interval — prevent runaway timers
    if (patch.watchdogIntervalMs !== undefined) {
      patch.watchdogIntervalMs = Math.max(1000, Math.min(30000, patch.watchdogIntervalMs));
    }
    // Sanitise process name — prevent empty string
    if (patch.processName !== undefined) {
      patch.processName = (patch.processName || '').trim() || DEFAULT_CONFIG.processName;
    }

    const wasEngaged = this._engaged;

    // If changing level, handle engage/disengage
    if (patch.level !== undefined && patch.level !== this.config.level) {
      if (wasEngaged) this.disengage();
      Object.assign(this.config, patch);
      if (patch.level === 'advanced') {
        this.engage();
      } else if (patch.level === 'basic') {
        // Basic: only process disguise + content protection, no OS-level hiding
        this._applyProcessDisguise();
        this._applyWindowProtection();
        this._persistToSettings();
      }
      return;
    }

    Object.assign(this.config, patch);
    this._persistToSettings();

    // Hot-reload if engaged
    if (wasEngaged) {
      this.disengage();
      this.engage();
    }
  }

  /**
   * Returns whether advanced stealth is currently active.
   */
  public isEngaged(): boolean {
    return this._engaged;
  }

  /**
   * Force-reassert the process identity right now (useful after app.setName calls).
   */
  public reassertIdentity(): void {
    if (!this._engaged) return;
    this._applyProcessDisguise();
  }

  /**
   * L5 startup recovery: called once after boot windows exist.
   * If stealth is still enabled in user settings, re-engage from a clean runtime.
   * If not, clear any stale runtime marker left by a crash/force-quit.
   */
  public recoverStartupState(shouldEngage: boolean): void {
    const hadStaleRuntime = this._consumeRuntimeMarker();

    if (shouldEngage) {
      if (hadStaleRuntime) {
        this._log('L5: Stale stealth runtime detected; re-engaging from fresh process state');
      }
      this.engage();
      return;
    }

    if (hadStaleRuntime) {
      this._log('L5: Stale stealth runtime detected; forcing visible baseline');
      this.forceRestore();
    }
  }

  /**
   * Best-effort visible baseline restore. Safe to call even if engage() was not
   * reached in this process, which is important after a bad previous shutdown.
   */
  public forceRestore(): void {
    this._stopWatchdog();
    this._removeLifecycleRecoveryListeners();
    this._removeWindowCreatedListener();
    try { this._revertProcessDisguise(); } catch (e) { this._warn('L0 force restore error:', e); }
    try { this._restoreEnvironment(); } catch (e) { this._warn('L0.5 force restore error:', e); }
    try { this._revertWindowProtection(); } catch (e) { this._warn('L1 force restore error:', e); }
    try { this._revertOSHiding(); } catch (e) { this._warn('L2 force restore error:', e); }
    try { this._unblockAppleEvents(); } catch (e) { this._warn('L3 force restore error:', e); }
    try { this._restoreCrashReporter(); } catch (e) { this._warn('L4 force restore error:', e); }
    this._engaged = false;
    this._transitioning = false;
    this.config.level = 'off';
    this._clearRuntimeMarker();
    this._persistToSettings();
  }

  private _isVerboseLoggingEnabled(): boolean {
    if (process.env.NODE_ENV !== 'production') return true;
    try {
      return SettingsManager.getInstance().get('verboseLogging') === true;
    } catch {
      return false;
    }
  }

  private _log(message: string, ...args: unknown[]): void {
    if (this._isVerboseLoggingEnabled()) {
      console.log(`[StealthManager] ${message}`, ...args);
    }
  }

  private _warn(message: string, ...args: unknown[]): void {
    if (this._isVerboseLoggingEnabled()) {
      console.warn(`[StealthManager] ${message}`, ...args);
    }
  }

  private _error(message: string, ...args: unknown[]): void {
    console.error(`[StealthManager] ${message}`, ...args);
  }

  // ─── L0: Process Identity ─────────────────────────────────────────────────

  private _applyProcessDisguise(options?: { skipLsAppInfo?: boolean }): void {
    const targetName = this.config.processName;

    // 1. Override process.title (this is what Activity Monitor reads on macOS)
    process.title = targetName;

    // 2. Mask argv[0] — some monitoring tools read this
    try {
      process.argv[0] = this._getSystemBinaryPath(targetName);
    } catch {
      // argv[0] may be read-only in some runtimes — silently skip
    }

    // 3. Override CFBundleName environment variable (macOS process listing)
    if (process.platform === 'darwin') {
      process.env.CFBundleName = targetName.trim();
      // Also set the __CFBundleIdentifier to match a known system app
      process.env.__CFBundleIdentifier = this._getSystemBundleId(targetName);
    }

    // 4. On Windows, update the App User Model ID
    if (process.platform === 'win32') {
      try {
        app.setAppUserModelId(this._getWindowsAumid(targetName));
      } catch (e) {
        this._warn('Failed to set AUMID:', e);
      }
    }

    // 5. Override app name in LaunchServices (what lsappinfo reports)
    // Skip during L6 reassertion — the shell command is expensive and only
    // needs to run once during initial engage().
    if (process.platform === 'darwin' && !options?.skipLsAppInfo) {
      try {
        const { execSync } = require('child_process');
        execSync(`lsappinfo setinfo -app "${this._originalProcessTitle}" --name "${targetName}" 2>/dev/null || true`, { stdio: 'pipe', timeout: 2000 });
      } catch { /* lsappinfo may fail on older macOS or under SIP restrictions */ }
    }

    this._log(`L0: Process disguised as "${targetName}"`);
  }

  private _revertProcessDisguise(): void {
    process.title = this._originalProcessTitle;

    try {
      process.argv[0] = this._originalArgv0;
    } catch {
      // Read-only in some runtimes
    }

    if (process.platform === 'darwin') {
      delete process.env.CFBundleName;
      delete process.env.__CFBundleIdentifier;
    }

    if (process.platform === 'win32') {
      try {
        app.setAppUserModelId('com.quietly.app');
      } catch { /* ignore */ }
    }

    this._log('L0: Process identity reverted');
  }

  /**
   * Watchdog timer that periodically reasserts process.title.
   * macOS can reset it after certain system events (sleep/wake, app activate).
   */
  private _startWatchdog(): void {
    this._stopWatchdog();

    const targetName = this.config.processName;
    this._watchdogTimer = setInterval(() => {
      if (process.title !== targetName) {
        process.title = targetName;
      }

      // Also reassert CFBundleName in case a framework reset it
      if (process.platform === 'darwin' && process.env.CFBundleName !== targetName.trim()) {
        process.env.CFBundleName = targetName.trim();
      }

      if (process.platform === 'win32') {
        try {
          app.setAppUserModelId(this._getWindowsAumid(targetName));
        } catch { /* best-effort */ }
        // Reassert app name — can drift after window focus changes
        try { app.setName(targetName); } catch { /* best-effort */ }
        // Reassert window titles — Task Manager shows these in the Apps tab
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed() && win.getTitle() !== targetName) {
            try { win.setTitle(targetName); } catch { /* best-effort */ }
          }
        }
      }
    }, this.config.watchdogIntervalMs);

    // Prevent the timer from keeping the process alive during shutdown
    if (this._watchdogTimer.unref) {
      this._watchdogTimer.unref();
    }

    this._log(`L0: Watchdog started (${this.config.watchdogIntervalMs}ms interval)`);
  }

  private _stopWatchdog(): void {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }

  // ─── L0.5: Environment Scrubbing ─────────────────────────────────────────

  private _scrubEnvironment(): void {
    this._scrubbedEnvKeys = [];
    this._scrubbedEnvBackup = {};

    for (const key of ELECTRON_ENV_FINGERPRINTS) {
      if (key in process.env) {
        this._scrubbedEnvBackup[key] = process.env[key]!;
        delete process.env[key];
        this._scrubbedEnvKeys.push(key);
      }
    }

    // Also remove any env var that contains "electron" (case-insensitive)
    // but skip PATH, HOME, and other critical system vars
    const SAFE_VARS = new Set(['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM', 'TMPDIR', 'DISPLAY', 'XDG_RUNTIME_DIR', 'NODE_ENV']);
    for (const [key, value] of Object.entries(process.env)) {
      if (SAFE_VARS.has(key)) continue;
      if (key.toLowerCase().includes('electron') && !(key in this._scrubbedEnvBackup)) {
        this._scrubbedEnvBackup[key] = value!;
        delete process.env[key];
        this._scrubbedEnvKeys.push(key);
      }
    }

    if (this._scrubbedEnvKeys.length > 0) {
      this._log(`L0.5: Scrubbed ${this._scrubbedEnvKeys.length} fingerprint env vars`);
    }
  }

  private _restoreEnvironment(): void {
    for (const key of this._scrubbedEnvKeys) {
      if (key in this._scrubbedEnvBackup) {
        process.env[key] = this._scrubbedEnvBackup[key];
      }
    }
    this._scrubbedEnvKeys = [];
    this._scrubbedEnvBackup = {};
  }

  // ─── L1: Window Surface Protection ───────────────────────────────────────

  private _applyWindowProtection(): void {
    const allWindows = BrowserWindow.getAllWindows();
    let hardened = 0;

    for (const win of allWindows) {
      if (win.isDestroyed()) continue;

      if (this._applyWindowProtectionToWindow(win)) hardened++;
    }

    this._log(`L1: ${hardened}/${allWindows.length} windows hardened`);
  }

  private _applyWindowProtectionToWindow(win: BrowserWindow): boolean {
    try {
      // Content protection — prevents screen capture from recording the window.
      win.setContentProtection(true);
    } catch (e) {
      this._warn('L1: setContentProtection failed for window:', e);
      return false;
    }

    // F-003: Immediately set the disguised window title so new windows created
    // during stealth don't leak the real app name in Task Manager (Windows) or
    // Activity Monitor (macOS) during the gap before the watchdog fires.
    if (this._engaged) {
      try {
        const targetTitle = this.config.processName;
        if (win.getTitle() !== targetTitle) {
          win.setTitle(targetTitle);
        }
      } catch { /* best-effort — title API may not be ready yet */ }
    }

    if (process.platform === 'darwin') {
      // Hide from Mission Control / Exposé.
      try {
        if (typeof (win as any).setHiddenInMissionControl === 'function') {
          win.setHiddenInMissionControl(true);
        }
      } catch { /* Older Electron — skip */ }

      // Only apply z-order and workspace changes if NOT already set.
      // Re-applying these during L6 reassertion causes z-order fighting
      // between the overlay and settings popup, producing a visible glitch.
      try {
        if (!win.isVisibleOnAllWorkspaces()) {
          win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        }
      } catch { /* ignore */ }

      try {
        win.setSkipTaskbar(true);
        if (!win.isAlwaysOnTop()) {
          win.setAlwaysOnTop(true, 'floating');
        }
      } catch { /* ignore */ }
    }

    return true;
  }

  private _revertWindowProtection(): void {
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (win.isDestroyed()) continue;

      try { win.setContentProtection(false); } catch { /* ignore */ }

      if (process.platform === 'darwin') {
        try {
          if (typeof (win as any).setHiddenInMissionControl === 'function') {
            win.setHiddenInMissionControl(false);
          }
        } catch { /* ignore */ }
      }
    }

    this._log('L1: Window protection reverted');
  }

  /**
   * Apply protection to a newly-created window.
   * Call this from WindowHelper after creating any new BrowserWindow.
   */
  public protectWindow(win: BrowserWindow): void {
    if (!this._engaged) return;
    if (!win || win.isDestroyed()) return;

    if (!this._applyWindowProtectionToWindow(win)) return;
    this._platformAdapter.applyOSVisibilityToWindow(win);
  }

  // ─── Dynamic Window Listener ─────────────────────────────────────────────

  /**
   * Registers a single `browser-window-created` listener that auto-protects
   * any new BrowserWindow created while stealth is engaged.
   * The handler is tracked so it can be removed cleanly on disengage.
   */
  private _registerWindowCreatedListener(): void {
    // Prevent duplicate registration
    this._removeWindowCreatedListener();

    this._windowCreatedHandler = (_event: Electron.Event, win: BrowserWindow) => {
      // Apply content protection IMMEDIATELY — no gap.
      // setContentProtection works even before the window is fully ready.
      if (this._engaged && win && !win.isDestroyed()) {
        try { win.setContentProtection(true); } catch { /* window not ready — covered by retry below */ }
      }
      // Follow-up: apply full protection (Mission Control hiding, workspace
      // visibility) after Electron finishes window setup.  50 ms is enough
      // and halves the previous 100 ms delay.
      setTimeout(() => {
        if (this._engaged && win && !win.isDestroyed()) {
          this.protectWindow(win);
        }
      }, 50);
    };

    app.on('browser-window-created', this._windowCreatedHandler);
  }

  private _removeWindowCreatedListener(): void {
    if (this._windowCreatedHandler) {
      try {
        app.removeListener('browser-window-created', this._windowCreatedHandler);
      } catch { /* ignore */ }
      this._windowCreatedHandler = null;
    }
  }

  // ─── L2: OS Integration Hiding ───────────────────────────────────────────

  private _applyOSHiding(): void {
    this._platformAdapter.applyOSVisibility();
  }

  private _revertOSHiding(): void {
    this._platformAdapter.revertOSVisibility();
    this._log('L2: OS integration restored');
  }

  private _applyDarwinOSVisibility(options?: { skipSetName?: boolean }): void {
    try {
      if (app.dock && typeof app.dock.hide === 'function') {
        app.dock.hide();
      }
    } catch (e) {
      this._warn('L2: dock.hide() failed:', e);
    }

    // Skip app.setName() during L6 reassertion — calling it repeatedly
    // causes macOS to re-register the app identity, which flashes a new
    // dock icon and defeats the purpose of undetectable mode.
    if (!options?.skipSetName) {
      try {
        app.setName(this.config.processName);
      } catch (e) {
        this._warn('L2: setName() failed:', e);
      }
    }

    this._log('L2: OS integration hidden (darwin)');
  }

  // ─── L2.5: Spotlight / LaunchServices Suppression ───────────────────────

  /**
   * Suppresses the app from Spotlight indexing and removes it from the
   * LaunchServices database.  This prevents `mdfind`, `lsappinfo list`,
   * and Spotlight searches from revealing the app's real identity.
   */
  private _suppressSpotlightAndLaunchServices(): void {
    if (process.platform === 'darwin') {
      this._suppressDarwinSpotlightAndLS();
    } else if (process.platform === 'win32') {
      this._suppressWindowsSearchAndRegistry();
    }
  }

  /**
   * macOS: Suppress Spotlight indexing and unregister from LaunchServices.
   */
  private _suppressDarwinSpotlightAndLS(): void {
    const appBundlePath = this._findAppBundlePath();
    if (!appBundlePath) {
      this._warn('L2.5: Could not locate .app bundle path');
      return;
    }

    // 1. Place .metadata_never_index inside the .app to prevent Spotlight
    //    from indexing the bundle contents and metadata.
    try {
      const markerPath = require('path').join(appBundlePath, '.metadata_never_index');
      require('fs').writeFileSync(markerPath, '', { flag: 'w' });
      this._log('L2.5: Spotlight .metadata_never_index marker placed');
    } catch (e) {
      this._warn('L2.5: Failed to place Spotlight marker:', e);
    }

    // 2. Unregister from LaunchServices so lsappinfo doesn't list us
    //    with the original bundle identity.
    try {
      const { execSync } = require('child_process');
      execSync(
        `/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -u "${appBundlePath}" 2>/dev/null || true`,
        { stdio: 'pipe', timeout: 3000 }
      );
      this._log('L2.5: LaunchServices unregistration completed');
    } catch (e) {
      this._warn('L2.5: LaunchServices unregistration failed:', e);
    }
  }

  /**
   * Windows: Exclude install directory from Windows Search indexing and
   * rename the NSIS uninstall registry DisplayName to the disguise name.
   */
  private _suppressWindowsSearchAndRegistry(): void {
    const { execSync } = require('child_process');
    const installDir = require('path').dirname(app.getPath('exe'));

    // 1. Set NTFS NOT_CONTENT_INDEXED attribute on the install directory
    //    This prevents Windows Search / Start Menu from indexing app files.
    try {
      execSync(`attrib +I "${installDir}" /S /D 2>nul || (exit /b 0)`, { stdio: 'pipe', timeout: 5000, shell: 'cmd.exe' });
      this._log('L2.5: Windows Search indexing excluded via ATTRIB +I');
    } catch (e) {
      this._warn('L2.5: Windows Search exclusion failed:', e);
    }

    // 2. Rename the NSIS uninstall registry DisplayName to the disguise name
    //    so Add/Remove Programs doesn't reveal "TeamSync".
    try {
      const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Quietly';
      const disguiseName = this.config.processName;
      execSync(`reg add "${regPath}" /v DisplayName /t REG_SZ /d "${disguiseName}" /f 2>nul || (exit /b 0)`, { stdio: 'pipe', timeout: 3000, shell: 'cmd.exe' });
      this._log(`L2.5: NSIS DisplayName overridden to "${disguiseName}"`);
    } catch (e) {
      this._warn('L2.5: Registry DisplayName override failed:', e);
    }
  }

  private _restoreSpotlightAndLaunchServices(): void {
    if (process.platform === 'darwin') {
      this._restoreDarwinSpotlightAndLS();
    } else if (process.platform === 'win32') {
      this._restoreWindowsSearchAndRegistry();
    }
  }

  private _restoreDarwinSpotlightAndLS(): void {
    const appBundlePath = this._findAppBundlePath();
    if (!appBundlePath) return;

    // Remove the .metadata_never_index marker
    try {
      const markerPath = require('path').join(appBundlePath, '.metadata_never_index');
      if (require('fs').existsSync(markerPath)) {
        require('fs').unlinkSync(markerPath);
      }
    } catch { /* ignore */ }

    // Re-register with LaunchServices
    try {
      const { execSync } = require('child_process');
      execSync(
        `/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister "${appBundlePath}" 2>/dev/null || true`,
        { stdio: 'pipe', timeout: 3000 }
      );
    } catch { /* ignore */ }

    this._log('L2.5: Spotlight/LaunchServices restored');
  }

  private _restoreWindowsSearchAndRegistry(): void {
    const { execSync } = require('child_process');
    const installDir = require('path').dirname(app.getPath('exe'));

    // 1. Remove NOT_CONTENT_INDEXED attribute
    try {
      execSync(`attrib -I "${installDir}" /S /D 2>nul || (exit /b 0)`, { stdio: 'pipe', timeout: 5000, shell: 'cmd.exe' });
    } catch { /* ignore */ }

    // 2. Restore NSIS DisplayName
    try {
      const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Quietly';
      execSync(`reg add "${regPath}" /v DisplayName /t REG_SZ /d "Quietly" /f 2>nul || (exit /b 0)`, { stdio: 'pipe', timeout: 3000, shell: 'cmd.exe' });
    } catch { /* ignore */ }

    this._log('L2.5: Windows Search/Registry restored');
  }

  /**
   * Walk up from app.getAppPath() to locate the .app bundle root.
   */
  private _findAppBundlePath(): string | null {
    let current = app.getAppPath();
    for (let i = 0; i < 10; i++) {
      if (current.endsWith('.app')) return current;
      const parent = require('path').dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  private _revertDarwinOSVisibility(): void {
    try {
      if (app.dock && typeof app.dock.show === 'function') {
        void app.dock.show();
      }
    } catch (e) {
      this._warn('L2: dock.show() failed:', e);
    }

    // Use the configured processName ('TeamSync') instead of _originalAppName
    // because in dev mode _originalAppName is 'Electron', which causes macOS
    // to flash a new 'Electron' dock icon on disengage.
    try {
      app.setName(this.config.processName || this._originalAppName);
    } catch (e) {
      this._warn('L2: Revert setName() failed:', e);
    }
  }

  private _applyWindowsOSVisibility(): void {
    const allWindows = BrowserWindow.getAllWindows();
    let hidden = 0;

    for (const win of allWindows) {
      if (win.isDestroyed()) continue;
      if (this._applyWindowsOSVisibilityToWindow(win)) hidden++;
    }

    // Also set app name on Windows — affects GetWindowText / Task Manager description
    try { app.setName(this.config.processName); } catch { /* best-effort */ }

    // Set all window titles to disguise name — Task Manager "Apps" tab reads these
    const disguiseName = this.config.processName;
    for (const win of allWindows) {
      if (win.isDestroyed()) continue;
      try { win.setTitle(disguiseName); } catch { /* best-effort */ }
    }

    this._log(`L2: ${hidden}/${allWindows.length} primary Windows taskbar surfaces hidden`);
  }

  private _applyWindowsOSVisibilityToWindow(win: BrowserWindow): boolean {
    if (!this._isPrimaryTaskbarWindow(win)) return false;

    try {
      win.setSkipTaskbar(true);
      this._windowsHiddenFromTaskbar.add(win.id);
      return true;
    } catch (e) {
      this._warn('L2: setSkipTaskbar(true) failed for primary window:', e);
      return false;
    }
  }

  private _revertWindowsOSVisibility(): void {
    const allWindows = BrowserWindow.getAllWindows();
    let restored = 0;

    for (const win of allWindows) {
      if (win.isDestroyed()) continue;
      if (!this._windowsHiddenFromTaskbar.has(win.id)) continue;
      try {
        win.setSkipTaskbar(false);
        restored++;
      } catch (e) {
        this._warn('L2: setSkipTaskbar(false) failed for primary window:', e);
      }
    }

    // Revert app name
    try { app.setName(this._originalAppName); } catch { /* best-effort */ }

    // Restore window titles
    for (const win of allWindows) {
      if (win.isDestroyed()) continue;
      try { win.setTitle(this._originalAppName); } catch { /* best-effort */ }
    }

    this._windowsHiddenFromTaskbar.clear();
    this._log(`L2: ${restored} Windows taskbar entries restored`);
  }

  private _isPrimaryTaskbarWindow(win: BrowserWindow): boolean {
    if (win.isDestroyed()) return false;
    if (win.isAlwaysOnTop()) return false;
    try {
      if (win.getParentWindow()) return false;
    } catch { /* ignore */ }
    return true;
  }

  // ─── L3: Event Blocking ──────────────────────────────────────────────────

  /**
   * Block Apple Events from discovering this process.
   *
   * When another app (or a proctoring tool) runs:
   *   `tell application "System Events" to get name of every process`
   * macOS sends an Apple Event to enumerate running processes.
   *
   * By refusing to handle the kAEGetURL and other introspection events,
   * we reduce the surface area. Note: this is defense-in-depth — it does NOT
   * make the process invisible to `ps` or the process table. It specifically
   * blocks GUI-level discovery via Apple Events.
   */
  private _blockAppleEvents(): void {
    if (process.platform !== 'darwin') return;

    // Clear any previously registered handlers (idempotency)
    this._removeAppleEventHandlers();

    try {
      // Block Handoff discovery which can reveal the real app identity
      const h1 = (event: Electron.Event) => { event.preventDefault(); };
      app.on('will-continue-user-activity', h1);
      this._appleEventHandlers.push({ event: 'will-continue-user-activity', handler: h1 });

      // Block Universal Clipboard / activity continuation
      const h2 = (event: Electron.Event) => { event.preventDefault(); };
      app.on('activity-was-continued', h2);
      this._appleEventHandlers.push({ event: 'activity-was-continued', handler: h2 });
    } catch (e) {
      this._warn('L3: Apple Event blocking partial:', e);
    }

    this._log('L3: Apple Events suppressed');
  }

  private _unblockAppleEvents(): void {
    if (process.platform !== 'darwin') return;
    this._removeAppleEventHandlers();
    this._log('L3: Apple Event handlers removed');
  }

  /** Remove tracked Apple Event handlers from the app emitter */
  private _removeAppleEventHandlers(): void {
    for (const { event, handler } of this._appleEventHandlers) {
      try {
        app.removeListener(event as any, handler);
      } catch { /* ignore — handler may already be gone */ }
    }
    this._appleEventHandlers = [];
  }

  // ─── L4: Forensic Cleanup ────────────────────────────────────────────────

  private _suppressCrashReporter(): void {
    try {
      // Overwrite crash reporter metadata so that if a crash dump is generated,
      // it doesn't contain the real app name or product info.
      app.setName(this.config.processName);
    } catch (e) {
      this._warn('L4: Crash reporter suppression partial:', e);
    }

    this._log('L4: Crash reporter metadata neutralised');
  }

  private _restoreCrashReporter(): void {
    try {
      app.setName(this._originalAppName);
    } catch { /* ignore */ }
  }

  // ─── L5: Resilience / Recovery ───────────────────────────────────────────

  private _registerLifecycleRecoveryListeners(): void {
    this._removeLifecycleRecoveryListeners();

    const add = (target: EventEmitter, event: string, handler: (...args: any[]) => void) => {
      target.on(event, handler);
      this._lifecycleHandlers.push({ target, event, handler });
    };

    add(powerMonitor as unknown as EventEmitter, 'resume', () => this._scheduleLifecycleReassert('resume'));
    add(powerMonitor as unknown as EventEmitter, 'unlock-screen', () => this._scheduleLifecycleReassert('unlock-screen'));
    add(screen as unknown as EventEmitter, 'display-added', () => this._scheduleLifecycleReassert('display-added'));
    add(screen as unknown as EventEmitter, 'display-removed', () => this._scheduleLifecycleReassert('display-removed'));
    add(screen as unknown as EventEmitter, 'display-metrics-changed', () => this._scheduleLifecycleReassert('display-metrics-changed'));
    add(app as unknown as EventEmitter, 'activate', () => this._scheduleLifecycleReassert('app-activate'));
    add(app as unknown as EventEmitter, 'browser-window-focus', () => this._scheduleLifecycleReassert('window-focus'));

    this._log(`L5: Recovery listeners registered (${this._lifecycleHandlers.length})`);
  }

  private _removeLifecycleRecoveryListeners(): void {
    if (this._reassertTimer) {
      clearTimeout(this._reassertTimer);
      this._reassertTimer = null;
    }

    for (const { target, event, handler } of this._lifecycleHandlers) {
      try {
        target.removeListener(event, handler);
      } catch { /* ignore */ }
    }
    this._lifecycleHandlers = [];
  }

  /** Timestamp of the last completed full L6 reassertion */
  private _lastFullReassertTimestamp: number = 0;

  // Events from user interaction — only need lightweight reassertion
  // (process.title check). No window protection re-application needed.
  private static readonly LIGHTWEIGHT_EVENTS = new Set(['window-focus', 'app-activate']);

  private _scheduleLifecycleReassert(reason: string): void {
    if (!this._engaged) return;

    // Suppress ALL lifecycle reassertion events that fire within 500ms of
    // engage(). Multiple events (window-focus, app-activate, display-metrics)
    // fire as side-effects of the dock.hide() → engage() sequence and cause
    // redundant L0/L1/L2 reassertion + dock flash on macOS.
    if ((Date.now() - this._engageTimestamp) < 500) return;

    const isLightweight = StealthManager.LIGHTWEIGHT_EVENTS.has(reason);

    if (isLightweight) {
      // Lightweight path: only reassert process identity (process.title,
      // CFBundleName). These are cheap, invisible operations.
      // Do NOT touch window protection or OS visibility — those cause
      // z-order fighting and visual glitching when the user is opening
      // settings popups, model selectors, etc.
      const targetName = this.config.processName;
      if (process.title !== targetName) {
        process.title = targetName;
      }
      if (process.platform === 'darwin' && process.env.CFBundleName !== targetName.trim()) {
        process.env.CFBundleName = targetName.trim();
      }
      return;
    }

    // Full path: system events (resume, unlock-screen, display changes)
    // need full reassertion because the OS may have reset protections.
    // Throttle to once every 5 seconds for display-metrics-changed which
    // can fire rapidly during monitor rearrangement.
    if ((Date.now() - this._lastFullReassertTimestamp) < 5000) return;

    if (this._reassertTimer) clearTimeout(this._reassertTimer);

    this._reassertTimer = setTimeout(() => {
      this._reassertTimer = null;
      if (!this._engaged) return;

      this._lastFullReassertTimestamp = Date.now();

      // Skip lsappInfo during reassertion — shell exec is expensive and
      // only needs to run once during initial engage().
      try { this._applyProcessDisguise({ skipLsAppInfo: true }); } catch (e) { this._warn(`L5: process reassert failed after ${reason}:`, e); }
      try { this._applyWindowProtection(); } catch (e) { this._warn(`L5: window reassert failed after ${reason}:`, e); }
      // F-001: Route through the platform adapter so Windows lifecycle
      // reassertion calls _applyWindowsOSVisibility() (re-applying
      // setSkipTaskbar) instead of the previous Darwin-only no-op.
      // macOS adapter passes skipSetName: true to prevent dock icon flash.
      try { this._platformAdapter.reassertAfterLifecycle(reason); } catch (e) { this._warn(`L5: OS visibility reassert failed after ${reason}:`, e); }
      this._markRuntimeEngaged();
    }, 200);

    if (this._reassertTimer.unref) {
      this._reassertTimer.unref();
    }
  }

  private _markRuntimeEngaged(): void {
    try {
      SettingsManager.getInstance().set('advancedStealthRuntime', {
        engaged: true,
        pid: process.pid,
        platform: process.platform,
        updatedAt: Date.now(),
      });
    } catch (e) {
      this._warn('L5: Failed to mark runtime state:', e);
    }
  }

  private _clearRuntimeMarker(): void {
    try {
      SettingsManager.getInstance().set('advancedStealthRuntime', {
        engaged: false,
        pid: process.pid,
        platform: process.platform,
        updatedAt: Date.now(),
      });
    } catch (e) {
      this._warn('L5: Failed to clear runtime state:', e);
    }
  }

  private _consumeRuntimeMarker(): boolean {
    try {
      const marker = SettingsManager.getInstance().get('advancedStealthRuntime');
      const stale = marker?.engaged === true && marker.pid !== process.pid;
      if (stale) this._clearRuntimeMarker();
      return stale;
    } catch {
      return false;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Returns a plausible system binary path for the given disguise name.
   * This is what shows up in `ps aux` as the command column.
   */
  private _getSystemBinaryPath(name: string): string {
    const isMac = process.platform === 'darwin';

    const pathMap: Record<string, string> = {
      'System Settings':          isMac ? '/System/Applications/System Settings.app/Contents/MacOS/System Settings' : 'SystemSettings.exe',
      'System Preferences':       isMac ? '/System/Applications/System Preferences.app/Contents/MacOS/System Preferences' : 'SystemSettings.exe',
      'Terminal':                  isMac ? '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal' : 'cmd.exe',
      'Command Prompt':            isMac ? '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal' : 'C:\\Windows\\System32\\cmd.exe',
      'Activity Monitor':          isMac ? '/System/Applications/Utilities/Activity Monitor.app/Contents/MacOS/Activity Monitor' : 'taskmgr.exe',
      'Task Manager':              isMac ? '/System/Applications/Utilities/Activity Monitor.app/Contents/MacOS/Activity Monitor' : 'C:\\Windows\\System32\\Taskmgr.exe',
      'Console':                   isMac ? '/System/Applications/Utilities/Console.app/Contents/MacOS/Console' : 'cmd.exe',
      'Notes':                     isMac ? '/System/Applications/Notes.app/Contents/MacOS/Notes' : 'notepad.exe',
      'TextEdit':                  isMac ? '/System/Applications/TextEdit.app/Contents/MacOS/TextEdit' : 'notepad.exe',
      'Settings':                  'C:\\Windows\\ImmersiveControlPanel\\SystemSettings.exe',
      'Photos Launcher Service':   isMac ? '/System/Library/PrivateFrameworks/PhotoLibraryServices.framework/Versions/A/Support/photoanalysisd' : 'C:\\Windows\\System32\\svchost.exe',
    };

    return pathMap[name.trim()] || (isMac ? '/usr/sbin/cfprefsd' : 'svchost.exe');
  }

  /**
   * Returns a plausible macOS bundle identifier for the disguise.
   */
  private _getSystemBundleId(name: string): string {
    const idMap: Record<string, string> = {
      'System Settings':          'com.apple.systempreferences',
      'System Preferences':       'com.apple.systempreferences',
      'Terminal':                  'com.apple.Terminal',
      'Command Prompt':            'com.apple.Terminal',
      'Activity Monitor':          'com.apple.ActivityMonitor',
      'Task Manager':              'com.apple.ActivityMonitor',
      'Console':                   'com.apple.Console',
      'Notes':                     'com.apple.Notes',
      'TextEdit':                  'com.apple.TextEdit',
      'Photos Launcher Service':   'com.apple.photoanalysisd',
    };

    return idMap[name.trim()] || 'com.apple.systempreferences';
  }

  /**
   * Returns a Windows AUMID for the disguise identity.
   */
  private _getWindowsAumid(name: string): string {
    const aumidMap: Record<string, string> = {
      'Command Prompt':            'Microsoft.CommandPrompt',
      'Settings':                  'windows.immersivecontrolpanel',
      'Task Manager':              'Microsoft.TaskManager',
      'Terminal':                   'Microsoft.WindowsTerminal',
      'System Settings':           'windows.immersivecontrolpanel',
      'Activity Monitor':          'Microsoft.TaskManager',
      'Photos Launcher Service':   'Microsoft.Windows.Photos',
    };

    return aumidMap[name.trim()] || 'windows.immersivecontrolpanel';
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private _persistToSettings(): void {
    try {
      const sm = SettingsManager.getInstance();
      sm.set('advancedStealth', {
        level: this.config.level,
        processName: this.config.processName,
        scrubEnvironment: this.config.scrubEnvironment,
        blockAppleEvents: this.config.blockAppleEvents,
        suppressCrashReporter: this.config.suppressCrashReporter,
        watchdogIntervalMs: this.config.watchdogIntervalMs,
        hideFromScreenCapture: this.config.hideFromScreenCapture,
        excludeFromMissionControl: this.config.excludeFromMissionControl,
      });
    } catch (e) {
      this._warn('Failed to persist config:', e);
    }
  }

  private _rehydrateFromSettings(): void {
    try {
      const sm = SettingsManager.getInstance();
      const stored = sm.get('advancedStealth') as Record<string, unknown> | undefined;
      if (stored && typeof stored === 'object') {
        // Only apply known keys with correct types to prevent config corruption
        if (typeof stored.processName === 'string' && stored.processName.trim()) {
          this.config.processName = stored.processName.trim();
        }
        if (typeof stored.scrubEnvironment === 'boolean') this.config.scrubEnvironment = stored.scrubEnvironment;
        if (typeof stored.blockAppleEvents === 'boolean') this.config.blockAppleEvents = stored.blockAppleEvents;
        if (typeof stored.suppressCrashReporter === 'boolean') this.config.suppressCrashReporter = stored.suppressCrashReporter;
        if (typeof stored.hideFromScreenCapture === 'boolean') this.config.hideFromScreenCapture = stored.hideFromScreenCapture;
        if (typeof stored.excludeFromMissionControl === 'boolean') this.config.excludeFromMissionControl = stored.excludeFromMissionControl;
        if (typeof stored.watchdogIntervalMs === 'number' && stored.watchdogIntervalMs >= 1000 && stored.watchdogIntervalMs <= 30000) {
          this.config.watchdogIntervalMs = stored.watchdogIntervalMs;
        }
        // NOTE: level is NOT restored — always starts 'off'. The user must toggle.
      }
    } catch {
      // First launch or corrupted settings — use defaults
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Call during app quit to clean up timers and restore process identity.
   * Prevents the watchdog from firing after the event loop winds down.
   */
  public destroy(): void {
    this._stopWatchdog();
    this._removeLifecycleRecoveryListeners();
    this._removeWindowCreatedListener();
    if (this._engaged) {
      // Best-effort revert — process is shutting down
      try { this._revertProcessDisguise(); } catch { /* ignore */ }
      try { this._restoreEnvironment(); } catch { /* ignore */ }
      try { this._revertWindowProtection(); } catch { /* ignore */ }
      try { this._revertOSHiding(); } catch { /* ignore */ }
      try { this._removeAppleEventHandlers(); } catch { /* ignore */ }
      try { this._restoreCrashReporter(); } catch { /* ignore */ }
      this._engaged = false;
    }
    this._clearRuntimeMarker();
    this._transitioning = false;
    StealthManager.instance = null;
  }

  // ─── DEV-ONLY: Fault Injection ───────────────────────────────────────────

  /**
   * DEV-ONLY: Simulate faults to verify rollback safety.
   * This method is stripped from production builds by the bundler.
   * @internal
   */
  public __DEV_simulateFaults(): { passed: string[]; failed: string[] } {
    if (process.env.NODE_ENV === 'production') {
      return { passed: [], failed: ['Cannot run fault injection in production'] };
    }

    const passed: string[] = [];
    const failed: string[] = [];

    // Test 1: engage() twice is idempotent
    try {
      this.engage();
      this.engage();
      passed.push('engage-idempotent');
      this.disengage();
    } catch (e) {
      failed.push(`engage-idempotent: ${e}`);
    }

    // Test 2: disengage() twice is idempotent
    try {
      this.disengage();
      this.disengage();
      passed.push('disengage-idempotent');
    } catch (e) {
      failed.push(`disengage-idempotent: ${e}`);
    }

    // Test 3: rapid toggle
    try {
      for (let i = 0; i < 50; i++) {
        this.engage();
        this.disengage();
      }
      passed.push('rapid-toggle-x50');
    } catch (e) {
      failed.push(`rapid-toggle-x50: ${e}`);
    }

    // Test 4: destroyed window safety
    try {
      this.protectWindow(null as any);
      this.protectWindow({ isDestroyed: () => true } as any);
      passed.push('destroyed-window-safety');
    } catch (e) {
      failed.push(`destroyed-window-safety: ${e}`);
    }

    // Test 5: invalid config safety
    try {
      this.updateConfig({ processName: '', watchdogIntervalMs: -1 });
      if (this.config.processName && this.config.watchdogIntervalMs >= 1000) {
        passed.push('invalid-config-safety');
      } else {
        failed.push('invalid-config-safety: validation bypassed');
      }
    } catch (e) {
      failed.push(`invalid-config-safety: ${e}`);
    }

    // Test 6: listener count stable
    try {
      const before = (app as any).listenerCount?.('browser-window-created') ?? 0;
      this.engage();
      this.disengage();
      this.engage();
      this.disengage();
      const after = (app as any).listenerCount?.('browser-window-created') ?? 0;
      if (after <= before) {
        passed.push('listener-leak-free');
      } else {
        failed.push(`listener-leak-free: before=${before} after=${after}`);
      }
    } catch (e) {
      failed.push(`listener-leak-free: ${e}`);
    }

    this._log(`Fault injection: ${passed.length} passed, ${failed.length} failed`);
    return { passed, failed };
  }
}
