import { EventEmitter } from 'events';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { loadNativeModule } from '../../../electron/audio/nativeModuleLoader';

export type LicenseResult = { success: boolean; error?: string };

type BackendVerificationResult = {
    status: 'valid' | 'invalid' | 'network_error';
    error?: string;
};

type StorageLike = {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
};

const STORAGE_KEY_ACTIVE = 'natively_premium_active';
const STORAGE_KEY_LICENSE = 'natively_premium_key';
const STORAGE_FILE = 'premium-localStorage.json';
const API_BASE = process.env.TEAMSYNC_BACKEND_URL || (
    process.env.NODE_ENV === 'development'
        ? 'http://localhost:7678'
        : 'https://your-backend-url.com'
);
const VALIDATION_INTERVAL_MS = 5 * 60 * 1000;

class MemoryStorage implements StorageLike {
    private data: Record<string, string> = {};

    public getItem(key: string): string | null {
        return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
    }

    public setItem(key: string, value: string): void {
        this.data[key] = value;
    }

    public removeItem(key: string): void {
        delete this.data[key];
    }
}

class FileStorage implements StorageLike {
    private filePath: string;
    private loaded = false;
    private data: Record<string, string> = {};

    public constructor(filePath: string) {
        this.filePath = filePath;
    }

    private ensureLoaded(): void {
        if (this.loaded) return;
        this.loaded = true;
        try {
            if (!fs.existsSync(this.filePath)) return;
            const raw = fs.readFileSync(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                this.data = parsed as Record<string, string>;
            }
        } catch (err) {
            console.error('[LicenseService] Failed to load premium state:', err);
            this.data = {};
        }
    }

    private persist(): void {
        try {
            const tmpPath = this.filePath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
            fs.renameSync(tmpPath, this.filePath);
        } catch (err) {
            console.error('[LicenseService] Failed to persist premium state:', err);
        }
    }

    public getItem(key: string): string | null {
        this.ensureLoaded();
        return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null;
    }

    public setItem(key: string, value: string): void {
        this.ensureLoaded();
        this.data[key] = value;
        this.persist();
    }

    public removeItem(key: string): void {
        this.ensureLoaded();
        delete this.data[key];
        this.persist();
    }
}

function resolveStorage(): StorageLike {
    const maybeLocalStorage = (globalThis as any)?.localStorage as StorageLike | undefined;
    if (maybeLocalStorage && typeof maybeLocalStorage.getItem === 'function') {
        return maybeLocalStorage;
    }

    if (app?.isReady?.()) {
        const filePath = path.join(app.getPath('userData'), STORAGE_FILE);
        return new FileStorage(filePath);
    }

    return new MemoryStorage();
}

export class LicenseService {
    private static instance: LicenseService;

    private storage: StorageLike;
    private premiumActive = false;
    private activeLicenseKey: string | null = null;
    private hasRestored = false;
    private readonly events = new EventEmitter();
    private validationTimer: NodeJS.Timeout | null = null;
    private validationPromise: Promise<void> | null = null;

    private constructor() {
        this.storage = resolveStorage();
        this.restoreState();
        this.hydrateWhenReady();
        this.startValidationLoopIfNeeded();
    }

    public static getInstance(): LicenseService {
        if (!LicenseService.instance) {
            LicenseService.instance = new LicenseService();
        }
        return LicenseService.instance;
    }

    public onLicenseActivated(listener: () => void): () => void {
        this.events.on('license-activated', listener);
        return () => this.events.off('license-activated', listener);
    }

    public onLicenseRevoked(listener: () => void): () => void {
        this.events.on('license-revoked', listener);
        return () => this.events.off('license-revoked', listener);
    }

    public async activateLicense(key: string): Promise<LicenseResult> {
        this.restoreState();
        const trimmed = typeof key === 'string' ? key.trim() : '';
        if (!trimmed) {
            return { success: false, error: 'Invalid license key.' };
        }

        const deviceId = this.getHardwareId();
        if (!deviceId || deviceId === 'unavailable') {
            return { success: false, error: 'Unable to read device ID.' };
        }

        const verification = await this.verifyLicenseViaBackend(trimmed, deviceId);
        if (verification.status !== 'valid') {
            return {
                success: false,
                error: verification.error || 'License verification failed.',
            };
        }

        const wasPremium = this.premiumActive;
        this.setPremiumState(true, trimmed);
        this.startValidationLoopIfNeeded();
        if (!wasPremium) {
            this.events.emit('license-activated');
        }
        return { success: true };
    }

    public isProActive(): boolean {
        this.restoreState();
        return this.premiumActive;
    }

    public isPremium(): boolean {
        return this.isProActive();
    }

    public deactivateLicense(): void {
        this.revokeLicense('manual');
    }

