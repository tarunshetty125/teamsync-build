import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { getBackendConfig } from '../config/env';
import type { LicenseDocument } from '../licensing/models/License';
import type { DeviceDocument } from '../licensing/models/Device';
import type { EntitlementDocument } from '../licensing/models/Entitlement';
import type { TrialDocument } from '../licensing/models/Trial';

// ═══════════════════════════════════════════════════════
// User Documents (Google Auth)
// ═══════════════════════════════════════════════════════
export interface UserDocument {
  _id?: ObjectId;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: Date;
  calendarConnected: boolean;
  calendarScopes?: string[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date;
}

// ═══════════════════════════════════════════════════════
// Session Documents (JWT tracking)
// ═══════════════════════════════════════════════════════
export interface SessionDocument {
  _id?: ObjectId;
  userId: ObjectId;
  token: string;
  createdAt: Date;
  expiresAt: Date;
}

// ═══════════════════════════════════════════════════════
// OAuth Auth Sessions (Electron external-browser polling)
// ═══════════════════════════════════════════════════════
export interface AuthSessionDocument {
  _id?: ObjectId;
  authSessionId: string;
  data?: any;
  createdAt: Date;
  expiresAt: Date;
}

// ═══════════════════════════════════════════════════════
// License Verification (matches existing MongoDB schema)
// Collection: licenseverify
// One device = One key binding
// ═══════════════════════════════════════════════════════
export interface LicenseVerifyDocument {
  _id?: ObjectId;
  licenseKey: string;
  deviceId?: string;
  activatedAt?: Date;
  lastSeenAt?: Date;
  updatedAt?: Date;
}

// ═══════════════════════════════════════════════════════
// Hosted TeamSync API Usage
// Kept separate from licensing/entitlement documents.
// ═══════════════════════════════════════════════════════
export interface TeamSyncUsageDocument {
  _id?: ObjectId;
  keyHash: string;
  plan: string;
  aiRequests: number;
  sttSeconds: number;
  searchRequests: number;
  resetsAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToMongoDB(): Promise<Db> {
  if (db) return db;

  const config = getBackendConfig();

  try {
    client = new MongoClient(config.mongodbUri);
    await client.connect();
    db = client.db(config.mongodbDbName);

    // Create indexes (skip if already exist with different options)
    const safeCreateIndex = async (col: string, keys: any, opts?: any) => {
      try { await db!.collection(col).createIndex(keys, opts); } catch (e: any) {
        if (e.code !== 86) throw e; // 86 = IndexKeySpecsConflict — already exists, fine
      }
    };
    await safeCreateIndex('users', { googleId: 1 }, { unique: true });
    await safeCreateIndex('users', { email: 1 }, { unique: true });
    await safeCreateIndex('sessions', { token: 1 }, { unique: true });
    await safeCreateIndex('sessions', { expiresAt: 1 }, { expireAfterSeconds: 0 });
    await safeCreateIndex('auth_sessions', { authSessionId: 1 }, { unique: true });
    await safeCreateIndex('auth_sessions', { expiresAt: 1 }, { expireAfterSeconds: 0 });
    await safeCreateIndex('licenseverify', { licenseKey: 1 });
    await safeCreateIndex('licenseverify', { deviceId: 1 });
    await safeCreateIndex('licenses', { licenseId: 1 }, { unique: true });
    await safeCreateIndex('licenses', { licenseKeyHash: 1 }, { unique: true });
    await safeCreateIndex('licenses', { providerSubscriptionId: 1 });
    await safeCreateIndex('devices', { deviceId: 1, licenseId: 1 }, { unique: true });
    await safeCreateIndex('devices', { licenseId: 1, status: 1 });
    await safeCreateIndex('entitlements', { licenseId: 1, version: 1, deviceId: 1 });
    await safeCreateIndex('trials', { trialId: 1 }, { unique: true });
    await safeCreateIndex('trials', { deviceId: 1 });
    await safeCreateIndex('teamsync_usage', { keyHash: 1 }, { unique: true });
    await safeCreateIndex('teamsync_usage', { resetsAt: 1 });

    console.log(`[MongoDB] Connected to teamsync database`);
    return db;
  } catch (error) {
    console.error('[MongoDB] Connection failed:', error);
    throw error;
  }
}

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectToMongoDB() first.');
  }
  return db;
}

export function getUsersCollection(): Collection<UserDocument> {
  return getDb().collection<UserDocument>('users');
}

export function getSessionsCollection(): Collection<SessionDocument> {
  return getDb().collection<SessionDocument>('sessions');
}

export function getAuthSessionsCollection(): Collection<AuthSessionDocument> {
  return getDb().collection<AuthSessionDocument>('auth_sessions');
}

export function getLicenseVerifyCollection(): Collection<LicenseVerifyDocument> {
  return getDb().collection<LicenseVerifyDocument>('licenseverify');
}

export function getLicensesCollection(): Collection<LicenseDocument> {
  return getDb().collection<LicenseDocument>('licenses');
}

export function getDevicesCollection(): Collection<DeviceDocument> {
  return getDb().collection<DeviceDocument>('devices');
}

export function getEntitlementsCollection(): Collection<EntitlementDocument> {
  return getDb().collection<EntitlementDocument>('entitlements');
}

export function getTrialsCollection(): Collection<TrialDocument> {
  return getDb().collection<TrialDocument>('trials');
}

export function getTeamSyncUsageCollection(): Collection<TeamSyncUsageDocument> {
  return getDb().collection<TeamSyncUsageDocument>('teamsync_usage');
}

export async function disconnectFromMongoDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('[MongoDB] Disconnected');
  }
}
