/**
 * CredentialsManager - Secure storage for API keys and service account paths
 * Uses Electron's safeStorage API for encryption at rest
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import {
    DEFAULT_RUNTIME_STT_PROVIDER,
    isSupportedRuntimeSttProvider,
    normalizeRuntimeSttProvider,
    type SupportedRuntimeSttProvider,
} from '../audio/stt/SttRuntimeConfig';

const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'credentials.enc');

export interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
}

export interface CurlProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string; // e.g. "choices[0].message.content"
}

/** Persistent vault entry for a Groq API key. Runtime health is NOT persisted. */
export interface GroqVaultKey {
    id: string;           // crypto.randomUUID()
    key: string;          // raw API key (encrypted at rest by safeStorage)
    enabled: boolean;     // user toggle
    addedAt: number;      // Date.now() when added
    label?: string;       // optional user label
}

export interface StoredCredentials {
    geminiApiKey?: string;
    groqApiKey?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
    googleServiceAccountPath?: string;
    customProviders?: CustomProvider[];
    curlProviders?: CurlProvider[];
    defaultModel?: string;
    teamsyncApiKey?: string;
    // STT Provider settings
    sttProvider?: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'teamsync' | 'whisper';
    groqSttApiKey?: string;
    groqSttModel?: string;
    openAiSttApiKey?: string;
    deepgramApiKey?: string;
    elevenLabsApiKey?: string;
    azureApiKey?: string;
    azureRegion?: string;
    ibmWatsonApiKey?: string;
    ibmWatsonRegion?: string;
    sonioxApiKey?: string;
    sttLanguage?: string;
    aiResponseLanguage?: string;
    // Tavily Search
    tavilyApiKey?: string;
    // Dynamic Model Discovery – preferred models per provider
    geminiPreferredModel?: string;
    groqPreferredModel?: string;
    openaiPreferredModel?: string;
    claudePreferredModel?: string;
    // Groq Provider Vault — multi-key management
    groqKeyVault?: GroqVaultKey[];
    // Free trial state
    trialToken?:     string;   // server-issued signed token (teamsync_trial_…)
    trialExpiresAt?: string;   // ISO timestamp — local copy for startup check
    trialStartedAt?: string;   // ISO timestamp
    trialClaimed?:   boolean;  // set true on first claim, never cleared — hides start card permanently
    // Backend server credentials (production packaged app only)
    backendMongodbUri?: string;
    backendMongodbDbName?: string;
    backendGoogleClientId?: string;
    backendGoogleClientSecret?: string;
    backendJwtSecret?: string;
    backendRedirectUri?: string;
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private credentials: StoredCredentials = {};
    private unsupportedProviderWarnings = new Set<string>();

    private constructor() {
        // Load on construction after app ready
    }

    public static getInstance(): CredentialsManager {
        if (!CredentialsManager.instance) {
            CredentialsManager.instance = new CredentialsManager();
        }
        return CredentialsManager.instance;
    }

    /**
     * Initialize - load credentials from disk
     * Must be called after app.whenReady()
     */
    public init(): void {
        this.loadCredentials();
        console.log('[CredentialsManager] Initialized');
    }

    // =========================================================================
    // Getters
    // =========================================================================

    public getGeminiApiKey(): string | undefined {
        return this.credentials.geminiApiKey;
    }

    public getGroqApiKey(): string | undefined {
        return this.credentials.groqApiKey;
    }

    public getOpenaiApiKey(): string | undefined {
        return this.credentials.openaiApiKey;
    }

    public getClaudeApiKey(): string | undefined {
        return this.credentials.claudeApiKey;
    }

    public getGoogleServiceAccountPath(): string | undefined {
        return this.credentials.googleServiceAccountPath;
    }

    public getCustomProviders(): CustomProvider[] {
        return this.credentials.customProviders || [];
    }

    public getSttProvider(): SupportedRuntimeSttProvider {
        const rawProvider = this.credentials.sttProvider;
        const normalizedProvider = normalizeRuntimeSttProvider(rawProvider);
        if (rawProvider !== normalizedProvider) {
            this.warnAndNormalizeSttProvider(rawProvider);
        }
        return normalizedProvider;
    }

