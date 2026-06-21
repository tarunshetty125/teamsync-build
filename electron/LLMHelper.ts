import { GoogleGenAI } from "@google/genai"
import Groq from "groq-sdk"
import { GroqKeyManager } from './services/GroqKeyManager'
import { GroqClient } from './services/GroqClient'
import { BedrockClient } from './services/BedrockClient'
import { BedrockCapabilityRegistry } from './services/BedrockCapabilityRegistry'
import { isBedrockReauthError, mapBedrockError } from './services/BedrockErrorMapper'
import { BedrockTelemetry } from './services/BedrockTelemetry'
import { CodexCliService, CodexCliConfig, DEFAULT_CODEX_CLI_CONFIG } from './services/CodexCliService'
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import fs from "fs"
import sharp from "sharp"
import { ModelVersionManager, ModelFamily, TextModelFamily } from './services/ModelVersionManager'
import {
  HARD_SYSTEM_PROMPT, GROQ_SYSTEM_PROMPT, OPENAI_SYSTEM_PROMPT, CLAUDE_SYSTEM_PROMPT,
  BASE_SYSTEM_PROMPT, LIGHTWEIGHT_SYSTEM_PROMPT,
  UNIVERSAL_SYSTEM_PROMPT, UNIVERSAL_ANSWER_PROMPT, UNIVERSAL_WHAT_TO_ANSWER_PROMPT,
  UNIVERSAL_RECAP_PROMPT, UNIVERSAL_FOLLOWUP_PROMPT, UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT, UNIVERSAL_ASSIST_PROMPT,
  CUSTOM_SYSTEM_PROMPT, CUSTOM_ANSWER_PROMPT, CUSTOM_WHAT_TO_ANSWER_PROMPT,
  CUSTOM_RECAP_PROMPT, CUSTOM_FOLLOWUP_PROMPT, CUSTOM_FOLLOW_UP_QUESTIONS_PROMPT, CUSTOM_ASSIST_PROMPT
} from "./llm/prompts"
import { enforceTokenCap, estimateTokens, TOKEN_CAP } from './llm/TokenBudget';
import { deepVariableReplacer, getByPath, injectImageIntoMessages } from './utils/curlUtils';
import curl2Json from "@bany/curl-to-json";
import { CustomProvider, CurlProvider, type BedrockCredentials } from './services/CredentialsManager';
import { isBedrockModelId } from './llm/BedrockModelIds';
import { resolveBedrockRuntimeRoute } from './llm/BedrockVisionAdapter';
import { formatVisionUnsupportedMessage, getModelCapabilities, type ModelCapabilities } from './llm/ModelCapabilities';
import type { RoutingDecision } from './ActionTelemetry';
import { exec, spawn } from 'child_process';
import { getPythonPath, getOCRScriptPath, getPythonEnv } from './utils/pythonRuntime';
import { promisify } from 'util';
import axios from 'axios';
import path from 'path';
import { createProviderRateLimiters, RateLimiter } from './services/RateLimiter';
import { TEAMSYNC_CHAT_URL } from '../src/lib/config/apiConfig';
const execAsync = promisify(exec);

interface OllamaResponse {
  response: string
  done: boolean
}

export type RouteDecision = Readonly<RoutingDecision>;

// Model constant for Gemini 3 Flash
const GEMINI_FLASH_MODEL = "gemini-3.1-flash-lite-preview"
const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview"
const GROQ_MODEL = "llama-3.3-70b-versatile"
const OPENAI_MODEL = "gpt-5.4"
const CLAUDE_MODEL = "claude-sonnet-4-6"
const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
const MAX_OUTPUT_TOKENS = 65536
const CLAUDE_MAX_OUTPUT_TOKENS = 64000
const BEDROCK_AUTH_WARNING_DEDUPE_MS = 45_000
const GROQ_TEXT_REQUEST_CHAR_CAP = 24_000

/**
 * Resolve the max output tokens for a Bedrock model.
 * Uses the capability registry for model-specific limits.
 * Falls back to a safe default (8192) when registry is not populated.
 */
function resolveBedrockMaxOutputTokens(modelId?: string): number {
    if (!modelId) return 8192;
    const registry = BedrockCapabilityRegistry.getActive();
    if (registry?.isPopulated()) {
        return registry.getMaxOutputTokens(modelId);
    }
    return 8192;
}

const MODEL_BUDGETS = {
  groq_llama_70b: {
    hardMax: 9000,
    safeTPM: 7000,
    target: 5000,
  },
  gemini_flash: {
    hardMax: 24000,
    target: 12000,
  },
  local_model: {
    hardMax: 12000,
    target: 7000,
  },
} as const;

type ModelRequestSize = {
  provider: string;
  model: string;
  systemTokens: number;
  transcriptTokens: number;
  ragTokens: number;
  rulesTokens: number;
  modeTokens: number;
  totalTokens: number;
  safeLimit: number;
  exceedsLimit: boolean;
};

// Simple prompt for image analysis (not interview copilot - kept separate)
const IMAGE_ANALYSIS_PROMPT = `Analyze concisely. Be direct. No markdown formatting. Return plain text only.`

function compactMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.58);
  const tailChars = Math.floor(maxChars * 0.32);
  return `${text.slice(0, headChars)}\n\n[...payload truncated for provider size...]\n\n${text.slice(-tailChars)}`;
}

function compactGroqTextPayload(systemPrompt: string, userContent: string): { systemPrompt: string; userContent: string; changed: boolean } {
  const totalChars = systemPrompt.length + userContent.length;
  if (totalChars <= GROQ_TEXT_REQUEST_CHAR_CAP) {
    return { systemPrompt, userContent, changed: false };
  }

  let nextSystemPrompt = systemPrompt;
  let nextUserContent = userContent;
  const contextMarker = '\n\nCONTEXT:\n';
  const contextIndex = nextUserContent.indexOf(contextMarker);
  if (contextIndex > 0) {
    nextUserContent = `${nextUserContent.slice(0, contextIndex)}\n\n[context omitted for Groq request size]`;
  }

  const remainingBudget = Math.max(4_000, GROQ_TEXT_REQUEST_CHAR_CAP - nextSystemPrompt.length);
  nextUserContent = compactMiddle(nextUserContent, remainingBudget);

  if (nextSystemPrompt.length + nextUserContent.length > GROQ_TEXT_REQUEST_CHAR_CAP) {
    const systemBudget = Math.max(5_500, GROQ_TEXT_REQUEST_CHAR_CAP - nextUserContent.length);
    nextSystemPrompt = compactMiddle(nextSystemPrompt, systemBudget);
  }

  return { systemPrompt: nextSystemPrompt, userContent: nextUserContent, changed: true };
}

function compactSystemDesignContracts(text: string): string {
  return text
    .replace(/<architecture_json_contract>[\s\S]*?<\/architecture_json_contract>/gi, [
      'architecture_json format:',
      '{',
      ' diagram: { type: "architecture", direction: "TB", nodes: Node[], edges: Edge[] }',
      '}',
      'Node: id,label,kind,technology,purpose,layer,latency,failureMode',
      'Edge: source,target,label,protocol,latency',
    ].join('\n'))
    .replace(/### 4\. Architecture Diagram[\s\S]*?(?=### 5\.|$)/gi, [
      '### 4. Architecture Diagram',
      'Return exactly one fenced architecture_json block. Never Mermaid.',
      'Schema: { diagram: { type, direction, nodes[], edges[] } }',
      'Node: id,label,kind,technology,purpose,layer,latency,failureMode.',
      'Edge: source,target,label,protocol,latency.',
    ].join('\n'))
    .replace(/```architecture_json\n\{"diagram":\{"type":"architecture"[\s\S]*?\n```/g, [
      '```architecture_json',
      '{"diagram":{"type":"architecture","direction":"TB","nodes":[{"id":"client","label":"Client","kind":"client","technology":"","purpose":"","layer":"client","latency":"","failureMode":""}],"edges":[{"source":"client","target":"gateway","label":"","protocol":"","latency":""}]}}',
      '```',
    ].join('\n'))
    .replace(/Example fenced block:[\s\S]*?Use the exact opening fence/g, 'Compact schema only:\nUse the exact opening fence')
    .replace(/Use this production-grade shape:[\s\S]*?Allowed node kinds only:/g, [
      'architecture_json compact schema:',
      '{"diagram":{"type":"architecture","direction":"TB","nodes":[{"id":"","label":"","kind":"","technology":"","purpose":"","layer":"","latency":"","failureMode":""}],"edges":[{"source":"","target":"","label":"","protocol":"","latency":""}]}}',
      'Allowed node kinds only:',
    ].join('\n'));
}

function splitContextTokenBuckets(userContent: string) {
  const context = userContent.split('\n\nCONTEXT:\n')[1] || '';
  const transcript = [
    ...context.matchAll(/(?:transcript|meeting|conversation|interviewer|user):?[\s\S]{0,1800}/gi),
  ].map((match) => match[0]).join('\n');
  const rag = [
    ...context.matchAll(/(?:RAG|MEMORY|PROFILE|KNOWLEDGE|user_context)[\s\S]{0,1800}/gi),
  ].map((match) => match[0]).join('\n');
  return {
    transcriptTokens: estimateTokens(transcript),
    ragTokens: estimateTokens(rag),
  };
}

