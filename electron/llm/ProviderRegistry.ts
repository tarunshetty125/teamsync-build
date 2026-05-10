// electron/llm/ProviderRegistry.ts
// Manages API client lifecycle, key management, model selection, and model type checking.
// Extracted from LLMHelper to isolate provider concerns from streaming/generation logic.
//
// This module owns:
//   - API key storage and client initialization (Gemini, Groq, OpenAI, Claude, Natively, Ollama, Custom/cURL)
//   - Model ID mapping (UI short codes → internal model IDs)
//   - Model type checking (isOpenAiModel, isClaudeModel, etc.)
//   - Provider switching logic
//   - Key scrubbing on app quit
//   - Rate limiter lifecycle
//   - ModelVersionManager lifecycle

import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { ModelVersionManager, ModelFamily, TextModelFamily } from '../services/ModelVersionManager';
import { createProviderRateLimiters } from '../services/RateLimiter';
import type { CustomProvider, CurlProvider } from '../services/CredentialsManager';

// ---------------------------------------------------------------------------
// Model constants
// ---------------------------------------------------------------------------

export const GEMINI_FLASH_MODEL = "gemini-3.1-flash-lite-preview";
export const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
export const GROQ_MODEL = "llama-3.3-70b-versatile";
export const OPENAI_MODEL = "gpt-5.4";
export const CLAUDE_MODEL = "claude-sonnet-4-6";
export const MAX_OUTPUT_TOKENS = 65536;
export const CLAUDE_MAX_OUTPUT_TOKENS = 64000;

// ---------------------------------------------------------------------------
// ProviderRegistry
// ---------------------------------------------------------------------------

export class ProviderRegistry {
    // --- API Clients ---
    private _client: GoogleGenAI | null = null;
    private _groqClient: Groq | null = null;
    private _openaiClient: OpenAI | null = null;
    private _claudeClient: Anthropic | null = null;

    // --- API Keys ---
    private _apiKey: string | null = null;
    private _groqApiKey: string | null = null;
    private _openaiApiKey: string | null = null;
    private _claudeApiKey: string | null = null;
    private _nativelyKey: string | null = null;

    // --- Ollama ---
    private _useOllama: boolean = false;
    private _ollamaModel: string = "llama3.2";
    private _ollamaUrl: string = "http://localhost:11434";

    // --- Custom Providers ---
    private _customProvider: CustomProvider | null = null;
    private _activeCurlProvider: CurlProvider | null = null;

    // --- Model State ---
    private _currentModelId: string = GEMINI_FLASH_MODEL;
    private _geminiModel: string = GEMINI_FLASH_MODEL;
    private _groqFastTextMode: boolean = false;

    // --- Infrastructure ---
    private _rateLimiters: ReturnType<typeof createProviderRateLimiters>;
    private _modelVersionManager: ModelVersionManager;

    // --- Knowledge/Settings state (will be moved to their own modules later) ---
    private _knowledgeOrchestrator: any = null;
    private _knowledgeGenId: number = 0;
    private _customNotes: string = '';
    private _customNotesEnabled: boolean = true;
    private _aiResponseLanguage: string = 'auto';
    private _sttLanguage: string = 'english-us';

