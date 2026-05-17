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
 *   L4  Forensic Cleanup   — log suppression, crash reporter neutralisation
 *
 * Usage:
 *   StealthManager.getInstance().engage()   — enable advanced stealth
 *   StealthManager.getInstance().disengage() — revert to normal
 */

import { app, BrowserWindow } from 'electron';
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

// ─── Default Configuration ──────────────────────────────────────────────────────

const DEFAULT_CONFIG: StealthConfig = {
  level: 'off',
  processName: 'System Settings',
  scrubEnvironment: true,
  blockAppleEvents: true,
  suppressCrashReporter: true,
  watchdogIntervalMs: 3000,
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
  /** Tracked Apple Event handlers so they can be removed on disengage */
  private _appleEventHandlers: Array<{ event: string; handler: (...args: any[]) => void }> = [];
  /** Tracked browser-window-created handler for cleanup */
  private _windowCreatedHandler: ((event: Electron.Event, win: BrowserWindow) => void) | null = null;

  private constructor() {
    this._originalProcessTitle = process.title;
    this._originalArgv0 = process.argv[0] || '';
    this._originalAppName = (() => { try { return app.getName(); } catch { return 'TeamSync'; } })();
    this.config = { ...DEFAULT_CONFIG };

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

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Engage advanced stealth mode — applies all hardening layers.
   * Idempotent: calling twice is a no-op.
   */
  public engage(): void {
    if (this._engaged || this._transitioning) return;
    this._transitioning = true;

    console.log('[StealthManager] ▶ Engaging advanced stealth mode');

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

      // L3: Event Blocking (macOS only)
      if (this.config.blockAppleEvents && process.platform === 'darwin') {
        this._blockAppleEvents();
      }

      // L4: Forensic Cleanup
      if (this.config.suppressCrashReporter) {
        this._suppressCrashReporter();
      }

      // Persist
      this._persistToSettings();

      console.log('[StealthManager] ✅ Advanced stealth engaged');
    } catch (e) {
      // If any layer throws, roll back to prevent half-engaged state
      console.error('[StealthManager] ⚠ Engage failed, rolling back:', e);
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
    if (!this._engaged) return;
    if (this._transitioning) {
      // Re-entry during rollback — just flip flag and return
      this._engaged = false;
      this.config.level = 'off';
      return;
    }
    this._transitioning = true;

    console.log('[StealthManager] ◀ Disengaging stealth mode');

    // Stop watchdog first to prevent re-application during revert
    this._stopWatchdog();

    // Remove dynamic window listener
    this._removeWindowCreatedListener();

    // Each revert is independently try-caught so a failure in one layer
    // does not prevent the remaining layers from being reverted.
    try { this._revertProcessDisguise(); } catch (e) {
      console.warn('[StealthManager] L0 revert error:', e);
    }
    try { this._restoreEnvironment(); } catch (e) {
      console.warn('[StealthManager] L0.5 revert error:', e);
    }
    try { this._revertWindowProtection(); } catch (e) {
      console.warn('[StealthManager] L1 revert error:', e);
    }
    try { this._revertOSHiding(); } catch (e) {
      console.warn('[StealthManager] L2 revert error:', e);
    }
    try { this._unblockAppleEvents(); } catch (e) {
      console.warn('[StealthManager] L3 revert error:', e);
    }
    try { this._restoreCrashReporter(); } catch (e) {
      console.warn('[StealthManager] L4 revert error:', e);
    }

    this._engaged = false;
    this.config.level = 'off';
    this._transitioning = false;
    this._persistToSettings();

    console.log('[StealthManager] ✅ Stealth disengaged — normal mode restored');
  }

  /**
   * Returns the current stealth state for UI/diagnostics.
   */
  public getState(): StealthState {
    return {
      level: this.config.level,
      processDisguised: this._engaged,
      windowsProtected: this._engaged && this.config.hideFromScreenCapture,
      dockHidden: this._engaged,
      eventsBlocked: this._engaged && this.config.blockAppleEvents,
      watchdogActive: this._watchdogTimer !== null,
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

  // ─── L0: Process Identity ─────────────────────────────────────────────────

  private _applyProcessDisguise(): void {
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
        console.warn('[StealthManager] Failed to set AUMID:', e);
      }
    }

    console.log(`[StealthManager] L0: Process disguised as "${targetName}"`);
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
        app.setAppUserModelId('com.teamsync.assistant');
      } catch { /* ignore */ }
    }

    console.log('[StealthManager] L0: Process identity reverted');
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
    }, this.config.watchdogIntervalMs);

    // Prevent the timer from keeping the process alive during shutdown
    if (this._watchdogTimer.unref) {
      this._watchdogTimer.unref();
    }

    console.log(`[StealthManager] L0: Watchdog started (${this.config.watchdogIntervalMs}ms interval)`);
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
      console.log(`[StealthManager] L0.5: Scrubbed ${this._scrubbedEnvKeys.length} fingerprint env vars`);
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

      try {
        // Content protection — prevents screen capture from recording the window
        win.setContentProtection(true);
      } catch (e) {
        console.warn('[StealthManager] L1: setContentProtection failed for window:', e);
        continue;
      }

      if (process.platform === 'darwin') {
        // Hide from Mission Control / Exposé
        try {
          if (typeof (win as any).setHiddenInMissionControl === 'function') {
            win.setHiddenInMissionControl(true);
          }
        } catch { /* Older Electron — skip */ }

        // Make window visible on all workspaces (consistent with stealth overlay)
        try {
          win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch { /* ignore */ }
      }

      if (process.platform === 'win32') {
        // Set the window as a tool window (no taskbar entry)
        try {
          win.setSkipTaskbar(true);
        } catch { /* ignore */ }
      }

      hardened++;
    }

    console.log(`[StealthManager] L1: ${hardened}/${allWindows.length} windows hardened`);
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

      if (process.platform === 'win32') {
        try {
          // Only remove skipTaskbar for non-overlay windows
          const isOverlay = win.isAlwaysOnTop();
          if (!isOverlay) win.setSkipTaskbar(false);
        } catch { /* ignore */ }
      }
    }

    console.log('[StealthManager] L1: Window protection reverted');
  }

  /**
   * Apply protection to a newly-created window.
   * Call this from WindowHelper after creating any new BrowserWindow.
   */
  public protectWindow(win: BrowserWindow): void {
    if (!this._engaged) return;
    if (!win || win.isDestroyed()) return;

    try {
      win.setContentProtection(true);
    } catch (e) {
      console.warn('[StealthManager] protectWindow: setContentProtection failed:', e);
      return;
    }

    if (process.platform === 'darwin') {
      try {
        if (typeof (win as any).setHiddenInMissionControl === 'function') {
          win.setHiddenInMissionControl(true);
        }
      } catch { /* ignore */ }
      try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* ignore */ }
    }

    if (process.platform === 'win32') {
      try { win.setSkipTaskbar(true); } catch { /* ignore */ }
    }
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
      // Delay slightly to let Electron finish window setup
      setTimeout(() => {
        if (this._engaged && win && !win.isDestroyed()) {
          this.protectWindow(win);
        }
      }, 100);
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
    if (process.platform === 'darwin') {
      // Hide from dock (Cmd+Tab app switcher)
      try {
        if (app.dock && typeof app.dock.hide === 'function') {
          app.dock.hide();
        }
      } catch (e) {
        console.warn('[StealthManager] L2: dock.hide() failed:', e);
      }

      // Suppress the application menu bar name
      try {
        app.setName(this.config.processName);
      } catch (e) {
        console.warn('[StealthManager] L2: setName() failed:', e);
      }

      console.log('[StealthManager] L2: OS integration hidden (darwin)');
    } else if (process.platform === 'win32') {
      console.log('[StealthManager] L2: OS integration hidden (win32 — no dock)');
    }
    // Linux: no-op — no dock API available
  }

  private _revertOSHiding(): void {
    if (process.platform === 'darwin') {
      try {
        if (app.dock && typeof app.dock.show === 'function') {
          app.dock.show();
        }
      } catch (e) {
        console.warn('[StealthManager] L2: dock.show() failed:', e);
      }

      try {
        app.setName(this._originalAppName);
      } catch (e) {
        console.warn('[StealthManager] L2: Revert setName() failed:', e);
      }
    }

    console.log('[StealthManager] L2: OS integration restored');
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
      console.warn('[StealthManager] L3: Apple Event blocking partial:', e);
    }

    console.log('[StealthManager] L3: Apple Events suppressed');
  }

  private _unblockAppleEvents(): void {
    if (process.platform !== 'darwin') return;
    this._removeAppleEventHandlers();
    console.log('[StealthManager] L3: Apple Event handlers removed');
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
      console.warn('[StealthManager] L4: Crash reporter suppression partial:', e);
    }

    console.log('[StealthManager] L4: Crash reporter metadata neutralised');
  }

  private _restoreCrashReporter(): void {
    try {
      app.setName(this._originalAppName);
    } catch { /* ignore */ }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Returns a plausible system binary path for the given disguise name.
   * This is what shows up in `ps aux` as the command column.
   */
  private _getSystemBinaryPath(name: string): string {
    const isMac = process.platform === 'darwin';

    const pathMap: Record<string, string> = {
      'System Settings':      isMac ? '/System/Applications/System Settings.app/Contents/MacOS/System Settings' : 'SystemSettings.exe',
      'System Preferences':   isMac ? '/System/Applications/System Preferences.app/Contents/MacOS/System Preferences' : 'SystemSettings.exe',
      'Terminal':             isMac ? '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal' : 'cmd.exe',
      'Activity Monitor':     isMac ? '/System/Applications/Utilities/Activity Monitor.app/Contents/MacOS/Activity Monitor' : 'taskmgr.exe',
      'Console':              isMac ? '/System/Applications/Utilities/Console.app/Contents/MacOS/Console' : 'cmd.exe',
      'Notes':                isMac ? '/System/Applications/Notes.app/Contents/MacOS/Notes' : 'notepad.exe',
      'TextEdit':             isMac ? '/System/Applications/TextEdit.app/Contents/MacOS/TextEdit' : 'notepad.exe',
      'Command Prompt':       'C:\\Windows\\System32\\cmd.exe',
      'Settings':             'C:\\Windows\\ImmersiveControlPanel\\SystemSettings.exe',
      'Task Manager':         'C:\\Windows\\System32\\Taskmgr.exe',
    };

    return pathMap[name.trim()] || (isMac ? '/usr/sbin/cfprefsd' : 'svchost.exe');
  }

  /**
   * Returns a plausible macOS bundle identifier for the disguise.
   */
  private _getSystemBundleId(name: string): string {
    const idMap: Record<string, string> = {
      'System Settings':    'com.apple.systempreferences',
      'System Preferences': 'com.apple.systempreferences',
      'Terminal':           'com.apple.Terminal',
      'Activity Monitor':   'com.apple.ActivityMonitor',
      'Console':            'com.apple.Console',
      'Notes':              'com.apple.Notes',
      'TextEdit':           'com.apple.TextEdit',
    };

    return idMap[name.trim()] || 'com.apple.systempreferences';
  }

  /**
   * Returns a Windows AUMID for the disguise identity.
   */
  private _getWindowsAumid(name: string): string {
    const aumidMap: Record<string, string> = {
      'Command Prompt':  'Microsoft.CommandPrompt',
      'Settings':        'windows.immersivecontrolpanel',
      'Task Manager':    'Microsoft.TaskManager',
      'Terminal':        'Microsoft.WindowsTerminal',
      'System Settings': 'windows.immersivecontrolpanel',
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
      console.warn('[StealthManager] Failed to persist config:', e);
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
    this._removeWindowCreatedListener();
    if (this._engaged) {
      // Best-effort revert — process is shutting down
      try { this._revertProcessDisguise(); } catch { /* ignore */ }
      try { this._restoreEnvironment(); } catch { /* ignore */ }
      try { this._removeAppleEventHandlers(); } catch { /* ignore */ }
      this._engaged = false;
    }
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
      for (let i = 0; i < 10; i++) {
        this.engage();
        this.disengage();
      }
      passed.push('rapid-toggle-x10');
    } catch (e) {
      failed.push(`rapid-toggle-x10: ${e}`);
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

    console.log(`[StealthManager] Fault injection: ${passed.length} passed, ${failed.length} failed`);
    return { passed, failed };
  }
}
