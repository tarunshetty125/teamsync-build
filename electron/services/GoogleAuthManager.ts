/**
 * GoogleAuthManager
 *
 * Handles Google OAuth authentication and Calendar connectivity through the
 * hosted backend. JWT ownership stays in Electron main process storage.
 */

import { shell, ipcMain, BrowserWindow } from 'electron';
import { API_BASE_URL } from '../../src/lib/config/apiConfig';
import { CredentialsManager, type GoogleAuthUser } from './CredentialsManager';

type GoogleAuthState = {
  authenticated: boolean;
  user: GoogleAuthUser | null;
  calendarConnected: boolean;
};

type GoogleAuthResult = {
  success: boolean;
  user?: GoogleAuthUser;
  authState?: GoogleAuthState;
  events?: any[];
  error?: string;
};

export class GoogleAuthManager {
  private static instance: GoogleAuthManager;
  private authEpoch = 0;
  private activeAuthSessionIds = new Map<string, number>();
  private profileLifecycleCleanup: ((reason: string) => Promise<void> | void) | null = null;

  private constructor() {}

  public static getInstance(): GoogleAuthManager {
    if (!GoogleAuthManager.instance) {
      GoogleAuthManager.instance = new GoogleAuthManager();
    }
    return GoogleAuthManager.instance;
  }

  private get credentials(): CredentialsManager {
    return CredentialsManager.getInstance();
  }

  public setProfileLifecycleCleanup(cleanup: ((reason: string) => Promise<void> | void) | null): void {
    this.profileLifecycleCleanup = cleanup;
  }

  private async runProfileLifecycleCleanup(reason: string): Promise<void> {
    try {
      await this.profileLifecycleCleanup?.(reason);
    } catch (error) {
      console.warn(`[GoogleAuthManager] Profile lifecycle cleanup failed for ${reason}:`, error);
    }
  }