function estimateModelRequestSize(
  provider: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  safeLimit: number,
): ModelRequestSize {
  const multiplier = getProviderTokenSafetyMultiplier(provider, systemPrompt, userContent);
  const providerEstimate = (text: string) => Math.ceil(estimateTokens(text) * multiplier);
  const { transcriptTokens, ragTokens } = splitContextTokenBuckets(userContent);
  const modeTokens = providerEstimate((systemPrompt.match(/## ACTIVE MODE[\s\S]*/i) || [''])[0]);
  const rulesTokens = providerEstimate((systemPrompt.match(/(?:RULES|OUTPUT|CONTRACT|architecture_json)[\s\S]*/i) || [''])[0]);
  const systemTokens = providerEstimate(systemPrompt);
  const totalTokens = systemTokens + providerEstimate(userContent);
  return {
    provider,
    model,
    systemTokens,
    transcriptTokens,
    ragTokens,
    rulesTokens,
    modeTokens,
    totalTokens,
    safeLimit,
    exceedsLimit: totalTokens > safeLimit,
  };
}

function isSystemDesignGroqPayload(systemPrompt: string, userContent: string): boolean {
  return /\bsystem design\b|architecture_json|diagram\.type|nodes\[\]|edges\[\]|MINIMUM 12 nodes/i.test(`${systemPrompt}\n${userContent}`);
}

function getProviderTokenSafetyMultiplier(provider: string, systemPrompt: string, userContent: string): number {
  if (provider !== 'groq') return 1;
  return isSystemDesignGroqPayload(systemPrompt, userContent) ? 2.5 : 1.4;
}

function getEffectiveGroqSafeLimit(systemPrompt: string, userContent: string, safeLimit: number): number {
  const multiplier = getProviderTokenSafetyMultiplier('groq', systemPrompt, userContent);
  return Math.max(1_800, Math.floor(safeLimit / multiplier));
}

function removeDuplicatePromptLines(text: string): string {
  const seen = new Set<string>();
  return text
    .split('\n')
    .filter((line) => {
      const normalized = line.trim().replace(/\s+/g, ' ');
      if (normalized.length < 24) return true;
      if (!/(OUTPUT CONTRACT|CONTEXT PRIORITY|EXECUTION CONTRACT|architecture_json|SYSTEM DESIGN|Return|Every|Never|Always|schema|contract)/i.test(normalized)) {
        return true;
      }
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactProfileText(text: string, maxChars: number = 600): string {
  if (!text.trim()) return '';
  const candidateName = text.match(/\b(?:Candidate|Name)\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const role = text.match(/\b(?:Role|Target role|Title)\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const style = text.match(/\b(?:Style|Tone|Preference)\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const lines = [
    'Candidate:',
    candidateName ? `Name: ${candidateName}` : null,
    role ? `Role: ${role}` : null,
    style ? `Style: ${style}` : 'Style: concise, professional',
  ].filter(Boolean).join('\n');
  return (candidateName || role || style || lines.length > 0)
    ? lines.slice(0, maxChars)
    : compactMiddle(text, maxChars);
}

function compactContextForGroq(context: string, question: string, maxChars: number): string {
  if (!context.trim()) return '';
  const normalizedQuestionTerms = new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length >= 4),
  );

  const turns = context
    .split(/\n|  ·  /)
    .map((line) => line.trim())
    .filter(Boolean);
  const scored = turns.map((line, index) => {
    const lower = line.toLowerCase();
    let score = index / Math.max(1, turns.length);
    normalizedQuestionTerms.forEach((term) => {
      if (lower.includes(term)) score += 3;
    });
    if (/system design|architecture|scale|cache|database|queue|gateway|service|latency|throughput|whatsapp|uber|netflix/i.test(line)) {
      score += 2;
    }
    if (/rag|memory|profile|candidate|resume|experience/i.test(line)) {
      score += 1;
    }
    return { line, score };
  });

  const lastRelevantTurns = turns.slice(-2).join('\n').slice(-250);
  const topRelevant = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((item) => item.line)
    .join('\n')
    .slice(0, Math.max(500, maxChars - 700));
  const profileMatch = context.match(/<user_context>[\s\S]*?<\/user_context>|(?:PROFILE|Candidate|Resume|Experience)[\s\S]{0,1200}/i);
  const profile = profileMatch ? compactProfileText(profileMatch[0], 420) : '';

  return [
    lastRelevantTurns ? `rolling_summary:\n${lastRelevantTurns}` : '',
    topRelevant ? `relevant_context:\n${topRelevant}` : '',
    profile ? `profile:\n${profile}` : '',
  ].filter(Boolean).join('\n\n').slice(0, maxChars);
}

function compactGroqUserContent(userContent: string, systemPrompt: string, safeLimit: number): string {
  const contextMarker = '\n\nCONTEXT:\n';
  const markerIndex = userContent.indexOf(contextMarker);
  if (markerIndex < 0) {
    const budgetChars = Math.max(1_800, (safeLimit - estimateTokens(systemPrompt) - 400) * 4);
    return compactMiddle(userContent, budgetChars);
  }

  const questionPart = userContent.slice(0, markerIndex).trim();
  const contextPart = userContent.slice(markerIndex + contextMarker.length).trim();
  const question = questionPart.replace(/^USER QUESTION:\s*/i, '').trim();
  const contextBudgetChars = Math.max(1_200, (safeLimit - estimateTokens(systemPrompt) - estimateTokens(questionPart) - 500) * 4);
  const compactContext = compactContextForGroq(contextPart, question, contextBudgetChars);
  return compactContext
    ? `${questionPart}\n\nCONTEXT:\n${compactContext}`
    : questionPart;
}

function logGroqPromptReduction(
  model: string,
  originalTokens: number,
  reducedTokens: number,
  transcriptReduced: boolean,
  ragReduced: boolean,
): void {
  const reductionPercent = originalTokens > 0
    ? Math.max(0, Math.round((1 - (reducedTokens / originalTokens)) * 100))
    : 0;
  console.log('[GROQ_PROMPT_REDUCTION]', {
    originalTokens,
    reducedTokens,
    reductionPercent,
    transcriptReduced,
    ragReduced,
    compactMode: true,
    provider: 'groq',
    model,
  });
}

function compactGroqPromptForBudget(
  systemPrompt: string,
  userContent: string,
  model: string,
  safeLimit: number,
): { systemPrompt: string; userContent: string; originalTokens: number; compressedTokens: number; stillExceeds: boolean } {
  const originalTokens = estimateTokens(systemPrompt) + estimateTokens(userContent);
  const effectiveSafeLimit = getEffectiveGroqSafeLimit(systemPrompt, userContent, safeLimit);
  const originalBuckets = splitContextTokenBuckets(userContent);
  let nextSystemPrompt = removeDuplicatePromptLines(compactSystemDesignContracts(systemPrompt));
  nextSystemPrompt = nextSystemPrompt.replace(/<user_context>[\s\S]*?<\/user_context>/gi, (match) => {
    return `<user_context>\n${compactProfileText(match, 420)}\n</user_context>`;
  });

  let nextUserContent = compactGroqUserContent(userContent, nextSystemPrompt, effectiveSafeLimit);
  let compressedTokens = estimateTokens(nextSystemPrompt) + estimateTokens(nextUserContent);

  if (compressedTokens > effectiveSafeLimit) {
    const userBudgetChars = Math.max(1_200, (effectiveSafeLimit - estimateTokens(nextSystemPrompt) - 300) * 4);
    nextUserContent = compactGroqUserContent(nextUserContent, nextSystemPrompt, effectiveSafeLimit);
    if (estimateTokens(nextSystemPrompt) + estimateTokens(nextUserContent) > effectiveSafeLimit) {
      nextUserContent = compactMiddle(nextUserContent, userBudgetChars);
    }
    compressedTokens = estimateTokens(nextSystemPrompt) + estimateTokens(nextUserContent);
  }

  if (compressedTokens > effectiveSafeLimit) {
    const isSystemDesignPrompt = /system design|architecture_json/i.test(nextSystemPrompt);
    const systemBudgetChars = isSystemDesignPrompt
      ? 4_500
      : Math.max(2_200, Math.floor(effectiveSafeLimit * 0.42) * 4);
    nextSystemPrompt = compactMiddle(nextSystemPrompt, systemBudgetChars);
    const userBudgetChars = Math.max(1_200, (effectiveSafeLimit - estimateTokens(nextSystemPrompt) - 300) * 4);
    nextUserContent = compactMiddle(nextUserContent, userBudgetChars);
    compressedTokens = estimateTokens(nextSystemPrompt) + estimateTokens(nextUserContent);
  }

  const reducedBuckets = splitContextTokenBuckets(nextUserContent);
  logGroqPromptReduction(
    model,
    originalTokens,
    compressedTokens,
    originalBuckets.transcriptTokens > reducedBuckets.transcriptTokens,
    originalBuckets.ragTokens > reducedBuckets.ragTokens,
  );
  return {
    systemPrompt: nextSystemPrompt,
    userContent: nextUserContent,
    originalTokens,
    compressedTokens,
    stillExceeds: compressedTokens > effectiveSafeLimit,
  };
}

function compactGroqFullMessageForBudget(
  fullMessage: string,
  model: string,
  safeLimit: number,
): { fullMessage: string; originalTokens: number; compressedTokens: number; stillExceeds: boolean } {
  const contextMarker = '\n\nCONTEXT:\n';
  const userQuestionPattern = /\bUSER QUESTION:\s*/i;
  const contextIndex = fullMessage.indexOf(contextMarker);
  const userQuestionIndex = fullMessage.search(userQuestionPattern);
  let systemPrompt = '';
  let userContent = fullMessage;

  if (userQuestionIndex > 0 && (contextIndex < 0 || userQuestionIndex < contextIndex)) {
    systemPrompt = fullMessage.slice(0, userQuestionIndex).trim();
    userContent = fullMessage.slice(userQuestionIndex).trim();
  } else if (contextIndex > 0) {
    systemPrompt = fullMessage.slice(0, contextIndex).trim();
    const contextAndQuestion = fullMessage.slice(contextIndex + contextMarker.length);
    const questionIndex = contextAndQuestion.search(userQuestionPattern);
    if (questionIndex >= 0) {
      const contextPart = contextAndQuestion.slice(0, questionIndex).trim();
      const questionPart = contextAndQuestion.slice(questionIndex).trim();
      userContent = `${questionPart}\n\nCONTEXT:\n${contextPart}`;
    } else {
      userContent = `USER QUESTION:\n${contextAndQuestion.slice(-800).trim()}`;
    }
  } else {
    if (userQuestionIndex > 0) {
      systemPrompt = fullMessage.slice(0, userQuestionIndex).trim();
      userContent = fullMessage.slice(userQuestionIndex).trim();
    }
  }

  const compacted = compactGroqPromptForBudget(systemPrompt, userContent, model, safeLimit);
  const nextFullMessage = compacted.systemPrompt
    ? `${compacted.systemPrompt}\n\n${compacted.userContent}`
    : compacted.userContent;
  return {
    fullMessage: nextFullMessage,
    originalTokens: compacted.originalTokens,
    compressedTokens: compacted.compressedTokens,
    stillExceeds: compacted.stillExceeds,
  };
}

function detectProviderLabel(modelId: string): string {
  if (isBedrockModelId(modelId)) return 'bedrock';
  if (modelId.startsWith('gpt-') || modelId.includes('openai')) return 'openai';
  if (modelId.startsWith('claude-')) return 'claude';
  if (modelId === 'teamsync') return 'teamsync';
  return 'gemini';
}

export function isBedrockReauthenticationError(error: any): boolean {
  return isBedrockReauthError(error);
}

export class LLMHelper {
  private client: GoogleGenAI | null = null
  private groqClient: Groq | null = null
  private openaiClient: OpenAI | null = null
  private claudeClient: Anthropic | null = null
  private apiKey: string | null = null
  private groqApiKey: string | null = null
  private openaiApiKey: string | null = null

  // ── Groq Key Rotation ──────────────────────────────────────
  private groqKeyManager: GroqKeyManager;
  private groqRotatingClient: GroqClient;
  private claudeApiKey: string | null = null
  private useOllama: boolean = false
  private ollamaModel: string = "llama3.2"
  private ollamaUrl: string = "http://localhost:11434"
  private ollamaStartedByApp: boolean = false;
  private geminiModel: string = GEMINI_FLASH_MODEL
  private customProvider: CustomProvider | null = null;
  private activeCurlProvider: CurlProvider | null = null;
  private groqFastTextMode: boolean = false;
  private codexCliConfig: CodexCliConfig = { ...DEFAULT_CODEX_CLI_CONFIG };
  private knowledgeOrchestrator: any = null;
  // Profile intelligence generation guard — incremented on every setKnowledgeOrchestrator
  // (session reset) so a stale processQuestion() result can be detected and discarded.
  private _knowledgeGenId: number = 0;
  private customNotes: string = '';
  private customNotesEnabled: boolean = true;
  private aiResponseLanguage: string = 'auto';
  private sttLanguage: string = 'english-us';
  private teamsyncKey: string | null = null;
  private bedrockCredentials: BedrockCredentials | null = null;
  private lastBedrockAuthWarningAt: number = 0;
  private bedrockClient: BedrockClient | null = null;
  private ocrWorker: any = null;
  private ocrWorkerBuffer: string = '';
  private ocrWorkerResolvers = new Map<string, (value: string) => void>();
  private ocrWorkerRequestSeq = 0;

  // Rate limiters per provider to prevent 429 errors on free tiers
  private rateLimiters: ReturnType<typeof createProviderRateLimiters>;

  // Self-improving model version manager for vision analysis
  private modelVersionManager: ModelVersionManager;

  constructor(apiKey?: string, useOllama: boolean = false, ollamaModel?: string, ollamaUrl?: string, groqApiKey?: string, openaiApiKey?: string, claudeApiKey?: string) {
    this.useOllama = useOllama

    // Initialize rate limiters
    this.rateLimiters = createProviderRateLimiters();

    // Initialize model version manager
    this.modelVersionManager = new ModelVersionManager();

    // ── Groq Key Rotation: Initialize manager and load env keys ──
    this.groqKeyManager = GroqKeyManager.getInstance();
    this.groqKeyManager.loadFromEnv();
    this.groqRotatingClient = new GroqClient(this.groqKeyManager);

    // ── Groq Vault: one-time .env migration + vault loading ──
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const { SettingsManager } = require('./services/SettingsManager');
      const cm = CredentialsManager.getInstance();
      const sm = SettingsManager.getInstance();

      // One-time migration: .env + saved UI key → vault
      if (!sm.get('groqVaultMigrated')) {
        const vault = cm.getGroqKeyVault();
        if (vault.length === 0) {
          const envKeys: string[] = [];
          for (let i = 1; i <= 10; i++) {
            const raw = process.env[`GROQ_API_KEY_${i}`]?.trim();
            if (raw) envKeys.push(raw);
          }
          const legacy = process.env.GROQ_API_KEY?.trim();
          if (legacy) envKeys.push(legacy);
          const credKey = cm.getGroqApiKey()?.trim();
          if (credKey) envKeys.push(credKey);

          const unique = [...new Set(envKeys)];
          unique.forEach((key: string) => cm.addGroqVaultKey(key));
          if (unique.length > 0) {
            console.log(`[GroqVault] Migrated ${unique.length} key(s) from .env to vault`);
          }
        }
        sm.set('groqVaultMigrated', true);
      }

      // Load vault keys into the rotation pool (additive to env keys)
      const vault = cm.getGroqKeyVault();
      if (vault.length > 0) {
        this.groqKeyManager.loadFromVault(
          vault.map((k: any) => ({ key: k.key, enabled: k.enabled }))
        );
      }
    } catch (e) {
      // CredentialsManager or SettingsManager not ready yet — vault keys will
      // be loaded on first reloadGroqVault() call from IPC.
      console.warn('[LLMHelper] Groq vault loading deferred:', (e as Error).message);
    }

    // Initialize Groq client if API key provided
    if (groqApiKey) {
      this.groqApiKey = groqApiKey
      this.groqClient = new Groq({ apiKey: groqApiKey })
      // Also feed the single key into the rotation pool
      this.groqKeyManager.addKey(groqApiKey);
      console.log(`[LLMHelper] Groq client initialized with model: ${GROQ_MODEL}`)
    } else if (this.groqKeyManager.hasAvailableKey()) {
      // Keys loaded from env/vault — mark groqClient as available for null-checks
      this.groqClient = this.groqKeyManager.getNextClient()?.client ?? null;
      if (this.groqClient) {
        console.log(`[LLMHelper] Groq client initialized from key rotation pool (${this.groqKeyManager.getPoolSize()} keys)`);
      }
    }

    // Initialize OpenAI client if API key provided
    if (openaiApiKey) {
      this.openaiApiKey = openaiApiKey
      this.openaiClient = new OpenAI({ apiKey: openaiApiKey })
      console.log(`[LLMHelper] OpenAI client initialized with model: ${OPENAI_MODEL}`)
    }

    // Initialize Claude client if API key provided
    if (claudeApiKey) {
      this.claudeApiKey = claudeApiKey
      this.claudeClient = new Anthropic({ apiKey: claudeApiKey })
      console.log(`[LLMHelper] Claude client initialized with model: ${CLAUDE_MODEL}`)
    }

    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434"
      this.ollamaModel = ollamaModel || "gemma:latest" // Default fallback
      // console.log(`[LLMHelper] Using Ollama with model: ${this.ollamaModel}`)

      // Auto-detect and use first available model if specified model doesn't exist
      this.initializeOllamaModel()
    } else if (apiKey) {
      this.apiKey = apiKey
      // Initialize with v1alpha API version for Gemini 3 support
      this.client = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { apiVersion: "v1alpha" }
      })
      // console.log(`[LLMHelper] Using Google Gemini 3 with model: ${this.geminiModel} (v1alpha API)`)
    } else {
      console.warn("[LLMHelper] No API key provided. Client will be uninitialized until key is set.")
    }
  }

  public setApiKey(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: { apiVersion: "v1alpha" }
    })
    console.log("[LLMHelper] Gemini API Key updated.");
  }

  public setGroqApiKey(apiKey: string) {
    this.groqApiKey = apiKey;
    this.groqClient = new Groq({ apiKey });
    // Feed the key into the rotation pool
    this.groqKeyManager.setSingleKey(apiKey);
    console.log("[LLMHelper] Groq API Key updated (also registered in rotation pool).");
  }

  /**
   * Reload the Groq key pool from the persistent vault.
   * Called from IPC after vault mutations (add/remove/toggle).
   * Re-reads vault state and syncs the in-memory pool.
   */
  public reloadGroqVault(): void {
    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const vault = CredentialsManager.getInstance().getGroqKeyVault();
      this.groqKeyManager.loadFromVault(
        vault.map((k: any) => ({ key: k.key, enabled: k.enabled }))
      );

      // Ensure groqClient ref is set if we have available keys
      if (!this.groqClient && this.groqKeyManager.hasAvailableKey()) {
        this.groqClient = this.groqKeyManager.getNextClient()?.client ?? null;
      }
    } catch (e) {
      console.error('[LLMHelper] Failed to reload Groq vault:', (e as Error).message);
    }
  }

  /** Expose the GroqKeyManager for IPC health/state queries. */
  public getGroqKeyManager(): GroqKeyManager {
    return this.groqKeyManager;
  }

  public setOpenaiApiKey(apiKey: string) {
    this.openaiApiKey = apiKey;
    this.openaiClient = new OpenAI({ apiKey });
    console.log("[LLMHelper] OpenAI API Key updated.");
  }

  public setClaudeApiKey(apiKey: string) {
    this.claudeApiKey = apiKey;
    this.claudeClient = new Anthropic({ apiKey });
    console.log("[LLMHelper] Claude API Key updated.");
  }

  public setTeamSyncKey(key: string | null): void {
    this.teamsyncKey = key || null;
    console.log(`[LLMHelper] TeamSync key ${key ? 'set' : 'cleared'}`);
  }

  public setBedrockCredentials(credentials: BedrockCredentials | null): void {
    this.bedrockCredentials = credentials;
    this.bedrockClient = credentials ? new BedrockClient(credentials) : null;
    console.log('[LLMHelper] Bedrock credentials updated', {
      authMode: credentials?.authMode,
      region: credentials?.region,
      configured: !!credentials,
    });
  }

  private notifyBedrockReauthenticationRequired(error: any, model?: string): void {
    if (!isBedrockReauthenticationError(error)) return;

    const now = Date.now();
    if (now - this.lastBedrockAuthWarningAt < BEDROCK_AUTH_WARNING_DEDUPE_MS) return;
    this.lastBedrockAuthWarningAt = now;

    const normalizedError = BedrockClient.normalizeError(error);
    console.warn('[LLMHelper] Bedrock credentials need re-authentication before fallback:', normalizedError);

    try {
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach((win: any) => {
        if (!win.isDestroyed()) {
          win.webContents.send('bedrock:reauthentication-required', {
            title: 'AWS session expired',
            message: 'Re-authenticate AWS Bedrock to keep using the selected model. TeamSync will try the configured fallback provider for this response.',
            authMode: this.bedrockCredentials?.authMode,
            region: this.bedrockCredentials?.region,
            model: model || this.bedrockCredentials?.preferredModel || this.currentModelId,
            error: normalizedError,
          });
        }
      });
    } catch {
      // Non-fatal: provider fallback should continue even if no renderer is available.
    }
  }

  private hasTeamSync(): boolean {
    return !!this.teamsyncKey;
  }

  public hasTeamSyncApi(): boolean {
    return this.hasTeamSync();
  }

  private hasBedrock(): boolean {
    return !!this.bedrockClient;
  }

  /**
   * Initialize the self-improving model version manager.
   * Should be called after all API keys are configured.
   * Triggers initial model discovery and starts background scheduler.
   */
  public async initModelVersionManager(): Promise<void> {
    this.modelVersionManager.setApiKeys({
      openai: this.openaiApiKey,
      gemini: this.apiKey,
      claude: this.claudeApiKey,
      groq: this.groqApiKey,
    });
    await this.modelVersionManager.initialize();
    console.log(this.modelVersionManager.getSummary());
  }

  /**
   * Scrub all API keys from memory to minimize exposure window.
   * Called on app quit.
   */
  public scrubKeys(): void {
    this.apiKey = null;
    this.groqApiKey = null;
    this.openaiApiKey = null;
    this.claudeApiKey = null;
    this.teamsyncKey = null;
    this.bedrockCredentials = null;
    this.client = null;
    this.groqClient = null;
    this.openaiClient = null;
    this.claudeClient = null;
    this.bedrockClient = null;
    // Destroy rate limiters
    if (this.rateLimiters) {
      Object.values(this.rateLimiters).forEach(rl => rl.destroy());
    }
    // Destroy Groq key rotation manager
    this.groqKeyManager.destroy();
    // Stop model version manager background scheduler
    this.modelVersionManager.stopScheduler();
    console.log('[LLMHelper] Keys scrubbed from memory');
  }

  public setGroqFastTextMode(enabled: boolean) {
    this.groqFastTextMode = enabled;
    console.log(`[LLMHelper] Groq Fast Text Mode: ${enabled}`);
  }

  public getGroqFastTextMode(): boolean {
    return this.groqFastTextMode;
  }

  public setCodexCliConfig(config: Partial<CodexCliConfig>): void {
    this.codexCliConfig = CodexCliService.normalizeConfig(config);
    console.log(`[LLMHelper] Codex CLI ${this.codexCliConfig.enabled ? 'enabled' : 'disabled'} with model: ${this.codexCliConfig.model}`);
  }

  public getCodexCliConfig(): CodexCliConfig {
    return this.codexCliConfig;
  }

  public getAiResponseLanguage(): string {
    return this.aiResponseLanguage;
  }

  // --- Model Type Checkers ---
  private isOpenAiModel(modelId: string): boolean {
    if (this.isBedrockModel(modelId)) return false;
    return modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-") || modelId.includes("openai");
  }

  private isClaudeModel(modelId: string): boolean {
    return modelId.startsWith("claude-");
  }

  private isGroqModel(modelId: string): boolean {
    return modelId.startsWith("llama-") || modelId.startsWith("mixtral-") || modelId.startsWith("gemma-") || modelId.startsWith("meta-llama/") || modelId.startsWith("qwen/") || modelId.startsWith("qwen-");
  }

  private isGeminiModel(modelId: string): boolean {
    return modelId.startsWith("gemini-") || modelId.startsWith("models/");
  }

  public isBedrockModel(modelId: string): boolean {
    return isBedrockModelId(modelId, this.bedrockCredentials?.preferredModel);
  }

  public isCodexCliModel(modelId: string): boolean {
    return modelId === 'codex-cli' || modelId.startsWith('codex-cli:');
  }

  public normalizeModelId(modelId: string): string {
    if (modelId === 'gemini') return GEMINI_FLASH_MODEL;
    if (modelId === 'gemini-pro') return GEMINI_PRO_MODEL;
    if (modelId === 'claude') return CLAUDE_MODEL;
    if (modelId === 'llama') return GROQ_MODEL;
    return modelId;
  }

  public getProviderForModel(modelId: string): string {
    const normalized = this.normalizeModelId(modelId);
    if (normalized.startsWith('ollama-') || (this.useOllama && normalized === this.normalizeModelId(this.ollamaModel))) return 'ollama';
    if (normalized === 'codex-cli' || normalized.startsWith('codex-cli:')) return 'codex';
    if (this.isBedrockModel(normalized)) return 'bedrock';
    if (this.isOpenAiModel(normalized)) return 'openai';
    if (this.isClaudeModel(normalized)) return 'claude';
    if (this.isGroqModel(normalized)) return 'groq';
    if (this.isGeminiModel(normalized)) return 'gemini';
    if (this.customProvider && (this.customProvider.name === modelId || this.customProvider.id === modelId)) return 'custom';
    if (this.activeCurlProvider && (this.activeCurlProvider.name === modelId || this.activeCurlProvider.id === modelId)) return 'custom';
    if (normalized === 'teamsync') return 'teamsync';
    return detectProviderLabel(normalized);
  }

  private makeRouteDecision(route: RoutingDecision): RouteDecision {
    const frozen = Object.freeze({ ...route });
    console.log(`[ROUTE_DECISION] requestedProvider=${frozen.requestedProvider} requestedModel=${frozen.requestedModel} actualProvider=${frozen.actualProvider} actualModel=${frozen.actualModel} reason=${frozen.reason}`);
    return frozen;
  }

  public modelSupportsVision(modelId: string): boolean {
    return getModelCapabilities(this.normalizeModelId(modelId)).vision;
  }

  public async resolveRoutingDecision(args: {
    requestedModel: string;
    imagePaths?: string[];
  }): Promise<RouteDecision> {
    const requestedModel = this.normalizeModelId(args.requestedModel);
    const requestedProvider = this.getProviderForModel(requestedModel);
    const hasImages = Boolean(args.imagePaths?.length);

    if (!hasImages || this.modelSupportsVision(requestedModel)) {
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: requestedModel,
        actualProvider: requestedProvider,
        reason: 'requested_model',
      });
    }

    if (this.isBedrockModel(requestedModel) && this.bedrockClient) {
      const route = await resolveBedrockRuntimeRoute({
        client: this.bedrockClient,
        requestedModel,
        preferredModel: this.bedrockCredentials?.preferredModel,
        imagePaths: args.imagePaths,
      });
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: route.modelId,
        actualProvider: 'bedrock',
        reason: route.modelId === requestedModel ? 'requested_bedrock_vision_model' : 'vision_required_model_remap',
      });
    }

    if (this.isGroqModel(requestedModel) && (this.groqClient || this.groqKeyManager.hasAvailableKey())) {
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: GROQ_VISION_MODEL,
        actualProvider: 'groq',
        reason: 'vision_required_model_remap',
      });
    }

    if (this.claudeClient) {
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: CLAUDE_MODEL,
        actualProvider: 'claude',
        reason: 'vision_required_provider_remap',
      });
    }

    if (this.openaiClient && this.modelSupportsVision(OPENAI_MODEL)) {
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: OPENAI_MODEL,
        actualProvider: 'openai',
        reason: 'vision_required_provider_remap',
      });
    }

    throw new Error(formatVisionUnsupportedMessage(requestedModel));
  }

  public getCurrentModelCapabilities(): ModelCapabilities {
    return getModelCapabilities(this.getCurrentModel());
  }

  public currentModelSupportsVision(): boolean {
    return this.getCurrentModelCapabilities().vision;
  }

  public getVisionUnsupportedMessage(): string {
    return formatVisionUnsupportedMessage(this.getCurrentModel());
  }

  public assertCurrentModelSupportsVision(): void {
    if (!this.currentModelSupportsVision()) {
      throw new Error(this.getVisionUnsupportedMessage());
    }
  }
  // ---------------------------

  private currentModelId: string = GEMINI_FLASH_MODEL;

  public setModel(modelId: string, customProviders: (CustomProvider | CurlProvider)[] = []) {
    // Map UI short codes to internal Model IDs
    let targetModelId = this.normalizeModelId(modelId);

    if (targetModelId.startsWith('ollama-')) {
      this.useOllama = true;
      this.ollamaModel = targetModelId.replace('ollama-', '');
      this.customProvider = null;
      this.activeCurlProvider = null;
      console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel}`);
      return;
    }

    // Handle Codex CLI models (codex-cli or codex-cli:model-name)
    if (targetModelId === 'codex-cli' || targetModelId.startsWith('codex-cli:')) {
      this.useOllama = false;
      this.customProvider = null;
      this.activeCurlProvider = null;
      this.currentModelId = targetModelId;
      const codexModel = targetModelId.startsWith('codex-cli:') ? targetModelId.slice('codex-cli:'.length) : 'default';
      console.log(`[LLMHelper] Switched to Codex CLI: ${codexModel}`);
      return;
    }

    const custom = customProviders.find(p => p.id === targetModelId);
    if (custom) {
      this.useOllama = false;
      this.customProvider = custom;
      this.activeCurlProvider = null;
      console.log(`[LLMHelper] Switched to Custom Provider: ${custom.name}`);
      return;
    }

    // Standard Cloud Models
    this.useOllama = false;
    this.customProvider = null;
    this.currentModelId = targetModelId;

    // Update specific model props if needed
    if (targetModelId === GEMINI_PRO_MODEL) this.geminiModel = GEMINI_PRO_MODEL;
    if (targetModelId === GEMINI_FLASH_MODEL) this.geminiModel = GEMINI_FLASH_MODEL;

    console.log(`[LLMHelper] Switched to Cloud Model: ${targetModelId}`);
  }

  public switchToCurl(provider: CurlProvider) {
    this.useOllama = false;
    this.customProvider = null;
    this.activeCurlProvider = provider;
    console.log(`[LLMHelper] Switched to cURL provider: ${provider.name}`);
  }

  // ── Codex CLI helpers ───────────────────────────────────────────────

  private buildCodexCliPrompt(userContent: string, systemPrompt?: string): string {
    return [systemPrompt, userContent].filter(Boolean).join('\n\n');
  }

  private getSelectedCodexCliModel(fastMode: boolean = false): string {
    if (fastMode) return this.codexCliConfig.fastModel;
    if (this.currentModelId.startsWith('codex-cli:')) {
      return this.currentModelId.slice('codex-cli:'.length) || this.codexCliConfig.model;
    }
    return this.codexCliConfig.model;
  }

  public async generateWithCodexCli(
    userContent: string,
    systemPrompt?: string,
    fastMode: boolean = false,
    imagePaths?: string[],
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.codexCliConfig.enabled) throw new Error('Codex CLI transport is disabled.');
    const model = this.getSelectedCodexCliModel(fastMode);
    console.log(`[LLMHelper] 🚀 [Codex CLI] Attempting (${model}, ${imagePaths?.length ? imagePaths.length + ' image(s)' : 'text-only'})...`);
    return CodexCliService.run(this.codexCliConfig.path, {
      prompt: this.buildCodexCliPrompt(userContent, systemPrompt),
      model,
      timeoutMs: this.codexCliConfig.timeoutMs,
      imagePaths,
      sandboxMode: this.codexCliConfig.sandboxMode,
      serviceTier: this.codexCliConfig.serviceTier,
      modelReasoningEffort: this.codexCliConfig.modelReasoningEffort,
      signal,
    });
  }

  public async *streamWithCodexCli(
    userContent: string,
    systemPrompt?: string,
    fastMode: boolean = false,
    imagePaths?: string[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    if (!this.codexCliConfig.enabled) throw new Error('Codex CLI transport is disabled.');
    const model = this.getSelectedCodexCliModel(fastMode);
    console.log(`[LLMHelper] 🚀 [Codex CLI] Streaming (${model}, ${imagePaths?.length ? imagePaths.length + ' image(s)' : 'text-only'})...`);
    yield* CodexCliService.stream(this.codexCliConfig.path, {
      prompt: this.buildCodexCliPrompt(userContent, systemPrompt),
      model,
      timeoutMs: this.codexCliConfig.timeoutMs,
      imagePaths,
      sandboxMode: this.codexCliConfig.sandboxMode,
      serviceTier: this.codexCliConfig.serviceTier,
      modelReasoningEffort: this.codexCliConfig.modelReasoningEffort,
      signal,
    });
  }

  private cleanJsonResponse(text: string): string {
    // Remove markdown code block syntax if present
    text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
    // Remove any leading/trailing whitespace
    text = text.trim();
    return text;
  }

  private async callOllama(prompt: string, imagePath?: string): Promise<string> {
    try {
      // Build optional images array — Ollama multimodal API accepts raw base64 strings (no data-URL prefix)
      let images: string[] | undefined;
      if (imagePath) {
        try {
          const imageData = await fs.promises.readFile(imagePath);
          images = [imageData.toString("base64")];
        } catch (e) {
          console.warn("[LLMHelper] callOllama: failed to read image, sending text only:", e);
        }
      }

      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt: prompt,
          stream: false,
          ...(images ? { images } : {}),
          options: {
            temperature: 0.7,
            top_p: 0.9,
          }
        }),
      })

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
      }

      const data: OllamaResponse = await response.json()
      return data.response
    } catch (error: any) {
      // console.error("[LLMHelper] Error calling Ollama:", error)
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`)
    }
  }

  private async checkOllamaAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  private async initializeOllamaModel(): Promise<void> {
    try {
      const availableModels = await this.getOllamaModels()
      if (availableModels.length === 0) {
        // console.warn("[LLMHelper] No Ollama models found")
        return
      }

      // Check if current model exists, if not use the first available
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0]
        // console.log(`[LLMHelper] Auto-selected first available model: ${this.ollamaModel}`)
      }

      // Test the selected model works
      await this.callOllama("Hello")
      // console.log(`[LLMHelper] Successfully initialized with model: ${this.ollamaModel}`)
    } catch (error: any) {
      // console.error(`[LLMHelper] Failed to initialize Ollama model: ${error.message}`)
      // Try to use first available model as fallback
      try {
        const models = await this.getOllamaModels()
        if (models.length > 0) {
          this.ollamaModel = models[0]
          // console.log(`[LLMHelper] Fallback to: ${this.ollamaModel}`)
        }
      } catch (fallbackError: any) {
        // console.error(`[LLMHelper] Fallback also failed: ${fallbackError.message}`)
      }
    }
  }

  /**
   * Generate content using Gemini 3 Flash (text reasoning)
   * Used by IntelligenceManager for mode-specific prompts
   * NOTE: Migrated from Pro to Flash for consistency
   */
  public async generateWithPro(contents: any[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized")

    await this.rateLimiters.gemini.acquire();
    // console.log(`[LLMHelper] Calling ${GEMINI_FLASH_MODEL}...`)
    const response = await this.client.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents: contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3,      // Lower = faster, more focused
      }
    })
    return response.text || ""
  }

  /**
   * Generate content using Gemini 3 Flash (audio + fast multimodal)
   * CRITICAL: Audio input MUST use this model, not Pro
   */
  public async generateWithFlash(contents: any[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized")

    await this.rateLimiters.gemini.acquire();
    // console.log(`[LLMHelper] Calling ${GEMINI_FLASH_MODEL}...`)
    const response = await this.client.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents: contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3,      // Lower = faster, more focused
      }
    })
    return response.text || ""
  }

  /**
   * Post-process the response
   * NOTE: Truncation/clamping removed - response length is handled in prompts
   */
  private processResponse(text: string): string {
    // Basic cleaning
    let clean = this.cleanJsonResponse(text);

    // Truncation/clamping removed - prompts already handle response length
    // clean = clampResponse(clean, 3, 60);

    // Filter out fallback phrases
    const fallbackPhrases = [
      "I'm not sure",
      "It depends",
      "I can't answer",
      "I don't know"
    ];

    if (fallbackPhrases.some(phrase => clean.toLowerCase().includes(phrase.toLowerCase()))) {
      throw new Error("Filtered fallback response");
    }

    return clean;
  }

  /**
   * Retry logic with exponential backoff
   * Specifically handles 503 Service Unavailable
   */
  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let delay = 400;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (e: any) {
        const msg = e.message || '';
        const status = e.status ?? e.statusCode ?? 0;
        // Retryable: 503 overloaded (Gemini), 529 overloaded (Claude), 429 rate-limit (OpenAI/Claude), 500 transient
        const isRetryable = msg.includes("503") || msg.includes("overloaded")
          || status === 529 || status === 429 || status === 500
          || msg.includes("rate_limit") || msg.includes("rate limit");
        if (!isRetryable) throw e;

        console.warn(`[LLMHelper] Transient error (${status || msg.slice(0, 40)}). Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error("Model busy, try again");
  }

  /**
   * Generate content using the currently selected model
   */
  private async generateContent(contents: any[], modelIdOverride?: string): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized")

    const targetModel = modelIdOverride || this.geminiModel;
    console.log(`[LLMHelper] Calling ${targetModel}...`)

    return this.withRetry(async () => {
      // @ts-ignore
      const response = await this.client!.models.generateContent({
        model: targetModel,
        contents: contents,
        config: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.4,
        }
      });

      // Debug: log full response structure
      // console.log(`[LLMHelper] Full response:`, JSON.stringify(response, null, 2).substring(0, 500))

      const candidate = response.candidates?.[0];
      if (!candidate) {
        console.error("[LLMHelper] No candidates returned!");
        console.error(`[LLMHelper] Full response omitted from logs length=${JSON.stringify(response).length} redacted=true`);
        return "";
      }

      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        console.warn(`[LLMHelper] Generation stopped with reason: ${candidate.finishReason}`);
        console.warn(`[LLMHelper] Safety ratings:`, JSON.stringify(candidate.safetyRatings));
      }

      // Try multiple ways to access text - handle different response structures
      let text = "";

      // Method 1: Direct response.text
      if (response.text) {
        text = response.text;
      }
      // Method 2: candidate.content.parts array (check all parts)
      else if (candidate.content?.parts) {
        const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [candidate.content.parts];
        for (const part of parts) {
          if (part?.text) {
            text += part.text;
          }
        }
      }
      // Method 3: candidate.content directly (if it's a string)
      else if (typeof candidate.content === 'string') {
        text = candidate.content;
      }

      if (!text || text.trim().length === 0) {
        console.error("[LLMHelper] Candidate found but text is empty.");
        console.error("[LLMHelper] Response structure:", JSON.stringify({
          hasResponseText: !!response.text,
          candidateFinishReason: candidate.finishReason,
          candidateContent: candidate.content,
          candidateParts: candidate.content?.parts,
        }, null, 2));

        if (candidate.finishReason === "MAX_TOKENS") {
          return "Response was truncated due to length limit. Please try a shorter question or break it into parts.";
        }

        return "";
      }

      console.log(`[LLMHelper] Extracted text length: ${text.length}`);
      return text;
    });
  }

  public async extractProblemFromImages(imagePaths: string[]) {
    try {
      const prompt = `You are a wingman. Please analyze these images and extract the following information in JSON format:\n{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt, imagePaths)
      return JSON.parse(this.cleanJsonResponse(text))
    } catch (error) {
      // console.error("Error extracting problem from images:", error)
      throw error
    }
  }

  public async generateSolution(problemInfo: any) {
    const prompt = `Given this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}\n\nPlease provide your response in the following JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

    try {
      const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      return parsed
    } catch (error) {
      throw error;
    }
  }

  /**
   * Generate a structured 4-phase "Rolling Interview Script" from screenshot(s).
   * Returns a typed Solution with: problem_identifier_script, brainstorm_script,
   * code, dry_run_script, time_complexity, space_complexity.
   */
  public async generateRollingScript(imagePaths: string[]): Promise<{
    problem_identifier_script: string;
    brainstorm_script: string;
    code: string;
    dry_run_script: string;
    time_complexity: string;
    space_complexity: string;
  }> {
    const systemPrompt = `You are an elite FAANG Senior Software Engineer taking a live technical interview.
The user has provided a screenshot of a coding problem. You must generate a highly structured "Rolling Interview Script" that the candidate can read out loud to pass the interview perfectly.

Output EXACTLY this JSON structure, and nothing else (no markdown fences around the whole response):
{
  "problem_identifier_script": "1-2 conversational sentences confirming you understand the problem and its edge cases. Start with 'So just to make sure I understand...'",
  "brainstorm_script": "3-4 conversational sentences. First, mention a naive/brute-force approach and its complexity. Then, pivot to the optimal approach, mentioning the key data structure or algorithm. End by asking the interviewer if you can proceed with the optimal approach. Keep it natural.",
  "code": "The full, production-ready, heavily-commented optimal code solution in the language shown or Python if unclear. Include all necessary imports.",
  "dry_run_script": "2-3 conversational sentences doing a quick dry-run of the code with a simple example input. E.g., 'Let\\'s trace this. If our array is [1,2], the loop starts...'",
  "time_complexity": "O(...) — brief 5-word explanation",
  "space_complexity": "O(...) — brief 5-word explanation"
}

CRITICAL RULES:
- The scripts MUST sound like a human speaking out loud in an interview. Use "I", "we", "my first thought is".
- The JSON must be perfectly valid. Escape any internal quotes with backslash.
- Do NOT wrap the JSON in markdown fences.`;

    const userPrompt = `Please analyze the coding problem shown in the screenshot(s) and generate the Rolling Interview Script JSON.`;

    try {
      const raw = await this.generateWithVisionFallback(systemPrompt, userPrompt, imagePaths);
      const cleaned = this.cleanJsonResponse(raw);

      // Primary: direct parse
      try {
        return JSON.parse(cleaned);
      } catch (_) {
        // Fallback: extract JSON block via regex
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('Could not extract valid JSON from LLM response');
      }
    } catch (error) {
      throw error;
    }
  }

  public async debugSolutionWithImages(problemInfo: any, currentCode: string, debugImagePaths: string[]) {
    try {
      const prompt = `You are a wingman. Given:\n1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}\n2. The current response or approach: ${currentCode}\n3. The debug information in the provided images\n\nPlease analyze the debug information and provide feedback in this JSON format:\n{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}\nImportant: Return ONLY the JSON object, without any markdown formatting or code blocks.`

      const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt, debugImagePaths)
      const parsed = JSON.parse(this.cleanJsonResponse(text))
      return parsed
    } catch (error) {
      throw error
    }
  }





  /**
   * NEW: Helper to process image: resize to max 1536px and compress to JPEG 80%
   * drastically reduces token usage and upload time.
   */
  private async processImage(path: string): Promise<{ mimeType: string, data: string }> {
    try {
      const imageBuffer = await fs.promises.readFile(path);

      // Resize and compress
      const processedBuffer = await sharp(imageBuffer)
        .resize({
          width: 1536,
          height: 1536,
          fit: 'inside', // Maintain aspect ratio, max dimension 1536
          withoutEnlargement: true
        })
        .jpeg({ quality: 80 }) // 80% quality JPEG is much smaller than PNG
        .toBuffer();

      return {
        mimeType: "image/jpeg",
        data: processedBuffer.toString("base64")
      };
    } catch (error) {
      console.error("[LLMHelper] Failed to process image with sharp:", error);
      // Fallback to raw read if sharp fails
      const data = await fs.promises.readFile(path);
      return {
        mimeType: "image/png",
        data: data.toString("base64")
      };
    }
  }

  /**
   * Extract visible on-screen text and layout cues from screenshots.
   * This is intentionally stateless: no transcript, no knowledge mode, no RAG.
   */
  public async extractScreenText(imagePaths: string[]): Promise<string> {
    if (!imagePaths?.length) return '';
    const Tesseract = require('tesseract.js');

    try {
      const texts = await Promise.all(
        imagePaths.map(async (imagePath) => {
          const result = await Tesseract.recognize(imagePath, 'eng', {
            logger: (): any => undefined,
          });
          return result?.data?.text ?? '';
        })
      );
      return texts.join('\n');
    } catch (error: any) {
      console.warn('[LLMHelper] Screen text extraction failed:', error?.message || error);
      return '';
    }
  }

  private isLowQualityScreenText(text: string): boolean {
    if (!text) return true;

    const cleaned = text.trim();
    if (cleaned.length < 80) return true;

    const lines = cleaned.split('\n').length;
    const hasCode = /(function|const|let|class|=>)/.test(cleaned);

    const weirdChars =
      (cleaned.match(/[^a-zA-Z0-9\s\n\{\}\(\);\.\,\:\<\>\=\+\-\*\/]/g) || []).length;

    if (weirdChars > cleaned.length * 0.15) return true;
    if (lines < 3 && !hasCode) return true;

    return false;
  }

  private initOCRWorker() {
    if (this.ocrWorker) return;

    const pythonPath = getPythonPath();
    const scriptPath = getOCRScriptPath();
    this.ocrWorker = spawn(pythonPath, [scriptPath], {
      env: getPythonEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.ocrWorker.stderr.on('data', (data: Buffer) => {
      console.warn('[OCR Worker stderr]', data.toString().trim());
    });
    this.ocrWorker.stdout.on('data', (data: Buffer) => {
      this.ocrWorkerBuffer += data.toString();

      let newlineIndex = this.ocrWorkerBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = this.ocrWorkerBuffer.slice(0, newlineIndex);
        this.ocrWorkerBuffer = this.ocrWorkerBuffer.slice(newlineIndex + 1);
        let parsed: any = null;
        try {
          parsed = JSON.parse(line);
        } catch { }

        const workerRequestId = typeof parsed?.id === 'string' ? parsed.id : '';
        if (!workerRequestId || !this.ocrWorkerResolvers.has(workerRequestId)) {
          continue;
        }
        const resolve = workerRequestId ? this.ocrWorkerResolvers.get(workerRequestId) : undefined;

        if (workerRequestId) this.ocrWorkerResolvers.delete(workerRequestId);
        if (resolve) resolve(typeof parsed?.text === 'string' ? parsed.text : '');
        newlineIndex = this.ocrWorkerBuffer.indexOf('\n');
      }
    });
    this.ocrWorker.on('exit', () => {
      this.ocrWorker = null;
      this.ocrWorkerBuffer = '';
      for (const resolve of this.ocrWorkerResolvers.values()) resolve('');
      this.ocrWorkerResolvers.clear();
    });
  }

  private runOCRWorker(imagePaths: string[]): Promise<string> {
    return new Promise((resolve) => {
      this.initOCRWorker();

      if (!this.ocrWorker?.stdin) {
        resolve('');
        return;
      }

      const workerRequestId = String(++this.ocrWorkerRequestSeq);
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const wrappedResolve = (value: string) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve(value);
      };

      timeoutId = setTimeout(() => {
        this.ocrWorkerResolvers.delete(workerRequestId);
        wrappedResolve('');
      }, 3000);

      this.ocrWorkerResolvers.set(workerRequestId, wrappedResolve);

      if (this.ocrWorkerResolvers.size > 200) {
        for (const [, pendingResolve] of this.ocrWorkerResolvers) {
          pendingResolve('');
        }
        this.ocrWorkerResolvers.clear();
      }

      try {
        const payload = JSON.stringify({ id: workerRequestId, imagePaths }) + '\n';
        this.ocrWorker.stdin.write(payload);
      } catch {
        this.ocrWorkerResolvers.delete(workerRequestId);
        wrappedResolve('');
      }
    });
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  }

  private hashBuffer(buffer: Buffer): string {
    let hash = buffer.length;
    const step = Math.max(1, Math.floor(buffer.length / 200));
    for (let i = 0; i < buffer.length; i += step) {
      hash = (hash * 31 + buffer[i] + i) | 0;
    }
    return hash.toString();
  }

  public async extractScreenTextHybrid(imagePaths: string[]): Promise<string> {
    console.log(`[OCR] Starting hybrid screen text extraction for ${imagePaths?.length || 0} images...`);
    if (!imagePaths?.length) return '';
    let resizedPaths: string[] = [];

    try {
      resizedPaths = await Promise.all(
        imagePaths.map(async (imagePath) => {
          const outputPath = imagePath + `_resized_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
          const metadata = await sharp(imagePath).metadata().catch((): any => null);

          if ((metadata?.width ?? 0) > 1600) {
            await sharp(imagePath)
              .resize({ width: 1280, withoutEnlargement: true })
              .toFile(outputPath);

            return outputPath;
          }

          return imagePath;
        })
      );

      const imageBuffers = await Promise.all(resizedPaths.map((p) => fs.promises.readFile(p)));
      const key = this.hashText(imageBuffers.map((buffer) => this.hashBuffer(buffer)).join('|'));
      console.log(`[OCR] requestKey=${key} cache=disabled isolation=per_request`);
      const Tesseract = require('tesseract.js');

      const fastTexts = await Promise.all(
        resizedPaths.map(async (imagePath) => {
          const result = await Tesseract.recognize(imagePath, 'eng', {
            logger: (): any => undefined,
          });
          return result?.data?.text ?? '';
        })
      );

      let text = fastTexts.join('\n');
      console.log(`[OCR] Tesseract extraction complete. Length: ${text.length}`);
      if (this.isLowQualityScreenText(text)) {
        console.log('[OCR] Low quality text detected, running fallback OCR worker...');
        const fallback = await this.runOCRWorker(resizedPaths);

        if (fallback && fallback.trim().length > 0) {
          console.log(`[OCR] Fallback OCR complete. Length: ${fallback.length}`);
          text = fallback
            .replace(/\r/g, '')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        }
      }

      return text;
    } catch (error: any) {
      console.warn('[LLMHelper] Hybrid screen text extraction failed:', error?.message || error);
      return '';
    } finally {
      for (const p of resizedPaths) {
        if (p.includes('_resized_')) {
          fs.unlink(p, () => { });
        }
      }
    }
  }

  /**
   * Generate a suggestion based on conversation transcript - TeamSync-style
   * This uses Gemini Flash to reason about what the user should say
   * @param context - The full conversation transcript
   * @param lastQuestion - The most recent question from the interviewer
   * @returns Suggested response for the user
   */
  public async generateSuggestion(context: string, lastQuestion: string): Promise<string> {
    // Load active mode system prompt and context block (reference files + custom context)
    // TOKEN-OPT: Use deduped suffix to avoid sending shared blocks twice.
    let activeModePromptSuffix = '';
    let activeTemplateType: string | null = null;
    let modeContextBlock = '';
    try {
      const { ModesManager } = require('./services/ModesManager');
      const modesMgr = ModesManager.getInstance();
      const deduped = modesMgr.getActiveModeDeduped();
      activeModePromptSuffix = deduped.suffix ?? '';
      activeTemplateType = deduped.templateType;
      modeContextBlock = modesMgr.buildActiveModeContextBlock({ includeCustomContext: this.customNotesEnabled }) ?? '';
    } catch (_modeErr: any) {
      console.warn('[LLMHelper] ModesManager load failed in generateSuggestion (non-fatal):', _modeErr?.message);
    }

    // Prepend mode context block (reference files, custom context) to the transcript context
    const enrichedContext = modeContextBlock
      ? `${modeContextBlock}\n\n${context}`
      : context;

    // Inject custom user notes into every suggestion when present
    const customNotesBlock = (this.customNotesEnabled && this.customNotes?.trim())
      ? `\n\n<user_context>\n${this.customNotes.trim()}\n</user_context>\nUse this context naturally if relevant. Never quote it verbatim.`
      : '';

    // TOKEN-OPT: For General mode, suffix is empty (base prompt covers it).
    // For non-General modes, stack BASE_SYSTEM_PROMPT + deduped suffix.
    // Fallback: if no mode at all, use a minimal coaching prompt.
    let basePrompt: string;
    if (activeModePromptSuffix && activeTemplateType !== 'general') {
      basePrompt = `${BASE_SYSTEM_PROMPT}\n\n## ACTIVE MODE\n${activeModePromptSuffix}${customNotesBlock}`;
    } else if (activeTemplateType === 'general') {
      basePrompt = `${BASE_SYSTEM_PROMPT}${customNotesBlock}\n\nCONVERSATION SO FAR:\n${enrichedContext}\n\nLATEST QUESTION:\n${lastQuestion}\n\nANSWER DIRECTLY:`;
    } else {
      basePrompt = `You are an expert conversation coach. Based on the transcript, provide a concise, natural response the user could say.

RULES:
- Be direct and conversational
- Keep responses under 3 sentences unless complexity requires more
- Focus on answering the specific question asked
- If it's a technical question, provide a clear, structured answer
- Do NOT preface with "You could say" or similar - just give the answer directly
- If unsure, answer briefly and confidently anyway.
- Never hedge. Never say "it depends".${customNotesBlock}

CONVERSATION SO FAR:
${enrichedContext}

LATEST QUESTION:
${lastQuestion}

ANSWER DIRECTLY:`;
    }

    // Apply language instruction so this path honours the user's language setting
    const systemPrompt = this.injectLanguageInstruction(basePrompt);

    try {
      if (this.useOllama) {
        return await this.callOllama(systemPrompt);
      } else if (this.customProvider || this.activeCurlProvider) {
        // Pass basePrompt (pre-language-injection) as systemPromptOverride so streamChat
        // calls injectLanguageInstruction exactly once. lastQuestion is the clean user message.
        // enrichedContext carries the mode reference files + custom context.
        // ignoreKnowledgeMode=true: this is a live suggestion, not a knowledge/profile query.
        let fullResponse = '';
        for await (const chunk of this.streamChat(lastQuestion, undefined, enrichedContext, basePrompt, true)) {
          fullResponse += chunk;
        }
        return this.processResponse(fullResponse);
      } else if (this.client) {
        const text = await this.generateWithFlash([{ text: systemPrompt }]);
        return this.processResponse(text);
      } else {
        throw new Error("No LLM provider configured");
      }
    } catch (error) {
      throw error;
    }
  }

  public setKnowledgeOrchestrator(orchestrator: any): void {
    this.knowledgeOrchestrator = orchestrator;
    // Increment so any in-flight processQuestion() awaits can detect stale context
    this._knowledgeGenId++;
    console.log('[LLMHelper] KnowledgeOrchestrator attached');
  }

  public setCustomNotes(notes: string): void {
    this.customNotes = notes;
  }

  public setCustomNotesEnabled(enabled: boolean): void {
    this.customNotesEnabled = enabled;
    console.log(`[LLMHelper] Custom context injection ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  public getCustomNotesEnabled(): boolean {
    return this.customNotesEnabled;
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public setAiResponseLanguage(language: string) {
    this.aiResponseLanguage = language;
    console.log(`[LLMHelper] AI Response Language set to: ${language}`);
  }

  public setSttLanguage(language: string) {
    this.sttLanguage = language;
    console.log(`[LLMHelper] STT Language set to: ${language}`);
  }

  /**
   * Inject a hard language instruction that gates the entire response.
   *
   * WHY prepended, not appended:
   *   LLMs attend more strongly to early tokens. Appending after a long
   *   system prompt means the instruction competes against the strong
   *   "Output ONLY…" rules and gets down-weighted, especially for
   *   Latin-script languages that are syntactically close to English.
   *   Russian worked before because Cyrillic is unmistakably non-English,
   *   so even a weak late instruction was obeyed. French/Spanish/German etc.
   *   require the instruction to come first and be unambiguous.
   *
   * The instruction is wrapped in triple-layered enforcement:
   *   1. Hard pre-prompt gate at the very top
   *   2. System prompt body (unchanged)
   *   3. Closing reminder at the bottom (double-lock)
   */
  private injectLanguageInstruction(systemPrompt: string): string {
    // ── AUTO mode ──────────────────────────────────────────────────────────────
    // Detect the language the user is writing/speaking in and reply in that same
    // language. Supports seamless code-switching across turns (e.g. the user can
    // switch from English to Hindi mid-conversation and the AI follows).
    if (!this.aiResponseLanguage || this.aiResponseLanguage === 'auto') {
      // TOKEN-OPT: Skip language header for 'auto' — LLMs naturally match user language.
      // Saves ~63 tokens per request.
      return systemPrompt;
    }

    // ── FIXED language mode ────────────────────────────────────────────────────
    // Fast-path: no injection needed when English is selected (native default)
    if (this.aiResponseLanguage === 'English') {
      return systemPrompt;
    }

    const lang = this.aiResponseLanguage;

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

  public async chatWithGemini(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false, alternateGroqMessage?: string): Promise<string> {
    try {
      console.log(`[LLMHelper] chatWithGemini called messageLength=${message.length} redacted=true`)

      // ============================================================
      // KNOWLEDGE MODE INTERCEPT
      // If knowledge mode is active, check for intro questions and
      // inject system prompt + relevant context
      // ============================================================
      if (this.knowledgeOrchestrator?.isKnowledgeMode()) {
        try {
          this.knowledgeOrchestrator.feedForDepthScoring(message);

          // Profile intelligence generation guard: snapshot before the slow async call
          const knowledgeGenId = this._knowledgeGenId;
          const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);

          // If orchestrator was replaced (session reset) while we were awaiting, discard result
          if (this._knowledgeGenId !== knowledgeGenId) {
            console.log('[LLMHelper] Profile intelligence result discarded — session changed during await (chatWithGemini)');
          } else if (knowledgeResult) {
            // Fix 1: short-circuit for live negotiation coaching — bypass second LLM call
            if (knowledgeResult.liveNegotiationResponse) {
              return JSON.stringify({ __negotiationCoaching: knowledgeResult.liveNegotiationResponse });
            }
            // Intro question shortcut — return generated response directly
            if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
              console.log('[LLMHelper] Knowledge mode: returning generated intro response');
              return knowledgeResult.introResponse;
            }
            // P1+P3+P7 fix: Inject profile identity prompt ONLY when profile evidence exists.
            // The KnowledgeOrchestrator already filters irrelevant nodes via relevance threshold (0.55);
            // the old isProfileQuery regex was redundant and dropped valid context silently.
            // Note: chatWithGemini uses fixed system prompts (HARD_SYSTEM_PROMPT / GROQ_SYSTEM_PROMPT)
            // rather than a systemPromptOverride variable. Profile context is injected into the
            // `context` parameter; identity behavior is controlled by keeping skipSystemPrompt = false.
            if (!skipSystemPrompt && knowledgeResult.systemPromptInjection) {
              const hasProfileEvidence =
                Boolean(knowledgeResult.contextBlock?.trim()) ||
                Boolean(knowledgeResult.directResponse);
              if (hasProfileEvidence) {
                skipSystemPrompt = false; // ensure we use the knowledge prompt
                if (knowledgeResult.contextBlock?.trim()) {
                  context = context
                    ? `${knowledgeResult.contextBlock}\n\n${context}`
                    : knowledgeResult.contextBlock;
                }
              } else {
                console.log('[LLMHelper] Profile identity prompt suppressed — no context evidence (chatWithGemini)');
              }
            }
          }
        } catch (knowledgeError: any) {
          console.warn('[LLMHelper] Knowledge mode processing failed, falling back to normal:', knowledgeError.message);
        }
      }

      const isMultimodal = !!(imagePaths?.length);
      if (isMultimodal) {
        this.assertCurrentModelSupportsVision();
      }

      // GLOBAL TOKEN GUARD: enforce cap on non-streaming path too
      if (context) {
        const testTotal = estimateTokens(context) + estimateTokens(message);
        if (testTotal > TOKEN_CAP) {
          context = undefined; // drop context block entirely
          console.warn(`[TokenBudget] chatWithGemini: dropped context (${testTotal} tok > ${TOKEN_CAP} cap)`);
        }
      }

      // Helper to build combined prompts for Groq/Gemini
      const buildMessage = (systemPrompt: string) => {
        if (skipSystemPrompt) {
          return context
            ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
            : message;
        }
        return context
          ? `${systemPrompt}\n\nCONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
          : `${systemPrompt}\n\n${message}`;
      };

      // For OpenAI/Claude: separate system prompt + user message
      const userContent = context
        ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
        : message;

      // Custom notes injection — same <user_context> pattern as generateSuggestion
      // Cap at 1500 chars to prevent prompt bloat; empty = zero token cost
      const customNotesBlock = (this.customNotesEnabled && this.customNotes?.trim())
        ? `\n\n<user_context>\n${this.customNotes.trim().slice(0, 1500)}\n</user_context>\nUse this context naturally if relevant. Never quote it verbatim.`
        : '';

      const finalGeminiPrompt = this.injectLanguageInstruction(HARD_SYSTEM_PROMPT + customNotesBlock);
      const finalGroqPrompt = alternateGroqMessage || this.injectLanguageInstruction(GROQ_SYSTEM_PROMPT + customNotesBlock);

      const combinedMessages = {
        gemini: buildMessage(finalGeminiPrompt),
        groq: buildMessage(finalGroqPrompt),
      };

      // GROQ FAST TEXT OVERRIDE (Text-Only)
      if (this.groqFastTextMode && !isMultimodal && this.groqClient) {
        console.log(`[LLMHelper] ⚡️ Groq Fast Text Mode Active. Routing to Groq...`);
        try {
          return await this.generateWithGroq(combinedMessages.groq); // intentional: Fast Text Mode always uses baseline GROQ_MODEL for speed — do not thread currentModelId
        } catch (e: any) {
          console.warn("[LLMHelper] Groq Fast Text failed, falling back to standard routing:", e.message);
          // Fall through to standard routing
        }
      }

      // System prompts for OpenAI/Claude (skipped if skipSystemPrompt)
      const openaiSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(OPENAI_SYSTEM_PROMPT);
      const claudeSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(CLAUDE_SYSTEM_PROMPT);

      if (this.useOllama) {
        return await this.callOllama(combinedMessages.gemini, imagePaths?.[0]);
      }

      if (this.activeCurlProvider) {
        return await this.chatWithCurl(message, skipSystemPrompt ? undefined : this.injectLanguageInstruction(CUSTOM_SYSTEM_PROMPT), imagePaths?.[0]);
      }

      if (this.customProvider) {
        console.log(`[LLMHelper] Using Custom Provider: ${this.customProvider.name}`);
        // For non-streaming call — use rich CUSTOM prompts since custom providers can be cloud models
        const customSystemPrompt = skipSystemPrompt ? "" : this.injectLanguageInstruction(CUSTOM_SYSTEM_PROMPT);
        const response = await this.executeCustomProvider(
          this.customProvider.curlCommand,
          combinedMessages.gemini,
          customSystemPrompt,
          message,
          context || "",
          imagePaths?.[0]
        );
        return this.processResponse(response);
      }

      // --- Direct Routing based on Selected Model ---
      if (this.currentModelId === 'teamsync') {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const teamsyncKey = CredentialsManager.getInstance().getTeamSyncApiKey();
        if (teamsyncKey) {
          try {
            return await this.generateWithTeamSync(userContent, openaiSystemPrompt, imagePaths);
          } catch (err: any) {
            console.warn('[LLMHelper] TeamSync API failed in chatWithGemini, falling back to Gemini:', err.message);
            // Fall through to smart dynamic fallback below
          }
        }
        // No key or call failed — fall through to default routing
      }
      if (this.isBedrockModel(this.currentModelId) && this.bedrockClient) {
        return await this.generateWithBedrock(userContent, openaiSystemPrompt, imagePaths);
      }
      if (this.isOpenAiModel(this.currentModelId) && this.openaiClient) {
        return await this.generateWithOpenai(userContent, openaiSystemPrompt, imagePaths);
      }
      if (this.isClaudeModel(this.currentModelId) && this.claudeClient) {
        return await this.generateWithClaude(userContent, claudeSystemPrompt, imagePaths);
      }
      if (this.isGroqModel(this.currentModelId) && this.groqClient) {
        if (isMultimodal && imagePaths) {
          return await this.generateWithGroqMultimodal(userContent, imagePaths, openaiSystemPrompt);
        }
        return await this.generateWithGroq(combinedMessages.groq, this.currentModelId);
      }

      // Fallback (Gemini) - logic handled below by SMART DYNAMIC FALLBACK list

      // ============================================================
      // SMART DYNAMIC FALLBACK (Non-Streaming)
      // Multimodal: Gemini Flash → OpenAI → Claude → Gemini Pro (Groq excluded)
      // Text-only:  Gemini Flash → Gemini Pro → Groq → OpenAI → Claude
      // OpenAI/Claude use proper system+user message separation
      // ============================================================
      type ProviderAttempt = { name: string; execute: () => Promise<string> };
      const providers: ProviderAttempt[] = [];

      // Get auto-discovered text model IDs from ModelVersionManager
      const textOpenAI = this.modelVersionManager.getTextTieredModels(TextModelFamily.OPENAI).tier1;
      const textGeminiFlash = this.modelVersionManager.getTextTieredModels(TextModelFamily.GEMINI_FLASH).tier1;
      const textGeminiPro = this.modelVersionManager.getTextTieredModels(TextModelFamily.GEMINI_PRO).tier1;
      const textClaude = this.modelVersionManager.getTextTieredModels(TextModelFamily.CLAUDE).tier1;
      const textGroq = this.modelVersionManager.getTextTieredModels(TextModelFamily.GROQ).tier1;

      if (isMultimodal) {
        // MULTIMODAL PROVIDER ORDER: [TeamSync] -> OpenAI -> Gemini Flash -> Claude -> Gemini Pro -> Groq -> Custom/Ollama
        if (this.hasTeamSync()) {
          providers.push({ name: 'TeamSync API', execute: () => this.generateWithTeamSync(userContent, openaiSystemPrompt, imagePaths) });
        }
        if (this.openaiClient) {
          providers.push({ name: `OpenAI (${textOpenAI})`, execute: () => this.generateWithOpenai(userContent, openaiSystemPrompt, imagePaths, textOpenAI) });
        }
        if (this.client) {
          providers.push({
            name: `Gemini Flash (${textGeminiFlash})`,
            execute: () => this.tryGenerateResponse(combinedMessages.gemini, imagePaths, textGeminiFlash)
          });
        }
        if (this.claudeClient) {
          providers.push({ name: `Claude (${textClaude})`, execute: () => this.generateWithClaude(userContent, claudeSystemPrompt, imagePaths, textClaude) });
        }
        if (this.client) {
          providers.push({
            name: `Gemini Pro (${textGeminiPro})`,
            execute: () => this.tryGenerateResponse(combinedMessages.gemini, imagePaths, textGeminiPro)
          });
        }
        if (this.groqClient) {
          providers.push({
            name: `Groq (meta-llama/llama-4-scout-17b-16e-instruct)`,
            execute: () => this.generateWithGroqMultimodal(userContent, imagePaths!, openaiSystemPrompt)
          });
        }
        if (this.bedrockClient && this.bedrockCredentials?.preferredModel) {
          providers.push({
            name: `Bedrock (${this.bedrockCredentials.preferredModel})`,
            execute: () => this.generateWithBedrock(userContent, openaiSystemPrompt, imagePaths, this.bedrockCredentials!.preferredModel)
          });
        }
      } else {
        // TEXT-ONLY: [TeamSync] -> Groq -> Gemini Flash -> Gemini Pro -> OpenAI -> Claude
        if (this.hasTeamSync()) {
          providers.push({ name: 'TeamSync API', execute: () => this.generateWithTeamSync(userContent, openaiSystemPrompt) });
        }
        if (this.groqClient) {
          providers.push({ name: `Groq (${textGroq})`, execute: () => this.generateWithGroq(combinedMessages.groq, textGroq) });
        }
        if (this.client) {
          providers.push({
            name: `Gemini Flash (${textGeminiFlash})`,
            execute: () => this.tryGenerateResponse(combinedMessages.gemini, undefined, textGeminiFlash)
          });
          providers.push({
            name: `Gemini Pro (${textGeminiPro})`,
            execute: () => this.tryGenerateResponse(combinedMessages.gemini, undefined, textGeminiPro)
          });
        }
        if (this.openaiClient) {
          providers.push({ name: `OpenAI (${textOpenAI})`, execute: () => this.generateWithOpenai(userContent, openaiSystemPrompt, undefined, textOpenAI) });
        }
        if (this.claudeClient) {
          providers.push({ name: `Claude (${textClaude})`, execute: () => this.generateWithClaude(userContent, claudeSystemPrompt, undefined, textClaude) });
        }
        if (this.bedrockClient && this.bedrockCredentials?.preferredModel) {
          providers.push({
            name: `Bedrock (${this.bedrockCredentials.preferredModel})`,
            execute: () => this.generateWithBedrock(userContent, openaiSystemPrompt, undefined, this.bedrockCredentials!.preferredModel)
          });
        }
      }

      if (providers.length === 0) {
        return "No AI providers configured. Please add at least one API key in Settings.";
      }

      // ============================================================
      // RELENTLESS RETRY: Try all providers, then retry entire chain
      // with exponential backoff. Max 2 full rotations.
      // ============================================================
      const MAX_FULL_ROTATIONS = 3;

      for (let rotation = 0; rotation < MAX_FULL_ROTATIONS; rotation++) {
        if (rotation > 0) {
          const backoffMs = 1000 * rotation;
          console.log(`[LLMHelper] 🔄 Non-streaming rotation ${rotation + 1}/${MAX_FULL_ROTATIONS} after ${backoffMs}ms backoff...`);
          await this.delay(backoffMs);
        }

        for (const provider of providers) {
          try {
            console.log(`[LLMHelper] ${rotation === 0 ? '🚀' : '🔁'} Attempting ${provider.name}...`);
            const rawResponse = await provider.execute();
            if (rawResponse && rawResponse.trim().length > 0) {
              console.log(`[LLMHelper] ✅ ${provider.name} succeeded`);
              return this.processResponse(rawResponse);
            }
            console.warn(`[LLMHelper] ⚠️ ${provider.name} returned empty response`);
          } catch (error: any) {
            console.warn(`[LLMHelper] ⚠️ ${provider.name} failed: ${error.message}`);
          }
        }
      }

      // All exhausted
      console.error("[LLMHelper] ❌ All non-streaming providers exhausted");
      return "I apologize, but I couldn't generate a response. Please try again.";

    } catch (error: any) {
      console.error("[LLMHelper] Critical Error in chatWithGemini:", error);

      if (error.message.includes("503") || error.message.includes("overloaded")) {
        return "The AI service is currently overloaded. Please try again in a moment.";
      }
      if (error.message.includes("API key")) {
        return "Authentication failed. Please check your API key in settings.";
      }
      return `I encountered an error: ${error.message || "Unknown error"}. Please try again.`;
    }
  }

  /**
   * Generate content using only reasoning-capable models.
   * Priority: OpenAI → Claude → Gemini Pro → Groq (last resort).
   * Used for structured JSON output tasks (resume/JD/company research).
   * NOTE: Does NOT mutate this.geminiModel — calls Gemini Pro directly to avoid race conditions.
   */
  public async generateContentStructured(message: string): Promise<string> {
    type ProviderAttempt = { name: string; execute: () => Promise<string> };
    const providers: ProviderAttempt[] = [];

    // Priority 1: OpenAI
    if (this.openaiClient) {
      providers.push({ name: `OpenAI (${OPENAI_MODEL})`, execute: () => this.generateWithOpenai(message) });
    }

    // Priority 2: Gemini Pro (don't mutate this.geminiModel to avoid race conditions)
    // NOTE: Claude is intentionally de-prioritised here — messages.create (non-streaming) is
    // rejected by Anthropic for large payloads ("Streaming is required for operations that may
    // take longer than 10 minutes"), causing a wasted round-trip before the Gemini fallback.
    // Claude remains available as a last resort after Gemini Flash.
    if (this.client) {
      providers.push({
        name: `Gemini Pro (${GEMINI_PRO_MODEL})`,
        execute: async () => {
          // Call the API directly with the Pro model instead of touching shared state
          const response = await this.withRetry(async () => {
            // @ts-ignore
            const res = await this.client!.models.generateContent({
              model: GEMINI_PRO_MODEL,
              contents: [{ role: 'user', parts: [{ text: message }] }],
              config: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 }
            });
            const candidate = res.candidates?.[0];
            if (!candidate) return '';
            if (res.text) return res.text;
            const parts = candidate.content?.parts ?? [];
            return (Array.isArray(parts) ? parts : [parts]).map((p: any) => p?.text ?? '').join('');
          });
          return response;
        }
      });

      // Priority 3b: Gemini Flash fallback (if Pro model is unavailable or fails)
      providers.push({
        name: `Gemini Flash (${GEMINI_FLASH_MODEL})`,
        execute: async () => {
          const response = await this.withRetry(async () => {
            // @ts-ignore
            const res = await this.client!.models.generateContent({
              model: GEMINI_FLASH_MODEL,
              contents: [{ role: 'user', parts: [{ text: message }] }],
              config: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 }
            });
            const candidate = res.candidates?.[0];
            if (!candidate) return '';
            if (res.text) return res.text;
            const parts = candidate.content?.parts ?? [];
            return (Array.isArray(parts) ? parts : [parts]).map((p: any) => p?.text ?? '').join('');
          });
          return response;
        }
      });
    }

    // Priority 4: Claude (last resort before Groq — non-streaming, fails on large payloads)
    if (this.claudeClient) {
      providers.push({ name: `Claude (${CLAUDE_MODEL})`, execute: () => this.generateWithClaude(message) });
    }

    // Priority 5: Groq (Fallback despite JSON hallucination risks)
    if (this.groqClient) {
      providers.push({ name: `Groq (${GROQ_MODEL}) fallback`, execute: () => this.generateWithGroq(message) }); // intentional: structured-gen last-resort uses stable baseline model, not user selection
    }

    // Priority 6: Ollama (on-device fallback — last resort, no cloud dependency)
    if (this.useOllama && await this.checkOllamaAvailable()) {
      providers.push({
        name: `Ollama (${this.ollamaModel})`,
        execute: () => this.callOllama(message)
      });
    }

    // Priority 7: Custom / cURL providers (OpenRouter etc.)
    if (this.customProvider) {
      providers.push({
        name: `Custom Provider (${this.customProvider.name})`,
        execute: () => this.executeCustomProvider(
          this.customProvider!.curlCommand,
          message,
          '',
          message,
          ''
        )
      });
    } else if (this.activeCurlProvider) {
      providers.push({
        name: `cURL Provider (${this.activeCurlProvider.name})`,
        execute: () => this.chatWithCurl(message)
      });
    }

    // Priority 8: TeamSync API — used when no other provider is available, or as final fallback
    const teamsyncKeyForStructured = this.teamsyncKey || (() => {
      try { return require('./services/CredentialsManager').CredentialsManager.getInstance().getTeamSyncApiKey() || null; } catch { return null; }
    })();
    if (teamsyncKeyForStructured) {
      providers.push({
        name: 'TeamSync API',
        execute: () => this.generateWithTeamSync(message)
      });
    }

    if (providers.length === 0) {
      throw new Error('No reasoning model available. Please configure an API key (OpenAI, Claude, Gemini, Groq, TeamSync) or a custom provider.');
    }

    const MAX_ROTATIONS = 3;
    for (let rotation = 0; rotation < MAX_ROTATIONS; rotation++) {
      if (rotation > 0) {
        const backoffMs = 1000 * rotation;
        console.log(`[LLMHelper] 🔄 Structured generation rotation ${rotation + 1}/${MAX_ROTATIONS} after ${backoffMs}ms backoff...`);
        await this.delay(backoffMs);
      }

      for (const provider of providers) {
        try {
          console.log(`[LLMHelper] 🧠 Structured generation: trying ${provider.name}...`);
          const result = await provider.execute();
          if (result && result.trim().length > 0) {
            console.log(`[LLMHelper] ✅ Structured generation succeeded with ${provider.name}`);
            return result;
          }
          console.warn(`[LLMHelper] ⚠️ ${provider.name} returned empty response`);
        } catch (error: any) {
          console.warn(`[LLMHelper] ⚠️ Structured generation: ${provider.name} failed: ${error.message}`);
        }
      }
    }

    throw new Error('All reasoning models failed for structured generation after 3 attempts');
  }

  private async generateWithGroq(fullMessage: string, modelId: string = GROQ_MODEL): Promise<string> {
    if (!this.groqClient && !this.groqKeyManager.hasAvailableKey()) throw new Error("Groq client not initialized");

    const size = estimateModelRequestSize(
      'groq',
      modelId,
      '',
      fullMessage,
      MODEL_BUDGETS.groq_llama_70b.safeTPM,
    );
    console.log('[MODEL_REQUEST_SIZE]', size);
    let requestMessage = fullMessage;
    if (size.exceedsLimit) {
      const compacted = compactGroqFullMessageForBudget(fullMessage, modelId, MODEL_BUDGETS.groq_llama_70b.safeTPM);
      requestMessage = compacted.fullMessage;
      const reducedSize = estimateModelRequestSize(
        'groq',
        modelId,
        '',
        requestMessage,
        MODEL_BUDGETS.groq_llama_70b.safeTPM,
      );
      console.log('[MODEL_REQUEST_SIZE]', reducedSize);
      if (compacted.stillExceeds) {
        throw new Error('Groq compact prompt still exceeds provider limit.');
      }
    }

    await this.rateLimiters.groq.acquire();

    // Non-streaming Groq call with automatic key rotation
    const response = await this.groqRotatingClient.chatCompletion({
      model: modelId,
      messages: [{ role: "user", content: requestMessage }],
      temperature: 0.4,
      max_tokens: 8192,
    });

    return response.choices[0]?.message?.content || "";
  }

  /**
   * Non-streaming OpenAI generation with proper system/user separation
   */
  /**
   * Routes AI generation through the TeamSync API backend (Gemini-powered).
   */
  private async generateWithTeamSync(userMessage: string, systemPrompt?: string, imagePaths?: string[], maxOutputTokens?: number): Promise<string> {
    // Prefer the in-memory field; fall back to CredentialsManager for the direct-routing path
    // where currentModelId === 'teamsync' but setTeamSyncKey() wasn't called yet.
    let teamsyncKey = this.teamsyncKey;
    if (!teamsyncKey) {
      const { CredentialsManager } = require('./services/CredentialsManager');
      teamsyncKey = CredentialsManager.getInstance().getTeamSyncApiKey() || null;
    }
    if (!teamsyncKey) throw new Error('TeamSync API key not set');

    const headers: any = {
      'Content-Type': 'application/json',
      'x-teamsync-key': teamsyncKey,
    };

    const body: any = { messages: [{ role: 'user', content: userMessage }] };
    if (maxOutputTokens) body.max_tokens = maxOutputTokens;

    // Signal fast mode so the server routes to Groq Llama 3.3 (text-only, key-rotated).
    // Only sent for text-only requests — server ignores it when images are present.
    if (this.groqFastTextMode && (!imagePaths || imagePaths.length === 0)) body.fast_mode = true;

    // Send images as a structured array so the server can build proper Gemini inlineData parts.
    // Embedding base64 in the text content would be truncated at 4000 chars and treated as text.
    //
    // Compress before sending: retina screenshots are 2-5 MB PNG; the TeamSync API body limit
    // is 4 MB. Resize to max 1920px (above the 1470px logical resolution of a MacBook Air, so
    // no detail is lost) and encode as JPEG 85% — typically 200-250 KB per image.
    // 4 screenshots × ~278KB base64 = ~1.1 MB, well within the 4 MB server limit.
    if (imagePaths?.length) {
      const images: { mime_type: string; data: string }[] = [];
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          try {
            const compressed = await sharp(p)
              .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer();
            images.push({ mime_type: 'image/jpeg', data: compressed.toString('base64') });
          } catch (compressErr: any) {
            // Fallback: send raw if sharp fails (e.g. unsupported format)
            console.warn('[LLMHelper] Image compression failed, sending raw:', compressErr.message);
            const imageData = await fs.promises.readFile(p);
            if (imageData.length > 500 * 1024) {
              console.warn('[LLMHelper] Raw fallback image too large to send, skipping:', p);
              continue;
            }
            images.push({ mime_type: 'image/png', data: imageData.toString('base64') });
          }
        }
      }
      if (images.length) body.images = images;
    }
    if (systemPrompt) body.system = systemPrompt;
    if (this.aiResponseLanguage && this.aiResponseLanguage !== 'English') {
      body.language = this.aiResponseLanguage; // 'auto' is forwarded — server handles it
    }

    const response = await fetch(TEAMSYNC_CHAT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`TeamSync API error ${response.status}: ${errData.error || 'unknown'}`);
    }

    const data = await response.json();
    return data.content || '';
  }

  /**
   * Non-streaming OpenAI generation with proper system/user separation
   */
  private async generateWithOpenai(userMessage: string, systemPrompt?: string, imagePaths?: string[], modelId?: string): Promise<string> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    await this.rateLimiters.openai.acquire();

    // Use explicit override, then current model if it's OpenAI, else baseline constant
    const model = modelId || (this.isOpenAiModel(this.currentModelId) ? this.currentModelId : OPENAI_MODEL);

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    if (imagePaths?.length) {
      const contentParts: any[] = [{ type: "text", text: userMessage }];
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${imageData.toString("base64")}` } });
        }
      }
      messages.push({ role: "user", content: contentParts });
    } else {
      messages.push({ role: "user", content: userMessage });
    }

    const response = await this.withTimeout(
      this.withRetry(() => this.openaiClient!.chat.completions.create({
        model,
        messages,
        max_completion_tokens: model.toLowerCase().includes('claude') ? CLAUDE_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
      })),
      60000,
      `OpenAI (${model})`
    );

    return response.choices[0]?.message?.content || "";
  }

  private async resolveBedrockRuntimeModel(imagePaths?: string[], modelId?: string): Promise<string> {
    if (!this.bedrockClient) throw new Error("Bedrock client not initialized");

    const route = await resolveBedrockRuntimeRoute({
      client: this.bedrockClient,
      requestedModel: modelId,
      preferredModel: this.bedrockCredentials?.preferredModel,
      imagePaths,
    });

    if (route.hasImages) {
      console.log('[BEDROCK_VISION_ROUTE]', {
        model: route.modelId,
        hasImage: true,
        imageCount: route.imageCount,
      });
    }

    return route.modelId;
  }

  public async generateWithBedrock(userMessage: string, systemPrompt?: string, imagePaths?: string[], modelId?: string, maxOutputTokens?: number, signal?: AbortSignal): Promise<string> {
    if (!this.bedrockClient) throw new Error("Bedrock client not initialized");
    await this.rateLimiters.bedrock.acquire();
    let model = modelId || this.currentModelId;
    const resolvedMaxTokens = maxOutputTokens || resolveBedrockMaxOutputTokens(model);
    model = await this.resolveBedrockRuntimeModel(imagePaths, model);

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[BEDROCK_RETRY] attempt=${attempt}/${MAX_RETRIES} model=${model}`);
          BedrockTelemetry.recordRetry();
        }
        const start = Date.now();
        console.log('[BEDROCK_ROUTE]', { provider: 'bedrock', model, maxTokens: resolvedMaxTokens, attempt });
        const result = await this.bedrockClient.generate(userMessage, {
          modelId: model,
          systemPrompt,
          imagePaths,
          maxOutputTokens: resolvedMaxTokens,
        }, signal);
        BedrockTelemetry.recordRequest(Date.now() - start, Math.ceil(result.length / 4), false);
        return result;
      } catch (error) {
        const mapped = mapBedrockError(error);

        if (!mapped.isRetryable || attempt === MAX_RETRIES) {
          BedrockTelemetry.recordRequest(0, 0, true);
          this.notifyBedrockReauthenticationRequired(error, model);
          throw error;
        }

        if (signal?.aborted) {
          BedrockTelemetry.recordCancel();
          throw error;
        }

        const baseDelay = mapped.retryAfterMs || 500;
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[BEDROCK_RETRY] ${mapped.awsExceptionName}: retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        if (mapped.awsExceptionName === 'ThrottlingException' || mapped.httpStatus === 429) {
          BedrockTelemetry.record429();
        }

        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(new Error('Aborted during retry backoff')); };
          const timer = setTimeout(() => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve();
          }, delay);
          if (signal) {
            if (signal.aborted) { clearTimeout(timer); reject(new Error('Aborted during retry backoff')); return; }
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });

        await this.rateLimiters.bedrock.acquire();
      }
    }
    // Unreachable but TypeScript needs this
    throw new Error('Bedrock generate retries exhausted');
  }

  // The handler for cURL requests
  public async chatWithCurl(userMessage: string, systemPrompt?: string, imagePath?: string): Promise<string> {
    if (!this.activeCurlProvider) throw new Error("No cURL provider active");

    const { curlCommand, responsePath } = this.activeCurlProvider;

    // 1. Parse cURL to config object
    // @ts-ignore
    const curlConfig = curl2Json(curlCommand);

    // 2. Prepare Image (if any)
    let base64Image = "";
    if (imagePath) {
      try {
        const imageData = await fs.promises.readFile(imagePath);
        base64Image = imageData.toString("base64");
      } catch (e) {
        console.warn("[LLMHelper] chatWithCurl: failed to read image:", e);
      }
    }

    // 3. Prepare Variables
    // We combine System Prompt + User Message into {{TEXT}} for simplicity in raw mode.
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userMessage}` : userMessage;

    const variables = {
      TEXT: fullPrompt.replace(/\n/g, "\\n").replace(/"/g, '\\"'), // Basic escaping (pre-existing)
      IMAGE_BASE64: base64Image,
    };

    // 4. Inject Variables into URL, Headers, and Body
    const url = deepVariableReplacer(curlConfig.url, variables);
    const headers = deepVariableReplacer(curlConfig.header || {}, variables);
    let data = deepVariableReplacer(curlConfig.data || {}, variables);

    // 4a. Auto-upgrade last user message to multimodal content array when an image is present.
    if (base64Image && imagePath) {
      data = injectImageIntoMessages(data, base64Image, imagePath);
    }

    // 5. Execute
    try {
      const response = await axios({
        method: curlConfig.method || 'POST',
        url: url,
        headers: headers,
        data: data
      });

      // 6. Extract Answer
      // If user didn't specify a path, try to guess or dump string
      if (!responsePath) return JSON.stringify(response.data);

      const answer = getByPath(response.data, responsePath);

      if (typeof answer === 'string') return answer;
      return JSON.stringify(answer); // Fallback if they pointed to an object

    } catch (error: any) {
      console.error("[LLMHelper] cURL Execution Error:", error.message);
      return `Error: ${error.message}`;
    }
  }

  /**
   * Non-streaming Claude generation with proper system/user separation
   */
  private async generateWithClaude(userMessage: string, systemPrompt?: string, imagePaths?: string[], modelId?: string): Promise<string> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    await this.rateLimiters.claude.acquire();

    // Use explicit override, then current model if it's Claude, else stable fallback
    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);

    const content: any[] = [];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }
    }
    content.push({ type: "text", text: userMessage });

    const response = await this.withTimeout(
      this.withRetry(() => this.claudeClient!.messages.create({
        model,
        max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [{ role: "user", content }],
      })),
      90000,
      `Claude (${model})`
    );

    const textBlock = response.content.find((block: any) => block.type === 'text') as any;
    return textBlock?.text || "";
  }

  /**
   * Executes a custom cURL provider defined by the user
   */
  public async executeCustomProvider(
    curlCommand: string,
    combinedMessage: string,
    systemPrompt: string,
    rawUserMessage: string,
    context: string,
    imagePath?: string
  ): Promise<string> {

    // 1. Parse cURL to JSON object
    const requestConfig = curl2Json(curlCommand);

    // 2. Prepare Image (if any)
    let base64Image = "";
    if (imagePath) {
      try {
        const imageData = await fs.promises.readFile(imagePath);
        base64Image = imageData.toString("base64");
      } catch (e) {
        console.warn("Failed to read image for Custom Provider:", e);
      }
    }

    // 3. Prepare Variables
    const variables = {
      TEXT: combinedMessage,             // Deprecated but kept for compat: System + Context + User
      PROMPT: combinedMessage,           // Alias for TEXT
      SYSTEM_PROMPT: systemPrompt,       // Raw System Prompt
      USER_MESSAGE: rawUserMessage,      // Raw User Message
      CONTEXT: context,                  // Raw Context
      IMAGE_BASE64: base64Image,         // Base64 encoded image string
    };

    // 4. Inject Variables into URL, Headers, and Body
    const url = deepVariableReplacer(requestConfig.url, variables);
    const headers = deepVariableReplacer(requestConfig.header || {}, variables);
    let body = deepVariableReplacer(requestConfig.data || {}, variables);

    // 4a. Auto-upgrade last user message to multimodal content array when an image
    //     is present and the body follows the OpenAI messages format.
    //     This is a no-op for non-OpenAI formats and for templates that already
    //     include a proper image_url part, so it is fully backward-compatible.
    if (base64Image && imagePath) {
      body = injectImageIntoMessages(body, base64Image, imagePath);
    }

    // 5. Execute Fetch (30s timeout — same as RestSTT uploads)
    const customAbort = new AbortController();
    const customTimeout = setTimeout(() => customAbort.abort(), 30_000);
    try {
      const response = await fetch(url, {
        method: requestConfig.method || 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: customAbort.signal,
      });
      clearTimeout(customTimeout);

      const data = await response.json();
      console.log(`[LLMHelper] Custom Provider raw response length=${JSON.stringify(data).length} redacted=true`);

      if (!response.ok) {
        throw new Error(`Custom Provider HTTP ${response.status}: response redacted`);
      }

      // 6. Extract Answer - try common response formats
      const extracted = this.extractFromCommonFormats(data);
      console.log(`[LLMHelper] Custom Provider extracted text length: ${extracted.length}`);
      return extracted;
    } catch (error) {
      clearTimeout(customTimeout);
      console.error("Custom Provider Error:", error);
      throw error;
    }
  }

  /**
   * Try to extract text content from common LLM API response formats.
   * Supports: Ollama, OpenAI, Anthropic, and generic formats.
   */
  private extractFromCommonFormats(data: any): string {
    if (!data || typeof data === 'string') return data || "";

    // Ollama format: { response: "..." }
    if (typeof data.response === 'string') return data.response;

    // OpenAI format: { choices: [{ message: { content: "..." } }] }
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;

    // OpenAI delta/streaming format: { choices: [{ delta: { content: "..." } }] }
    if (data.choices?.[0]?.delta?.content) return data.choices[0].delta.content;

    // NOTE: reasoning_content (model's thinking process) is intentionally NOT extracted
    // to avoid showing internal reasoning to users. Only final content is returned.

    // Anthropic format: { content: [{ text: "..." }] }
    if (Array.isArray(data.content) && data.content[0]?.text) return data.content[0].text;

    // Generic text field
    if (typeof data.text === 'string') return data.text;

    // Generic output field
    if (typeof data.output === 'string') return data.output;

    // Generic result field
    if (typeof data.result === 'string') return data.result;

    // For streaming responses: return empty string instead of raw JSON
    // This prevents JSON artifacts from appearing in the output
    if (data.choices?.[0]?.delta !== undefined) {
      // It's a streaming delta chunk with no extractable content
      return "";
    }

    // For streaming responses with empty choices array (e.g., final usage chunk)
    // This handles: { "choices": [], "usage": { ... } }
    if (Array.isArray(data.choices) && data.choices.length === 0) {
      return "";
    }

    // Fallback: stringify the whole response (only for non-streaming responses)
    console.warn("[LLMHelper] Could not extract text from custom provider response, returning raw JSON");
    return JSON.stringify(data);
  }

  /**
   * Map UNIVERSAL (local model) prompts to richer CUSTOM prompts.
   * Custom providers can be any cloud model, so they get detailed prompts.
   */
  private mapToCustomPrompt(prompt: string): string {
    // Map from concise UNIVERSAL to rich CUSTOM equivalents
    if (prompt === UNIVERSAL_SYSTEM_PROMPT || prompt === HARD_SYSTEM_PROMPT) return CUSTOM_SYSTEM_PROMPT;
    if (prompt === UNIVERSAL_ANSWER_PROMPT) return CUSTOM_ANSWER_PROMPT;
    if (prompt === UNIVERSAL_WHAT_TO_ANSWER_PROMPT) return CUSTOM_WHAT_TO_ANSWER_PROMPT;
    if (prompt === UNIVERSAL_RECAP_PROMPT) return CUSTOM_RECAP_PROMPT;
    if (prompt === UNIVERSAL_FOLLOWUP_PROMPT) return CUSTOM_FOLLOWUP_PROMPT;
    if (prompt === UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT) return CUSTOM_FOLLOW_UP_QUESTIONS_PROMPT;
    if (prompt === UNIVERSAL_ASSIST_PROMPT) return CUSTOM_ASSIST_PROMPT;
    // If it's already a different override (e.g. user-supplied), pass through
    return prompt;
  }

  private async tryGenerateResponse(fullMessage: string, imagePaths?: string[], modelIdOverride?: string): Promise<string> {
    let rawResponse: string;

    if (imagePaths?.length) {
      const contents: any[] = [{ text: fullMessage }];
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          contents.push({
            inlineData: {
              mimeType: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }

      // Use current model for multimodal (allows Pro fallback)
      if (this.client) {
        rawResponse = await this.generateContent(contents, modelIdOverride);
      } else {
        throw new Error("No LLM provider configured");
      }
    } else {
      // Text-only chat
      if (this.useOllama) {
        rawResponse = await this.callOllama(fullMessage);
      } else if (this.client) {
        rawResponse = await this.generateContent([{ text: fullMessage }], modelIdOverride);
      } else {
        throw new Error("No LLM provider configured");
      }
    }

    return rawResponse || "";
  }


  /**
   * Non-streaming multimodal response from Groq using Llama 4 Scout
   */
  private async generateWithGroqMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string): Promise<string> {
    if (!this.groqClient && !this.groqKeyManager.hasAvailableKey()) throw new Error("Groq client not initialized");

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    const contentParts: any[] = [{ type: "text", text: userMessage }];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        const imageData = await fs.promises.readFile(p);
        contentParts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData.toString("base64")}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });

    // Non-streaming multimodal call with automatic key rotation
    const response = await this.groqRotatingClient.chatCompletion({
	      model: GROQ_VISION_MODEL,
      messages,
      temperature: 1,
      max_completion_tokens: 28672,
      top_p: 1,
      stop: null
    });

    return response.choices[0]?.message?.content || "";
  }

  /**
   * Universal non-streaming fallback helper for internal operations (screenshot analysis, problem extraction, etc.)
   *
   * THREE-TIER RETRY ROTATION (self-improving):
   *   Tier 1: Pinned stable models (promoted only when 2+ minor versions behind)
   *   Tier 2: Latest auto-discovered models (updated every ~14 days) — 1st retry
   *   Tier 3: Same as Tier 2 — 2nd retry (with backoff between tiers)
   *
   * Provider order per tier: OpenAI -> Gemini Flash -> Claude -> Gemini Pro -> Groq Scout
   * After all cloud tiers: Custom Provider -> cURL Provider -> Ollama
   */
  private async generateWithVisionFallback(systemPrompt: string, userPrompt: string, imagePaths: string[] = []): Promise<string> {
    type ProviderAttempt = { name: string; execute: () => Promise<string> };
    const isMultimodal = imagePaths.length > 0;
    if (isMultimodal) {
      this.assertCurrentModelSupportsVision();
    }

    // Helper: build a provider attempt for a given family + model ID
    const buildProviderForFamily = (family: ModelFamily, modelId: string): ProviderAttempt | null => {
      switch (family) {
        case ModelFamily.OPENAI:
          if (!this.openaiClient) return null;
          return {
            name: `OpenAI (${modelId})`,
            execute: () => this.generateWithOpenai(userPrompt, systemPrompt, isMultimodal ? imagePaths : undefined, modelId)
          };

        case ModelFamily.GEMINI_FLASH:
          if (!this.client) return null;
          if (isMultimodal) {
            return {
              name: `Gemini Flash (${modelId})`,
              execute: async () => {
                const contents: any[] = [{ text: `${systemPrompt}\n\n${userPrompt}` }];
                for (const p of imagePaths) {
                  if (fs.existsSync(p)) {
                    const { mimeType, data } = await this.processImage(p);
                    contents.push({ inlineData: { mimeType, data } });
                  }
                }
                return await this.generateContent(contents, modelId);
              }
            };
          }
          return {
            name: `Gemini Flash (${modelId})`,
            execute: () => this.generateContent([{ text: `${systemPrompt}\n\n${userPrompt}` }], modelId)
          };

        case ModelFamily.CLAUDE:
          if (!this.claudeClient) return null;
          return {
            name: `Claude (${modelId})`,
            execute: () => this.generateWithClaude(userPrompt, systemPrompt, isMultimodal ? imagePaths : undefined, modelId)
          };

        case ModelFamily.GEMINI_PRO:
          if (!this.client) return null;
          if (isMultimodal) {
            return {
              name: `Gemini Pro (${modelId})`,
              execute: async () => {
                const contents: any[] = [{ text: `${systemPrompt}\n\n${userPrompt}` }];
                for (const p of imagePaths) {
                  if (fs.existsSync(p)) {
                    const { mimeType, data } = await this.processImage(p);
                    contents.push({ inlineData: { mimeType, data } });
                  }
                }
                return await this.generateContent(contents, modelId);
              }
            };
          }
          return {
            name: `Gemini Pro (${modelId})`,
            execute: () => this.generateContent([{ text: `${systemPrompt}\n\n${userPrompt}` }], modelId)
          };

        case ModelFamily.GROQ_LLAMA:
          if (!this.groqClient) return null;
          if (isMultimodal) {
            return {
              name: `Groq (${modelId})`,
              execute: () => this.generateWithGroqMultimodal(userPrompt, imagePaths, systemPrompt)
            };
          }
          return {
            name: `Groq (${modelId})`,
            execute: () => this.generateWithGroq(`${systemPrompt}\n\n${userPrompt}`, modelId)
          };

        default:
          return null;
      }
    };

    // ──────────────────────────────────────────────────────────────────
    // Build 3-tier retry rotation from ModelVersionManager
    // ──────────────────────────────────────────────────────────────────
    const allTiers = this.modelVersionManager.getAllVisionTiers();

    const buildTierProviders = (tierKey: 'tier1' | 'tier2' | 'tier3'): ProviderAttempt[] => {
      const result: ProviderAttempt[] = [];
      for (const entry of allTiers) {
        const modelId = entry[tierKey];
        const attempt = buildProviderForFamily(entry.family, modelId);
        if (attempt) result.push(attempt);
      }
      return result;
    };

    const tier1Providers = buildTierProviders('tier1');
    const tier2Providers = buildTierProviders('tier2');
    const tier3Providers = buildTierProviders('tier3'); // Same as tier2 — pure retry


    // ──────────────────────────────────────────────────────────────────
    // Local fallback providers (appended after all cloud tiers)
    // ──────────────────────────────────────────────────────────────────
    const localProviders: ProviderAttempt[] = [];

    if (this.customProvider) {
      if (isMultimodal) {
        localProviders.push({
          name: `Custom Provider (${this.customProvider.name})`,
          execute: () => this.executeCustomProvider(
            this.customProvider!.curlCommand,
            `${systemPrompt}\n\n${userPrompt}`,
            systemPrompt,
            userPrompt,
            "",
            imagePaths[0]
          )
        });
      } else {
        localProviders.push({
          name: `Custom Provider (${this.customProvider.name})`,
          execute: () => this.executeCustomProvider(
            this.customProvider!.curlCommand,
            `${systemPrompt}\n\n${userPrompt}`,
            systemPrompt,
            userPrompt,
            ""
          )
        });
      }
    }

    if (this.activeCurlProvider && !this.customProvider) {
      localProviders.push({
        name: `cURL Provider (${this.activeCurlProvider.name})`,
        execute: () => this.chatWithCurl(userPrompt, systemPrompt, isMultimodal ? imagePaths[0] : undefined)
      });
    }

    if (this.useOllama) {
      localProviders.push({
        name: `Ollama (${this.ollamaModel})`,
        execute: () => this.callOllama(`${systemPrompt}\n\n${userPrompt}`, isMultimodal ? imagePaths[0] : undefined)
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // Execute 3-tier rotation with exponential backoff between tiers
    // ──────────────────────────────────────────────────────────────────
    const tiers = [
      { label: 'Tier 1 (Stable)', providers: tier1Providers },
      { label: 'Tier 2 (Latest)', providers: tier2Providers },
      { label: 'Tier 3 (Retry)', providers: tier3Providers },
    ];

    for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
      const tier = tiers[tierIndex];

      if (tier.providers.length === 0) continue;

      // Exponential backoff between tiers (skip for first tier)
      if (tierIndex > 0) {
        const backoffMs = 1000 * Math.pow(2, tierIndex - 1);
        console.log(`[LLMHelper] 🔄 Escalating to ${tier.label} after ${backoffMs}ms backoff...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }

      for (const provider of tier.providers) {
        try {
          const emoji = tierIndex === 0 ? '🚀' : tierIndex === 1 ? '🔁' : '🆘';
          console.log(`[LLMHelper] ${emoji} [${tier.label}] Attempting ${provider.name}...`);
          const result = await provider.execute();
          if (result && result.trim().length > 0) {
            console.log(`[LLMHelper] ✅ [${tier.label}] ${provider.name} succeeded.`);
            return result;
          }
          console.warn(`[LLMHelper] ⚠️ [${tier.label}] ${provider.name} returned empty response`);
        } catch (err: any) {
          console.warn(`[LLMHelper] ⚠️ [${tier.label}] ${provider.name} failed: ${err.message}`);

          // Event-driven discovery: trigger on 404 / model-not-found errors
          const errMsg = (err.message || '').toLowerCase();
          if (errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('deprecated')) {
            this.modelVersionManager.onModelError(provider.name).catch(() => { });
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // Local fallback — absolute last resort after all cloud tiers exhausted
    // ──────────────────────────────────────────────────────────────────
    for (const provider of localProviders) {
      try {
        console.log(`[LLMHelper] 🏠 [Local Fallback] Attempting ${provider.name}...`);
        const result = await provider.execute();
        if (result && result.trim().length > 0) {
          console.log(`[LLMHelper] ✅ [Local Fallback] ${provider.name} succeeded.`);
          return result;
        }
      } catch (err: any) {
        console.warn(`[LLMHelper] ⚠️ [Local Fallback] ${provider.name} failed: ${err.message}`);
      }
    }

    throw new Error("All AI providers failed across all 3 tiers and local fallbacks.");
  }



  /**
   * Stream chat response with Groq-first fallback chain for text-only,
   * and Gemini-only for multimodal (images)
   * 
   * TEXT-ONLY FALLBACK CHAIN:
   * 1. Groq (llama-3.3-70b-versatile) - Primary
   * 2. Gemini Flash - 1st fallback
   * 3. Gemini Flash + Pro parallel - 2nd fallback
   * 4. Gemini Flash retries (max 3) - Last resort
   * 
   * MULTIMODAL: Gemini-only (existing logic)
   */
  public async * streamChatWithGemini(message: string, imagePaths?: string[], context?: string, skipSystemPrompt: boolean = false): AsyncGenerator<string, void, unknown> {
    console.log(`[LLMHelper] streamChatWithGemini called messageLength=${message.length} redacted=true`);

    const isMultimodal = !!(imagePaths?.length);
    if (isMultimodal) {
      this.assertCurrentModelSupportsVision();
    }

    // Build single-string messages for Groq/Gemini (which use combined prompts)
    const buildCombinedMessage = (systemPrompt: string) => {
      const finalPrompt = skipSystemPrompt ? systemPrompt : this.injectLanguageInstruction(systemPrompt);
      if (skipSystemPrompt) {
        return context
          ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
          : message;
      }
      return context
        ? `${finalPrompt}\n\nCONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
        : `${finalPrompt}\n\n${message}`;
    };

    // For OpenAI/Claude: separate system prompt + user message (proper API pattern)
    const userContent = context
      ? `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`
      : message;

    const combinedMessages = {
      gemini: buildCombinedMessage(HARD_SYSTEM_PROMPT),
      groq: buildCombinedMessage(GROQ_SYSTEM_PROMPT),
    };

    if (this.useOllama) {
      const response = await this.callOllama(combinedMessages.gemini, imagePaths?.[0]);
      yield response;
      return;
    }

    // ============================================================
    // SMART DYNAMIC FALLBACK: Build provider list using auto-discovered
    // text models from ModelVersionManager.
    // Multimodal requests EXCLUDE Groq (no vision support)
    // Text-only requests can use ALL providers
    // OpenAI/Claude use proper system+user message separation for quality
    // ============================================================
    type ProviderAttempt = { name: string; execute: () => AsyncGenerator<string, void, unknown> };
    const providers: ProviderAttempt[] = [];

    // System prompts for OpenAI/Claude (skipped if skipSystemPrompt)
    const openaiSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(OPENAI_SYSTEM_PROMPT);
    const claudeSystemPrompt = skipSystemPrompt ? undefined : this.injectLanguageInstruction(CLAUDE_SYSTEM_PROMPT);

    // Get auto-discovered text model IDs from ModelVersionManager
    const textOpenAI = this.modelVersionManager.getTextTieredModels(TextModelFamily.OPENAI).tier1;
    const textGeminiFlash = this.modelVersionManager.getTextTieredModels(TextModelFamily.GEMINI_FLASH).tier1;
    const textGeminiPro = this.modelVersionManager.getTextTieredModels(TextModelFamily.GEMINI_PRO).tier1;
    const textClaude = this.modelVersionManager.getTextTieredModels(TextModelFamily.CLAUDE).tier1;
    const textGroq = this.modelVersionManager.getTextTieredModels(TextModelFamily.GROQ).tier1;

    if (isMultimodal) {
      // MULTIMODAL PROVIDER ORDER: [TeamSync] -> OpenAI -> Gemini Flash -> Claude -> Gemini Pro -> Groq Scout 4
      if (this.hasTeamSync()) {
        providers.push({ name: 'TeamSync API', execute: () => this.streamWithTeamSync(userContent, openaiSystemPrompt, imagePaths) });
      }
      if (this.openaiClient) {
        providers.push({ name: `OpenAI (${textOpenAI})`, execute: () => this.streamWithOpenaiMultimodal(userContent, imagePaths!, openaiSystemPrompt, textOpenAI) });
      }
      if (this.client) {
        providers.push({ name: `Gemini Flash (${textGeminiFlash})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, textGeminiFlash, imagePaths) });
      }
      if (this.claudeClient) {
        providers.push({ name: `Claude (${textClaude})`, execute: () => this.streamWithClaudeMultimodal(userContent, imagePaths!, claudeSystemPrompt, textClaude) });
      }
      if (this.client) {
        providers.push({ name: `Gemini Pro (${textGeminiPro})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, textGeminiPro, imagePaths) });
      }
      if (this.groqClient) {
        providers.push({ name: `Groq (meta-llama/llama-4-scout-17b-16e-instruct)`, execute: () => this.streamWithGroqMultimodal(userContent, imagePaths!, openaiSystemPrompt) });
      }
      if (this.bedrockClient && this.bedrockCredentials?.preferredModel) {
        providers.push({ name: `Bedrock (${this.bedrockCredentials.preferredModel})`, execute: () => this.streamWithBedrock(userContent, openaiSystemPrompt, imagePaths, this.bedrockCredentials!.preferredModel) });
      }
    } else {
      // TEXT-ONLY PROVIDER ORDER: [TeamSync] → Groq → OpenAI → Claude → Gemini Flash → Gemini Pro
      if (this.hasTeamSync()) {
        providers.push({ name: 'TeamSync API', execute: () => this.streamWithTeamSync(userContent, openaiSystemPrompt) });
      }
      if (this.groqClient) {
        providers.push({ name: `Groq (${textGroq})`, execute: () => this.streamWithGroq(combinedMessages.groq, textGroq) });
      }
      if (this.openaiClient) {
        providers.push({ name: `OpenAI (${textOpenAI})`, execute: () => this.streamWithOpenai(userContent, openaiSystemPrompt, textOpenAI) });
      }
      if (this.claudeClient) {
        providers.push({ name: `Claude (${textClaude})`, execute: () => this.streamWithClaude(userContent, claudeSystemPrompt, textClaude) });
      }
      if (this.client) {
        providers.push({ name: `Gemini Flash (${textGeminiFlash})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, textGeminiFlash) });
        providers.push({ name: `Gemini Pro (${textGeminiPro})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, textGeminiPro) });
      }
      if (this.bedrockClient && this.bedrockCredentials?.preferredModel) {
        providers.push({ name: `Bedrock (${this.bedrockCredentials.preferredModel})`, execute: () => this.streamWithBedrock(userContent, openaiSystemPrompt, undefined, this.bedrockCredentials!.preferredModel) });
      }
    }

    if (providers.length === 0) {
      yield "No AI providers configured. Please add at least one API key in Settings.";
      return;
    }

    // ============================================================
    // PRIORITIZE USER'S SELECTED PROVIDER
    // Ensure the model the user selected handles the request first
    // before falling back to others.
    // ============================================================
    const currentFamilyLabel = this.currentModelId === 'teamsync' ? 'TeamSync'
      : this.isClaudeModel(this.currentModelId) ? 'Claude'
        : this.isOpenAiModel(this.currentModelId) ? 'OpenAI'
          : this.isGroqModel(this.currentModelId) ? 'Groq'
            : this.isBedrockModel(this.currentModelId) ? 'Bedrock'
              : this.isGeminiModel(this.currentModelId) ? 'Gemini'
                : '';

    if (currentFamilyLabel) {
      providers.sort((a, b) => {
        if (a.name.startsWith(currentFamilyLabel) && !b.name.startsWith(currentFamilyLabel)) return -1;
        if (!a.name.startsWith(currentFamilyLabel) && b.name.startsWith(currentFamilyLabel)) return 1;
        return 0;
      });
    }

    // TeamSync is always first when configured, regardless of which model is selected.
    // The sort above may have displaced it — restore it to position 0.
    if (this.hasTeamSync() && providers[0]?.name !== 'TeamSync API') {
      const idx = providers.findIndex(p => p.name === 'TeamSync API');
      if (idx > 0) {
        const [entry] = providers.splice(idx, 1);
        providers.unshift(entry);
      }
    }

    // ============================================================
    // RELENTLESS RETRY: Try all providers, then retry entire chain
    // with exponential backoff. Max 2 full rotations.
    // ============================================================
    const MAX_FULL_ROTATIONS = 3;

    for (let rotation = 0; rotation < MAX_FULL_ROTATIONS; rotation++) {
      if (rotation > 0) {
        const backoffMs = 1000 * rotation;
        console.log(`[LLMHelper] 🔄 Starting rotation ${rotation + 1}/${MAX_FULL_ROTATIONS} after ${backoffMs}ms backoff...`);
        await this.delay(backoffMs);
      }

      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        try {
          console.log(`[LLMHelper] ${rotation === 0 ? '🚀' : '🔁'} Attempting ${provider.name}...`);
          yield* provider.execute();
          console.log(`[LLMHelper] ✅ ${provider.name} stream completed successfully`);
          return; // SUCCESS — exit immediately
        } catch (err: any) {
          console.warn(`[LLMHelper] ⚠️ ${provider.name} failed: ${err.message}`);
          // Continue to next provider
        }
      }
    }

    // Truly exhausted after all rotations
    console.error(`[LLMHelper] ❌ All providers exhausted after ${MAX_FULL_ROTATIONS} rotations`);
    yield "All AI services are currently unavailable. Please check your API keys and try again.";
  }

  /**
   * Universal Stream Chat - Routes to correct provider based on currentModelId
   */
  public async * streamChat(
    message: string,
    imagePaths?: string[],
    context?: string,
    systemPromptOverride?: string, // Optional override (defaults to HARD_SYSTEM_PROMPT)
    ignoreKnowledgeMode: boolean = false,
	    runtimeOptions?: {
	      skipKnowledgeInjection?: boolean;
	      skipModeInjection?: boolean;
	      skipCustomNotesInjection?: boolean;
	      maxOutputTokens?: number;
	      modelOverride?: string;
	      providerOverride?: string;
	      requestContext?: {
	        requestId?: string | null;
	        actionType?: string;
	      };
	      disableProviderFallbacks?: boolean;
	      signal?: AbortSignal;
	    }
	  ): AsyncGenerator<string, void, unknown> {
	  
	    // Preparation
	    const isMultimodal = !!(imagePaths?.length);
	    const explicitModelOverride = runtimeOptions?.modelOverride?.trim();
	    const routeModelId = explicitModelOverride
	      ? this.normalizeModelId(explicitModelOverride)
	      : this.currentModelId;
	    const routeProvider = runtimeOptions?.providerOverride || this.getProviderForModel(routeModelId);
	    const routeUseOllama = routeProvider === 'ollama' || (!explicitModelOverride && this.useOllama);
	    const routeOllamaModel = routeModelId.startsWith('ollama-')
	      ? routeModelId.replace('ollama-', '')
	      : routeProvider === 'ollama'
	        ? routeModelId
	        : this.ollamaModel;
	    const routeCustomProvider = routeProvider === 'custom'
	      && this.customProvider
	      && [this.customProvider.id, this.customProvider.name].some((id) => this.normalizeModelId(id) === routeModelId)
	        ? this.customProvider
	        : (!explicitModelOverride ? this.customProvider : null);
	    const routeCurlProvider = routeProvider === 'custom'
	      && this.activeCurlProvider
	      && [this.activeCurlProvider.id, this.activeCurlProvider.name].some((id) => this.normalizeModelId(id) === routeModelId)
	        ? this.activeCurlProvider
	        : (!explicitModelOverride && !routeCustomProvider ? this.activeCurlProvider : null);
	    const allowProviderFallbacks = runtimeOptions?.disableProviderFallbacks !== true;
	    const allowGroqFastText = this.groqFastTextMode && !explicitModelOverride;
	    if (isMultimodal && !this.modelSupportsVision(routeModelId)) {
	      throw new Error(formatVisionUnsupportedMessage(routeModelId));
	    }
    let isCodeHeavy = false;
    let hasExplicitSystemPromptOverride = systemPromptOverride !== undefined;
    const skipKnowledgeInjection = ignoreKnowledgeMode || runtimeOptions?.skipKnowledgeInjection === true;
    const skipModeInjection = runtimeOptions?.skipModeInjection === true;
    const skipCustomNotesInjection = runtimeOptions?.skipCustomNotesInjection === true;
    const maxOutputTokens = runtimeOptions?.maxOutputTokens;

    // ============================================================
    // KNOWLEDGE MODE INTERCEPT (Streaming)
    // ============================================================
    if (!skipKnowledgeInjection && this.knowledgeOrchestrator?.isKnowledgeMode()) {
      try {
        // Feed to depth scorer only (not negotiation tracker) — mirrors non-streaming path fix.
        this.knowledgeOrchestrator.feedForDepthScoring(message);

        // Profile intelligence generation guard: snapshot before slow async call
        const knowledgeGenId = this._knowledgeGenId;
        const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);

        // Discard stale result if orchestrator was replaced (session reset) during await
        if (this._knowledgeGenId !== knowledgeGenId) {
          console.log('[LLMHelper] Profile intelligence result discarded — session changed during await (streamChat)');
        } else if (knowledgeResult) {
          // Fix 1: short-circuit for live negotiation coaching — bypass second LLM call
          if (knowledgeResult.liveNegotiationResponse) {
            yield JSON.stringify({ __negotiationCoaching: knowledgeResult.liveNegotiationResponse });
            return;
          }
          // Intro question shortcut — yield generated response directly
          if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
            console.log('[LLMHelper] Knowledge mode (stream): returning generated intro response');
            yield knowledgeResult.introResponse;
            return;
          }
          // P1+P3+P7 fix: Inject profile identity prompt ONLY when profile evidence exists.
          // The KnowledgeOrchestrator already filters irrelevant nodes via relevance threshold (0.55);
          // the old isProfileQuery regex was redundant and dropped valid context silently.
          if (knowledgeResult.systemPromptInjection) {
            const hasProfileEvidence =
              Boolean(knowledgeResult.contextBlock?.trim()) ||
              Boolean(knowledgeResult.directResponse);
            if (hasProfileEvidence) {
              systemPromptOverride = knowledgeResult.systemPromptInjection;
              hasExplicitSystemPromptOverride = true;
              if (knowledgeResult.contextBlock?.trim()) {
                context = context
                  ? `${knowledgeResult.contextBlock}\n\n${context}`
                  : knowledgeResult.contextBlock;
              }
            } else {
              console.log('[LLMHelper] Profile identity prompt suppressed — no context evidence (streamChat)');
            }
          }
        }
      } catch (knowledgeError: any) {
        console.warn('[LLMHelper] Knowledge mode (stream) processing failed, falling back:', knowledgeError.message);
      }
    }

    // ============================================================
    // ACTIVE MODE INJECTION (Context + System Prompt Suffix)
    // TOKEN-OPT: Uses deduped suffixes to avoid sending shared blocks twice.
    //            Skips suffix entirely for General mode (base prompt covers it).
    // ============================================================
    try {
      let modeContextBlock = '';

      if (!skipModeInjection) {
        const { ModesManager } = require('./services/ModesManager');
        const modesMgr = ModesManager.getInstance();
        const { suffix: modeSuffix, templateType: activeTemplateType } = modesMgr.getActiveModeDeduped();
        modeContextBlock = modesMgr.buildActiveModeContextBlock({ includeCustomContext: this.customNotesEnabled });

        if (modeSuffix && activeTemplateType !== 'general') {
          // TOKEN-OPT: Use BASE_SYSTEM_PROMPT + deduped suffix instead of stacking full prompts.
          // This avoids sending CORE_IDENTITY, EXECUTION_CONTRACT, etc. twice.
          const baseForMode = hasExplicitSystemPromptOverride ? (systemPromptOverride ?? '') : BASE_SYSTEM_PROMPT;
          systemPromptOverride = `${baseForMode}\n\n## ACTIVE MODE\n${modeSuffix}`;
          hasExplicitSystemPromptOverride = true;
        }
      }

      const totalText = (context || '') + (modeContextBlock || '');
      const codeChars = (totalText.match(/[{}[\]();=<>"'`:\/\\,\n]/g) || []).length;
      isCodeHeavy = totalText.length > 800 && (codeChars > 500 || (codeChars / totalText.length) > 0.05);

	      const willUseGroq = (!isMultimodal && allowGroqFastText) || this.isGroqModel(routeModelId);

      let COMBINED_CTX_CAP = 12_000;
      if (willUseGroq) {
        if (totalText.length > 12_000) {
          COMBINED_CTX_CAP = 4_500;  // Hard safety ceiling against extreme tokenizer spikes
        } else if (isCodeHeavy) {
          COMBINED_CTX_CAP = 4_500;  // Strict cap for dense tokenizers
        } else {
          COMBINED_CTX_CAP = 9_000; // Safe for normal text with Groq tokenizer variance
        }

        if (process.env.DEBUG_CONTEXT === 'true') {
          console.log('[LLMHelper] Context Density:', {
            length: totalText.length,
            codeChars,
            ratio: (codeChars / totalText.length).toFixed(3),
            isCodeHeavy,
            cap: COMBINED_CTX_CAP
          });
        }
      }

      // Clamp the primary transcript context if it's too large, to leave room for the mode block
      if (context && context.length > COMBINED_CTX_CAP) {
        // Attempt to preserve whole speaker turns instead of cutting mid-sentence
        const parts = context.split(/\n(?=[^\n]{1,40}: )/);
        let out = '';
        for (let i = parts.length - 1; i >= 0; i--) {
          if (parts[i].length > COMBINED_CTX_CAP) {
            out = parts[i].slice(-COMBINED_CTX_CAP);
            break;
          }
          if (out.length + parts[i].length > COMBINED_CTX_CAP) break;
          out = parts[i] + (out ? '\n' + out : '');
        }
        context = '[...transcript truncated]\n' + (out.trim() || context.slice(-COMBINED_CTX_CAP));
        console.warn(`[LLMHelper] Transcript context clamped to ${COMBINED_CTX_CAP} chars (Groq=${willUseGroq}, codeHeavy=${COMBINED_CTX_CAP === 6_000})`);
      }

      if (modeContextBlock) {
        // Guard combined context size: KO block + mode block must not exceed max tokens.
        const existingLen = context?.length ?? 0;
        if (existingLen + modeContextBlock.length > COMBINED_CTX_CAP) {
          const available = Math.max(0, COMBINED_CTX_CAP - existingLen);
          const trimmed = available > 0 ? modeContextBlock.slice(0, available) + '\n[...mode context truncated]' : '';
          console.warn(`[LLMHelper] Combined context exceeded ${COMBINED_CTX_CAP} chars (Groq=${willUseGroq}) — mode context trimmed`);
          if (trimmed) context = context ? `${trimmed}\n\n${context}` : trimmed;
        } else {
          context = context ? `${modeContextBlock}\n\n${context}` : modeContextBlock;
        }
      }

      // Final absolute safety net: ensure no upstream mutations bypass the limits
      if (willUseGroq && context && context.length > COMBINED_CTX_CAP) {
        context = context.slice(-COMBINED_CTX_CAP);
      }
    } catch (_modeErr: any) {
      console.warn('[LLMHelper] ModesManager injection failed (non-fatal):', _modeErr?.message);
    }

    const FINAL_SYSTEM_PROMPT = `
You are a highly capable AI assistant for real-time interview support and technical problem solving.

GOAL:
Provide accurate, concise, and useful answers.

RULES:
- Be direct and avoid unnecessary explanation.
- Focus only on what helps answer the question.
- Do not repeat context unless needed.
- If context is incomplete, make the best logical assumption and answer confidently.
- Always prioritize the user's latest question over background context.
- Answer the USER QUESTION first before considering additional context.
- Keep answers under 120 words unless code is required.
- When code is required, return the smallest complete solution and no more than 2 short notes.

FOR TECHNICAL QUESTIONS:
- Be clear and logically structured.
- Use step-by-step only when necessary.

FOR CODE:
- Preserve exact logic.
- Do not remove important steps.
- Keep explanations minimal.

FOR INTERVIEW RESPONSES:
- Sound natural and confident.
- Avoid filler phrases like "it depends" or "maybe".

CONTEXT:
- Prioritize relevant information.
- Ignore redundancy.

OUTPUT:
Return only the final answer. No meta commentary.
`.trim();

    const CODE_BOOST = `\n\nFocus on preserving exact code logic.\nDo not simplify critical parts.`;
    const VISION_BOOST = `\n\nFocus on accurately interpreting the visual content.\nExtract relevant details and ignore noise.`;

    // ============================================================
    // LIGHTWEIGHT FIRST-REQUEST MODE
    // TOKEN-OPT: If this is a fresh session with no context, no overrides,
    // and no images, use a minimal ~200-token prompt instead of ~5000 tokens.
    // ============================================================
    const isLightweightEligible = !hasExplicitSystemPromptOverride && !context && !isMultimodal && !isCodeHeavy;

    // Determine the system prompt to use
    let universalBase: string;
    if (isLightweightEligible) {
      universalBase = LIGHTWEIGHT_SYSTEM_PROMPT;
      console.log('[LLMHelper] ⚡ Lightweight first-request mode: ~200 tokens instead of ~5000');
    } else {
      universalBase = FINAL_SYSTEM_PROMPT;
      if (isCodeHeavy) {
        universalBase += CODE_BOOST;
      } else if (isMultimodal) {
        universalBase += VISION_BOOST;
      }
    }

    let baseSystemPrompt = hasExplicitSystemPromptOverride ? (systemPromptOverride ?? '') : universalBase;
    if (/system design|architecture_json/i.test(`${baseSystemPrompt}\n${message}\n${context || ''}`)) {
      const compactedBase = compactSystemDesignContracts(baseSystemPrompt);
      if (compactedBase !== baseSystemPrompt) {
        baseSystemPrompt = compactedBase;
        systemPromptOverride = compactedBase;
        hasExplicitSystemPromptOverride = true;
        console.warn('[LLMHelper] Prompt exceeded provider risk threshold — using compact mode.');
      }
    }

    // Custom notes injection — appended after mode suffix, before language gate
    // Order: BASE → MODE SUFFIX → CUSTOM NOTES → language instruction
    const customNotesBlock = (!skipCustomNotesInjection && this.customNotesEnabled && this.customNotes?.trim())
      ? `\n\n<user_context>\n${this.customNotes.trim().slice(0, 1500)}\n</user_context>\nUse this context naturally if relevant. Never quote it verbatim.`
      : '';
    const shouldOmitSystemPrompt = hasExplicitSystemPromptOverride && !baseSystemPrompt.trim() && !customNotesBlock.trim();
    let finalSystemPrompt = shouldOmitSystemPrompt
      ? ''
      : this.injectLanguageInstruction(baseSystemPrompt + customNotesBlock);

    // Helper to build combined user message
    let userContent = context
      ? `USER QUESTION:\n${message}\n\nCONTEXT:\n${context}`
      : message;
    // No string slicing — enforceTokenCap below handles overflow via block-based context drop

    // ============================================================
    // PRE-FLIGHT TOKEN BUDGET (MANDATORY)
    // Enforce hard cap of 9000 tokens across system + user content.
    // Never allow overflow. No fallback bypass.
    // ============================================================
    userContent = enforceTokenCap(finalSystemPrompt, userContent, TOKEN_CAP);
	    if (!isMultimodal && (allowGroqFastText || this.isGroqModel(routeModelId) || routeModelId === 'teamsync')) {
      const compacted = compactGroqTextPayload(finalSystemPrompt, userContent);
      if (compacted.changed) {
        finalSystemPrompt = compacted.systemPrompt;
        userContent = compacted.userContent;
      }
    }
    const preflightTotalTokens = estimateTokens(finalSystemPrompt) + estimateTokens(userContent);
    console.log(`[TokenBudget] Pre-flight: system=${estimateTokens(finalSystemPrompt)} + user=${estimateTokens(userContent)} = ${preflightTotalTokens} tok (cap=${TOKEN_CAP})`);
	    const selectedProvider = this.isGroqModel(routeModelId) || allowGroqFastText
	      ? 'groq'
	      : this.isGeminiModel(routeModelId)
	        ? 'gemini'
	        : routeUseOllama
	          ? 'local'
	          : detectProviderLabel(routeModelId);
    const selectedBudget = selectedProvider === 'groq'
      ? MODEL_BUDGETS.groq_llama_70b
      : selectedProvider === 'local'
        ? MODEL_BUDGETS.local_model
        : MODEL_BUDGETS.gemini_flash;
    const requestSize = estimateModelRequestSize(
      selectedProvider,
	        routeModelId,
      finalSystemPrompt,
      userContent,
      'safeTPM' in selectedBudget ? selectedBudget.safeTPM : selectedBudget.target,
    );
    console.log('[MODEL_REQUEST_SIZE]', requestSize);
    let groqPromptStillOversized = false;
    if (selectedProvider === 'groq' && !isMultimodal && requestSize.exceedsLimit) {
      const compacted = compactGroqPromptForBudget(
        finalSystemPrompt,
        userContent,
	        routeModelId,
        MODEL_BUDGETS.groq_llama_70b.safeTPM,
      );
      finalSystemPrompt = compacted.systemPrompt;
      userContent = compacted.userContent;
      const reducedRequestSize = estimateModelRequestSize(
        'groq',
	        routeModelId,
        finalSystemPrompt,
        userContent,
        MODEL_BUDGETS.groq_llama_70b.safeTPM,
      );
      console.log('[MODEL_REQUEST_SIZE]', reducedRequestSize);
      groqPromptStillOversized = compacted.stillExceeds;
      if (groqPromptStillOversized) {
        console.warn('[LLMHelper] Groq compact prompt still exceeds provider limit; falling back after compact attempt.');
      }
    }

    // GROQ FAST TEXT OVERRIDE (Text-Only)
    // Two paths: local Groq key → call Groq directly; TeamSync API only → send fast_mode:true
    // to the server so it routes to its internal Groq pool (llama-3.3-70b-versatile).
	    if (allowGroqFastText && !isMultimodal && !groqPromptStillOversized) {
	      if (this.groqClient) {
	        console.log(`[LLMHelper] ⚡️ Groq Fast Text Mode Active (Streaming). Routing to local Groq...`);
	        try {
	          const groqFullMessage = `${finalSystemPrompt}\n\n${userContent}`;
	          yield* this.streamWithGroq(groqFullMessage, routeModelId, maxOutputTokens);
	          return;
	        } catch (e: any) {
	          console.warn("[LLMHelper] Groq Fast Text streaming failed, falling back:", e.message);
	          if (!allowProviderFallbacks) throw e;
	        }
	        // Local Groq failed — fall through to TeamSync if available
	      }
      if (this.hasTeamSync()) {
        // streamWithTeamSync → generateWithTeamSync → sends fast_mode:true → server Groq pool
        console.log(`[LLMHelper] ⚡️ Groq Fast Text Mode Active (Streaming). Routing to TeamSync server Groq pool...`);
	        try {
	          yield* this.streamWithTeamSync(userContent, finalSystemPrompt, undefined, maxOutputTokens, allowGroqFastText);
	          return;
	        } catch (e: any) {
	          console.warn("[LLMHelper] TeamSync fast-mode failed, falling back:", e.message);
	          if (!allowProviderFallbacks) throw e;
	        }
	      }
	    }
	  
	    // 1. Ollama Streaming
		    if (routeUseOllama) {
		      console.log(`[PROVIDER_INVOKE] provider=ollama model=${routeOllamaModel}`);
		      yield* this.streamWithOllama(message, context, finalSystemPrompt, imagePaths, routeOllamaModel);
		      return;
		    }
	  
	    // 2a. CustomProvider (switchToCustom path) — full SSE-capable streaming
		    if (routeCustomProvider) {
		      console.log(`[PROVIDER_INVOKE] provider=custom model=${routeCustomProvider.id} name=${routeCustomProvider.name}`);
		      yield* this.streamWithCustom(message, context, imagePaths, finalSystemPrompt);
		      return;
		    }
	  
	    // 2b. Custom Provider Streaming (via cURL - Non-streaming fallback for now)
		    if (routeCurlProvider) {
		      console.log(`[PROVIDER_INVOKE] provider=custom_curl model=${routeCurlProvider.id} name=${routeCurlProvider.name}`);
		      const response = await this.executeCustomProvider(
	        routeCurlProvider.curlCommand,
	        userContent,
	        finalSystemPrompt,
        message,
        context || "",
        imagePaths?.[0]
      );
      yield response;
      return;
    }

    // 3. Cloud Provider Routing

    // Codex CLI (local subprocess — uses OpenAI-compatible system prompts)
    if (this.isCodexCliModel(routeModelId) && this.codexCliConfig.enabled) {
      const codexSystem = hasExplicitSystemPromptOverride ? (systemPromptOverride ?? '') : OPENAI_SYSTEM_PROMPT;
      const finalCodexSystem = this.injectLanguageInstruction(codexSystem);
      console.log(`[PROVIDER_INVOKE] provider=codex model=${routeModelId}`);
      yield* this.streamWithCodexCli(userContent, finalCodexSystem, false, imagePaths);
      return;
    }

    // Bedrock
	    if (this.isBedrockModel(routeModelId) && this.bedrockClient) {
	      const bedrockSystem = hasExplicitSystemPromptOverride ? (systemPromptOverride ?? '') : OPENAI_SYSTEM_PROMPT;
	      const finalBedrockSystem = this.injectLanguageInstruction(bedrockSystem);
	      yield* this.streamWithBedrock(userContent, finalBedrockSystem, imagePaths, routeModelId, maxOutputTokens, runtimeOptions?.signal);
	      return;
	    }
	  
	    // OpenAI
	    if (this.isOpenAiModel(routeModelId) && this.openaiClient) {
	      const openAiSystem = hasExplicitSystemPromptOverride ? (systemPromptOverride ?? '') : OPENAI_SYSTEM_PROMPT;
	      const finalOpenAiSystem = this.injectLanguageInstruction(openAiSystem);
	      if (isMultimodal && imagePaths) {
	        yield* this.streamWithOpenaiMultimodal(userContent, imagePaths, finalOpenAiSystem, routeModelId, maxOutputTokens);
	      } else {
	        yield* this.streamWithOpenai(userContent, finalOpenAiSystem, routeModelId, maxOutputTokens);
	      }
	      return;
	    }
	  
	    // Claude
	    if (this.isClaudeModel(routeModelId) && this.claudeClient) {
	      const claudeSystem = hasExplicitSystemPromptOverride ? (systemPromptOverride ?? '') : CLAUDE_SYSTEM_PROMPT;
	      const finalClaudeSystem = this.injectLanguageInstruction(claudeSystem);
	      if (isMultimodal && imagePaths) {
	        yield* this.streamWithClaudeMultimodal(userContent, imagePaths, finalClaudeSystem, routeModelId, maxOutputTokens);
	      } else {
	        yield* this.streamWithClaude(userContent, finalClaudeSystem, routeModelId, maxOutputTokens);
	      }
	      return;
	    }
	  
	    // Groq (Text + Multimodal)
	    if (this.isGroqModel(routeModelId) && this.groqClient && !groqPromptStillOversized) {
	      if (isMultimodal && imagePaths) {
	        // Route multimodal to Groq Llama 4 Scout (vision-capable)
	        const groqSystem = hasExplicitSystemPromptOverride ? (systemPromptOverride ?? '') : OPENAI_SYSTEM_PROMPT;
	        const finalGroqSystem = this.injectLanguageInstruction(groqSystem);
        yield* this.streamWithGroqMultimodal(userContent, imagePaths, finalGroqSystem, maxOutputTokens);
        return;
      }
	      // Text-only Groq
	      const groqFullMessage = `${finalSystemPrompt}\n\n${userContent}`;
	      try {
	        yield* this.streamWithGroq(groqFullMessage, routeModelId, maxOutputTokens);
	        return;
	      } catch (groqTextErr: any) {
	        console.warn(`[LLMHelper] ⚠️ Groq text-only failed (${groqTextErr.message}), falling through to Gemini...`);
	        if (!allowProviderFallbacks) throw groqTextErr;
	        // Fall through to Gemini routing below
	      }
	    }
	  
	    // 3b. TeamSync API
	    if (routeModelId === 'teamsync') {
      const { CredentialsManager } = require('./services/CredentialsManager');
      const teamsyncKey = CredentialsManager.getInstance().getTeamSyncApiKey();
      if (teamsyncKey) {
        try {
	          yield* this.streamWithTeamSync(userContent, finalSystemPrompt, imagePaths, maxOutputTokens, false);
          return;
	        } catch (err: any) {
	          console.warn('[LLMHelper] TeamSync API failed in streamChat, trying Groq fallback:', err.message);
	          if (!allowProviderFallbacks) throw err;
	          // Try Groq before Gemini — Groq key is more commonly available
          if (this.groqClient) {
            try {
              if (isMultimodal && imagePaths) {
                const groqSystem = hasExplicitSystemPromptOverride ? (systemPromptOverride ?? '') : OPENAI_SYSTEM_PROMPT;
                const finalGroqSystem = this.injectLanguageInstruction(groqSystem);
                yield* this.streamWithGroqMultimodal(userContent, imagePaths, finalGroqSystem, maxOutputTokens);
              } else {
                const groqSystem = hasExplicitSystemPromptOverride ? baseSystemPrompt : universalBase;
                const finalGroqSystem = this.injectLanguageInstruction(groqSystem);
                yield* this.streamWithGroq(`${finalGroqSystem}\n\n${userContent}`, GROQ_MODEL, maxOutputTokens); // intentional: emergency fallback waterfall — use stable GROQ_MODEL baseline, not currentModelId
              }
              return;
	            } catch (groqErr: any) {
	              console.warn('[LLMHelper] Groq fallback also failed, trying Gemini:', groqErr.message);
	              if (!allowProviderFallbacks) throw groqErr;
	            }
	          }
          // Fall through to Gemini
        }
      }
      // No key or all fallbacks failed — fall through to Gemini
    }

	    // 4. Gemini Routing & Fallback
	    if (this.client) {
	      // Direct model use if specified
	      if (this.isGeminiModel(routeModelId)) {
	        const fullMsg = `${finalSystemPrompt}\n\n${userContent}`;
	        yield* this.streamWithGeminiModel(fullMsg, routeModelId, imagePaths, maxOutputTokens);
	        return;
	      }
	      if (!allowProviderFallbacks) {
	        throw new Error(`Provider fallback disabled for requested model ${routeModelId}`);
	      }
	  
	      // Race strategy (default)
      const raceMsg = `${finalSystemPrompt}\n\n${userContent}`;
      yield* this.streamWithGeminiParallelRace(raceMsg, imagePaths);
      return;
    }

    // 5. Last-resort: TeamSync API (if user has a key but no cloud provider configured)
	    if (this.hasTeamSync()) {
	      try {
	        yield* this.streamWithTeamSync(userContent, finalSystemPrompt, imagePaths, maxOutputTokens, allowGroqFastText);
	        return;
	      } catch (e: any) {
	        console.warn('[LLMHelper] TeamSync last-resort fallback failed:', e.message);
	        if (!allowProviderFallbacks) throw e;
	      }
	    }

    throw new Error("No AI provider configured. Please add at least one API key in Settings.");
  }

  public streamStructuredPrompt(
    prompt: { question: string; context?: string; systemPrompt?: string },
    imagePaths?: string[],
	    runtimeOptions?: {
	      ignoreKnowledgeMode?: boolean;
	      skipKnowledgeInjection?: boolean;
	      skipModeInjection?: boolean;
	      skipCustomNotesInjection?: boolean;
	      maxOutputTokens?: number;
	      modelOverride?: string;
	      providerOverride?: string;
	      requestContext?: {
	        requestId?: string | null;
	        actionType?: string;
	      };
	      disableProviderFallbacks?: boolean;
	      signal?: AbortSignal;
	    }
	  ): AsyncGenerator<string, void, unknown> {
    return this.streamChat(
      prompt.question,
      imagePaths,
      prompt.context,
      prompt.systemPrompt,
      runtimeOptions?.ignoreKnowledgeMode ?? true,
      {
	        skipKnowledgeInjection: runtimeOptions?.skipKnowledgeInjection,
	        skipModeInjection: runtimeOptions?.skipModeInjection,
	        skipCustomNotesInjection: runtimeOptions?.skipCustomNotesInjection,
	        maxOutputTokens: runtimeOptions?.maxOutputTokens,
	        modelOverride: runtimeOptions?.modelOverride,
	        providerOverride: runtimeOptions?.providerOverride,
	        requestContext: runtimeOptions?.requestContext,
	        disableProviderFallbacks: runtimeOptions?.disableProviderFallbacks,
	        signal: runtimeOptions?.signal,
	      }
	    );
	  }

  public invoke(args: {
    prompt: { question: string; context?: string; systemPrompt?: string };
    imagePaths?: string[];
    model: string;
    provider: string;
    requestContext?: {
      requestId?: string | null;
      actionType?: string;
    };
    runtimeOptions?: {
      ignoreKnowledgeMode?: boolean;
      skipKnowledgeInjection?: boolean;
      skipModeInjection?: boolean;
      skipCustomNotesInjection?: boolean;
      maxOutputTokens?: number;
      signal?: AbortSignal;
    };
  }): AsyncGenerator<string, void, unknown> {
    return this.streamStructuredPrompt(
      args.prompt,
      args.imagePaths,
      {
        ignoreKnowledgeMode: args.runtimeOptions?.ignoreKnowledgeMode ?? true,
        skipKnowledgeInjection: args.runtimeOptions?.skipKnowledgeInjection,
        skipModeInjection: args.runtimeOptions?.skipModeInjection,
        skipCustomNotesInjection: args.runtimeOptions?.skipCustomNotesInjection,
        maxOutputTokens: args.runtimeOptions?.maxOutputTokens,
        modelOverride: args.model,
        providerOverride: args.provider,
        requestContext: args.requestContext,
        disableProviderFallbacks: true,
        signal: args.runtimeOptions?.signal,
      }
    );
  }

  /**
   * Fake-stream for TeamSync API (non-streaming endpoint).
   * Yields the full response in small word-batches so the UI typing effect still plays.
   * Throws on empty response so the fallback chain tries the next provider.
   */
  private async * streamWithTeamSync(userContent: string, systemPrompt?: string, imagePaths?: string[], maxOutputTokens?: number, fastMode: boolean = this.groqFastTextMode): AsyncGenerator<string, void, unknown> {
    // ── REAL SSE STREAM (replaces the fake word-by-word simulation) ──────────
    // Previous implementation called generateWithTeamSync() (blocking, waited for
    // the full response), then drip-fed words with setTimeout delays — pure theater.
    // This version opens a streaming fetch and yields tokens as the server generates
    // them, cutting time-to-first-token from ~3s to ~80ms.
    let teamsyncKey = this.teamsyncKey;
    if (!teamsyncKey) {
      const { CredentialsManager } = require('./services/CredentialsManager');
      teamsyncKey = CredentialsManager.getInstance().getTeamSyncApiKey() || null;
    }
    if (!teamsyncKey) throw new Error('TeamSync API key not set');

    const body: Record<string, unknown> = {
      messages: [{ role: 'user', content: userContent }],
      stream: true,
    };
    if (maxOutputTokens) body.max_tokens = maxOutputTokens;
    if (fastMode && (!imagePaths || imagePaths.length === 0)) body.fast_mode = true;
    if (systemPrompt) body.system = systemPrompt;
    if (this.aiResponseLanguage && this.aiResponseLanguage !== 'English') {
      body.language = this.aiResponseLanguage; // 'auto' is forwarded — server handles it
    }

    // Attach images — the server routes image requests to the appropriate provider
    if (imagePaths?.length) {
      const images: { mime_type: string; data: string }[] = [];
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          images.push({ mime_type: 'image/png', data: imageData.toString('base64') });
        }
      }
      if (images.length) body.images = images;
    }

    const streamHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'x-teamsync-key': teamsyncKey,
    };

    // 60s timeout covers worst-case: max-token Gemini Pro response streamed over a slow connection.
    // This is intentionally longer than the non-streaming 25s timeout.
    const response = await fetch(TEAMSYNC_CHAT_URL, {
      method: 'POST',
      headers: streamHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}) as Record<string, unknown>);
      throw new Error(`TeamSync API ${response.status}: ${(errData as any).error || 'unknown'}`);
    }

    // Parse the SSE response body incrementally.
    // Protocol: each line starting with "data: " carries a JSON payload.
    //   data: {"delta":"token","model":"llama-3.3-70b"}
    //   data: [DONE]
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop()!;  // last line may be incomplete — carry it to next chunk

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break outer;

          let chunk: any;
          try { chunk = JSON.parse(payload); } catch { continue; }

          if (chunk.error) throw new Error(`Server error: ${chunk.error}`);
          if (typeof chunk.delta === 'string' && chunk.delta) yield chunk.delta;
        }
      }
    } finally {
      try { reader.cancel(); } catch { }  // release the fetch connection cleanly
    }
  }

  /**
   * Stream response from Groq
   */
  private async * streamWithGroq(fullMessage: string, modelId: string = GROQ_MODEL, maxOutputTokens: number = 8192): AsyncGenerator<string, void, unknown> {
    if (!this.groqClient && !this.groqKeyManager.hasAvailableKey()) throw new Error("Groq client not initialized");

    const size = estimateModelRequestSize(
      'groq',
      modelId,
      '',
      fullMessage,
      MODEL_BUDGETS.groq_llama_70b.safeTPM,
    );
    console.log('[MODEL_REQUEST_SIZE]', size);
    let requestMessage = fullMessage;
    if (size.exceedsLimit) {
      const compacted = compactGroqFullMessageForBudget(fullMessage, modelId, MODEL_BUDGETS.groq_llama_70b.safeTPM);
      requestMessage = compacted.fullMessage;
      const reducedSize = estimateModelRequestSize(
        'groq',
        modelId,
        '',
        requestMessage,
        MODEL_BUDGETS.groq_llama_70b.safeTPM,
      );
      console.log('[MODEL_REQUEST_SIZE]', reducedSize);
      if (compacted.stillExceeds) {
        throw new Error('Groq compact prompt still exceeds provider limit.');
      }
    }

    // Streaming Groq call with automatic key rotation
    yield* this.groqRotatingClient.chatCompletionStream({
      model: modelId,
      messages: [{ role: "user", content: requestMessage }],
      stream: true,
      temperature: 0.4,
      max_tokens: maxOutputTokens,
    });
  }

  /**
   * Stream multimodal (image + text) response from Groq using Llama 4 Scout as a last resort
   */
  private async * streamWithGroqMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string, maxOutputTokens: number = 8192): AsyncGenerator<string, void, unknown> {
    if (!this.groqClient && !this.groqKeyManager.hasAvailableKey()) throw new Error("Groq client not initialized");

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    const contentParts: any[] = [{ type: "text", text: userMessage }];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        // Process image: resize to max 1536px + JPEG 80% to stay within Groq's request size limit
        const { mimeType, data } = await this.processImage(p);
        contentParts.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });

    // Streaming multimodal call with automatic key rotation
    yield* this.groqRotatingClient.chatCompletionStream({
	      model: GROQ_VISION_MODEL,
      messages,
      stream: true,
      max_tokens: maxOutputTokens,
      temperature: 1,
      top_p: 1,
      stop: null
    });
  }

  /**
   * Stream response from OpenAI with proper system/user message separation
   */
  private async * streamWithOpenai(userMessage: string, systemPrompt?: string, modelId?: string, maxOutputTokens: number = MAX_OUTPUT_TOKENS): AsyncGenerator<string, void, unknown> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    // Use explicit override, then currentModelId if it's an OpenAI model, else baseline constant
    const model = modelId || (this.isOpenAiModel(this.currentModelId) ? this.currentModelId : OPENAI_MODEL);

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userMessage });

    const stream = await this.openaiClient.chat.completions.create({
      model,
      messages,
      stream: true,
      max_completion_tokens: model.toLowerCase().includes('claude') ? Math.min(maxOutputTokens, CLAUDE_MAX_OUTPUT_TOKENS) : maxOutputTokens,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  public async * streamWithBedrock(userMessage: string, systemPrompt?: string, imagePaths?: string[], modelId?: string, maxOutputTokens?: number, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
    if (!this.bedrockClient) throw new Error("Bedrock client not initialized");
    await this.rateLimiters.bedrock.acquire();
    let model = modelId || this.currentModelId;
    const resolvedMaxTokens = maxOutputTokens || resolveBedrockMaxOutputTokens(model);
    model = await this.resolveBedrockRuntimeModel(imagePaths, model);

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[BEDROCK_RETRY] attempt=${attempt}/${MAX_RETRIES} model=${model}`);
          BedrockTelemetry.recordRetry();
        }
        const streamStart = Date.now();
        console.log('[BEDROCK_ROUTE]', { provider: 'bedrock', model, maxTokens: resolvedMaxTokens, attempt });
        let outputTokenEstimate = 0;
        for await (const chunk of this.bedrockClient.stream(userMessage, {
          modelId: model,
          systemPrompt,
          imagePaths,
          maxOutputTokens: resolvedMaxTokens,
        }, signal)) {
          outputTokenEstimate += Math.ceil(chunk.length / 4);
          yield chunk;
        }
        BedrockTelemetry.recordRequest(Date.now() - streamStart, outputTokenEstimate, false);
        return; // Success — exit retry loop
      } catch (error) {
        const mapped = mapBedrockError(error);

        // Non-retryable or final attempt → throw
        if (!mapped.isRetryable || attempt === MAX_RETRIES) {
          BedrockTelemetry.recordRequest(0, 0, true);
          this.notifyBedrockReauthenticationRequired(error, model);
          throw error;
        }

        // Abort signal fired → don't retry
        if (signal?.aborted) {
          BedrockTelemetry.recordCancel();
          throw error;
        }

        // Exponential backoff: retryAfterMs × 2^attempt (500 → 1000 → 2000)
        const baseDelay = mapped.retryAfterMs || 500;
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[BEDROCK_RETRY] ${mapped.awsExceptionName}: retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        if (mapped.awsExceptionName === 'ThrottlingException' || mapped.httpStatus === 429) {
          BedrockTelemetry.record429();
        }

        // Wait with abort awareness — clean up listener on resolve to prevent leak
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { clearTimeout(timer); reject(new Error('Aborted during retry backoff')); };
          const timer = setTimeout(() => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve();
          }, delay);
          if (signal) {
            if (signal.aborted) { clearTimeout(timer); reject(new Error('Aborted during retry backoff')); return; }
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });

        // Re-acquire rate limiter token before retry
        await this.rateLimiters.bedrock.acquire();
      }
    }
  }

  /**
   * Stream response from Claude with proper system/user message separation
   */
  private async * streamWithClaude(userMessage: string, systemPrompt?: string, modelId?: string, maxOutputTokens: number = CLAUDE_MAX_OUTPUT_TOKENS): AsyncGenerator<string, void, unknown> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    // Use explicit override, then currentModelId if it's a Claude model, else baseline constant
    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);

    const stream = await this.claudeClient.messages.stream({
      model,
      max_tokens: Math.min(maxOutputTokens, CLAUDE_MAX_OUTPUT_TOKENS),
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: userMessage }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  /**
   * Stream multimodal (image + text) response from OpenAI with system/user separation
   */
  private async * streamWithOpenaiMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string, modelId?: string, maxOutputTokens: number = MAX_OUTPUT_TOKENS): AsyncGenerator<string, void, unknown> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");

    // Use explicit override, then currentModelId if it's an OpenAI model, else baseline constant
    const model = modelId || (this.isOpenAiModel(this.currentModelId) ? this.currentModelId : OPENAI_MODEL);

    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    const contentParts: any[] = [{ type: "text", text: userMessage }];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        const imageData = await fs.promises.readFile(p);
        contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${imageData.toString("base64")}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });

    const stream = await this.openaiClient.chat.completions.create({
      model,
      messages,
      stream: true,
      max_completion_tokens: model.toLowerCase().includes('claude') ? Math.min(maxOutputTokens, CLAUDE_MAX_OUTPUT_TOKENS) : maxOutputTokens,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }

  /**
   * Stream multimodal (image + text) response from Claude with system/user separation
   */
  private async * streamWithClaudeMultimodal(userMessage: string, imagePaths: string[], systemPrompt?: string, modelId?: string, maxOutputTokens: number = CLAUDE_MAX_OUTPUT_TOKENS): AsyncGenerator<string, void, unknown> {
    if (!this.claudeClient) throw new Error("Claude client not initialized");

    // Use explicit override, then currentModelId if it's a Claude model, else baseline constant
    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);

    const imageContentParts: any[] = [];
    for (const p of imagePaths) {
      if (fs.existsSync(p)) {
        const imageData = await fs.promises.readFile(p);
        imageContentParts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: imageData.toString("base64")
          }
        });
      }
    }

    const stream = await this.claudeClient.messages.stream({
      model,
      max_tokens: Math.min(maxOutputTokens, CLAUDE_MAX_OUTPUT_TOKENS),
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{
        role: "user",
        content: [
          ...imageContentParts,
          { type: "text", text: userMessage }
        ]
      }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  /**
   * Stream response from a specific Gemini model
   */
  private async * streamWithGeminiModel(fullMessage: string, model: string, imagePaths?: string[], maxOutputTokens: number = MAX_OUTPUT_TOKENS): AsyncGenerator<string, void, unknown> {
    if (!this.client) throw new Error("Gemini client not initialized");

    const contents: any[] = [{ text: fullMessage }];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          contents.push({
            inlineData: {
              mimeType: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }
    }

    const streamResult = await this.client.models.generateContentStream({
      model: model,
      contents: contents,
      config: {
        maxOutputTokens,
        temperature: 0.4,
      }
    });

    // @ts-ignore
    const stream = streamResult.stream || streamResult;

    for await (const chunk of stream) {
      let chunkText = "";
      if (typeof chunk.text === 'function') {
        chunkText = chunk.text();
      } else if (typeof chunk.text === 'string') {
        chunkText = chunk.text;
      } else if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
        chunkText = chunk.candidates[0].content.parts[0].text;
      }
      if (chunkText) {
        yield chunkText;
      }
    }
  }

  /**
   * Race Flash and Pro streams, return whichever succeeds first
   */
  private async * streamWithGeminiParallelRace(fullMessage: string, imagePaths?: string[]): AsyncGenerator<string, void, unknown> {
    if (!this.client) throw new Error("Gemini client not initialized");

    // Start both streams
    const flashPromise = this.collectStreamResponse(fullMessage, GEMINI_FLASH_MODEL, imagePaths);
    const proPromise = this.collectStreamResponse(fullMessage, GEMINI_PRO_MODEL, imagePaths);

    // Race - whoever finishes first wins
    const result = await Promise.any([flashPromise, proPromise]);

    // Yield the collected response character by character to simulate streaming
    // (Or yield in chunks for efficiency)
    const chunkSize = 10;
    for (let i = 0; i < result.length; i += chunkSize) {
      yield result.substring(i, i + chunkSize);
    }
  }

  /**
   * Collect full response from a Gemini model (non-streaming for race)
   */
  private async collectStreamResponse(fullMessage: string, model: string, imagePaths?: string[]): Promise<string> {
    if (!this.client) throw new Error("Gemini client not initialized");

    const contents: any[] = [{ text: fullMessage }];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (fs.existsSync(p)) {
          const imageData = await fs.promises.readFile(p);
          contents.push({
            inlineData: {
              mimeType: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }
    }

    const response = await this.client.models.generateContent({
      model: model,
      contents: contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      }
    });

    return response.text || "";
  }

  // --- OLLAMA STREAMING ---
  private async * streamWithOllama(message: string, context?: string, systemPrompt: string = UNIVERSAL_SYSTEM_PROMPT, imagePaths?: string[], modelOverride?: string): AsyncGenerator<string, void, unknown> {
    const fullPrompt = context
      ? `SYSTEM: ${systemPrompt}\nCONTEXT: ${context}\nUSER: ${message}`
      : `SYSTEM: ${systemPrompt}\nUSER: ${message}`;

    // Build optional images array — Ollama multimodal API accepts raw base64 strings (no data-URL prefix)
    let images: string[] | undefined;
    if (imagePaths?.length) {
      const encoded: string[] = [];
      for (const p of imagePaths) {
        try {
          const data = await fs.promises.readFile(p);
          encoded.push(data.toString("base64"));
        } catch (e) {
          console.warn("[LLMHelper] streamWithOllama: failed to read image, skipping:", p, e);
        }
      }
      if (encoded.length) images = encoded;
    }

    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
	          model: modelOverride || this.ollamaModel,
          prompt: fullPrompt,
          stream: true,
          ...(images ? { images } : {}),
          options: { temperature: 0.7 }
        })
      });

      if (!response.body) throw new Error("No response body from Ollama");

      // iterate over the readable stream
      // @ts-ignore
      for await (const chunk of response.body) {
        const text = new TextDecoder().decode(chunk);
        // Ollama sends JSON objects per line
        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.response) yield json.response;
            if (json.done) return;
          } catch (e) {
            // ignore partial json
          }
        }
      }
    } catch (e) {
      console.error("Ollama streaming failed", e);
      yield "Error: Failed to stream from Ollama.";
    }
  }

  // --- CUSTOM PROVIDER STREAMING ---
  private async * streamWithCustom(message: string, context?: string, imagePaths?: string[], systemPrompt: string = UNIVERSAL_SYSTEM_PROMPT): AsyncGenerator<string, void, unknown> {
    if (!this.customProvider) return;
    // We reuse the executeCustomProvider logic but we need it to stream.
    // If the user provided a curl command, it might support streaming (SSE) or not.
    // If we execute it via Child Process, we can read stdout stream.

    // 1. Prepare command with variables
    // Re-use logic from executeCustomProvider to replace variables
    // But we can't easily reuse the function since it awaits the whole fetch.
    // So we'll implement a simplified streaming version using our existing variable replacer and node-fetch.

    const curlCommand = this.customProvider.curlCommand;
    const requestConfig = curl2Json(curlCommand);

    let base64Image = "";
    if (imagePaths?.length) {
      try {
        // Use the first image for custom providers (they typically only support one)
        const data = await fs.promises.readFile(imagePaths[0]);
        base64Image = data.toString("base64");
      } catch (e) { }
    }

    const combinedMessage = context ? `${context}\n\n${message}` : message;

    const variables = {
      TEXT: combinedMessage,
      PROMPT: combinedMessage,
      SYSTEM_PROMPT: systemPrompt,
      USER_MESSAGE: message,
      CONTEXT: context || "",
      IMAGE_BASE64: base64Image,
    };

    const url = deepVariableReplacer(requestConfig.url, variables);
    const headers = deepVariableReplacer(requestConfig.header || {}, variables);
    let body = deepVariableReplacer(requestConfig.data || {}, variables);

    // Auto-upgrade last user message to multimodal content array when an image is present.
    // No-op for non-OpenAI formats and templates already containing a proper image_url part.
    if (base64Image && imagePaths?.[0]) {
      body = injectImageIntoMessages(body, base64Image, imagePaths[0]);
    }

    const streamAbort = new AbortController();
    const streamTimeout = setTimeout(() => streamAbort.abort(), 30_000);
    try {
      const response = await fetch(url, {
        method: requestConfig.method || 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: streamAbort.signal,
      });
      clearTimeout(streamTimeout);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Custom Provider HTTP ${response.status}: errorLength=${errorText.length} redacted=true`);
        yield `Error: Custom Provider returned HTTP ${response.status}`;
        return;
      }

      if (!response.body) return;

      // Collect all chunks to handle both SSE streaming and non-SSE JSON responses
      let fullBody = "";
      let yieldedAny = false;

      // @ts-ignore
      for await (const chunk of response.body) {
        const text = new TextDecoder().decode(chunk);
        fullBody += text;

        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim().length === 0) continue;

          const items = this.parseStreamLine(line);
          if (items) {
            yield items;
            yieldedAny = true;
          }
        }
      }

      // If no SSE content was yielded, try parsing the full body as JSON
      // This handles non-streaming responses (e.g. Ollama with stream: false)
      // But skip if it looks like SSE data (starts with "data: ")
      if (!yieldedAny && fullBody.trim().length > 0 && !fullBody.trim().startsWith("data: ")) {
        try {
          const data = JSON.parse(fullBody);
          const extracted = this.extractFromCommonFormats(data);
          if (extracted) yield extracted;
        } catch {
          // Not JSON, yield raw text if it's not looking like garbage
          if (fullBody.length < 5000) yield fullBody.trim();
        }
      }

    } catch (e) {
      clearTimeout(streamTimeout);
      console.error("Custom streaming failed", e);
      yield "Error streaming from custom provider.";
    }
  }

  private parseStreamLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // 1. Handle SSE (data: ...)
    if (trimmed.startsWith("data: ")) {
      if (trimmed === "data: [DONE]") return null;
      try {
        const json = JSON.parse(trimmed.substring(6));
        return this.extractFromCommonFormats(json);
      } catch {
        return null;
      }
    }

    // 2. Handle raw JSON chunks (Ollama/Generic)
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const json = JSON.parse(trimmed);
        return this.extractFromCommonFormats(json);
      } catch {
        return null;
      }
    }

    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  public isUsingOllama(): boolean {
    return this.useOllama;
  }

  public async getOllamaModels(): Promise<string[]> {
    const baseUrl = (this.ollamaUrl || "http://127.0.0.1:11434").replace('localhost', '127.0.0.1');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000); // Fast 1s timeout

      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) return [];

      const data = await response.json();
      if (data && data.models) {
        return data.models.map((m: any) => m.name);
      }

      return [];
    } catch (error: any) {
      // Silently catch connection refused/timeout errors. 
      // OllamaManager handles logging the startup status.
      return [];
    }
  }

  public async forceRestartOllama(): Promise<boolean> {
    try {
      console.log("[LLMHelper] Attempting to force restart Ollama...");

      // 1. Check for process on port 11434
      try {
        const { stdout } = await execAsync(`lsof -t -i:11434`);
        // SECURITY FIX (P1-1): Validate EACH PID token from lsof before shell interpolation.
        // lsof -t returns one PID per line when multiple processes are on the port.
        const pids = stdout.trim().split(/\s+/).filter(p => /^\d+$/.test(p));
        for (const pid of pids) {
          console.log(`[LLMHelper] Found blocking PID: ${pid}. Killing...`);
          await execAsync(`kill -9 ${pid}`);
        }
        if (pids.length === 0 && stdout.trim()) {
          console.warn(`[LLMHelper] Unexpected lsof output (no valid PIDs): "${stdout.trim().substring(0, 50)}". Skipping kill.`);
        }
      } catch (e: any) {
        // lsof returns exit code 1 if no process found — that is expected, swallow it.
        // Only surface genuinely unexpected errors.
        if (!e.message?.includes('exit code 1') && e.code !== 1) {
          console.warn('[LLMHelper] lsof error (non-fatal):', e.message);
        }
      }

      // 2. Restart Ollama through the Manager (which handles polling and background spawn)
      // We don't want to use exec('ollama serve') here directly anymore to avoid duplicate tracking
      const { OllamaManager } = require('./services/OllamaManager');
      await OllamaManager.getInstance().init();

      return true;
    } catch (error) {
      console.error("[LLMHelper] Failed to restart Ollama:", error);
      return false;
    }
  }

  public getCurrentProvider(): string {
    if (this.customProvider) return "custom";
    if (this.activeCurlProvider) return "custom";
    if (this.isBedrockModel(this.currentModelId)) return "bedrock";
    return this.useOllama ? "ollama" : this.getProviderForModel(this.currentModelId);
  }

  public getCurrentModel(): string {
    if (this.customProvider) return this.customProvider.name;
    if (this.activeCurlProvider) return this.activeCurlProvider.id;
    return this.useOllama ? this.ollamaModel : this.currentModelId;
  }

  /**
   * Get the Gemini client for mode-specific LLMs
   * Used by AnswerLLM, AssistLLM, FollowUpLLM, RecapLLM
   * RETURNS A PROXY client that handles retries and fallbacks transparently
   */
  public getGeminiClient(): GoogleGenAI | null {
    if (!this.client) return null;
    return this.createRobustClient(this.client);
  }

  /**
   * Get the Groq client for mode-specific LLMs
   */
  public getGroqClient(): Groq | null {
    return this.groqClient;
  }

  /**
   * Check if Groq is available
   */
  public hasGroq(): boolean {
    return this.groqClient !== null;
  }

  public hasGemini(): boolean {
    return this.client !== null;
  }

  /**
   * Get the OpenAI client for mode-specific LLMs
   */
  public getOpenaiClient(): OpenAI | null {
    return this.openaiClient;
  }

  /**
   * Get the Claude client for mode-specific LLMs
   */
  public getClaudeClient(): Anthropic | null {
    return this.claudeClient;
  }

  /**
   * Check if OpenAI is available
   */
  public hasOpenai(): boolean {
    return this.openaiClient !== null;
  }

  /**
   * Check if Claude is available
   */
  public hasClaude(): boolean {
    return this.claudeClient !== null;
  }

  /**
   * Stream with Groq using a specific prompt, with Gemini fallback
   * Used by mode-specific LLMs (RecapLLM, FollowUpLLM, WhatToAnswerLLM)
   * @param groqMessage - Message with Groq-optimized prompt
   * @param geminiMessage - Message with Gemini prompt (for fallback)
   * @param config - Optional temperature and max tokens
   */
  public async * streamWithGroqOrGemini(
    groqMessage: string,
    geminiMessage: string,
    config?: { temperature?: number; maxTokens?: number }
  ): AsyncGenerator<string, void, unknown> {
    const temperature = config?.temperature ?? 0.3;
    const maxTokens = config?.maxTokens ?? 8192;

    // Try Groq first if available (with key rotation)
    if (this.groqClient || this.groqKeyManager.hasAvailableKey()) {
      try {
        console.log(`[LLMHelper] 🚀 Mode-specific Groq stream starting (key rotation enabled)...`);
        yield* this.groqRotatingClient.chatCompletionStream({
          model: GROQ_MODEL,
          messages: [{ role: "user", content: groqMessage }],
          stream: true,
          temperature: temperature,
          max_tokens: maxTokens,
        });
        console.log(`[LLMHelper] ✅ Mode-specific Groq stream completed`);
        return; // Success - done
      } catch (err: any) {
        console.warn(`[LLMHelper] ⚠️ Groq mode-specific failed (all keys exhausted): ${err.message}, falling back to Gemini`);
      }
    }

    // Fallback to Gemini
    if (this.client) {
      console.log(`[LLMHelper] 🔄 Falling back to Gemini for mode-specific request...`);
      yield* this.streamWithGeminiModel(geminiMessage, GEMINI_FLASH_MODEL);
    } else {
      throw new Error("No LLM provider available");
    }
  }

  /**
   * Creates a proxy around the real Gemini client to intercept generation calls
   * and apply robust retry/fallback logic without modifying consumer code.
   */
  private createRobustClient(realClient: GoogleGenAI): GoogleGenAI {
    // We proxy the 'models' property to intercept 'generateContent'
    const modelsProxy = new Proxy(realClient.models, {
      get: (target, prop, receiver) => {
        if (prop === 'generateContent') {
          return async (args: any) => {
            return this.generateWithFallback(realClient, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    // We proxy the client itself to return our modelsProxy
    return new Proxy(realClient, {
      get: (target, prop, receiver) => {
        if (prop === 'models') {
          return modelsProxy;
        }
        return Reflect.get(target, prop, receiver);
      }
    });
  }

  /**
   * ROBUST GENERATION STRATEGY (SPECULATIVE PARALLEL EXECUTION)
   * 1. Attempt with original model (Flash).
   * 2. If it fails/empties:
   *    - IMMEDIATELY launch two requests in parallel:
   *      a) Retry Flash (Attempt 2)
   *      b) Start Pro (Backup)
   * 3. Return whichever finishes successfully first (prioritizing Flash if both fast).
   * 4. If both fail, try Flash one last time (Attempt 3).
   * 5. If that fails, throw error.
   */
  private async generateWithFallback(client: GoogleGenAI, args: any): Promise<any> {
    const originalModel = args.model;

    // Helper to check for valid content
    const isValidResponse = (response: any) => {
      const candidate = response.candidates?.[0];
      if (!candidate) return false;
      // Check for text content
      if (response.text && response.text.trim().length > 0) return true;
      if (candidate.content?.parts?.[0]?.text && candidate.content.parts[0].text.trim().length > 0) return true;
      if (typeof candidate.content === 'string' && candidate.content.trim().length > 0) return true;
      return false;
    };

    // 1. Initial Attempt (Flash)
    try {
      const response = await client.models.generateContent({
        ...args,
        model: originalModel
      });
      if (isValidResponse(response)) return response;
      console.warn(`[LLMHelper] Initial ${originalModel} call returned empty/invalid response.`);
    } catch (error: any) {
      console.warn(`[LLMHelper] Initial ${originalModel} call failed: ${error.message}`);
    }

    console.log(`[LLMHelper] 🚀 Triggering Speculative Parallel Retry (Flash + Pro)...`);

    // 2. Parallel Execution (Retry Flash vs Pro)
    // We create promises for both but treat them carefully
    const flashRetryPromise = (async () => {
      // Small delay before retry to let system settle? No, user said "immediately"
      try {
        const res = await client.models.generateContent({ ...args, model: originalModel });
        if (isValidResponse(res)) return { type: 'flash', res };
        throw new Error("Empty Flash Response");
      } catch (e) { throw e; }
    })();

    const proBackupPromise = (async () => {
      try {
        // Pro might be slower, but it's the robust backup
        const res = await client.models.generateContent({ ...args, model: GEMINI_PRO_MODEL });
        if (isValidResponse(res)) return { type: 'pro', res };
        throw new Error("Empty Pro Response");
      } catch (e) { throw e; }
    })();

    // 3. Race / Fallback Logic
    try {
      // We want Flash if it succeeds, but will accept Pro if Flash fails
      // If Flash finishes first and success -> return Flash
      // If Pro finishes first -> wait for Flash? Or return Pro?
      // User said: "if the gemini 3 flash again fails the gemini 3 pro response can be immediatly displayed"
      // This implies we prioritize Flash's *result*, but if Flash fails, we want Pro.

      // We use Promise.any to get the first *successful* result
      const winner = await Promise.any([flashRetryPromise, proBackupPromise]);
      console.log(`[LLMHelper] Parallel race won by: ${winner.type}`);
      return winner.res;

    } catch (aggregateError) {
      console.warn(`[LLMHelper] Both parallel retry attempts failed.`);
    }

    // 4. Last Resort: Flash Final Retry
    console.log(`[LLMHelper] ⚠️ All parallel attempts failed. Trying Flash one last time...`);
    try {
      return await client.models.generateContent({ ...args, model: originalModel });
    } catch (finalError) {
      console.error(`[LLMHelper] Final retry failed.`);
      throw finalError;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    // Suppress unhandled-rejection if the original promise settles after the timeout wins the race
    promise.catch(() => { });

    return Promise.race([
      promise.then(result => {
        clearTimeout(timeoutHandle!);
        return result;
      }),
      timeoutPromise,
    ]);
  }

  /**
   * Robust Meeting Summary Generation
   * Strategy:
   * 0. Custom / cURL Provider (if user selected one — always takes priority)
   * 1. TeamSync API (if configured)
   * 2. Groq (if context text < 100k tokens approx)
   * 3. Gemini Flash (Retry 2x)
   * 4. Gemini Pro (Retry 5x)
   */
  public async generateMeetingSummary(systemPrompt: string, context: string, groqSystemPrompt?: string): Promise<string> {
    console.log(`[LLMHelper] generateMeetingSummary called. Context length: ${context.length}`);

    // Helper: Estimate tokens (crude approximation: 4 chars = 1 token)
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    const tokenCount = estimateTokens(context);
    console.log(`[LLMHelper] Estimated tokens: ${tokenCount}`);

    // ATTEMPT 0: Custom Provider (highest priority — user explicitly chose this)
    if (this.customProvider || this.activeCurlProvider) {
      try {
        console.log(`[LLMHelper] Attempting custom provider for summary...`);
        // Collect the async generator into a Promise so withTimeout works.
        // ignoreKnowledgeMode=true: meeting summaries must never go through the
        // profile/knowledge intercept — it would corrupt the output.
        const collectChunks = async (): Promise<string> => {
          let result = '';
          for await (const chunk of this.streamChat(`Context:\n${context}`, undefined, undefined, systemPrompt, true)) {
            result += chunk;
          }
          return result;
        };
        const text = await this.withTimeout(collectChunks(), 60000, 'Custom Provider Summary');
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] ✅ Custom provider summary generated successfully.`);
          return this.processResponse(text);
        }
      } catch (e: any) {
        console.warn(`[LLMHelper] ⚠️ Custom provider summary failed: ${e.message}. Falling back...`);
      }
    }

    // ATTEMPT 1: TeamSync API (if configured — first in chain)
    if (this.hasTeamSync()) {
      try {
        console.log(`[LLMHelper] Attempting TeamSync API for summary...`);
        const text = await this.withTimeout(
          this.generateWithTeamSync(`Context:\n${context}`, systemPrompt),
          60000,
          'TeamSync Summary'
        );
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] ✅ TeamSync API summary generated successfully.`);
          return this.processResponse(text);
        }
      } catch (e: any) {
        console.warn(`[LLMHelper] ⚠️ TeamSync API summary failed: ${e.message}. Falling back...`);
      }
    }

    if ((this.groqClient || this.groqKeyManager.hasAvailableKey()) && tokenCount < 100000) {
      console.log(`[LLMHelper] Attempting Groq for summary (key rotation enabled)...`);
      try {
        const groqPrompt = groqSystemPrompt || systemPrompt;
        const response = await this.withTimeout(
          this.groqRotatingClient.chatCompletion({
            model: GROQ_MODEL,
            messages: [
              { role: "system", content: groqPrompt },
              { role: "user", content: `Context:\n${context}` }
            ],
            temperature: 0.3,
            max_tokens: 8192,
          }),
          45000,
          "Groq Summary"
        );

        const text = response.choices[0]?.message?.content || "";
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] ✅ Groq summary generated successfully.`);
          return this.processResponse(text);
        }
      } catch (e: any) {
        console.warn(`[LLMHelper] ⚠️ Groq summary failed (all keys exhausted): ${e.message}. Falling back to Gemini...`);
      }
    } else {
      if (tokenCount >= 100000) {
        console.log(`[LLMHelper] Context too large for Groq (${tokenCount} tokens). Skipping straight to Gemini.`);
      }
    }

    // ATTEMPT 3: Gemini Flash (with 2 retries = 3 attempts total)
    console.log(`[LLMHelper] Attempting Gemini Flash for summary...`);
    const contents = [{ text: `${systemPrompt}\n\nCONTEXT:\n${context}` }];

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = await this.withTimeout(
          this.generateWithFlash(contents),
          45000,
          `Gemini Flash Summary (Attempt ${attempt})`
        );
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] ✅ Gemini Flash summary generated successfully (Attempt ${attempt}).`);
          return this.processResponse(text);
        }
      } catch (e: any) {
        console.warn(`[LLMHelper] ⚠️ Gemini Flash attempt ${attempt}/3 failed: ${e.message}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1000 * attempt)); // Linear backoff
        }
      }
    }

    // ATTEMPT 4: Gemini Pro
    console.log(`[LLMHelper] ⚠️ Flash exhausted. Switching to Gemini Pro for robust retry...`);
    const maxProRetries = 5;

    if (this.client) {
      for (let attempt = 1; attempt <= maxProRetries; attempt++) {
        try {
          console.log(`[LLMHelper] 🔄 Gemini Pro Attempt ${attempt}/${maxProRetries}...`);
          const response = await this.withTimeout(
            // @ts-ignore
            this.client.models.generateContent({
              model: GEMINI_PRO_MODEL,
              contents: contents,
              config: {
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                temperature: 0.3,
              }
            }),
            60000,
            `Gemini Pro Summary (Attempt ${attempt})`
          );
          const text = response.text || "";

          if (text.trim().length > 0) {
            console.log(`[LLMHelper] ✅ Gemini Pro summary generated successfully.`);
            return this.processResponse(text);
          }
        } catch (e: any) {
          console.warn(`[LLMHelper] ⚠️ Gemini Pro attempt ${attempt} failed: ${e.message}`);
          // Aggressive backoff for Pro: 2s, 4s, 8s, 16s, 32s
          const backoff = 2000 * Math.pow(2, attempt - 1);
          console.log(`[LLMHelper] Waiting ${backoff}ms before next retry...`);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    } else {
      console.log(`[LLMHelper] Gemini client not initialized — skipping Gemini Pro.`);
    }

    throw new Error("Failed to generate summary after all fallback attempts.");
  }

  public async switchToOllama(model?: string, url?: string): Promise<void> {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;

    if (model) {
      this.ollamaModel = model;
    } else {
      // Auto-detect first available model
      await this.initializeOllamaModel();
    }

    // console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel} at ${this.ollamaUrl}`);
  }

  public async switchToGemini(apiKey?: string, modelId?: string): Promise<void> {
    if (modelId) {
      this.geminiModel = modelId;
    }

    if (apiKey) {
      this.apiKey = apiKey;
      this.client = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { apiVersion: "v1alpha" }
      });
    } else if (!this.client) {
      throw new Error("No Gemini API key provided and no existing client");
    }

    this.useOllama = false;
    this.customProvider = null;
    // console.log(`[LLMHelper] Switched to Gemini: ${this.geminiModel}`);
  }

  public async switchToCustom(provider: CustomProvider): Promise<void> {
    this.customProvider = provider;
    this.useOllama = false;
    this.client = null;
    this.groqClient = null;
    this.openaiClient = null;
    this.claudeClient = null;
    console.log(`[LLMHelper] Switched to Custom Provider: ${provider.name}`);
  }

  public async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        // Test with a simple prompt
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.client) {
          return { success: false, error: "No Gemini client configured" };
        }
        // Test with a simple prompt using the selected model
        const text = await this.generateContent([{ text: "Hello" }])
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  /**
   * Universal Chat (Non-streaming)
   */
  public async chat(message: string, imagePaths?: string[], context?: string, systemPromptOverride?: string): Promise<string> {
    let fullResponse = "";
    for await (const chunk of this.streamChat(message, imagePaths, context, systemPromptOverride)) {
      fullResponse += chunk;
    }
    return fullResponse;
  }

}
