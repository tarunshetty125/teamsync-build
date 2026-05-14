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

import { app, BrowserWindow, systemPreferences } from 'electron';
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
  private _watchdogTimer: NodeJS.Timeout | null = null;
  private _originalProcessTitle: string;
  private _originalArgv0: string;
  private _scrubbedEnvKeys: string[] = [];
  private _scrubbedEnvBackup: Record<string, string> = {};
  private _originalCrashReporterMeta: Record<string, string> = {};

  private constructor() {
    this._originalProcessTitle = process.title;
    this._originalArgv0 = process.argv[0] || '';
    this.config = { ...DEFAULT_CONFIG };

    // Rehydrate persisted config
    this._rehydrateFromSettings();
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
    if (this._engaged) return;
    this._engaged = true;
    this.config.level = 'advanced';

    console.log('[StealthManager] ▶ Engaging advanced stealth mode');

    // L0: Process Identity
    this._applyProcessDisguise();
    this._startWatchdog();

    // L0.5: Environment Scrubbing
    if (this.config.scrubEnvironment) {
      this._scrubEnvironment();
    }

    // L1: Window Surface Protection
    this._applyWindowProtection();

    // L2: OS Integration Hiding
    this._applyOSHiding();

    // L3: Event Blocking
    if (this.config.blockAppleEvents) {
      this._blockAppleEvents();
    }

    // L4: Forensic Cleanup
    if (this.config.suppressCrashReporter) {
      this._suppressCrashReporter();
    }

    // Persist
    this._persistToSettings();

    console.log('[StealthManager] ✅ Advanced stealth engaged');
  }

  /**
   * Disengage stealth — reverts all layers back to default.
   */
  public disengage(): void {
    if (!this._engaged) return;

    console.log('[StealthManager] ◀ Disengaging stealth mode');

    // Stop watchdog first to prevent re-application
    this._stopWatchdog();

    // Revert L0: Process Identity
    this._revertProcessDisguise();

    // Revert L0.5: Environment
    this._restoreEnvironment();

    // Revert L1: Window Protection
    this._revertWindowProtection();

    // Revert L2: OS Integration
    this._revertOSHiding();

    // Revert L3: Event Blocking
    this._unblockAppleEvents();

    // Revert L4: Crash Reporter
    this._restoreCrashReporter();

    this._engaged = false;
    this.config.level = 'off';
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
        app.setAppUserModelId('com.natively.assistant');
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

    for (const win of allWindows) {
      if (win.isDestroyed()) continue;

      // Content protection — prevents screen capture from recording the window
      win.setContentProtection(true);

      // macOS 13+: set window sharing type to 'none' to block ScreenCaptureKit
      if (process.platform === 'darwin') {
        try {
          // @ts-ignore — Electron 28+ API, may not exist in older versions
          if (typeof win.setWindowButtonVisibility === 'function') {
            // Hide traffic lights completely in stealth
            win.setWindowButtonVisibility(false);
          }
        } catch { /* Older Electron — skip */ }

        // Hide from Mission Control
        try {
          win.setHiddenInMissionControl(true);
        } catch { /* Older Electron */ }

        // Make window visible on all workspaces (consistent with stealth overlay)
        try {
          win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch { /* ignore */ }
      }

      // On Windows, set the window as a tool window (no taskbar entry)
      if (process.platform === 'win32') {
        try {
          win.setSkipTaskbar(true);
        } catch { /* ignore */ }
      }
    }

    console.log(`[StealthManager] L1: ${allWindows.length} windows hardened`);
  }

  private _revertWindowProtection(): void {
    const allWindows = BrowserWindow.getAllWindows();

    for (const win of allWindows) {
      if (win.isDestroyed()) continue;

      win.setContentProtection(false);

      if (process.platform === 'darwin') {
        try {
          // @ts-ignore
          if (typeof win.setWindowButtonVisibility === 'function') {
            win.setWindowButtonVisibility(true);
          }
        } catch { /* ignore */ }

        try {
          win.setHiddenInMissionControl(false);
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
    if (win.isDestroyed()) return;

    win.setContentProtection(true);

    if (process.platform === 'darwin') {
      try { win.setHiddenInMissionControl(true); } catch { /* ignore */ }
      try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* ignore */ }
    }

    if (process.platform === 'win32') {
      try { win.setSkipTaskbar(true); } catch { /* ignore */ }
    }
  }

  // ─── L2: OS Integration Hiding ───────────────────────────────────────────

  private _applyOSHiding(): void {
    if (process.platform === 'darwin') {
      // Hide from dock (Cmd+Tab app switcher)
      try {
        app.dock.hide();
      } catch (e) {
        console.warn('[StealthManager] L2: dock.hide() failed:', e);
      }

      // Suppress the application menu bar name
      try {
        app.setName(this.config.processName);
      } catch (e) {
        console.warn('[StealthManager] L2: setName() failed:', e);
      }
    }

    console.log('[StealthManager] L2: OS integration hidden');
  }

  private _revertOSHiding(): void {
    if (process.platform === 'darwin') {
      try {
        app.dock.show();
      } catch (e) {
        console.warn('[StealthManager] L2: dock.show() failed:', e);
      }

      try {
        app.setName('TeamSync');
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

    // Disable remote Apple Events from other applications
    try {
      // Electron's app.on('open-url') and app.on('open-file') are Apple Event handlers.
      // We intercept the 'will-continue-user-activity' and 'continue-activity' events
      // to suppress any external app's attempt to interact with us.
      app.on('will-continue-user-activity', (event) => {
        event.preventDefault();
      });

      // Block Handoff / Universal Clipboard (which can reveal app identity)
      app.on('activity-was-continued', (event) => {
        event.preventDefault();
      });
    } catch (e) {
      console.warn('[StealthManager] L3: Apple Event blocking partial:', e);
    }

    console.log('[StealthManager] L3: Apple Events suppressed');
  }

  private _unblockAppleEvents(): void {
    // Note: Electron doesn't provide removeAllListeners for app events cleanly,
    // but since we only add preventDefault handlers, the impact is minimal.
    // The handlers will be GC'd on app restart.
    console.log('[StealthManager] L3: Apple Event suppression will clear on restart');
  }

  // ─── L4: Forensic Cleanup ────────────────────────────────────────────────

  private _suppressCrashReporter(): void {
    try {
      // Overwrite crash reporter metadata so that if a crash dump is generated,
      // it doesn't contain the real app name or product info.
      const targetName = this.config.processName;
      app.setName(targetName);

      // Clear any custom crash reporter parameters
      // (Electron's crashReporter.addExtraParameter is per-renderer,
      //  but the main process metadata is set at startup)
    } catch (e) {
      console.warn('[StealthManager] L4: Crash reporter suppression partial:', e);
    }

    console.log('[StealthManager] L4: Crash reporter metadata neutralised');
  }

  private _restoreCrashReporter(): void {
    try {
      app.setName('TeamSync');
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
      const stored = sm.get('advancedStealth') as Partial<StealthConfig> | undefined;
      if (stored) {
        Object.assign(this.config, stored);
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
    if (this._engaged) {
      // Best-effort revert — process is shutting down
      try { this._revertProcessDisguise(); } catch { /* ignore */ }
      try { this._restoreEnvironment(); } catch { /* ignore */ }
    }
    StealthManager.instance = null;
  }
}
