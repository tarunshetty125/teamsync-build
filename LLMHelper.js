var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var LLMHelper_exports = {};
__export(LLMHelper_exports, {
  LLMHelper: () => LLMHelper,
  isBedrockReauthenticationError: () => isBedrockReauthenticationError
});
module.exports = __toCommonJS(LLMHelper_exports);
var import_genai = require("@google/genai");
var import_groq_sdk = __toESM(require("groq-sdk"));
var import_GroqKeyManager = require("./services/GroqKeyManager");
var import_GroqClient = require("./services/GroqClient");
var import_BedrockClient = require("./services/BedrockClient");
var import_openai = __toESM(require("openai"));
var import_sdk = __toESM(require("@anthropic-ai/sdk"));
var import_fs = __toESM(require("fs"));
var import_sharp = __toESM(require("sharp"));
var import_ModelVersionManager = require("./services/ModelVersionManager");
var import_prompts = require("./llm/prompts");
var import_TokenBudget = require("./llm/TokenBudget");
var import_curlUtils = require("./utils/curlUtils");
var import_curl_to_json = __toESM(require("@bany/curl-to-json"));
var import_BedrockModelIds = require("./llm/BedrockModelIds");
var import_BedrockVisionAdapter = require("./llm/BedrockVisionAdapter");
var import_ModelCapabilities = require("./llm/ModelCapabilities");
var import_child_process = require("child_process");
var import_pythonRuntime = require("./utils/pythonRuntime");
var import_util = require("util");
var import_axios = __toESM(require("axios"));
var import_RateLimiter = require("./services/RateLimiter");
const execAsync = (0, import_util.promisify)(import_child_process.exec);
const GEMINI_FLASH_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const OPENAI_MODEL = "gpt-5.4";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const MAX_OUTPUT_TOKENS = 65536;
const CLAUDE_MAX_OUTPUT_TOKENS = 64e3;
const BEDROCK_MAX_OUTPUT_TOKENS = 4096;
const GROQ_TEXT_REQUEST_CHAR_CAP = 24e3;
const BEDROCK_AUTH_WARNING_DEDUPE_MS = 45e3;
const MODEL_BUDGETS = {
  groq_llama_70b: {
    hardMax: 9e3,
    safeTPM: 7e3,
    target: 5e3
  },
  gemini_flash: {
    hardMax: 24e3,
    target: 12e3
  },
  local_model: {
    hardMax: 12e3,
    target: 7e3
  }
};
const IMAGE_ANALYSIS_PROMPT = `Analyze concisely. Be direct. No markdown formatting. Return plain text only.`;
function compactMiddle(text, maxChars) {
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.58);
  const tailChars = Math.floor(maxChars * 0.32);
  return `${text.slice(0, headChars)}

[...payload truncated for provider size...]

${text.slice(-tailChars)}`;
}
function compactGroqTextPayload(systemPrompt, userContent) {
  const totalChars = systemPrompt.length + userContent.length;
  if (totalChars <= GROQ_TEXT_REQUEST_CHAR_CAP) {
    return { systemPrompt, userContent, changed: false };
  }
  let nextSystemPrompt = systemPrompt;
  let nextUserContent = userContent;
  const contextMarker = "\n\nCONTEXT:\n";
  const contextIndex = nextUserContent.indexOf(contextMarker);
  if (contextIndex > 0) {
    nextUserContent = `${nextUserContent.slice(0, contextIndex)}

[context omitted for Groq request size]`;
  }
  const remainingBudget = Math.max(4e3, GROQ_TEXT_REQUEST_CHAR_CAP - nextSystemPrompt.length);
  nextUserContent = compactMiddle(nextUserContent, remainingBudget);
  if (nextSystemPrompt.length + nextUserContent.length > GROQ_TEXT_REQUEST_CHAR_CAP) {
    const systemBudget = Math.max(5500, GROQ_TEXT_REQUEST_CHAR_CAP - nextUserContent.length);
    nextSystemPrompt = compactMiddle(nextSystemPrompt, systemBudget);
  }
  return { systemPrompt: nextSystemPrompt, userContent: nextUserContent, changed: true };
}
function compactSystemDesignContracts(text) {
  return text.replace(/<architecture_json_contract>[\s\S]*?<\/architecture_json_contract>/gi, [
    "architecture_json format:",
    "{",
    ' diagram: { type: "architecture", direction: "TB", nodes: Node[], edges: Edge[] }',
    "}",
    "Node: id,label,kind,technology,purpose,layer,latency,failureMode",
    "Edge: source,target,label,protocol,latency"
  ].join("\n")).replace(/### 4\. Architecture Diagram[\s\S]*?(?=### 5\.|$)/gi, [
    "### 4. Architecture Diagram",
    "Return exactly one fenced architecture_json block. Never Mermaid.",
    "Schema: { diagram: { type, direction, nodes[], edges[] } }",
    "Node: id,label,kind,technology,purpose,layer,latency,failureMode.",
    "Edge: source,target,label,protocol,latency."
  ].join("\n")).replace(/```architecture_json\n\{"diagram":\{"type":"architecture"[\s\S]*?\n```/g, [
    "```architecture_json",
    '{"diagram":{"type":"architecture","direction":"TB","nodes":[{"id":"client","label":"Client","kind":"client","technology":"","purpose":"","layer":"client","latency":"","failureMode":""}],"edges":[{"source":"client","target":"gateway","label":"","protocol":"","latency":""}]}}',
    "```"
  ].join("\n")).replace(/Example fenced block:[\s\S]*?Use the exact opening fence/g, "Compact schema only:\nUse the exact opening fence").replace(/Use this production-grade shape:[\s\S]*?Allowed node kinds only:/g, [
    "architecture_json compact schema:",
    '{"diagram":{"type":"architecture","direction":"TB","nodes":[{"id":"","label":"","kind":"","technology":"","purpose":"","layer":"","latency":"","failureMode":""}],"edges":[{"source":"","target":"","label":"","protocol":"","latency":""}]}}',
    "Allowed node kinds only:"
  ].join("\n"));
}
function splitContextTokenBuckets(userContent) {
  const context = userContent.split("\n\nCONTEXT:\n")[1] || "";
  const transcript = [
    ...context.matchAll(/(?:transcript|meeting|conversation|interviewer|user):?[\s\S]{0,1800}/gi)
  ].map((match) => match[0]).join("\n");
  const rag = [
    ...context.matchAll(/(?:RAG|MEMORY|PROFILE|KNOWLEDGE|user_context)[\s\S]{0,1800}/gi)
  ].map((match) => match[0]).join("\n");
  return {
    transcriptTokens: (0, import_TokenBudget.estimateTokens)(transcript),
    ragTokens: (0, import_TokenBudget.estimateTokens)(rag)
  };
}
function estimateModelRequestSize(provider, model, systemPrompt, userContent, safeLimit) {
  const multiplier = getProviderTokenSafetyMultiplier(provider, systemPrompt, userContent);
  const providerEstimate = (text) => Math.ceil((0, import_TokenBudget.estimateTokens)(text) * multiplier);
  const { transcriptTokens, ragTokens } = splitContextTokenBuckets(userContent);
  const modeTokens = providerEstimate((systemPrompt.match(/## ACTIVE MODE[\s\S]*/i) || [""])[0]);
  const rulesTokens = providerEstimate((systemPrompt.match(/(?:RULES|OUTPUT|CONTRACT|architecture_json)[\s\S]*/i) || [""])[0]);
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
    exceedsLimit: totalTokens > safeLimit
  };
}
function isSystemDesignGroqPayload(systemPrompt, userContent) {
  return /\bsystem design\b|architecture_json|diagram\.type|nodes\[\]|edges\[\]|MINIMUM 12 nodes/i.test(`${systemPrompt}
${userContent}`);
}
function getProviderTokenSafetyMultiplier(provider, systemPrompt, userContent) {
  if (provider !== "groq") return 1;
  return isSystemDesignGroqPayload(systemPrompt, userContent) ? 2.5 : 1.4;
}
function getEffectiveGroqSafeLimit(systemPrompt, userContent, safeLimit) {
  const multiplier = getProviderTokenSafetyMultiplier("groq", systemPrompt, userContent);
  return Math.max(1800, Math.floor(safeLimit / multiplier));
}
function removeDuplicatePromptLines(text) {
  const seen = /* @__PURE__ */ new Set();
  return text.split("\n").filter((line) => {
    const normalized = line.trim().replace(/\s+/g, " ");
    if (normalized.length < 24) return true;
    if (!/(OUTPUT CONTRACT|CONTEXT PRIORITY|EXECUTION CONTRACT|architecture_json|SYSTEM DESIGN|Return|Every|Never|Always|schema|contract)/i.test(normalized)) {
      return true;
    }
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function compactProfileText(text, maxChars = 600) {
  if (!text.trim()) return "";
  const candidateName = text.match(/\b(?:Candidate|Name)\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const role = text.match(/\b(?:Role|Target role|Title)\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const style = text.match(/\b(?:Style|Tone|Preference)\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const lines = [
    "Candidate:",
    candidateName ? `Name: ${candidateName}` : null,
    role ? `Role: ${role}` : null,
    style ? `Style: ${style}` : "Style: concise, professional"
  ].filter(Boolean).join("\n");
  return candidateName || role || style || lines.length > 0 ? lines.slice(0, maxChars) : compactMiddle(text, maxChars);
}
function compactContextForGroq(context, question, maxChars) {
  if (!context.trim()) return "";
  const normalizedQuestionTerms = new Set(
    question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((term) => term.length >= 4)
  );
  const turns = context.split(/\n|  ·  /).map((line) => line.trim()).filter(Boolean);
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
  const lastRelevantTurns = turns.slice(-2).join("\n").slice(-250);
  const topRelevant = scored.sort((a, b) => b.score - a.score).slice(0, 2).map((item) => item.line).join("\n").slice(0, Math.max(500, maxChars - 700));
  const profileMatch = context.match(/<user_context>[\s\S]*?<\/user_context>|(?:PROFILE|Candidate|Resume|Experience)[\s\S]{0,1200}/i);
  const profile = profileMatch ? compactProfileText(profileMatch[0], 420) : "";
  return [
    lastRelevantTurns ? `rolling_summary:
${lastRelevantTurns}` : "",
    topRelevant ? `relevant_context:
${topRelevant}` : "",
    profile ? `profile:
${profile}` : ""
  ].filter(Boolean).join("\n\n").slice(0, maxChars);
}
function compactGroqUserContent(userContent, systemPrompt, safeLimit) {
  const contextMarker = "\n\nCONTEXT:\n";
  const markerIndex = userContent.indexOf(contextMarker);
  if (markerIndex < 0) {
    const budgetChars = Math.max(1800, (safeLimit - (0, import_TokenBudget.estimateTokens)(systemPrompt) - 400) * 4);
    return compactMiddle(userContent, budgetChars);
  }
  const questionPart = userContent.slice(0, markerIndex).trim();
  const contextPart = userContent.slice(markerIndex + contextMarker.length).trim();
  const question = questionPart.replace(/^USER QUESTION:\s*/i, "").trim();
  const contextBudgetChars = Math.max(1200, (safeLimit - (0, import_TokenBudget.estimateTokens)(systemPrompt) - (0, import_TokenBudget.estimateTokens)(questionPart) - 500) * 4);
  const compactContext = compactContextForGroq(contextPart, question, contextBudgetChars);
  return compactContext ? `${questionPart}

CONTEXT:
${compactContext}` : questionPart;
}
function logGroqPromptReduction(model, originalTokens, reducedTokens, transcriptReduced, ragReduced) {
  const reductionPercent = originalTokens > 0 ? Math.max(0, Math.round((1 - reducedTokens / originalTokens) * 100)) : 0;
  console.log("[GROQ_PROMPT_REDUCTION]", {
    originalTokens,
    reducedTokens,
    reductionPercent,
    transcriptReduced,
    ragReduced,
    compactMode: true,
    provider: "groq",
    model
  });
}
function compactGroqPromptForBudget(systemPrompt, userContent, model, safeLimit) {
  const originalTokens = (0, import_TokenBudget.estimateTokens)(systemPrompt) + (0, import_TokenBudget.estimateTokens)(userContent);
  const effectiveSafeLimit = getEffectiveGroqSafeLimit(systemPrompt, userContent, safeLimit);
  const originalBuckets = splitContextTokenBuckets(userContent);
  let nextSystemPrompt = removeDuplicatePromptLines(compactSystemDesignContracts(systemPrompt));
  nextSystemPrompt = nextSystemPrompt.replace(/<user_context>[\s\S]*?<\/user_context>/gi, (match) => {
    return `<user_context>
${compactProfileText(match, 420)}
</user_context>`;
  });
  let nextUserContent = compactGroqUserContent(userContent, nextSystemPrompt, effectiveSafeLimit);
  let compressedTokens = (0, import_TokenBudget.estimateTokens)(nextSystemPrompt) + (0, import_TokenBudget.estimateTokens)(nextUserContent);
  if (compressedTokens > effectiveSafeLimit) {
    const userBudgetChars = Math.max(1200, (effectiveSafeLimit - (0, import_TokenBudget.estimateTokens)(nextSystemPrompt) - 300) * 4);
    nextUserContent = compactGroqUserContent(nextUserContent, nextSystemPrompt, effectiveSafeLimit);
    if ((0, import_TokenBudget.estimateTokens)(nextSystemPrompt) + (0, import_TokenBudget.estimateTokens)(nextUserContent) > effectiveSafeLimit) {
      nextUserContent = compactMiddle(nextUserContent, userBudgetChars);
    }
    compressedTokens = (0, import_TokenBudget.estimateTokens)(nextSystemPrompt) + (0, import_TokenBudget.estimateTokens)(nextUserContent);
  }
  if (compressedTokens > effectiveSafeLimit) {
    const isSystemDesignPrompt = /system design|architecture_json/i.test(nextSystemPrompt);
    const systemBudgetChars = isSystemDesignPrompt ? 4500 : Math.max(2200, Math.floor(effectiveSafeLimit * 0.42) * 4);
    nextSystemPrompt = compactMiddle(nextSystemPrompt, systemBudgetChars);
    const userBudgetChars = Math.max(1200, (effectiveSafeLimit - (0, import_TokenBudget.estimateTokens)(nextSystemPrompt) - 300) * 4);
    nextUserContent = compactMiddle(nextUserContent, userBudgetChars);
    compressedTokens = (0, import_TokenBudget.estimateTokens)(nextSystemPrompt) + (0, import_TokenBudget.estimateTokens)(nextUserContent);
  }
  const reducedBuckets = splitContextTokenBuckets(nextUserContent);
  logGroqPromptReduction(
    model,
    originalTokens,
    compressedTokens,
    originalBuckets.transcriptTokens > reducedBuckets.transcriptTokens,
    originalBuckets.ragTokens > reducedBuckets.ragTokens
  );
  return {
    systemPrompt: nextSystemPrompt,
    userContent: nextUserContent,
    originalTokens,
    compressedTokens,
    stillExceeds: compressedTokens > effectiveSafeLimit
  };
}
function compactGroqFullMessageForBudget(fullMessage, model, safeLimit) {
  const contextMarker = "\n\nCONTEXT:\n";
  const userQuestionPattern = /\bUSER QUESTION:\s*/i;
  const contextIndex = fullMessage.indexOf(contextMarker);
  const userQuestionIndex = fullMessage.search(userQuestionPattern);
  let systemPrompt = "";
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
      userContent = `${questionPart}

CONTEXT:
${contextPart}`;
    } else {
      userContent = `USER QUESTION:
${contextAndQuestion.slice(-800).trim()}`;
    }
  } else {
    if (userQuestionIndex > 0) {
      systemPrompt = fullMessage.slice(0, userQuestionIndex).trim();
      userContent = fullMessage.slice(userQuestionIndex).trim();
    }
  }
  const compacted = compactGroqPromptForBudget(systemPrompt, userContent, model, safeLimit);
  const nextFullMessage = compacted.systemPrompt ? `${compacted.systemPrompt}

${compacted.userContent}` : compacted.userContent;
  return {
    fullMessage: nextFullMessage,
    originalTokens: compacted.originalTokens,
    compressedTokens: compacted.compressedTokens,
    stillExceeds: compacted.stillExceeds
  };
}
function detectProviderLabel(modelId) {
  if ((0, import_BedrockModelIds.isBedrockModelId)(modelId)) return "bedrock";
  if (modelId.startsWith("gpt-") || modelId.includes("openai")) return "openai";
  if (modelId.startsWith("claude-")) return "claude";
  if (modelId === "teamsync") return "teamsync";
  return "gemini";
}
function isBedrockReauthenticationError(error) {
  const raw = [
    error?.name,
    error?.Code,
    error?.code,
    error?.message,
    error?.Message,
    typeof error === "string" ? error : ""
  ].filter(Boolean).join(" ").toLowerCase();
  return [
    "expiredtoken",
    "expired token",
    "token has expired",
    "credentials expired",
    "session expired",
    "sso session",
    "security token included in the request is expired",
    "security token included in the request is invalid",
    "invalidclienttoken",
    "unrecognizedclient"
  ].some((signal) => raw.includes(signal));
}
class LLMHelper {
  client = null;
  groqClient = null;
  openaiClient = null;
  claudeClient = null;
  apiKey = null;
  groqApiKey = null;
  openaiApiKey = null;
  // ── Groq Key Rotation ──────────────────────────────────────
  groqKeyManager;
  groqRotatingClient;
  claudeApiKey = null;
  useOllama = false;
  ollamaModel = "llama3.2";
  ollamaUrl = "http://localhost:11434";
  ollamaStartedByApp = false;
  geminiModel = GEMINI_FLASH_MODEL;
  customProvider = null;
  activeCurlProvider = null;
  groqFastTextMode = false;
  knowledgeOrchestrator = null;
  // Profile intelligence generation guard — incremented on every setKnowledgeOrchestrator
  // (session reset) so a stale processQuestion() result can be detected and discarded.
  _knowledgeGenId = 0;
  customNotes = "";
  customNotesEnabled = true;
  aiResponseLanguage = "auto";
  sttLanguage = "english-us";
  teamsyncKey = null;
  bedrockCredentials = null;
  lastBedrockAuthWarningAt = 0;
  bedrockClient = null;
  ocrWorker = null;
  ocrWorkerBuffer = "";
  ocrWorkerResolvers = /* @__PURE__ */ new Map();
  ocrWorkerRequestSeq = 0;
  // Rate limiters per provider to prevent 429 errors on free tiers
  rateLimiters;
  // Self-improving model version manager for vision analysis
  modelVersionManager;
  constructor(apiKey, useOllama = false, ollamaModel, ollamaUrl, groqApiKey, openaiApiKey, claudeApiKey) {
    this.useOllama = useOllama;
    this.rateLimiters = (0, import_RateLimiter.createProviderRateLimiters)();
    this.modelVersionManager = new import_ModelVersionManager.ModelVersionManager();
    this.groqKeyManager = import_GroqKeyManager.GroqKeyManager.getInstance();
    this.groqKeyManager.loadFromEnv();
    this.groqRotatingClient = new import_GroqClient.GroqClient(this.groqKeyManager);
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const { SettingsManager } = require("./services/SettingsManager");
      const cm = CredentialsManager.getInstance();
      const sm = SettingsManager.getInstance();
      if (!sm.get("groqVaultMigrated")) {
        const vault2 = cm.getGroqKeyVault();
        if (vault2.length === 0) {
          const envKeys = [];
          for (let i = 1; i <= 10; i++) {
            const raw = process.env[`GROQ_API_KEY_${i}`]?.trim();
            if (raw) envKeys.push(raw);
          }
          const legacy = process.env.GROQ_API_KEY?.trim();
          if (legacy) envKeys.push(legacy);
          const credKey = cm.getGroqApiKey()?.trim();
          if (credKey) envKeys.push(credKey);
          const unique = [...new Set(envKeys)];
          unique.forEach((key) => cm.addGroqVaultKey(key));
          if (unique.length > 0) {
            console.log(`[GroqVault] Migrated ${unique.length} key(s) from .env to vault`);
          }
        }
        sm.set("groqVaultMigrated", true);
      }
      const vault = cm.getGroqKeyVault();
      if (vault.length > 0) {
        this.groqKeyManager.loadFromVault(
          vault.map((k) => ({ key: k.key, enabled: k.enabled }))
        );
      }
    } catch (e) {
      console.warn("[LLMHelper] Groq vault loading deferred:", e.message);
    }
    if (groqApiKey) {
      this.groqApiKey = groqApiKey;
      this.groqClient = new import_groq_sdk.default({ apiKey: groqApiKey });
      this.groqKeyManager.addKey(groqApiKey);
      console.log(`[LLMHelper] Groq client initialized with model: ${GROQ_MODEL}`);
    } else if (this.groqKeyManager.hasAvailableKey()) {
      this.groqClient = this.groqKeyManager.getNextClient()?.client ?? null;
      if (this.groqClient) {
        console.log(`[LLMHelper] Groq client initialized from key rotation pool (${this.groqKeyManager.getPoolSize()} keys)`);
      }
    }
    if (openaiApiKey) {
      this.openaiApiKey = openaiApiKey;
      this.openaiClient = new import_openai.default({ apiKey: openaiApiKey });
      console.log(`[LLMHelper] OpenAI client initialized with model: ${OPENAI_MODEL}`);
    }
    if (claudeApiKey) {
      this.claudeApiKey = claudeApiKey;
      this.claudeClient = new import_sdk.default({ apiKey: claudeApiKey });
      console.log(`[LLMHelper] Claude client initialized with model: ${CLAUDE_MODEL}`);
    }
    if (useOllama) {
      this.ollamaUrl = ollamaUrl || "http://localhost:11434";
      this.ollamaModel = ollamaModel || "gemma:latest";
      this.initializeOllamaModel();
    } else if (apiKey) {
      this.apiKey = apiKey;
      this.client = new import_genai.GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: "v1alpha" }
      });
    } else {
      console.warn("[LLMHelper] No API key provided. Client will be uninitialized until key is set.");
    }
  }
  setApiKey(apiKey) {
    this.apiKey = apiKey;
    this.client = new import_genai.GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" }
    });
    console.log("[LLMHelper] Gemini API Key updated.");
  }
  setGroqApiKey(apiKey) {
    this.groqApiKey = apiKey;
    this.groqClient = new import_groq_sdk.default({ apiKey });
    this.groqKeyManager.setSingleKey(apiKey);
    console.log("[LLMHelper] Groq API Key updated (also registered in rotation pool).");
  }
  /**
   * Reload the Groq key pool from the persistent vault.
   * Called from IPC after vault mutations (add/remove/toggle).
   * Re-reads vault state and syncs the in-memory pool.
   */
  reloadGroqVault() {
    try {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const vault = CredentialsManager.getInstance().getGroqKeyVault();
      this.groqKeyManager.loadFromVault(
        vault.map((k) => ({ key: k.key, enabled: k.enabled }))
      );
      if (!this.groqClient && this.groqKeyManager.hasAvailableKey()) {
        this.groqClient = this.groqKeyManager.getNextClient()?.client ?? null;
      }
    } catch (e) {
      console.error("[LLMHelper] Failed to reload Groq vault:", e.message);
    }
  }
  /** Expose the GroqKeyManager for IPC health/state queries. */
  getGroqKeyManager() {
    return this.groqKeyManager;
  }
  setOpenaiApiKey(apiKey) {
    this.openaiApiKey = apiKey;
    this.openaiClient = new import_openai.default({ apiKey });
    console.log("[LLMHelper] OpenAI API Key updated.");
  }
  setClaudeApiKey(apiKey) {
    this.claudeApiKey = apiKey;
    this.claudeClient = new import_sdk.default({ apiKey });
    console.log("[LLMHelper] Claude API Key updated.");
  }
  setTeamSyncKey(key) {
    this.teamsyncKey = key || null;
    console.log(`[LLMHelper] TeamSync key ${key ? "set" : "cleared"}`);
  }
  setBedrockCredentials(credentials) {
    this.bedrockCredentials = credentials;
    this.bedrockClient = credentials ? new import_BedrockClient.BedrockClient(credentials) : null;
    console.log("[LLMHelper] Bedrock credentials updated", {
      authMode: credentials?.authMode,
      region: credentials?.region,
      configured: !!credentials
    });
  }
  notifyBedrockReauthenticationRequired(error, model) {
    if (!isBedrockReauthenticationError(error)) return;
    const now = Date.now();
    if (now - this.lastBedrockAuthWarningAt < BEDROCK_AUTH_WARNING_DEDUPE_MS) return;
    this.lastBedrockAuthWarningAt = now;
    const normalizedError = import_BedrockClient.BedrockClient.normalizeError(error);
    console.warn("[LLMHelper] Bedrock credentials need re-authentication before fallback:", normalizedError);
    try {
      const { BrowserWindow } = require("electron");
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("bedrock:reauthentication-required", {
            title: "AWS session expired",
            message: "Re-authenticate AWS Bedrock to keep using the selected model. TeamSync will try the configured fallback provider for this response.",
            authMode: this.bedrockCredentials?.authMode,
            region: this.bedrockCredentials?.region,
            model: model || this.bedrockCredentials?.preferredModel || this.currentModelId,
            error: normalizedError
          });
        }
      });
    } catch {
    }
  }
  hasTeamSync() {
    return !!this.teamsyncKey;
  }
  hasTeamSyncApi() {
    return this.hasTeamSync();
  }
  hasBedrock() {
    return !!this.bedrockClient;
  }
  /**
   * Initialize the self-improving model version manager.
   * Should be called after all API keys are configured.
   * Triggers initial model discovery and starts background scheduler.
   */
  async initModelVersionManager() {
    this.modelVersionManager.setApiKeys({
      openai: this.openaiApiKey,
      gemini: this.apiKey,
      claude: this.claudeApiKey,
      groq: this.groqApiKey
    });
    await this.modelVersionManager.initialize();
    console.log(this.modelVersionManager.getSummary());
  }
  /**
   * Scrub all API keys from memory to minimize exposure window.
   * Called on app quit.
   */
  scrubKeys() {
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
    if (this.rateLimiters) {
      Object.values(this.rateLimiters).forEach((rl) => rl.destroy());
    }
    this.groqKeyManager.destroy();
    this.modelVersionManager.stopScheduler();
    console.log("[LLMHelper] Keys scrubbed from memory");
  }
  setGroqFastTextMode(enabled) {
    this.groqFastTextMode = enabled;
    console.log(`[LLMHelper] Groq Fast Text Mode: ${enabled}`);
  }
  getGroqFastTextMode() {
    return this.groqFastTextMode;
  }
  getAiResponseLanguage() {
    return this.aiResponseLanguage;
  }
  // --- Model Type Checkers ---
  isOpenAiModel(modelId) {
    if (this.isBedrockModel(modelId)) return false;
    return modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-") || modelId.includes("openai");
  }
  isClaudeModel(modelId) {
    return modelId.startsWith("claude-");
  }
  isGroqModel(modelId) {
    return modelId.startsWith("llama-") || modelId.startsWith("mixtral-") || modelId.startsWith("gemma-") || modelId.startsWith("meta-llama/") || modelId.startsWith("qwen/") || modelId.startsWith("qwen-");
  }
  isGeminiModel(modelId) {
    return modelId.startsWith("gemini-") || modelId.startsWith("models/");
  }
  isBedrockModel(modelId) {
    return (0, import_BedrockModelIds.isBedrockModelId)(modelId, this.bedrockCredentials?.preferredModel);
  }
  normalizeModelId(modelId) {
    if (modelId === "gemini") return GEMINI_FLASH_MODEL;
    if (modelId === "gemini-pro") return GEMINI_PRO_MODEL;
    if (modelId === "claude") return CLAUDE_MODEL;
    if (modelId === "llama") return GROQ_MODEL;
    return modelId;
  }
  getProviderForModel(modelId) {
    const normalized = this.normalizeModelId(modelId);
    if (normalized.startsWith("ollama-") || this.useOllama && normalized === this.normalizeModelId(this.ollamaModel)) return "ollama";
    if (this.isBedrockModel(normalized)) return "bedrock";
    if (this.isOpenAiModel(normalized)) return "openai";
    if (this.isClaudeModel(normalized)) return "claude";
    if (this.isGroqModel(normalized)) return "groq";
    if (this.isGeminiModel(normalized)) return "gemini";
    if (this.customProvider && (this.customProvider.name === modelId || this.customProvider.id === modelId)) return "custom";
    if (this.activeCurlProvider && (this.activeCurlProvider.name === modelId || this.activeCurlProvider.id === modelId)) return "custom";
    if (normalized === "teamsync") return "teamsync";
    return detectProviderLabel(normalized);
  }
  makeRouteDecision(route) {
    const frozen = Object.freeze({ ...route });
    console.log(`[ROUTE_DECISION] requestedProvider=${frozen.requestedProvider} requestedModel=${frozen.requestedModel} actualProvider=${frozen.actualProvider} actualModel=${frozen.actualModel} reason=${frozen.reason}`);
    return frozen;
  }
  modelSupportsVision(modelId) {
    return (0, import_ModelCapabilities.getModelCapabilities)(this.normalizeModelId(modelId)).vision;
  }
  async resolveRoutingDecision(args) {
    const requestedModel = this.normalizeModelId(args.requestedModel);
    const requestedProvider = this.getProviderForModel(requestedModel);
    const hasImages = Boolean(args.imagePaths?.length);
    if (!hasImages || this.modelSupportsVision(requestedModel)) {
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: requestedModel,
        actualProvider: requestedProvider,
        reason: "requested_model"
      });
    }
    if (this.isBedrockModel(requestedModel) && this.bedrockClient) {
      const route = await (0, import_BedrockVisionAdapter.resolveBedrockRuntimeRoute)({
        client: this.bedrockClient,
        requestedModel,
        preferredModel: this.bedrockCredentials?.preferredModel,
        imagePaths: args.imagePaths
      });
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: route.modelId,
        actualProvider: "bedrock",
        reason: route.modelId === requestedModel ? "requested_bedrock_vision_model" : "vision_required_model_remap"
      });
    }
    if (this.isGroqModel(requestedModel) && this.groqClient) {
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: GROQ_VISION_MODEL,
        actualProvider: "groq",
        reason: "vision_required_model_remap"
      });
    }
    if (this.claudeClient) {
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: CLAUDE_MODEL,
        actualProvider: "claude",
        reason: "vision_required_provider_remap"
      });
    }
    if (this.openaiClient && this.modelSupportsVision(OPENAI_MODEL)) {
      return this.makeRouteDecision({
        requestedModel,
        requestedProvider,
        actualModel: OPENAI_MODEL,
        actualProvider: "openai",
        reason: "vision_required_provider_remap"
      });
    }
    throw new Error((0, import_ModelCapabilities.formatVisionUnsupportedMessage)(requestedModel));
  }
  getCurrentModelCapabilities() {
    return (0, import_ModelCapabilities.getModelCapabilities)(this.getCurrentModel());
  }
  currentModelSupportsVision() {
    return this.getCurrentModelCapabilities().vision;
  }
  getVisionUnsupportedMessage() {
    return (0, import_ModelCapabilities.formatVisionUnsupportedMessage)(this.getCurrentModel());
  }
  assertCurrentModelSupportsVision() {
    if (!this.currentModelSupportsVision()) {
      throw new Error(this.getVisionUnsupportedMessage());
    }
  }
  // ---------------------------
  currentModelId = GEMINI_FLASH_MODEL;
  setModel(modelId, customProviders = []) {
    let targetModelId = this.normalizeModelId(modelId);
    if (targetModelId.startsWith("ollama-")) {
      this.useOllama = true;
      this.ollamaModel = targetModelId.replace("ollama-", "");
      this.customProvider = null;
      this.activeCurlProvider = null;
      console.log(`[LLMHelper] Switched to Ollama: ${this.ollamaModel}`);
      return;
    }
    const custom = customProviders.find((p) => p.id === targetModelId);
    if (custom) {
      this.useOllama = false;
      this.customProvider = custom;
      this.activeCurlProvider = null;
      console.log(`[LLMHelper] Switched to Custom Provider: ${custom.name}`);
      return;
    }
    this.useOllama = false;
    this.customProvider = null;
    this.currentModelId = targetModelId;
    if (targetModelId === GEMINI_PRO_MODEL) this.geminiModel = GEMINI_PRO_MODEL;
    if (targetModelId === GEMINI_FLASH_MODEL) this.geminiModel = GEMINI_FLASH_MODEL;
    console.log(`[LLMHelper] Switched to Cloud Model: ${targetModelId}`);
  }
  switchToCurl(provider) {
    this.useOllama = false;
    this.customProvider = null;
    this.activeCurlProvider = provider;
    console.log(`[LLMHelper] Switched to cURL provider: ${provider.name}`);
  }
  cleanJsonResponse(text) {
    text = text.replace(/^```(?:json)?\n/, "").replace(/\n```$/, "");
    text = text.trim();
    return text;
  }
  async callOllama(prompt, imagePath) {
    try {
      let images;
      if (imagePath) {
        try {
          const imageData = await import_fs.default.promises.readFile(imagePath);
          images = [imageData.toString("base64")];
        } catch (e) {
          console.warn("[LLMHelper] callOllama: failed to read image, sending text only:", e);
        }
      }
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.ollamaModel,
          prompt,
          stream: false,
          ...images ? { images } : {},
          options: {
            temperature: 0.7,
            top_p: 0.9
          }
        })
      });
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return data.response;
    } catch (error) {
      throw new Error(`Failed to connect to Ollama: ${error.message}. Make sure Ollama is running on ${this.ollamaUrl}`);
    }
  }
  async checkOllamaAvailable() {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
  async initializeOllamaModel() {
    try {
      const availableModels = await this.getOllamaModels();
      if (availableModels.length === 0) {
        return;
      }
      if (!availableModels.includes(this.ollamaModel)) {
        this.ollamaModel = availableModels[0];
      }
      await this.callOllama("Hello");
    } catch (error) {
      try {
        const models = await this.getOllamaModels();
        if (models.length > 0) {
          this.ollamaModel = models[0];
        }
      } catch (fallbackError) {
      }
    }
  }
  /**
   * Generate content using Gemini 3 Flash (text reasoning)
   * Used by IntelligenceManager for mode-specific prompts
   * NOTE: Migrated from Pro to Flash for consistency
   */
  async generateWithPro(contents) {
    if (!this.client) throw new Error("Gemini client not initialized");
    await this.rateLimiters.gemini.acquire();
    const response = await this.client.models.generateContent({
      model: GEMINI_PRO_MODEL,
      contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3
        // Lower = faster, more focused
      }
    });
    return response.text || "";
  }
  /**
   * Generate content using Gemini 3 Flash (audio + fast multimodal)
   * CRITICAL: Audio input MUST use this model, not Pro
   */
  async generateWithFlash(contents) {
    if (!this.client) throw new Error("Gemini client not initialized");
    await this.rateLimiters.gemini.acquire();
    const response = await this.client.models.generateContent({
      model: GEMINI_FLASH_MODEL,
      contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3
        // Lower = faster, more focused
      }
    });
    return response.text || "";
  }
  /**
   * Post-process the response
   * NOTE: Truncation/clamping removed - response length is handled in prompts
   */
  processResponse(text) {
    let clean = this.cleanJsonResponse(text);
    const fallbackPhrases = [
      "I'm not sure",
      "It depends",
      "I can't answer",
      "I don't know"
    ];
    if (fallbackPhrases.some((phrase) => clean.toLowerCase().includes(phrase.toLowerCase()))) {
      throw new Error("Filtered fallback response");
    }
    return clean;
  }
  /**
   * Retry logic with exponential backoff
   * Specifically handles 503 Service Unavailable
   */
  async withRetry(fn, retries = 3) {
    let delay = 400;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (e) {
        const msg = e.message || "";
        const status = e.status ?? e.statusCode ?? 0;
        const isRetryable = msg.includes("503") || msg.includes("overloaded") || status === 529 || status === 429 || status === 500 || msg.includes("rate_limit") || msg.includes("rate limit");
        if (!isRetryable) throw e;
        console.warn(`[LLMHelper] Transient error (${status || msg.slice(0, 40)}). Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw new Error("Model busy, try again");
  }
  /**
   * Generate content using the currently selected model
   */
  async generateContent(contents, modelIdOverride) {
    if (!this.client) throw new Error("Gemini client not initialized");
    const targetModel = modelIdOverride || this.geminiModel;
    console.log(`[LLMHelper] Calling ${targetModel}...`);
    return this.withRetry(async () => {
      const response = await this.client.models.generateContent({
        model: targetModel,
        contents,
        config: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.4
        }
      });
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
      let text = "";
      if (response.text) {
        text = response.text;
      } else if (candidate.content?.parts) {
        const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [candidate.content.parts];
        for (const part of parts) {
          if (part?.text) {
            text += part.text;
          }
        }
      } else if (typeof candidate.content === "string") {
        text = candidate.content;
      }
      if (!text || text.trim().length === 0) {
        console.error("[LLMHelper] Candidate found but text is empty.");
        console.error("[LLMHelper] Response structure:", JSON.stringify({
          hasResponseText: !!response.text,
          candidateFinishReason: candidate.finishReason,
          candidateContent: candidate.content,
          candidateParts: candidate.content?.parts
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
  async extractProblemFromImages(imagePaths) {
    try {
      const prompt = `You are a wingman. Please analyze these images and extract the following information in JSON format:
{
  "problem_statement": "A clear statement of the problem or situation depicted in the images.",
  "context": "Relevant background or context from the images.",
  "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
  "reasoning": "Explanation of why these suggestions are appropriate."
}
Important: Return ONLY the JSON object, without any markdown formatting or code blocks.`;
      const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt, imagePaths);
      return JSON.parse(this.cleanJsonResponse(text));
    } catch (error) {
      throw error;
    }
  }
  async generateSolution(problemInfo) {
    const prompt = `Given this problem or situation:
${JSON.stringify(problemInfo, null, 2)}

Please provide your response in the following JSON format:
{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}
Important: Return ONLY the JSON object, without any markdown formatting or code blocks.`;
    try {
      const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt);
      const parsed = JSON.parse(this.cleanJsonResponse(text));
      return parsed;
    } catch (error) {
      throw error;
    }
  }
  /**
   * Generate a structured 4-phase "Rolling Interview Script" from screenshot(s).
   * Returns a typed Solution with: problem_identifier_script, brainstorm_script,
   * code, dry_run_script, time_complexity, space_complexity.
   */
  async generateRollingScript(imagePaths) {
    const systemPrompt = `You are an elite FAANG Senior Software Engineer taking a live technical interview.
The user has provided a screenshot of a coding problem. You must generate a highly structured "Rolling Interview Script" that the candidate can read out loud to pass the interview perfectly.

Output EXACTLY this JSON structure, and nothing else (no markdown fences around the whole response):
{
  "problem_identifier_script": "1-2 conversational sentences confirming you understand the problem and its edge cases. Start with 'So just to make sure I understand...'",
  "brainstorm_script": "3-4 conversational sentences. First, mention a naive/brute-force approach and its complexity. Then, pivot to the optimal approach, mentioning the key data structure or algorithm. End by asking the interviewer if you can proceed with the optimal approach. Keep it natural.",
  "code": "The full, production-ready, heavily-commented optimal code solution in the language shown or Python if unclear. Include all necessary imports.",
  "dry_run_script": "2-3 conversational sentences doing a quick dry-run of the code with a simple example input. E.g., 'Let\\'s trace this. If our array is [1,2], the loop starts...'",
  "time_complexity": "O(...) \u2014 brief 5-word explanation",
  "space_complexity": "O(...) \u2014 brief 5-word explanation"
}

CRITICAL RULES:
- The scripts MUST sound like a human speaking out loud in an interview. Use "I", "we", "my first thought is".
- The JSON must be perfectly valid. Escape any internal quotes with backslash.
- Do NOT wrap the JSON in markdown fences.`;
    const userPrompt = `Please analyze the coding problem shown in the screenshot(s) and generate the Rolling Interview Script JSON.`;
    try {
      const raw = await this.generateWithVisionFallback(systemPrompt, userPrompt, imagePaths);
      const cleaned = this.cleanJsonResponse(raw);
      try {
        return JSON.parse(cleaned);
      } catch (_) {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error("Could not extract valid JSON from LLM response");
      }
    } catch (error) {
      throw error;
    }
  }
  async debugSolutionWithImages(problemInfo, currentCode, debugImagePaths) {
    try {
      const prompt = `You are a wingman. Given:
1. The original problem or situation: ${JSON.stringify(problemInfo, null, 2)}
2. The current response or approach: ${currentCode}
3. The debug information in the provided images

Please analyze the debug information and provide feedback in this JSON format:
{
  "solution": {
    "code": "The code or main answer here.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["First possible answer or action", "Second possible answer or action", "..."],
    "reasoning": "Explanation of why these suggestions are appropriate."
  }
}
Important: Return ONLY the JSON object, without any markdown formatting or code blocks.`;
      const text = await this.generateWithVisionFallback(IMAGE_ANALYSIS_PROMPT, prompt, debugImagePaths);
      const parsed = JSON.parse(this.cleanJsonResponse(text));
      return parsed;
    } catch (error) {
      throw error;
    }
  }
  /**
   * NEW: Helper to process image: resize to max 1536px and compress to JPEG 80%
   * drastically reduces token usage and upload time.
   */
  async processImage(path2) {
    try {
      const imageBuffer = await import_fs.default.promises.readFile(path2);
      const processedBuffer = await (0, import_sharp.default)(imageBuffer).resize({
        width: 1536,
        height: 1536,
        fit: "inside",
        // Maintain aspect ratio, max dimension 1536
        withoutEnlargement: true
      }).jpeg({ quality: 80 }).toBuffer();
      return {
        mimeType: "image/jpeg",
        data: processedBuffer.toString("base64")
      };
    } catch (error) {
      console.error("[LLMHelper] Failed to process image with sharp:", error);
      const data = await import_fs.default.promises.readFile(path2);
      return {
        mimeType: "image/png",
        data: data.toString("base64")
      };
    }
  }
  async analyzeImageFiles(imagePaths) {
    try {
      const prompt = `Describe the content of ${imagePaths.length > 1 ? "these images" : "this image"} in a short, concise answer. If it contains code or a problem, solve it.`;
      const text = await this.generateWithVisionFallback(import_prompts.HARD_SYSTEM_PROMPT, prompt, imagePaths);
      return { text, timestamp: Date.now() };
    } catch (error) {
      console.error("Error analyzing image files:", error);
      return {
        text: `I couldn't analyze the screen right now (${error.message}). Please try again.`,
        timestamp: Date.now()
      };
    }
  }
  /**
   * Extract visible on-screen text and layout cues from screenshots.
   * This is intentionally stateless: no transcript, no knowledge mode, no RAG.
   */
  async extractScreenText(imagePaths) {
    if (!imagePaths?.length) return "";
    const Tesseract = require("tesseract.js");
    try {
      const texts = await Promise.all(
        imagePaths.map(async (imagePath) => {
          const result = await Tesseract.recognize(imagePath, "eng", {
            logger: () => void 0
          });
          return result?.data?.text ?? "";
        })
      );
      return texts.join("\n");
    } catch (error) {
      console.warn("[LLMHelper] Screen text extraction failed:", error?.message || error);
      return "";
    }
  }
  isLowQualityScreenText(text) {
    if (!text) return true;
    const cleaned = text.trim();
    if (cleaned.length < 80) return true;
    const lines = cleaned.split("\n").length;
    const hasCode = /(function|const|let|class|=>)/.test(cleaned);
    const weirdChars = (cleaned.match(/[^a-zA-Z0-9\s\n\{\}\(\);\.\,\:\<\>\=\+\-\*\/]/g) || []).length;
    if (weirdChars > cleaned.length * 0.15) return true;
    if (lines < 3 && !hasCode) return true;
    return false;
  }
  initOCRWorker() {
    if (this.ocrWorker) return;
    const pythonPath = (0, import_pythonRuntime.getPythonPath)();
    const scriptPath = (0, import_pythonRuntime.getOCRScriptPath)();
    this.ocrWorker = (0, import_child_process.spawn)(pythonPath, [scriptPath], {
      env: (0, import_pythonRuntime.getPythonEnv)(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.ocrWorker.stderr.on("data", (data) => {
      console.warn("[OCR Worker stderr]", data.toString().trim());
    });
    this.ocrWorker.stdout.on("data", (data) => {
      this.ocrWorkerBuffer += data.toString();
      let newlineIndex = this.ocrWorkerBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = this.ocrWorkerBuffer.slice(0, newlineIndex);
        this.ocrWorkerBuffer = this.ocrWorkerBuffer.slice(newlineIndex + 1);
        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch {
        }
        const workerRequestId = typeof parsed?.id === "string" ? parsed.id : "";
        if (!workerRequestId || !this.ocrWorkerResolvers.has(workerRequestId)) {
          continue;
        }
        const resolve = workerRequestId ? this.ocrWorkerResolvers.get(workerRequestId) : void 0;
        if (workerRequestId) this.ocrWorkerResolvers.delete(workerRequestId);
        if (resolve) resolve(typeof parsed?.text === "string" ? parsed.text : "");
        newlineIndex = this.ocrWorkerBuffer.indexOf("\n");
      }
    });
    this.ocrWorker.on("exit", () => {
      this.ocrWorker = null;
      this.ocrWorkerBuffer = "";
      for (const resolve of this.ocrWorkerResolvers.values()) resolve("");
      this.ocrWorkerResolvers.clear();
    });
  }
  runOCRWorker(imagePaths) {
    return new Promise((resolve) => {
      this.initOCRWorker();
      if (!this.ocrWorker?.stdin) {
        resolve("");
        return;
      }
      const workerRequestId = String(++this.ocrWorkerRequestSeq);
      let settled = false;
      let timeoutId = null;
      const wrappedResolve = (value) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve(value);
      };
      timeoutId = setTimeout(() => {
        this.ocrWorkerResolvers.delete(workerRequestId);
        wrappedResolve("");
      }, 3e3);
      this.ocrWorkerResolvers.set(workerRequestId, wrappedResolve);
      if (this.ocrWorkerResolvers.size > 200) {
        for (const [, pendingResolve] of this.ocrWorkerResolvers) {
          pendingResolve("");
        }
        this.ocrWorkerResolvers.clear();
      }
      try {
        const payload = JSON.stringify({ id: workerRequestId, imagePaths }) + "\n";
        this.ocrWorker.stdin.write(payload);
      } catch {
        this.ocrWorkerResolvers.delete(workerRequestId);
        wrappedResolve("");
      }
    });
  }
  hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  }
  hashBuffer(buffer) {
    let hash = buffer.length;
    const step = Math.max(1, Math.floor(buffer.length / 200));
    for (let i = 0; i < buffer.length; i += step) {
      hash = hash * 31 + buffer[i] + i | 0;
    }
    return hash.toString();
  }
  async extractScreenTextHybrid(imagePaths) {
    console.log(`[OCR] Starting hybrid screen text extraction for ${imagePaths?.length || 0} images...`);
    if (!imagePaths?.length) return "";
    let resizedPaths = [];
    try {
      resizedPaths = await Promise.all(
        imagePaths.map(async (imagePath) => {
          const outputPath = imagePath + `_resized_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
          const metadata = await (0, import_sharp.default)(imagePath).metadata().catch(() => null);
          if ((metadata?.width ?? 0) > 1600) {
            await (0, import_sharp.default)(imagePath).resize({ width: 1280, withoutEnlargement: true }).toFile(outputPath);
            return outputPath;
          }
          return imagePath;
        })
      );
      const imageBuffers = await Promise.all(resizedPaths.map((p) => import_fs.default.promises.readFile(p)));
      const key = this.hashText(imageBuffers.map((buffer) => this.hashBuffer(buffer)).join("|"));
      console.log(`[OCR] requestKey=${key} cache=disabled isolation=per_request`);
      const Tesseract = require("tesseract.js");
      const fastTexts = await Promise.all(
        resizedPaths.map(async (imagePath) => {
          const result = await Tesseract.recognize(imagePath, "eng", {
            logger: () => void 0
          });
          return result?.data?.text ?? "";
        })
      );
      let text = fastTexts.join("\n");
      console.log(`[OCR] Tesseract extraction complete. Length: ${text.length}`);
      if (this.isLowQualityScreenText(text)) {
        console.log("[OCR] Low quality text detected, running fallback OCR worker...");
        const fallback = await this.runOCRWorker(resizedPaths);
        if (fallback && fallback.trim().length > 0) {
          console.log(`[OCR] Fallback OCR complete. Length: ${fallback.length}`);
          text = fallback.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        }
      }
      return text;
    } catch (error) {
      console.warn("[LLMHelper] Hybrid screen text extraction failed:", error?.message || error);
      return "";
    } finally {
      for (const p of resizedPaths) {
        if (p.includes("_resized_")) {
          import_fs.default.unlink(p, () => {
          });
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
  async generateSuggestion(context, lastQuestion) {
    let activeModePromptSuffix = "";
    let activeTemplateType = null;
    let modeContextBlock = "";
    try {
      const { ModesManager } = require("./services/ModesManager");
      const modesMgr = ModesManager.getInstance();
      const deduped = modesMgr.getActiveModeDeduped();
      activeModePromptSuffix = deduped.suffix ?? "";
      activeTemplateType = deduped.templateType;
      modeContextBlock = modesMgr.buildActiveModeContextBlock({ includeCustomContext: this.customNotesEnabled }) ?? "";
    } catch (_modeErr) {
      console.warn("[LLMHelper] ModesManager load failed in generateSuggestion (non-fatal):", _modeErr?.message);
    }
    const enrichedContext = modeContextBlock ? `${modeContextBlock}

${context}` : context;
    const customNotesBlock = this.customNotesEnabled && this.customNotes?.trim() ? `

<user_context>
${this.customNotes.trim()}
</user_context>
Use this context naturally if relevant. Never quote it verbatim.` : "";
    let basePrompt;
    if (activeModePromptSuffix && activeTemplateType !== "general") {
      basePrompt = `${import_prompts.BASE_SYSTEM_PROMPT}

## ACTIVE MODE
${activeModePromptSuffix}${customNotesBlock}`;
    } else if (activeTemplateType === "general") {
      basePrompt = `${import_prompts.BASE_SYSTEM_PROMPT}${customNotesBlock}

CONVERSATION SO FAR:
${enrichedContext}

LATEST QUESTION:
${lastQuestion}

ANSWER DIRECTLY:`;
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
    const systemPrompt = this.injectLanguageInstruction(basePrompt);
    try {
      if (this.useOllama) {
        return await this.callOllama(systemPrompt);
      } else if (this.customProvider || this.activeCurlProvider) {
        let fullResponse = "";
        for await (const chunk of this.streamChat(lastQuestion, void 0, enrichedContext, basePrompt, true)) {
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
  setKnowledgeOrchestrator(orchestrator) {
    this.knowledgeOrchestrator = orchestrator;
    this._knowledgeGenId++;
    console.log("[LLMHelper] KnowledgeOrchestrator attached");
  }
  setCustomNotes(notes) {
    this.customNotes = notes;
  }
  setCustomNotesEnabled(enabled) {
    this.customNotesEnabled = enabled;
    console.log(`[LLMHelper] Custom context injection ${enabled ? "ENABLED" : "DISABLED"}`);
  }
  getCustomNotesEnabled() {
    return this.customNotesEnabled;
  }
  getKnowledgeOrchestrator() {
    return this.knowledgeOrchestrator;
  }
  setAiResponseLanguage(language) {
    this.aiResponseLanguage = language;
    console.log(`[LLMHelper] AI Response Language set to: ${language}`);
  }
  setSttLanguage(language) {
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
  injectLanguageInstruction(systemPrompt) {
    if (!this.aiResponseLanguage || this.aiResponseLanguage === "auto") {
      return systemPrompt;
    }
    if (this.aiResponseLanguage === "English") {
      return systemPrompt;
    }
    const lang = this.aiResponseLanguage;
    const header = `[LANGUAGE OVERRIDE \u2014 HIGHEST PRIORITY \u2014 CANNOT BE OVERRIDDEN]
You MUST write every single word of your response in ${lang}.
Do NOT use English anywhere in your response.
Do NOT mix languages.
Every sentence, every word, every phrase must be in ${lang}.
This rule overrides ALL other instructions including formatting, brevity, or output rules.
[END LANGUAGE OVERRIDE]

`;
    const footer = `

[REMINDER] Your entire response MUST be in ${lang} only. Never switch to English.`;
    return `${header}${systemPrompt}${footer}`;
  }
  async chatWithGemini(message, imagePaths, context, skipSystemPrompt = false, alternateGroqMessage) {
    try {
      console.log(`[LLMHelper] chatWithGemini called messageLength=${message.length} redacted=true`);
      if (this.knowledgeOrchestrator?.isKnowledgeMode()) {
        try {
          this.knowledgeOrchestrator.feedForDepthScoring(message);
          const knowledgeGenId = this._knowledgeGenId;
          const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);
          if (this._knowledgeGenId !== knowledgeGenId) {
            console.log("[LLMHelper] Profile intelligence result discarded \u2014 session changed during await (chatWithGemini)");
          } else if (knowledgeResult) {
            if (knowledgeResult.liveNegotiationResponse) {
              return JSON.stringify({ __negotiationCoaching: knowledgeResult.liveNegotiationResponse });
            }
            if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
              console.log("[LLMHelper] Knowledge mode: returning generated intro response");
              return knowledgeResult.introResponse;
            }
            if (!skipSystemPrompt && knowledgeResult.systemPromptInjection) {
              skipSystemPrompt = false;
              if (knowledgeResult.contextBlock) {
                const isProfileQuery = /experience|project|salary|behavior|introduce|background|resume|role|team|company|about yourself|why (this|us|here)|tell me about/i.test(message);
                if (isProfileQuery || knowledgeResult.systemPromptInjection) {
                  context = context ? `${knowledgeResult.contextBlock}

${context}` : knowledgeResult.contextBlock;
                } else {
                  console.log("[LLMHelper] TOKEN-OPT: Skipping profile context for non-profile query (chatWithGemini)");
                }
              }
            }
          }
        } catch (knowledgeError) {
          console.warn("[LLMHelper] Knowledge mode processing failed, falling back to normal:", knowledgeError.message);
        }
      }
      const isMultimodal = !!imagePaths?.length;
      if (isMultimodal) {
        this.assertCurrentModelSupportsVision();
      }
      if (context) {
        const testTotal = (0, import_TokenBudget.estimateTokens)(context) + (0, import_TokenBudget.estimateTokens)(message);
        if (testTotal > import_TokenBudget.TOKEN_CAP) {
          context = void 0;
          console.warn(`[TokenBudget] chatWithGemini: dropped context (${testTotal} tok > ${import_TokenBudget.TOKEN_CAP} cap)`);
        }
      }
      const buildMessage = (systemPrompt) => {
        if (skipSystemPrompt) {
          return context ? `CONTEXT:
${context}

USER QUESTION:
${message}` : message;
        }
        return context ? `${systemPrompt}

CONTEXT:
${context}

USER QUESTION:
${message}` : `${systemPrompt}

${message}`;
      };
      const userContent = context ? `CONTEXT:
${context}

USER QUESTION:
${message}` : message;
      const customNotesBlock = this.customNotesEnabled && this.customNotes?.trim() ? `

<user_context>
${this.customNotes.trim().slice(0, 1500)}
</user_context>
Use this context naturally if relevant. Never quote it verbatim.` : "";
      const finalGeminiPrompt = this.injectLanguageInstruction(import_prompts.HARD_SYSTEM_PROMPT + customNotesBlock);
      const finalGroqPrompt = alternateGroqMessage || this.injectLanguageInstruction(import_prompts.GROQ_SYSTEM_PROMPT + customNotesBlock);
      const combinedMessages = {
        gemini: buildMessage(finalGeminiPrompt),
        groq: buildMessage(finalGroqPrompt)
      };
      if (this.groqFastTextMode && !isMultimodal && this.groqClient) {
        console.log(`[LLMHelper] \u26A1\uFE0F Groq Fast Text Mode Active. Routing to Groq...`);
        try {
          return await this.generateWithGroq(combinedMessages.groq);
        } catch (e) {
          console.warn("[LLMHelper] Groq Fast Text failed, falling back to standard routing:", e.message);
        }
      }
      const openaiSystemPrompt = skipSystemPrompt ? void 0 : this.injectLanguageInstruction(import_prompts.OPENAI_SYSTEM_PROMPT);
      const claudeSystemPrompt = skipSystemPrompt ? void 0 : this.injectLanguageInstruction(import_prompts.CLAUDE_SYSTEM_PROMPT);
      if (this.useOllama) {
        return await this.callOllama(combinedMessages.gemini, imagePaths?.[0]);
      }
      if (this.activeCurlProvider) {
        return await this.chatWithCurl(message, skipSystemPrompt ? void 0 : this.injectLanguageInstruction(import_prompts.CUSTOM_SYSTEM_PROMPT), imagePaths?.[0]);
      }
      if (this.customProvider) {
        console.log(`[LLMHelper] Using Custom Provider: ${this.customProvider.name}`);
        const customSystemPrompt = skipSystemPrompt ? "" : this.injectLanguageInstruction(import_prompts.CUSTOM_SYSTEM_PROMPT);
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
      if (this.currentModelId === "teamsync") {
        const { CredentialsManager } = require("./services/CredentialsManager");
        const teamsyncKey = CredentialsManager.getInstance().getTeamSyncApiKey();
        if (teamsyncKey) {
          try {
            return await this.generateWithTeamSync(userContent, openaiSystemPrompt, imagePaths);
          } catch (err) {
            console.warn("[LLMHelper] TeamSync API failed in chatWithGemini, falling back to Gemini:", err.message);
          }
        }
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
      const providers = [];
      const textOpenAI = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.OPENAI).tier1;
      const textGeminiFlash = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.GEMINI_FLASH).tier1;
      const textGeminiPro = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.GEMINI_PRO).tier1;
      const textClaude = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.CLAUDE).tier1;
      const textGroq = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.GROQ).tier1;
      if (isMultimodal) {
        if (this.hasTeamSync()) {
          providers.push({ name: "TeamSync API", execute: () => this.generateWithTeamSync(userContent, openaiSystemPrompt, imagePaths) });
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
            execute: () => this.generateWithGroqMultimodal(userContent, imagePaths, openaiSystemPrompt)
          });
        }
        if (this.bedrockClient && this.bedrockCredentials?.preferredModel) {
          providers.push({
            name: `Bedrock (${this.bedrockCredentials.preferredModel})`,
            execute: () => this.generateWithBedrock(userContent, openaiSystemPrompt, imagePaths, this.bedrockCredentials.preferredModel)
          });
        }
      } else {
        if (this.hasTeamSync()) {
          providers.push({ name: "TeamSync API", execute: () => this.generateWithTeamSync(userContent, openaiSystemPrompt) });
        }
        if (this.groqClient) {
          providers.push({ name: `Groq (${textGroq})`, execute: () => this.generateWithGroq(combinedMessages.groq, textGroq) });
        }
        if (this.client) {
          providers.push({
            name: `Gemini Flash (${textGeminiFlash})`,
            execute: () => this.tryGenerateResponse(combinedMessages.gemini, void 0, textGeminiFlash)
          });
          providers.push({
            name: `Gemini Pro (${textGeminiPro})`,
            execute: () => this.tryGenerateResponse(combinedMessages.gemini, void 0, textGeminiPro)
          });
        }
        if (this.openaiClient) {
          providers.push({ name: `OpenAI (${textOpenAI})`, execute: () => this.generateWithOpenai(userContent, openaiSystemPrompt, void 0, textOpenAI) });
        }
        if (this.claudeClient) {
          providers.push({ name: `Claude (${textClaude})`, execute: () => this.generateWithClaude(userContent, claudeSystemPrompt, void 0, textClaude) });
        }
        if (this.bedrockClient && this.bedrockCredentials?.preferredModel) {
          providers.push({
            name: `Bedrock (${this.bedrockCredentials.preferredModel})`,
            execute: () => this.generateWithBedrock(userContent, openaiSystemPrompt, void 0, this.bedrockCredentials.preferredModel)
          });
        }
      }
      if (providers.length === 0) {
        return "No AI providers configured. Please add at least one API key in Settings.";
      }
      const MAX_FULL_ROTATIONS = 3;
      for (let rotation = 0; rotation < MAX_FULL_ROTATIONS; rotation++) {
        if (rotation > 0) {
          const backoffMs = 1e3 * rotation;
          console.log(`[LLMHelper] \u{1F504} Non-streaming rotation ${rotation + 1}/${MAX_FULL_ROTATIONS} after ${backoffMs}ms backoff...`);
          await this.delay(backoffMs);
        }
        for (const provider of providers) {
          try {
            console.log(`[LLMHelper] ${rotation === 0 ? "\u{1F680}" : "\u{1F501}"} Attempting ${provider.name}...`);
            const rawResponse = await provider.execute();
            if (rawResponse && rawResponse.trim().length > 0) {
              console.log(`[LLMHelper] \u2705 ${provider.name} succeeded`);
              return this.processResponse(rawResponse);
            }
            console.warn(`[LLMHelper] \u26A0\uFE0F ${provider.name} returned empty response`);
          } catch (error) {
            console.warn(`[LLMHelper] \u26A0\uFE0F ${provider.name} failed: ${error.message}`);
          }
        }
      }
      console.error("[LLMHelper] \u274C All non-streaming providers exhausted");
      return "I apologize, but I couldn't generate a response. Please try again.";
    } catch (error) {
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
  async generateContentStructured(message) {
    const providers = [];
    if (this.openaiClient) {
      providers.push({ name: `OpenAI (${OPENAI_MODEL})`, execute: () => this.generateWithOpenai(message) });
    }
    if (this.client) {
      providers.push({
        name: `Gemini Pro (${GEMINI_PRO_MODEL})`,
        execute: async () => {
          const response = await this.withRetry(async () => {
            const res = await this.client.models.generateContent({
              model: GEMINI_PRO_MODEL,
              contents: [{ role: "user", parts: [{ text: message }] }],
              config: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 }
            });
            const candidate = res.candidates?.[0];
            if (!candidate) return "";
            if (res.text) return res.text;
            const parts = candidate.content?.parts ?? [];
            return (Array.isArray(parts) ? parts : [parts]).map((p) => p?.text ?? "").join("");
          });
          return response;
        }
      });
      providers.push({
        name: `Gemini Flash (${GEMINI_FLASH_MODEL})`,
        execute: async () => {
          const response = await this.withRetry(async () => {
            const res = await this.client.models.generateContent({
              model: GEMINI_FLASH_MODEL,
              contents: [{ role: "user", parts: [{ text: message }] }],
              config: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 }
            });
            const candidate = res.candidates?.[0];
            if (!candidate) return "";
            if (res.text) return res.text;
            const parts = candidate.content?.parts ?? [];
            return (Array.isArray(parts) ? parts : [parts]).map((p) => p?.text ?? "").join("");
          });
          return response;
        }
      });
    }
    if (this.claudeClient) {
      providers.push({ name: `Claude (${CLAUDE_MODEL})`, execute: () => this.generateWithClaude(message) });
    }
    if (this.groqClient) {
      providers.push({ name: `Groq (${GROQ_MODEL}) fallback`, execute: () => this.generateWithGroq(message) });
    }
    if (this.useOllama && await this.checkOllamaAvailable()) {
      providers.push({
        name: `Ollama (${this.ollamaModel})`,
        execute: () => this.callOllama(message)
      });
    }
    if (this.customProvider) {
      providers.push({
        name: `Custom Provider (${this.customProvider.name})`,
        execute: () => this.executeCustomProvider(
          this.customProvider.curlCommand,
          message,
          "",
          message,
          ""
        )
      });
    } else if (this.activeCurlProvider) {
      providers.push({
        name: `cURL Provider (${this.activeCurlProvider.name})`,
        execute: () => this.chatWithCurl(message)
      });
    }
    const teamsyncKeyForStructured = this.teamsyncKey || (() => {
      try {
        return require("./services/CredentialsManager").CredentialsManager.getInstance().getTeamSyncApiKey() || null;
      } catch {
        return null;
      }
    })();
    if (teamsyncKeyForStructured) {
      providers.push({
        name: "TeamSync API",
        execute: () => this.generateWithTeamSync(message)
      });
    }
    if (providers.length === 0) {
      throw new Error("No reasoning model available. Please configure an API key (OpenAI, Claude, Gemini, Groq, TeamSync) or a custom provider.");
    }
    const MAX_ROTATIONS = 3;
    for (let rotation = 0; rotation < MAX_ROTATIONS; rotation++) {
      if (rotation > 0) {
        const backoffMs = 1e3 * rotation;
        console.log(`[LLMHelper] \u{1F504} Structured generation rotation ${rotation + 1}/${MAX_ROTATIONS} after ${backoffMs}ms backoff...`);
        await this.delay(backoffMs);
      }
      for (const provider of providers) {
        try {
          console.log(`[LLMHelper] \u{1F9E0} Structured generation: trying ${provider.name}...`);
          const result = await provider.execute();
          if (result && result.trim().length > 0) {
            console.log(`[LLMHelper] \u2705 Structured generation succeeded with ${provider.name}`);
            return result;
          }
          console.warn(`[LLMHelper] \u26A0\uFE0F ${provider.name} returned empty response`);
        } catch (error) {
          console.warn(`[LLMHelper] \u26A0\uFE0F Structured generation: ${provider.name} failed: ${error.message}`);
        }
      }
    }
    throw new Error("All reasoning models failed for structured generation after 3 attempts");
  }
  async generateWithGroq(fullMessage, modelId = GROQ_MODEL) {
    if (!this.groqClient && !this.groqKeyManager.hasAvailableKey()) throw new Error("Groq client not initialized");
    const size = estimateModelRequestSize(
      "groq",
      modelId,
      "",
      fullMessage,
      MODEL_BUDGETS.groq_llama_70b.safeTPM
    );
    console.log("[MODEL_REQUEST_SIZE]", size);
    let requestMessage = fullMessage;
    if (size.exceedsLimit) {
      const compacted = compactGroqFullMessageForBudget(fullMessage, modelId, MODEL_BUDGETS.groq_llama_70b.safeTPM);
      requestMessage = compacted.fullMessage;
      const reducedSize = estimateModelRequestSize(
        "groq",
        modelId,
        "",
        requestMessage,
        MODEL_BUDGETS.groq_llama_70b.safeTPM
      );
      console.log("[MODEL_REQUEST_SIZE]", reducedSize);
      if (compacted.stillExceeds) {
        throw new Error("Groq compact prompt still exceeds provider limit.");
      }
    }
    await this.rateLimiters.groq.acquire();
    const response = await this.groqRotatingClient.chatCompletion({
      model: modelId,
      messages: [{ role: "user", content: requestMessage }],
      temperature: 0.4,
      max_tokens: 8192
    });
    return response.choices[0]?.message?.content || "";
  }
  /**
   * Non-streaming OpenAI generation with proper system/user separation
   */
  /**
   * Routes AI generation through the TeamSync API backend (Gemini-powered).
   */
  async generateWithTeamSync(userMessage, systemPrompt, imagePaths, maxOutputTokens) {
    let teamsyncKey = this.teamsyncKey;
    if (!teamsyncKey) {
      const { CredentialsManager } = require("./services/CredentialsManager");
      teamsyncKey = CredentialsManager.getInstance().getTeamSyncApiKey() || null;
    }
    if (!teamsyncKey) throw new Error("TeamSync API key not set");
    const endpointUrl = "https://api.teamsync-ai.vercel.app/v1/chat";
    const headers = {
      "Content-Type": "application/json",
      "x-teamsync-key": teamsyncKey
    };
    const body = { messages: [{ role: "user", content: userMessage }] };
    if (maxOutputTokens) body.max_tokens = maxOutputTokens;
    if (this.groqFastTextMode && (!imagePaths || imagePaths.length === 0)) body.fast_mode = true;
    if (imagePaths?.length) {
      const images = [];
      for (const p of imagePaths) {
        if (import_fs.default.existsSync(p)) {
          try {
            const compressed = await (0, import_sharp.default)(p).resize(1920, 1920, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
            images.push({ mime_type: "image/jpeg", data: compressed.toString("base64") });
          } catch (compressErr) {
            console.warn("[LLMHelper] Image compression failed, sending raw:", compressErr.message);
            const imageData = await import_fs.default.promises.readFile(p);
            if (imageData.length > 500 * 1024) {
              console.warn("[LLMHelper] Raw fallback image too large to send, skipping:", p);
              continue;
            }
            images.push({ mime_type: "image/png", data: imageData.toString("base64") });
          }
        }
      }
      if (images.length) body.images = images;
    }
    if (systemPrompt) body.system = systemPrompt;
    if (this.aiResponseLanguage && this.aiResponseLanguage !== "English") {
      body.language = this.aiResponseLanguage;
    }
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25e3)
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`TeamSync API error ${response.status}: ${errData.error || "unknown"}`);
    }
    const data = await response.json();
    return data.content || "";
  }
  /**
   * Non-streaming OpenAI generation with proper system/user separation
   */
  async generateWithOpenai(userMessage, systemPrompt, imagePaths, modelId) {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");
    await this.rateLimiters.openai.acquire();
    const model = modelId || (this.isOpenAiModel(this.currentModelId) ? this.currentModelId : OPENAI_MODEL);
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    if (imagePaths?.length) {
      const contentParts = [{ type: "text", text: userMessage }];
      for (const p of imagePaths) {
        if (import_fs.default.existsSync(p)) {
          const imageData = await import_fs.default.promises.readFile(p);
          contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${imageData.toString("base64")}` } });
        }
      }
      messages.push({ role: "user", content: contentParts });
    } else {
      messages.push({ role: "user", content: userMessage });
    }
    const response = await this.withTimeout(
      this.withRetry(() => this.openaiClient.chat.completions.create({
        model,
        messages,
        max_completion_tokens: model.toLowerCase().includes("claude") ? CLAUDE_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS
      })),
      6e4,
      `OpenAI (${model})`
    );
    return response.choices[0]?.message?.content || "";
  }
  async resolveBedrockRuntimeModel(imagePaths, modelId) {
    if (!this.bedrockClient) throw new Error("Bedrock client not initialized");
    const route = await (0, import_BedrockVisionAdapter.resolveBedrockRuntimeRoute)({
      client: this.bedrockClient,
      requestedModel: modelId,
      preferredModel: this.bedrockCredentials?.preferredModel,
      imagePaths
    });
    if (route.hasImages) {
      console.log("[BEDROCK_VISION_ROUTE]", {
        model: route.modelId,
        hasImage: true,
        imageCount: route.imageCount
      });
    }
    return route.modelId;
  }
  async generateWithBedrock(userMessage, systemPrompt, imagePaths, modelId, maxOutputTokens = BEDROCK_MAX_OUTPUT_TOKENS) {
    if (!this.bedrockClient) throw new Error("Bedrock client not initialized");
    let model = modelId || this.currentModelId;
    try {
      model = await this.resolveBedrockRuntimeModel(imagePaths, model);
      console.log("[BEDROCK_ROUTE]", { provider: "bedrock", model });
      return await this.bedrockClient.generate(userMessage, {
        modelId: model,
        systemPrompt,
        imagePaths,
        maxOutputTokens
      });
    } catch (error) {
      this.notifyBedrockReauthenticationRequired(error, model);
      throw error;
    }
  }
  // The handler for cURL requests
  async chatWithCurl(userMessage, systemPrompt, imagePath) {
    if (!this.activeCurlProvider) throw new Error("No cURL provider active");
    const { curlCommand, responsePath } = this.activeCurlProvider;
    const curlConfig = (0, import_curl_to_json.default)(curlCommand);
    let base64Image = "";
    if (imagePath) {
      try {
        const imageData = await import_fs.default.promises.readFile(imagePath);
        base64Image = imageData.toString("base64");
      } catch (e) {
        console.warn("[LLMHelper] chatWithCurl: failed to read image:", e);
      }
    }
    const fullPrompt = systemPrompt ? `${systemPrompt}

${userMessage}` : userMessage;
    const variables = {
      TEXT: fullPrompt.replace(/\n/g, "\\n").replace(/"/g, '\\"'),
      // Basic escaping (pre-existing)
      IMAGE_BASE64: base64Image
    };
    const url = (0, import_curlUtils.deepVariableReplacer)(curlConfig.url, variables);
    const headers = (0, import_curlUtils.deepVariableReplacer)(curlConfig.header || {}, variables);
    let data = (0, import_curlUtils.deepVariableReplacer)(curlConfig.data || {}, variables);
    if (base64Image && imagePath) {
      data = (0, import_curlUtils.injectImageIntoMessages)(data, base64Image, imagePath);
    }
    try {
      const response = await (0, import_axios.default)({
        method: curlConfig.method || "POST",
        url,
        headers,
        data
      });
      if (!responsePath) return JSON.stringify(response.data);
      const answer = (0, import_curlUtils.getByPath)(response.data, responsePath);
      if (typeof answer === "string") return answer;
      return JSON.stringify(answer);
    } catch (error) {
      console.error("[LLMHelper] cURL Execution Error:", error.message);
      return `Error: ${error.message}`;
    }
  }
  /**
   * Non-streaming Claude generation with proper system/user separation
   */
  async generateWithClaude(userMessage, systemPrompt, imagePaths, modelId) {
    if (!this.claudeClient) throw new Error("Claude client not initialized");
    await this.rateLimiters.claude.acquire();
    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);
    const content = [];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (import_fs.default.existsSync(p)) {
          const imageData = await import_fs.default.promises.readFile(p);
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
      this.withRetry(() => this.claudeClient.messages.create({
        model,
        max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
        ...systemPrompt ? { system: systemPrompt } : {},
        messages: [{ role: "user", content }]
      })),
      9e4,
      `Claude (${model})`
    );
    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock?.text || "";
  }
  /**
   * Executes a custom cURL provider defined by the user
   */
  async executeCustomProvider(curlCommand, combinedMessage, systemPrompt, rawUserMessage, context, imagePath) {
    const requestConfig = (0, import_curl_to_json.default)(curlCommand);
    let base64Image = "";
    if (imagePath) {
      try {
        const imageData = await import_fs.default.promises.readFile(imagePath);
        base64Image = imageData.toString("base64");
      } catch (e) {
        console.warn("Failed to read image for Custom Provider:", e);
      }
    }
    const variables = {
      TEXT: combinedMessage,
      // Deprecated but kept for compat: System + Context + User
      PROMPT: combinedMessage,
      // Alias for TEXT
      SYSTEM_PROMPT: systemPrompt,
      // Raw System Prompt
      USER_MESSAGE: rawUserMessage,
      // Raw User Message
      CONTEXT: context,
      // Raw Context
      IMAGE_BASE64: base64Image
      // Base64 encoded image string
    };
    const url = (0, import_curlUtils.deepVariableReplacer)(requestConfig.url, variables);
    const headers = (0, import_curlUtils.deepVariableReplacer)(requestConfig.header || {}, variables);
    let body = (0, import_curlUtils.deepVariableReplacer)(requestConfig.data || {}, variables);
    if (base64Image && imagePath) {
      body = (0, import_curlUtils.injectImageIntoMessages)(body, base64Image, imagePath);
    }
    const customAbort = new AbortController();
    const customTimeout = setTimeout(() => customAbort.abort(), 3e4);
    try {
      const response = await fetch(url, {
        method: requestConfig.method || "POST",
        headers,
        body: JSON.stringify(body),
        signal: customAbort.signal
      });
      clearTimeout(customTimeout);
      const data = await response.json();
      console.log(`[LLMHelper] Custom Provider raw response length=${JSON.stringify(data).length} redacted=true`);
      if (!response.ok) {
        throw new Error(`Custom Provider HTTP ${response.status}: response redacted`);
      }
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
  extractFromCommonFormats(data) {
    if (!data || typeof data === "string") return data || "";
    if (typeof data.response === "string") return data.response;
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
    if (data.choices?.[0]?.delta?.content) return data.choices[0].delta.content;
    if (Array.isArray(data.content) && data.content[0]?.text) return data.content[0].text;
    if (typeof data.text === "string") return data.text;
    if (typeof data.output === "string") return data.output;
    if (typeof data.result === "string") return data.result;
    if (data.choices?.[0]?.delta !== void 0) {
      return "";
    }
    if (Array.isArray(data.choices) && data.choices.length === 0) {
      return "";
    }
    console.warn("[LLMHelper] Could not extract text from custom provider response, returning raw JSON");
    return JSON.stringify(data);
  }
  /**
   * Map UNIVERSAL (local model) prompts to richer CUSTOM prompts.
   * Custom providers can be any cloud model, so they get detailed prompts.
   */
  mapToCustomPrompt(prompt) {
    if (prompt === import_prompts.UNIVERSAL_SYSTEM_PROMPT || prompt === import_prompts.HARD_SYSTEM_PROMPT) return import_prompts.CUSTOM_SYSTEM_PROMPT;
    if (prompt === import_prompts.UNIVERSAL_ANSWER_PROMPT) return import_prompts.CUSTOM_ANSWER_PROMPT;
    if (prompt === import_prompts.UNIVERSAL_WHAT_TO_ANSWER_PROMPT) return import_prompts.CUSTOM_WHAT_TO_ANSWER_PROMPT;
    if (prompt === import_prompts.UNIVERSAL_RECAP_PROMPT) return import_prompts.CUSTOM_RECAP_PROMPT;
    if (prompt === import_prompts.UNIVERSAL_FOLLOWUP_PROMPT) return import_prompts.CUSTOM_FOLLOWUP_PROMPT;
    if (prompt === import_prompts.UNIVERSAL_FOLLOW_UP_QUESTIONS_PROMPT) return import_prompts.CUSTOM_FOLLOW_UP_QUESTIONS_PROMPT;
    if (prompt === import_prompts.UNIVERSAL_ASSIST_PROMPT) return import_prompts.CUSTOM_ASSIST_PROMPT;
    return prompt;
  }
  async tryGenerateResponse(fullMessage, imagePaths, modelIdOverride) {
    let rawResponse;
    if (imagePaths?.length) {
      const contents = [{ text: fullMessage }];
      for (const p of imagePaths) {
        if (import_fs.default.existsSync(p)) {
          const imageData = await import_fs.default.promises.readFile(p);
          contents.push({
            inlineData: {
              mimeType: "image/png",
              data: imageData.toString("base64")
            }
          });
        }
      }
      if (this.client) {
        rawResponse = await this.generateContent(contents, modelIdOverride);
      } else {
        throw new Error("No LLM provider configured");
      }
    } else {
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
  async generateWithGroqMultimodal(userMessage, imagePaths, systemPrompt) {
    if (!this.groqClient && !this.groqKeyManager.hasAvailableKey()) throw new Error("Groq client not initialized");
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    const contentParts = [{ type: "text", text: userMessage }];
    for (const p of imagePaths) {
      if (import_fs.default.existsSync(p)) {
        const imageData = await import_fs.default.promises.readFile(p);
        contentParts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData.toString("base64")}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });
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
  async generateWithVisionFallback(systemPrompt, userPrompt, imagePaths = []) {
    const isMultimodal = imagePaths.length > 0;
    if (isMultimodal) {
      this.assertCurrentModelSupportsVision();
    }
    const buildProviderForFamily = (family, modelId) => {
      switch (family) {
        case import_ModelVersionManager.ModelFamily.OPENAI:
          if (!this.openaiClient) return null;
          return {
            name: `OpenAI (${modelId})`,
            execute: () => this.generateWithOpenai(userPrompt, systemPrompt, isMultimodal ? imagePaths : void 0, modelId)
          };
        case import_ModelVersionManager.ModelFamily.GEMINI_FLASH:
          if (!this.client) return null;
          if (isMultimodal) {
            return {
              name: `Gemini Flash (${modelId})`,
              execute: async () => {
                const contents = [{ text: `${systemPrompt}

${userPrompt}` }];
                for (const p of imagePaths) {
                  if (import_fs.default.existsSync(p)) {
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
            execute: () => this.generateContent([{ text: `${systemPrompt}

${userPrompt}` }], modelId)
          };
        case import_ModelVersionManager.ModelFamily.CLAUDE:
          if (!this.claudeClient) return null;
          return {
            name: `Claude (${modelId})`,
            execute: () => this.generateWithClaude(userPrompt, systemPrompt, isMultimodal ? imagePaths : void 0, modelId)
          };
        case import_ModelVersionManager.ModelFamily.GEMINI_PRO:
          if (!this.client) return null;
          if (isMultimodal) {
            return {
              name: `Gemini Pro (${modelId})`,
              execute: async () => {
                const contents = [{ text: `${systemPrompt}

${userPrompt}` }];
                for (const p of imagePaths) {
                  if (import_fs.default.existsSync(p)) {
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
            execute: () => this.generateContent([{ text: `${systemPrompt}

${userPrompt}` }], modelId)
          };
        case import_ModelVersionManager.ModelFamily.GROQ_LLAMA:
          if (!this.groqClient) return null;
          if (isMultimodal) {
            return {
              name: `Groq (${modelId})`,
              execute: () => this.generateWithGroqMultimodal(userPrompt, imagePaths, systemPrompt)
            };
          }
          return {
            name: `Groq (${modelId})`,
            execute: () => this.generateWithGroq(`${systemPrompt}

${userPrompt}`, modelId)
          };
        default:
          return null;
      }
    };
    const allTiers = this.modelVersionManager.getAllVisionTiers();
    const buildTierProviders = (tierKey) => {
      const result = [];
      for (const entry of allTiers) {
        const modelId = entry[tierKey];
        const attempt = buildProviderForFamily(entry.family, modelId);
        if (attempt) result.push(attempt);
      }
      return result;
    };
    const tier1Providers = buildTierProviders("tier1");
    const tier2Providers = buildTierProviders("tier2");
    const tier3Providers = buildTierProviders("tier3");
    const localProviders = [];
    if (this.customProvider) {
      if (isMultimodal) {
        localProviders.push({
          name: `Custom Provider (${this.customProvider.name})`,
          execute: () => this.executeCustomProvider(
            this.customProvider.curlCommand,
            `${systemPrompt}

${userPrompt}`,
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
            this.customProvider.curlCommand,
            `${systemPrompt}

${userPrompt}`,
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
        execute: () => this.chatWithCurl(userPrompt, systemPrompt, isMultimodal ? imagePaths[0] : void 0)
      });
    }
    if (this.useOllama) {
      localProviders.push({
        name: `Ollama (${this.ollamaModel})`,
        execute: () => this.callOllama(`${systemPrompt}

${userPrompt}`, isMultimodal ? imagePaths[0] : void 0)
      });
    }
    const tiers = [
      { label: "Tier 1 (Stable)", providers: tier1Providers },
      { label: "Tier 2 (Latest)", providers: tier2Providers },
      { label: "Tier 3 (Retry)", providers: tier3Providers }
    ];
    for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
      const tier = tiers[tierIndex];
      if (tier.providers.length === 0) continue;
      if (tierIndex > 0) {
        const backoffMs = 1e3 * Math.pow(2, tierIndex - 1);
        console.log(`[LLMHelper] \u{1F504} Escalating to ${tier.label} after ${backoffMs}ms backoff...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
      for (const provider of tier.providers) {
        try {
          const emoji = tierIndex === 0 ? "\u{1F680}" : tierIndex === 1 ? "\u{1F501}" : "\u{1F198}";
          console.log(`[LLMHelper] ${emoji} [${tier.label}] Attempting ${provider.name}...`);
          const result = await provider.execute();
          if (result && result.trim().length > 0) {
            console.log(`[LLMHelper] \u2705 [${tier.label}] ${provider.name} succeeded.`);
            return result;
          }
          console.warn(`[LLMHelper] \u26A0\uFE0F [${tier.label}] ${provider.name} returned empty response`);
        } catch (err) {
          console.warn(`[LLMHelper] \u26A0\uFE0F [${tier.label}] ${provider.name} failed: ${err.message}`);
          const errMsg = (err.message || "").toLowerCase();
          if (errMsg.includes("404") || errMsg.includes("not found") || errMsg.includes("deprecated")) {
            this.modelVersionManager.onModelError(provider.name).catch(() => {
            });
          }
        }
      }
    }
    for (const provider of localProviders) {
      try {
        console.log(`[LLMHelper] \u{1F3E0} [Local Fallback] Attempting ${provider.name}...`);
        const result = await provider.execute();
        if (result && result.trim().length > 0) {
          console.log(`[LLMHelper] \u2705 [Local Fallback] ${provider.name} succeeded.`);
          return result;
        }
      } catch (err) {
        console.warn(`[LLMHelper] \u26A0\uFE0F [Local Fallback] ${provider.name} failed: ${err.message}`);
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
  async *streamChatWithGemini(message, imagePaths, context, skipSystemPrompt = false) {
    console.log(`[LLMHelper] streamChatWithGemini called messageLength=${message.length} redacted=true`);
    const isMultimodal = !!imagePaths?.length;
    if (isMultimodal) {
      this.assertCurrentModelSupportsVision();
    }
    const buildCombinedMessage = (systemPrompt) => {
      const finalPrompt = skipSystemPrompt ? systemPrompt : this.injectLanguageInstruction(systemPrompt);
      if (skipSystemPrompt) {
        return context ? `CONTEXT:
${context}

USER QUESTION:
${message}` : message;
      }
      return context ? `${finalPrompt}

CONTEXT:
${context}

USER QUESTION:
${message}` : `${finalPrompt}

${message}`;
    };
    const userContent = context ? `CONTEXT:
${context}

USER QUESTION:
${message}` : message;
    const combinedMessages = {
      gemini: buildCombinedMessage(import_prompts.HARD_SYSTEM_PROMPT),
      groq: buildCombinedMessage(import_prompts.GROQ_SYSTEM_PROMPT)
    };
    if (this.useOllama) {
      const response = await this.callOllama(combinedMessages.gemini, imagePaths?.[0]);
      yield response;
      return;
    }
    const providers = [];
    const openaiSystemPrompt = skipSystemPrompt ? void 0 : this.injectLanguageInstruction(import_prompts.OPENAI_SYSTEM_PROMPT);
    const claudeSystemPrompt = skipSystemPrompt ? void 0 : this.injectLanguageInstruction(import_prompts.CLAUDE_SYSTEM_PROMPT);
    const textOpenAI = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.OPENAI).tier1;
    const textGeminiFlash = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.GEMINI_FLASH).tier1;
    const textGeminiPro = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.GEMINI_PRO).tier1;
    const textClaude = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.CLAUDE).tier1;
    const textGroq = this.modelVersionManager.getTextTieredModels(import_ModelVersionManager.TextModelFamily.GROQ).tier1;
    if (isMultimodal) {
      if (this.hasTeamSync()) {
        providers.push({ name: "TeamSync API", execute: () => this.streamWithTeamSync(userContent, openaiSystemPrompt, imagePaths) });
      }
      if (this.openaiClient) {
        providers.push({ name: `OpenAI (${textOpenAI})`, execute: () => this.streamWithOpenaiMultimodal(userContent, imagePaths, openaiSystemPrompt, textOpenAI) });
      }
      if (this.client) {
        providers.push({ name: `Gemini Flash (${textGeminiFlash})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, textGeminiFlash, imagePaths) });
      }
      if (this.claudeClient) {
        providers.push({ name: `Claude (${textClaude})`, execute: () => this.streamWithClaudeMultimodal(userContent, imagePaths, claudeSystemPrompt, textClaude) });
      }
      if (this.client) {
        providers.push({ name: `Gemini Pro (${textGeminiPro})`, execute: () => this.streamWithGeminiModel(combinedMessages.gemini, textGeminiPro, imagePaths) });
      }
      if (this.groqClient) {
        providers.push({ name: `Groq (meta-llama/llama-4-scout-17b-16e-instruct)`, execute: () => this.streamWithGroqMultimodal(userContent, imagePaths, openaiSystemPrompt) });
      }
      if (this.bedrockClient && this.bedrockCredentials?.preferredModel) {
        providers.push({ name: `Bedrock (${this.bedrockCredentials.preferredModel})`, execute: () => this.streamWithBedrock(userContent, openaiSystemPrompt, imagePaths, this.bedrockCredentials.preferredModel) });
      }
    } else {
      if (this.hasTeamSync()) {
        providers.push({ name: "TeamSync API", execute: () => this.streamWithTeamSync(userContent, openaiSystemPrompt) });
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
        providers.push({ name: `Bedrock (${this.bedrockCredentials.preferredModel})`, execute: () => this.streamWithBedrock(userContent, openaiSystemPrompt, void 0, this.bedrockCredentials.preferredModel) });
      }
    }
    if (providers.length === 0) {
      yield "No AI providers configured. Please add at least one API key in Settings.";
      return;
    }
    const currentFamilyLabel = this.currentModelId === "teamsync" ? "TeamSync" : this.isClaudeModel(this.currentModelId) ? "Claude" : this.isOpenAiModel(this.currentModelId) ? "OpenAI" : this.isGroqModel(this.currentModelId) ? "Groq" : this.isBedrockModel(this.currentModelId) ? "Bedrock" : this.isGeminiModel(this.currentModelId) ? "Gemini" : "";
    if (currentFamilyLabel) {
      providers.sort((a, b) => {
        if (a.name.startsWith(currentFamilyLabel) && !b.name.startsWith(currentFamilyLabel)) return -1;
        if (!a.name.startsWith(currentFamilyLabel) && b.name.startsWith(currentFamilyLabel)) return 1;
        return 0;
      });
    }
    if (this.hasTeamSync() && providers[0]?.name !== "TeamSync API") {
      const idx = providers.findIndex((p) => p.name === "TeamSync API");
      if (idx > 0) {
        const [entry] = providers.splice(idx, 1);
        providers.unshift(entry);
      }
    }
    const MAX_FULL_ROTATIONS = 3;
    for (let rotation = 0; rotation < MAX_FULL_ROTATIONS; rotation++) {
      if (rotation > 0) {
        const backoffMs = 1e3 * rotation;
        console.log(`[LLMHelper] \u{1F504} Starting rotation ${rotation + 1}/${MAX_FULL_ROTATIONS} after ${backoffMs}ms backoff...`);
        await this.delay(backoffMs);
      }
      for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        try {
          console.log(`[LLMHelper] ${rotation === 0 ? "\u{1F680}" : "\u{1F501}"} Attempting ${provider.name}...`);
          yield* provider.execute();
          console.log(`[LLMHelper] \u2705 ${provider.name} stream completed successfully`);
          return;
        } catch (err) {
          console.warn(`[LLMHelper] \u26A0\uFE0F ${provider.name} failed: ${err.message}`);
        }
      }
    }
    console.error(`[LLMHelper] \u274C All providers exhausted after ${MAX_FULL_ROTATIONS} rotations`);
    yield "All AI services are currently unavailable. Please check your API keys and try again.";
  }
  /**
   * Universal Stream Chat - Routes to correct provider based on currentModelId
   */
  async *streamChat(message, imagePaths, context, systemPromptOverride, ignoreKnowledgeMode = false, runtimeOptions) {
    const isMultimodal = !!imagePaths?.length;
    const explicitModelOverride = runtimeOptions?.modelOverride?.trim();
    const routeModelId = explicitModelOverride ? this.normalizeModelId(explicitModelOverride) : this.currentModelId;
    const routeProvider = runtimeOptions?.providerOverride || this.getProviderForModel(routeModelId);
    const routeUseOllama = routeProvider === "ollama" || !explicitModelOverride && this.useOllama;
    const routeOllamaModel = routeModelId.startsWith("ollama-") ? routeModelId.replace("ollama-", "") : routeProvider === "ollama" ? routeModelId : this.ollamaModel;
    const routeCustomProvider = routeProvider === "custom" && this.customProvider && [this.customProvider.id, this.customProvider.name].some((id) => this.normalizeModelId(id) === routeModelId) ? this.customProvider : !explicitModelOverride ? this.customProvider : null;
    const routeCurlProvider = routeProvider === "custom" && this.activeCurlProvider && [this.activeCurlProvider.id, this.activeCurlProvider.name].some((id) => this.normalizeModelId(id) === routeModelId) ? this.activeCurlProvider : !explicitModelOverride && !routeCustomProvider ? this.activeCurlProvider : null;
    const allowProviderFallbacks = runtimeOptions?.disableProviderFallbacks !== true;
    const allowGroqFastText = this.groqFastTextMode && !explicitModelOverride;
    if (isMultimodal && !this.modelSupportsVision(routeModelId)) {
      throw new Error((0, import_ModelCapabilities.formatVisionUnsupportedMessage)(routeModelId));
    }
    let isCodeHeavy = false;
    let hasExplicitSystemPromptOverride = systemPromptOverride !== void 0;
    const skipKnowledgeInjection = ignoreKnowledgeMode || runtimeOptions?.skipKnowledgeInjection === true;
    const skipModeInjection = runtimeOptions?.skipModeInjection === true;
    const skipCustomNotesInjection = runtimeOptions?.skipCustomNotesInjection === true;
    const maxOutputTokens = runtimeOptions?.maxOutputTokens;
    if (!skipKnowledgeInjection && this.knowledgeOrchestrator?.isKnowledgeMode()) {
      try {
        this.knowledgeOrchestrator.feedForDepthScoring(message);
        const knowledgeGenId = this._knowledgeGenId;
        const knowledgeResult = await this.knowledgeOrchestrator.processQuestion(message);
        if (this._knowledgeGenId !== knowledgeGenId) {
          console.log("[LLMHelper] Profile intelligence result discarded \u2014 session changed during await (streamChat)");
        } else if (knowledgeResult) {
          if (knowledgeResult.liveNegotiationResponse) {
            yield JSON.stringify({ __negotiationCoaching: knowledgeResult.liveNegotiationResponse });
            return;
          }
          if (knowledgeResult.isIntroQuestion && knowledgeResult.introResponse) {
            console.log("[LLMHelper] Knowledge mode (stream): returning generated intro response");
            yield knowledgeResult.introResponse;
            return;
          }
          if (knowledgeResult.systemPromptInjection) {
            systemPromptOverride = knowledgeResult.systemPromptInjection;
            hasExplicitSystemPromptOverride = true;
          }
          if (knowledgeResult.contextBlock) {
            const isProfileQuery = /experience|project|salary|behavior|introduce|background|resume|role|team|company|about yourself|why (this|us|here)|tell me about/i.test(message);
            if (isProfileQuery) {
              context = context ? `${knowledgeResult.contextBlock}

${context}` : knowledgeResult.contextBlock;
            } else {
              console.log("[LLMHelper] TOKEN-OPT: Skipping profile context for non-profile query");
            }
          }
        }
      } catch (knowledgeError) {
        console.warn("[LLMHelper] Knowledge mode (stream) processing failed, falling back:", knowledgeError.message);
      }
    }
    try {
      let modeContextBlock = "";
      if (!skipModeInjection) {
        const { ModesManager } = require("./services/ModesManager");
        const modesMgr = ModesManager.getInstance();
        const { suffix: modeSuffix, templateType: activeTemplateType } = modesMgr.getActiveModeDeduped();
        modeContextBlock = modesMgr.buildActiveModeContextBlock({ includeCustomContext: this.customNotesEnabled });
        if (modeSuffix && activeTemplateType !== "general") {
          const baseForMode = hasExplicitSystemPromptOverride ? systemPromptOverride ?? "" : import_prompts.BASE_SYSTEM_PROMPT;
          systemPromptOverride = `${baseForMode}

## ACTIVE MODE
${modeSuffix}`;
          hasExplicitSystemPromptOverride = true;
        }
      }
      const totalText = (context || "") + (modeContextBlock || "");
      const codeChars = (totalText.match(/[{}[\]();=<>"'`:\/\\,\n]/g) || []).length;
      isCodeHeavy = totalText.length > 800 && (codeChars > 500 || codeChars / totalText.length > 0.05);
      const willUseGroq = !isMultimodal && allowGroqFastText || this.isGroqModel(routeModelId);
      let COMBINED_CTX_CAP = 12e3;
      if (willUseGroq) {
        if (totalText.length > 12e3) {
          COMBINED_CTX_CAP = 4500;
        } else if (isCodeHeavy) {
          COMBINED_CTX_CAP = 4500;
        } else {
          COMBINED_CTX_CAP = 9e3;
        }
        if (process.env.DEBUG_CONTEXT === "true") {
          console.log("[LLMHelper] Context Density:", {
            length: totalText.length,
            codeChars,
            ratio: (codeChars / totalText.length).toFixed(3),
            isCodeHeavy,
            cap: COMBINED_CTX_CAP
          });
        }
      }
      if (context && context.length > COMBINED_CTX_CAP) {
        const parts = context.split(/\n(?=[^\n]{1,40}: )/);
        let out = "";
        for (let i = parts.length - 1; i >= 0; i--) {
          if (parts[i].length > COMBINED_CTX_CAP) {
            out = parts[i].slice(-COMBINED_CTX_CAP);
            break;
          }
          if (out.length + parts[i].length > COMBINED_CTX_CAP) break;
          out = parts[i] + (out ? "\n" + out : "");
        }
        context = "[...transcript truncated]\n" + (out.trim() || context.slice(-COMBINED_CTX_CAP));
        console.warn(`[LLMHelper] Transcript context clamped to ${COMBINED_CTX_CAP} chars (Groq=${willUseGroq}, codeHeavy=${COMBINED_CTX_CAP === 6e3})`);
      }
      if (modeContextBlock) {
        const existingLen = context?.length ?? 0;
        if (existingLen + modeContextBlock.length > COMBINED_CTX_CAP) {
          const available = Math.max(0, COMBINED_CTX_CAP - existingLen);
          const trimmed = available > 0 ? modeContextBlock.slice(0, available) + "\n[...mode context truncated]" : "";
          console.warn(`[LLMHelper] Combined context exceeded ${COMBINED_CTX_CAP} chars (Groq=${willUseGroq}) \u2014 mode context trimmed`);
          if (trimmed) context = context ? `${trimmed}

${context}` : trimmed;
        } else {
          context = context ? `${modeContextBlock}

${context}` : modeContextBlock;
        }
      }
      if (willUseGroq && context && context.length > COMBINED_CTX_CAP) {
        context = context.slice(-COMBINED_CTX_CAP);
      }
    } catch (_modeErr) {
      console.warn("[LLMHelper] ModesManager injection failed (non-fatal):", _modeErr?.message);
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
    const CODE_BOOST = `

Focus on preserving exact code logic.
Do not simplify critical parts.`;
    const VISION_BOOST = `

Focus on accurately interpreting the visual content.
Extract relevant details and ignore noise.`;
    const isLightweightEligible = !hasExplicitSystemPromptOverride && !context && !isMultimodal && !isCodeHeavy;
    let universalBase;
    if (isLightweightEligible) {
      universalBase = import_prompts.LIGHTWEIGHT_SYSTEM_PROMPT;
      console.log("[LLMHelper] \u26A1 Lightweight first-request mode: ~200 tokens instead of ~5000");
    } else {
      universalBase = FINAL_SYSTEM_PROMPT;
      if (isCodeHeavy) {
        universalBase += CODE_BOOST;
      } else if (isMultimodal) {
        universalBase += VISION_BOOST;
      }
    }
    let baseSystemPrompt = hasExplicitSystemPromptOverride ? systemPromptOverride ?? "" : universalBase;
    if (/system design|architecture_json/i.test(`${baseSystemPrompt}
${message}
${context || ""}`)) {
      const compactedBase = compactSystemDesignContracts(baseSystemPrompt);
      if (compactedBase !== baseSystemPrompt) {
        baseSystemPrompt = compactedBase;
        systemPromptOverride = compactedBase;
        hasExplicitSystemPromptOverride = true;
        console.warn("[LLMHelper] Prompt exceeded provider risk threshold \u2014 using compact mode.");
      }
    }
    const customNotesBlock = !skipCustomNotesInjection && this.customNotesEnabled && this.customNotes?.trim() ? `

<user_context>
${this.customNotes.trim().slice(0, 1500)}
</user_context>
Use this context naturally if relevant. Never quote it verbatim.` : "";
    const shouldOmitSystemPrompt = hasExplicitSystemPromptOverride && !baseSystemPrompt.trim() && !customNotesBlock.trim();
    let finalSystemPrompt = shouldOmitSystemPrompt ? "" : this.injectLanguageInstruction(baseSystemPrompt + customNotesBlock);
    let userContent = context ? `USER QUESTION:
${message}

CONTEXT:
${context}` : message;
    userContent = (0, import_TokenBudget.enforceTokenCap)(finalSystemPrompt, userContent, import_TokenBudget.TOKEN_CAP);
    if (!isMultimodal && (allowGroqFastText || this.isGroqModel(routeModelId) || routeModelId === "teamsync")) {
      const compacted = compactGroqTextPayload(finalSystemPrompt, userContent);
      if (compacted.changed) {
        finalSystemPrompt = compacted.systemPrompt;
        userContent = compacted.userContent;
      }
    }
    const preflightTotalTokens = (0, import_TokenBudget.estimateTokens)(finalSystemPrompt) + (0, import_TokenBudget.estimateTokens)(userContent);
    console.log(`[TokenBudget] Pre-flight: system=${(0, import_TokenBudget.estimateTokens)(finalSystemPrompt)} + user=${(0, import_TokenBudget.estimateTokens)(userContent)} = ${preflightTotalTokens} tok (cap=${import_TokenBudget.TOKEN_CAP})`);
    const selectedProvider = this.isGroqModel(routeModelId) || allowGroqFastText ? "groq" : this.isGeminiModel(routeModelId) ? "gemini" : routeUseOllama ? "local" : detectProviderLabel(routeModelId);
    const selectedBudget = selectedProvider === "groq" ? MODEL_BUDGETS.groq_llama_70b : selectedProvider === "local" ? MODEL_BUDGETS.local_model : MODEL_BUDGETS.gemini_flash;
    const requestSize = estimateModelRequestSize(
      selectedProvider,
      routeModelId,
      finalSystemPrompt,
      userContent,
      "safeTPM" in selectedBudget ? selectedBudget.safeTPM : selectedBudget.target
    );
    console.log("[MODEL_REQUEST_SIZE]", requestSize);
    let groqPromptStillOversized = false;
    if (selectedProvider === "groq" && !isMultimodal && requestSize.exceedsLimit) {
      const compacted = compactGroqPromptForBudget(
        finalSystemPrompt,
        userContent,
        routeModelId,
        MODEL_BUDGETS.groq_llama_70b.safeTPM
      );
      finalSystemPrompt = compacted.systemPrompt;
      userContent = compacted.userContent;
      const reducedRequestSize = estimateModelRequestSize(
        "groq",
        routeModelId,
        finalSystemPrompt,
        userContent,
        MODEL_BUDGETS.groq_llama_70b.safeTPM
      );
      console.log("[MODEL_REQUEST_SIZE]", reducedRequestSize);
      groqPromptStillOversized = compacted.stillExceeds;
      if (groqPromptStillOversized) {
        console.warn("[LLMHelper] Groq compact prompt still exceeds provider limit; falling back after compact attempt.");
      }
    }
    if (allowGroqFastText && !isMultimodal && !groqPromptStillOversized) {
      if (this.groqClient) {
        console.log(`[LLMHelper] \u26A1\uFE0F Groq Fast Text Mode Active (Streaming). Routing to local Groq...`);
        try {
          const groqFullMessage = `${finalSystemPrompt}

${userContent}`;
          yield* this.streamWithGroq(groqFullMessage, routeModelId, maxOutputTokens);
          return;
        } catch (e) {
          console.warn("[LLMHelper] Groq Fast Text streaming failed, falling back:", e.message);
          if (!allowProviderFallbacks) throw e;
        }
      }
      if (this.hasTeamSync()) {
        console.log(`[LLMHelper] \u26A1\uFE0F Groq Fast Text Mode Active (Streaming). Routing to TeamSync server Groq pool...`);
        try {
          yield* this.streamWithTeamSync(userContent, finalSystemPrompt, void 0, maxOutputTokens, allowGroqFastText);
          return;
        } catch (e) {
          console.warn("[LLMHelper] TeamSync fast-mode failed, falling back:", e.message);
          if (!allowProviderFallbacks) throw e;
        }
      }
    }
    if (routeUseOllama) {
      console.log(`[PROVIDER_INVOKE] provider=ollama model=${routeOllamaModel}`);
      yield* this.streamWithOllama(message, context, finalSystemPrompt, imagePaths, routeOllamaModel);
      return;
    }
    if (routeCustomProvider) {
      console.log(`[PROVIDER_INVOKE] provider=custom model=${routeCustomProvider.id} name=${routeCustomProvider.name}`);
      yield* this.streamWithCustom(message, context, imagePaths, finalSystemPrompt);
      return;
    }
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
    if (this.isBedrockModel(routeModelId) && this.bedrockClient) {
      const bedrockSystem = hasExplicitSystemPromptOverride ? systemPromptOverride ?? "" : import_prompts.OPENAI_SYSTEM_PROMPT;
      const finalBedrockSystem = this.injectLanguageInstruction(bedrockSystem);
      yield* this.streamWithBedrock(userContent, finalBedrockSystem, imagePaths, routeModelId, maxOutputTokens);
      return;
    }
    if (this.isOpenAiModel(routeModelId) && this.openaiClient) {
      const openAiSystem = hasExplicitSystemPromptOverride ? systemPromptOverride ?? "" : import_prompts.OPENAI_SYSTEM_PROMPT;
      const finalOpenAiSystem = this.injectLanguageInstruction(openAiSystem);
      if (isMultimodal && imagePaths) {
        yield* this.streamWithOpenaiMultimodal(userContent, imagePaths, finalOpenAiSystem, routeModelId, maxOutputTokens);
      } else {
        yield* this.streamWithOpenai(userContent, finalOpenAiSystem, routeModelId, maxOutputTokens);
      }
      return;
    }
    if (this.isClaudeModel(routeModelId) && this.claudeClient) {
      const claudeSystem = hasExplicitSystemPromptOverride ? systemPromptOverride ?? "" : import_prompts.CLAUDE_SYSTEM_PROMPT;
      const finalClaudeSystem = this.injectLanguageInstruction(claudeSystem);
      if (isMultimodal && imagePaths) {
        yield* this.streamWithClaudeMultimodal(userContent, imagePaths, finalClaudeSystem, routeModelId, maxOutputTokens);
      } else {
        yield* this.streamWithClaude(userContent, finalClaudeSystem, routeModelId, maxOutputTokens);
      }
      return;
    }
    if (this.isGroqModel(routeModelId) && this.groqClient && !groqPromptStillOversized) {
      if (isMultimodal && imagePaths) {
        const groqSystem = hasExplicitSystemPromptOverride ? systemPromptOverride ?? "" : import_prompts.OPENAI_SYSTEM_PROMPT;
        const finalGroqSystem = this.injectLanguageInstruction(groqSystem);
        yield* this.streamWithGroqMultimodal(userContent, imagePaths, finalGroqSystem, maxOutputTokens);
        return;
      }
      const groqFullMessage = `${finalSystemPrompt}

${userContent}`;
      try {
        yield* this.streamWithGroq(groqFullMessage, routeModelId, maxOutputTokens);
        return;
      } catch (groqTextErr) {
        console.warn(`[LLMHelper] \u26A0\uFE0F Groq text-only failed (${groqTextErr.message}), falling through to Gemini...`);
        if (!allowProviderFallbacks) throw groqTextErr;
      }
    }
    if (routeModelId === "teamsync") {
      const { CredentialsManager } = require("./services/CredentialsManager");
      const teamsyncKey = CredentialsManager.getInstance().getTeamSyncApiKey();
      if (teamsyncKey) {
        try {
          yield* this.streamWithTeamSync(userContent, finalSystemPrompt, imagePaths, maxOutputTokens, false);
          return;
        } catch (err) {
          console.warn("[LLMHelper] TeamSync API failed in streamChat, trying Groq fallback:", err.message);
          if (!allowProviderFallbacks) throw err;
          if (this.groqClient) {
            try {
              if (isMultimodal && imagePaths) {
                const groqSystem = hasExplicitSystemPromptOverride ? systemPromptOverride ?? "" : import_prompts.OPENAI_SYSTEM_PROMPT;
                const finalGroqSystem = this.injectLanguageInstruction(groqSystem);
                yield* this.streamWithGroqMultimodal(userContent, imagePaths, finalGroqSystem, maxOutputTokens);
              } else {
                const groqSystem = hasExplicitSystemPromptOverride ? baseSystemPrompt : universalBase;
                const finalGroqSystem = this.injectLanguageInstruction(groqSystem);
                yield* this.streamWithGroq(`${finalGroqSystem}

${userContent}`, GROQ_MODEL, maxOutputTokens);
              }
              return;
            } catch (groqErr) {
              console.warn("[LLMHelper] Groq fallback also failed, trying Gemini:", groqErr.message);
              if (!allowProviderFallbacks) throw groqErr;
            }
          }
        }
      }
    }
    if (this.client) {
      if (this.isGeminiModel(routeModelId)) {
        const fullMsg = `${finalSystemPrompt}

${userContent}`;
        yield* this.streamWithGeminiModel(fullMsg, routeModelId, imagePaths, maxOutputTokens);
        return;
      }
      if (!allowProviderFallbacks) {
        throw new Error(`Provider fallback disabled for requested model ${routeModelId}`);
      }
      const raceMsg = `${finalSystemPrompt}

${userContent}`;
      yield* this.streamWithGeminiParallelRace(raceMsg, imagePaths);
      return;
    }
    if (this.hasTeamSync()) {
      try {
        yield* this.streamWithTeamSync(userContent, finalSystemPrompt, imagePaths, maxOutputTokens, allowGroqFastText);
        return;
      } catch (e) {
        console.warn("[LLMHelper] TeamSync last-resort fallback failed:", e.message);
        if (!allowProviderFallbacks) throw e;
      }
    }
    throw new Error("No AI provider configured. Please add at least one API key in Settings.");
  }
  streamStructuredPrompt(prompt, imagePaths, runtimeOptions) {
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
        disableProviderFallbacks: runtimeOptions?.disableProviderFallbacks
      }
    );
  }
  invoke(args) {
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
        disableProviderFallbacks: true
      }
    );
  }
  /**
   * Fake-stream for TeamSync API (non-streaming endpoint).
   * Yields the full response in small word-batches so the UI typing effect still plays.
   * Throws on empty response so the fallback chain tries the next provider.
   */
  async *streamWithTeamSync(userContent, systemPrompt, imagePaths, maxOutputTokens, fastMode = this.groqFastTextMode) {
    let teamsyncKey = this.teamsyncKey;
    if (!teamsyncKey) {
      const { CredentialsManager } = require("./services/CredentialsManager");
      teamsyncKey = CredentialsManager.getInstance().getTeamSyncApiKey() || null;
    }
    if (!teamsyncKey) throw new Error("TeamSync API key not set");
    const body = {
      messages: [{ role: "user", content: userContent }],
      stream: true
    };
    if (maxOutputTokens) body.max_tokens = maxOutputTokens;
    if (fastMode && (!imagePaths || imagePaths.length === 0)) body.fast_mode = true;
    if (systemPrompt) body.system = systemPrompt;
    if (this.aiResponseLanguage && this.aiResponseLanguage !== "English") {
      body.language = this.aiResponseLanguage;
    }
    if (imagePaths?.length) {
      const images = [];
      for (const p of imagePaths) {
        if (import_fs.default.existsSync(p)) {
          const imageData = await import_fs.default.promises.readFile(p);
          images.push({ mime_type: "image/png", data: imageData.toString("base64") });
        }
      }
      if (images.length) body.images = images;
    }
    const streamHeaders = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "x-teamsync-key": teamsyncKey
    };
    const response = await fetch("https://api.teamsync-ai.vercel.app/v1/chat", {
      method: "POST",
      headers: streamHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6e4)
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(`TeamSync API ${response.status}: ${errData.error || "unknown"}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break outer;
          let chunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }
          if (chunk.error) throw new Error(`Server error: ${chunk.error}`);
          if (typeof chunk.delta === "string" && chunk.delta) yield chunk.delta;
        }
      }
    } finally {
      try {
        reader.cancel();
      } catch {
      }
    }
  }
  /**
   * Stream response from Groq
   */
  async *streamWithGroq(fullMessage, modelId = GROQ_MODEL, maxOutputTokens = 8192) {
    if (!this.groqClient && !this.groqKeyManager.hasAvailableKey()) throw new Error("Groq client not initialized");
    const size = estimateModelRequestSize(
      "groq",
      modelId,
      "",
      fullMessage,
      MODEL_BUDGETS.groq_llama_70b.safeTPM
    );
    console.log("[MODEL_REQUEST_SIZE]", size);
    let requestMessage = fullMessage;
    if (size.exceedsLimit) {
      const compacted = compactGroqFullMessageForBudget(fullMessage, modelId, MODEL_BUDGETS.groq_llama_70b.safeTPM);
      requestMessage = compacted.fullMessage;
      const reducedSize = estimateModelRequestSize(
        "groq",
        modelId,
        "",
        requestMessage,
        MODEL_BUDGETS.groq_llama_70b.safeTPM
      );
      console.log("[MODEL_REQUEST_SIZE]", reducedSize);
      if (compacted.stillExceeds) {
        throw new Error("Groq compact prompt still exceeds provider limit.");
      }
    }
    yield* this.groqRotatingClient.chatCompletionStream({
      model: modelId,
      messages: [{ role: "user", content: requestMessage }],
      stream: true,
      temperature: 0.4,
      max_tokens: maxOutputTokens
    });
  }
  /**
   * Stream multimodal (image + text) response from Groq using Llama 4 Scout as a last resort
   */
  async *streamWithGroqMultimodal(userMessage, imagePaths, systemPrompt, maxOutputTokens = 8192) {
    if (!this.groqClient && !this.groqKeyManager.hasAvailableKey()) throw new Error("Groq client not initialized");
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    const contentParts = [{ type: "text", text: userMessage }];
    for (const p of imagePaths) {
      if (import_fs.default.existsSync(p)) {
        const { mimeType, data } = await this.processImage(p);
        contentParts.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });
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
  async *streamWithOpenai(userMessage, systemPrompt, modelId, maxOutputTokens = MAX_OUTPUT_TOKENS) {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");
    const model = modelId || (this.isOpenAiModel(this.currentModelId) ? this.currentModelId : OPENAI_MODEL);
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userMessage });
    const stream = await this.openaiClient.chat.completions.create({
      model,
      messages,
      stream: true,
      max_completion_tokens: model.toLowerCase().includes("claude") ? Math.min(maxOutputTokens, CLAUDE_MAX_OUTPUT_TOKENS) : maxOutputTokens
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
  async *streamWithBedrock(userMessage, systemPrompt, imagePaths, modelId, maxOutputTokens = BEDROCK_MAX_OUTPUT_TOKENS) {
    if (!this.bedrockClient) throw new Error("Bedrock client not initialized");
    let model = modelId || this.currentModelId;
    try {
      model = await this.resolveBedrockRuntimeModel(imagePaths, model);
      console.log("[BEDROCK_ROUTE]", { provider: "bedrock", model });
      yield* this.bedrockClient.stream(userMessage, {
        modelId: model,
        systemPrompt,
        imagePaths,
        maxOutputTokens
      });
    } catch (error) {
      this.notifyBedrockReauthenticationRequired(error, model);
      throw error;
    }
  }
  /**
   * Stream response from Claude with proper system/user message separation
   */
  async *streamWithClaude(userMessage, systemPrompt, modelId, maxOutputTokens = CLAUDE_MAX_OUTPUT_TOKENS) {
    if (!this.claudeClient) throw new Error("Claude client not initialized");
    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);
    const stream = await this.claudeClient.messages.stream({
      model,
      max_tokens: Math.min(maxOutputTokens, CLAUDE_MAX_OUTPUT_TOKENS),
      ...systemPrompt ? { system: systemPrompt } : {},
      messages: [{ role: "user", content: userMessage }]
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
  /**
   * Stream multimodal (image + text) response from OpenAI with system/user separation
   */
  async *streamWithOpenaiMultimodal(userMessage, imagePaths, systemPrompt, modelId, maxOutputTokens = MAX_OUTPUT_TOKENS) {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");
    const model = modelId || (this.isOpenAiModel(this.currentModelId) ? this.currentModelId : OPENAI_MODEL);
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    const contentParts = [{ type: "text", text: userMessage }];
    for (const p of imagePaths) {
      if (import_fs.default.existsSync(p)) {
        const imageData = await import_fs.default.promises.readFile(p);
        contentParts.push({ type: "image_url", image_url: { url: `data:image/png;base64,${imageData.toString("base64")}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });
    const stream = await this.openaiClient.chat.completions.create({
      model,
      messages,
      stream: true,
      max_completion_tokens: model.toLowerCase().includes("claude") ? Math.min(maxOutputTokens, CLAUDE_MAX_OUTPUT_TOKENS) : maxOutputTokens
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
  async *streamWithClaudeMultimodal(userMessage, imagePaths, systemPrompt, modelId, maxOutputTokens = CLAUDE_MAX_OUTPUT_TOKENS) {
    if (!this.claudeClient) throw new Error("Claude client not initialized");
    const model = modelId || (this.isClaudeModel(this.currentModelId) ? this.currentModelId : CLAUDE_MODEL);
    const imageContentParts = [];
    for (const p of imagePaths) {
      if (import_fs.default.existsSync(p)) {
        const imageData = await import_fs.default.promises.readFile(p);
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
      ...systemPrompt ? { system: systemPrompt } : {},
      messages: [{
        role: "user",
        content: [
          ...imageContentParts,
          { type: "text", text: userMessage }
        ]
      }]
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
  /**
   * Stream response from a specific Gemini model
   */
  async *streamWithGeminiModel(fullMessage, model, imagePaths, maxOutputTokens = MAX_OUTPUT_TOKENS) {
    if (!this.client) throw new Error("Gemini client not initialized");
    const contents = [{ text: fullMessage }];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (import_fs.default.existsSync(p)) {
          const imageData = await import_fs.default.promises.readFile(p);
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
      model,
      contents,
      config: {
        maxOutputTokens,
        temperature: 0.4
      }
    });
    const stream = streamResult.stream || streamResult;
    for await (const chunk of stream) {
      let chunkText = "";
      if (typeof chunk.text === "function") {
        chunkText = chunk.text();
      } else if (typeof chunk.text === "string") {
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
  async *streamWithGeminiParallelRace(fullMessage, imagePaths) {
    if (!this.client) throw new Error("Gemini client not initialized");
    const flashPromise = this.collectStreamResponse(fullMessage, GEMINI_FLASH_MODEL, imagePaths);
    const proPromise = this.collectStreamResponse(fullMessage, GEMINI_PRO_MODEL, imagePaths);
    const result = await Promise.any([flashPromise, proPromise]);
    const chunkSize = 10;
    for (let i = 0; i < result.length; i += chunkSize) {
      yield result.substring(i, i + chunkSize);
    }
  }
  /**
   * Collect full response from a Gemini model (non-streaming for race)
   */
  async collectStreamResponse(fullMessage, model, imagePaths) {
    if (!this.client) throw new Error("Gemini client not initialized");
    const contents = [{ text: fullMessage }];
    if (imagePaths?.length) {
      for (const p of imagePaths) {
        if (import_fs.default.existsSync(p)) {
          const imageData = await import_fs.default.promises.readFile(p);
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
      model,
      contents,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4
      }
    });
    return response.text || "";
  }
  // --- OLLAMA STREAMING ---
  async *streamWithOllama(message, context, systemPrompt = import_prompts.UNIVERSAL_SYSTEM_PROMPT, imagePaths, modelOverride) {
    const fullPrompt = context ? `SYSTEM: ${systemPrompt}
CONTEXT: ${context}
USER: ${message}` : `SYSTEM: ${systemPrompt}
USER: ${message}`;
    let images;
    if (imagePaths?.length) {
      const encoded = [];
      for (const p of imagePaths) {
        try {
          const data = await import_fs.default.promises.readFile(p);
          encoded.push(data.toString("base64"));
        } catch (e) {
          console.warn("[LLMHelper] streamWithOllama: failed to read image, skipping:", p, e);
        }
      }
      if (encoded.length) images = encoded;
    }
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelOverride || this.ollamaModel,
          prompt: fullPrompt,
          stream: true,
          ...images ? { images } : {},
          options: { temperature: 0.7 }
        })
      });
      if (!response.body) throw new Error("No response body from Ollama");
      for await (const chunk of response.body) {
        const text = new TextDecoder().decode(chunk);
        const lines = text.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.response) yield json.response;
            if (json.done) return;
          } catch (e) {
          }
        }
      }
    } catch (e) {
      console.error("Ollama streaming failed", e);
      yield "Error: Failed to stream from Ollama.";
    }
  }
  // --- CUSTOM PROVIDER STREAMING ---
  async *streamWithCustom(message, context, imagePaths, systemPrompt = import_prompts.UNIVERSAL_SYSTEM_PROMPT) {
    if (!this.customProvider) return;
    const curlCommand = this.customProvider.curlCommand;
    const requestConfig = (0, import_curl_to_json.default)(curlCommand);
    let base64Image = "";
    if (imagePaths?.length) {
      try {
        const data = await import_fs.default.promises.readFile(imagePaths[0]);
        base64Image = data.toString("base64");
      } catch (e) {
      }
    }
    const combinedMessage = context ? `${context}

${message}` : message;
    const variables = {
      TEXT: combinedMessage,
      PROMPT: combinedMessage,
      SYSTEM_PROMPT: systemPrompt,
      USER_MESSAGE: message,
      CONTEXT: context || "",
      IMAGE_BASE64: base64Image
    };
    const url = (0, import_curlUtils.deepVariableReplacer)(requestConfig.url, variables);
    const headers = (0, import_curlUtils.deepVariableReplacer)(requestConfig.header || {}, variables);
    let body = (0, import_curlUtils.deepVariableReplacer)(requestConfig.data || {}, variables);
    if (base64Image && imagePaths?.[0]) {
      body = (0, import_curlUtils.injectImageIntoMessages)(body, base64Image, imagePaths[0]);
    }
    const streamAbort = new AbortController();
    const streamTimeout = setTimeout(() => streamAbort.abort(), 3e4);
    try {
      const response = await fetch(url, {
        method: requestConfig.method || "POST",
        headers,
        body: JSON.stringify(body),
        signal: streamAbort.signal
      });
      clearTimeout(streamTimeout);
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Custom Provider HTTP ${response.status}: errorLength=${errorText.length} redacted=true`);
        yield `Error: Custom Provider returned HTTP ${response.status}`;
        return;
      }
      if (!response.body) return;
      let fullBody = "";
      let yieldedAny = false;
      for await (const chunk of response.body) {
        const text = new TextDecoder().decode(chunk);
        fullBody += text;
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          const items = this.parseStreamLine(line);
          if (items) {
            yield items;
            yieldedAny = true;
          }
        }
      }
      if (!yieldedAny && fullBody.trim().length > 0 && !fullBody.trim().startsWith("data: ")) {
        try {
          const data = JSON.parse(fullBody);
          const extracted = this.extractFromCommonFormats(data);
          if (extracted) yield extracted;
        } catch {
          if (fullBody.length < 5e3) yield fullBody.trim();
        }
      }
    } catch (e) {
      clearTimeout(streamTimeout);
      console.error("Custom streaming failed", e);
      yield "Error streaming from custom provider.";
    }
  }
  parseStreamLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("data: ")) {
      if (trimmed === "data: [DONE]") return null;
      try {
        const json = JSON.parse(trimmed.substring(6));
        return this.extractFromCommonFormats(json);
      } catch {
        return null;
      }
    }
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
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  isUsingOllama() {
    return this.useOllama;
  }
  async getOllamaModels() {
    const baseUrl = (this.ollamaUrl || "http://127.0.0.1:11434").replace("localhost", "127.0.0.1");
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1e3);
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) return [];
      const data = await response.json();
      if (data && data.models) {
        return data.models.map((m) => m.name);
      }
      return [];
    } catch (error) {
      return [];
    }
  }
  async forceRestartOllama() {
    try {
      console.log("[LLMHelper] Attempting to force restart Ollama...");
      try {
        const { stdout } = await execAsync(`lsof -t -i:11434`);
        const pids = stdout.trim().split(/\s+/).filter((p) => /^\d+$/.test(p));
        for (const pid of pids) {
          console.log(`[LLMHelper] Found blocking PID: ${pid}. Killing...`);
          await execAsync(`kill -9 ${pid}`);
        }
        if (pids.length === 0 && stdout.trim()) {
          console.warn(`[LLMHelper] Unexpected lsof output (no valid PIDs): "${stdout.trim().substring(0, 50)}". Skipping kill.`);
        }
      } catch (e) {
        if (!e.message?.includes("exit code 1") && e.code !== 1) {
          console.warn("[LLMHelper] lsof error (non-fatal):", e.message);
        }
      }
      const { OllamaManager } = require("./services/OllamaManager");
      await OllamaManager.getInstance().init();
      return true;
    } catch (error) {
      console.error("[LLMHelper] Failed to restart Ollama:", error);
      return false;
    }
  }
  getCurrentProvider() {
    if (this.customProvider) return "custom";
    if (this.activeCurlProvider) return "custom";
    if (this.isBedrockModel(this.currentModelId)) return "bedrock";
    return this.useOllama ? "ollama" : this.getProviderForModel(this.currentModelId);
  }
  getCurrentModel() {
    if (this.customProvider) return this.customProvider.name;
    if (this.activeCurlProvider) return this.activeCurlProvider.id;
    return this.useOllama ? this.ollamaModel : this.currentModelId;
  }
  /**
   * Get the Gemini client for mode-specific LLMs
   * Used by AnswerLLM, AssistLLM, FollowUpLLM, RecapLLM
   * RETURNS A PROXY client that handles retries and fallbacks transparently
   */
  getGeminiClient() {
    if (!this.client) return null;
    return this.createRobustClient(this.client);
  }
  /**
   * Get the Groq client for mode-specific LLMs
   */
  getGroqClient() {
    return this.groqClient;
  }
  /**
   * Check if Groq is available
   */
  hasGroq() {
    return this.groqClient !== null;
  }
  hasGemini() {
    return this.client !== null;
  }
  /**
   * Get the OpenAI client for mode-specific LLMs
   */
  getOpenaiClient() {
    return this.openaiClient;
  }
  /**
   * Get the Claude client for mode-specific LLMs
   */
  getClaudeClient() {
    return this.claudeClient;
  }
  /**
   * Check if OpenAI is available
   */
  hasOpenai() {
    return this.openaiClient !== null;
  }
  /**
   * Check if Claude is available
   */
  hasClaude() {
    return this.claudeClient !== null;
  }
  /**
   * Stream with Groq using a specific prompt, with Gemini fallback
   * Used by mode-specific LLMs (RecapLLM, FollowUpLLM, WhatToAnswerLLM)
   * @param groqMessage - Message with Groq-optimized prompt
   * @param geminiMessage - Message with Gemini prompt (for fallback)
   * @param config - Optional temperature and max tokens
   */
  async *streamWithGroqOrGemini(groqMessage, geminiMessage, config) {
    const temperature = config?.temperature ?? 0.3;
    const maxTokens = config?.maxTokens ?? 8192;
    if (this.groqClient || this.groqKeyManager.hasAvailableKey()) {
      try {
        console.log(`[LLMHelper] \u{1F680} Mode-specific Groq stream starting (key rotation enabled)...`);
        yield* this.groqRotatingClient.chatCompletionStream({
          model: GROQ_MODEL,
          messages: [{ role: "user", content: groqMessage }],
          stream: true,
          temperature,
          max_tokens: maxTokens
        });
        console.log(`[LLMHelper] \u2705 Mode-specific Groq stream completed`);
        return;
      } catch (err) {
        console.warn(`[LLMHelper] \u26A0\uFE0F Groq mode-specific failed (all keys exhausted): ${err.message}, falling back to Gemini`);
      }
    }
    if (this.client) {
      console.log(`[LLMHelper] \u{1F504} Falling back to Gemini for mode-specific request...`);
      yield* this.streamWithGeminiModel(geminiMessage, GEMINI_FLASH_MODEL);
    } else {
      throw new Error("No LLM provider available");
    }
  }
  /**
   * Creates a proxy around the real Gemini client to intercept generation calls
   * and apply robust retry/fallback logic without modifying consumer code.
   */
  createRobustClient(realClient) {
    const modelsProxy = new Proxy(realClient.models, {
      get: (target, prop, receiver) => {
        if (prop === "generateContent") {
          return async (args) => {
            return this.generateWithFallback(realClient, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });
    return new Proxy(realClient, {
      get: (target, prop, receiver) => {
        if (prop === "models") {
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
  async generateWithFallback(client, args) {
    const originalModel = args.model;
    const isValidResponse = (response) => {
      const candidate = response.candidates?.[0];
      if (!candidate) return false;
      if (response.text && response.text.trim().length > 0) return true;
      if (candidate.content?.parts?.[0]?.text && candidate.content.parts[0].text.trim().length > 0) return true;
      if (typeof candidate.content === "string" && candidate.content.trim().length > 0) return true;
      return false;
    };
    try {
      const response = await client.models.generateContent({
        ...args,
        model: originalModel
      });
      if (isValidResponse(response)) return response;
      console.warn(`[LLMHelper] Initial ${originalModel} call returned empty/invalid response.`);
    } catch (error) {
      console.warn(`[LLMHelper] Initial ${originalModel} call failed: ${error.message}`);
    }
    console.log(`[LLMHelper] \u{1F680} Triggering Speculative Parallel Retry (Flash + Pro)...`);
    const flashRetryPromise = (async () => {
      try {
        const res = await client.models.generateContent({ ...args, model: originalModel });
        if (isValidResponse(res)) return { type: "flash", res };
        throw new Error("Empty Flash Response");
      } catch (e) {
        throw e;
      }
    })();
    const proBackupPromise = (async () => {
      try {
        const res = await client.models.generateContent({ ...args, model: GEMINI_PRO_MODEL });
        if (isValidResponse(res)) return { type: "pro", res };
        throw new Error("Empty Pro Response");
      } catch (e) {
        throw e;
      }
    })();
    try {
      const winner = await Promise.any([flashRetryPromise, proBackupPromise]);
      console.log(`[LLMHelper] Parallel race won by: ${winner.type}`);
      return winner.res;
    } catch (aggregateError) {
      console.warn(`[LLMHelper] Both parallel retry attempts failed.`);
    }
    console.log(`[LLMHelper] \u26A0\uFE0F All parallel attempts failed. Trying Flash one last time...`);
    try {
      return await client.models.generateContent({ ...args, model: originalModel });
    } catch (finalError) {
      console.error(`[LLMHelper] Final retry failed.`);
      throw finalError;
    }
  }
  async withTimeout(promise, timeoutMs, operationName) {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    promise.catch(() => {
    });
    return Promise.race([
      promise.then((result) => {
        clearTimeout(timeoutHandle);
        return result;
      }),
      timeoutPromise
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
  async generateMeetingSummary(systemPrompt, context, groqSystemPrompt) {
    console.log(`[LLMHelper] generateMeetingSummary called. Context length: ${context.length}`);
    const estimateTokens2 = (text) => Math.ceil(text.length / 4);
    const tokenCount = estimateTokens2(context);
    console.log(`[LLMHelper] Estimated tokens: ${tokenCount}`);
    if (this.customProvider || this.activeCurlProvider) {
      try {
        console.log(`[LLMHelper] Attempting custom provider for summary...`);
        const collectChunks = async () => {
          let result = "";
          for await (const chunk of this.streamChat(`Context:
${context}`, void 0, void 0, systemPrompt, true)) {
            result += chunk;
          }
          return result;
        };
        const text = await this.withTimeout(collectChunks(), 6e4, "Custom Provider Summary");
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] \u2705 Custom provider summary generated successfully.`);
          return this.processResponse(text);
        }
      } catch (e) {
        console.warn(`[LLMHelper] \u26A0\uFE0F Custom provider summary failed: ${e.message}. Falling back...`);
      }
    }
    if (this.hasTeamSync()) {
      try {
        console.log(`[LLMHelper] Attempting TeamSync API for summary...`);
        const text = await this.withTimeout(
          this.generateWithTeamSync(`Context:
${context}`, systemPrompt),
          6e4,
          "TeamSync Summary"
        );
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] \u2705 TeamSync API summary generated successfully.`);
          return this.processResponse(text);
        }
      } catch (e) {
        console.warn(`[LLMHelper] \u26A0\uFE0F TeamSync API summary failed: ${e.message}. Falling back...`);
      }
    }
    if ((this.groqClient || this.groqKeyManager.hasAvailableKey()) && tokenCount < 1e5) {
      console.log(`[LLMHelper] Attempting Groq for summary (key rotation enabled)...`);
      try {
        const groqPrompt = groqSystemPrompt || systemPrompt;
        const response = await this.withTimeout(
          this.groqRotatingClient.chatCompletion({
            model: GROQ_MODEL,
            messages: [
              { role: "system", content: groqPrompt },
              { role: "user", content: `Context:
${context}` }
            ],
            temperature: 0.3,
            max_tokens: 8192
          }),
          45e3,
          "Groq Summary"
        );
        const text = response.choices[0]?.message?.content || "";
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] \u2705 Groq summary generated successfully.`);
          return this.processResponse(text);
        }
      } catch (e) {
        console.warn(`[LLMHelper] \u26A0\uFE0F Groq summary failed (all keys exhausted): ${e.message}. Falling back to Gemini...`);
      }
    } else {
      if (tokenCount >= 1e5) {
        console.log(`[LLMHelper] Context too large for Groq (${tokenCount} tokens). Skipping straight to Gemini.`);
      }
    }
    console.log(`[LLMHelper] Attempting Gemini Flash for summary...`);
    const contents = [{ text: `${systemPrompt}

CONTEXT:
${context}` }];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = await this.withTimeout(
          this.generateWithFlash(contents),
          45e3,
          `Gemini Flash Summary (Attempt ${attempt})`
        );
        if (text.trim().length > 0) {
          console.log(`[LLMHelper] \u2705 Gemini Flash summary generated successfully (Attempt ${attempt}).`);
          return this.processResponse(text);
        }
      } catch (e) {
        console.warn(`[LLMHelper] \u26A0\uFE0F Gemini Flash attempt ${attempt}/3 failed: ${e.message}`);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 1e3 * attempt));
        }
      }
    }
    console.log(`[LLMHelper] \u26A0\uFE0F Flash exhausted. Switching to Gemini Pro for robust retry...`);
    const maxProRetries = 5;
    if (this.client) {
      for (let attempt = 1; attempt <= maxProRetries; attempt++) {
        try {
          console.log(`[LLMHelper] \u{1F504} Gemini Pro Attempt ${attempt}/${maxProRetries}...`);
          const response = await this.withTimeout(
            // @ts-ignore
            this.client.models.generateContent({
              model: GEMINI_PRO_MODEL,
              contents,
              config: {
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                temperature: 0.3
              }
            }),
            6e4,
            `Gemini Pro Summary (Attempt ${attempt})`
          );
          const text = response.text || "";
          if (text.trim().length > 0) {
            console.log(`[LLMHelper] \u2705 Gemini Pro summary generated successfully.`);
            return this.processResponse(text);
          }
        } catch (e) {
          console.warn(`[LLMHelper] \u26A0\uFE0F Gemini Pro attempt ${attempt} failed: ${e.message}`);
          const backoff = 2e3 * Math.pow(2, attempt - 1);
          console.log(`[LLMHelper] Waiting ${backoff}ms before next retry...`);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    } else {
      console.log(`[LLMHelper] Gemini client not initialized \u2014 skipping Gemini Pro.`);
    }
    throw new Error("Failed to generate summary after all fallback attempts.");
  }
  async switchToOllama(model, url) {
    this.useOllama = true;
    if (url) this.ollamaUrl = url;
    if (model) {
      this.ollamaModel = model;
    } else {
      await this.initializeOllamaModel();
    }
  }
  async switchToGemini(apiKey, modelId) {
    if (modelId) {
      this.geminiModel = modelId;
    }
    if (apiKey) {
      this.apiKey = apiKey;
      this.client = new import_genai.GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: "v1alpha" }
      });
    } else if (!this.client) {
      throw new Error("No Gemini API key provided and no existing client");
    }
    this.useOllama = false;
    this.customProvider = null;
  }
  async switchToCustom(provider) {
    this.customProvider = provider;
    this.useOllama = false;
    this.client = null;
    this.groqClient = null;
    this.openaiClient = null;
    this.claudeClient = null;
    console.log(`[LLMHelper] Switched to Custom Provider: ${provider.name}`);
  }
  async testConnection() {
    try {
      if (this.useOllama) {
        const available = await this.checkOllamaAvailable();
        if (!available) {
          return { success: false, error: `Ollama not available at ${this.ollamaUrl}` };
        }
        await this.callOllama("Hello");
        return { success: true };
      } else {
        if (!this.client) {
          return { success: false, error: "No Gemini client configured" };
        }
        const text = await this.generateContent([{ text: "Hello" }]);
        if (text) {
          return { success: true };
        } else {
          return { success: false, error: "Empty response from Gemini" };
        }
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  /**
   * Universal Chat (Non-streaming)
   */
  async chat(message, imagePaths, context, systemPromptOverride) {
    let fullResponse = "";
    for await (const chunk of this.streamChat(message, imagePaths, context, systemPromptOverride)) {
      fullResponse += chunk;
    }
    return fullResponse;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LLMHelper,
  isBedrockReauthenticationError
});
//# sourceMappingURL=LLMHelper.js.map
