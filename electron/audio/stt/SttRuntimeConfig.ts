import { app } from "electron";
import fs from "fs";
import path from "path";

export interface SttRuntimeConfig {
  selectedProvider: string;
  priorityOrder: string[];
  deepgramApiKey?: string;
  googleCredentialsPath: string | null;
  whisperEnabled: boolean;
  whisperModelId: string;
  whisperModelPath: string;
  whisperAllowRemote: boolean;
}

export interface SttRuntimeValidationResult {
  errors: string[];
  warnings: string[];
}

export const SUPPORTED_RUNTIME_STT_PROVIDERS = ["deepgram", "google", "whisper"] as const;
export const DEFAULT_RUNTIME_STT_PROVIDER = "deepgram";
export const DEFAULT_RUNTIME_STT_CHAIN = [...SUPPORTED_RUNTIME_STT_PROVIDERS];

export type SupportedRuntimeSttProvider = typeof SUPPORTED_RUNTIME_STT_PROVIDERS[number];

export function isSupportedRuntimeSttProvider(provider: string | null | undefined): provider is SupportedRuntimeSttProvider {
  return SUPPORTED_RUNTIME_STT_PROVIDERS.includes((provider || "").trim().toLowerCase() as SupportedRuntimeSttProvider);
}

export function normalizeRuntimeSttProvider(provider: string | null | undefined): SupportedRuntimeSttProvider {
  return isSupportedRuntimeSttProvider(provider) ? provider : DEFAULT_RUNTIME_STT_PROVIDER;
}

export function normalizePriorityOrder(rawValue: string | undefined): string[] {
  const baseChain = [...DEFAULT_RUNTIME_STT_CHAIN];
  if (!rawValue?.trim()) {
    return baseChain;
  }

  let parsedProviders: string[] = [];
  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      parsedProviders = parsed.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
    }
  } catch {
    parsedProviders = rawValue.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  }

  const deduped = new Set<string>();
  for (const provider of parsedProviders) {
    if (isSupportedRuntimeSttProvider(provider)) {
      deduped.add(provider);
    }
  }

  // Enforce the production fallback chain order even if the environment variable
  // contains noise or a partial subset from an older build.
  return baseChain.filter((provider) => deduped.size === 0 || deduped.has(provider));
}

export function loadSttRuntimeConfig(credentialsManager?: any): SttRuntimeConfig {
  const selectedProvider = normalizeRuntimeSttProvider(credentialsManager?.getSttProvider?.());
  const whisperModelPath = process.env.STT_WHISPER_MODEL_PATH
    || path.join(
      app.isPackaged ? process.resourcesPath : path.join(__dirname, "../../../../resources"),
      "models",
    );
  const googleCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
    || credentialsManager?.getGoogleServiceAccountPath?.()
    || null;

  return {
    selectedProvider,
    priorityOrder: normalizePriorityOrder(process.env.STT_PRIORITY_ORDER),
    deepgramApiKey: credentialsManager?.getDeepgramApiKey?.()?.trim() || undefined,
    googleCredentialsPath,
    whisperEnabled: process.env.ENABLE_WHISPER_STT === "true",
    whisperModelId: process.env.STT_WHISPER_MODEL || "Xenova/whisper-tiny.en",
    whisperModelPath,
    whisperAllowRemote: process.env.STT_WHISPER_ALLOW_REMOTE === "true",
  };
}

export function validateSttRuntimeConfig(config: SttRuntimeConfig): SttRuntimeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const availableProviders = new Set<string>();
  if (config.deepgramApiKey) {
    availableProviders.add("deepgram");
  }
  if (config.googleCredentialsPath && fs.existsSync(config.googleCredentialsPath)) {
    availableProviders.add("google");
  }
  if (config.whisperEnabled) {
    const modelPathExists = fs.existsSync(config.whisperModelPath);
    if (config.whisperAllowRemote || modelPathExists) {
      availableProviders.add("whisper");
    }
    if (!config.whisperAllowRemote && !modelPathExists) {
      warnings.push(`Whisper model path does not exist: ${config.whisperModelPath}`);
    }
  }

  if (config.selectedProvider === "deepgram" && !config.deepgramApiKey) {
    errors.push("Deepgram is selected but no Deepgram API key is configured.");
  }
  if (config.selectedProvider === "google" && (!config.googleCredentialsPath || !fs.existsSync(config.googleCredentialsPath))) {
    errors.push("Google STT is selected but the Google credentials path is missing or invalid.");
  }
  if (config.selectedProvider === "whisper" && !config.whisperEnabled) {
    errors.push("Whisper STT is selected but ENABLE_WHISPER_STT is not enabled.");
  }

  if (config.googleCredentialsPath && !fs.existsSync(config.googleCredentialsPath)) {
    warnings.push(`Google credentials path does not exist: ${config.googleCredentialsPath}`);
  }

  const supportedPriority = config.priorityOrder.filter((provider) => isSupportedRuntimeSttProvider(provider));
  if (supportedPriority.length === 0) {
    errors.push("STT priority order resolved to an empty provider list.");
  }

  const anyConfiguredInPriority = supportedPriority.some((provider) => availableProviders.has(provider));
  if (!anyConfiguredInPriority) {
    errors.push(`No valid STT providers are configured for priority order: ${supportedPriority.join(", ") || "(empty)"}`);
  }

  return { errors, warnings };
}

export function assertValidSttRuntimeConfig(config: SttRuntimeConfig): void {
  const result = validateSttRuntimeConfig(config);
  if (result.errors.length > 0) {
    throw new Error(`[STT Config] ${result.errors.join(" ")}`);
  }
}
