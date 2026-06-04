/**
 * GoogleAuthManager
 *
 * Handles Google OAuth authentication and Calendar connectivity through the
 * hosted backend. JWT ownership stays in Electron main process storage.
 */

import { shell, ipcMain, BrowserWindow } from 'electron';
import { API_BASE_URL } from '../../src/lib/config/apiConfig';
import { CredentialsManager, type GoogleAuthUser, type TeamSyncOnboardingV1 } from './CredentialsManager';

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

type TeamSyncOnboardingV1Input = {
  persona: string;
  industry: string;
  discoverySource: string;
  onboardingVersion?: 1;
  completedInVersion?: string;
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

    safeHandle('auth:onboarding-v1', async (_event, payload: TeamSyncOnboardingV1Input) => {
      return this.saveOnboardingV1(payload);
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

  private sanitizeOnboardingV1(input: any, fallback?: TeamSyncOnboardingV1 | null): TeamSyncOnboardingV1 | null | undefined {
    if (input === null) return null;
    if (!input || typeof input !== 'object') return fallback;
    if (input.onboardingVersion !== 1) return fallback;

    const persona = typeof input.persona === 'string' ? input.persona.trim() : '';
    const industry = typeof input.industry === 'string' ? input.industry.trim() : '';
    const discoverySource = typeof input.discoverySource === 'string' ? input.discoverySource.trim() : '';
    const completedAt = typeof input.completedAt === 'string'
      ? input.completedAt
      : input.completedAt instanceof Date
        ? input.completedAt.toISOString()
        : '';
    const completedInVersion = typeof input.completedInVersion === 'string'
      ? input.completedInVersion.trim()
      : '';

    if (!persona || !industry || !discoverySource || !completedAt || !completedInVersion) return fallback;

    return {
      persona,
      industry,
      discoverySource,
      completedAt,
      onboardingVersion: 1,
      completedInVersion,
    };
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
    const id = typeof input?.id === 'string' && input.id.trim()
      ? input.id.trim()
      : fallback?.id;
    const googleId = typeof input?.googleId === 'string' && input.googleId.trim()
      ? input.googleId.trim()
      : fallback?.googleId;
    const onboardingV1 = this.sanitizeOnboardingV1(input?.onboardingV1, fallback?.onboardingV1);

    return {
      ...(id ? { id } : {}),
      ...(googleId ? { googleId } : {}),
      name,
      email,
      ...(picture ? { picture } : {}),
      calendarConnected,
      ...(typeof input?.isNewUser === 'boolean' ? { isNewUser: input.isNewUser } : {}),
      ...(onboardingV1 !== undefined ? { onboardingV1 } : {}),
    };
  }

  private async readJson(response: Response): Promise<any> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private async fetchAuthoritativeUser(token: string, fallback?: GoogleAuthUser): Promise<GoogleAuthUser | undefined> {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      return this.sanitizeUser(await this.readJson(response), fallback);
    }

    if (response.status === 401 || response.status === 403) {
      this.clearLocalAuthAndBroadcast();
    }

    const err = await this.readJson(response);
    throw new Error(err.error || 'Invalid or expired token');
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

    const authoritativeUser = await this.fetchAuthoritativeUser(token, user);
    if (!authoritativeUser) {
      return { success: false, error: 'Authentication completed without a verified user profile', authState: this.getAuthState() };
    }

    this.credentials.updateGoogleAuthUser(authoritativeUser);
    const authState = this.getAuthState(authoritativeUser);
    this.broadcast('auth:result', { success: true, user: authoritativeUser, authState });
    this.broadcast('calendar-status-changed', { connected: authoritativeUser.calendarConnected, email: authoritativeUser.email });

    return { success: true, user: authoritativeUser, authState };
  }

  private async verifySession(): Promise<GoogleAuthResult> {
    const token = this.getStoredToken();
    if (!token) {
      return { success: false, error: 'Not authenticated', authState: this.getAuthState() };
    }

    try {
      const user = await this.fetchAuthoritativeUser(token, this.credentials.getGoogleAuthUser());
      if (!user) {
        return { success: false, error: 'Invalid user profile', authState: this.getAuthState() };
      }

      this.credentials.updateGoogleAuthUser(user);
      const authState = this.getAuthState(user);
      this.broadcast('calendar-status-changed', { connected: user.calendarConnected, email: user.email });
      return { success: true, user, authState };
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

  private async saveOnboardingV1(payload: TeamSyncOnboardingV1Input): Promise<GoogleAuthResult> {
    const token = this.getStoredToken();
    if (!token) {
      console.error('[GoogleAuthManager] onboarding-v1 save blocked: missing stored token');
      return { success: false, error: 'Not authenticated', authState: this.getAuthState() };
    }

    try {
      console.info('[GoogleAuthManager] onboarding-v1 save request', {
        persona: payload?.persona,
        industry: payload?.industry,
        discoverySource: payload?.discoverySource,
      });
      const response = await fetch(`${API_BASE_URL}/auth/onboarding-v1`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          persona: payload?.persona,
          industry: payload?.industry,
          discoverySource: payload?.discoverySource,
          onboardingVersion: 1,
          completedInVersion: '1.0.0',
        }),
      });
      const body = await this.readJson(response);
      console.info('[GoogleAuthManager] onboarding-v1 response', {
        status: response.status,
        ok: response.ok,
        error: body?.error,
        hasUser: Boolean(body?.user),
        onboardingVersion: body?.onboardingV1?.onboardingVersion ?? body?.user?.onboardingV1?.onboardingVersion,
      });

      if (response.status === 401 || response.status === 403) {
        console.error('[GoogleAuthManager] onboarding-v1 auth failure', {
          status: response.status,
          error: body?.error,
        });
        this.clearLocalAuthAndBroadcast();
        return {
          success: false,
          error: body.error || 'Invalid or expired token',
          authState: this.getAuthState(),
        };
      }

      if (!response.ok) {
        console.error('[GoogleAuthManager] onboarding-v1 API failure', {
          status: response.status,
          error: body?.error,
          body,
        });
        return {
          success: false,
          error: body.error || 'Failed to save onboarding',
          authState: this.getAuthState(),
        };
      }

      const user = this.sanitizeUser(body.user, this.credentials.getGoogleAuthUser());
      const completedOnboarding = this.sanitizeOnboardingV1(body.onboardingV1, user?.onboardingV1 ?? null);
      if (!user?.onboardingV1 || user.onboardingV1.onboardingVersion !== 1 || completedOnboarding?.onboardingVersion !== 1) {
        console.error('[GoogleAuthManager] onboarding-v1 completion confirmation failed', {
          userEmail: user?.email,
          userOnboardingVersion: user?.onboardingV1?.onboardingVersion,
          responseOnboardingVersion: completedOnboarding?.onboardingVersion,
          body,
        });
        return {
          success: false,
          error: 'Onboarding save did not return a completed profile',
          authState: this.getAuthState(),
        };
      }

      this.credentials.updateGoogleAuthUser(user);
      const authState = this.getAuthState(user);
      this.broadcast('auth:result', { success: true, user, authState });
      return { success: true, user, authState };
    } catch (error: any) {
      console.error('[GoogleAuthManager] onboarding-v1 save exception', {
        message: error?.message,
        stack: error?.stack,
      });
      return {
        success: false,
        error: error.message || 'Failed to save onboarding',
        authState: this.getAuthState(),
      };
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
