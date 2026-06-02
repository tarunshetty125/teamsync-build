import crypto from 'crypto';
import type http from 'http';
import { Router, type Request, type Response } from 'express';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { getBackendConfig, type BackendConfig } from '../config/env';
import {
  getTeamSyncUsageCollection,
  type TeamSyncUsageDocument,
} from '../db/mongodb';

type ValidationResult<T> =
  | { ok: true; value: T; status?: undefined; error?: undefined }
  | { ok: false; value?: undefined; status: number; error: string };

export interface TeamSyncImagePayload {
  mime_type: string;
  data: string;
}

export interface TeamSyncChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TeamSyncChatPayload {
  messages: TeamSyncChatMessage[];
  stream: boolean;
  max_tokens?: number;
  fast_mode: boolean;
  system?: string;
  language?: string;
  images?: TeamSyncImagePayload[];
}

export interface TeamSyncTranscribeHandshake {
  key: string;
  sample_rate: number;
  language: string;
  language_alternates: string[];
  audio_channels: number;
  channel?: 'system' | 'mic' | 'user' | 'interviewer';
}

export interface TeamSyncUsageLimits {
  aiRequests: number;
  sttMinutes: number;
  searchRequests: number;
}

interface UsageResponse {
  plan: string;
  quota: {
    transcription: { used: number; limit: number; remaining: number };
    ai: { used: number; limit: number; remaining: number };
    search: { used: number; limit: number; remaining: number };
    resets_at: string;
  };
  usage: { ai: number; stt_seconds: number; search: number };
  member_since: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function getOptionalPositiveInt(value: unknown, label: string, max: number): ValidationResult<number | undefined> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    return { ok: false, status: 400, error: `${label} must be an integer between 1 and ${max}` };
  }
  return { ok: true, value: value as number };
}

export function validateTeamSyncApiKey(raw: unknown): ValidationResult<string> {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) {
    return { ok: false, status: 401, error: 'TeamSync API key is required' };
  }
  if (key.length < 8 || key.length > 512) {
    return { ok: false, status: 401, error: 'invalid_key_format' };
  }
  return { ok: true, value: key };
}

function readTeamSyncApiKey(req: Request): ValidationResult<string> {
  const headerKey = req.header('x-teamsync-key');
  const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  return validateTeamSyncApiKey(headerKey || bearer || '');
}

export function hashTeamSyncApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function validateChatPayload(body: unknown): ValidationResult<TeamSyncChatPayload> {
  if (!isPlainObject(body)) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object' };
  }

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length < 1 || rawMessages.length > 64) {
    return { ok: false, status: 400, error: 'messages must contain between 1 and 64 entries' };
  }

  const messages: TeamSyncChatMessage[] = [];
  for (const message of rawMessages) {
    if (!isPlainObject(message)) {
      return { ok: false, status: 400, error: 'Each message must be an object' };
    }
    const role = message.role;
    const content = getString(message.content);
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      return { ok: false, status: 400, error: 'message.role must be system, user, or assistant' };
    }
    if (!content || content.length > 200_000) {
      return { ok: false, status: 400, error: 'message.content must be a non-empty string under 200000 characters' };
    }
    messages.push({ role, content });
  }

  const maxTokens = getOptionalPositiveInt(body.max_tokens, 'max_tokens', 65_536);
  if (!maxTokens.ok) {
    return { ok: false, status: maxTokens.status, error: maxTokens.error };
  }

  const system = getString(body.system);
  if (system !== null && system.length > 100_000) {
    return { ok: false, status: 400, error: 'system must be under 100000 characters' };
  }

  const language = getString(body.language);
  if (language !== null && language.length > 80) {
    return { ok: false, status: 400, error: 'language must be under 80 characters' };
  }

  let images: TeamSyncImagePayload[] | undefined;
  if (body.images !== undefined) {
    if (!Array.isArray(body.images) || body.images.length > 8) {
      return { ok: false, status: 400, error: 'images must be an array with at most 8 entries' };
    }
    images = [];
    for (const image of body.images) {
      if (!isPlainObject(image)) {
        return { ok: false, status: 400, error: 'Each image must be an object' };
      }
      const mimeType = getString(image.mime_type);
      const data = getString(image.data);
      if (!mimeType || !/^image\/(png|jpeg|jpg|webp)$/i.test(mimeType)) {
        return { ok: false, status: 400, error: 'image.mime_type must be png, jpeg, or webp' };
      }
      if (!data || data.length > 6_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        return { ok: false, status: 400, error: 'image.data must be base64 and under 6000000 characters' };
      }
      images.push({ mime_type: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, data });
    }
  }

  return {
    ok: true,
    value: {
      messages,
      stream: getBoolean(body.stream, false),
      max_tokens: maxTokens.value,
      fast_mode: getBoolean(body.fast_mode, false),
      system: system || undefined,
      language: language || undefined,
      images: images && images.length > 0 ? images : undefined,
    },
  };
}

