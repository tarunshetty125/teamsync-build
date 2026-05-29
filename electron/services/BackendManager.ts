/**
 * BackendManager — Production backend lifecycle manager.
 *
 * Responsible for:
 * 1. Seeding backend credentials on first launch (via CredentialsManager)
 * 2. Spawning the backend server as a child process
 * 3. Health-checking localhost:3456
 * 4. Killing the backend on app quit
 *
 * ONLY active when app.isPackaged === true.
 * In development, all methods are no-ops — dev workflow is unchanged.
 */

import { app } from 'electron';
import path from 'path';
import { fork, type ChildProcess } from 'child_process';

const BACKEND_PORT = 3456;
const HEALTH_URL = `http://localhost:${BACKEND_PORT}/health`;
const HEALTH_TIMEOUT_MS = 20000;
const HEALTH_POLL_MS = 500;

export class BackendManager {
    private static instance: BackendManager;
    private backendProcess: ChildProcess | null = null;
    private started = false;

    private constructor() {}

    public static getInstance(): BackendManager {
        if (!BackendManager.instance) {
            BackendManager.instance = new BackendManager();
        }
        return BackendManager.instance;
    }

    /**
     * Start the backend server.
     * No-op in development mode (app.isPackaged === false).
     *
     * Flow:
     * 1. Seed credentials if missing (first launch only)
     * 2. Build env vars from CredentialsManager
     * 3. Fork the backend server process
     * 4. Wait for health check to pass
     *
     * Throws if backend fails to start or health check times out.
     */
    public async start(): Promise<void> {
        if (!app.isPackaged) {
            console.log('[BackendManager] Dev mode — skipping backend auto-start');
            return;
        }

        if (this.started) {
            console.log('[BackendManager] Already started');
            return;
        }

        console.log('[BackendManager] Starting production backend...');

        // 1. Ensure credentials exist (seed on first launch)
        this.ensureCredentials();

        // 2. Build environment variables from secure storage
        const backendEnv = this.buildBackendEnv();

        // 3. Locate the bundled backend server
        const serverPath = this.resolveServerPath();
        console.log(`[BackendManager] Server path: ${serverPath}`);

        // 4. Spawn the backend process
        this.spawnBackend(serverPath, backendEnv);

        // 5. Wait for health check
        await this.waitForHealthy();

        this.started = true;
        console.log('[BackendManager] Backend is healthy and ready');
    }

    /**
     * Stop the backend server and clean up the child process.
     */
    public stop(): void {
        if (!this.backendProcess) return;

        console.log('[BackendManager] Stopping backend server...');

        try {
            // Try graceful SIGTERM first
            this.backendProcess.kill('SIGTERM');

            // Force kill after 3 seconds if still alive
            const forceKillTimeout = setTimeout(() => {
                if (this.backendProcess && !this.backendProcess.killed) {
                    console.log('[BackendManager] Force killing backend...');
                    try {
                        // tree-kill is already in project dependencies
                        const treeKill = require('tree-kill');
                        treeKill(this.backendProcess.pid!, 'SIGKILL');
                    } catch {
                        this.backendProcess.kill('SIGKILL');
                    }
                }
            }, 3000);

            // Don't let this timeout keep the process alive
            forceKillTimeout.unref?.();
        } catch (error) {
            console.error('[BackendManager] Error stopping backend:', error);
        }

        this.backendProcess = null;
        this.started = false;
    }

    /**
     * Check if the backend is currently running.
     */
    public isRunning(): boolean {
        return this.started && this.backendProcess !== null && !this.backendProcess.killed;
    }

    // ─── Private Methods ─────────────────────────────────────────

    /**
     * Seed credentials from compile-time defaults if this is a first launch.
     * If credentials already exist, this is a no-op.
     */
    private ensureCredentials(): void {
        const { CredentialsManager } = require('./CredentialsManager');
        const cm = CredentialsManager.getInstance();

        if (!cm.hasBackendCredentials()) {
            console.log('[BackendManager] First launch detected — seeding backend credentials');
            const seeded = cm.seedBackendCredentials();
            if (!seeded) {
                throw new Error(
                    'Failed to seed backend credentials. ' +
                    'The application cannot start without backend server access.'
                );
            }
        } else {
            console.log('[BackendManager] Backend credentials found in secure storage');
        }
    }

