/**
 * GoogleAuthManager
 * 
 * Handles ONLY Google OAuth authentication + Calendar connectivity.
 * Uses the backend server for OAuth exchange and MongoDB user storage.
 * 
 * License verification is NOT handled here — it's in ipcHandlers.ts
 */

import { shell, ipcMain, BrowserWindow } from 'electron';
import { API_BASE_URL } from '../../src/lib/config/apiConfig';

export class GoogleAuthManager {
  private static instance: GoogleAuthManager;

  private constructor() {}

  public static getInstance(): GoogleAuthManager {
    if (!GoogleAuthManager.instance) {
      GoogleAuthManager.instance = new GoogleAuthManager();
    }
    return GoogleAuthManager.instance;
  }

  /**
   * Broadcast a channel+data to ALL renderer windows
   */
  private broadcast(channel: string, ...args: any[]): void {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    });
  }

  /**
   * Setup IPC handlers for auth-related events (Google Auth + Calendar ONLY)
   */
  public setupIpcHandlers(): void {
    // ────────────── Google Sign-In ──────────────
    ipcMain.handle('auth:google-signin', async () => {
      try {
        return await this.startSignIn();
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // ────────────── Verify Token ──────────────
    ipcMain.handle('auth:verify-token', async (_event, token: string) => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const user = await response.json();
          return { success: true, user };
        }
        return { success: false, error: 'Invalid token' };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // ────────────── Calendar Connect (broadcasts state) ──────────────
    ipcMain.handle('auth:connect-calendar', async (_event, loginHint: string) => {
      try {
        const result = await this.connectCalendar(loginHint);
        if (result?.success) {
          this.broadcast('calendar-status-changed', { connected: true, email: result.user?.email || loginHint });
        }
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // ────────────── Calendar Events ──────────────
    ipcMain.handle('auth:calendar-events', async (_event, token: string) => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/calendar/events`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          return await response.json();
        }

        const err = await response.json();
        return { success: false, error: err.error };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // ────────────── Logout (clears calendar tokens) ──────────────
    ipcMain.handle('auth:logout', async (_event, token?: string) => {
      try {
        // Call backend to clear calendar tokens in MongoDB
        if (token) {
          await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }).catch(() => {}); // Best-effort
        }

        // Broadcast calendar disconnected + auth cleared to all windows
        this.broadcast('calendar-status-changed', { connected: false, email: null });
        this.broadcast('auth:logged-out');

        return { success: true };
      } catch (error: any) {
        return { success: true }; // Always succeed client-side
      }
    });
  }

  /**
   * Start Google sign-in by opening the OAuth URL in the default browser
   */
  private async startSignIn(): Promise<any> {
    return this.openOAuthAndPoll('/auth/google');
  }

  /**
   * Connect calendar with incremental scope
   */
  private async connectCalendar(loginHint: string): Promise<any> {
    const params = new URLSearchParams();
    if (loginHint) params.set('login_hint', loginHint);
    const suffix = params.toString();
    return this.openOAuthAndPoll(`/auth/google/calendar${suffix ? `?${suffix}` : ''}`);
  }

  private async openOAuthAndPoll(path: string): Promise<any> {
    const response = await fetch(`${API_BASE_URL}${path}`);
    if (!response.ok) throw new Error('Failed to get auth URL from backend');

    const { url: authUrl, authSessionId } = await response.json();
    if (!authUrl || !authSessionId) {
      throw new Error('Authentication session was not created');
    }

    await shell.openExternal(authUrl);
    return this.pollAuthSession(authSessionId);
  }

  private async pollAuthSession(authSessionId: string): Promise<any> {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await fetch(`${API_BASE_URL}/auth/pending?authSessionId=${encodeURIComponent(authSessionId)}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Authentication session expired. Please try again.');
        }
        continue;
      }
      const result = await response.json();
      if (!result?.pending) {
        return result;
      }
    }

    throw new Error('Authentication timed out');
  }
}
