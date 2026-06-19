import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import type { ModeReferenceFile, ModesStateSnapshot, PublicModeTemplate } from "../src/lib/modes/types";
import type {
  PermissionKind,
  PermissionRequestResult,
  PermissionSettingsResult,
  PermissionStatusSnapshot,
} from "../src/lib/permissions/types";
import {
  type ProviderAnalyticsSessionSnapshot,
  type ProviderAnalyticsSessionSnapshotBridge,
} from "../src/lib/providers/providerAnalyticsSessionSnapshot";
import {
  type SessionExportPdfSaveRequest,
  type SessionExportPdfSaveResult,
  type SessionExportSaveRequest,
  type SessionExportSaveResult,
} from "../src/lib/export/sessionExportDelivery";
import type { OverlayLayoutConstraints } from "../src/lib/overlay/v2LayoutContract";

const PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC = {
  set: 'provider-analytics:set-session-snapshot',
  get: 'provider-analytics:get-session-snapshot',
  changed: 'provider-analytics:session-snapshot-changed',
} as const;

const SESSION_EXPORT_DELIVERY_IPC = {
  save: 'session-export:save-report',
  savePdf: 'session-export:save-pdf-report',
} as const;

interface PermissionsBridge {
  getStatus: () => Promise<PermissionStatusSnapshot>
  requestMicrophone: () => Promise<PermissionRequestResult>
  requestScreenRecording: () => Promise<PermissionRequestResult>
  requestAccessibility: () => Promise<PermissionRequestResult>
  openSettings: (permission: PermissionKind) => Promise<PermissionSettingsResult>
  onStatusChanged: (callback: (status: PermissionStatusSnapshot) => void) => () => void
}

type CalendarEventPayload = {
  id: string
  title?: string
  summary?: string
  description?: string
  startTime?: string
  endTime?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  link?: string
  source?: 'google'
}

type CalendarModeRecommendation = {
  eventId: string
  title: string
  description?: string
  startTime: string
  endTime: string
  recommendedMode: 'technical-interview' | 'sales' | 'lecture' | 'team-meet' | 'recruiting' | 'looking-for-work'
  recommendedModeLabel: string
  confidence: number
  matchedSignals: string[]
  summary: string
  suggestedReferences: string[]
}

type BedrockFetchedModel = {
  id: string
  label: string
  inputModalities?: string[]
}

type BedrockCredentials = {
  authMode: 'aws_cli' | 'access_keys';
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  profileName?: string;
  region: string;
  preferredModel?: string;
}

type SecretStatus = {
  configured: boolean;
  masked: string | null;
}

type BridgeContextTarget = 'latest_turn' | 'active_context' | 'transcript'
type BridgeActionContract =
  | 'default'
  | 'hint_only'
  | 'complexity_only'
  | 'edge_cases_only'
  | 'debugging_only'
  | 'bruteforce_only'
  | 'optimal_solution'
  | 'followup_questions_only'

type GenerateActionPayload = {
  intent: 'what_to_answer' | 'recap' | 'clarify' | 'brainstorm' | 'follow_up_questions' | 'answer_now' | 'system_design_tradeoffs'
  message?: string
  additionalContext?: string
  transcriptOverride?: string
  actionContract?: BridgeActionContract
  actionId?: string
  contextTarget?: BridgeContextTarget
  imagePaths?: string[]
  requestId?: string
  profilePreference?: 'default' | 'force_on' | 'force_off'
  modelOverride?: string
}

type LicenseBridgeState = {
  isPremium: boolean
  plan: 'free' | 'pro' | 'team' | string
  isActive: boolean
  provider?: string
  status?: string
  trial?: boolean
  expiresAt?: string
  graceUntil?: string
  lastSuccessfulSyncAt?: string
  entitlementVersion?: number
  features?: string[]
  error?: string
}

type TrialBridgeState = {
  ok: boolean
  expired?: boolean
  remaining_ms?: number
  started_at?: string
  expires_at?: string
  converted_to?: string | null
  usage?: { ai: number; stt_seconds: number; search: number }
  limits?: object
  error?: string
}

type UpdaterCacheFileInfo = {
  fileName: string
  path: string
  size: number
  modifiedAt: string
}

type UpdaterCacheInfo = {
  cacheDir: string
  pendingDir: string
  downloadedFiles: UpdaterCacheFileInfo[]
  totalSize: number
  currentVersion: string
  latestVersion: string | null
  error?: string
}

type TeamSyncOnboardingV1 = {
  persona: string
  industry: string
  discoverySource: string
  completedAt: string
  onboardingVersion: 1
  completedInVersion: string
}

type TeamSyncOnboardingV1Input = {
  persona: string
  industry: string
  discoverySource: string
  onboardingVersion?: 1
  completedInVersion?: string
}

type GoogleAuthUser = {
  id?: string
  googleId?: string
  name: string
  email: string
  picture?: string
  calendarConnected: boolean
  isNewUser?: boolean
  onboardingV1?: TeamSyncOnboardingV1 | null
}

type GoogleAuthState = {
  authenticated: boolean
  user: GoogleAuthUser | null
  calendarConnected: boolean
}

type GoogleAuthResult = {
  success: boolean
  user?: GoogleAuthUser
  authState?: GoogleAuthState
  events?: any[]
  error?: string
}

type FirstSuccessActionId =
  | 'upload_resume_jd'
  | 'connect_calendar'
  | 'open_technical_interview_mode'
  | 'open_coding_mode'
  | 'start_first_session'

type OnboardingV2State = {
  tourComplete: boolean
  firstSuccess: {
    completed: boolean
    action: FirstSuccessActionId | null
    completedAt: string | null
  }
}

type OnboardingV2StatePatch = Partial<{
  tourComplete: boolean
  firstSuccess: Partial<OnboardingV2State['firstSuccess']>
}>

type OnboardingV2Result = {
  success: boolean
  state?: OnboardingV2State
  error?: string
}

