import { BrowserWindow, systemPreferences, shell } from 'electron';

/**
 * StealthKeyboardManager — singleton that manages the native CGEventTap
 * (macOS) or low-level keyboard hook (Windows, future) for stealth typing.
 *
 * The tap intercepts keystrokes BEFORE they reach the foreground app,
 * routing them to the overlay input field so the user can type into
 * TeamSync while Zoom/browser/IDE retains macOS focus.
 *
 * Platform support:
 * - macOS: fully implemented via StealthKeyboardTap (Rust CGEventTap)
 * - Windows: stubs only — native hook not yet compiled. All methods
 *   gracefully no-op. When a Windows native tap is available, this
 *   manager will activate automatically via the same typeof checks.
 * - Linux: not supported.
 */

/** Shape of the event object sent by the Rust StealthKeyboardTap. */
export interface StealthKeyEvent {
  /** True for keyDown events. */
  isKeyDown: boolean;
  /** macOS virtual keyCode (CGKeyCode). */
  keyCode: number;
  /** Unicode string from CGEventKeyboardGetUnicodeString. */
  chars: string;
  /** True when a mouse-down event occurred outside the overlay bounds. */
  isOutsideMouseDown: boolean;
}

/** Rust native tap instance shape (from the .node binary). */
interface NativeStealthTap {
  start(
    callback: (err: Error | null, ev: StealthKeyEvent | null) => void,
    overlayBounds: Electron.Rectangle | null,
  ): boolean;
  stop(): void;
  updateOverlayBounds(bounds: Electron.Rectangle | null): void;
}

export class StealthKeyboardManager {
  private static instance: StealthKeyboardManager;

  // Native tap instance (null if unavailable on this platform/binary)
  private tap: NativeStealthTap | null = null;
  private nativeAvailable: boolean = false;

  // State
  private active: boolean = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private overlayWebContents: Electron.WebContents | null = null;
  private overlayRegistrationToken: number = 0;
  private overlayBoundsProvider: (() => Electron.Rectangle | null) | null = null;
  private lastPushedBounds: Electron.Rectangle | null = null;

  /** Idle timeout before auto-disengaging the tap (ms). */
  private static readonly IDLE_TIMEOUT_MS = 10_000;

  // ─── Singleton ──────────────────────────────────────────────────────

  public static getInstance(): StealthKeyboardManager {
    if (!StealthKeyboardManager.instance) {
      StealthKeyboardManager.instance = new StealthKeyboardManager();
    }
    return StealthKeyboardManager.instance;
  }

