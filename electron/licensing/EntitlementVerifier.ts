import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { API_BASE_URL } from '../../src/lib/config/apiConfig';
import { loadNativeModule } from '../audio/nativeModuleLoader';
import { LICENSE_PUBLIC_KEY } from './licensePublicKey';

export type EntitlementPlan = 'free' | 'pro' | 'pro_plus' | 'team' | 'enterprise';

export interface SignedEntitlement {
  plan: EntitlementPlan;
  userId: string;
  deviceId: string;
  licenseId: string;
  trial: boolean;
  issuedAt: string;
  expiresAt: string;
  graceUntil: string;
  entitlementVersion: number;
  features: string[];
  issuer: string;
  /** Server-authoritative timestamp — signed inside payload to prevent clock manipulation */
  serverTime?: string;
  signature: string;
}

export interface EntitlementCache {
  entitlement?: SignedEntitlement;
  lastSuccessfulSyncAt?: string;
  lastSyncAttemptAt?: string;
  migrationAttemptedAt?: string;
  // Anti-rollback: detect cache file replacement attacks
  previousEntitlementHash?: string;
  lastAcceptedSignature?: string;
  entitlementSequence?: number;
  // Signed server time: used instead of Date.now() for grace calculations
  lastSuccessfulServerTime?: string;
}

export interface EntitlementStatus {
  isPremium: boolean;
  plan: EntitlementPlan;
  provider?: 'license' | 'trial';
  trial: boolean;
  status:
    | 'active'
    | 'free'
    | 'offline_grace'
    | 'expired'
    | 'revoked'
    | 'invalid_signature'
    | 'device_mismatch'
    | 'sync_required'
    | 'tampered'
    | 'clock_rollback';
  entitlement?: SignedEntitlement;
  features: string[];
  expiresAt?: string;
  graceUntil?: string;
  lastSuccessfulSyncAt?: string;
}

export type SyncReason = 'startup' | 'background' | 'manual' | 'activation' | 'trial' | 'deactivation'
  | 'focus' | 'online' | 'sleep_wake' | 'purchase' | 'restore';

/** Clock drift tolerance (5 minutes) — if local time is this far behind server time, flag as suspicious */
const CLOCK_DRIFT_TOLERANCE_MS = 5 * 60 * 1000;
/** Small random jitter (0–5 min) added to offline grace expiry to prevent synchronized reconnect storms */
const GRACE_JITTER_MAX_MS = 5 * 60 * 1000;

