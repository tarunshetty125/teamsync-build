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

function normalizePriorityOrder(rawValue: string | undefined, selectedProvider: string): string[] {
  if (!rawValue?.trim()) {
    return selectedProvider === "google"
      ? ["google", "deepgram", "whisper"]
      : ["deepgram", "google", "whisper"];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
    }
  } catch {
    // Fall back to CSV parsing.
  }

  return rawValue.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function loadSttRuntimeConfig(credentialsManager?: any): SttRuntimeConfig {
  const selectedProvider = credentialsManager?.getSttProvider?.() || "none";
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
    priorityOrder: normalizePriorityOrder(process.env.STT_PRIORITY_ORDER, selectedProvider),
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

  if (config.selectedProvider === "none") {
    return { errors, warnings };
  }

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

  const supportedPriority = config.priorityOrder.filter((provider) => ["deepgram", "google", "whisper"].includes(provider));
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
