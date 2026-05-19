import type { ModeReferenceFile, ModesStateSnapshot, PublicModeTemplate } from '../lib/modes/types';
import type {
  PermissionKind,
  PermissionRequestResult,
  PermissionSettingsResult,
  PermissionStatusSnapshot,
} from '../lib/permissions/types';

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

export interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  onToggleExpand: (callback: () => void) => () => void
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
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  takeScreenshot: () => Promise<{ path: string; preview: string }>
  captureScreen: () => Promise<string>
  takeSelectiveScreenshot: () => Promise<{ path: string; preview: string; cancelled?: boolean }>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>

  analyzeImageFile: (path: string) => Promise<void>
  quitApp: () => Promise<void>
  toggleWindow: () => Promise<void>
  showWindow: (inactive?: boolean) => Promise<void>
  hideWindow: () => Promise<void>
  showOverlay: () => Promise<void>
  hideOverlay: () => Promise<void>
  getMeetingActive: () => Promise<boolean>
  onMeetingStateChanged: (callback: (data: { isActive: boolean; status?: 'idle' | 'starting' | 'active' | 'failed' }) => void) => () => void
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
  onEnsureExpanded: (callback: () => void) => () => void
  openExternal: (url: string) => Promise<void>
  setUndetectable: (state: boolean) => Promise<{ success: boolean; error?: string }>
  getUndetectable: () => Promise<boolean>
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>
  getOverlayMousePassthrough: () => Promise<boolean>
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') => Promise<{ success: boolean; error?: string }>
  getDisguise: () => Promise<'none' | 'terminal' | 'settings' | 'activity'>
  onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => () => void
  setOpenAtLogin: (open: boolean) => Promise<{ success: boolean; error?: string }>
  getOpenAtLogin: () => Promise<boolean>
  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => () => void
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>
  closeSettingsWindow: () => Promise<void>
  toggleAdvancedSettings: () => Promise<void>
  closeAdvancedSettings: () => Promise<void>
  openSettingsTab: (tab: string) => Promise<void>
  onOpenSettingsTab: (callback: (tab: string) => void) => () => void
  onPermissionRemediationRequired: (callback: (payload: { message: string }) => void) => () => void

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: "ollama" | "gemini"; model: string; isOllama: boolean }>
  getAvailableOllamaModels: () => Promise<string[]>
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  switchToGemini: (apiKey?: string, modelId?: string) => Promise<{ success: boolean; error?: string }>
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey?: string) => Promise<{ success: boolean; error?: string }>
  selectServiceAccount: () => Promise<{ success: boolean; path?: string; cancelled?: boolean; error?: string }>

  // API Key Management
  setGeminiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setGroqApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenaiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setClaudeApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setTeamSyncApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  getTeamSyncUsage: () => Promise<{ ok: boolean; error?: string; plan?: string; quota?: { transcription: { used: number; limit: number; remaining: number }; ai: { used: number; limit: number; remaining: number }; search: { used: number; limit: number; remaining: number }; resets_at: string }; member_since?: string }>
  getStoredCredentials: () => Promise<{ hasTeamSyncKey?: boolean; hasGeminiKey: boolean; hasGroqKey: boolean; hasOpenaiKey: boolean; hasClaudeKey: boolean; googleServiceAccountPath: string | null; sttProvider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'teamsync'; hasSttGroqKey: boolean; hasSttOpenaiKey: boolean; hasDeepgramKey: boolean; hasElevenLabsKey: boolean; hasAzureKey: boolean; azureRegion: string; hasIbmWatsonKey: boolean; ibmWatsonRegion: string; groqSttModel?: string; hasSonioxKey?: boolean; hasTavilyKey?: boolean; geminiPreferredModel?: string; groqPreferredModel?: string; openaiPreferredModel?: string; claudePreferredModel?: string; sttGroqKey?: string; sttOpenaiKey?: string; sttDeepgramKey?: string; sttElevenLabsKey?: string; sttAzureKey?: string; sttIbmKey?: string; sttSonioxKey?: string }>
  // Permissions
  permissions: PermissionsBridge
  checkPermissions:     () => Promise<{ microphone: 'granted'|'denied'|'not-determined'|'restricted'; screen: 'granted'|'denied'|'not-determined'|'restricted'; platform: string }>
  requestMicPermission: () => Promise<boolean>

  // Free Trial
  startTrial:     () => Promise<{ ok: boolean; trial_token?: string; started_at?: string; expires_at?: string; expired?: boolean; already_used?: boolean; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: { duration_ms: number; ai_requests: number; stt_minutes: number; search_requests: number }; error?: string; status?: number }>
  getTrialStatus: () => Promise<{ ok: boolean; expired?: boolean; remaining_ms?: number; started_at?: string; expires_at?: string; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: object; error?: string }>
  getLocalTrial:  () => Promise<{ hasToken: boolean; trialClaimed?: boolean; trialToken?: string; expiresAt?: string; startedAt?: string; expired?: boolean }>
  convertTrial:   (choice: string) => Promise<{ ok: boolean }>
  endTrialByok:        () => Promise<{ success: boolean; error?: string }>
  wipeTrialProfileData: () => Promise<{ success: boolean; error?: string }>
  onTrialEnded:   (cb: (data: { choice: string }) => void) => () => void

  // STT Provider Management
  setSttProvider: (provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'teamsync') => Promise<{ success: boolean; error?: string }>
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
  testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey: string, region?: string) => Promise<{ success: boolean; error?: string }>

  // STT Config Events (fired when STT provider/key changes during a meeting)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => () => void
  onCredentialsChanged: (callback: () => void) => () => void

  // Native Audio Service Events
  onNativeAudioTranscript: (callback: (transcript: { speaker: string; text: string; final: boolean; _sessionId?: string }) => void) => () => void
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
  sttDebugSimulateFailure: (channel: 'user' | 'interviewer', provider?: string, reason?: string) => Promise<{ success: boolean; error?: string; channel?: 'user' | 'interviewer'; provider?: string }>
  sttDebugPrimeReplayBuffer: (channel: 'user' | 'interviewer', durationMs?: number) => Promise<{ success: boolean; entryCount?: number; durationMs?: number; error?: string }>
  getSttRuntimeState: () => Promise<{ user: any; interviewer: any; error?: string }>
  setSttDebugEnabled: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; error?: string }>
  getSttDebugEnabled: () => Promise<boolean>
  runSttFailoverValidation: (channel?: 'user' | 'interviewer') => Promise<{ success: boolean; channel: 'user' | 'interviewer'; assertions: Record<string, boolean>; beforeProvider: string; afterProvider: string; replayBuffer: { entryCount: number; durationMs: number } | null; logs: string[] }>
  runSttLoadTest: (channel?: 'user' | 'interviewer', options?: { durationMinutes?: number; chunkMs?: number; sampleRate?: number; audioChannelCount?: number; failureEveryMs?: number; metricsSampleEveryMs?: number }) => Promise<any>

  getNativeAudioStatus: () => Promise<{ connected: boolean }>

  // Intelligence Mode IPC
  generateAssist: () => Promise<{ insight: string | null }>
  generateAction: (payload: { intent: 'what_to_answer' | 'recap' | 'clarify' | 'brainstorm' | 'follow_up_questions' | 'answer_now'; message?: string; additionalContext?: string; imagePaths?: string[]; requestId?: string; profilePreference?: 'default' | 'force_on' | 'force_off' }) => Promise<{ success: boolean; result: string | null }>
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
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>
  cancelIntelligenceRequest: () => Promise<{ success: boolean; error?: string }>
  cancelIntelligenceByRequest: (requestId: string) => Promise<{ success: boolean; error?: string }>
  getSessionMode: () => Promise<{ mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'system_design' }>
  setSessionMode: (mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'system_design') => Promise<{ success: boolean; mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'system_design' }>

  // Dynamic Action Button Mode
  getActionButtonMode: () => Promise<'recap' | 'brainstorm'>
  setActionButtonMode: (mode: 'recap' | 'brainstorm') => Promise<{ success: boolean }>
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => () => void
  onModeChanged: (callback: (data: { id: string | null; name: string | null; templateId?: string | null }) => void) => () => void
  onModesStateChanged: (callback: (state: ModesStateSnapshot) => void) => () => void

  // Modes
  modesGetState: () => Promise<ModesStateSnapshot>
  modesGetTemplates: () => Promise<PublicModeTemplate[]>
  modesGetAll: () => Promise<Array<{ id: string; name: string; templateType: string; customContext: string; isActive: boolean; createdAt: string; referenceFileCount: number }>>
  modesGetActive: () => Promise<{ id: string; name: string; templateType: string; customContext: string; isActive: boolean; createdAt: string } | null>
  modesCreate: (params: { name?: string; templateType?: string; templateId?: string }) => Promise<{ success: boolean; mode?: any; state?: ModesStateSnapshot; error?: string }>
  modesUpdate: (id: string, updates: { name?: string; templateType?: string; templateId?: string; customContext?: string; userPrompt?: string }) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>
  modesDelete: (id: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>
  modesSetSelected: (id: string | null) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>
  modesSetActive: (id: string | null) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>
  modesGetReferenceFiles: (modeId: string) => Promise<ModeReferenceFile[]>
  modesUploadReferenceFile: (modeId: string) => Promise<{ success: boolean; file?: ModeReferenceFile; state?: ModesStateSnapshot; cancelled?: boolean; error?: string }>
  modesDeleteReferenceFile: (id: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>
  modesGetNoteSections: (modeId: string) => Promise<Array<{ id: string; modeId: string; title: string; description: string; sortOrder: number }>>
  modesAddNoteSection: (modeId: string, title: string, description: string) => Promise<{ success: boolean; section?: any; state?: ModesStateSnapshot; error?: string }>
  modesUpdateNoteSection: (id: string, updates: { title?: string; description?: string }) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>
  modesDeleteNoteSection: (id: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>
  modesRemoveAllNoteSections: (modeId: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>
  modesResetNoteSections: (modeId: string) => Promise<{ success: boolean; state?: ModesStateSnapshot; error?: string }>

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>
  endMeeting: () => Promise<{ success: boolean; error?: string }>
  finalizeMicSTT: () => Promise<void>
  getRecentMeetings: () => Promise<Array<{ id: string; title: string; date: string; duration: string; summary: string }>>
  getMeetingDetails: (id: string) => Promise<any>
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>
  updateMeetingSummary: (id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }) => Promise<boolean>
  deleteMeeting: (id: string) => Promise<boolean>
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => Promise<void>

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceSuggestedAnswerToken: (callback: (data: { token: string; question: string; confidence: number; intent?: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number; intent?: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceRefinedAnswerToken: (callback: (data: { token: string; intent: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceRecap: (callback: (data: { summary: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceRecapToken: (callback: (data: { token: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceClarify: (callback: (data: { clarification: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceClarifyToken: (callback: (data: { token: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceSystemDesignTradeoffs: (callback: (data: { answer: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceSystemDesignTradeoffsToken: (callback: (data: { token: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceScreenScanToken: (callback: (data: { token: string; mode: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceScreenScanResult: (callback: (data: { answer: string; mode: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceManualStarted: (callback: (data?: { _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceActionToken: (callback: (data: { intent: string; token: string; mode: string; profileApplied?: boolean; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceActionResult: (callback: (data: { intent: string; content: string; mode: string; profileApplied?: boolean; _sessionId?: string; requestId?: string }) => void) => () => void
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void
  onIntelligenceError: (callback: (data: { error: string, mode: string; _sessionId?: string; requestId?: string }) => void) => () => void;
  // Session Management
  onSessionReset: (callback: (payload?: { sessionId: string }) => void) => () => void;
  onSessionModeChanged: (callback: (data: { mode: 'behavioral' | 'coding' | 'follow_up' | 'general' | 'system_design' }) => void) => () => void;

  // Streaming listeners
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean, requestId?: string }) => Promise<void>
  cancelGeminiChatStream: () => Promise<{ success: boolean }>
  onGeminiStreamToken: (callback: (data: { token: string; requestId?: string } | string) => void) => () => void
  onGeminiStreamDone: (callback: (data?: { requestId?: string }) => void) => () => void
  onGeminiStreamError: (callback: (data: { error: string; requestId?: string } | string) => void) => () => void;

  // Model Management
  getDefaultModel: () => Promise<{ model: string }>;
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  toggleModelSelector: (coords: { x: number; y: number }) => Promise<void>;
  forceRestartOllama: () => Promise<void>;

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>;

  // Groq Fast Text Mode
  getGroqFastTextMode: () => Promise<{ enabled: boolean }>;
  setGroqFastTextMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;

  // Demo
  seedDemo: () => Promise<{ success: boolean }>;

  // Custom Providers
  saveCustomProvider: (provider: any) => Promise<{ success: boolean; id?: string; error?: string }>;
  getCustomProviders: () => Promise<any[]>;
  deleteCustomProvider: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Follow-up Email
  generateFollowupEmail: (input: any) => Promise<string>;
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => Promise<string[]>;
  getCalendarAttendees: (eventId: string) => Promise<Array<{ email: string; name: string }>>;
  openMailto: (params: { to: string; subject: string; body: string }) => Promise<{ success: boolean; error?: string }>;

  // Audio Test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>;
  stopAudioTest: () => Promise<{ success: boolean }>;
  onAudioTestLevel: (callback: (level: number) => void) => () => void;

  // Database
  flushDatabase: () => Promise<{ success: boolean }>;

  onUndetectableChanged: (callback: (state: boolean) => void) => () => void;
  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => () => void;
  onModelChanged: (callback: (modelId: string) => void) => () => void;

  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => () => void;
  onOllamaPullComplete: (callback: () => void) => () => void;

  onMeetingsUpdated: (callback: () => void) => () => void

  // Provider Compatibility
  onIncompatibleProviderWarning: (callback: (data: { count: number, oldProvider: string, newProvider: string }) => void) => () => void;
  reindexIncompatibleMeetings: () => Promise<void>;

  // Theme API
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }>
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => () => void

  // Calendar
  calendarConnect: () => Promise<{ success: boolean; error?: string }>
  calendarDisconnect: () => Promise<{ success: boolean; error?: string }>
  getCalendarStatus: () => Promise<{ connected: boolean; email?: string }>
  getUpcomingEvents: () => Promise<Array<{ id: string; title: string; description?: string; startTime: string; endTime: string; link?: string; source: 'google' }>>
  calendarRefresh: () => Promise<{ success: boolean; error?: string }>
  calendarIntelligenceEvaluateEvents: (events: CalendarEventPayload[]) => Promise<CalendarModeRecommendation | null>
  calendarIntelligenceGetRecommendation: () => Promise<CalendarModeRecommendation | null>
  calendarIntelligenceDismiss: (eventId: string) => Promise<{ success: boolean }>

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
  testReleaseFetch: () => Promise<{ success: boolean; error?: string }>

  // RAG (Retrieval-Augmented Generation) API
  ragQueryMeeting: (meetingId: string, query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryLive: (query: string, requestId?: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryGlobal: (query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) => Promise<{ success: boolean }>
  ragIsMeetingProcessed: (meetingId: string) => Promise<boolean>
  ragGetQueueStatus: () => Promise<{ pending: number; processing: number; completed: number; failed: number }>
  ragRetryEmbeddings: () => Promise<{ success: boolean }>
  onRAGStreamChunk: (callback: (data: { meetingId?: string; global?: boolean; chunk: string; requestId?: string }) => void) => () => void
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean; requestId?: string }) => void) => () => void
  onRAGStreamError: (callback: (data: { meetingId?: string; global?: boolean; error: string; requestId?: string }) => void) => () => void

  // Donation API
  getDonationStatus: () => Promise<{ shouldShow: boolean; hasDonated: boolean; lifetimeShows: number }>;
  markDonationToastShown: () => Promise<{ success: boolean }>;
  setDonationComplete: () => Promise<{ success: boolean }>;

  // Keybind Management
  getKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  setKeybind: (id: string, accelerator: string) => Promise<boolean>
  resetKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => () => void
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void

  // Profile Engine API
  profileUploadResume: (filePath: string) => Promise<{ success: boolean; error?: string }>
  profileGetStatus: () => Promise<{ hasProfile: boolean; profileMode: boolean; isReady: boolean; name?: string; role?: string; totalExperienceYears?: number }>
  profileSetMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  profileDelete: () => Promise<{ success: boolean; error?: string }>
  profileGetProfile: () => Promise<any>
  profileSelectFile: () => Promise<{ success?: boolean; cancelled?: boolean; filePath?: string; error?: string }>

  // JD & Research API
  profileUploadJD: (filePath: string) => Promise<{ success: boolean; error?: string }>
  profileDeleteJD: () => Promise<{ success: boolean; error?: string }>
  profileResearchCompany: (companyName: string) => Promise<{ success: boolean; status?: string; research?: any; error?: string }>
  runCompanyResearch: (company: string, role: string, forceRefresh?: boolean) => Promise<{ success: boolean; status?: string; research?: any; error?: string }>
  onProfileUpdated: (callback: (data: any) => void) => () => void
  onProfileModeChanged: (callback: (enabled: boolean) => void) => () => void
  getTavilyKey: () => Promise<string | null>
  profileGenerateNegotiation: (force?: boolean) => Promise<{ success: boolean; script?: any; error?: string }>
  profileGetNegotiationState: () => Promise<{ success: boolean; enabled?: boolean; state?: any; isActive?: boolean; error?: string }>
  profileSetNegotiationContextEnabled: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; state?: any; isActive?: boolean; hasScript?: boolean; error?: string }>
  profileResetNegotiation: () => Promise<{ success: boolean; error?: string }>
  profileGetNotes: () => Promise<{ success: boolean; content: string; error?: string }>
  profileSaveNotes: (content: string) => Promise<{ success: boolean; error?: string }>
  setCustomNotesEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  getCustomNotesEnabled: () => Promise<{ success: boolean; enabled: boolean; error?: string }>
  overlayLogSystemDesignMode: (enabled: boolean) => Promise<{ success: boolean }>
  onNegotiationRestored: (callback: (data: { restored: boolean }) => void) => () => void
  onNegotiationRegenerated: (callback: (data: { regenerated: boolean }) => void) => () => void
  onNegotiationStateChanged: (callback: (data: { enabled: boolean; isActive: boolean; state: any }) => void) => () => void
  onGapAnalysisRestored: (callback: (data: { restored: boolean }) => void) => () => void
  onQuestionsRestored: (callback: (data: { restored: boolean }) => void) => () => void
  onKnowledgeEngineReady: (callback: (data: { isReady: boolean; restoredNodeCount: number; restoredOutputs: { negotiationScript: boolean; gapAnalysis: boolean; questions: boolean } }) => void) => () => void
  onProfileResearchUpdated: (callback: (data: { company: string; role: string; updatedAt: string; sourceCount: number }) => void) => () => void
  onCompanyResearchReady: (callback: (data: any) => void) => () => void

  // Tavily Search API
  setTavilyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>

  // Dynamic Model Discovery
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude', apiKey: string) => Promise<{ success: boolean; models?: {id: string, label: string}[]; error?: string }>
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude', modelId: string) => Promise<void>

  // License Management
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
  }>
  getAOTState: () => Promise<{
    engineReady: boolean;
    hasResume: boolean;
    hasJD: boolean;
    inputHash: string | null;
    negotiation: { exists: boolean; data: any | null; updatedAt: string | null; version: number; hash: string | null };
    gapAnalysis: { exists: boolean; data: any | null; updatedAt: string | null; version: number; hash: string | null };
    questions: { exists: boolean; data: any | null; updatedAt: string | null; version: number; hash: string | null };
  }>
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
  }>
  licenseActivate: (key: string) => Promise<{ success: boolean; error?: string }>
  licenseCheckPremium: () => Promise<boolean>
  licenseGetDetails: () => Promise<{ isPremium: boolean; plan?: string; provider?: string }>
  getUserPlan: () => Promise<{ plan: string; isActive: boolean; isPremium: boolean; provider?: string }>
  /** Async startup check — calls Dodo validate endpoint to detect server-side revocations. */
  licenseCheckPremiumAsync: () => Promise<boolean>
  onLicenseRestored: (callback: (data: { isPremium: boolean; plan?: string; provider?: string }) => void) => () => void
  onLicenseStatusChanged: (callback: (data: { isPremium: boolean, plan?: string }) => void) => () => void
  licenseDeactivate: () => Promise<void>
  licenseGetHardwareId: () => Promise<string>

  // Overlay Opacity (Stealth Mode)
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Advanced Stealth Mode
  stealthEngage: () => Promise<{ success: boolean; error?: string }>;
  stealthDisengage: () => Promise<{ success: boolean; error?: string }>;
  stealthGetState: () => Promise<{
    level: 'off' | 'basic' | 'advanced';
    processDisguised: boolean;
    windowsProtected: boolean;
    dockHidden: boolean;
    eventsBlocked: boolean;
    watchdogActive: boolean;
  }>;
  stealthGetConfig: () => Promise<{
    level: 'off' | 'basic' | 'advanced';
    processName: string;
    scrubEnvironment: boolean;
    blockAppleEvents: boolean;
    suppressCrashReporter: boolean;
    watchdogIntervalMs: number;
    hideFromScreenCapture: boolean;
    excludeFromMissionControl: boolean;
  } | null>;
  stealthUpdateConfig: (patch: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
  stealthIsEngaged: () => Promise<boolean>;
  onStealthStateChanged: (callback: (state: {
    level: 'off' | 'basic' | 'advanced';
    processDisguised: boolean;
    windowsProtected: boolean;
    dockHidden: boolean;
    eventsBlocked: boolean;
    watchdogActive: boolean;
  }) => void) => () => void;

  // Verbose / Debug Logging
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  getLogFilePath: () => Promise<string | null>;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;

  // Arch
  getArch: () => Promise<string>;
  getOsVersion: () => Promise<string>;

  // Cropper API
  cropperConfirmed: (bounds: { x: number; y: number; width: number; height: number }) => void;
  cropperCancelled: () => void;
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => () => void;

  // Platform
  platform: NodeJS.Platform;

  // Google Auth (Server-side OAuth + MongoDB)
  googleSignIn: () => Promise<{ success: boolean; token?: string; user?: { name: string; email: string; picture?: string; calendarConnected: boolean; isNewUser: boolean }; error?: string }>;
  googleVerifyToken: (token: string) => Promise<{ success: boolean; user?: any; error?: string }>;
  googleConnectCalendar: (loginHint: string) => Promise<{ success: boolean; error?: string }>;
  googleGetCalendarEvents: (token: string) => Promise<{ events?: any[]; success?: boolean; error?: string }>;
  googleLogout: (token?: string) => Promise<{ success: boolean }>;
  onAuthResult: (callback: (result: any) => void) => () => void;
  onAuthLoggedOut: (callback: () => void) => () => void;

  // Calendar status sync (Launcher <-> Settings)
  onCalendarStatusChanged: (callback: (status: { connected: boolean; email: string | null }) => void) => () => void;
  onCalendarRecommendationChanged: (callback: (recommendation: CalendarModeRecommendation | null) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