const LICENSE_BACKEND_URL = (process.env.LICENSE_BACKEND_URL || API_BASE_URL).replace(/\/+$/g, '');
const CACHE_FILE = 'license-entitlement-cache.json';
const LEGACY_PREMIUM_FILE = 'premium-localStorage.json';
const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    // Skip undefined values — matches JSON.stringify behavior.
    // Critical for backward compatibility: entitlements signed without serverTime
    // must verify correctly when sanitizeEntitlement sets serverTime to undefined.
    .filter(key => record[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

function base64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class EntitlementVerifier extends EventEmitter {
  private static instance: EntitlementVerifier | null = null;
  private cache: EntitlementCache = {};
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private readonly publicKey: string;
  private readonly backendUrl: string;
  private readonly cachePath: string;
  private readonly now: () => Date;
  private readonly deviceIdOverride?: string;

  constructor(options: {
    publicKey?: string;
    backendUrl?: string;
    cachePath?: string;
    now?: () => Date;
    deviceId?: string;
  } = {}) {
    super();
    this.publicKey = options.publicKey || LICENSE_PUBLIC_KEY;
    this.backendUrl = (options.backendUrl || LICENSE_BACKEND_URL).replace(/\/+$/g, '');
    this.cachePath = options.cachePath || path.join(app.getPath('userData'), CACHE_FILE);
    this.now = options.now || (() => new Date());
    this.deviceIdOverride = options.deviceId;
    this.loadCache();
  }

  static getInstance(): EntitlementVerifier {
    if (!EntitlementVerifier.instance) {
      EntitlementVerifier.instance = new EntitlementVerifier();
    }
    return EntitlementVerifier.instance;
  }

  async initialize(): Promise<EntitlementStatus> {
    await this.migrateLegacyState();
    const before = this.getStatus();
    this.emit('changed', before);
    await this.sync('startup').catch(error => {
      console.warn('[EntitlementVerifier] Startup sync failed:', error?.message || error);
    });
    this.startBackgroundSync();
    return this.getStatus();
  }

  getStatus(): EntitlementStatus {
    const entitlement = this.cache.entitlement;
    if (!entitlement) {
      return {
        isPremium: false,
        plan: 'free',
        trial: false,
        status: 'free',
        features: [],
        lastSuccessfulSyncAt: this.cache.lastSuccessfulSyncAt,
      };
    }

    const validation = this.validateEntitlement(entitlement);
    if ('reason' in validation) {
      return {
        isPremium: false,
        plan: 'free',
        trial: false,
        status: validation.reason,
        features: [],
        entitlement,
        expiresAt: entitlement.expiresAt,
        graceUntil: entitlement.graceUntil,
        lastSuccessfulSyncAt: this.cache.lastSuccessfulSyncAt,
      };
    }

    // Use signed server time when available to prevent local clock manipulation.
    // Falls back to Date.now() for backward compatibility with older server responses.
    const serverTimeMs = this.cache.lastSuccessfulServerTime
      ? Date.parse(this.cache.lastSuccessfulServerTime)
      : 0;
    const localNowMs = this.now().getTime();
    const nowMs = serverTimeMs > 0 ? serverTimeMs : localNowMs;

    // Clock rollback detection: if local time is significantly behind server time,
    // the user may have rolled back their system clock to extend grace/expiry.
    if (serverTimeMs > 0 && localNowMs < serverTimeMs - CLOCK_DRIFT_TOLERANCE_MS) {
      return {
        isPremium: false,
        plan: 'free',
        trial: false,
        status: 'clock_rollback',
        features: [],
        entitlement,
        expiresAt: entitlement.expiresAt,
        graceUntil: entitlement.graceUntil,
        lastSuccessfulSyncAt: this.cache.lastSuccessfulSyncAt,
      };
    }

    const expiresAtMs = Date.parse(entitlement.expiresAt);
    const graceUntilMs = Date.parse(entitlement.graceUntil);
    const lastSyncMs = this.cache.lastSuccessfulSyncAt ? Date.parse(this.cache.lastSuccessfulSyncAt) : 0;
    const syncedRecently = lastSyncMs > 0 && localNowMs - lastSyncMs <= OFFLINE_GRACE_MS;
    const premiumPlan = entitlement.plan === 'pro' || entitlement.plan === 'pro_plus'
      || entitlement.plan === 'team' || entitlement.plan === 'enterprise' || entitlement.trial;

    if (!premiumPlan) {
      return {
        isPremium: false,
        plan: 'free',
        trial: false,
        status: 'free',
        features: [],
        entitlement,
        expiresAt: entitlement.expiresAt,
        graceUntil: entitlement.graceUntil,
        lastSuccessfulSyncAt: this.cache.lastSuccessfulSyncAt,
      };
    }

    if (Number.isFinite(expiresAtMs) && localNowMs <= expiresAtMs) {
      return this.statusFromEntitlement(entitlement, 'active');
    }

    // Offline grace: add randomized jitter to prevent synchronized reconnect storms
    const graceJitter = this.getGraceJitter();
    if (
      syncedRecently &&
      Number.isFinite(graceUntilMs) &&
      localNowMs <= graceUntilMs + graceJitter
    ) {
      return this.statusFromEntitlement(entitlement, 'offline_grace');
    }

    return {
      isPremium: false,
      plan: 'free',
      trial: false,
      status: 'expired',
      features: [],
      entitlement,
      expiresAt: entitlement.expiresAt,
      graceUntil: entitlement.graceUntil,
      lastSuccessfulSyncAt: this.cache.lastSuccessfulSyncAt,
    };
  }

  hasPremiumAccess(): boolean {
    return this.getStatus().isPremium;
  }

  /**
   * Returns true for Pro, Pro Plus, or Team plans (anything above free).
   * Use this to gate Pro-tier features: modes, screen scan, profile intelligence, etc.
   */
  hasProAccess(): boolean {
    const status = this.getStatus();
    return status.isPremium && (
      status.plan === 'pro' ||
      status.plan === 'pro_plus' ||
      status.plan === 'team' ||
      status.plan === 'enterprise'
    );
  }

  /**
   * Returns true ONLY for Pro Plus, Team, or Enterprise plans.
   * Backward-compat helper — new code should prefer hasCapability().
   */
  hasProPlusAccess(): boolean {
    const status = this.getStatus();
    return status.isPremium && (
      status.plan === 'pro_plus' ||
      status.plan === 'team' ||
      status.plan === 'enterprise'
    );
  }

  /**
   * Returns the resolved tier for the current entitlement.
   * Backward-compat helper — new code should use capabilities.
   */
  getPlanTier(): 'free' | 'pro' | 'pro_plus' {
    const status = this.getStatus();
    if (!status.isPremium) return 'free';
    if (status.plan === 'pro_plus' || status.plan === 'team' || status.plan === 'enterprise') return 'pro_plus';
    return 'pro';
  }

  // ── Capability-Based Feature Gates ─────────────────────────────────────
  // Server is the source of truth for capabilities via the features[] array.
  // Prefer these over plan-string checks for all new code.

  /**
   * Check if the current entitlement includes a specific capability.
   * @example verifier.hasCapability('phone_mirror')
   */
  hasCapability(capability: string): boolean {
    const status = this.getStatus();
    return status.isPremium && status.features.includes(capability);
  }

  /**
   * Get all capabilities granted by the current entitlement.
   * Returns a frozen copy to prevent mutation.
   */
  getCapabilities(): readonly string[] {
    return Object.freeze(this.getStatus().features.slice());
  }

  getCachedEntitlement(): SignedEntitlement | undefined {
    return this.cache.entitlement ? { ...this.cache.entitlement } : undefined;
  }

  getDeviceId(): string {
    if (this.deviceIdOverride) return this.deviceIdOverride;

    try {
      const nativeModule = loadNativeModule();
      const nativeId = nativeModule?.getHardwareId?.();
      if (nativeId && nativeId !== 'unavailable') return nativeId;
    } catch {
      // Native hardware ID is a signal only. Fallback stays deterministic.
    }

    const raw = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.userInfo().username,
      String(os.totalmem()),
    ].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  async activateLicense(licenseKey: string): Promise<{ success: boolean; error?: string; entitlement?: SignedEntitlement }> {
    const trimmed = typeof licenseKey === 'string' ? licenseKey.trim() : '';
    if (!trimmed) return { success: false, error: 'License key is required.' };

    const response = await this.post('/license/activate', {
      licenseKey: trimmed,
      deviceId: this.getDeviceId(),
      deviceName: os.hostname(),
      platform: os.platform(),
      appVersion: app.getVersion?.() || 'unknown',
    });

    return this.acceptServerEntitlement(response, 'activation');
  }

  async startTrial(): Promise<{ success: boolean; error?: string; entitlement?: SignedEntitlement }> {
    const response = await this.post('/license/trial/start', {
      deviceId: this.getDeviceId(),
      deviceName: os.hostname(),
    });

    return this.acceptServerEntitlement(response, 'trial');
  }

  async sync(reason: SyncReason = 'manual'): Promise<EntitlementStatus> {
    this.cache.lastSyncAttemptAt = this.now().toISOString();
    this.persistCache();

    const entitlement = this.cache.entitlement;
    if (!entitlement) return this.getStatus();

    const params = new URLSearchParams({
      deviceId: this.getDeviceId(),
      licenseId: entitlement.licenseId,
      entitlementVersion: String(entitlement.entitlementVersion),
      trial: String(entitlement.trial === true),
    });

    const response = await this.get(`/license/sync?${params.toString()}`);
    const result = this.acceptServerEntitlement(response, reason);
    if (!result.success) {
      this.clearEntitlement();
    }
    return this.getStatus();
  }

  async deactivate(): Promise<{ success: boolean; error?: string }> {
    const entitlement = this.cache.entitlement;
    if (entitlement) {
      await this.post('/license/deactivate', {
        deviceId: this.getDeviceId(),
        licenseId: entitlement.licenseId,
      }).catch(error => {
        console.warn('[EntitlementVerifier] Server deactivation failed:', error?.message || error);
      });
    }
    this.clearEntitlement('deactivation');
    return { success: true };
  }

  startBackgroundSync(intervalMs = 5 * 60 * 1000): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      this.sync('background').catch(error => {
        console.warn('[EntitlementVerifier] Background sync failed:', error?.message || error);
      });
    }, intervalMs);
    this.syncTimer.unref?.();
  }

  stopBackgroundSync(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
  }

  validateEntitlement(entitlement: unknown): { valid: true } | { valid: false; reason: EntitlementStatus['status'] } {
    if (!isRecord(entitlement)) return { valid: false, reason: 'invalid_signature' };
    const parsed = this.sanitizeEntitlement(entitlement);
    if (!parsed) return { valid: false, reason: 'invalid_signature' };

    const { signature, ...unsigned } = parsed;
    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(canonicalize(unsigned));
      verifier.end();
      const signatureValid = verifier.verify(this.publicKey, base64UrlToBuffer(signature));
      if (!signatureValid) return { valid: false, reason: 'invalid_signature' };
    } catch {
      return { valid: false, reason: 'invalid_signature' };
    }

    if (parsed.deviceId !== this.getDeviceId()) {
      return { valid: false, reason: 'device_mismatch' };
    }

    return { valid: true };
  }

  private acceptServerEntitlement(response: any, reason: SyncReason): { success: boolean; error?: string; entitlement?: SignedEntitlement } {
    if (!response?.success || !response.entitlement) {
      return { success: false, error: response?.error || response?.status || 'License server rejected entitlement.' };
    }

    const entitlement = this.sanitizeEntitlement(response.entitlement);
    if (!entitlement) {
      return { success: false, error: 'License server returned an invalid entitlement.' };
    }

    const validation = this.validateEntitlement(entitlement);
    if ('reason' in validation) {
      return { success: false, error: `Entitlement rejected: ${validation.reason}` };
    }

    // Anti-rollback: store hash of previous entitlement and increment sequence
    if (this.cache.entitlement) {
      const { signature: _prevSig, ...prevUnsigned } = this.cache.entitlement;
      this.cache.previousEntitlementHash = crypto.createHash('sha256').update(canonicalize(prevUnsigned)).digest('hex');
    }
    this.cache.lastAcceptedSignature = entitlement.signature;
    this.cache.entitlementSequence = (this.cache.entitlementSequence ?? 0) + 1;

    this.cache.entitlement = entitlement;
    this.cache.lastSuccessfulSyncAt = this.now().toISOString();
    this.cache.lastSyncAttemptAt = this.cache.lastSuccessfulSyncAt;

    // Store signed server time for clock-tamper-resistant grace calculations
    if (entitlement.serverTime) {
      this.cache.lastSuccessfulServerTime = entitlement.serverTime;
    }

    this.persistCache();
    this.emit('changed', this.getStatus(), reason);
    return { success: true, entitlement };
  }

  private statusFromEntitlement(entitlement: SignedEntitlement, status: 'active' | 'offline_grace'): EntitlementStatus {
    return {
      isPremium: entitlement.plan === 'pro' || entitlement.plan === 'pro_plus'
        || entitlement.plan === 'team' || entitlement.plan === 'enterprise' || entitlement.trial,
      plan: entitlement.plan,
      provider: entitlement.trial ? 'trial' : 'license',
      trial: entitlement.trial,
      status,
      features: Array.isArray(entitlement.features) ? entitlement.features.slice() : [],
      entitlement,
      expiresAt: entitlement.expiresAt,
      graceUntil: entitlement.graceUntil,
      lastSuccessfulSyncAt: this.cache.lastSuccessfulSyncAt,
    };
  }

  private clearEntitlement(reason: SyncReason = 'manual'): void {
    this.cache.entitlement = undefined;
    this.persistCache();
    this.emit('changed', this.getStatus(), reason);
  }

  private sanitizeEntitlement(raw: Record<string, unknown>): SignedEntitlement | null {
    const plan = raw.plan;
    if (plan !== 'free' && plan !== 'pro' && plan !== 'pro_plus' && plan !== 'team' && plan !== 'enterprise') return null;
    if (typeof raw.userId !== 'string') return null;
    if (typeof raw.deviceId !== 'string') return null;
    if (typeof raw.licenseId !== 'string') return null;
    if (typeof raw.issuedAt !== 'string') return null;
    if (typeof raw.expiresAt !== 'string') return null;
    if (typeof raw.graceUntil !== 'string') return null;
    if (typeof raw.entitlementVersion !== 'number') return null;
    if (!Array.isArray(raw.features) || raw.features.some(feature => typeof feature !== 'string')) return null;
    if (typeof raw.issuer !== 'string') return null;
    if (typeof raw.signature !== 'string') return null;

    return {
      plan,
      userId: raw.userId,
      deviceId: raw.deviceId,
      licenseId: raw.licenseId,
      trial: raw.trial === true,
      issuedAt: raw.issuedAt,
      expiresAt: raw.expiresAt,
      graceUntil: raw.graceUntil,
      entitlementVersion: raw.entitlementVersion,
      features: raw.features as string[],
      issuer: raw.issuer,
      // serverTime is optional for backward compat with older server responses
      serverTime: typeof raw.serverTime === 'string' ? raw.serverTime : undefined,
      signature: raw.signature,
    };
  }

  private async migrateLegacyState(): Promise<void> {
    if (this.cache.migrationAttemptedAt) return;
    this.cache.migrationAttemptedAt = this.now().toISOString();
    const legacyPath = path.join(path.dirname(this.cachePath), LEGACY_PREMIUM_FILE);
    try {
      if (fs.existsSync(legacyPath)) {
        fs.unlinkSync(legacyPath);
        console.log('[EntitlementVerifier] Removed legacy premium-localStorage authority file.');
      }
    } catch (error) {
      console.warn('[EntitlementVerifier] Failed to remove legacy premium-localStorage file:', error);
    }
    this.persistCache();
  }

  private loadCache(): void {
    try {
      if (!fs.existsSync(this.cachePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (isRecord(parsed)) {
        const loadedSequence = typeof parsed.entitlementSequence === 'number' ? parsed.entitlementSequence : 0;

        // Anti-rollback: reject cache if sequence number went backward
        if (this.cache.entitlementSequence !== undefined && loadedSequence < this.cache.entitlementSequence) {
          console.warn('[EntitlementVerifier] Anti-rollback: cache sequence went backward, forcing sync');
          this.cache = {};
          return;
        }

        this.cache = {
          entitlement: isRecord(parsed.entitlement) ? this.sanitizeEntitlement(parsed.entitlement) || undefined : undefined,
          lastSuccessfulSyncAt: typeof parsed.lastSuccessfulSyncAt === 'string' ? parsed.lastSuccessfulSyncAt : undefined,
          lastSyncAttemptAt: typeof parsed.lastSyncAttemptAt === 'string' ? parsed.lastSyncAttemptAt : undefined,
          migrationAttemptedAt: typeof parsed.migrationAttemptedAt === 'string' ? parsed.migrationAttemptedAt : undefined,
          // Anti-rollback fields
          previousEntitlementHash: typeof parsed.previousEntitlementHash === 'string' ? parsed.previousEntitlementHash : undefined,
          lastAcceptedSignature: typeof parsed.lastAcceptedSignature === 'string' ? parsed.lastAcceptedSignature : undefined,
          entitlementSequence: loadedSequence,
          // Server time
          lastSuccessfulServerTime: typeof parsed.lastSuccessfulServerTime === 'string' ? parsed.lastSuccessfulServerTime : undefined,
        };
      }
    } catch (error) {
      console.warn('[EntitlementVerifier] Failed to load entitlement cache:', error);
      this.cache = {};
    }
  }

  private persistCache(): void {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const tmpPath = `${this.cachePath}.tmp`;
      const json = JSON.stringify(this.cache, null, 2);
      fs.writeFileSync(tmpPath, json);
      // Verify write integrity before atomic rename to prevent corruption
      const readBack = fs.readFileSync(tmpPath, 'utf8');
      if (readBack !== json) {
        console.warn('[EntitlementVerifier] Cache write verification failed, aborting persist');
        try { fs.unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
        return;
      }
      fs.renameSync(tmpPath, this.cachePath);
    } catch (error) {
      console.warn('[EntitlementVerifier] Failed to persist entitlement cache:', error);
    }
  }

  /**
   * Deterministic per-device grace jitter to prevent synchronized reconnect storms.
   * Returns a value between 0 and GRACE_JITTER_MAX_MS, stable for a given device.
   */
  private getGraceJitter(): number {
    const deviceId = this.getDeviceId();
    const hash = crypto.createHash('sha256').update(`grace-jitter-${deviceId}`).digest();
    // Use first 4 bytes as a uint32 to derive a stable fraction
    const fraction = hash.readUInt32BE(0) / 0xFFFFFFFF;
    return Math.floor(fraction * GRACE_JITTER_MAX_MS);
  }

  private async get(route: string): Promise<any> {
    const response = await fetch(`${this.backendUrl}${route}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    return this.parseResponse(response);
  }

  private async post(route: string, body: Record<string, unknown>): Promise<any> {
    const response = await fetch(`${this.backendUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return this.parseResponse(response);
  }

  private async parseResponse(response: Response): Promise<any> {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: body?.error || body?.status || `License server returned HTTP ${response.status}`,
      };
    }
    return body;
  }
}