export function validateTranscribeHandshake(value: unknown): ValidationResult<TeamSyncTranscribeHandshake> {
  if (!isPlainObject(value)) {
    return { ok: false, status: 400, error: 'Auth frame must be a JSON object' };
  }

  const key = validateTeamSyncApiKey(value.key);
  if (!key.ok) {
    return { ok: false, status: key.status, error: key.error };
  }

  const sampleRate = value.sample_rate;
  if (!Number.isInteger(sampleRate) || (sampleRate as number) < 8_000 || (sampleRate as number) > 96_000) {
    return { ok: false, status: 400, error: 'sample_rate must be an integer between 8000 and 96000' };
  }

  const audioChannels = value.audio_channels ?? 1;
  if (!Number.isInteger(audioChannels) || (audioChannels as number) < 1 || (audioChannels as number) > 2) {
    return { ok: false, status: 400, error: 'audio_channels must be 1 or 2' };
  }

  const language = getString(value.language) || 'auto';
  if (language.length > 80) {
    return { ok: false, status: 400, error: 'language must be under 80 characters' };
  }

  const alternates = value.language_alternates;
  if (alternates !== undefined && !Array.isArray(alternates)) {
    return { ok: false, status: 400, error: 'language_alternates must be an array' };
  }

  const languageAlternates = (Array.isArray(alternates) ? alternates : [])
    .filter((item): item is string => typeof item === 'string')
    .slice(0, 10);

  const channel = value.channel;
  if (
    channel !== undefined &&
    channel !== 'system' &&
    channel !== 'mic' &&
    channel !== 'user' &&
    channel !== 'interviewer'
  ) {
    return { ok: false, status: 400, error: 'channel must be system, mic, user, or interviewer' };
  }

  return {
    ok: true,
    value: {
      key: key.value,
      sample_rate: sampleRate as number,
      language,
      language_alternates: languageAlternates,
      audio_channels: audioChannels as number,
      channel: channel as TeamSyncTranscribeHandshake['channel'],
    },
  };
}