    public getDeepgramApiKey(): string | undefined {
        return this.credentials.deepgramApiKey;
    }

    public getGroqSttApiKey(): string | undefined {
        return this.credentials.groqSttApiKey;
    }

    public getGroqSttModel(): string {
        return this.credentials.groqSttModel || 'whisper-large-v3-turbo';
    }

    public getOpenAiSttApiKey(): string | undefined {
        return this.credentials.openAiSttApiKey;
    }

    public getElevenLabsApiKey(): string | undefined {
        return this.credentials.elevenLabsApiKey;
    }

    public getAzureApiKey(): string | undefined {
        return this.credentials.azureApiKey;
    }

    public getAzureRegion(): string {
        return this.credentials.azureRegion || 'eastus';
    }

    public getIbmWatsonApiKey(): string | undefined {
        return this.credentials.ibmWatsonApiKey;
    }

    public getIbmWatsonRegion(): string {
        return this.credentials.ibmWatsonRegion || 'us-south';
    }

    public getSonioxApiKey(): string | undefined {
        return this.credentials.sonioxApiKey;
    }

    public getTavilyApiKey(): string | undefined {
        return this.credentials.tavilyApiKey;
    }

    public getSttLanguage(): string {
        return this.credentials.sttLanguage || 'english-us';
    }

    public getAiResponseLanguage(): string {
        return this.credentials.aiResponseLanguage || 'auto';
    }
    public getDefaultModel(): string {
        return this.credentials.defaultModel || 'gemini-3.1-flash-lite-preview';
    }

    public getTeamSyncApiKey(): string | undefined {
        return this.credentials.teamsyncApiKey;
    }

    public getAllCredentials(): StoredCredentials {
        return { ...this.credentials };
    }

    // =========================================================================
    // Setters (auto-save)
    // =========================================================================

    public setGeminiApiKey(key: string): void {
        this.credentials.geminiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Gemini API Key updated');
    }

    public setGroqApiKey(key: string): void {
        this.credentials.groqApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq API Key updated');
    }

    public setOpenaiApiKey(key: string): void {
        this.credentials.openaiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI API Key updated');
    }

    public setClaudeApiKey(key: string): void {
        this.credentials.claudeApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Claude API Key updated');
    }

    public setGoogleServiceAccountPath(filePath: string): void {
        this.credentials.googleServiceAccountPath = filePath;
        this.saveCredentials();
        console.log('[CredentialsManager] Google Service Account path updated');
    }

