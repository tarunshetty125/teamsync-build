/**
 * GoogleAuthManager
 * 
 * Handles ONLY Google OAuth authentication + Calendar connectivity.
 * Uses the backend server for OAuth exchange and MongoDB user storage.
 * 
 * License verification is NOT handled here — it's in ipcHandlers.ts
 */

import { shell, ipcMain, BrowserWindow } from 'electron';

const BACKEND_URL = 'http://localhost:3456';

export class GoogleAuthManager {
  private static instance: GoogleAuthManager;
  private pendingResolve: ((result: any) => void) | null = null;

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
        const response = await fetch(`${BACKEND_URL}/auth/me`, {
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
        // Broadcast calendar status change to all windows (Launcher + Settings sync)
        this.broadcast('calendar-status-changed', { connected: true, email: loginHint });
        return result;
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    // ────────────── Calendar Events ──────────────
    ipcMain.handle('auth:calendar-events', async (_event, token: string) => {
      try {
        const response = await fetch(`${BACKEND_URL}/auth/calendar/events`, {
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
          await fetch(`${BACKEND_URL}/auth/logout`, {
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
    return new Promise(async (resolve, reject) => {
      try {
        const response = await fetch(`${BACKEND_URL}/auth/google`);
        if (!response.ok) throw new Error('Failed to get auth URL from backend');

        const { url: authUrl } = await response.json();

        this.pendingResolve = resolve;

        // Timeout after 3 minutes
        setTimeout(() => {
          if (this.pendingResolve) {
            this.pendingResolve = null;
            reject(new Error('Authentication timed out'));
          }
        }, 180000);

        await shell.openExternal(authUrl);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Connect calendar with incremental scope
   */
  private async connectCalendar(loginHint: string): Promise<any> {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await fetch(
          `${BACKEND_URL}/auth/google/calendar?login_hint=${encodeURIComponent(loginHint)}`
        );
        if (!response.ok) throw new Error('Failed to get calendar auth URL');

        const { url: authUrl } = await response.json();

        this.pendingResolve = resolve;

        setTimeout(() => {
          if (this.pendingResolve) {
            this.pendingResolve = null;
            reject(new Error('Authentication timed out'));
          }
        }, 180000);

        await shell.openExternal(authUrl);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Broadcast auth result to all renderer windows
   */
  public broadcastAuthResult(result: any): void {
    this.broadcast('auth:result', result);

    if (this.pendingResolve) {
      this.pendingResolve(result);
      this.pendingResolve = null;
    }
  }
}