function nextMonthlyReset(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

export function getTeamSyncUsageLimits(config: BackendConfig = getBackendConfig()): TeamSyncUsageLimits {
  return {
    aiRequests: config.teamSyncQuotaAiRequests,
    sttMinutes: config.teamSyncQuotaSttMinutes,
    searchRequests: config.teamSyncQuotaSearchRequests,
  };
}

async function resetExpiredUsageWindow(doc: TeamSyncUsageDocument): Promise<TeamSyncUsageDocument> {
  if (doc.resetsAt.getTime() > Date.now()) return doc;

  const now = new Date();
  const resetsAt = nextMonthlyReset(now);
  const collection = getTeamSyncUsageCollection();
  await collection.updateOne(
    { keyHash: doc.keyHash },
    {
      $set: {
        aiRequests: 0,
        sttSeconds: 0,
        searchRequests: 0,
        resetsAt,
        updatedAt: now,
      },
    }
  );

  return {
    ...doc,
    aiRequests: 0,
    sttSeconds: 0,
    searchRequests: 0,
    resetsAt,
    updatedAt: now,
  };
}

async function getOrCreateUsageDocument(keyHash: string): Promise<TeamSyncUsageDocument> {
  const now = new Date();
  const collection = getTeamSyncUsageCollection();
  await collection.updateOne(
    { keyHash },
    {
      $setOnInsert: {
        keyHash,
        plan: 'standard',
        aiRequests: 0,
        sttSeconds: 0,
        searchRequests: 0,
        resetsAt: nextMonthlyReset(now),
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true }
  );

  const doc = await collection.findOne({ keyHash });
  if (!doc) throw new Error('usage_document_not_found');
  return resetExpiredUsageWindow(doc);
}

async function recordUsage(
  keyHash: string,
  increments: { aiRequests?: number; sttSeconds?: number; searchRequests?: number }
): Promise<void> {
  const inc: Record<string, number> = {};
  if (increments.aiRequests) inc.aiRequests = increments.aiRequests;
  if (increments.sttSeconds) inc.sttSeconds = increments.sttSeconds;
  if (increments.searchRequests) inc.searchRequests = increments.searchRequests;
  if (Object.keys(inc).length === 0) return;

  await getOrCreateUsageDocument(keyHash);
  await getTeamSyncUsageCollection().updateOne(
    { keyHash },
    { $inc: inc, $set: { updatedAt: new Date() } }
  );
}

export function buildTeamSyncUsageResponse(
  doc: Pick<TeamSyncUsageDocument, 'plan' | 'aiRequests' | 'sttSeconds' | 'searchRequests' | 'resetsAt' | 'createdAt'>,
  limits: TeamSyncUsageLimits
): UsageResponse {
  const transcriptionUsed = Math.ceil(doc.sttSeconds / 60);
  return {
    plan: doc.plan,
    quota: {
      transcription: {
        used: transcriptionUsed,
        limit: limits.sttMinutes,
        remaining: Math.max(0, limits.sttMinutes - transcriptionUsed),
      },
      ai: {
        used: doc.aiRequests,
        limit: limits.aiRequests,
        remaining: Math.max(0, limits.aiRequests - doc.aiRequests),
      },
      search: {
        used: doc.searchRequests,
        limit: limits.searchRequests,
        remaining: Math.max(0, limits.searchRequests - doc.searchRequests),
      },
      resets_at: doc.resetsAt.toISOString(),
    },
    usage: {
      ai: doc.aiRequests,
      stt_seconds: Math.round(doc.sttSeconds),
      search: doc.searchRequests,
    },
    member_since: doc.createdAt.toISOString(),
  };
}

function providerHealth(config = getBackendConfig()) {
  return {
    routes: {
      chat: true,
      usage: true,
      transcribe: true,
    },
    providers: {
      gemini: config.teamSyncGeminiApiKeys.length > 0,
      groq: config.teamSyncGroqApiKeys.length > 0,
      deepgram: config.teamSyncDeepgramApiKeys.length > 0,
    },
  };
}

function buildLanguageInstruction(language?: string): string | null {
  if (!language) return null;
  if (language === 'auto') return 'Respond in the language most appropriate to the user request.';
  return `Respond in ${language}.`;
}

function messagesForGroq(payload: TeamSyncChatPayload): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  const instructions = [payload.system, buildLanguageInstruction(payload.language)].filter(Boolean).join('\n\n');
  if (instructions) messages.push({ role: 'system', content: instructions });
  for (const message of payload.messages) {
    messages.push({ role: message.role, content: message.content });
  }
  return messages;
}

function buildGeminiRequest(payload: TeamSyncChatPayload) {
  const systemParts = [
    payload.system,
    ...payload.messages.filter(message => message.role === 'system').map(message => message.content),
    buildLanguageInstruction(payload.language),
  ].filter(Boolean);

  const contents = payload.messages
    .filter(message => message.role !== 'system')
    .map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }] as Array<Record<string, unknown>>,
    }));

  if (payload.images?.length) {
    let target = contents[contents.length - 1];
    if (!target || target.role !== 'user') {
      target = { role: 'user', parts: [{ text: 'Analyze the attached image context.' }] };
      contents.push(target);
    }
    for (const image of payload.images) {
      target.parts.push({
        inline_data: {
          mime_type: image.mime_type,
          data: image.data,
        },
      });
    }
  }

  return {
    contents,
    ...(systemParts.length ? { system_instruction: { parts: [{ text: systemParts.join('\n\n') }] } } : {}),
    generation_config: {
      temperature: 0.4,
      max_output_tokens: payload.max_tokens || 8192,
    },
  };
}

