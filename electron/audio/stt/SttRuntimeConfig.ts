import { app } from "electron";
import fs from "fs";
import path from "path";

export interface SttRuntimeConfig {
  selectedProvider: string;
  priorityOrder: string[];
  deepgramApiKey?: string;
  groqApiKey?: string;
  openaiApiKey?: string;
  elevenLabsApiKey?: string;
  azureApiKey?: string;
  azureRegion?: string;
  ibmWatsonApiKey?: string;
  ibmWatsonRegion?: string;
  sonioxApiKey?: string;
  teamsyncApiKey?: string;
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

export const SUPPORTED_RUNTIME_STT_PROVIDERS = [
  "none",
  "google",
  "groq",
  "openai",
  "deepgram",
  "elevenlabs",
  "azure",
  "ibmwatson",
  "soniox",
  "teamsync",
  "whisper",
] as const;
export const DEFAULT_RUNTIME_STT_PROVIDER = "deepgram";
export const DEFAULT_RUNTIME_STT_CHAIN = ["deepgram", "google", "whisper"] as const;

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
  const filtered = baseChain.filter((provider) => deduped.size === 0 || deduped.has(provider));
  return filtered.length > 0 ? filtered : baseChain;
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
    groqApiKey: credentialsManager?.getGroqSttApiKey?.()?.trim() || undefined,
    openaiApiKey: credentialsManager?.getOpenAiSttApiKey?.()?.trim() || undefined,
    elevenLabsApiKey: credentialsManager?.getElevenLabsApiKey?.()?.trim() || undefined,
    azureApiKey: credentialsManager?.getAzureApiKey?.()?.trim() || undefined,
    azureRegion: credentialsManager?.getAzureRegion?.()?.trim?.() || credentialsManager?.getAzureRegion?.() || "eastus",
    ibmWatsonApiKey: credentialsManager?.getIbmWatsonApiKey?.()?.trim() || undefined,
    ibmWatsonRegion: credentialsManager?.getIbmWatsonRegion?.()?.trim?.() || credentialsManager?.getIbmWatsonRegion?.() || "us-south",
    sonioxApiKey: credentialsManager?.getSonioxApiKey?.()?.trim() || undefined,
    teamsyncApiKey: credentialsManager?.getTeamSyncApiKey?.()?.trim() || undefined,
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
  if (config.groqApiKey) {
    availableProviders.add("groq");
  }
  if (config.openaiApiKey) {
    availableProviders.add("openai");
  }
  if (config.elevenLabsApiKey) {
    availableProviders.add("elevenlabs");
  }
  if (config.azureApiKey) {
    availableProviders.add("azure");
  }
  if (config.ibmWatsonApiKey) {
    availableProviders.add("ibmwatson");
  }
  if (config.sonioxApiKey) {
    availableProviders.add("soniox");
  }
  if (config.teamsyncApiKey) {
    availableProviders.add("teamsync");
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

  if (config.selectedProvider !== "none") {
    if (config.selectedProvider === "deepgram" && !config.deepgramApiKey) {
      errors.push("Deepgram is selected but no Deepgram API key is configured.");
    }
    if (config.selectedProvider === "groq" && !config.groqApiKey) {
      errors.push("Groq STT is selected but no Groq STT API key is configured.");
    }
    if (config.selectedProvider === "openai" && !config.openaiApiKey) {
      errors.push("OpenAI STT is selected but no OpenAI STT API key is configured.");
    }
    if (config.selectedProvider === "elevenlabs" && !config.elevenLabsApiKey) {
      errors.push("ElevenLabs STT is selected but no ElevenLabs API key is configured.");
    }
    if (config.selectedProvider === "azure" && !config.azureApiKey) {
      errors.push("Azure STT is selected but no Azure API key is configured.");
    }
    if (config.selectedProvider === "ibmwatson" && !config.ibmWatsonApiKey) {
      errors.push("IBM Watson STT is selected but no IBM Watson API key is configured.");
    }
    if (config.selectedProvider === "soniox" && !config.sonioxApiKey) {
      errors.push("Soniox STT is selected but no Soniox API key is configured.");
    }
    if (config.selectedProvider === "teamsync" && !config.teamsyncApiKey) {
      errors.push("TeamSync STT is selected but no TeamSync API key is configured.");
    }
    if (config.selectedProvider === "google" && (!config.googleCredentialsPath || !fs.existsSync(config.googleCredentialsPath))) {
      errors.push("Google STT is selected but the Google credentials path is missing or invalid.");
    }
    if (config.selectedProvider === "whisper" && !config.whisperEnabled) {
      errors.push("Whisper STT is selected but ENABLE_WHISPER_STT is not enabled.");
    }
  }

  if (config.googleCredentialsPath && !fs.existsSync(config.googleCredentialsPath)) {
    warnings.push(`Google credentials path does not exist: ${config.googleCredentialsPath}`);
  }

  const supportedPriority = config.priorityOrder.filter((provider) => isSupportedRuntimeSttProvider(provider));
  if (config.selectedProvider !== "none") {
    if (supportedPriority.length === 0) {
      errors.push("STT priority order resolved to an empty provider list.");
    }

    const selectedOrFallbackProviders = new Set<string>([config.selectedProvider, ...supportedPriority]);
    const anyConfiguredInPriority = Array.from(selectedOrFallbackProviders).some((provider) => availableProviders.has(provider));
    if (!anyConfiguredInPriority) {
      errors.push(`No valid STT providers are configured for selection/fallback order: ${Array.from(selectedOrFallbackProviders).join(", ") || "(empty)"}`);
    }
  }

  return { errors, warnings };
}

export function assertValidSttRuntimeConfig(config: SttRuntimeConfig): void {
  const result = validateSttRuntimeConfig(config);
  if (result.errors.length > 0) {
    throw new Error(`[STT Config] ${result.errors.join(" ")}`);
  }
}
