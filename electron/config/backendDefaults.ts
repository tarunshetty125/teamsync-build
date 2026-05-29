/**
 * Compile-time defaults for backend server credentials.
 *
 * Used ONLY on the FIRST packaged launch to seed CredentialsManager.
 * After seeding, these are never read again — CredentialsManager reads
 * exclusively from Electron safeStorage (macOS Keychain / Windows DPAPI).
 *
 * SECURITY NOTE:
 * These values are embedded in the ASAR bundle. They should use a
 * RESTRICTED MongoDB user with minimal read/write privileges scoped
 * to the production database only. Replace the credentials below
 * with a restricted DB user before shipping.
 */

export const BACKEND_DEFAULTS = {
  MONGODB_URI: 'mongodb+srv://tarunshetty256_db_user:126XQ2Ao7Mbd89X1@cluster0.vnezbeg.mongodb.net/?appName=Cluster0',
  MONGODB_DB_NAME: 'natively',
  GOOGLE_CLIENT_ID: '760059233661-b39kfg3gqjau0af4kp1c09kv483k8ncs.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: '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',
  JWT_SECRET: 'teamsync_jwt_secret_key_2026_secure',
  REDIRECT_URI: 'http://localhost:3456/auth/google/callback',
} as const;
