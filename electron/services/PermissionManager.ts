import { app, BrowserWindow, desktopCapturer, shell, systemPreferences } from 'electron';
import { EventEmitter } from 'node:events';
import Store from 'electron-store';
import type {
  PermissionKind,
  PermissionRequestResult,
  PermissionSettingsResult,
  PermissionState,
  PermissionStatusSnapshot,
} from '../../src/lib/permissions/types';
import { arePermissionSnapshotsEqual } from '../../src/lib/permissions/utils';

type MacMediaAccessStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';

interface PermissionStoreState {
  accessibilitySetupAttempted: boolean;
}

const STORE_NAME = 'teamsync-permissions';
const STATUS_EVENT = 'status-changed';
const POLL_INTERVAL_MS = 1500;

export class PermissionManager extends EventEmitter {
  private static instance: PermissionManager | null = null;

  private readonly store: Store<PermissionStoreState>;
  private readonly initialScreenStatus: MacMediaAccessStatus;
  private readonly isDevelopmentBypass: boolean;

  private monitoringTimer: NodeJS.Timeout | null = null;
  private listenersBound = false;
  private screenPermissionSawNonGrantedState = false;
  private screenPermissionRequiresRestart = false;
  private lastStatus: PermissionStatusSnapshot | null = null;

  private constructor() {
    super();

    this.store = new Store<PermissionStoreState>({
      name: STORE_NAME,
      defaults: {
        accessibilitySetupAttempted: false,
      },
    });

    this.isDevelopmentBypass =
      process.platform === 'darwin' &&
      !app.isPackaged &&
      process.env.TEAMSYNC_ENFORCE_MAC_PERMISSIONS !== '1';

    this.initialScreenStatus = this.readScreenStatus();
    this.screenPermissionSawNonGrantedState = this.initialScreenStatus !== 'granted';
  }

  public static getInstance(): PermissionManager {
    if (!PermissionManager.instance) {
      PermissionManager.instance = new PermissionManager();
    }

    return PermissionManager.instance;
  }

  public startMonitoring(): void {
    if (this.monitoringTimer) return;

    this.monitoringTimer = setInterval(() => {
      void this.refreshAndBroadcast();
    }, POLL_INTERVAL_MS);

    if (!this.listenersBound) {
      const refresh = () => {
        void this.refreshAndBroadcast();
      };

      app.on('activate', refresh);
      app.on('browser-window-focus', refresh);
      this.listenersBound = true;
    }

    void this.refreshAndBroadcast(true);
  }

  public stopMonitoring(): void {
    if (!this.monitoringTimer) return;
    clearInterval(this.monitoringTimer);
    this.monitoringTimer = null;
  }

  public async getStatus(): Promise<PermissionStatusSnapshot> {
    return this.buildStatusSnapshot();
  }

  public getStatusSync(): PermissionStatusSnapshot {
    return this.buildStatusSnapshot();
  }

  public async requestMicrophonePermission(): Promise<PermissionRequestResult> {
    if (process.platform !== 'darwin') {
      return {
        success: true,
        status: await this.getStatus(),
      };
    }

    let granted = false;
    try {
      granted = await systemPreferences.askForMediaAccess('microphone');
    } catch (error) {
      console.error('[PermissionManager] Failed to request microphone permission:', error);
    }

    const status = await this.getStatus();
    return {
      success: granted || status.microphone === 'granted',
      status,
      prompted: true,
      message:
        status.microphone === 'granted'
          ? 'Microphone access enabled.'
          : 'Microphone access is still blocked. Open System Settings to enable it manually.',
    };
  }