    public deactivate(): void {
        this.deactivateLicense();
    }

    public getHardwareId(): string {
        try {
            if (process.env.NODE_ENV !== 'production' && process.env.NATIVELY_DEV_DEVICE_ID) {
                return process.env.NATIVELY_DEV_DEVICE_ID;
            }
            const nativeModule = loadNativeModule();
            if (!nativeModule) return 'unavailable';
            return nativeModule.getHardwareId();
        } catch (err) {
            console.error('[LicenseService] Failed to get hardware ID:', err);
            return 'unavailable';
        }
    }

    public triggerValidationCheck(): void {
        if (!this.premiumActive) return;
        void this.validateActiveLicense();
    }

    private restoreState(): void {
        if (this.hasRestored) return;
        this.hasRestored = true;
        try {
            const stored = this.storage.getItem(STORAGE_KEY_ACTIVE);
            this.premiumActive = stored === 'true';
            this.activeLicenseKey = this.storage.getItem(STORAGE_KEY_LICENSE);
        } catch (err) {
            console.error('[LicenseService] Failed to restore premium state:', err);
            this.premiumActive = false;
            this.activeLicenseKey = null;
        }
    }

    private setPremiumState(isPremium: boolean, licenseKey: string | null): void {
        this.premiumActive = isPremium;
        this.activeLicenseKey = licenseKey;

        try {
            this.storage.setItem(STORAGE_KEY_ACTIVE, isPremium ? 'true' : 'false');
            if (licenseKey && isPremium) {
                this.storage.setItem(STORAGE_KEY_LICENSE, licenseKey);
            } else {
                this.storage.removeItem(STORAGE_KEY_LICENSE);
            }
        } catch (err) {
            console.error('[LicenseService] Failed to save premium state:', err);
        }
    }

    private revokeLicense(reason: 'manual' | 'invalid' | 'expired'): void {
        const wasPremium = this.premiumActive;
        this.setPremiumState(false, null);
        this.stopValidationLoop();

        if (wasPremium) {
            console.log(`[LicenseService] License revoked (${reason})`);
            this.events.emit('license-revoked');
        }
    }

    private startValidationLoopIfNeeded(): void {
        if (!this.premiumActive || !this.activeLicenseKey || this.validationTimer) {
            return;
        }

        this.validationTimer = setInterval(() => {
            void this.validateActiveLicense();
        }, VALIDATION_INTERVAL_MS);

        if (typeof this.validationTimer.unref === 'function') {
            this.validationTimer.unref();
        }

        setTimeout(() => {
            void this.validateActiveLicense();
        }, 8000);
    }

    private stopValidationLoop(): void {
        if (this.validationTimer) {
            clearInterval(this.validationTimer);
            this.validationTimer = null;
        }
    }

    private async validateActiveLicense(): Promise<void> {
        if (!this.premiumActive || !this.activeLicenseKey) {
            return;
        }
        if (this.validationPromise) {
            return this.validationPromise;
        }

        this.validationPromise = (async () => {
            const deviceId = this.getHardwareId();
            if (!deviceId || deviceId === 'unavailable') {
                return;
            }

            const verification = await this.verifyLicenseViaBackend(this.activeLicenseKey as string, deviceId);
            if (verification.status === 'invalid') {
                this.revokeLicense('expired');
            }
        })().finally(() => {
            this.validationPromise = null;
        });

        return this.validationPromise;
    }

    private async verifyLicenseViaBackend(licenseKey: string, deviceId: string): Promise<BackendVerificationResult> {
        try {
            const response = await fetch(`${API_BASE}/api/license/activate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ licenseKey, deviceId }),
            });

            const data = await response.json().catch(() => ({} as any));
            if (response.ok && data.success !== false) {
                return { status: 'valid' };
            }

            if (response.status >= 500) {
                return {
                    status: 'network_error',
                    error: data.error || `License verification unavailable (${response.status}).`,
                };
            }

            return {
                status: 'invalid',
                error: data.error || `License verification failed (${response.status}).`,
            };
        } catch (err: any) {
            return {
                status: 'network_error',
                error: `Backend request failed: ${err?.message || 'Unable to contact backend.'}`,
            };
        }
    }

    private hydrateWhenReady(): void {
        if (this.storage instanceof MemoryStorage && !app?.isReady?.()) {
            app.whenReady().then(() => {
                try {
                    this.storage = resolveStorage();
                    this.hasRestored = false;
                    this.restoreState();
                    this.setPremiumState(this.premiumActive, this.activeLicenseKey);
                    this.startValidationLoopIfNeeded();
                } catch (err) {
                    console.error('[LicenseService] Failed to hydrate premium storage:', err);
                }
            }).catch((): void => undefined);
        }
    }
}
