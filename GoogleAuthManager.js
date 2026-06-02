var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var GoogleAuthManager_exports = {};
__export(GoogleAuthManager_exports, {
  GoogleAuthManager: () => GoogleAuthManager
});
module.exports = __toCommonJS(GoogleAuthManager_exports);
var import_electron = require("electron");
const BACKEND_URL = "http://localhost:3456";
class GoogleAuthManager {
  static instance;
  pendingResolve = null;
  constructor() {
  }
  static getInstance() {
    if (!GoogleAuthManager.instance) {
      GoogleAuthManager.instance = new GoogleAuthManager();
    }
    return GoogleAuthManager.instance;
  }
  /**
   * Broadcast a channel+data to ALL renderer windows
   */
  broadcast(channel, ...args) {
    import_electron.BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    });
  }
  /**
   * Setup IPC handlers for auth-related events (Google Auth + Calendar ONLY)
   */
  setupIpcHandlers() {
    import_electron.ipcMain.handle("auth:google-signin", async () => {
      try {
        return await this.startSignIn();
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    import_electron.ipcMain.handle("auth:verify-token", async (_event, token) => {
      try {
        const response = await fetch(`${BACKEND_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok) {
          const user = await response.json();
          return { success: true, user };
        }
        return { success: false, error: "Invalid token" };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    import_electron.ipcMain.handle("auth:connect-calendar", async (_event, loginHint) => {
      try {
        const result = await this.connectCalendar(loginHint);
        this.broadcast("calendar-status-changed", { connected: true, email: loginHint });
        return result;
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    import_electron.ipcMain.handle("auth:calendar-events", async (_event, token) => {
      try {
        const response = await fetch(`${BACKEND_URL}/auth/calendar/events`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok) {
          return await response.json();
        }
        const err = await response.json();
        return { success: false, error: err.error };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
    import_electron.ipcMain.handle("auth:logout", async (_event, token) => {
      try {
        if (token) {
          await fetch(`${BACKEND_URL}/auth/logout`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            }
          }).catch(() => {
          });
        }
        this.broadcast("calendar-status-changed", { connected: false, email: null });
        this.broadcast("auth:logged-out");
        return { success: true };
      } catch (error) {
        return { success: true };
      }
    });
  }
  /**
   * Start Google sign-in by opening the OAuth URL in the default browser
   */
  async startSignIn() {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await fetch(`${BACKEND_URL}/auth/google`);
        if (!response.ok) throw new Error("Failed to get auth URL from backend");
        const { url: authUrl } = await response.json();
        this.pendingResolve = resolve;
        setTimeout(() => {
          if (this.pendingResolve) {
            this.pendingResolve = null;
            reject(new Error("Authentication timed out"));
          }
        }, 18e4);
        await import_electron.shell.openExternal(authUrl);
      } catch (error) {
        reject(error);
      }
    });
  }
  /**
   * Connect calendar with incremental scope
   */
  async connectCalendar(loginHint) {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await fetch(
          `${BACKEND_URL}/auth/google/calendar?login_hint=${encodeURIComponent(loginHint)}`
        );
        if (!response.ok) throw new Error("Failed to get calendar auth URL");
        const { url: authUrl } = await response.json();
        this.pendingResolve = resolve;
        setTimeout(() => {
          if (this.pendingResolve) {
            this.pendingResolve = null;
            reject(new Error("Authentication timed out"));
          }
        }, 18e4);
        await import_electron.shell.openExternal(authUrl);
      } catch (error) {
        reject(error);
      }
    });
  }
  /**
   * Broadcast auth result to all renderer windows
   */
  broadcastAuthResult(result) {
    this.broadcast("auth:result", result);
    if (this.pendingResolve) {
      this.pendingResolve(result);
      this.pendingResolve = null;
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GoogleAuthManager
});
//# sourceMappingURL=GoogleAuthManager.js.map
