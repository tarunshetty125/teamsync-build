/**
 * PhoneMirrorManager.ts
 * Central orchestrator for the Phone Mirror feature.
 * Singleton pattern matching existing TeamSync services (StealthManager, ModesManager).
 *
 * Responsibilities:
 * - Start/stop the HTTP + WS server
 * - Generate and expose QR codes
 * - Subscribe to IntelligenceManager AI response events
 * - Broadcast AI responses to connected phone clients
 * - Persist settings via SettingsManager
 */

import QRCode from 'qrcode';
import type { WsMessage, AiResponsePayload, PhoneMirrorState, PhoneMirrorSettings } from './PhoneMirrorTypes';
import { PHONE_MIRROR_PORT } from './PhoneMirrorTypes';
import { PairingTokenManager } from './PairingTokenManager';
import { DeviceRegistry } from './DeviceRegistry';
import { PhoneMirrorServer } from './PhoneMirrorServer';

export class PhoneMirrorManager {
    private static instance: PhoneMirrorManager | null = null;

    private readonly tokenManager: PairingTokenManager;
    private readonly deviceRegistry: DeviceRegistry;
    private readonly server: PhoneMirrorServer;

    private _enabled = false;
    private _lanAccess = false;
    private _qrCodeCache: string | null = null;
    private _qrCodeCacheKey: string | null = null;
    private _notifyDebounce: ReturnType<typeof setTimeout> | null = null;

    // IntelligenceManager event listener references for clean unsubscribe
    private _aiTokenListener: ((...args: any[]) => void) | null = null;
    private _aiResultListener: ((...args: any[]) => void) | null = null;
    private _intelligenceManager: any = null; // Typed as EventEmitter internally

    // Broadcast callback for state changes to renderer
    private _broadcastStateChange: ((state: PhoneMirrorState) => void) | null = null;

    private constructor() {
        // Load persisted settings
        const settings = this.loadSettings();
        this._lanAccess = settings.lanAccess ?? false;

        this.tokenManager = new PairingTokenManager(settings.lastToken);
        this.deviceRegistry = new DeviceRegistry();
        this.server = new PhoneMirrorServer(this.tokenManager, this.deviceRegistry);
    }

    static getInstance(): PhoneMirrorManager {
        if (!PhoneMirrorManager.instance) {
            PhoneMirrorManager.instance = new PhoneMirrorManager();
        }
        return PhoneMirrorManager.instance;
    }

    /**
     * Provide the IntelligenceManager reference for AI event subscription.
     * Called once from main.ts after both are initialized.
     */
    setIntelligenceManager(im: any): void {
        this._intelligenceManager = im;
    }

    /**
     * Set a callback that broadcasts state changes to all renderer windows.
     */
    setBroadcastCallback(cb: (state: PhoneMirrorState) => void): void {
        this._broadcastStateChange = cb;
    }

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Enable Phone Mirror: start server, generate token, subscribe to AI events.
     */
    async enable(): Promise<{ success: boolean; error?: string }> {
        if (this._enabled && this.server.isRunning) {
            return { success: true };
        }

        try {
            // Ensure we have a token
            this.tokenManager.generateToken();

            // Start the server
            await this.server.start(this._lanAccess);

            // Subscribe to AI events
            this.subscribeToAiEvents();

            this._enabled = true;
            this._qrCodeCache = null; // Invalidate QR cache

            // Persist
            this.saveSettings();

            // Notify renderer
            this.notifyStateChange();

            console.log('[PhoneMirror] Enabled');
            return { success: true };
        } catch (err: any) {
            console.error('[PhoneMirror] Failed to enable:', err);
            return { success: false, error: err.message || 'Failed to start Phone Mirror server' };
        }
    }

    /**
     * Disable Phone Mirror: stop server, unsubscribe from AI events.
     */
    async disable(): Promise<{ success: boolean }> {
        this.unsubscribeFromAiEvents();
        await this.server.stop();

        this._enabled = false;
        this._qrCodeCache = null;

        // Persist
        this.saveSettings();

        // Notify renderer
        this.notifyStateChange();

        console.log('[PhoneMirror] Disabled');
        return { success: true };
    }