function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('');
}

function chooseChatProvider(payload: TeamSyncChatPayload, config = getBackendConfig()): 'gemini' | 'groq' | null {
  const hasImages = !!payload.images?.length;
  if (hasImages) return config.teamSyncGeminiApiKeys.length > 0 ? 'gemini' : null;
  if (payload.fast_mode && config.teamSyncGroqApiKeys.length > 0) return 'groq';
  if (config.teamSyncGeminiApiKeys.length > 0) return 'gemini';
  if (config.teamSyncGroqApiKeys.length > 0) return 'groq';
  return null;
}

async function fetchJsonWithProviderError(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(text || `Provider returned ${response.status}`);
    (err as any).status = response.status;
    throw err;
  }
  return response.json();
}

async function generateGeminiChat(payload: TeamSyncChatPayload, config = getBackendConfig()): Promise<{ content: string; model: string; provider: 'gemini' }> {
  const key = config.teamSyncGeminiApiKeys[0];
  if (!key) throw new Error('gemini_provider_unconfigured');

  const model = config.teamSyncGeminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const data = await fetchJsonWithProviderError(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGeminiRequest(payload)),
    signal: AbortSignal.timeout(60_000),
  });

  return { content: extractGeminiText(data), model, provider: 'gemini' };
}

async function generateGroqChat(payload: TeamSyncChatPayload, config = getBackendConfig()): Promise<{ content: string; model: string; provider: 'groq' }> {
  const key = config.teamSyncGroqApiKeys[0];
  if (!key) throw new Error('groq_provider_unconfigured');

  const model = config.teamSyncGroqModel;
  const data = await fetchJsonWithProviderError('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: messagesForGroq(payload),
      temperature: 0.4,
      max_tokens: payload.max_tokens || 8192,
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const content = data?.choices?.[0]?.message?.content || '';
  return { content, model, provider: 'groq' };
}

function writeSse(res: Response, payload: unknown): void {
  res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
}

function beginSse(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

async function streamProviderResponse(
  res: Response,
  payload: TeamSyncChatPayload,
  provider: 'gemini' | 'groq',
  keyHash: string,
  config = getBackendConfig()
): Promise<void> {
  beginSse(res);
  try {
    if (provider === 'groq') {
      await streamGroqResponse(res, payload, config);
    } else {
      await streamGeminiResponse(res, payload, config);
    }
    await recordUsage(keyHash, { aiRequests: 1 });
    writeSse(res, '[DONE]');
  } catch (error: any) {
    writeSse(res, { error: error.message || 'stream_failed' });
    writeSse(res, '[DONE]');
  } finally {
    res.end();
  }
}

async function streamGroqResponse(res: Response, payload: TeamSyncChatPayload, config: BackendConfig): Promise<void> {
  const key = config.teamSyncGroqApiKeys[0];
  if (!key) throw new Error('groq_provider_unconfigured');

  const model = config.teamSyncGroqModel;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: messagesForGroq(payload),
      temperature: 0.4,
      max_tokens: payload.max_tokens || 8192,
      stream: true,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Groq stream failed: ${response.status}`);
  }

  await consumeProviderSse(response, line => {
    if (line === '[DONE]') return false;
    const chunk = JSON.parse(line);
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) writeSse(res, { delta, model, provider: 'groq' });
    return true;
  });
}

async function streamGeminiResponse(res: Response, payload: TeamSyncChatPayload, config: BackendConfig): Promise<void> {
  const key = config.teamSyncGeminiApiKeys[0];
  if (!key) throw new Error('gemini_provider_unconfigured');

  const model = config.teamSyncGeminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGeminiRequest(payload)),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Gemini stream failed: ${response.status}`);
  }

  await consumeProviderSse(response, line => {
    const chunk = JSON.parse(line);
    const delta = extractGeminiText(chunk);
    if (delta) writeSse(res, { delta, model, provider: 'gemini' });
    return true;
  });
}