// Types for the exposed Electron API
interface ElectronAPI extends ProviderAnalyticsSessionSnapshotBridge {
  saveSessionExportReport: (request: SessionExportSaveRequest) => Promise<SessionExportSaveResult>
  saveSessionExportPdfReport: (request: SessionExportPdfSaveRequest) => Promise<SessionExportPdfSaveResult>
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  getOverlayLayoutConstraints: () => Promise<OverlayLayoutConstraints>
  getRecognitionLanguages: () => Promise<Record<string, any>>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onScreenshotAttached: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onResetView: (callback: () => void) => () => void
  takeScreenshot: (options?: { requireVision?: boolean }) => Promise<{ path: string; preview: string }>
  captureScreen: () => Promise<string>
  takeSelectiveScreenshot: (options?: { requireVision?: boolean }) => Promise<{ path: string; preview: string; cancelled?: boolean }>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  quitApp: () => Promise<void>

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: "ollama" | "gemini" | "custom" | "bedrock"; model: string; isOllama: boolean }>
  getAvailableOllamaModels: () => Promise<string[]>
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  switchToGemini: (apiKey?: string, modelId?: string) => Promise<{ success: boolean; error?: string }>
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey?: string) => Promise<{ success: boolean; error?: string }>
  testBedrockConnection: (credentials: BedrockCredentials) => Promise<{ success: boolean; models?: BedrockFetchedModel[]; credentials?: BedrockCredentials; error?: string }>
  selectServiceAccount: () => Promise<{ success: boolean; path?: string; cancelled?: boolean; error?: string }>

  // API Key Management
  setGeminiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setGroqApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenaiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setClaudeApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setBedrockCredentials: (credentials: BedrockCredentials) => Promise<{ success: boolean; models?: BedrockFetchedModel[]; credentials?: BedrockCredentials; error?: string }>
  setTeamSyncApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  getTeamSyncUsage: () => Promise<{ ok: boolean; plan?: string; quota?: { transcription: { used: number; limit: number; remaining: number }; ai: { used: number; limit: number; remaining: number }; search: { used: number; limit: number; remaining: number }; resets_at: string }; member_since?: string; error?: string; status?: number }>
  getStoredCredentials: () => Promise<{ hasGeminiKey: boolean; hasGroqKey: boolean; hasOpenaiKey: boolean; hasClaudeKey: boolean; hasTeamSyncKey: boolean; hasBedrockCredentials?: boolean; bedrockCredentials?: BedrockCredentials; bedrockPreferredModel?: string; bedrockFetchedModels?: BedrockFetchedModel[]; googleServiceAccountPath: string | null; sttProvider: string; hasSttGroqKey: boolean; hasSttOpenaiKey: boolean; hasDeepgramKey: boolean; hasElevenLabsKey: boolean; hasAzureKey: boolean; azureRegion: string; hasIbmWatsonKey: boolean; ibmWatsonRegion: string; hasSonioxKey: boolean; hasTavilyKey?: boolean; sttKeys?: Record<string, SecretStatus>; tavilyKey?: SecretStatus }>

  // Groq Provider Vault — Multi-Key Management
  groqVaultGetKeys: () => Promise<{ success: boolean; keys: Array<{ id: string; maskedKey: string; enabled: boolean; addedAt: number; label?: string; exhausted: boolean; cooldownUntil: number | null; requestCount: number; lastUsed: number; invalid: boolean; isAvailable: boolean }>; error?: string }>
  groqVaultAddKey: (apiKey: string, label?: string) => Promise<{ success: boolean; key?: { id: string; maskedKey: string; enabled: boolean; addedAt: number; label?: string }; validationStatus?: string; validationError?: string; error?: string }>
  groqVaultRemoveKey: (id: string) => Promise<{ success: boolean; error?: string }>
  groqVaultToggleKey: (id: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
  groqVaultGetHealth: () => Promise<{ success: boolean; error?: string; [key: string]: any }>

  permissions: PermissionsBridge
  checkPermissions: () => Promise<{ microphone: 'granted' | 'denied' | 'not-determined' | 'restricted'; screen: 'granted' | 'denied' | 'not-determined' | 'restricted'; platform: string }>
  requestMicPermission: () => Promise<boolean>
  // Free Trial
  startTrial:     () => Promise<{ ok: boolean; started_at?: string; expires_at?: string; expired?: boolean; already_used?: boolean; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: { duration_ms: number; ai_requests: number; stt_minutes: number; search_requests: number }; error?: string; status?: number }>
  getTrialStatus: () => Promise<{ ok: boolean; expired?: boolean; remaining_ms?: number; started_at?: string; expires_at?: string; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: object; error?: string }>
  getLocalTrial:  () => Promise<{ hasToken: boolean; trialClaimed?: boolean; expiresAt?: string; startedAt?: string; expired?: boolean }>
  convertTrial:   (choice: string) => Promise<{ ok: boolean }>
  endTrialByok:   () => Promise<{ success: boolean; error?: string }>
  wipeTrialProfileData: () => Promise<{ success: boolean; error?: string }>
  onTrialEnded:   (cb: (data: { choice: string }) => void) => () => void
  onModesActiveCleared: (cb: () => void) => () => void

  // STT Provider Management
  setSttProvider: (provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'teamsync' | 'whisper') => Promise<{ success: boolean; error?: string }>
  getSttProvider: () => Promise<string>
  setGroqSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenAiSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setDeepgramApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setElevenLabsApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setAzureApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setAzureRegion: (region: string) => Promise<{ success: boolean; error?: string }>
  setIbmWatsonApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setGroqSttModel: (model: string) => Promise<{ success: boolean; error?: string }>
  setSonioxApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setIbmWatsonRegion: (region: string) => Promise<{ success: boolean; error?: string }>
  testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey?: string, region?: string) => Promise<{ success: boolean; error?: string }>

  // STT Config Events
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => () => void
  onCredentialsChanged: (callback: () => void) => () => void

  // Native Audio Service Events
  onNativeAudioTranscript: (callback: (transcript: { speaker: string; text: string; final: boolean }) => void) => () => void
  onNativeAudioSuggestion: (callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void) => () => void
  onNativeAudioConnected: (callback: () => void) => () => void
  onNativeAudioDisconnected: (callback: () => void) => () => void
  onSuggestionGenerated: (callback: (data: { question: string; suggestion: string; confidence: number }) => void) => () => void
  onSuggestionProcessingStart: (callback: () => void) => () => void
  onSuggestionError: (callback: (error: { error: string }) => void) => () => void
  generateSuggestion: (context: string, lastQuestion: string) => Promise<{ suggestion: string }>
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>
  setRecognitionLanguage: (key: string) => Promise<{ success: boolean; error?: string }>
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>
  setAiResponseLanguage: (language: string) => Promise<{ success: boolean; error?: string }>
  getSttLanguage: () => Promise<string>
  getAiResponseLanguage: () => Promise<string>
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => () => void
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => () => void

  // STT Status Events
  onSttStatusChanged: (callback: (data: { state: 'connected' | 'reconnecting' | 'failed'; provider: string; error?: string; channel: 'user' | 'interviewer'; reconnectAttempts?: number }) => void) => () => void
  onSttTelemetry: (callback: (data: { type: 'provider_started' | 'provider_failed' | 'failover_triggered' | 'debug_failure_injected'; provider: string; channel: 'user' | 'interviewer'; sourceLabel: string; timestamp: number; reason?: string; nextProvider?: string; consecutiveFailures?: number; disabledUntil?: number | null; replayBufferEntries?: number; replayBufferDurationMs?: number }) => void) => () => void
  onSttMetrics: (callback: (data: { channel: 'user' | 'interviewer'; sourceLabel: string; activeProvider: string; started: boolean; replayInProgress: boolean; pendingWrites: number; replayBufferEntries: number; replayBufferDurationMs: number; failoverCount: number; totalTranscripts: number; totalFinalTranscripts: number; transcriptsPerSecond: number; providers: Array<{ provider: string; starts: number; transcripts: number; finalTranscripts: number; failures: number; failovers: number; successRate: number; cooldownUntil: number | null; lastLatencyMs?: number; averageLatencyMs?: number }> }) => void) => () => void
  getSttRuntimeState: () => Promise<{ user: any; interviewer: any; error?: string }>

  // Intelligence Mode IPC
  generateAssist: () => Promise<{ insight: string | null }>
  generateAction: (payload: GenerateActionPayload) => Promise<{ success: boolean; result: string | null }>
  generateWhatToSay: (question?: string, imagePaths?: string[], mode?: string, requestId?: string) => Promise<{ answer: string | null; question?: string; error?: string }>
  generateClarify: (requestId?: string) => Promise<{ clarification: string | null }>
  generateCodeHint: (imagePaths?: string[], problemStatement?: string, requestId?: string) => Promise<{ hint: string | null }>
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string, requestId?: string) => Promise<{ script: string | null }>
  generateAnswerNow: (question: string, imagePaths?: string[], context?: string, mode?: string, requestId?: string) => Promise<{ answer: string | null }>
  generateScreenScan: (imagePaths?: string[], extractedText?: string, forcedMode?: string, requestId?: string) => Promise<{ result: string | null; mode: string; error?: string }>
  runScreenAnalysis: (payload: { requestId: string; image: string; mode?: string }) => void
  generateFollowUp: (intent: string, userRequest?: string, requestId?: string) => Promise<{ refined: string | null; intent: string }>
  generateFollowUpQuestions: (requestId?: string) => Promise<{ questions: string | null }>
  generateSystemDesignTradeoffs: (requestId?: string) => Promise<{ answer: string | null }>
  generateRecap: (requestId?: string) => Promise<{ summary: string | null }>
  submitManualQuestion: (question: string, requestId?: string) => Promise<{ answer: string | null; question: string }>
  getIntelligenceContext: () => Promise<{ context: string; lastAssistantMessage: string | null; activeMode: string }>
  getBenchmarkSummary: () => Promise<any>
  getRecentBenchmarks: (limit?: number) => Promise<any[]>
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>
  cancelIntelligenceRequest: () => Promise<{ success: boolean; error?: string }>
  getSessionMode: () => Promise<{ mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design' }>
  getSessionId: () => Promise<{ sessionId: string }>
  setSessionMode: (mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design') => Promise<{ success: boolean; mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design' }>

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>
  endMeeting: () => Promise<{ success: boolean; error?: string }>
  finalizeMicSTT: () => Promise<void>
  getRecentMeetings: () => Promise<Array<{ id: string; title: string; date: string; duration: string; summary: string }>>
  getMeetingDetails: (id: string) => Promise<any>
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>
  updateMeetingSummary: (id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }) => Promise<boolean>
  onMeetingsUpdated: (callback: () => void) => () => void

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number; intent?: string; requestId?: string }) => void) => () => void
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string; requestId?: string }) => void) => () => void
  onIntelligenceRecap: (callback: (data: { summary: string; requestId?: string }) => void) => () => void
  onIntelligenceClarify: (callback: (data: { clarification: string; requestId?: string }) => void) => () => void
  onIntelligenceClarifyToken: (callback: (data: { token: string; requestId?: string }) => void) => () => void
  onIntelligenceSuggestedAnswerToken: (callback: (data: { token: string; question: string; confidence: number; intent?: string; requestId?: string }) => void) => () => void
  onIntelligenceRefinedAnswerToken: (callback: (data: { token: string; intent: string; requestId?: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string; requestId?: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string; requestId?: string }) => void) => () => void
  onIntelligenceRecapToken: (callback: (data: { token: string; requestId?: string }) => void) => () => void
  onIntelligenceSystemDesignTradeoffs: (callback: (data: { answer: string; requestId?: string }) => void) => () => void
  onIntelligenceSystemDesignTradeoffsToken: (callback: (data: { token: string; requestId?: string }) => void) => () => void
  onIntelligenceManualStarted: (callback: (data?: { requestId?: string }) => void) => () => void
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string; requestId?: string }) => void) => () => void
  onIntelligenceActionToken: (callback: (data: { intent: string; token: string; requestId?: string; mode: string; profileApplied?: boolean }) => void) => () => void
  onIntelligenceActionResult: (callback: (data: { intent: string; content: string; requestId?: string; mode: string; profileApplied?: boolean; debugMetadata?: any }) => void) => () => void
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void
  onIntelligenceError: (callback: (data: { error: string; mode: string; requestId?: string }) => void) => () => void
  onScreenshotCaptureBlocked: (callback: (data: { error: string }) => void) => () => void
  onSessionModeChanged: (callback: (data: { mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design' }) => void) => () => void

  // Model Management
  getDefaultModel: () => Promise<{ model: string }>
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>
  setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>
  toggleModelSelector: (coords: { x: number; y: number }) => Promise<void>
  forceRestartOllama: () => Promise<void>

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>

  // Groq Fast Text Mode
  getGroqFastTextMode: () => Promise<{ enabled: boolean }>
  setGroqFastTextMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>

  // Demo
  seedDemo: () => Promise<{ success: boolean }>

  // Custom Providers
  saveCustomProvider: (provider: any) => Promise<{ success: boolean; id?: string; error?: string }>
  getCustomProviders: () => Promise<any[]>
  deleteCustomProvider: (id: string) => Promise<{ success: boolean; error?: string }>

  // Follow-up Email
  generateFollowupEmail: (input: any) => Promise<string>
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => Promise<string[]>
  getCalendarAttendees: (eventId: string) => Promise<Array<{ email: string; name: string }>>
  openMailto: (params: { to: string; subject: string; body: string }) => Promise<{ success: boolean; error?: string }>

  // Audio Test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>
  stopAudioTest: () => Promise<{ success: boolean }>
  onAudioTestLevel: (callback: (level: number) => void) => () => void

  showWindow: () => Promise<void>
  hideWindow: () => Promise<void>
  showOverlay: () => Promise<void>
  hideOverlay: () => Promise<void>
  getMeetingActive: () => Promise<boolean>
  onMeetingStateChanged: (callback: (data: { isActive: boolean; status?: 'idle' | 'starting' | 'active' | 'failed' }) => void) => () => void
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
  onEnsureExpanded: (callback: () => void) => () => void
  onToggleExpand: (callback: () => void) => () => void
  toggleAdvancedSettings: () => Promise<void>
  openSettingsTab: (tab: string) => Promise<void>
  onOpenSettingsTab: (callback: (tab: string) => void) => () => void
  onPermissionRemediationRequired: (callback: (payload: { message: string }) => void) => () => void
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>
  getOverlayMousePassthrough: () => Promise<boolean>
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void
  onOverlayDragStateChanged: (callback: (dragging: boolean) => void) => () => void
  onOverlayLayoutConstraintsChanged: (callback: (constraints: OverlayLayoutConstraints) => void) => () => void

  // Streaming listeners
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean, requestId?: string }) => Promise<void>
  cancelGeminiChatStream: () => Promise<{ success: boolean }>
  onGeminiStreamToken: (callback: (data: { token: string; requestId?: string } | string) => void) => () => void
  onGeminiStreamDone: (callback: (data?: { requestId?: string }) => void) => () => void
  onGeminiStreamError: (callback: (data: { error: string; requestId?: string } | string) => void) => () => void


  onUndetectableChanged: (callback: (state: boolean) => void) => () => void
  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => () => void
  onModelChanged: (callback: (modelId: string) => void) => () => void

  // Ollama
  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => () => void
  onOllamaPullComplete: (callback: () => void) => () => void
  onBedrockReauthenticationRequired: (callback: (data: { title?: string; message: string; authMode?: string; region?: string; model?: string; error?: string }) => void) => () => void

  // Theme API
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }>
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => () => void

  // Calendar
  calendarIntelligenceEvaluateEvents: (events: CalendarEventPayload[]) => Promise<CalendarModeRecommendation | null>
  calendarIntelligenceGetRecommendation: () => Promise<CalendarModeRecommendation | null>
  calendarIntelligenceDismiss: (eventId: string) => Promise<{ success: boolean }>
  onCalendarRecommendationChanged: (callback: (recommendation: CalendarModeRecommendation | null) => void) => () => void
  modesSetMeetingContext: (context: { eventTitle: string; description?: string; startTime: string; endTime: string; participants?: Array<{ email: string; name: string }> } | null) => Promise<{ success: boolean }>

  // Skills
  skillsRefresh: () => Promise<Array<{ id: string; name: string; description: string; source: 'builtin' | 'userData' }>>
  skillsOpenFolder: () => Promise<{ success: boolean; path: string; error?: string }>

  // Codex CLI
  getCodexCliConfig: () => Promise<any>
  setCodexCliConfig: (config: any) => Promise<{ success: boolean; config?: any; error?: string }>
  testCodexCli: (config?: any) => Promise<{ success: boolean; error?: string; resolvedPath?: string }>

  // Google Auth (Server-side OAuth + MongoDB)
  googleSignIn: () => Promise<GoogleAuthResult>
  googleGetAuthState: () => Promise<GoogleAuthState>
  googleVerifySession: () => Promise<GoogleAuthResult>
  googleSaveOnboardingV1: (data: TeamSyncOnboardingV1Input) => Promise<GoogleAuthResult>
  googleConnectCalendar: (loginHint?: string) => Promise<GoogleAuthResult>
  googleGetCalendarEvents: () => Promise<GoogleAuthResult>
  googleLogout: () => Promise<{ success: boolean }>
  googleDisconnectCalendar: () => Promise<GoogleAuthResult>
  onAuthResult: (callback: (result: GoogleAuthResult) => void) => () => void
  onAuthLoggedOut: (callback: () => void) => () => void
  onboardingV2GetState: (email: string) => Promise<OnboardingV2Result>
  onboardingV2UpdateState: (email: string, patch: OnboardingV2StatePatch) => Promise<OnboardingV2Result>

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void
  onUpdateChecking: (callback: () => void) => () => void
  onUpdateNotAvailable: (callback: (info: any) => void) => () => void
  onUpdateError: (callback: (err: string) => void) => () => void
  onDownloadProgress: (callback: (progressObj: any) => void) => () => void
  restartAndInstall: () => Promise<void>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  getUpdaterCacheInfo: () => Promise<UpdaterCacheInfo>
  openUpdaterCacheFolder: () => Promise<{ success: boolean; path?: string; error?: string }>

  // RAG (Retrieval-Augmented Generation) API
  ragQueryMeeting: (meetingId: string, query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryLive: (query: string, requestId?: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryGlobal: (query: string, requestId?: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) => Promise<{ success: boolean }>
  ragIsMeetingProcessed: (meetingId: string) => Promise<boolean>
  ragGetQueueStatus: () => Promise<{ pending: number; processing: number; completed: number; failed: number }>
  ragRetryEmbeddings: () => Promise<{ success: boolean }>
  onRAGStreamChunk: (callback: (data: { meetingId?: string; global?: boolean; chunk: string; requestId?: string }) => void) => () => void
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean; requestId?: string }) => void) => () => void
  onRAGStreamError: (callback: (data: { meetingId?: string; global?: boolean; error: string; requestId?: string }) => void) => () => void

  // Keybind Management
  getKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  setKeybind: (id: string, accelerator: string) => Promise<boolean>
  resetKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void

  // Global shortcut events (stealth: fired even when window is not focused)
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void

  // Stealth Keyboard Tap (CGEventTap on macOS, stub on Windows)
  stealthTapAvailable: () => Promise<boolean>
  stealthTapStart: () => Promise<boolean>
  stealthTapStop: () => Promise<void>
  stealthTapOpenSettings: () => Promise<void>
  stealthTapShouldAutoEngage: () => Promise<boolean>
  stealthTapRefreshIme: () => Promise<boolean>
  onStealthTapState: (callback: (state: { active: boolean; reason?: string }) => void) => () => void
  onStealthKeyCaptured: (callback: (ev: { isKeyDown: boolean; keyCode: number; chars: string; isOutsideMouseDown: boolean }) => void) => () => void
  onKeybindRegistrationFailed?: (callback: (data: { id: string; accelerator: string }) => void) => () => void

  // Donation API
  getDonationStatus: () => Promise<{ shouldShow: boolean; hasDonated: boolean; lifetimeShows: number }>;
  markDonationToastShown: () => Promise<{ success: boolean }>;
  setDonationComplete: () => Promise<{ success: boolean }>;

  // Profile Engine API
  profileUploadResume: (fileToken: string) => Promise<{ success: boolean; error?: string }>;
  profileGetStatus: () => Promise<{ hasProfile: boolean; profileMode: boolean; isReady: boolean; activeResumeId?: number | null; activeJDId?: number | null; activeProfilePairId?: number | null; activeGenerationToken?: string | null; generationId?: number | null; name?: string; role?: string; totalExperienceYears?: number }>;
  profileSetMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  profileDelete: () => Promise<{ success: boolean; error?: string }>;
  profileHardDeleteAll: (reason?: string) => Promise<{ success: boolean; generationId?: number; reason?: string; error?: string }>;
  profileGetProfile: () => Promise<any>;
  profileGetActiveState: () => Promise<{ activeResumeId: number | null; activeJDId: number | null; activeProfilePairId: number | null; generationId: number; activeGenerationToken: string | null; updatedAt: string | null }>;
  profileSelectFile: () => Promise<{ success?: boolean; cancelled?: boolean; fileToken?: string; fileName?: string; error?: string }>;

  // JD & Research API
  profileUploadJD: (fileToken: string) => Promise<{ success: boolean; error?: string }>;
  profileDeleteJD: () => Promise<{ success: boolean; error?: string }>;
  profileResearchCompany: (companyName: string) => Promise<{ success: boolean; status?: string; research?: any; error?: string }>;
  runCompanyResearch: (company: string, role: string, forceRefresh?: boolean) => Promise<{ success: boolean; status?: string; research?: any; error?: string }>;
  getTavilyStatus: () => Promise<SecretStatus>;
  profileGenerateNegotiation: (force?: boolean) => Promise<{ success: boolean; script?: any; error?: string }>;
  profileGetNegotiationState: () => Promise<{ success: boolean; enabled?: boolean; state?: any; isActive?: boolean; error?: string }>;
  profileSetNegotiationContextEnabled: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; state?: any; isActive?: boolean; hasScript?: boolean; error?: string }>;
  profileResetNegotiation: () => Promise<{ success: boolean; error?: string }>;
  onNegotiationRestored: (callback: (data: { restored: boolean }) => void) => () => void;
  onNegotiationRegenerated: (callback: (data: { regenerated: boolean }) => void) => () => void;
  onNegotiationStateChanged: (callback: (data: { enabled: boolean; isActive: boolean; state: any }) => void) => () => void;
  onGapAnalysisRestored: (callback: (data: { restored: boolean }) => void) => () => void;
  onQuestionsRestored: (callback: (data: { restored: boolean }) => void) => () => void;
  onProfileResearchUpdated: (callback: (data: { company: string; role: string; updatedAt: string; sourceCount: number }) => void) => () => void;
  onCompanyResearchReady: (callback: (data: any) => void) => () => void;
  onKnowledgeEngineReady: (callback: (data: { isReady: boolean; restoredNodeCount: number; restoredOutputs: { negotiationScript: boolean; gapAnalysis: boolean; questions: boolean } }) => void) => () => void;
  getStartupState: () => Promise<{
    bootstrapComplete: boolean;
    license: { isPremium: boolean; plan?: string; provider?: string };
    knowledge: {
      engineReady: boolean;
      hasResume: boolean;
      hasJD: boolean;
      nodeCount: number;
      aot: {
        negotiationScript: boolean;
        gapAnalysis: boolean;
        questions: boolean;
      };
    };
  }>;
  getAOTState: () => Promise<{
    engineReady: boolean;
    hasResume: boolean;
    hasJD: boolean;
    inputHash: string | null;
    negotiation: { exists: boolean; data: any | null; updatedAt: string | null; version: number; hash: string | null };
    gapAnalysis: { exists: boolean; data: any | null; updatedAt: string | null; version: number; hash: string | null };
    questions: { exists: boolean; data: any | null; updatedAt: string | null; version: number; hash: string | null };
  }>;
  forceResync: () => Promise<{
    bootstrapComplete: boolean;
    license: { isPremium: boolean; plan?: string; provider?: string };
    knowledge: {
      engineReady: boolean;
      hasResume: boolean;
      hasJD: boolean;
      nodeCount: number;
      aot: {
        negotiationScript: boolean;
        gapAnalysis: boolean;
        questions: boolean;
      };
    };
  }>;
  licenseActivate: (key: string) => Promise<{ success: boolean; error?: string; entitlement?: Partial<LicenseBridgeState> }>
  licenseSync: () => Promise<LicenseBridgeState>
  licenseGetEntitlement: () => Promise<LicenseBridgeState>
  licenseCheckPremium: () => Promise<boolean>
  licenseGetDetails: () => Promise<LicenseBridgeState>
  getUserPlan: () => Promise<LicenseBridgeState>
  licenseCheckPremiumAsync: () => Promise<boolean>
  licenseDeactivate: () => Promise<{ success: boolean; error?: string }>

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;

  // Overlay Opacity (Stealth Mode)
  getOverlayOpacity: () => Promise<number | null>;
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Verbose / Debug Logging
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  getLogFilePath: () => Promise<string | null>;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;

  // Arch
  getArch: () => Promise<string>;
  getOsVersion: () => Promise<string>;

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => void;
  cropperCancelled: () => void;
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => () => void;

  // Platform
  platform: NodeJS.Platform;

  // Modes API
  modesGetState: () => Promise<ModesStateSnapshot>;
  modesGetTemplates: () => Promise<PublicModeTemplate[]>;
  modesGetAll: () => Promise<Array<{ id: string; name: string; templateType: string; customContext: string; isActive: boolean; createdAt: string; referenceFileCount: number }>>;
  modesGetActive: () => Promise<{ id: string; name: string; templateType: string; customContext: string; isActive: boolean; createdAt: string } | null>;
  modesCreate: (params: { name?: string; templateType?: string; templateId?: string }) => Promise<{ success: boolean; mode?: any; state?: ModesStateSnapshot; error?: string }>;
  modesUpdate: (id: string, updates: { name?: string; templateType?: string; templateId?: string; customContext?: string; userPrompt?: string }) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>;
  modesDelete: (id: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>;
  modesSetSelected: (id: string | null) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>;
  modesSetActive: (id: string | null) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>;
  modesGetReferenceFiles: (modeId: string) => Promise<ModeReferenceFile[]>;
  modesUploadReferenceFile: (modeId: string) => Promise<{ success: boolean; cancelled?: boolean; file?: ModeReferenceFile; state?: ModesStateSnapshot; error?: string }>;
  modesDeleteReferenceFile: (id: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>;
  modesGetNoteSections: (modeId: string) => Promise<Array<{ id: string; modeId: string; title: string; description: string; sortOrder: number; createdAt: string }>>;
  modesAddNoteSection: (modeId: string, title: string, description: string) => Promise<{ success: boolean; section?: any; state?: ModesStateSnapshot; error?: string }>;
  modesUpdateNoteSection: (id: string, updates: { title?: string; description?: string }) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>;
  modesDeleteNoteSection: (id: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>;
  modesRemoveAllNoteSections: (modeId: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>;
  modesResetNoteSections: (modeId: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>;

  // Phone Mirror (Beta) API
  phoneMirrorEnable: () => Promise<{ success: boolean; error?: string }>;
  phoneMirrorDisable: () => Promise<{ success: boolean }>;
  phoneMirrorGetState: () => Promise<{ enabled: boolean; lanAccess: boolean; port: number; pairingUrl: string | null; connectedDeviceCount: number; connectedDevices: any[] }>;
  phoneMirrorGetQrCode: () => Promise<{ success: boolean; dataUrl: string | null; error?: string }>;
  phoneMirrorGetPairingUrl: () => Promise<{ success: boolean; url: string | null; error?: string }>;
  phoneMirrorGetConnectedDevices: () => Promise<{ success: boolean; devices: any[] }>;
  phoneMirrorSetLanAccess: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  phoneMirrorDisconnectAll: () => Promise<{ success: boolean }>;
  onPhoneMirrorStateChanged: (callback: (state: any) => void) => () => void;
}

function toLegacyPermissionStatus(status: PermissionStatusSnapshot["microphone"]): 'granted' | 'denied' | 'not-determined' | 'restricted' {
  switch (status) {
    case 'granted':
      return 'granted';
    case 'not_requested':
      return 'not-determined';
    case 'unsupported':
      return 'restricted';
    case 'restart_required':
    case 'denied':
    default:
      return 'denied';
  }
}

const getEntitlementState = async (): Promise<LicenseBridgeState> => {
  const state = await ipcRenderer.invoke('license:get-entitlement');
  return state && typeof state === 'object'
    ? state as LicenseBridgeState
    : { isPremium: false, plan: 'free', isActive: false, status: 'free' };
};

const syncEntitlementState = async (): Promise<LicenseBridgeState> => {
  const state = await ipcRenderer.invoke('license:sync');
  return state && typeof state === 'object'
    ? state as LicenseBridgeState
    : { isPremium: false, plan: 'free', isActive: false, status: 'free' };
};

const trialBridgeStatus = (state: LicenseBridgeState): TrialBridgeState => {
  const expiresMs = state.expiresAt ? Date.parse(state.expiresAt) : NaN;
  const remainingMs = Number.isFinite(expiresMs) ? Math.max(0, expiresMs - Date.now()) : undefined;
  const isTrial = state.trial === true;
  return {
    ok: isTrial && state.isPremium === true,
    expired: isTrial && state.isPremium !== true,
    remaining_ms: remainingMs,
    expires_at: state.expiresAt,
    converted_to: null,
    usage: { ai: 0, stt_seconds: 0, search: 0 },
    limits: {},
    error: state.error,
  };
};

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  getOverlayLayoutConstraints: () => ipcRenderer.invoke("get-overlay-layout-constraints"),
  saveSessionExportReport: (request: SessionExportSaveRequest) =>
    ipcRenderer.invoke(SESSION_EXPORT_DELIVERY_IPC.save, request),
  saveSessionExportPdfReport: (request: SessionExportPdfSaveRequest) =>
    ipcRenderer.invoke(SESSION_EXPORT_DELIVERY_IPC.savePdf, request),
  getRecognitionLanguages: () => ipcRenderer.invoke("get-recognition-languages"),
  takeScreenshot: (options?: { requireVision?: boolean }) => ipcRenderer.invoke("take-screenshot", options),
  captureScreen: async () => {
    const data = await ipcRenderer.invoke("take-screenshot");
    return data?.path ?? "";
  },
  takeSelectiveScreenshot: (options?: { requireVision?: boolean }) => ipcRenderer.invoke("take-selective-screenshot", options),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path: string) =>
    ipcRenderer.invoke("delete-screenshot", path),

  // Event listeners
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-taken", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription)
    }
  },
  onScreenshotAttached: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-attached", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-attached", subscription)
    }
  },
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("capture-and-process", subscription)
    return () => {
      ipcRenderer.removeListener("capture-and-process", subscription)
    }
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },
  moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
  moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
  moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
  moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  toggleWindow: () => ipcRenderer.invoke("toggle-window"),
  showWindow: (inactive?: boolean) => ipcRenderer.invoke("show-window", inactive),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showOverlay: () => ipcRenderer.invoke("show-overlay"),
  hideOverlay: () => ipcRenderer.invoke("hide-overlay"),
  getMeetingActive: () => ipcRenderer.invoke("get-meeting-active"),
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => {
    const subscription = (_: any, data: { isActive: boolean }) => callback(data);
    ipcRenderer.on('meeting-state-changed', subscription);
    return () => { ipcRenderer.removeListener('meeting-state-changed', subscription); };
  },
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const subscription = (_: any, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-maximized-changed', subscription);
    return () => { ipcRenderer.removeListener('window-maximized-changed', subscription); };
  },
  onEnsureExpanded: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('ensure-expanded', subscription);
    return () => { ipcRenderer.removeListener('ensure-expanded', subscription); };
  },
  toggleAdvancedSettings: () => ipcRenderer.invoke("toggle-advanced-settings"),
  openSettingsTab: (tab: string) => ipcRenderer.invoke("settings:open-tab", tab),
  onOpenSettingsTab: (callback: (tab: string) => void) => {
    const subscription = (_: any, tab: string) => callback(tab)
    ipcRenderer.on('settings:open-tab', subscription)
    return () => { ipcRenderer.removeListener('settings:open-tab', subscription) }
  },
  onPermissionRemediationRequired: (callback: (payload: { message: string }) => void) => {
    const subscription = (_: any, payload: { message: string }) => callback(payload);
    ipcRenderer.on('permissions:remediation-required', subscription);
    return () => { ipcRenderer.removeListener('permissions:remediation-required', subscription); };
  },
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  setUndetectable: (state: boolean) => ipcRenderer.invoke("set-undetectable", state),
  getUndetectable: () => ipcRenderer.invoke("get-undetectable"),
  setOverlayMousePassthrough: (enabled: boolean) => ipcRenderer.invoke("set-overlay-mouse-passthrough", enabled),
  toggleOverlayMousePassthrough: () => ipcRenderer.invoke("toggle-overlay-mouse-passthrough"),
  getOverlayMousePassthrough: () => ipcRenderer.invoke("get-overlay-mouse-passthrough"),
  setOpenAtLogin: (open: boolean) => ipcRenderer.invoke("set-open-at-login", open),
  getOpenAtLogin: () => ipcRenderer.invoke("get-open-at-login"),
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') => ipcRenderer.invoke("set-disguise", mode),
  getDisguise: () => ipcRenderer.invoke("get-disguise"),
  onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => {
    const subscription = (_: any, mode: any) => callback(mode)
    ipcRenderer.on('disguise-changed', subscription)
    return () => {
      ipcRenderer.removeListener('disguise-changed', subscription)
    }
  },

  // Advanced Stealth Mode API
  stealthEngage: () => ipcRenderer.invoke("stealth:engage"),
  stealthDisengage: () => ipcRenderer.invoke("stealth:disengage"),
  stealthGetState: () => ipcRenderer.invoke("stealth:get-state"),
  stealthGetConfig: () => ipcRenderer.invoke("stealth:get-config"),
  stealthUpdateConfig: (patch: Record<string, any>) => ipcRenderer.invoke("stealth:update-config", patch),
  stealthIsEngaged: () => ipcRenderer.invoke("stealth:is-engaged"),
  onStealthStateChanged: (callback: (state: any) => void) => {
    const subscription = (_: any, state: any) => callback(state);
    ipcRenderer.on('stealth-state-changed', subscription);
    return () => { ipcRenderer.removeListener('stealth-state-changed', subscription); };
  },

  // Stealth Keyboard Tap API (CGEventTap on macOS, stub on Windows)
  stealthTapAvailable: () => ipcRenderer.invoke('stealth-tap:available'),
  stealthTapStart: () => ipcRenderer.invoke('stealth-tap:start'),
  stealthTapStop: () => ipcRenderer.invoke('stealth-tap:stop'),
  stealthTapOpenSettings: () => ipcRenderer.invoke('stealth-tap:open-settings'),
  stealthTapShouldAutoEngage: () => ipcRenderer.invoke('stealth-tap:should-auto-engage'),
  stealthTapRefreshIme: () => ipcRenderer.invoke('stealth-tap:refresh-ime'),
  onStealthTapState: (callback: (state: { active: boolean; reason?: string }) => void) => {
    const sub = (_: any, state: { active: boolean; reason?: string }) => callback(state);
    ipcRenderer.on('stealth-tap-state', sub);
    return () => { ipcRenderer.removeListener('stealth-tap-state', sub); };
  },
  onStealthKeyCaptured: (callback: (ev: { isKeyDown: boolean; keyCode: number; chars: string; isOutsideMouseDown: boolean }) => void) => {
    const sub = (_: any, ev: any) => callback(ev);
    ipcRenderer.on('stealth-key-captured', sub);
    return () => { ipcRenderer.removeListener('stealth-key-captured', sub); };
  },

  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => {
    const subscription = (_: any, isVisible: boolean) => callback(isVisible)
    ipcRenderer.on("settings-visibility-changed", subscription)
    return () => {
      ipcRenderer.removeListener("settings-visibility-changed", subscription)
    }
  },

  onToggleExpand: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("toggle-expand", subscription)
    return () => {
      ipcRenderer.removeListener("toggle-expand", subscription)
    }
  },

  // LLM Model Management
  getCurrentLlmConfig: () => ipcRenderer.invoke("get-current-llm-config"),
  getAvailableOllamaModels: () => ipcRenderer.invoke("get-available-ollama-models"),
  switchToOllama: (model?: string, url?: string) => ipcRenderer.invoke("switch-to-ollama", model, url),
  switchToGemini: (apiKey?: string, modelId?: string) => ipcRenderer.invoke("switch-to-gemini", apiKey, modelId),
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => ipcRenderer.invoke("test-llm-connection", provider, apiKey),
  testBedrockConnection: (credentials: BedrockCredentials) => ipcRenderer.invoke("test-bedrock-connection", credentials),
  selectServiceAccount: () => ipcRenderer.invoke("select-service-account"),

  // API Key Management
  setGeminiApiKey: (apiKey: string) => ipcRenderer.invoke("set-gemini-api-key", apiKey),
  setGroqApiKey: (apiKey: string) => ipcRenderer.invoke("set-groq-api-key", apiKey),
  setOpenaiApiKey: (apiKey: string) => ipcRenderer.invoke("set-openai-api-key", apiKey),
  setClaudeApiKey: (apiKey: string) => ipcRenderer.invoke("set-claude-api-key", apiKey),
  setBedrockCredentials: (credentials: BedrockCredentials) => ipcRenderer.invoke("set-bedrock-credentials", credentials),
  setTeamSyncApiKey: (apiKey: string) => ipcRenderer.invoke("set-teamsync-api-key", apiKey),
  getTeamSyncUsage: () => ipcRenderer.invoke("get-teamsync-usage"),
  getStoredCredentials: () => ipcRenderer.invoke("get-stored-credentials"),

  // Groq Provider Vault — Multi-Key Management
  groqVaultGetKeys: () => ipcRenderer.invoke('groq-vault:get-keys'),
  groqVaultAddKey: (apiKey: string, label?: string) => ipcRenderer.invoke('groq-vault:add-key', apiKey, label),
  groqVaultRemoveKey: (id: string) => ipcRenderer.invoke('groq-vault:remove-key', id),
  groqVaultToggleKey: (id: string, enabled: boolean) => ipcRenderer.invoke('groq-vault:toggle-key', id, enabled),
  groqVaultGetHealth: () => ipcRenderer.invoke('groq-vault:get-health'),

  // Permissions
  permissions: {
    getStatus: () => ipcRenderer.invoke("permissions:getStatus"),
    requestMicrophone: () => ipcRenderer.invoke("permissions:requestMicrophone"),
    requestScreenRecording: () => ipcRenderer.invoke("permissions:requestScreenRecording"),
    requestAccessibility: () => ipcRenderer.invoke("permissions:requestAccessibility"),
    openSettings: (permission: PermissionKind) => ipcRenderer.invoke("permissions:openSettings", permission),
    onStatusChanged: (callback: (status: PermissionStatusSnapshot) => void) => {
      const subscription = (_: unknown, status: PermissionStatusSnapshot) => callback(status);
      ipcRenderer.on("permissions:status-changed", subscription);
      return () => {
        ipcRenderer.removeListener("permissions:status-changed", subscription);
      };
    },
  },
  checkPermissions: async () => {
    const status = await ipcRenderer.invoke("permissions:getStatus") as PermissionStatusSnapshot;
    return {
      microphone: toLegacyPermissionStatus(status.microphone),
      screen: toLegacyPermissionStatus(status.screenRecording),
      platform: status.platform,
    };
  },
  requestMicPermission: async () => {
    const result = await ipcRenderer.invoke("permissions:requestMicrophone") as PermissionRequestResult;
    return result.status.microphone === 'granted';
  },

  // Free Trial
  startTrial: async () => {
    const result = await ipcRenderer.invoke("license:activate", { trial: true });
    if (!result?.success) return { ok: false, error: result?.error || 'trial_start_failed' };
    return {
      ok: true,
      started_at: result.entitlement?.issuedAt,
      expires_at: result.entitlement?.expiresAt,
      usage: { ai: 0, stt_seconds: 0, search: 0 },
      limits: {},
    };
  },
  getTrialStatus: async () => trialBridgeStatus(await syncEntitlementState()),
  getLocalTrial: async () => {
    const state = await getEntitlementState();
    const trial = state.trial === true;
    return {
      hasToken: trial,
      trialClaimed: trial,
      expiresAt: state.expiresAt,
      expired: trial && state.isPremium !== true,
    };
  },
  convertTrial: async (_choice: string) => ({ ok: true }),
  endTrialByok: () => ipcRenderer.invoke("license:deactivate"),
  wipeTrialProfileData: () => ipcRenderer.invoke("profile:wipe-trial-data"),
  onTrialEnded:     (cb: (data: { choice: string }) => void) => {
    const sub = (_: any, data: any) => cb(data);
    ipcRenderer.on('trial-ended', sub);
    return () => ipcRenderer.removeListener('trial-ended', sub);
  },

  // STT Provider Management
  setSttProvider: (provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'teamsync' | 'whisper') => ipcRenderer.invoke("set-stt-provider", provider),
  getSttProvider: () => ipcRenderer.invoke("get-stt-provider"),
  setGroqSttApiKey: (apiKey: string) => ipcRenderer.invoke("set-groq-stt-api-key", apiKey),
  setOpenAiSttApiKey: (apiKey: string) => ipcRenderer.invoke("set-openai-stt-api-key", apiKey),
  setDeepgramApiKey: (apiKey: string) => ipcRenderer.invoke("set-deepgram-api-key", apiKey),
  setElevenLabsApiKey: (apiKey: string) => ipcRenderer.invoke("set-elevenlabs-api-key", apiKey),
  setAzureApiKey: (apiKey: string) => ipcRenderer.invoke("set-azure-api-key", apiKey),
  setAzureRegion: (region: string) => ipcRenderer.invoke("set-azure-region", region),
  setIbmWatsonApiKey: (apiKey: string) => ipcRenderer.invoke("set-ibmwatson-api-key", apiKey),
  setGroqSttModel: (model: string) => ipcRenderer.invoke("set-groq-stt-model", model),
  setSonioxApiKey: (apiKey: string) => ipcRenderer.invoke("set-soniox-api-key", apiKey),
  setIbmWatsonRegion: (region: string) => ipcRenderer.invoke("set-ibmwatson-region", region),
  testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey?: string, region?: string) => ipcRenderer.invoke("test-stt-connection", provider, apiKey, region),

  // STT Config Events (Adapted from public PR #173 — verify premium interaction)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-config-changed', subscription);
    return () => { ipcRenderer.removeListener('stt-config-changed', subscription); };
  },
  onCredentialsChanged: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('credentials-changed', subscription);
    return () => { ipcRenderer.removeListener('credentials-changed', subscription); };
  },

  // Native Audio Service Events
  onNativeAudioTranscript: (callback: (transcript: { speaker: string; speakerId?: string; speakerLabel?: string; text: string; final: boolean; _sessionId?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("native-audio-transcript", subscription)
    return () => {
      ipcRenderer.removeListener("native-audio-transcript", subscription)
    }
  },
  onNativeAudioSuggestion: (callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("native-audio-suggestion", subscription)
    return () => {
      ipcRenderer.removeListener("native-audio-suggestion", subscription)
    }
  },
  onNativeAudioConnected: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("native-audio-connected", subscription)
    return () => {
      ipcRenderer.removeListener("native-audio-connected", subscription)
    }
  },
  onNativeAudioDisconnected: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("native-audio-disconnected", subscription)
    return () => {
      ipcRenderer.removeListener("native-audio-disconnected", subscription)
    }
  },
  onSuggestionGenerated: (callback: (data: { question: string; suggestion: string; confidence: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("suggestion-generated", subscription)
    return () => {
      ipcRenderer.removeListener("suggestion-generated", subscription)
    }
  },
  onSuggestionProcessingStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("suggestion-processing-start", subscription)
    return () => {
      ipcRenderer.removeListener("suggestion-processing-start", subscription)
    }
  },
  onSuggestionError: (callback: (error: { error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("suggestion-error", subscription)
    return () => {
      ipcRenderer.removeListener("suggestion-error", subscription)
    }
  },
  generateSuggestion: (context: string, lastQuestion: string) =>
    ipcRenderer.invoke("generate-suggestion", context, lastQuestion),

  getNativeAudioStatus: () => ipcRenderer.invoke("native-audio-status"),
  getInputDevices: () => ipcRenderer.invoke("get-input-devices"),
  getOutputDevices: () => ipcRenderer.invoke("get-output-devices"),
  setRecognitionLanguage: (key: string) => ipcRenderer.invoke("set-recognition-language", key),
  getAiResponseLanguages: () => ipcRenderer.invoke("get-ai-response-languages"),
  setAiResponseLanguage: (language: string) => ipcRenderer.invoke("set-ai-response-language", language),
  getSttLanguage: () => ipcRenderer.invoke("get-stt-language"),
  getAiResponseLanguage: () => ipcRenderer.invoke("get-ai-response-language"),
  getPersonalizationPreferences: () => ipcRenderer.invoke("get-personalization-preferences"),
  setPersonalizationPreferences: (patch: any) => ipcRenderer.invoke("set-personalization-preferences", patch),
  onPersonalizationPreferencesChanged: (callback: (preferences: any) => void) => {
    const subscription = (_: any, preferences: any) => callback(preferences);
    ipcRenderer.on('personalization-preferences-changed', subscription);
    return () => { ipcRenderer.removeListener('personalization-preferences-changed', subscription); };
  },
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => {
    const subscription = (_: any, bcp47: string) => callback(bcp47);
    ipcRenderer.on('stt-language-auto-detected', subscription);
    return () => { ipcRenderer.removeListener('stt-language-auto-detected', subscription); };
  },
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => {
    const subscription = (_: any, message: string) => callback(message);
    ipcRenderer.on('system-audio-permission-denied', subscription);
    return () => { ipcRenderer.removeListener('system-audio-permission-denied', subscription); };
  },

  // STT Status Events
  onSttStatusChanged: (callback: (data: { state: 'connected' | 'reconnecting' | 'failed'; provider: string; error?: string; channel: 'user' | 'interviewer'; reconnectAttempts?: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-status', subscription);
    return () => { ipcRenderer.removeListener('stt-status', subscription); };
  },
  onSttTelemetry: (callback: (data: { type: 'provider_started' | 'provider_failed' | 'failover_triggered' | 'debug_failure_injected'; provider: string; channel: 'user' | 'interviewer'; sourceLabel: string; timestamp: number; reason?: string; nextProvider?: string; consecutiveFailures?: number; disabledUntil?: number | null; replayBufferEntries?: number; replayBufferDurationMs?: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-telemetry', subscription);
    return () => { ipcRenderer.removeListener('stt-telemetry', subscription); };
  },
  onSttMetrics: (callback: (data: { channel: 'user' | 'interviewer'; sourceLabel: string; activeProvider: string; started: boolean; replayInProgress: boolean; pendingWrites: number; replayBufferEntries: number; replayBufferDurationMs: number; failoverCount: number; totalTranscripts: number; totalFinalTranscripts: number; transcriptsPerSecond: number; providers: Array<{ provider: string; starts: number; transcripts: number; finalTranscripts: number; failures: number; failovers: number; successRate: number; cooldownUntil: number | null; lastLatencyMs?: number; averageLatencyMs?: number }> }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-metrics', subscription);
    return () => { ipcRenderer.removeListener('stt-metrics', subscription); };
  },
  getSttRuntimeState: () => ipcRenderer.invoke("stt:get-runtime-state"),

  // Intelligence Mode IPC
  generateAssist: () => ipcRenderer.invoke("generate-assist"),
  generateAction: (payload: GenerateActionPayload) => ipcRenderer.invoke("generate-action", payload),
  generateWhatToSay: (question?: string, imagePaths?: string[], mode?: string, requestId?: string) => ipcRenderer.invoke("generate-what-to-say", question, imagePaths, mode, requestId),
  generateClarify: (requestId?: string) => ipcRenderer.invoke("generate-clarify", requestId),
  generateCodeHint: (imagePaths?: string[], problemStatement?: string, requestId?: string) => ipcRenderer.invoke("generate-code-hint", imagePaths, problemStatement, requestId),
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string, requestId?: string) => ipcRenderer.invoke("generate-brainstorm", imagePaths, problemStatement, requestId),
  generateAnswerNow: (question: string, imagePaths?: string[], context?: string, mode?: string, requestId?: string) => ipcRenderer.invoke("generate-answer-now", question, imagePaths, context, mode, requestId),
  generateScreenScan: (imagePaths?: string[], extractedText?: string, forcedMode?: string, requestId?: string) => ipcRenderer.invoke("generate-screen-scan", imagePaths, extractedText, forcedMode, requestId),
  runScreenAnalysis: (payload: { requestId: string; image: string; mode?: string }) => {
    void ipcRenderer.invoke("generate-screen-scan", payload.image ? [payload.image] : [], undefined, payload.mode, payload.requestId);
  },
  generateFollowUp: (intent: string, userRequest?: string, requestId?: string) => ipcRenderer.invoke("generate-follow-up", intent, userRequest, requestId),
  generateFollowUpQuestions: (requestId?: string) => ipcRenderer.invoke("generate-follow-up-questions", requestId),
  generateSystemDesignTradeoffs: (requestId?: string) => ipcRenderer.invoke("generate-system-design-tradeoffs", requestId),
  generateRecap: (requestId?: string) => ipcRenderer.invoke("generate-recap", requestId),
  submitManualQuestion: (question: string, requestId?: string) => ipcRenderer.invoke("submit-manual-question", question, requestId),
  getIntelligenceContext: () => ipcRenderer.invoke("get-intelligence-context"),
  getBenchmarkSummary: () => ipcRenderer.invoke("benchmark:get-summary"),
  getRecentBenchmarks: (limit: number = 20) => ipcRenderer.invoke("benchmark:get-recent", limit),
  resetIntelligence: () => ipcRenderer.invoke("reset-intelligence"),
  getSessionMode: () => ipcRenderer.invoke("session:get-mode"),
  getSessionId: () => ipcRenderer.invoke("session:get-id"),
  setSessionMode: (mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design') => ipcRenderer.invoke("session:set-mode", mode),

  // Action Button Mode (Dynamic Recap / Brainstorm toggle)
  getActionButtonMode: () => ipcRenderer.invoke("get-action-button-mode"),
  setActionButtonMode: (mode: 'recap' | 'brainstorm') => ipcRenderer.invoke("set-action-button-mode", mode),
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => {
    const subscription = (_: any, mode: 'recap' | 'brainstorm') => callback(mode);
    ipcRenderer.on('action-button-mode-changed', subscription);
    return () => { ipcRenderer.removeListener('action-button-mode-changed', subscription); };
  },

  onModeChanged: (callback: (data: { id: string | null; name: string | null; templateId?: string | null }) => void) => {
    const subscription = (_: any, data: { id: string | null; name: string | null; templateId?: string | null }) => callback(data);
    ipcRenderer.on('mode-changed', subscription);
    return () => { ipcRenderer.removeListener('mode-changed', subscription); };
  },

  onModesStateChanged: (callback: (state: ModesStateSnapshot) => void) => {
    const subscription = (_: any, state: ModesStateSnapshot) => callback(state);
    ipcRenderer.on('modes-state-changed', subscription);
    return () => { ipcRenderer.removeListener('modes-state-changed', subscription); };
  },

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => ipcRenderer.invoke("start-meeting", metadata),
  endMeeting: () => ipcRenderer.invoke("end-meeting"),
  finalizeMicSTT: () => ipcRenderer.invoke("finalize-mic-stt"),
  getRecentMeetings: () => ipcRenderer.invoke("get-recent-meetings"),
  getMeetingDetails: (id: string) => ipcRenderer.invoke("get-meeting-details", id),
  updateMeetingTitle: (id: string, title: string) => ipcRenderer.invoke("update-meeting-title", { id, title }),
  updateMeetingSummary: (id: string, updates: any) => ipcRenderer.invoke("update-meeting-summary", { id, updates }),
  deleteMeeting: (id: string) => ipcRenderer.invoke("delete-meeting", id),

  onMeetingsUpdated: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("meetings-updated", subscription)
    return () => {
      ipcRenderer.removeListener("meetings-updated", subscription)
    }
  },

  // Window Mode
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => ipcRenderer.invoke("set-window-mode", mode, inactive),
  setOverlayV2Layout: (enabled: boolean) => ipcRenderer.invoke("set-overlay-v2-layout", enabled),
  setProviderAnalyticsSessionSnapshot: (snapshot: ProviderAnalyticsSessionSnapshot | null) =>
    ipcRenderer.invoke(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.set, snapshot),
  getProviderAnalyticsSessionSnapshot: () =>
    ipcRenderer.invoke(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.get),
  onProviderAnalyticsSessionSnapshotChanged: (callback: (snapshot: ProviderAnalyticsSessionSnapshot | null) => void) => {
    const subscription = (_: IpcRendererEvent, snapshot: ProviderAnalyticsSessionSnapshot | null) => callback(snapshot)
    ipcRenderer.on(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.changed, subscription)
    return () => {
      ipcRenderer.removeListener(PROVIDER_ANALYTICS_SESSION_SNAPSHOT_IPC.changed, subscription)
    }
  },

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string; requestId?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-assist-update", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-assist-update", subscription)
    }
  },
  onIntelligenceSuggestedAnswerToken: (callback: (data: { token: string; question: string; confidence: number; intent?: string; requestId?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-suggested-answer-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-suggested-answer-token", subscription)
    }
  },
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number; intent?: string; requestId?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-suggested-answer", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-suggested-answer", subscription)
    }
  },
  onIntelligenceRefinedAnswerToken: (callback: (data: { token: string; intent: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-refined-answer-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-refined-answer-token", subscription)
    }
  },
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-refined-answer", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-refined-answer", subscription)
    }
  },
  onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-recap-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-recap-token", subscription)
    }
  },
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-recap", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-recap", subscription)
    }
  },
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-clarify-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-clarify-token", subscription)
    }
  },
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-clarify", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-clarify", subscription)
    }
  },
  onIntelligenceSystemDesignTradeoffsToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-system-design-tradeoffs-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-system-design-tradeoffs-token", subscription)
    }
  },
  onIntelligenceSystemDesignTradeoffs: (callback: (data: { answer: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-system-design-tradeoffs", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-system-design-tradeoffs", subscription)
    }
  },
  onIntelligenceScreenScanToken: (callback: (data: { token: string; mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-screen-scan-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-screen-scan-token", subscription)
    }
  },
  onIntelligenceScreenScanResult: (callback: (data: { answer: string; mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-screen-scan-result", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-screen-scan-result", subscription)
    }
  },
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-follow-up-questions-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-follow-up-questions-token", subscription)
    }
  },
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-follow-up-questions-update", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-follow-up-questions-update", subscription)
    }
  },
  onIntelligenceManualStarted: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("intelligence-manual-started", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-manual-started", subscription)
    }
  },
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-manual-result", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-manual-result", subscription)
    }
  },
  onIntelligenceActionToken: (callback: (data: { intent: string; token: string; requestId?: string; mode: string; profileApplied?: boolean }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-action-token", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-action-token", subscription)
    }
  },
  onIntelligenceActionResult: (callback: (data: { intent: string; content: string; requestId?: string; mode: string; profileApplied?: boolean; _sessionId?: string; _intelligence?: any; debugMetadata?: any }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-action-result", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-action-result", subscription)
    }
  },
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-mode-changed", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-mode-changed", subscription)
    }
  },
  onIntelligenceError: (callback: (data: { error: string; mode: string; requestId?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence-error", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence-error", subscription)
    }
  },
  onScreenshotCaptureBlocked: (callback: (data: { error: string }) => void) => {
    const subscription = (_: any, data: { error: string }) => callback(data)
    ipcRenderer.on("screenshot-capture-blocked", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-capture-blocked", subscription)
    }
  },
  onSessionReset: (callback: (payload?: { sessionId: string }) => void) => {
    const subscription = (_: unknown, payload?: { sessionId: string }) => callback(payload)
    ipcRenderer.on("session-reset", subscription)
    return () => {
      ipcRenderer.removeListener("session-reset", subscription)
    }
  },
  onSessionModeChanged: (callback: (data: { mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'salary' | 'system_design' }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("session-mode-changed", subscription)
    return () => {
      ipcRenderer.removeListener("session-mode-changed", subscription)
    }
  },

  // Phase 4: Intelligence Surface Layer
  onAdaptiveModeSuggestion: (callback: (data: { predictedMode: string; predictedModeName: string; currentMode: string; confidence: number; timestamp: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence:adaptive-mode-suggestion", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence:adaptive-mode-suggestion", subscription)
    }
  },
  onTimelineBatch: (callback: (data: { signals: any[]; batchId: string; timestamp: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence:timeline-batch", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence:timeline-batch", subscription)
    }
  },
  onExplanation: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("intelligence:explanation", subscription)
    return () => {
      ipcRenderer.removeListener("intelligence:explanation", subscription)
    }
  },
  dismissAdaptiveModeSuggestion: () => ipcRenderer.invoke("intelligence:dismiss-suggestion"),
  requestExplanation: (params?: { instructionKey?: string }) => ipcRenderer.invoke("intelligence:request-explanation", params),


  // Streaming Chat
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean, requestId?: string }) => ipcRenderer.invoke("gemini-chat-stream", message, imagePaths, context, options),
  cancelGeminiChatStream: () => ipcRenderer.invoke("cancel-gemini-chat-stream"),
  cancelIntelligenceRequest: () => ipcRenderer.invoke("cancel-intelligence-request"),
  cancelIntelligenceByRequest: (requestId: string) => ipcRenderer.invoke("cancel-intelligence-by-request", requestId),

  onGeminiStreamToken: (callback: (data: { token: string; requestId?: string } | string) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("gemini-stream-token", subscription)
    return () => {
      ipcRenderer.removeListener("gemini-stream-token", subscription)
    }
  },

  onGeminiStreamDone: (callback: (data?: { requestId?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("gemini-stream-done", subscription)
    return () => {
      ipcRenderer.removeListener("gemini-stream-done", subscription)
    }
  },

  onGeminiStreamError: (callback: (data: { error: string; requestId?: string } | string) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on("gemini-stream-error", subscription)
    return () => {
      ipcRenderer.removeListener("gemini-stream-error", subscription)
    }
  },

  // Model Management
  getDefaultModel: () => ipcRenderer.invoke('get-default-model'),
  setModel: (modelId: string) => ipcRenderer.invoke('set-model', modelId),
  setDefaultModel: (modelId: string) => ipcRenderer.invoke('set-default-model', modelId),
  toggleModelSelector: (coords: { x: number; y: number }) => ipcRenderer.invoke('toggle-model-selector', coords),
  forceRestartOllama: () => ipcRenderer.invoke('force-restart-ollama'),

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => ipcRenderer.invoke('toggle-settings-window', coords),

  // Groq Fast Text Mode
  getGroqFastTextMode: () => ipcRenderer.invoke('get-groq-fast-text-mode'),
  setGroqFastTextMode: (enabled: boolean) => ipcRenderer.invoke('set-groq-fast-text-mode', enabled),

  // Demo
  seedDemo: () => ipcRenderer.invoke('seed-demo'),

  // Custom Providers
  saveCustomProvider: (provider: any) => ipcRenderer.invoke('save-custom-provider', provider),
  getCustomProviders: () => ipcRenderer.invoke('get-custom-providers'),
  deleteCustomProvider: (id: string) => ipcRenderer.invoke('delete-custom-provider', id),

  // Follow-up Email
  generateFollowupEmail: (input: any) => ipcRenderer.invoke('generate-followup-email', input),
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => ipcRenderer.invoke('extract-emails-from-transcript', transcript),
  getCalendarAttendees: (eventId: string) => ipcRenderer.invoke('get-calendar-attendees', eventId),
  openMailto: (params: { to: string; subject: string; body: string }) => ipcRenderer.invoke('open-mailto', params),

  // Audio Test
  startAudioTest: (deviceId?: string) => ipcRenderer.invoke('start-audio-test', deviceId),
  stopAudioTest: () => ipcRenderer.invoke('stop-audio-test'),
  onAudioTestLevel: (callback: (level: number) => void) => {
    const subscription = (_: any, level: number) => callback(level)
    ipcRenderer.on('audio-test-level', subscription)
    return () => {
      ipcRenderer.removeListener('audio-test-level', subscription)
    }
  },

  onUndetectableChanged: (callback: (state: boolean) => void) => {
    const subscription = (_: any, state: boolean) => callback(state)
    ipcRenderer.on('undetectable-changed', subscription)
    return () => {
      ipcRenderer.removeListener('undetectable-changed', subscription)
    }
  },

  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled)
    ipcRenderer.on('overlay-mouse-passthrough-changed', subscription)
    return () => {
      ipcRenderer.removeListener('overlay-mouse-passthrough-changed', subscription)
    }
  },

  onOverlayDragStateChanged: (callback: (dragging: boolean) => void) => {
    const subscription = (_: any, dragging: boolean) => callback(dragging)
    ipcRenderer.on('overlay-drag-state-changed', subscription)
    return () => {
      ipcRenderer.removeListener('overlay-drag-state-changed', subscription)
    }
  },

  onOverlayLayoutConstraintsChanged: (callback: (constraints: OverlayLayoutConstraints) => void) => {
    const subscription = (_: any, constraints: OverlayLayoutConstraints) => callback(constraints)
    ipcRenderer.on('overlay-layout-constraints-changed', subscription)
    return () => {
      ipcRenderer.removeListener('overlay-layout-constraints-changed', subscription)
    }
  },

  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled)
    ipcRenderer.on('groq-fast-text-changed', subscription)
    return () => {
      ipcRenderer.removeListener('groq-fast-text-changed', subscription)
    }
  },

  onModelChanged: (callback: (modelId: string) => void) => {
    const subscription = (_: any, modelId: string) => callback(modelId)
    ipcRenderer.on('model-changed', subscription)
    return () => {
      ipcRenderer.removeListener('model-changed', subscription)
    }
  },

  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('ollama:pull-progress', subscription)
    return () => {
      ipcRenderer.removeListener('ollama:pull-progress', subscription)
    }
  },

  onOllamaPullComplete: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on('ollama:pull-complete', subscription)
    return () => {
      ipcRenderer.removeListener('ollama:pull-complete', subscription)
    }
  },

  // Theme API
  getThemeMode: () => ipcRenderer.invoke('theme:get-mode'),
  setThemeMode: (mode: 'system' | 'light' | 'dark') => ipcRenderer.invoke('theme:set-mode', mode),
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('theme:changed', subscription)
    return () => {
      ipcRenderer.removeListener('theme:changed', subscription)
    }
  },

  // Calendar API
  calendarIntelligenceEvaluateEvents: (events: CalendarEventPayload[]) => ipcRenderer.invoke('calendar-intelligence:evaluate-events', events),
  calendarIntelligenceGetRecommendation: () => ipcRenderer.invoke('calendar-intelligence:get-recommendation'),
  calendarIntelligenceDismiss: (eventId: string) => ipcRenderer.invoke('calendar-intelligence:dismiss', eventId),
  modesSetMeetingContext: (context: any) => ipcRenderer.invoke('modes:set-meeting-context', context),

  // Skills API
  skillsRefresh: () => ipcRenderer.invoke('skills:list'),
  skillsOpenFolder: () => ipcRenderer.invoke('skills:open-folder'),

  // Codex CLI
  getCodexCliConfig: () => ipcRenderer.invoke('get-codex-cli-config'),
  setCodexCliConfig: (config: any) => ipcRenderer.invoke('set-codex-cli-config', config),
  testCodexCli: (config?: any) => ipcRenderer.invoke('test-codex-cli', config),

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-available", subscription)
    return () => {
      ipcRenderer.removeListener("update-available", subscription)
    }
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-downloaded", subscription)
    return () => {
      ipcRenderer.removeListener("update-downloaded", subscription)
    }
  },
  onUpdateChecking: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("update-checking", subscription)
    return () => {
      ipcRenderer.removeListener("update-checking", subscription)
    }
  },
  onUpdateNotAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-not-available", subscription)
    return () => {
      ipcRenderer.removeListener("update-not-available", subscription)
    }
  },
  onUpdateError: (callback: (err: string) => void) => {
    const subscription = (_: any, err: string) => callback(err)
    ipcRenderer.on("update-error", subscription)
    return () => {
      ipcRenderer.removeListener("update-error", subscription)
    }
  },
  onDownloadProgress: (callback: (progressObj: any) => void) => {
    const subscription = (_: any, progressObj: any) => callback(progressObj)
    ipcRenderer.on("download-progress", subscription)
    return () => {
      ipcRenderer.removeListener("download-progress", subscription)
    }
  },
  restartAndInstall: () => ipcRenderer.invoke("quit-and-install-update"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  getUpdaterCacheInfo: () => ipcRenderer.invoke("get-updater-cache-info"),
  openUpdaterCacheFolder: () => ipcRenderer.invoke("open-updater-cache-folder"),

  // RAG API
  ragQueryMeeting: (meetingId: string, query: string) => ipcRenderer.invoke('rag:query-meeting', { meetingId, query }),
  ragQueryLive: (query: string, requestId?: string) => ipcRenderer.invoke('rag:query-live', { query, requestId }),
  ragQueryGlobal: (query: string, requestId?: string) => ipcRenderer.invoke('rag:query-global', { query, requestId }),
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) => ipcRenderer.invoke('rag:cancel-query', options),
  ragIsMeetingProcessed: (meetingId: string) => ipcRenderer.invoke('rag:is-meeting-processed', meetingId),
  ragGetQueueStatus: () => ipcRenderer.invoke('rag:get-queue-status'),
  ragRetryEmbeddings: () => ipcRenderer.invoke('rag:retry-embeddings'),
  
  onIncompatibleProviderWarning: (callback: (data: { count: number, oldProvider: string, newProvider: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('embedding:incompatible-provider-warning', subscription)
    return () => {
      ipcRenderer.removeListener('embedding:incompatible-provider-warning', subscription)
    }
  },
  onBedrockReauthenticationRequired: (callback: (data: { title?: string; message: string; authMode?: string; region?: string; model?: string; error?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('bedrock:reauthentication-required', subscription)
    return () => {
      ipcRenderer.removeListener('bedrock:reauthentication-required', subscription)
    }
  },
  reindexIncompatibleMeetings: () => ipcRenderer.invoke('rag:reindex-incompatible-meetings'),

  onRAGStreamChunk: (callback: (data: { meetingId?: string; global?: boolean; chunk: string; requestId?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('rag:stream-chunk', subscription)
    return () => {
      ipcRenderer.removeListener('rag:stream-chunk', subscription)
    }
  },
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean; requestId?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('rag:stream-complete', subscription)
    return () => {
      ipcRenderer.removeListener('rag:stream-complete', subscription)
    }
  },
  onRAGStreamError: (callback: (data: { meetingId?: string; global?: boolean; error: string; requestId?: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on('rag:stream-error', subscription)
    return () => {
      ipcRenderer.removeListener('rag:stream-error', subscription)
    }
  },

  // Keybind Management
  getKeybinds: () => ipcRenderer.invoke('keybinds:get-all'),
  setKeybind: (id: string, accelerator: string) => ipcRenderer.invoke('keybinds:set', id, accelerator),
  resetKeybinds: () => ipcRenderer.invoke('keybinds:reset'),
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => {
    const subscription = (_: any, keybinds: any) => callback(keybinds)
    ipcRenderer.on('keybinds:update', subscription)
    return () => {
      ipcRenderer.removeListener('keybinds:update', subscription)
    }
  },
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => {
    const subscription = (_: any, data: { id: string; accelerator: string }) => callback(data)
    ipcRenderer.on('keybinds:registration-failed', subscription)
    return () => {
      ipcRenderer.removeListener('keybinds:registration-failed', subscription)
    }
  },

  // Global shortcut listener — fired stealthily from main process without focusing the window
  onGlobalShortcut: (callback: (data: { action: string }) => void) => {
    const subscription = (_: any, data: { action: string }) => callback(data)
    ipcRenderer.on('global-shortcut', subscription)
    return () => {
      ipcRenderer.removeListener('global-shortcut', subscription)
    }
  },

  // Donation API
  getDonationStatus: () => ipcRenderer.invoke("get-donation-status"),
  markDonationToastShown: () => ipcRenderer.invoke("mark-donation-toast-shown"),
  setDonationComplete: () => ipcRenderer.invoke('set-donation-complete'),

  // Profile Engine API
  profileUploadResume: (fileToken: string) => ipcRenderer.invoke('profile:upload-resume', fileToken),
  profileGetStatus: () => ipcRenderer.invoke('profile:get-status'),
  profileSetMode: (enabled: boolean) => ipcRenderer.invoke('profile:set-mode', enabled),
  profileDelete: () => ipcRenderer.invoke('profile:delete'),
  profileHardDeleteAll: (reason?: string) => ipcRenderer.invoke('profile:hard-delete-all', reason),
  profileGetProfile: () => ipcRenderer.invoke('profile:get-profile'),
  profileGetActiveState: () => ipcRenderer.invoke('profile:get-active-state'),
  profileSelectFile: () => ipcRenderer.invoke('profile:select-file'),

  // JD & Research API
  profileUploadJD: (fileToken: string) => ipcRenderer.invoke('profile:upload-jd', fileToken),
  profileDeleteJD: () => ipcRenderer.invoke('profile:delete-jd'),
  profileResearchCompany: (companyName: string) => ipcRenderer.invoke('profile:research-company', companyName),
  runCompanyResearch: (company: string, role: string, forceRefresh?: boolean) => ipcRenderer.invoke('run_company_research', { company, role, forceRefresh }),
  getTavilyStatus: () => ipcRenderer.invoke('get-tavily-status'),
  profileGenerateNegotiation: (force?: boolean) => ipcRenderer.invoke('profile:generate-negotiation', force),
  profileGetNegotiationState: () => ipcRenderer.invoke('profile:get-negotiation-state'),
  profileSetNegotiationContextEnabled: (enabled: boolean) => ipcRenderer.invoke('profile:set-negotiation-context-enabled', enabled),
  profileResetNegotiation: () => ipcRenderer.invoke('profile:reset-negotiation'),
  profileGetNotes: () => ipcRenderer.invoke('profile:get-notes'),
  profileSaveNotes: (content: string) => ipcRenderer.invoke('profile:save-notes', content),
  setCustomNotesEnabled: (enabled: boolean) => ipcRenderer.invoke('set-custom-notes-enabled', enabled),
  getCustomNotesEnabled: () => ipcRenderer.invoke('get-custom-notes-enabled'),
  overlayLogSystemDesignMode: (enabled: boolean) => ipcRenderer.invoke('overlay:log-system-design-mode', enabled),
  onNegotiationRestored: (callback: (data: { restored: boolean }) => void) => {
    const subscription = (_: any, data: { restored: boolean }) => callback(data);
    ipcRenderer.on('negotiation_restored', subscription);
    return () => {
      ipcRenderer.removeListener('negotiation_restored', subscription);
    };
  },
  onNegotiationRegenerated: (callback: (data: { regenerated: boolean }) => void) => {
    const subscription = (_: any, data: { regenerated: boolean }) => callback(data);
    ipcRenderer.on('negotiation_regenerated', subscription);
    return () => {
      ipcRenderer.removeListener('negotiation_regenerated', subscription);
    };
  },
  onNegotiationStateChanged: (callback: (data: { enabled: boolean; isActive: boolean; state: any }) => void) => {
    const subscription = (_: any, data: { enabled: boolean; isActive: boolean; state: any }) => callback(data);
    ipcRenderer.on('negotiation_state_changed', subscription);
    return () => {
      ipcRenderer.removeListener('negotiation_state_changed', subscription);
    };
  },
  onGapAnalysisRestored: (callback: (data: { restored: boolean }) => void) => {
    const subscription = (_: any, data: { restored: boolean }) => callback(data);
    ipcRenderer.on('gap_analysis_restored', subscription);
    return () => {
      ipcRenderer.removeListener('gap_analysis_restored', subscription);
    };
  },
  onQuestionsRestored: (callback: (data: { restored: boolean }) => void) => {
    const subscription = (_: any, data: { restored: boolean }) => callback(data);
    ipcRenderer.on('questions_restored', subscription);
    return () => {
      ipcRenderer.removeListener('questions_restored', subscription);
    };
  },
  onProfileResearchUpdated: (callback: (data: { company: string; role: string; updatedAt: string; sourceCount: number }) => void) => {
    const subscription = (_: any, data: { company: string; role: string; updatedAt: string; sourceCount: number }) => callback(data);
    ipcRenderer.on('profile_research_updated', subscription);
    return () => {
      ipcRenderer.removeListener('profile_research_updated', subscription);
    };
  },
  onCompanyResearchReady: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('company_research_ready', subscription);
    return () => {
      ipcRenderer.removeListener('company_research_ready', subscription);
    };
  },
  onProfileUpdated: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('profile-updated', subscription);
    return () => {
      ipcRenderer.removeListener('profile-updated', subscription);
    };
  },
  onProfileModeChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('profile-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('profile-mode-changed', subscription);
    };
  },
  onKnowledgeEngineReady: (callback: (data: { isReady: boolean; restoredNodeCount: number; restoredOutputs: { negotiationScript: boolean; gapAnalysis: boolean; questions: boolean } }) => void) => {
    const subscription = (_: any, data: { isReady: boolean; restoredNodeCount: number; restoredOutputs: { negotiationScript: boolean; gapAnalysis: boolean; questions: boolean } }) => callback(data);
    ipcRenderer.on('knowledge_engine_ready', subscription);
    return () => {
      ipcRenderer.removeListener('knowledge_engine_ready', subscription);
    };
  },

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => ipcRenderer.invoke('set-tavily-api-key', apiKey),

  // Dynamic Model Discovery
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'bedrock', apiKey: string) => ipcRenderer.invoke('fetch-provider-models', provider, apiKey),
  fetchBedrockModels: (credentials?: BedrockCredentials) => ipcRenderer.invoke('fetch-bedrock-models', credentials),
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'bedrock', modelId: string) => ipcRenderer.invoke('set-provider-preferred-model', provider, modelId),
  clearGroqFetchedModels: () => ipcRenderer.invoke('clear-groq-fetched-models'),

  // License Management
  licenseActivate: (key: string) => ipcRenderer.invoke('license:activate', key),
  licenseSync: () => ipcRenderer.invoke('license:sync'),
  licenseGetEntitlement: () => ipcRenderer.invoke('license:get-entitlement'),
  licenseCheckPremium: async () => (await getEntitlementState()).isPremium === true,
  licenseGetDetails: () => ipcRenderer.invoke('license:get-entitlement'),
  getUserPlan: () => ipcRenderer.invoke('license:get-entitlement'),
  licenseCheckPremiumAsync: async () => (await syncEntitlementState()).isPremium === true,
  getStartupState: () => ipcRenderer.invoke('app:get-startup-state'),
  getAOTState: () => ipcRenderer.invoke('app:get-aot-state'),
  forceResync: () => ipcRenderer.invoke('app:force-resync'),
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
  onLicenseRestored: (callback: (data: { isPremium: boolean; plan?: string; provider?: string }) => void) => {
    const subscription = (_: any, data: { isPremium: boolean; plan?: string; provider?: string }) => callback(data);
    ipcRenderer.on('license-restored', subscription);
    return () => {
      ipcRenderer.removeListener('license-restored', subscription);
    };
  },
  onLicenseStatusChanged: (callback: (data: { isPremium: boolean, plan?: string }) => void) => {
    const subscription = (_: any, data: { isPremium: boolean, plan?: string }) => callback(data);
    ipcRenderer.on('license-status-changed', subscription);
    return () => {
      ipcRenderer.removeListener('license-status-changed', subscription);
    };
  },

  onModesActiveCleared: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('modes-active-cleared', subscription);
    return () => {
      ipcRenderer.removeListener('modes-active-cleared', subscription);
    };
  },

  // Overlay Opacity (Stealth Mode)
  getOverlayOpacity: () => ipcRenderer.invoke('get-overlay-opacity'),
  setOverlayOpacity: (opacity: number) => ipcRenderer.invoke('set-overlay-opacity', opacity),
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => {
    const subscription = (_: any, opacity: number) => callback(opacity)
    ipcRenderer.on('overlay-opacity-changed', subscription)
    return () => {
      ipcRenderer.removeListener('overlay-opacity-changed', subscription)
    }
  },

  // Verbose / Debug Logging
  getVerboseLogging: () => ipcRenderer.invoke('get-verbose-logging'),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke('set-verbose-logging', enabled),
  getLogFilePath: () => ipcRenderer.invoke('get-log-file-path'),
  openLogFile: () => ipcRenderer.invoke('open-log-file'),
  
  // Arch
  getArch: () => ipcRenderer.invoke('get-arch'),
  getOsVersion: () => ipcRenderer.invoke('get-os-version'),

  // Cropper API
  cropperConfirmed: (bounds: Electron.Rectangle) => ipcRenderer.send('cropper-confirmed', bounds),
  cropperCancelled: () => ipcRenderer.send('cropper-cancelled'),
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => {
    const subscription = (_: Electron.IpcRendererEvent, data: { hudPosition: { x: number; y: number } }) => callback(data)
    ipcRenderer.on('reset-cropper', subscription)
    return () => {
      ipcRenderer.removeListener('reset-cropper', subscription)
    }
  },

  // Platform
  platform: process.platform,

  // Modes API
  modesGetState: () => ipcRenderer.invoke('modes:get-state'),
  modesGetTemplates: () => ipcRenderer.invoke('modes:get-templates'),
  modesGetAll: () => ipcRenderer.invoke('modes:get-all'),
  modesGetActive: () => ipcRenderer.invoke('modes:get-active'),
  modesCreate: (params: { name?: string; templateType?: string; templateId?: string }) => ipcRenderer.invoke('modes:create', params),
  modesUpdate: (id: string, updates: { name?: string; templateType?: string; templateId?: string; customContext?: string; userPrompt?: string }) => ipcRenderer.invoke('modes:update', id, updates),
  modesDelete: (id: string) => ipcRenderer.invoke('modes:delete', id),
  modesSetSelected: (id: string | null) => ipcRenderer.invoke('modes:set-selected', id),
  modesSetActive: (id: string | null) => ipcRenderer.invoke('modes:set-active', id),
  modesGetReferenceFiles: (modeId: string) => ipcRenderer.invoke('modes:get-reference-files', modeId),
  modesUploadReferenceFile: (modeId: string) => ipcRenderer.invoke('modes:upload-reference-file', modeId),
  modesDeleteReferenceFile: (id: string) => ipcRenderer.invoke('modes:delete-reference-file', id),
  modesGetNoteSections: (modeId: string) => ipcRenderer.invoke('modes:get-note-sections', modeId),
  modesAddNoteSection: (modeId: string, title: string, description: string) => ipcRenderer.invoke('modes:add-note-section', modeId, title, description),
  modesUpdateNoteSection: (id: string, updates: { title?: string; description?: string }) => ipcRenderer.invoke('modes:update-note-section', id, updates),
  modesDeleteNoteSection: (id: string) => ipcRenderer.invoke('modes:delete-note-section', id),
  modesRemoveAllNoteSections: (modeId: string) => ipcRenderer.invoke('modes:remove-all-note-sections', modeId),
  modesResetNoteSections: (modeId: string) => ipcRenderer.invoke('modes:reset-note-sections', modeId),

  // Phone Mirror (Beta) API
  phoneMirrorEnable: () => ipcRenderer.invoke('phone-mirror:enable'),
  phoneMirrorDisable: () => ipcRenderer.invoke('phone-mirror:disable'),
  phoneMirrorGetState: () => ipcRenderer.invoke('phone-mirror:get-state'),
  phoneMirrorGetQrCode: () => ipcRenderer.invoke('phone-mirror:get-qr-code'),
  phoneMirrorGetPairingUrl: () => ipcRenderer.invoke('phone-mirror:get-pairing-url'),
  phoneMirrorGetConnectedDevices: () => ipcRenderer.invoke('phone-mirror:get-connected-devices'),
  phoneMirrorSetLanAccess: (enabled: boolean) => ipcRenderer.invoke('phone-mirror:set-lan-access', enabled),
  phoneMirrorDisconnectAll: () => ipcRenderer.invoke('phone-mirror:disconnect-all'),
  onPhoneMirrorStateChanged: (callback: (state: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('phone-mirror:state-changed', subscription);
    return () => { ipcRenderer.removeListener('phone-mirror:state-changed', subscription); };
  },

  // Google Auth (Server-side OAuth + MongoDB)
  googleSignIn: () => ipcRenderer.invoke('auth:google-signin'),
  googleGetAuthState: () => ipcRenderer.invoke('auth:get-state'),
  googleVerifySession: () => ipcRenderer.invoke('auth:verify-session'),
  googleSaveOnboardingV1: (data: TeamSyncOnboardingV1Input) => ipcRenderer.invoke('auth:onboarding-v1', data),
  googleConnectCalendar: (loginHint?: string) => ipcRenderer.invoke('auth:connect-calendar', loginHint),
  googleGetCalendarEvents: () => ipcRenderer.invoke('auth:calendar-events'),
  googleLogout: () => ipcRenderer.invoke('auth:logout'),
  googleDisconnectCalendar: () => ipcRenderer.invoke('auth:disconnect-calendar'),
  onboardingV2GetState: (email: string) => ipcRenderer.invoke('onboarding-v2:get-state', email),
  onboardingV2UpdateState: (email: string, patch: OnboardingV2StatePatch) => ipcRenderer.invoke('onboarding-v2:update-state', email, patch),
  onAuthResult: (callback: (result: any) => void) => {
    const subscription = (_: any, result: any) => callback(result);
    ipcRenderer.on('auth:result', subscription);
    return () => { ipcRenderer.removeListener('auth:result', subscription); };
  },
  onAuthLoggedOut: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('auth:logged-out', subscription);
    return () => { ipcRenderer.removeListener('auth:logged-out', subscription); };
  },

  // Calendar status sync (Launcher <-> Settings)
  onCalendarStatusChanged: (callback: (status: { connected: boolean; email: string | null }) => void) => {
    const subscription = (_: any, status: any) => callback(status);
    ipcRenderer.on('calendar-status-changed', subscription);
    return () => { ipcRenderer.removeListener('calendar-status-changed', subscription); };
  },
  onCalendarRecommendationChanged: (callback: (recommendation: CalendarModeRecommendation | null) => void) => {
    const subscription = (_: any, recommendation: CalendarModeRecommendation | null) => callback(recommendation);
    ipcRenderer.on('calendar-intelligence-changed', subscription);
    return () => { ipcRenderer.removeListener('calendar-intelligence-changed', subscription); };
  },
} as ElectronAPI)

