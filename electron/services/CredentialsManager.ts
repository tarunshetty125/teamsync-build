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
import { isBedrockModelId, resolveBedrockModelId } from '../llm/BedrockModelIds';

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

export type BedrockAuthMode = 'aws_cli' | 'access_keys';

export interface BedrockCredentials {
    authMode: BedrockAuthMode;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    profileName?: string;
    region: string;
    preferredModel?: string;
}

export interface BedrockFetchedModel {
    id: string;
    label: string;
    inputModalities?: string[];
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
    bedrockPreferredModel?: string;
    bedrockCredentials?: BedrockCredentials;
    bedrockFetchedModels?: BedrockFetchedModel[];
    // Groq Provider Vault — multi-key management
    groqKeyVault?: GroqVaultKey[];
    // Groq fetched model catalog — persisted so overlay windows can read without re-fetching
    groqFetchedModels?: { id: string; label: string }[];
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

    public getBedrockCredentials(): BedrockCredentials | undefined {
        const existing = this.credentials.bedrockCredentials;
        if (!existing) return undefined;
        return {
            ...existing,
            authMode: existing.authMode || 'aws_cli',
            region: existing.region || 'us-east-1',
            preferredModel: existing.preferredModel || this.credentials.bedrockPreferredModel,
        };
    }

    public hasBedrockCredentials(): boolean {
        const creds = this.getBedrockCredentials();
        if (!creds?.region?.trim()) return false;
        if (creds.authMode === 'aws_cli') return true;
        return !!(creds.accessKeyId?.trim() && creds.secretAccessKey?.trim());
    }

    public getDefaultModel(): string {
        const model = this.credentials.defaultModel || 'gemini-3.1-flash-lite-preview';
        const bedrockPreferred = this.credentials.bedrockPreferredModel || this.credentials.bedrockCredentials?.preferredModel;
        if (isBedrockModelId(model, bedrockPreferred)) {
            return resolveBedrockModelId(model, bedrockPreferred) || model;
        }
        return model;
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

    public getPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'bedrock'): string | undefined {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.credentials[key] as string | undefined;
    }

    public setPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'bedrock', modelId: string): void {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        (this.credentials as any)[key] = modelId;
        if (provider === 'bedrock') {
            this.credentials.bedrockCredentials = {
                authMode: 'aws_cli',
                region: 'us-east-1',
                ...this.credentials.bedrockCredentials,
                preferredModel: modelId,
            };
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] ${provider} preferred model set to: ${modelId}`);
    }

    public setBedrockCredentials(credentials: Partial<BedrockCredentials> & { authMode: BedrockAuthMode; region: string }): void {
        const previous = this.credentials.bedrockCredentials || {
            authMode: 'aws_cli' as BedrockAuthMode,
            region: 'us-east-1',
        };

        this.credentials.bedrockCredentials = {
            ...previous,
            ...credentials,
            authMode: credentials.authMode,
            region: credentials.region?.trim() || previous.region || 'us-east-1',
            accessKeyId: credentials.accessKeyId !== undefined ? credentials.accessKeyId.trim() || undefined : previous.accessKeyId,
            secretAccessKey: credentials.secretAccessKey !== undefined ? credentials.secretAccessKey.trim() || undefined : previous.secretAccessKey,
            sessionToken: credentials.sessionToken !== undefined ? credentials.sessionToken.trim() || undefined : previous.sessionToken,
            profileName: credentials.profileName !== undefined ? credentials.profileName.trim() || undefined : previous.profileName,
            preferredModel: credentials.preferredModel !== undefined ? credentials.preferredModel.trim() || undefined : previous.preferredModel,
        };

        if (this.credentials.bedrockCredentials.preferredModel) {
            this.credentials.bedrockPreferredModel = this.credentials.bedrockCredentials.preferredModel;
        }

        this.saveCredentials();
        console.log('[CredentialsManager] Bedrock credentials updated', {
            authMode: this.credentials.bedrockCredentials.authMode,
            region: this.credentials.bedrockCredentials.region,
            hasAccessKeyId: !!this.credentials.bedrockCredentials.accessKeyId,
            hasSecretAccessKey: !!this.credentials.bedrockCredentials.secretAccessKey,
            hasSessionToken: !!this.credentials.bedrockCredentials.sessionToken,
            hasProfileName: !!this.credentials.bedrockCredentials.profileName,
        });
    }

    public async testBedrockConnection(credentials?: BedrockCredentials): Promise<void> {
        const resolved = credentials || this.getBedrockCredentials();
        if (!resolved) throw new Error('No Bedrock credentials configured.');
        const { BedrockClient } = require('./BedrockClient');
        await new BedrockClient(resolved).validate();
        console.log('[BEDROCK_AUTH]', {
            authMode: resolved.authMode,
            region: resolved.region,
            success: true,
        });
    }

    public async fetchBedrockModels(credentials?: BedrockCredentials): Promise<BedrockFetchedModel[]> {
        const resolved = credentials || this.getBedrockCredentials();
        if (!resolved) throw new Error('No Bedrock credentials configured.');
        const { BedrockClient } = require('./BedrockClient');
        const models = await new BedrockClient(resolved).fetchModels();
        this.setBedrockFetchedModels(models);
        return models;
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

    // ── Groq Fetched Models (persisted discovery) ─────────────

    public getGroqFetchedModels(): { id: string; label: string }[] {
        return this.credentials.groqFetchedModels || [];
    }

    public setGroqFetchedModels(models: { id: string; label: string }[]): void {
        this.credentials.groqFetchedModels = models;
        this.saveCredentials();
    }

    public clearGroqFetchedModels(): void {
        delete this.credentials.groqFetchedModels;
        this.saveCredentials();
    }

    public getBedrockFetchedModels(): BedrockFetchedModel[] {
        return this.credentials.bedrockFetchedModels || [];
    }

    public setBedrockFetchedModels(models: BedrockFetchedModel[]): void {
        this.credentials.bedrockFetchedModels = models;
        this.saveCredentials();
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
            this.stripLegacyBackendCredentials();

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
                        const removedLegacyBackendCredentials = this.stripLegacyBackendCredentials();
                        console.log('[CredentialsManager] Loaded encrypted credentials');
                        if (removedLegacyBackendCredentials) {
                            this.saveCredentials();
                        }
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
                        const removedLegacyBackendCredentials = this.stripLegacyBackendCredentials();
                        console.log('[CredentialsManager] Loaded plaintext credentials');
                        if (removedLegacyBackendCredentials) {
                            this.saveCredentials();
                        }
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

    private stripLegacyBackendCredentials(): boolean {
        const legacyKeys = [
            'backendMongodbUri',
            'backendMongodbDbName',
            'backendGoogleClientId',
            'backendGoogleClientSecret',
            'backendJwtSecret',
            'backendRedirectUri',
        ];
        let removed = false;
        const credentials = this.credentials as Record<string, unknown>;

        for (const key of legacyKeys) {
            if (Object.prototype.hasOwnProperty.call(credentials, key)) {
                delete credentials[key];
                removed = true;
            }
        }

        if (removed) {
            console.log('[CredentialsManager] Removed legacy backend credentials from Electron storage');
        }

        return removed;
    }
}