    public setSttProvider(provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'teamsync' | 'whisper'): void {
        const normalizedProvider = normalizeRuntimeSttProvider(provider);
        if (provider !== normalizedProvider) {
            this.logUnsupportedProviderSelection(provider, normalizedProvider);
        }
        this.credentials.sttProvider = normalizedProvider;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Provider set to: ${normalizedProvider}`);
    }

    public setDeepgramApiKey(key: string): void {
        this.credentials.deepgramApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Deepgram API Key updated');
    }

    public setGroqSttApiKey(key: string): void {
        this.credentials.groqSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq STT API Key updated');
    }

    public setOpenAiSttApiKey(key: string): void {
        this.credentials.openAiSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI STT API Key updated');
    }

    public setGroqSttModel(model: string): void {
        this.credentials.groqSttModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq STT Model set to: ${model}`);
    }

    public setElevenLabsApiKey(key: string): void {
        this.credentials.elevenLabsApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] ElevenLabs API Key updated');
    }

    private warnAndNormalizeSttProvider(rawProvider: string | undefined): void {
        const normalizedProvider = normalizeRuntimeSttProvider(rawProvider);
        this.logUnsupportedProviderSelection(rawProvider, normalizedProvider);
        this.credentials.sttProvider = normalizedProvider;
        this.saveCredentials();
    }

    private logUnsupportedProviderSelection(rawProvider: string | undefined, normalizedProvider: string): void {
        const unsupportedProvider = (rawProvider || '').trim().toLowerCase();
        const warningKey = unsupportedProvider || 'unset';
        if (this.unsupportedProviderWarnings.has(warningKey)) {
            return;
        }

        this.unsupportedProviderWarnings.add(warningKey);
        if (!unsupportedProvider || unsupportedProvider === normalizedProvider) {
            console.warn(
                `[CredentialsManager] No supported STT provider was configured. Defaulting runtime provider to ${DEFAULT_RUNTIME_STT_PROVIDER}.`
            );
            return;
        }

        if (!isSupportedRuntimeSttProvider(unsupportedProvider)) {
            console.warn(
                `[CredentialsManager] STT provider "${rawProvider}" is not supported at runtime. Falling back to ${normalizedProvider}.`
            );
        }
    }

    public setAzureApiKey(key: string): void {
        this.credentials.azureApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Azure API Key updated');
    }

    public setAzureRegion(region: string): void {
        this.credentials.azureRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] Azure Region set to: ${region}`);
    }

    public setIbmWatsonApiKey(key: string): void {
        this.credentials.ibmWatsonApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] IBM Watson API Key updated');
    }

    public setIbmWatsonRegion(region: string): void {
        this.credentials.ibmWatsonRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] IBM Watson Region set to: ${region}`);
    }

    public setSonioxApiKey(key: string): void {
        this.credentials.sonioxApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Soniox API Key updated');
    }

    public setTavilyApiKey(key: string): void {
        // Store undefined (not empty string) when removing, so hasKey() checks stay consistent
        this.credentials.tavilyApiKey = key.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Tavily API Key updated');
    }

    public setSttLanguage(language: string): void {
        this.credentials.sttLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Language set to: ${language}`);
    }

    public setAiResponseLanguage(language: string): void {
        this.credentials.aiResponseLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] AI Response Language set to: ${language}`);
    }
    public setDefaultModel(model: string): void {
        this.credentials.defaultModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Default Model set to: ${model}`);
    }

    public setTeamSyncApiKey(key: string): void {
        const trimmed = key.trim();
        this.credentials.teamsyncApiKey = trimmed || undefined;

        if (trimmed) {
            // Auto-promote teamsync to default model unless user already chose a non-Gemini/Groq model
            const current = this.credentials.defaultModel || '';
            const isAutoDefault = !current
                || current.startsWith('gemini-')
                || current.startsWith('llama-')
                || current.startsWith('mixtral-')
                || current.startsWith('gemma-')
                || current === 'gemini'
                || current === 'llama';
            if (isAutoDefault) {
                this.credentials.defaultModel = 'teamsync';
                console.log('[CredentialsManager] Auto-set default model to teamsync');
            }

            // Auto-promote teamsync STT if still on 'none' or the default Google STT
            if (!this.credentials.sttProvider || this.credentials.sttProvider === 'none' || this.credentials.sttProvider === 'google') {
                this.credentials.sttProvider = 'teamsync';
                console.log('[CredentialsManager] Auto-set STT provider to teamsync');
            }
        } else {
            // Key cleared — revert teamsync-auto-set defaults back to safe fallbacks
            if (this.credentials.defaultModel === 'teamsync') {
                this.credentials.defaultModel = 'gemini-3.1-flash-lite-preview';
                console.log('[CredentialsManager] TeamSync key cleared — reset default model to Gemini Flash');
            }
            if (this.credentials.sttProvider === 'teamsync') {
                this.credentials.sttProvider = 'none';
                console.log('[CredentialsManager] TeamSync key cleared — reset STT provider to none');
            }
        }

        this.saveCredentials();
        console.log('[CredentialsManager] TeamSync API Key updated');
    }

    public getPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude'): string | undefined {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.credentials[key] as string | undefined;
    }

    public setPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string): void {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        (this.credentials as any)[key] = modelId;
        this.saveCredentials();
        console.log(`[CredentialsManager] ${provider} preferred model set to: ${modelId}`);
    }

    public saveCustomProvider(provider: CustomProvider): void {
        if (!this.credentials.customProviders) {
            this.credentials.customProviders = [];
        }
        // Check if exists, update if so
        const index = this.credentials.customProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.customProviders[index] = provider;
        } else {
            this.credentials.customProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${provider.name}' saved`);
    }

    public deleteCustomProvider(id: string): void {
        if (!this.credentials.customProviders) return;
        this.credentials.customProviders = this.credentials.customProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${id}' deleted`);
    }

    public getCurlProviders(): CurlProvider[] {
        return this.credentials.curlProviders || [];
    }

    public saveCurlProvider(provider: CurlProvider): void {
        if (!this.credentials.curlProviders) {
            this.credentials.curlProviders = [];
        }
        const index = this.credentials.curlProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.curlProviders[index] = provider;
        } else {
            this.credentials.curlProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${provider.name}' saved`);
    }

    public deleteCurlProvider(id: string): void {
        if (!this.credentials.curlProviders) return;
        this.credentials.curlProviders = this.credentials.curlProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${id}' deleted`);
    }

    // ── Groq Provider Vault ────────────────────────────────────

    public getGroqKeyVault(): GroqVaultKey[] {
        return this.credentials.groqKeyVault || [];
    }

    /**
     * Add a new key to the Groq vault. Deduplicates by raw key value.
     * Returns the created entry, or the existing entry if key already exists.
     */
    public addGroqVaultKey(key: string, label?: string): GroqVaultKey {
        if (!this.credentials.groqKeyVault) {
            this.credentials.groqKeyVault = [];
        }

        const trimmed = key.trim();
        // Deduplicate — don't add the same raw key twice
        const existing = this.credentials.groqKeyVault.find(k => k.key === trimmed);
        if (existing) return existing;

        const entry: GroqVaultKey = {
            id: crypto.randomUUID(),
            key: trimmed,
            enabled: true,
            addedAt: Date.now(),
            label,
        };
        this.credentials.groqKeyVault.push(entry);
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq vault key added (vault size: ${this.credentials.groqKeyVault.length})`);
        return entry;
    }

    public removeGroqVaultKey(id: string): void {
        if (!this.credentials.groqKeyVault) return;
        this.credentials.groqKeyVault = this.credentials.groqKeyVault.filter(k => k.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq vault key removed: ${id}`);
    }

    public toggleGroqVaultKey(id: string, enabled: boolean): void {
        if (!this.credentials.groqKeyVault) return;
        const entry = this.credentials.groqKeyVault.find(k => k.id === id);
        if (entry) {
            entry.enabled = enabled;
            this.saveCredentials();
            console.log(`[CredentialsManager] Groq vault key ${id} ${enabled ? 'enabled' : 'disabled'}`);
        }
    }

    /** Bulk replace the entire vault (used during migration). */
    public setGroqKeyVault(keys: GroqVaultKey[]): void {
        this.credentials.groqKeyVault = keys;
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq vault replaced (${keys.length} key(s))`);
    }

    // ── Free Trial ─────────────────────────────────────────────
    public getTrialToken(): string | undefined {
        return this.credentials.trialToken;
    }

    public getTrialExpiresAt(): string | undefined {
        return this.credentials.trialExpiresAt;
    }

    public getTrialStartedAt(): string | undefined {
        return this.credentials.trialStartedAt;
    }

    public getTrialClaimed(): boolean {
        return this.credentials.trialClaimed === true;
    }

    public setTrialToken(token: string, expiresAt: string, startedAt: string): void {
        this.credentials.trialToken     = token;
        this.credentials.trialExpiresAt = expiresAt;
        this.credentials.trialStartedAt = startedAt;
        this.credentials.trialClaimed   = true;
        this.saveCredentials();
        console.log('[CredentialsManager] Trial token stored, expires:', expiresAt);
    }

    public clearTrialToken(): void {
        delete this.credentials.trialToken;
        delete this.credentials.trialExpiresAt;
        delete this.credentials.trialStartedAt;
        // trialClaimed intentionally NOT cleared — keeps start card hidden after token wipe
        this.saveCredentials();
        console.log('[CredentialsManager] Trial token cleared');
    }

    // ── Backend Server Credentials (Production Only) ───────────

    public getBackendMongodbUri(): string | undefined {
        return this.credentials.backendMongodbUri;
    }

    public setBackendMongodbUri(uri: string): void {
        this.credentials.backendMongodbUri = uri;
        this.saveCredentials();
        console.log('[CredentialsManager] Backend MongoDB URI updated');
    }

    public getBackendMongodbDbName(): string | undefined {
        return this.credentials.backendMongodbDbName;
    }

    public setBackendMongodbDbName(name: string): void {
        this.credentials.backendMongodbDbName = name;
        this.saveCredentials();
        console.log('[CredentialsManager] Backend MongoDB DB name updated');
    }

    public getBackendGoogleClientId(): string | undefined {
        return this.credentials.backendGoogleClientId;
    }

    public setBackendGoogleClientId(id: string): void {
        this.credentials.backendGoogleClientId = id;
        this.saveCredentials();
        console.log('[CredentialsManager] Backend Google Client ID updated');
    }

    public getBackendGoogleClientSecret(): string | undefined {
        return this.credentials.backendGoogleClientSecret;
    }

    public setBackendGoogleClientSecret(secret: string): void {
        this.credentials.backendGoogleClientSecret = secret;
        this.saveCredentials();
        console.log('[CredentialsManager] Backend Google Client Secret updated');
    }

    public getBackendJwtSecret(): string | undefined {
        return this.credentials.backendJwtSecret;
    }

    public setBackendJwtSecret(secret: string): void {
        this.credentials.backendJwtSecret = secret;
        this.saveCredentials();
        console.log('[CredentialsManager] Backend JWT Secret updated');
    }

    public getBackendRedirectUri(): string | undefined {
        return this.credentials.backendRedirectUri;
    }

    public setBackendRedirectUri(uri: string): void {
        this.credentials.backendRedirectUri = uri;
        this.saveCredentials();
        console.log('[CredentialsManager] Backend Redirect URI updated');
    }

    /**
     * Returns true if ALL required backend credentials are present.
     */
    public hasBackendCredentials(): boolean {
        return !!(
            this.credentials.backendMongodbUri &&
            this.credentials.backendMongodbDbName &&
            this.credentials.backendGoogleClientId &&
            this.credentials.backendGoogleClientSecret &&
            this.credentials.backendJwtSecret &&
            this.credentials.backendRedirectUri
        );
    }

    /**
     * Seed backend credentials from compile-time defaults.
     * Called ONLY on first packaged launch when no backend credentials exist.
     * If credentials are already stored, this is a no-op — stored credentials
     * always take precedence over defaults.
     */
    public seedBackendCredentials(): boolean {
        if (this.hasBackendCredentials()) {
            console.log('[CredentialsManager] Backend credentials already present, skipping seed');
            return false;
        }

        try {
            const { BACKEND_DEFAULTS } = require('../config/backendDefaults');
            this.credentials.backendMongodbUri = BACKEND_DEFAULTS.MONGODB_URI;
            this.credentials.backendMongodbDbName = BACKEND_DEFAULTS.MONGODB_DB_NAME;
            this.credentials.backendGoogleClientId = BACKEND_DEFAULTS.GOOGLE_CLIENT_ID;
            this.credentials.backendGoogleClientSecret = BACKEND_DEFAULTS.GOOGLE_CLIENT_SECRET;
            this.credentials.backendJwtSecret = BACKEND_DEFAULTS.JWT_SECRET;
            this.credentials.backendRedirectUri = BACKEND_DEFAULTS.REDIRECT_URI;
            this.saveCredentials();
            console.log('[CredentialsManager] Backend credentials seeded from defaults');
            return true;
        } catch (error) {
            console.error('[CredentialsManager] Failed to seed backend credentials:', error);
            return false;
        }
    }

    public clearAll(): void {
        this.scrubMemory();
        if (fs.existsSync(CREDENTIALS_PATH)) {
            fs.unlinkSync(CREDENTIALS_PATH);
        }
        const plaintextPath = CREDENTIALS_PATH + '.json';
        if (fs.existsSync(plaintextPath)) {
            fs.unlinkSync(plaintextPath);
        }
        console.log('[CredentialsManager] All credentials cleared');
    }

    /**
     * Scrub all API keys from memory to minimize exposure window.
     * Called on app quit and credential clear.
     */
    public scrubMemory(): void {
        // Overwrite each string field with empty before discarding
        for (const key of Object.keys(this.credentials) as (keyof StoredCredentials)[]) {
            const val = this.credentials[key];
            if (typeof val === 'string') {
                (this.credentials as any)[key] = '';
            }
        }
        this.credentials = {};
        console.log('[CredentialsManager] Memory scrubbed');
    }

    // =========================================================================
    // Storage (Encrypted)
    // =========================================================================

    private saveCredentials(): void {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                console.warn('[CredentialsManager] Encryption not available, falling back to plaintext');
                // Fallback: save as plaintext (less secure, but functional)
                const plainPath = CREDENTIALS_PATH + '.json';
                const tmpPlain = plainPath + '.tmp';
                fs.writeFileSync(tmpPlain, JSON.stringify(this.credentials));
                fs.renameSync(tmpPlain, plainPath);
                return;
            }

            const data = JSON.stringify(this.credentials);
            const encrypted = safeStorage.encryptString(data);
            const tmpEnc = CREDENTIALS_PATH + '.tmp';
            fs.writeFileSync(tmpEnc, encrypted);
            fs.renameSync(tmpEnc, CREDENTIALS_PATH);
        } catch (error) {
            console.error('[CredentialsManager] Failed to save credentials:', error);
        }
    }

    private loadCredentials(): void {
        try {
            // Try encrypted file first
            if (fs.existsSync(CREDENTIALS_PATH)) {
                if (!safeStorage.isEncryptionAvailable()) {
                    console.warn('[CredentialsManager] Encryption not available for load');
                    return;
                }

                const encrypted = fs.readFileSync(CREDENTIALS_PATH);
                const decrypted = safeStorage.decryptString(encrypted);
                try {
                    const parsed = JSON.parse(decrypted);
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.credentials = parsed;
                        console.log('[CredentialsManager] Loaded encrypted credentials');
                    } else {
                        throw new Error('Decrypted credentials is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[CredentialsManager] Failed to parse decrypted credentials — file may be corrupted. Starting fresh:', parseError);
                    this.credentials = {};
                }

                // Clean up any leftover plaintext fallback file to eliminate the data leak
                const plaintextPath = CREDENTIALS_PATH + '.json';
                if (fs.existsSync(plaintextPath)) {
                    try {
                        fs.unlinkSync(plaintextPath);
                        console.log('[CredentialsManager] Removed stale plaintext credential file');
                    } catch (cleanupErr) {
                        console.warn('[CredentialsManager] Could not remove stale plaintext file:', cleanupErr);
                    }
                }
                return;
            }

            // Fallback: try plaintext file
            const plaintextPath = CREDENTIALS_PATH + '.json';
            if (fs.existsSync(plaintextPath)) {
                const data = fs.readFileSync(plaintextPath, 'utf-8');
                try {
                    const parsed = JSON.parse(data);
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.credentials = parsed;
                        console.log('[CredentialsManager] Loaded plaintext credentials');
                    } else {
                        throw new Error('Plaintext credentials is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[CredentialsManager] Failed to parse plaintext credentials — file may be corrupted. Starting fresh:', parseError);
                    this.credentials = {};
                }
                return;
            }

            console.log('[CredentialsManager] No stored credentials found');
        } catch (error) {
            console.error('[CredentialsManager] Failed to load credentials:', error);
            this.credentials = {};
        }
    }
}
