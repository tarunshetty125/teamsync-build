import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { getBackendConfig } from '../config/env';

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
    await safeCreateIndex('licenseverify', { licenseKey: 1 });
    await safeCreateIndex('licenseverify', { deviceId: 1 });

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

export function getLicenseVerifyCollection(): Collection<LicenseVerifyDocument> {
  return getDb().collection<LicenseVerifyDocument>('licenseverify');
}

export async function disconnectFromMongoDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('[MongoDB] Disconnected');
  }
}
