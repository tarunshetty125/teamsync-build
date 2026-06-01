import dotenv from 'dotenv';

dotenv.config();

export const REQUIRED_BACKEND_ENV_KEYS = [
  'MONGODB_URI',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'JWT_SECRET',
  'REDIRECT_URI',
] as const;

export type RequiredBackendEnvKey = typeof REQUIRED_BACKEND_ENV_KEYS[number];

export interface BackendConfig {
  mongodbUri: string;
  mongodbDbName: string;
  googleClientId: string;
  googleClientSecret: string;
  jwtSecret: string;
  redirectUri: string;
  port: number;
  nodeEnv: string;
}

let cachedConfig: BackendConfig | null = null;

function readRequiredEnv(env: NodeJS.ProcessEnv, key: RequiredBackendEnvKey): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required backend environment variable: ${key}`);
  }
  return value;
}

function parsePort(rawPort: string | undefined): number {
  const value = rawPort?.trim() || '3456';
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid backend PORT: ${value}`);
  }
  return parsed;
}

export function loadBackendConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const missing = REQUIRED_BACKEND_ENV_KEYS.filter(key => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required backend environment variable(s): ${missing.join(', ')}`
    );
  }

  return {
    mongodbUri: readRequiredEnv(env, 'MONGODB_URI'),
    mongodbDbName: env.MONGODB_DB_NAME?.trim() || 'natively',
    googleClientId: readRequiredEnv(env, 'GOOGLE_CLIENT_ID'),
    googleClientSecret: readRequiredEnv(env, 'GOOGLE_CLIENT_SECRET'),
    jwtSecret: readRequiredEnv(env, 'JWT_SECRET'),
    redirectUri: readRequiredEnv(env, 'REDIRECT_URI'),
    port: parsePort(env.PORT),
    nodeEnv: env.NODE_ENV?.trim() || 'development',
  };
}

export function getBackendConfig(): BackendConfig {
  if (!cachedConfig) {
    cachedConfig = loadBackendConfig();
  }
  return cachedConfig;
}

export function resetBackendConfigForTests(): void {
  cachedConfig = null;
}