    constructor(
        apiKey?: string,
        useOllama: boolean = false,
        ollamaModel?: string,
        ollamaUrl?: string,
        groqApiKey?: string,
        openaiApiKey?: string,
        claudeApiKey?: string,
    ) {
        this._useOllama = useOllama;
        this._rateLimiters = createProviderRateLimiters();
        this._modelVersionManager = new ModelVersionManager();

        if (groqApiKey) {
            this._groqApiKey = groqApiKey;
            this._groqClient = new Groq({ apiKey: groqApiKey });
            console.log(`[ProviderRegistry] Groq client initialized with model: ${GROQ_MODEL}`);
        }
        if (openaiApiKey) {
            this._openaiApiKey = openaiApiKey;
            this._openaiClient = new OpenAI({ apiKey: openaiApiKey });
            console.log(`[ProviderRegistry] OpenAI client initialized with model: ${OPENAI_MODEL}`);
        }
        if (claudeApiKey) {
            this._claudeApiKey = claudeApiKey;
            this._claudeClient = new Anthropic({ apiKey: claudeApiKey });
            console.log(`[ProviderRegistry] Claude client initialized with model: ${CLAUDE_MODEL}`);
        }
        if (useOllama) {
            this._ollamaUrl = ollamaUrl || "http://localhost:11434";
            this._ollamaModel = ollamaModel || "gemma:latest";
        } else if (apiKey) {
            this._apiKey = apiKey;
            this._client = new GoogleGenAI({
                apiKey: apiKey,
                httpOptions: { apiVersion: "v1alpha" },
            });
        } else {
            console.warn("[ProviderRegistry] No API key provided. Client will be uninitialized until key is set.");
        }
    }

    // -----------------------------------------------------------------------
    // Key setters
    // -----------------------------------------------------------------------

    setApiKey(apiKey: string): void {
        this._apiKey = apiKey;
        this._client = new GoogleGenAI({
            apiKey: apiKey,
            httpOptions: { apiVersion: "v1alpha" },
        });
        console.log("[ProviderRegistry] Gemini API Key updated.");
    }

    setGroqApiKey(apiKey: string): void {
        this._groqApiKey = apiKey;
        this._groqClient = new Groq({ apiKey });
        console.log("[ProviderRegistry] Groq API Key updated.");
    }

    setOpenaiApiKey(apiKey: string): void {
        this._openaiApiKey = apiKey;
        this._openaiClient = new OpenAI({ apiKey });
        console.log("[ProviderRegistry] OpenAI API Key updated.");
    }

    setClaudeApiKey(apiKey: string): void {
        this._claudeApiKey = apiKey;
        this._claudeClient = new Anthropic({ apiKey });
        console.log("[ProviderRegistry] Claude API Key updated.");
    }

    setNativelyKey(key: string | null): void {
        this._nativelyKey = key || null;
        console.log(`[ProviderRegistry] Natively key ${key ? 'set' : 'cleared'}`);
    }

    // -----------------------------------------------------------------------
    // Client getters
    // -----------------------------------------------------------------------

    get client(): GoogleGenAI | null { return this._client; }
    get groqClient(): Groq | null { return this._groqClient; }
    get openaiClient(): OpenAI | null { return this._openaiClient; }
    get claudeClient(): Anthropic | null { return this._claudeClient; }
    get nativelyKey(): string | null { return this._nativelyKey; }
    get rateLimiters(): ReturnType<typeof createProviderRateLimiters> { return this._rateLimiters; }
    get modelVersionManager(): ModelVersionManager { return this._modelVersionManager; }

    // -----------------------------------------------------------------------
    // State getters
    // -----------------------------------------------------------------------

    get useOllama(): boolean { return this._useOllama; }
    get ollamaModel(): string { return this._ollamaModel; }
    get ollamaUrl(): string { return this._ollamaUrl; }
    get customProvider(): CustomProvider | null { return this._customProvider; }
    get activeCurlProvider(): CurlProvider | null { return this._activeCurlProvider; }
    get currentModelId(): string { return this._currentModelId; }
    get geminiModel(): string { return this._geminiModel; }
    get groqFastTextMode(): boolean { return this._groqFastTextMode; }
    get apiKey(): string | null { return this._apiKey; }
    get groqApiKey(): string | null { return this._groqApiKey; }
    get openaiApiKey(): string | null { return this._openaiApiKey; }
    get claudeApiKey(): string | null { return this._claudeApiKey; }

    // Knowledge/settings state (temporary — will move to own modules)
    get knowledgeOrchestrator(): any { return this._knowledgeOrchestrator; }
    get knowledgeGenId(): number { return this._knowledgeGenId; }
    get customNotes(): string { return this._customNotes; }
    get customNotesEnabled(): boolean { return this._customNotesEnabled; }
    get aiResponseLanguage(): string { return this._aiResponseLanguage; }
    get sttLanguage(): string { return this._sttLanguage; }