// Renderer-side console forwarding to main-process log file.
// When verbose logging is on, patch console.log/warn/error so that renderer
// output appears in ~/Documents/teamsync_debug.log alongside main-process logs.
;(function patchRendererConsole() {
  let _verbose = false;

  const _origLog = console.log.bind(console);
  const _origWarn = console.warn.bind(console);
  const _origError = console.error.bind(console);

  function serialize(...args: any[]): string {
    return args.map(a => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
      return String(a);
    }).join(' ');
  }

  console.log = (...args: any[]) => {
    _origLog(...args);
    if (_verbose) ipcRenderer.send('forward-log-to-file', 'log', serialize(...args));
  };
  console.warn = (...args: any[]) => {
    _origWarn(...args);
    if (_verbose) ipcRenderer.send('forward-log-to-file', 'warn', serialize(...args));
  };
  console.error = (...args: any[]) => {
    _origError(...args);
    if (_verbose) ipcRenderer.send('forward-log-to-file', 'error', serialize(...args));
  };

  // Sync verbose flag from main process at startup
  ipcRenderer.invoke('get-verbose-logging').then((v: boolean) => { _verbose = v; }).catch(() => {});

  // Keep flag in sync when the user toggles verbose in settings
  ipcRenderer.on('verbose-logging-changed', (_event: any, enabled: boolean) => {
    _verbose = enabled;
  });
})()