  private broadcast(channel: string, ...args: any[]): void {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    });
  }

  public setupIpcHandlers(): void {
    const safeHandle = (channel: string, listener: (event: any, ...args: any[]) => Promise<any> | any) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, listener);
    };

    safeHandle('auth:get-state', async () => this.getAuthState());

    safeHandle('auth:google-signin', async () => {
      try {
        return await this.startSignIn();
      } catch (error: any) {
        return { success: false, error: error.message, authState: this.getAuthState() };
      }
    });

    safeHandle('auth:verify-session', async () => {
      return this.verifySession();
    });

    safeHandle('auth:connect-calendar', async (_event, loginHint?: string) => {
      try {
        return await this.connectCalendar(loginHint);
      } catch (error: any) {
        return { success: false, error: error.message, authState: this.getAuthState() };
      }
    });

    safeHandle('auth:calendar-events', async () => {
      return this.getCalendarEvents();
    });

    safeHandle('auth:logout', async () => {
      return this.logout();
    });

    safeHandle('auth:disconnect-calendar', async () => {
      return this.disconnectCalendar();
    });
  }

  private getAuthState(userOverride?: GoogleAuthUser | null): GoogleAuthState {
    const token = this.getStoredToken();
    const user = userOverride !== undefined ? userOverride : this.credentials.getGoogleAuthUser() || null;
    return {
      authenticated: Boolean(token && user),
      user: token ? user : null,
      calendarConnected: Boolean(token && user?.calendarConnected),
    };
  }

  private getStoredToken(): string | null {
    const token = this.credentials.getGoogleJwt()?.trim();
    return token || null;
  }

  private sanitizeUser(input: any, fallback?: GoogleAuthUser): GoogleAuthUser | undefined {
    const email = typeof input?.email === 'string' && input.email.trim()
      ? input.email.trim()
      : fallback?.email;
    if (!email) return undefined;

    const name = typeof input?.name === 'string' && input.name.trim()
      ? input.name.trim()
      : fallback?.name || email;
    const picture = typeof input?.picture === 'string' && input.picture.trim()
      ? input.picture.trim()
      : fallback?.picture;
    const calendarConnected = typeof input?.calendarConnected === 'boolean'
      ? input.calendarConnected
      : Boolean(fallback?.calendarConnected);

    return {
      name,
      email,
      ...(picture ? { picture } : {}),
      calendarConnected,
      ...(typeof input?.isNewUser === 'boolean' ? { isNewUser: input.isNewUser } : {}),
    };
  }

  private async readJson(response: Response): Promise<any> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private clearLocalAuthAndBroadcast(): void {
    this.credentials.clearGoogleAuthSession();
    this.broadcast('calendar-status-changed', { connected: false, email: null });
    this.broadcast('auth:logged-out');
  }

  private beginAuthOperation(): number {
    return this.authEpoch;
  }

  private isAuthOperationCurrent(operationEpoch: number): boolean {
    return operationEpoch === this.authEpoch;
  }

  private staleAuthResult(): GoogleAuthResult {
    return {
      success: false,
      error: 'Authentication result ignored after logout',
      authState: {
        authenticated: false,
        user: null,
        calendarConnected: false,
      },
    };
  }

  private async persistAuthResult(result: any, operationEpoch: number): Promise<GoogleAuthResult> {
    if (!this.isAuthOperationCurrent(operationEpoch)) {
      console.warn('[GoogleAuthManager] Ignored stale Google auth result after logout');
      return this.staleAuthResult();
    }

    if (!result?.success) {
      return { success: false, error: result?.error || 'Authentication failed', authState: this.getAuthState() };
    }

    const token = typeof result.token === 'string' ? result.token.trim() : '';
    if (!token) {
      return { success: false, error: 'Authentication completed without a token', authState: this.getAuthState() };
    }

    const user = this.sanitizeUser(result.user);
    if (!user) {
      return { success: false, error: 'Authentication completed without a user profile', authState: this.getAuthState() };
    }

    if (!this.isAuthOperationCurrent(operationEpoch)) {
      console.warn('[GoogleAuthManager] Ignored stale Google auth result before persistence');
      return this.staleAuthResult();
    }

    const cachedUser = this.credentials.getGoogleAuthUser();
    if (
      cachedUser?.email
      && cachedUser.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
    ) {
      await this.runProfileLifecycleCleanup('account-switch');
    }

    this.credentials.setGoogleAuthSession(token, user);
    const authState = this.getAuthState(user);
    this.broadcast('auth:result', { success: true, user, authState });
    this.broadcast('calendar-status-changed', { connected: user.calendarConnected, email: user.email });

    return { success: true, user, authState };
  }

  private async verifySession(): Promise<GoogleAuthResult> {
    const token = this.getStoredToken();
    if (!token) {
      return { success: false, error: 'Not authenticated', authState: this.getAuthState() };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const user = this.sanitizeUser(await this.readJson(response), this.credentials.getGoogleAuthUser());
        if (!user) {
          return { success: false, error: 'Invalid user profile', authState: this.getAuthState() };
        }

        this.credentials.updateGoogleAuthUser(user);
        const authState = this.getAuthState(user);
        this.broadcast('calendar-status-changed', { connected: user.calendarConnected, email: user.email });
        return { success: true, user, authState };
      }

      if (response.status === 401 || response.status === 403) {
        this.clearLocalAuthAndBroadcast();
      }

      const err = await this.readJson(response);
      return {
        success: false,
        error: err.error || 'Invalid or expired token',
        authState: this.getAuthState(),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Could not verify authentication',
        authState: this.getAuthState(),
      };
    }
  }

  private async getCalendarEvents(): Promise<GoogleAuthResult> {
    const token = this.getStoredToken();
    if (!token) {
      return { success: false, error: 'Not authenticated', authState: this.getAuthState() };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/calendar/events`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        return await this.readJson(response);
      }

      if (response.status === 401) {
        this.clearLocalAuthAndBroadcast();
      } else if (response.status === 403) {
        const cachedUser = this.credentials.getGoogleAuthUser();
        if (cachedUser) {
          const user = { ...cachedUser, calendarConnected: false };
          this.credentials.updateGoogleAuthUser(user);
          this.broadcast('calendar-status-changed', { connected: false, email: user.email });
        }
      }

      const err = await this.readJson(response);
      return { success: false, error: err.error || 'Failed to fetch calendar events', authState: this.getAuthState() };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to fetch calendar events', authState: this.getAuthState() };
    }
  }

  private async logout(): Promise<{ success: boolean }> {
    const token = this.getStoredToken();
    this.authEpoch += 1;
    this.activeAuthSessionIds.clear();
    this.clearLocalAuthAndBroadcast();
    await this.runProfileLifecycleCleanup('logout');

    if (token) {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }).catch(() => {});
    }

    return { success: true };
  }

  private async disconnectCalendar(): Promise<GoogleAuthResult> {
    const token = this.getStoredToken();
    if (!token) {
      return { success: false, error: 'Not authenticated', authState: this.getAuthState() };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/calendar/disconnect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 401) {
        this.clearLocalAuthAndBroadcast();
        return { success: false, error: 'Invalid or expired token', authState: this.getAuthState() };
      }

      if (!response.ok) {
        const err = await this.readJson(response);
        return { success: false, error: err.error || 'Failed to disconnect calendar', authState: this.getAuthState() };
      }

      const cachedUser = this.credentials.getGoogleAuthUser();
      const user = cachedUser ? { ...cachedUser, calendarConnected: false } : undefined;
      if (user) {
        this.credentials.updateGoogleAuthUser(user);
      }
      this.broadcast('calendar-status-changed', { connected: false, email: user?.email || null });
      return { success: true, ...(user ? { user } : {}), authState: this.getAuthState(user || null) };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to disconnect calendar', authState: this.getAuthState() };
    }
  }

  private async startSignIn(): Promise<GoogleAuthResult> {
    const operationEpoch = this.beginAuthOperation();
    const result = await this.openOAuthAndPoll('/auth/google', operationEpoch);
    return this.persistAuthResult(result, operationEpoch);
  }

  private async connectCalendar(loginHint?: string): Promise<GoogleAuthResult> {
    const operationEpoch = this.beginAuthOperation();
    const cachedUser = this.credentials.getGoogleAuthUser();
    const hint = loginHint || cachedUser?.email || '';
    const params = new URLSearchParams();
    if (hint) params.set('login_hint', hint);
    const suffix = params.toString();
    const result = await this.openOAuthAndPoll(`/auth/google/calendar${suffix ? `?${suffix}` : ''}`, operationEpoch);
    return this.persistAuthResult(result, operationEpoch);
  }

  private async openOAuthAndPoll(path: string, operationEpoch: number): Promise<any> {
    const response = await fetch(`${API_BASE_URL}${path}`);
    if (!response.ok) throw new Error('Failed to get auth URL from backend');

    const { url: authUrl, authSessionId } = await this.readJson(response);
    if (!authUrl || !authSessionId) {
      throw new Error('Authentication session was not created');
    }

    if (!this.isAuthOperationCurrent(operationEpoch)) {
      return { success: false, error: 'Authentication cancelled after logout' };
    }

    this.activeAuthSessionIds.set(authSessionId, operationEpoch);
    try {
      await shell.openExternal(authUrl);
      return await this.pollAuthSession(authSessionId, operationEpoch);
    } finally {
      this.activeAuthSessionIds.delete(authSessionId);
    }
  }

  private async pollAuthSession(authSessionId: string, operationEpoch: number): Promise<any> {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      if (
        !this.isAuthOperationCurrent(operationEpoch)
        || this.activeAuthSessionIds.get(authSessionId) !== operationEpoch
      ) {
        return { success: false, error: 'Authentication cancelled after logout' };
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      if (
        !this.isAuthOperationCurrent(operationEpoch)
        || this.activeAuthSessionIds.get(authSessionId) !== operationEpoch
      ) {
        return { success: false, error: 'Authentication cancelled after logout' };
      }

      const response = await fetch(`${API_BASE_URL}/auth/pending?authSessionId=${encodeURIComponent(authSessionId)}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Authentication session expired. Please try again.');
        }
        continue;
      }
      const result = await this.readJson(response);
      if (!result?.pending) {
        if (!this.isAuthOperationCurrent(operationEpoch)) {
          return { success: false, error: 'Authentication result ignored after logout' };
        }
        return result;
      }
    }

    throw new Error('Authentication timed out');
  }
}