async function consumeProviderSse(response: globalThis.Response, onData: (line: string) => boolean): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider stream was empty');

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const shouldContinue = onData(payload);
      if (!shouldContinue) return;
    }
  }
}

async function handleChat(req: Request, res: Response): Promise<void> {
  const key = readTeamSyncApiKey(req);
  if (!key.ok) {
    res.status(key.status).json({ error: key.error });
    return;
  }

  const payload = validateChatPayload(req.body);
  if (!payload.ok) {
    res.status(payload.status).json({ error: payload.error });
    return;
  }

  try {
    const keyHash = hashTeamSyncApiKey(key.value);
    const usageDoc = await getOrCreateUsageDocument(keyHash);
    const limits = getTeamSyncUsageLimits();
    if (usageDoc.aiRequests >= limits.aiRequests) {
      res.status(402).json({ error: 'ai_quota_exceeded' });
      return;
    }

    const provider = chooseChatProvider(payload.value);
    if (!provider) {
      res.status(503).json({ error: 'chat_provider_unconfigured', health: providerHealth() });
      return;
    }

    if (payload.value.stream) {
      await streamProviderResponse(res, payload.value, provider, keyHash);
      return;
    }

    const result = provider === 'groq'
      ? await generateGroqChat(payload.value)
      : await generateGeminiChat(payload.value);

    await recordUsage(keyHash, { aiRequests: 1 });
    res.json(result);
  } catch (error: any) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    res.status(status).json({ error: error.message || 'chat_request_failed' });
  }
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data as any);
}

function sendWsJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function normalizeDeepgramLanguage(language: string): string {
  if (!language || language === 'auto') return 'multi';
  return language.split('-')[0].toLowerCase();
}

