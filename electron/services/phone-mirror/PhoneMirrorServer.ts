/**
 * PhoneMirrorServer.ts
 * HTTP + WebSocket server for Phone Mirror.
 * Serves the mobile web client and handles real-time AI response streaming.
 * Cross-platform: uses only Node built-in modules + ws package.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { URL } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import crypto from 'crypto';
import type { WsMessage, ConnectedDevice } from './PhoneMirrorTypes';
import { PHONE_MIRROR_PORT, PHONE_MIRROR_HEARTBEAT_INTERVAL_MS } from './PhoneMirrorTypes';
import { PairingTokenManager } from './PairingTokenManager';
import { DeviceRegistry } from './DeviceRegistry';

interface AuthenticatedSocket extends WebSocket {
    deviceId?: string;
    deviceName?: string;
    isAlive?: boolean;
}

export class PhoneMirrorServer {
    private httpServer: http.Server | null = null;
    private wss: WebSocketServer | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private mobileClientHtml: string | null = null;
    private _isRunning = false;

    private readonly tokenManager: PairingTokenManager;
    private readonly deviceRegistry: DeviceRegistry;

    constructor(tokenManager: PairingTokenManager, deviceRegistry: DeviceRegistry) {
        this.tokenManager = tokenManager;
        this.deviceRegistry = deviceRegistry;
    }

    /**
     * Start the HTTP + WebSocket server.
     * @param lanAccess If true, binds to 0.0.0.0 (all interfaces). Otherwise 127.0.0.1.
     */
    async start(lanAccess: boolean = false): Promise<void> {
        if (this._isRunning) {
            console.log('[PhoneMirror] Server already running, stopping first...');
            await this.stop();
        }

        const host = lanAccess ? '0.0.0.0' : '127.0.0.1';
        const port = PHONE_MIRROR_PORT;

        // Preload the mobile client HTML
        this.loadMobileClient();

        // Create HTTP server
        this.httpServer = http.createServer((req, res) => {
            this.handleHttpRequest(req, res);
        });

        // Create WebSocket server attached to the HTTP server
        this.wss = new WebSocketServer({ server: this.httpServer });
        this.wss.on('connection', (ws: AuthenticatedSocket, req: http.IncomingMessage) => {
            this.handleWebSocketConnection(ws, req);
        });

        // Start heartbeat timer
        this.heartbeatTimer = setInterval(() => {
            this.pingAllClients();
        }, PHONE_MIRROR_HEARTBEAT_INTERVAL_MS);

        // Start device cleanup
        this.deviceRegistry.startCleanupTimer();

        // Bind and listen
        return new Promise<void>((resolve, reject) => {
            const server = this.httpServer!;

            server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`[PhoneMirror] Port ${port} is already in use`);
                    reject(new Error(`Port ${port} is already in use. Another application may be using it.`));
                } else {
                    console.error('[PhoneMirror] Server error:', err);
                    reject(err);
                }
            });

            server.listen(port, host, () => {
                this._isRunning = true;
                console.log(`[PhoneMirror] Server started on ${host}:${port}`);
                resolve();
            });
        });
    }

    /**
     * Stop the server and clean up all resources.
     */
    async stop(): Promise<void> {
        // Stop heartbeat
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        // Stop device cleanup
        this.deviceRegistry.stopCleanupTimer();

        // Close all WebSocket connections
        if (this.wss) {
            for (const ws of this.wss.clients) {
                try {
                    ws.close(1001, 'Server shutting down');
                } catch {
                    // Ignore close errors
                }
            }
            this.wss.close();
            this.wss = null;
        }

        // Close HTTP server
        if (this.httpServer) {
            await new Promise<void>((resolve) => {
                this.httpServer!.close(() => resolve());
            });
            this.httpServer = null;
        }

        // Clear devices
        this.deviceRegistry.clear();

        this._isRunning = false;
        console.log('[PhoneMirror] Server stopped');
    }

    /**
     * Broadcast a message to all authenticated WebSocket clients.
     */
    broadcast(message: WsMessage): void {
        if (!this.wss) {
            console.log('[PhoneMirror:WS] broadcast() called but wss is null — no server running');
            return;
        }

        const data = JSON.stringify(message);
        const totalClients = this.wss.clients.size;
        let sentCount = 0;
        let skippedCount = 0;

        for (const client of this.wss.clients) {
            const authClient = client as AuthenticatedSocket;
            if (authClient.readyState === WebSocket.OPEN && authClient.deviceId) {
                try {
                    authClient.send(data);
                    sentCount++;
                    console.log(`[PhoneMirror:WS] ✅ SENT to ${authClient.deviceName} (${authClient.deviceId}) | type=${message.type} | bytes=${data.length}`);
                } catch (err) {
                    console.warn(`[PhoneMirror:WS] ❌ SEND FAILED to ${authClient.deviceId}:`, err);
                }
            } else {
                skippedCount++;
                console.log(`[PhoneMirror:WS] ⏭️ SKIPPED client | readyState=${authClient.readyState} | deviceId=${authClient.deviceId || 'NONE'} | deviceName=${authClient.deviceName || 'NONE'}`);
            }
        }

        console.log(`[PhoneMirror:WS] broadcast() summary: total=${totalClients} sent=${sentCount} skipped=${skippedCount} | msgType=${message.type}`);
    }

    /**
     * Disconnect all connected clients.
     */
    disconnectAll(): void {
        if (!this.wss) return;

        for (const client of this.wss.clients) {
            try {
                client.close(1000, 'Disconnected by server');
            } catch {
                // Ignore
            }
        }
        this.deviceRegistry.clear();
    }

    /**
     * Check if the server is running.
     */
    get isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * Get the local IPv4 address for LAN access.
     * Prefers 192.168.x.x > 10.x.x.x > 172.16-31.x.x.
     * Cross-platform via os.networkInterfaces().
     */
    static getLocalIpAddress(): string | null {
        const interfaces = os.networkInterfaces();
        const candidates: Array<{ address: string; priority: number }> = [];

        for (const iface of Object.values(interfaces)) {
            if (!iface) continue;
            for (const info of iface) {
                if (info.family !== 'IPv4' || info.internal) continue;

                let priority = 0;
                if (info.address.startsWith('192.168.')) {
                    priority = 3; // Most common home/office network
                } else if (info.address.startsWith('10.')) {
                    priority = 2;
                } else if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(info.address)) {
                    priority = 1;
                }

                if (priority > 0) {
                    candidates.push({ address: info.address, priority });
                }
            }
        }

        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.priority - a.priority);
        return candidates[0].address;
    }

    // ── Private Methods ──────────────────────────────────────────────────

    private loadMobileClient(): void {
        // __dirname at runtime points to dist-electron/electron/services/phone-mirror/
        // but mobile-client.html stays in the source tree since it's not a .ts file.
        // We try multiple candidate paths for both dev and production:
        const candidates = [
            path.join(__dirname, 'mobile-client.html'),                                           // Production (bundled alongside compiled JS)
            path.join(process.cwd(), 'electron', 'services', 'phone-mirror', 'mobile-client.html'), // Dev (source tree from project root)
        ];

        // Also try via app.getAppPath() if available (packaged Electron apps)
        try {
            const { app } = require('electron');
            candidates.push(
                path.join(app.getAppPath(), 'electron', 'services', 'phone-mirror', 'mobile-client.html')
            );
        } catch {
            // app may not be available in all contexts
        }

        for (const candidatePath of candidates) {
            try {
                if (fs.existsSync(candidatePath)) {
                    this.mobileClientHtml = fs.readFileSync(candidatePath, 'utf-8');
                    console.log(`[PhoneMirror] Mobile client loaded from ${candidatePath} (${this.mobileClientHtml.length} bytes)`);
                    return;
                }
            } catch {
                // Try next candidate
            }
        }

        console.error('[PhoneMirror] mobile-client.html not found in any candidate path:', candidates);
        this.mobileClientHtml = '<html><body><h1>Phone Mirror</h1><p>Mobile client failed to load.</p></body></html>';
    }

    private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = req.url || '/';

        if (url === '/' || url.startsWith('/?')) {
            // Serve mobile client
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Content-Type-Options': 'nosniff',
            });
            res.end(this.mobileClientHtml || '');
            return;
        }

        if (url === '/api/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                version: '1.0.0',
                connections: this.deviceRegistry.getDeviceCount(),
            }));
            return;
        }

        // 404 for everything else
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }

    private handleWebSocketConnection(ws: AuthenticatedSocket, req: http.IncomingMessage): void {
        // Parse token from query string
        const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const token = reqUrl.searchParams.get('token');

        // Validate token
        if (!token || !this.tokenManager.validateToken(token)) {
            console.log('[PhoneMirror] Connection rejected: invalid token');
            const rejectMsg: WsMessage = {
                type: 'pairing_result',
                payload: { success: false, error: 'Invalid pairing token' },
                timestamp: Date.now(),
            };
            ws.send(JSON.stringify(rejectMsg));
            ws.close(4401, 'Invalid token');
            return;
        }

        // Generate device ID and register
        const deviceId = crypto.randomBytes(8).toString('hex');
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const deviceName = this.parseDeviceName(userAgent);

        ws.deviceId = deviceId;
        ws.deviceName = deviceName;
        ws.isAlive = true;

        this.deviceRegistry.registerDevice(deviceId, deviceName);

        // Send pairing success
        const successMsg: WsMessage = {
            type: 'pairing_result',
            payload: { success: true, deviceId },
            timestamp: Date.now(),
        };
        ws.send(JSON.stringify(successMsg));

        // Handle pong (heartbeat response)
        ws.on('pong', () => {
            ws.isAlive = true;
            this.deviceRegistry.updateHeartbeat(deviceId);
        });

        // Handle close
        ws.on('close', () => {
            console.log(`[PhoneMirror] Device disconnected: ${deviceName} (${deviceId})`);
            this.deviceRegistry.removeDevice(deviceId);
        });

        // Handle errors
        ws.on('error', (err) => {
            console.warn(`[PhoneMirror] WebSocket error for ${deviceName}:`, err.message);
        });

        // Handle incoming messages (client → server)
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'heartbeat') {
                    ws.isAlive = true;
                    this.deviceRegistry.updateHeartbeat(deviceId);
                }
            } catch {
                // Ignore malformed messages
            }
        });

        console.log(`[PhoneMirror] Device connected: ${deviceName} (${deviceId})`);
    }

    private pingAllClients(): void {
        if (!this.wss) return;

        for (const client of this.wss.clients) {
            const authClient = client as AuthenticatedSocket;
            if (authClient.isAlive === false) {
                // Didn't respond to last ping — terminate
                console.log(`[PhoneMirror] Terminating unresponsive client: ${authClient.deviceName}`);
                this.deviceRegistry.removeDevice(authClient.deviceId || '');
                authClient.terminate();
                continue;
            }

            authClient.isAlive = false;
            authClient.ping();
        }
    }

    private parseDeviceName(userAgent: string): string {
        if (/iPhone/i.test(userAgent)) return 'iPhone';
        if (/iPad/i.test(userAgent)) return 'iPad';
        if (/Android/i.test(userAgent)) return 'Android';
        if (/Mac/i.test(userAgent)) return 'Mac';
        if (/Windows/i.test(userAgent)) return 'Windows';
        if (/Linux/i.test(userAgent)) return 'Linux';
        return 'Unknown Device';
    }
}