  public async requestScreenRecordingPermission(): Promise<PermissionRequestResult> {
    if (process.platform !== 'darwin') {
      return {
        success: true,
        status: await this.getStatus(),
      };
    }

    const currentStatus = this.readScreenStatus();
    if (currentStatus === 'denied' || currentStatus === 'restricted') {
      const status = await this.getStatus();
      return {
        success: false,
        status,
        message: 'Screen Recording is blocked. Open System Settings to enable it.',
      };
    }

    let promptTriggered = false;

    try {
      await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 16, height: 16 },
      });
      promptTriggered = true;
    } catch (error) {
      promptTriggered = true;
      console.log('[PermissionManager] Screen Recording prompt trigger returned:', error);
    }

    await this.delay(500);

    const status = await this.getStatus();
    return {
      success: status.screenRecording === 'granted' || status.screenRecording === 'restart_required',
      status,
      prompted: promptTriggered,
      message:
        status.screenRecording === 'granted'
          ? 'Screen access enabled.'
          : status.screenRecording === 'restart_required'
            ? 'Please restart the app to finish enabling screen access.'
            : 'Grant Screen Recording in the macOS prompt or System Settings to continue.',
    };
  }

  public async requestAccessibilityPermission(): Promise<PermissionRequestResult> {
    if (process.platform !== 'darwin') {
      return {
        success: true,
        status: await this.getStatus(),
      };
    }

    this.store.set('accessibilitySetupAttempted', true);

    let granted = false;
    try {
      granted = systemPreferences.isTrustedAccessibilityClient(true);
    } catch (error) {
      console.error('[PermissionManager] Failed to request accessibility permission:', error);
    }

    await this.delay(300);

    const status = await this.getStatus();
    return {
      success: granted || status.accessibility === 'granted',
      status,
      prompted: true,
      message:
        status.accessibility === 'granted'
          ? 'Accessibility access enabled.'
          : 'Accessibility access is still blocked. Open System Settings to finish setup.',
    };
  }

  public async openSettings(permission: PermissionKind): Promise<PermissionSettingsResult> {
    // Always open settings, even in dev mode — so user can manage permissions

    const target = this.getSettingsUrl(permission);
    if (!target) {
      return {
        success: false,
        message: `System settings deep-link is not supported on ${process.platform}.`,
      };
    }

    try {
      await shell.openExternal(target);
      if (permission === 'accessibility') {
        this.store.set('accessibilitySetupAttempted', true);
      }
      return { success: true };
    } catch (error) {
      console.error('[PermissionManager] Failed to open settings:', error);
      return {
        success: false,
        message: 'Unable to open system settings automatically.',
      };
    }
  }

  public broadcastStatus(status: PermissionStatusSnapshot): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('permissions:status-changed', status);
      }
    }
  }

  private async refreshAndBroadcast(force = false): Promise<PermissionStatusSnapshot> {
    const previousStatus = this.lastStatus;
    const nextStatus = this.buildStatusSnapshot();
    const changed = force || !arePermissionSnapshotsEqual(previousStatus, nextStatus);

    if (changed) {
      this.lastStatus = nextStatus;
      this.emit(STATUS_EVENT, nextStatus);
      this.broadcastStatus(nextStatus);
    }

    return nextStatus;
  }

  private buildStatusSnapshot(): PermissionStatusSnapshot {
    // Read real permission states even in dev mode

    if (process.platform !== 'darwin') {
      return {
        screenRecording: 'granted',
        microphone: 'granted',
        accessibility: 'granted',
        restartRequired: false,
        platform: process.platform,
        checkedAt: new Date().toISOString(),
      };
    }

    const screenStatus = this.readScreenStatus();
    if (screenStatus !== 'granted') {
      this.screenPermissionSawNonGrantedState = true;
    }

    if (screenStatus === 'granted' && this.screenPermissionSawNonGrantedState) {
      this.screenPermissionRequiresRestart = true;
    }

    const restartRequired = screenStatus === 'granted' && this.screenPermissionRequiresRestart;

    return {
      screenRecording: restartRequired
        ? 'restart_required'
        : this.mapScreenStatus(screenStatus),
      microphone: this.mapMediaStatus(this.readMicrophoneStatus()),
      accessibility: this.getAccessibilityStatus(),
      restartRequired,
      platform: process.platform,
      checkedAt: new Date().toISOString(),
    };
  }

  private readScreenStatus(): MacMediaAccessStatus {
    if (process.platform !== 'darwin') return 'granted';

    try {
      return systemPreferences.getMediaAccessStatus('screen') as MacMediaAccessStatus;
    } catch (error) {
      console.error('[PermissionManager] Failed to read screen permission status:', error);
      return 'not-determined';
    }
  }

  private readMicrophoneStatus(): MacMediaAccessStatus {
    if (process.platform !== 'darwin') return 'granted';

    try {
      return systemPreferences.getMediaAccessStatus('microphone') as MacMediaAccessStatus;
    } catch (error) {
      console.error('[PermissionManager] Failed to read microphone permission status:', error);
      return 'not-determined';
    }
  }

  private getAccessibilityStatus(): PermissionState {
    if (process.platform !== 'darwin') {
      return 'granted';
    }

    try {
      if (systemPreferences.isTrustedAccessibilityClient(false)) {
        return 'granted';
      }
    } catch (error) {
      console.error('[PermissionManager] Failed to read accessibility permission status:', error);
    }

    return this.store.get('accessibilitySetupAttempted') ? 'denied' : 'not_requested';
  }

  private mapScreenStatus(status: MacMediaAccessStatus): PermissionState {
    switch (status) {
      case 'granted':
        return 'granted';
      case 'not-determined':
        return 'not_requested';
      case 'denied':
      case 'restricted':
      default:
        return 'denied';
    }
  }

  private mapMediaStatus(status: MacMediaAccessStatus): PermissionState {
    switch (status) {
      case 'granted':
        return 'granted';
      case 'not-determined':
        return 'not_requested';
      case 'denied':
      case 'restricted':
      default:
        return 'denied';
    }
  }

  private getSettingsUrl(permission: PermissionKind): string | null {
    if (process.platform === 'darwin') {
      switch (permission) {
        case 'screenRecording':
          return 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
        case 'microphone':
          return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
        case 'accessibility':
          return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
        default:
          return null;
      }
    }

    if (process.platform === 'win32') {
      switch (permission) {
        case 'microphone':
          return 'ms-settings:privacy-microphone';
        default:
          return 'ms-settings:privacy';
      }
    }

    return null;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const permissionManager = PermissionManager.getInstance();
