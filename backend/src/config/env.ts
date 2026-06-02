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
  licensePrivateKey: string;
  licenseIssuer: string;
  licenseEntitlementTtlMs: number;
  licenseOfflineGraceMs: number;
  licenseWebhookSecret: string;
  dodoWebhookSecret: string;
  gumroadWebhookSecret: string;
  stripeWebhookSecret: string;
  teamSyncGeminiApiKeys: string[];
  teamSyncGroqApiKeys: string[];
  teamSyncDeepgramApiKeys: string[];
  teamSyncGeminiModel: string;
  teamSyncGroqModel: string;
  teamSyncDeepgramModel: string;
  teamSyncQuotaAiRequests: number;
  teamSyncQuotaSttMinutes: number;
  teamSyncQuotaSearchRequests: number;
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

function parsePositiveMs(rawValue: string | undefined, fallback: number, label: string): number {
  const value = rawValue?.trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid backend ${label}: ${value}`);
  }
  return parsed;
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, '\n').trim();
}

function parseEnvList(...values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    for (const item of (value || '').split(',')) {
      const trimmed = item.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return Array.from(seen);
}

function parsePositiveInt(rawValue: string | undefined, fallback: number, label: string): number {
  const value = rawValue?.trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid backend ${label}: ${value}`);
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
    licensePrivateKey: normalizePem(env.LICENSE_PRIVATE_KEY?.trim() || ''),
    licenseIssuer: env.LICENSE_ISSUER?.trim() || 'license.teamsync.ai',
    licenseEntitlementTtlMs: parsePositiveMs(env.LICENSE_ENTITLEMENT_TTL_MS, 10 * 60 * 1000, 'LICENSE_ENTITLEMENT_TTL_MS'),
    licenseOfflineGraceMs: parsePositiveMs(env.LICENSE_OFFLINE_GRACE_MS, 72 * 60 * 60 * 1000, 'LICENSE_OFFLINE_GRACE_MS'),
    licenseWebhookSecret: env.LICENSE_WEBHOOK_SECRET?.trim() || '',
    dodoWebhookSecret: env.DODO_WEBHOOK_SECRET?.trim() || '',
    gumroadWebhookSecret: env.GUMROAD_WEBHOOK_SECRET?.trim() || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || '',
    teamSyncGeminiApiKeys: parseEnvList(env.TEAMSYNC_GEMINI_API_KEYS, env.GEMINI_API_KEY, env.GOOGLE_AI_API_KEY),
    teamSyncGroqApiKeys: parseEnvList(env.TEAMSYNC_GROQ_API_KEYS, env.GROQ_API_KEYS, env.GROQ_API_KEY),
    teamSyncDeepgramApiKeys: parseEnvList(env.TEAMSYNC_DEEPGRAM_API_KEYS, env.DEEPGRAM_API_KEYS, env.DEEPGRAM_API_KEY),
    teamSyncGeminiModel: env.TEAMSYNC_GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
    teamSyncGroqModel: env.TEAMSYNC_GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile',
    teamSyncDeepgramModel: env.TEAMSYNC_DEEPGRAM_MODEL?.trim() || 'nova-3',
    teamSyncQuotaAiRequests: parsePositiveInt(env.TEAMSYNC_QUOTA_AI_REQUESTS, 1000, 'TEAMSYNC_QUOTA_AI_REQUESTS'),
    teamSyncQuotaSttMinutes: parsePositiveInt(env.TEAMSYNC_QUOTA_STT_MINUTES, 600, 'TEAMSYNC_QUOTA_STT_MINUTES'),
    teamSyncQuotaSearchRequests: parsePositiveInt(env.TEAMSYNC_QUOTA_SEARCH_REQUESTS, 100, 'TEAMSYNC_QUOTA_SEARCH_REQUESTS'),
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