    /**
     * Build the env var map for the backend process from CredentialsManager.
     * These are injected into the child process environment — no .env file needed.
     */
    private buildBackendEnv(): Record<string, string> {
        const { CredentialsManager } = require('./CredentialsManager');
        const cm = CredentialsManager.getInstance();

        const env: Record<string, string> = {
            MONGODB_URI: cm.getBackendMongodbUri() || '',
            MONGODB_DB_NAME: cm.getBackendMongodbDbName() || '',
            GOOGLE_CLIENT_ID: cm.getBackendGoogleClientId() || '',
            GOOGLE_CLIENT_SECRET: cm.getBackendGoogleClientSecret() || '',
            JWT_SECRET: cm.getBackendJwtSecret() || '',
            REDIRECT_URI: cm.getBackendRedirectUri() || '',
            PORT: String(BACKEND_PORT),
            NODE_ENV: 'production',
        };

        // Validate all required env vars are present
        const missing = Object.entries(env)
            .filter(([key, val]) => key !== 'PORT' && key !== 'NODE_ENV' && !val)
            .map(([key]) => key);

        if (missing.length > 0) {
            throw new Error(
                `Missing backend credentials: ${missing.join(', ')}. ` +
                'Please re-install the application or contact support.'
            );
        }

        return env;
    }

    /**
     * Resolve the path to the bundled backend server.js.
     * In packaged mode, it's in process.resourcesPath/backend/dist/server.js.
     */
    private resolveServerPath(): string {
        const serverPath = path.join(process.resourcesPath, 'backend', 'dist', 'server.js');

        const fs = require('fs');
        if (!fs.existsSync(serverPath)) {
            throw new Error(
                `Backend server not found at: ${serverPath}. ` +
                'The application package may be corrupted.'
            );
        }

        return serverPath;
    }

    /**
     * Fork the backend as a child process with injected environment.
     * Uses fork() which inherits the Node.js runtime from Electron.
     */
    private spawnBackend(serverPath: string, backendEnv: Record<string, string>): void {
        // Determine the node_modules path for the backend
        const backendNodeModules = path.join(process.resourcesPath, 'backend', 'node_modules');

        this.backendProcess = fork(serverPath, [], {
            env: {
                ...process.env,
                ...backendEnv,
                // Ensure the backend can find its own node_modules
                NODE_PATH: backendNodeModules,
            },
            cwd: path.join(process.resourcesPath, 'backend'),
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            silent: true,
        });

        // Pipe backend stdout/stderr to main process logs
        this.backendProcess.stdout?.on('data', (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) console.log(`[Backend] ${msg}`);
        });

        this.backendProcess.stderr?.on('data', (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) console.error(`[Backend:err] ${msg}`);
        });

        this.backendProcess.on('exit', (code, signal) => {
            console.log(`[BackendManager] Backend process exited (code=${code}, signal=${signal})`);
            this.backendProcess = null;

            // If the backend crashes while we think it should be running,
            // log a critical error. The app will continue but backend-dependent
            // features (auth, calendar, license) will fail gracefully.
            if (this.started) {
                console.error('[BackendManager] Backend process died unexpectedly!');
                this.started = false;
            }
        });

        this.backendProcess.on('error', (error) => {
            console.error('[BackendManager] Failed to spawn backend process:', error);
        });

        console.log(`[BackendManager] Backend process spawned (PID: ${this.backendProcess.pid})`);
    }

    /**
     * Poll the health endpoint until it responds with 200 OK.
     * Throws if the timeout is exceeded.
     */
    private async waitForHealthy(): Promise<void> {
        const deadline = Date.now() + HEALTH_TIMEOUT_MS;
        let lastError: string = '';

        console.log(`[BackendManager] Waiting for backend health (timeout: ${HEALTH_TIMEOUT_MS}ms)...`);

        while (Date.now() < deadline) {
            // Check if the process died during startup
            if (this.backendProcess === null || this.backendProcess.killed) {
                throw new Error(
                    'Backend process exited during startup. ' +
                    'Check the application logs for details.'
                );
            }

            try {
                const res = await fetch(HEALTH_URL);
                if (res.ok) {
                    const body = await res.json();
                    console.log(`[BackendManager] Health check passed: ${JSON.stringify(body)}`);
                    return;
                }
                lastError = `HTTP ${res.status}`;
            } catch (err: any) {
                lastError = err.code || err.message || 'unknown error';
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_MS));
        }

        // Timeout — kill the process and throw
        this.stop();
        throw new Error(
            `Backend health check timed out after ${HEALTH_TIMEOUT_MS}ms. ` +
            `Last error: ${lastError}`
        );
    }
}