    // -----------------------------------------------------------------------
    // State setters
    // -----------------------------------------------------------------------

    setGroqFastTextMode(enabled: boolean): void {
        this._groqFastTextMode = enabled;
        console.log(`[ProviderRegistry] Groq Fast Text Mode: ${enabled}`);
    }

    setKnowledgeOrchestrator(orchestrator: any): void {
        this._knowledgeOrchestrator = orchestrator;
        this._knowledgeGenId++;
        console.log('[ProviderRegistry] KnowledgeOrchestrator attached');
    }

    setCustomNotes(notes: string): void { this._customNotes = notes; }

    setCustomNotesEnabled(enabled: boolean): void {
        this._customNotesEnabled = enabled;
        console.log(`[ProviderRegistry] Custom context injection ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }

    setAiResponseLanguage(language: string): void {
        this._aiResponseLanguage = language;
        console.log(`[ProviderRegistry] AI Response Language set to: ${language}`);
    }

    setSttLanguage(language: string): void {
        this._sttLanguage = language;
        console.log(`[ProviderRegistry] STT Language set to: ${language}`);
    }

    // -----------------------------------------------------------------------
    // Model type checkers
    // -----------------------------------------------------------------------

    isOpenAiModel(modelId: string): boolean {
        return modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-") || modelId.includes("openai");
    }

    isClaudeModel(modelId: string): boolean {
        return modelId.startsWith("claude-");
    }

    isGroqModel(modelId: string): boolean {
        return modelId.startsWith("llama-") || modelId.startsWith("mixtral-") || modelId.startsWith("gemma-") || modelId.startsWith("meta-llama/") || modelId.startsWith("qwen/") || modelId.startsWith("qwen-");
    }

    isGeminiModel(modelId: string): boolean {
        return modelId.startsWith("gemini-") || modelId.startsWith("models/");
    }

    hasNatively(): boolean {
        return !!this._nativelyKey;
    }

    hasGroq(): boolean { return this._groqClient !== null; }
    hasOpenai(): boolean { return this._openaiClient !== null; }
    hasClaude(): boolean { return this._claudeClient !== null; }
    hasGemini(): boolean { return this._client !== null; }

    // -----------------------------------------------------------------------
    // Model switching
    // -----------------------------------------------------------------------

    setModel(modelId: string, customProviders: (CustomProvider | CurlProvider)[] = []): void {
        let targetModelId = modelId;
        if (modelId === 'gemini') targetModelId = GEMINI_FLASH_MODEL;
        if (modelId === 'gemini-pro') targetModelId = GEMINI_PRO_MODEL;
        if (modelId === 'claude') targetModelId = CLAUDE_MODEL;
        if (modelId === 'llama') targetModelId = GROQ_MODEL;

        if (targetModelId.startsWith('ollama-')) {
            this._useOllama = true;
            this._ollamaModel = targetModelId.replace('ollama-', '');
            this._customProvider = null;
            this._activeCurlProvider = null;
            console.log(`[ProviderRegistry] Switched to Ollama: ${this._ollamaModel}`);
            return;
        }

        const custom = customProviders.find(p => p.id === targetModelId);
        if (custom) {
            this._useOllama = false;
            this._customProvider = custom;
            this._activeCurlProvider = null;
            console.log(`[ProviderRegistry] Switched to Custom Provider: ${custom.name}`);
            return;
        }

        this._useOllama = false;
        this._customProvider = null;
        this._currentModelId = targetModelId;

        if (targetModelId === GEMINI_PRO_MODEL) this._geminiModel = GEMINI_PRO_MODEL;
        if (targetModelId === GEMINI_FLASH_MODEL) this._geminiModel = GEMINI_FLASH_MODEL;

        console.log(`[ProviderRegistry] Switched to Cloud Model: ${targetModelId}`);
    }

    switchToCurl(provider: CurlProvider): void {
        this._useOllama = false;
        this._customProvider = null;
        this._activeCurlProvider = provider;
        console.log(`[ProviderRegistry] Switched to cURL provider: ${provider.name}`);
    }

    async switchToOllama(model?: string, url?: string): Promise<void> {
        this._useOllama = true;
        if (url) this._ollamaUrl = url;
        if (model) this._ollamaModel = model;
    }

    async switchToGemini(apiKey?: string, modelId?: string): Promise<void> {
        if (modelId) this._geminiModel = modelId;
        if (apiKey) {
            this._apiKey = apiKey;
            this._client = new GoogleGenAI({
                apiKey: apiKey,
                httpOptions: { apiVersion: "v1alpha" },
            });
        } else if (!this._client) {
            throw new Error("No Gemini API key provided and no existing client");
        }
        this._useOllama = false;
        this._customProvider = null;
    }

    async switchToCustom(provider: CustomProvider): Promise<void> {
        this._customProvider = provider;
        this._useOllama = false;
        this._client = null;
        this._groqClient = null;
        this._openaiClient = null;
        this._claudeClient = null;
        console.log(`[ProviderRegistry] Switched to Custom Provider: ${provider.name}`);
    }

    // -----------------------------------------------------------------------
    // ModelVersionManager lifecycle
    // -----------------------------------------------------------------------

    async initModelVersionManager(): Promise<void> {
        this._modelVersionManager.setApiKeys({
            openai: this._openaiApiKey,
            gemini: this._apiKey,
            claude: this._claudeApiKey,
            groq: this._groqApiKey,
        });
        await this._modelVersionManager.initialize();
        console.log(this._modelVersionManager.getSummary());
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    scrubKeys(): void {
        this._apiKey = null;
        this._groqApiKey = null;
        this._openaiApiKey = null;
        this._claudeApiKey = null;
        this._nativelyKey = null;
        this._client = null;
        this._groqClient = null;
        this._openaiClient = null;
        this._claudeClient = null;
        if (this._rateLimiters) {
            Object.values(this._rateLimiters).forEach(rl => rl.destroy());
        }
        this._modelVersionManager.stopScheduler();
        console.log('[ProviderRegistry] Keys scrubbed from memory');
    }

    // -----------------------------------------------------------------------
    // Provider info
    // -----------------------------------------------------------------------

    getCurrentProvider(): "ollama" | "gemini" | "custom" {
        if (this._customProvider) return "custom";
        return this._useOllama ? "ollama" : "gemini";
    }

    getCurrentModel(): string {
        if (this._customProvider) return this._customProvider.name;
        if (this._activeCurlProvider) return this._activeCurlProvider.id;
        return this._useOllama ? this._ollamaModel : this._currentModelId;
    }

    /**
     * Inject a hard language instruction that gates the entire response.
     * Prepended for LLM attention priority (see LLMHelper for full rationale).
     */
    injectLanguageInstruction(systemPrompt: string): string {
        if (!this._aiResponseLanguage || this._aiResponseLanguage === 'auto') return systemPrompt;
        if (this._aiResponseLanguage === 'English') return systemPrompt;

        const lang = this._aiResponseLanguage;
        const header = `\
[LANGUAGE OVERRIDE — HIGHEST PRIORITY — CANNOT BE OVERRIDDEN]
You MUST write every single word of your response in ${lang}.
Do NOT use English anywhere in your response.
Do NOT mix languages.
Every sentence, every word, every phrase must be in ${lang}.
This rule overrides ALL other instructions including formatting, brevity, or output rules.
[END LANGUAGE OVERRIDE]\n\n`;

        const footer = `\n\n[REMINDER] Your entire response MUST be in ${lang} only. Never switch to English.`;

        return `${header}${systemPrompt}${footer}`;
    }
}