    /**
     * Get the full state snapshot for the renderer.
     */
    getState(): PhoneMirrorState {
        return {
            enabled: this._enabled,
            lanAccess: this._lanAccess,
            port: PHONE_MIRROR_PORT,
            pairingUrl: this._enabled ? this.buildPairingUrl() : null,
            connectedDeviceCount: this.deviceRegistry.getDeviceCount(),
            connectedDevices: this.deviceRegistry.getDevices(),
        };
    }

    /**
     * Get the QR code as a data URL (PNG base64).
     */
    async getQrCode(): Promise<string | null> {
        if (!this._enabled) return null;

        const url = this.buildPairingUrl();
        if (!url) return null;

        // Cache QR code (regenerate only when URL changes)
        if (this._qrCodeCache && this._qrCodeCacheKey === url) {
            return this._qrCodeCache;
        }

        try {
            const dataUrl = await QRCode.toDataURL(url, {
                width: 256,
                margin: 2,
                color: {
                    dark: '#ffffff',
                    light: '#0a0a0f',
                },
                errorCorrectionLevel: 'M',
            });
            this._qrCodeCache = dataUrl;
            this._qrCodeCacheKey = url;
            return dataUrl;
        } catch (err) {
            console.error('[PhoneMirror] Failed to generate QR code:', err);
            return null;
        }
    }

    /**
     * Get the pairing URL.
     */
    getPairingUrl(): string | null {
        if (!this._enabled) return null;
        return this.buildPairingUrl();
    }

    /**
     * Get connected devices.
     */
    getConnectedDevices() {
        return this.deviceRegistry.getDevices();
    }

    /**
     * Toggle LAN access. Restarts the server if it's running.
     */
    async setLanAccess(enabled: boolean): Promise<{ success: boolean; error?: string }> {
        if (this._lanAccess === enabled) return { success: true }; // No-op if unchanged

        this._lanAccess = enabled;
        this._qrCodeCache = null; // URL will change

        if (this._enabled && this.server.isRunning) {
            // Restart server on new bind address
            try {
                await this.server.stop();
                await this.server.start(this._lanAccess);
            } catch (err: any) {
                console.error('[PhoneMirror] Failed to restart server for LAN toggle:', err);
                return { success: false, error: err.message };
            }
        }

        this.saveSettings();
        this.notifyStateChange();

        return { success: true };
    }

    /**
     * Disconnect all connected devices.
     */
    disconnectAll(): void {
        this.server.disconnectAll();
        this.notifyStateChange();
    }

    /**
     * Clean up on app quit.
     */
    async shutdown(): Promise<void> {
        this.unsubscribeFromAiEvents();
        await this.server.stop();
        this._qrCodeCache = null;
    }

    /**
     * Auto-restore: if settings say enabled, re-enable on app startup.
     * Called from main.ts after app.whenReady().
     */
    async autoRestore(): Promise<void> {
        const settings = this.loadSettings();
        if (settings.enabled) {
            console.log('[PhoneMirror] Auto-restoring from persisted settings...');
            await this.enable().catch((err) => {
                console.warn('[PhoneMirror] Auto-restore failed:', err);
            });
        }
    }

    // ── AI Event Integration ─────────────────────────────────────────────