  private constructor() {
    this.tap = this.createTapInstance();
    this.nativeAvailable = this.tap !== null;
    if (this.nativeAvailable) {
      console.log('[StealthKeyboardManager] Native tap available');
    } else {
      console.log(
        `[StealthKeyboardManager] Native tap unavailable on ${process.platform} — stealth typing disabled`,
      );
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────

  /**
   * Register the overlay window whose webContents will receive captured
   * keystrokes via the "stealth-key-captured" IPC channel.
   */
  public setOverlayWindow(win: BrowserWindow | null): void {
    const myToken = ++this.overlayRegistrationToken;
    if (!win) {
      this.overlayWebContents = null;
      return;
    }
    this.overlayWebContents = !win.isDestroyed() ? win.webContents : null;
    win.once('closed', () => {
      if (this.overlayRegistrationToken === myToken) {
        this.overlayWebContents = null;
      }
    });
  }

  /**
   * Register a function that returns the overlay's current screen bounds.
   * Used for mouse-down hit detection (clicks outside → disengage).
   */
  public setOverlayBoundsProvider(fn: () => Electron.Rectangle | null): void {
    this.overlayBoundsProvider = fn;
  }

  /**
   * Push the latest overlay bounds into the live tap. Wire this to
   * overlay move/resize events. The native side no-ops when the tap
   * is not active, and dedup-on-equal skips the N-API call for
   * identical frames.
   */
  public pushBoundsToTap(): void {
    if (!this.tap) return;
    const bounds = this.getOverlayBoundsForTap();
    if (StealthKeyboardManager.boundsEqual(this.lastPushedBounds, bounds)) return;
    this.lastPushedBounds = bounds;
    try {
      this.tap.updateOverlayBounds(bounds);
    } catch (e) {
      console.error('[StealthKeyboardManager] updateOverlayBounds threw:', e);
    }
  }

  /** True if the native module shipped with stealth-tap support. */
  public isAvailable(): boolean {
    return this.nativeAvailable;
  }

  /** True if the tap is currently engaged and capturing keystrokes. */
  public isActive(): boolean {
    return this.active;
  }

  /** True if Accessibility (macOS) permission is granted right now. */
  public isPermissionGranted(): boolean {
    if (process.platform === 'darwin') {
      try {
        return systemPreferences.isTrustedAccessibilityClient(false);
      } catch {
        return this.callNativePermissionCheck();
      }
    }
    // Windows: no permission gate for keyboard hooks
    if (process.platform === 'win32') return true;
    return false;
  }

  /**
   * Trigger the OS permission prompt. Returns the current trust state
   * (almost always false on first call on macOS — user needs to grant
   * in System Settings, then restart the app for the tap to bind).
   */
  public requestPermission(): boolean {
    if (process.platform === 'darwin') {
      try {
        return systemPreferences.isTrustedAccessibilityClient(true);
      } catch {
        return false;
      }
    }
    // Windows: always granted
    if (process.platform === 'win32') return true;
    return false;
  }

  /** Open the OS accessibility/privacy settings directly. */
  public openSettings(): void {
    if (process.platform === 'darwin') {
      const tryOpen = (url: string) => Promise.resolve(shell.openExternal(url));
      tryOpen(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      )
        .catch(() =>
          tryOpen('x-apple.systempreferences:com.apple.preference.security'),
        )
        .catch((e) => {
          console.error(
            '[StealthKeyboardManager] failed to open Accessibility settings:',
            e,
          );
        });
    } else if (process.platform === 'win32') {
      // Windows doesn't require a special permission for keyboard hooks,
      // but open Privacy settings as a fallback UX.
      shell.openExternal('ms-settings:privacy').catch(() => { });
    }
  }

  /**
   * Engage the tap. Returns false if the native module isn't available
   * or Accessibility isn't granted; the renderer should drive the user
   * through the permission flow in that case.
   */
  public start(): boolean {
    if (!this.tap) return false;
    if (this.active) return true;

    // Pre-check Accessibility permission (macOS).
    // prompt: false — don't auto-show the OS dialog on every shortcut press.
    // The renderer shows a toast with "Open Settings" instead.
    if (process.platform === 'darwin') {
      const trusted = systemPreferences.isTrustedAccessibilityClient(false);
      if (!trusted) {
        console.warn('[StealthKeyboardManager] Accessibility permission not granted');
        this.broadcastState({ active: false, reason: 'permission' });
        return false;
      }
    }

    // Set internal flag for re-entry guard, but don't broadcast yet —
    // wait for tap.start() to confirm permission before telling the renderer.
    this.active = true;

    let ok = false;
    try {
      const overlayBounds = this.getOverlayBoundsForTap();
      ok = this.tap.start((err, ev) => {
        if (err) {
          console.error('[StealthKeyboardManager] tap callback error:', err);
          return;
        }
        if (!ev) return;
        this.handleCapturedKey(ev);
      }, overlayBounds);
    } catch (e) {
      this.active = false;
      this.broadcastState({ active: false });
      console.error('[StealthKeyboardManager] tap.start threw:', e);
      return false;
    }

    if (!ok) {
      this.active = false;
      this.broadcastState({ active: false, reason: 'permission' });
      return false;
    }

    // Tap started successfully — now tell the renderer
    this.broadcastState({ active: true });
    this.hideAuxWindowsForStealth();
    this.armIdleTimer();
    return true;
  }

  /** Disengage the tap. Safe to call when inactive. */
  public stop(): void {
    this.clearIdleTimer();
    if (!this.tap) return;
    if (!this.active) return;
    this.tap.stop();
    this.active = false;
    this.broadcastState({ active: false });
  }

  /** Toggle active state. Bound to the activation hotkey. */
  public toggle(): boolean {
    if (this.active) {
      this.stop();
      return false;
    }
    return this.start();
  }

  // ─── Internals ──────────────────────────────────────────────────────

  /**
   * Attempt to instantiate the native StealthKeyboardTap from the binary.
   * Returns null if the binary doesn't export it or if we're on an
   * unsupported platform.
   */
  private createTapInstance(): NativeStealthTap | null {
    // Guard: only macOS has a compiled native tap currently.
    // Windows stub: when a Windows native tap is added to the Rust binary,
    // remove this guard — the typeof check below will activate it.
    if (process.platform !== 'darwin' && process.platform !== 'win32') return null;

    try {
      const { loadNativeModule } = require('../audio/nativeModuleLoader');
      const native = loadNativeModule();
      if (!native) return null;

      const Ctor = native.StealthKeyboardTap;
      if (typeof Ctor !== 'function') {
        // Expected on Windows until the Rust hook is compiled.
        if (process.platform === 'darwin') {
          console.warn(
            '[StealthKeyboardManager] StealthKeyboardTap constructor missing from native binary — stealth typing unavailable',
          );
        }
        return null;
      }
      return new Ctor();
    } catch (e) {
      console.error(
        '[StealthKeyboardManager] failed to instantiate native tap:',
        e,
      );
      return null;
    }
  }

  /** Fallback accessibility check via native module (macOS only). */
  private callNativePermissionCheck(): boolean {
    try {
      const { loadNativeModule } = require('../audio/nativeModuleLoader');
      const native = loadNativeModule();
      return typeof native?.isAccessibilityGranted === 'function'
        ? native.isAccessibilityGranted()
        : false;
    } catch {
      return false;
    }
  }

  private getOverlayBoundsForTap(): Electron.Rectangle | null {
    const bounds = this.overlayBoundsProvider?.() ?? null;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return bounds;
  }

  /** Route a captured key event to the appropriate handler. */
  private handleCapturedKey(ev: StealthKeyEvent): void {
    // Mouse click outside overlay → disengage
    if (ev.isOutsideMouseDown) {
      this.stop();
      return;
    }
    // Escape (keyCode 53 on macOS) → send to renderer then disengage
    if (ev.isKeyDown && ev.keyCode === 53) {
      this.sendKeyToOverlay(ev);
      this.stop();
      return;
    }
    if (!this.active) return;
    this.armIdleTimer();
    this.sendKeyToOverlay(ev);
  }

  /** Forward captured key event to the overlay renderer. */
  private sendKeyToOverlay(ev: StealthKeyEvent): void {
    if (this.overlayWebContents && !this.overlayWebContents.isDestroyed()) {
      this.overlayWebContents.send('stealth-key-captured', ev);
    }
  }

  /**
   * Hide Settings / ModelSelector if they happen to be visible
   * when the stealth tap engages. Prevents UI clutter during
   * stealth typing.
   */
  private hideAuxWindowsForStealth(): void {
    try {
      const { AppState } = require('../main');
      const app = AppState.getInstance();
      const settings = app?.settingsWindowHelper?.getSettingsWindow?.();
      if (settings && !settings.isDestroyed() && settings.isVisible()) {
        app.settingsWindowHelper.closeWindow();
      }
      const modelSel = app?.modelSelectorWindowHelper?.getWindow?.();
      if (modelSel && !modelSel.isDestroyed() && modelSel.isVisible()) {
        app.modelSelectorWindowHelper.hideWindow();
      }
    } catch (e) {
      console.error(
        '[StealthKeyboardManager] hideAuxWindowsForStealth failed:',
        e,
      );
    }
  }

  // ─── Idle Timer ─────────────────────────────────────────────────────

  private armIdleTimer(): void {
    if (!this.active) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      if (this.active) this.stop();
    }, StealthKeyboardManager.IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ─── Broadcasting ───────────────────────────────────────────────────

  private broadcastState(state: { active: boolean; reason?: string }): void {
    this.broadcast('stealth-tap-state', state);
  }

  private broadcast(channel: string, payload: any): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  // ─── Utility ────────────────────────────────────────────────────────

  private static boundsEqual(
    a: Electron.Rectangle | null,
    b: Electron.Rectangle | null,
  ): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return (
      a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
    );
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Full teardown: stop the tap, clear timers, release native references,
   * remove IPC handlers, and clear the singleton. Called from before-quit.
   */
  public destroy(): void {
    // Stop the active tap (if any)
    this.stop();
    // Clear idle timer
    this.clearIdleTimer();
    // Release native reference
    this.tap = null;
    this.nativeAvailable = false;
    // Release overlay references
    this.overlayWebContents = null;
    this.overlayBoundsProvider = null;
    this.lastPushedBounds = null;
    // Remove IPC handlers registered by main.ts
    try {
      const { ipcMain } = require('electron');
      const channels = [
        'stealth-tap:available',
        'stealth-tap:start',
        'stealth-tap:stop',
        'stealth-tap:open-settings',
        'stealth-tap:should-auto-engage',
        'stealth-tap:refresh-ime',
      ];
      for (const ch of channels) {
        try { ipcMain.removeHandler(ch); } catch { /* no prior handler */ }
      }
    } catch { /* electron not available */ }
    // Clear singleton
    StealthKeyboardManager.instance = null as any;
  }
}