function buildDeepgramUrl(handshake: TeamSyncTranscribeHandshake, config: BackendConfig): string {
  const params = new URLSearchParams({
    model: config.teamSyncDeepgramModel,
    encoding: 'linear16',
    sample_rate: String(handshake.sample_rate),
    channels: String(handshake.audio_channels),
    interim_results: 'true',
    smart_format: 'true',
    endpointing: '300',
    vad_events: 'true',
    language: normalizeDeepgramLanguage(handshake.language),
  });
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

function forwardDeepgramMessage(client: WebSocket, data: RawData): void {
  let message: any;
  try {
    message = JSON.parse(rawDataToBuffer(data).toString('utf8'));
  } catch {
    return;
  }

  if (message?.type !== 'Results') return;
  const alternative = message.channel?.alternatives?.[0];
  const text = alternative?.transcript;
  if (!text) return;

  sendWsJson(client, {
    text,
    is_final: !!(message.is_final || message.speech_final),
    confidence: typeof alternative.confidence === 'number' ? alternative.confidence : 1,
  });
}

function handleTranscribeConnection(client: WebSocket): void {
  const config = getBackendConfig();
  let handshake: TeamSyncTranscribeHandshake | null = null;
  let keyHash: string | null = null;
  let upstream: WebSocket | null = null;
  let audioBytes = 0;
  const pendingAudio: Buffer[] = [];

  const closeWithError = (error: string, code = 1011, message?: string) => {
    sendWsJson(client, { error, ...(message ? { message } : {}) });
    try { client.close(code); } catch {}
  };

  const authTimer = setTimeout(() => {
    closeWithError('auth_timeout', 1008);
  }, 10_000);

  const cleanup = () => {
    clearTimeout(authTimer);
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      try { upstream.close(); } catch {}
    }
    if (handshake && keyHash && audioBytes > 0) {
      const seconds = audioBytes / Math.max(1, handshake.sample_rate * handshake.audio_channels * 2);
      recordUsage(keyHash, { sttSeconds: seconds }).catch(error => {
        console.warn('[v1/transcribe] Failed to record STT usage:', error);
      });
    }
  };

  client.on('message', async (data: RawData, isBinary: boolean) => {
    if (!handshake) {
      if (isBinary) {
        closeWithError('invalid_auth_frame', 1008);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawDataToBuffer(data).toString('utf8'));
      } catch {
        closeWithError('invalid_auth_frame', 1008);
        return;
      }

      const validated = validateTranscribeHandshake(parsed);
      if (!validated.ok) {
        closeWithError(validated.error, validated.status === 401 ? 1008 : 1003);
        return;
      }

      try {
        handshake = validated.value;
        keyHash = hashTeamSyncApiKey(handshake.key);
        const usageDoc = await getOrCreateUsageDocument(keyHash);
        const limits = getTeamSyncUsageLimits(config);
        if (Math.ceil(usageDoc.sttSeconds / 60) >= limits.sttMinutes) {
          closeWithError('transcription_quota_exceeded', 1008);
          return;
        }
      } catch (error: any) {
        closeWithError('usage_validation_failed', 1011, error.message);
        return;
      }

      const deepgramKey = config.teamSyncDeepgramApiKeys[0];
      if (!deepgramKey) {
        closeWithError('transcription_provider_unconfigured', 1011);
        return;
      }

      upstream = new WebSocket(buildDeepgramUrl(handshake, config), {
        headers: { Authorization: `Token ${deepgramKey}` },
      });

      upstream.on('open', () => {
        sendWsJson(client, { status: 'connected', provider: 'deepgram' });
        while (pendingAudio.length > 0 && upstream?.readyState === WebSocket.OPEN) {
          upstream.send(pendingAudio.shift()!);
        }
      });

      upstream.on('message', (upstreamData: RawData) => {
        forwardDeepgramMessage(client, upstreamData);
      });

      upstream.on('error', (error: Error) => {
        closeWithError('upstream_error', 1011, error.message);
      });

      upstream.on('close', () => {
        if (client.readyState === WebSocket.OPEN) {
          closeWithError('upstream_closed', 1011);
        }
      });

      return;
    }

    if (!isBinary) return;

    const chunk = rawDataToBuffer(data);
    audioBytes += chunk.length;

    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(chunk);
    } else if (pendingAudio.length < 500) {
      pendingAudio.push(chunk);
    }
  });

  client.on('close', cleanup);
  client.on('error', cleanup);
}

export function createV1Router(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, ...providerHealth(), timestamp: new Date().toISOString() });
  });

  router.get('/usage', async (req, res) => {
    const key = readTeamSyncApiKey(req);
    if (!key.ok) {
      res.status(key.status).json({ error: key.error });
      return;
    }

    try {
      const doc = await getOrCreateUsageDocument(hashTeamSyncApiKey(key.value));
      res.json(buildTeamSyncUsageResponse(doc, getTeamSyncUsageLimits()));
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'usage_request_failed' });
    }
  });

  router.post('/chat', (req, res) => {
    handleChat(req, res).catch(error => {
      res.status(500).json({ error: error.message || 'chat_request_failed' });
    });
  });

  return router;
}

export function attachV1WebSocketServer(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
    } catch {
      pathname = '';
    }

    if (pathname !== '/v1/transcribe') return;

    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', ws => {
    handleTranscribeConnection(ws);
  });

  return wss;
}

export default createV1Router;