    private subscribeToAiEvents(): void {
        if (!this._intelligenceManager) {
            console.warn('[PhoneMirror:AI] ❌ No IntelligenceManager available — AI events will NOT reach phones');
            return;
        }

        // Verify the IM is actually an EventEmitter
        console.log(`[PhoneMirror:AI] IntelligenceManager type: ${typeof this._intelligenceManager}, hasOn: ${typeof this._intelligenceManager.on}, hasEmit: ${typeof this._intelligenceManager.emit}`);
        const listenerCountBefore = this._intelligenceManager.listenerCount?.('action_token') ?? 'N/A';
        console.log(`[PhoneMirror:AI] Current action_token listener count BEFORE subscribe: ${listenerCountBefore}`);

        // Streaming token
        this._aiTokenListener = (payload: any) => {
            const deviceCount = this.deviceRegistry.getDeviceCount();
            const wsClients = (this.server as any).wss?.clients?.size ?? 0;
            console.log(`[PhoneMirror:AI] 🔥 action_token RECEIVED | intent=${payload?.intent} | requestId=${payload?.requestId} | tokenLen=${payload?.token?.length ?? 0} | devices=${deviceCount} | wsClients=${wsClients} | serverRunning=${this.server.isRunning}`);
            if (!payload?.token) {
                console.log('[PhoneMirror:AI] ⚠️ action_token skipped — payload.token is falsy');
                return;
            }
            const msg: WsMessage<AiResponsePayload> = {
                type: 'ai_response',
                payload: {
                    content: payload.token,
                    streaming: true,
                    intent: payload.intent,
                    requestId: payload.requestId,
                },
                timestamp: Date.now(),
            };
            console.log(`[PhoneMirror:AI] → Broadcasting token to ${deviceCount} devices (${wsClients} ws clients)`);
            this.server.broadcast(msg);
        };

        // Final result
        this._aiResultListener = (payload: any) => {
            const deviceCount = this.deviceRegistry.getDeviceCount();
            const wsClients = (this.server as any).wss?.clients?.size ?? 0;
            console.log(`[PhoneMirror:AI] 🏁 action_result RECEIVED | intent=${payload?.intent} | requestId=${payload?.requestId} | contentLen=${payload?.content?.length ?? 0} | devices=${deviceCount} | wsClients=${wsClients}`);
            if (!payload?.content) {
                console.log('[PhoneMirror:AI] ⚠️ action_result skipped — payload.content is falsy');
                return;
            }
            const msg: WsMessage<AiResponsePayload> = {
                type: 'ai_response',
                payload: {
                    content: payload.content,
                    streaming: false,
                    intent: payload.intent,
                    requestId: payload.requestId,
                },
                timestamp: Date.now(),
            };
            console.log(`[PhoneMirror:AI] → Broadcasting result to ${deviceCount} devices (${wsClients} ws clients)`);
            this.server.broadcast(msg);
        };

        this._intelligenceManager.on('action_token', this._aiTokenListener);
        this._intelligenceManager.on('action_result', this._aiResultListener);

        const listenerCountAfter = this._intelligenceManager.listenerCount?.('action_token') ?? 'N/A';
        console.log(`[PhoneMirror:AI] ✅ Subscribed to IntelligenceManager AI events | action_token listeners AFTER: ${listenerCountAfter}`);
    }

    private unsubscribeFromAiEvents(): void {
        if (this._intelligenceManager) {
            if (this._aiTokenListener) {
                this._intelligenceManager.off('action_token', this._aiTokenListener);
                this._aiTokenListener = null;
            }
            if (this._aiResultListener) {
                this._intelligenceManager.off('action_result', this._aiResultListener);
                this._aiResultListener = null;
            }
        }
    }

    // ── Private Helpers ──────────────────────────────────────────────────

    private buildPairingUrl(): string {
        const token = this.tokenManager.getToken();
        let host: string;

        if (this._lanAccess) {
            const localIp = PhoneMirrorServer.getLocalIpAddress();
            host = localIp || '127.0.0.1';
        } else {
            host = '127.0.0.1';
        }

        return `http://${host}:${PHONE_MIRROR_PORT}?token=${token}`;
    }

    private notifyStateChange(): void {
        // Debounce to prevent rapid-fire broadcasts (e.g. toggle spam)
        if (this._notifyDebounce) clearTimeout(this._notifyDebounce);
        this._notifyDebounce = setTimeout(() => {
            this._notifyDebounce = null;
            if (this._broadcastStateChange) {
                try {
                    this._broadcastStateChange(this.getState());
                } catch (err) {
                    console.warn('[PhoneMirror] Failed to broadcast state change:', err);
                }
            }
        }, 100);
    }

    private loadSettings(): PhoneMirrorSettings {
        try {
            const { SettingsManager } = require('../SettingsManager');
            const settings = SettingsManager.getInstance().get('phoneMirror');
            return settings || {};
        } catch {
            return {};
        }
    }

    private saveSettings(): void {
        try {
            const { SettingsManager } = require('../SettingsManager');
            SettingsManager.getInstance().set('phoneMirror', {
                enabled: this._enabled,
                lanAccess: this._lanAccess,
                lastToken: this.tokenManager.getToken() || undefined,
            });
        } catch (err) {
            console.warn('[PhoneMirror] Failed to persist settings:', err);
        }
    }
}
