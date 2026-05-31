/**
 * useCluelyOverlayBridge.ts
 *
 * Thin presentation adapter — same IPC/brain as TeamSyncInterface, separate renderer only.
 */

import { useState, useEffect, useRef, useCallback, useMemo, useReducer, type Dispatch, type SetStateAction } from 'react';
import { useShortcuts } from '../../hooks/useShortcuts';
import {
    getOverlayQuickActions,
    resolveOverlayCopilotMode,
    type OverlayQuickActionDef,
    type OverlayQuickActionId,
} from '../../lib/modes/overlayCopilotConfig';
import type { ModeTemplateId } from '../../lib/modes/types';
import { analytics, detectProviderType } from '../../lib/analytics/analytics.service';
import { getTranscriptDisplayLabel } from '../../utils/transcriptSpeakers';
import { useOverlayActiveSession } from '../../lib/overlay/useOverlayActiveSession';
import { useOverlayRecommendation } from '../../lib/overlay/useOverlayRecommendation';
import {
    getScreenScanModeForSessionMode,
    type OverlaySessionMode,
} from '../../lib/overlay/screenScanMode';
import {
    detectRealtimeMode,
    intentReducer,
    isSalaryRelatedText,
    type DetectedQuestionType,
    type IntentState,
} from '../../lib/overlay/overlayIntent';
import { deriveContextSummary } from '../../lib/overlay/overlayContextSummary';
import { generateResponseChips } from '../../lib/overlay/responseChips';
import { useOverlayIpcStreams } from './useOverlayIpcStreams';

export interface V2Message {
    id: string;
    role: 'user' | 'system' | 'interviewer';
    text: string;
    timestamp?: number;
    requestId?: string;
    questionTurnId?: string;
    isStreaming?: boolean;
    hasScreenshot?: boolean;
    screenshotPreview?: string;
    isCode?: boolean;
    intent?: string;
    source?: string;
    provider?: string;
    model?: string;
    question?: string;
    chips?: Array<{ label: string; variant: string }>;
    isNegotiationCoaching?: boolean;
    negotiationCoachingData?: any;
    intelligenceMetadata?: any;
    architectureJson?: unknown;
    metadata?: unknown;
}

type ScreenshotAttachment = { path: string; preview: string };
type SessionMode = DetectedQuestionType;
type ActionIntent = 'what_to_answer' | 'recap' | 'clarify' | 'brainstorm' | 'follow_up_questions' | 'answer_now';
type ContextSummary = { label: string; detail: string };
type FrozenTranscriptUiSnapshot = {
    rollingTranscript: string;
    rollingTranscriptSpeakerLabel: string;
    lastFinalSentence: string;
    isInterviewerSpeaking: boolean;
    overlayCopilotMode: ReturnType<typeof resolveOverlayCopilotMode>;
    activeQuickActions: OverlayQuickActionDef[];
    recommendedButton: OverlayQuickActionId;
    detectedQuestionType: DetectedQuestionType;
    contextSummary: ContextSummary;
};

let v2MsgCounter = 0;
function nextMsgId(): string {
    return `v2-${Date.now()}-${++v2MsgCounter}`;
}

let v2ReqCounter = 0;
function nextRequestId(prefix: string = 'v2'): string {
    return `${prefix}-${Date.now()}-${++v2ReqCounter}`;
}

const INTERVIEWER_TURN_GAP_MS = 15_000;
const LIVE_MEETING_RAG_ID = 'live-meeting-current';
const ACTION_CONTEXT_OVERRIDE_TIMEOUT_MS = 12_000;
const MANUAL_SESSION_MODE_KEY = 'teamsync_overlay_manual_session_mode';
const MANUAL_SESSION_MODE_EXPLICIT_KEY = 'teamsync_overlay_manual_session_mode_explicit';
const INTENT_TRANSCRIPT_SEGMENTS = 8;
const INTENT_TRANSCRIPT_MAX_CHARS = 1200;
const MAX_RESPONSE_HISTORY = 30;

function referencesPriorManualContext(text: string): boolean {
    return /\b(continue|elaborate|expand|go deeper|follow up|follow-up|what about|and what|and how|again|that|this|it|they|those|these|earlier|previous|above|last answer|conversation|transcript|meeting|call|based on|from the meeting|from this|using this|screenshot|screen)\b/i.test(text);
}

function isStandaloneManualInput(text: string, detectedMode: SessionMode, hasAttachments: boolean = false): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized || hasAttachments || referencesPriorManualContext(normalized)) return false;

    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (detectedMode === 'coding' || detectedMode === 'system_design') {
        return wordCount > 0 && wordCount <= 18;
    }

    if (detectedMode !== 'general') return false;
    const startsLikeStandaloneRequest = /^(who|what|when|where|why|how|can|could|should|would|do|does|did|is|are|am|will|help|explain|define|compare|summarize|rewrite|fix|debug|optimize|implement|write|solve|code|build|tell)\b/i.test(normalized);
    return wordCount > 0 && (wordCount <= 14 || startsLikeStandaloneRequest);
}

function buildManualStreamContext(text: string, detectedMode: SessionMode, finalizedTranscript: string, hasAttachments: boolean = false): string | undefined {
    const standaloneManualInput = isStandaloneManualInput(text, detectedMode, hasAttachments);
    const transcriptWindow = detectedMode === 'system_design' ? 250 : 700;
    const transcriptContext = standaloneManualInput ? '' : finalizedTranscript.slice(-transcriptWindow);

    return [
        transcriptContext,
        [
            'MANUAL INPUT CONTRACT:',
            '- The typed manual input is the authoritative latest user question.',
            '- Answer the USER QUESTION directly before considering any context.',
            '- If transcript/context conflicts with the typed question, ignore the transcript/context.',
            standaloneManualInput
                ? '- Treat this as a standalone typed request. Do not use transcript memory.'
                : '- Use transcript only when the typed question explicitly asks to continue or relate to prior discussion.',
        ].join('\n'),
        [
            'RESPONSE RULES:',
            '- Coding / DSA: Problem, Approach, Complexity, Solution with one fenced code block.',
            '- Coding fence rules: opening line ```c or detected language, code on following lines, closing line ```; never two backticks or inline solution code.',
            '- System design: concise 10-section architecture answer with exactly one ```architecture_json``` block; never Mermaid.',
            '- architecture_json rules: valid JSON only, no comments, no trailing commas, exact opening fence ```architecture_json and exact closing fence ```.',
            '- architecture_json node schema: {"id":"","label":"","kind":"","technology":"","purpose":"","layer":"","latency":"","failureMode":""}. Edge schema: {"source":"","target":"","label":"","protocol":"","latency":""}.',
            '- Minimum diagram quality: simple systems 12+ nodes, medium production 20+ nodes, FAANG-scale 35-60+ nodes. Include clients, edge/gateway, core services, async, data, cache, observability, and security layers.',
            '- Allowed node kinds: client, gateway, service, database, cache, queue, storage, external.',
            '- Reuse the exact same lowercase node ID every time. Do not rename the same component with different IDs later in the diagram.',
            '- Other questions: concise answer under 120 words.',
            '- No preamble.',
        ].join('\n'),
    ]
        .filter(Boolean)
        .join('\n\n') || undefined;
}

function capOverlayMessages(nextMessages: V2Message[]): V2Message[] {
    const systemIndexes: number[] = [];
    nextMessages.forEach((message, index) => {
        if (message.role === 'system') systemIndexes.push(index);
    });
    if (systemIndexes.length <= MAX_RESPONSE_HISTORY) return nextMessages;

    const firstKeptSystemIndex = systemIndexes[systemIndexes.length - MAX_RESPONSE_HISTORY];
    return nextMessages.slice(firstKeptSystemIndex);
}

const ACTION_CONTEXT_MESSAGES: Record<string, string> = {
    Answer: 'Generating response guidance…',
    Suggest: 'Preparing suggestions…',
    Clarify: 'Breaking down the question…',
    Brainstorm: 'Exploring approaches…',
    FollowUp: 'Preparing follow-up ideas…',
    'Follow Up': 'Preparing follow-up ideas…',
    Complexity: 'Analyzing complexity…',
    Tradeoffs: 'Evaluating tradeoffs…',
    Scale: 'Thinking through scaling…',
    DeepDive: 'Exploring implementation details…',
    'Deep Dive': 'Exploring implementation details…',
    Salary: 'Preparing negotiation guidance…',
};

function buildIntentTranscriptWindow(transcript: string, fallback: string): string {
    if (!transcript && !fallback) return '';
    const segments = transcript.split('  ·  ').filter(Boolean);
    const recent = segments.slice(-INTENT_TRANSCRIPT_SEGMENTS);
    let combined = recent.join(' ').trim();
    if (!combined && fallback) combined = fallback.trim();
    if (combined.length > INTENT_TRANSCRIPT_MAX_CHARS) {
        combined = combined.slice(-INTENT_TRANSCRIPT_MAX_CHARS).trim();
    }
    return combined;
}

export interface CluelyOverlayBridgeProps {
    onEndMeeting?: () => void;
    overlayOpacity?: number;
    hasProContextAccess?: boolean;
}

function readPersistedManualSessionMode(): SessionMode | null {
    try {
        localStorage.removeItem(MANUAL_SESSION_MODE_KEY);
        localStorage.removeItem(MANUAL_SESSION_MODE_EXPLICIT_KEY);
    } catch {
        /* ignore localStorage access issues */
    }
    return null;
}

export function useCluelyOverlayBridge(props: CluelyOverlayBridgeProps) {
    const { onEndMeeting, overlayOpacity = 0.65, hasProContextAccess = false } = props;
    const { isShortcutPressed } = useShortcuts();

    const [messages, setMessagesRaw] = useState<V2Message[]>([]);
    const setMessages = useCallback<Dispatch<SetStateAction<V2Message[]>>>((updater) => {
        setMessagesRaw((prev) => {
            const next = typeof updater === 'function'
                ? (updater as (value: V2Message[]) => V2Message[])(prev)
                : updater;
            return capOverlayMessages(next);
        });
    }, []);
    const [attachedContext, setAttachedContext] = useState<ScreenshotAttachment[]>([]);
    const attachedContextRef = useRef<ScreenshotAttachment[]>([]);
    const activeResponseRef = useRef<V2Message | null>(null);
    const [activeResponseIndex, setActiveResponseIndex] = useState(-1);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(true);
    const [lastFinalSentence, setLastFinalSentence] = useState('');
    const [rollingTranscript, setRollingTranscript] = useState('');
    const [rollingTranscriptSpeakerLabel, setRollingTranscriptSpeakerLabel] = useState('');
    const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
    const [isTranscriptPaused, setIsTranscriptPaused] = useState(false);
    const [actionContextSummaryOverride, setActionContextSummaryOverride] = useState<{
        label: string;
        detail: string;
    } | null>(null);

    const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);
    const [activeModeTemplateId, setActiveModeTemplateId] = useState<ModeTemplateId | null>(null);
    const [isMeetingActive, setIsMeetingActive] = useState(false);
    const [session, setSession] = useState<{ currentMode: SessionMode }>({ currentMode: 'general' });
    const manualSessionModeRef = useRef<SessionMode | null>(readPersistedManualSessionMode());
    const [brainstormEnabled, setBrainstormEnabled] = useState<boolean>(() => {
        try {
            return localStorage.getItem('teamsync_brainstorm_enabled') !== 'false';
        } catch {
            return true;
        }
    });

    const [intentState, dispatchIntent] = useReducer(intentReducer, {
        detectedType: 'general',
        lastStrongType: 'general',
        lastStrongAt: performance.now(),
        seq: 0,
    } satisfies IntentState);
    const [currentQuestionTurnId, setCurrentQuestionTurnId] = useState('');
    const currentQuestionTurnIdRef = useRef<string | null>(null);

    const [sttInterviewerStatus, setSttInterviewerStatus] = useState<string>('connected');
    const [sttInterviewerError, setSttInterviewerError] = useState<string | undefined>();
    const [sttInterviewerProvider, setSttInterviewerProvider] = useState<string>('');
    const [sttUserStatus, setSttUserStatus] = useState<string>('connected');
    const [sttUserError, setSttUserError] = useState<string | undefined>();

    const currentTurnTextRef = useRef('');
    const lastFinalSentenceRef = useRef('');
    const finalizedTranscriptRef = useRef('');
    const rollingTranscriptRef = useRef('');
    const rollingTranscriptSpeakerLabelRef = useRef('');
    const isInterviewerSpeakingRef = useRef(false);
    const isTranscriptPausedRef = useRef(false);
    const lastInterviewerFinalTimestampRef = useRef(0);
    const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const actionContextOverrideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const frozenTranscriptUiSnapshotRef = useRef<FrozenTranscriptUiSnapshot | null>(null);

    const activeChatRequestIdRef = useRef<string | null>(null);
    const activeIntelligenceRequestIdRef = useRef<string | null>(null);
    const activeRagRequestIdRef = useRef<string | null>(null);
    const activeScreenScanRequestIdRef = useRef<string | null>(null);
    const activeIntentRequestIdsRef = useRef<Record<string, string>>({});

    const requestStartTimeRef = useRef<number | null>(null);
    const [currentModel, setCurrentModel] = useState('gemini-3-flash-preview');
    const currentModelRef = useRef('gemini-3-flash-preview');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [customNotesEnabled, setCustomNotesEnabled] = useState(true);
    const currentSourceRef = useRef<string | undefined>();
    const seqRef = useRef(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const [inputValue, setInputValue] = useState('');
    const [showTranscript, setShowTranscript] = useState(() => {
        try {
            return localStorage.getItem('teamsync_interviewer_transcript') !== 'false';
        } catch {
            return true;
        }
    });
    const [meetingStartTime, setMeetingStartTime] = useState(() => Date.now());

    // ── Negotiation context auto-toggle (V1 parity) ──
    const [negotiationContextEnabled, setNegotiationContextEnabled] = useState(false);
    const [hasNegotiationScript, setHasNegotiationScript] = useState(false);
    const negotiationAutoEnabledRef = useRef(false);

    const persistManualSessionMode = useCallback((mode: SessionMode | null) => {
        try {
            if (!mode) {
                localStorage.removeItem(MANUAL_SESSION_MODE_KEY);
                localStorage.removeItem(MANUAL_SESSION_MODE_EXPLICIT_KEY);
                return;
            }
            localStorage.setItem(MANUAL_SESSION_MODE_KEY, mode);
            localStorage.setItem(MANUAL_SESSION_MODE_EXPLICIT_KEY, 'true');
        } catch {
            /* ignore localStorage access issues */
        }
    }, []);

    useEffect(() => {
        if (!hasProContextAccess) return;
        window.electronAPI?.profileGetNegotiationState?.()
            .then((res: { hasScript?: boolean; isActive?: boolean }) => {
                if (typeof res?.hasScript === 'boolean') setHasNegotiationScript(res.hasScript);
                if (typeof res?.isActive === 'boolean') setNegotiationContextEnabled(res.isActive);
            })
            .catch(() => {});
    }, [hasProContextAccess]);

    const handleToggleNegotiationContext = useCallback(async (enabled: boolean) => {
        if (!hasProContextAccess || !window.electronAPI?.profileSetNegotiationContextEnabled) return;
        try {
            const result = await window.electronAPI.profileSetNegotiationContextEnabled(enabled);
            if (result?.success) {
                const nextEnabled = Boolean(result.enabled ?? result.isActive ?? enabled);
                setNegotiationContextEnabled(nextEnabled);
                if (typeof result.hasScript === 'boolean') setHasNegotiationScript(result.hasScript);
            }
        } catch { /* silent */ }
    }, [hasProContextAccess]);

    useEffect(() => {
        if (!currentQuestionTurnId || !hasProContextAccess || !hasNegotiationScript) return;
        const text = currentTurnTextRef.current?.trim() || lastFinalSentenceRef.current?.trim() || '';
        if (text.length < 5) return;
        const isSalary = isSalaryRelatedText(text);

        if (isSalary && !negotiationContextEnabled) {
            negotiationAutoEnabledRef.current = true;
            handleToggleNegotiationContext(true);
        } else if (!isSalary && negotiationAutoEnabledRef.current && negotiationContextEnabled) {
            negotiationAutoEnabledRef.current = false;
            handleToggleNegotiationContext(false);
        }
    }, [currentQuestionTurnId, hasProContextAccess, hasNegotiationScript, negotiationContextEnabled, handleToggleNegotiationContext]);

    const detectedQuestionType = intentState.detectedType;
    const pinnedSessionMode = manualSessionModeRef.current;
    const recommendationMode: SessionMode =
        pinnedSessionMode
            ? (detectedQuestionType === 'salary' ? 'salary' : pinnedSessionMode)
            : detectedQuestionType;
    const liveOverlayCopilotMode = useMemo(
        () =>
            resolveOverlayCopilotMode(
                isMeetingActive ? activeModeTemplateId : 'general',
                isMeetingActive ? recommendationMode : 'general',
            ),
        [activeModeTemplateId, isMeetingActive, recommendationMode],
    );

    const liveActiveQuickActions = useMemo(
        () => getOverlayQuickActions(liveOverlayCopilotMode, brainstormEnabled),
        [liveOverlayCopilotMode, brainstormEnabled],
    );

    const derivedContextSummary = useMemo(
        () =>
            deriveContextSummary(
                liveOverlayCopilotMode,
                lastFinalSentenceRef.current || finalizedTranscriptRef.current,
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [liveOverlayCopilotMode, lastFinalSentence, currentQuestionTurnId, detectedQuestionType],
    );

    const liveContextSummary = actionContextSummaryOverride ?? derivedContextSummary;
    const previousDetectedQuestionTypeRef = useRef<SessionMode>('general');
    useEffect(() => {
        if (previousDetectedQuestionTypeRef.current === detectedQuestionType) return;
        console.log('[MODE_PIPELINE]', JSON.stringify({
            source: currentSourceRef.current === 'Manual Input' ? 'manual_input' : 'transcript',
            input: currentTurnTextRef.current || lastFinalSentenceRef.current,
            detectedMode: detectedQuestionType,
            previousMode: previousDetectedQuestionTypeRef.current,
            nextMode: recommendationMode,
        }));
        previousDetectedQuestionTypeRef.current = detectedQuestionType;
    }, [detectedQuestionType, recommendationMode]);

    const prevIsProcessingRef = useRef(isProcessing);
    useEffect(() => {
        const wasProcessing = prevIsProcessingRef.current;
        prevIsProcessingRef.current = isProcessing;
        if (wasProcessing && !isProcessing) {
            setActionContextSummaryOverride(null);
        }
    }, [isProcessing]);

    useEffect(() => {
        if (actionContextOverrideTimeoutRef.current) {
            clearTimeout(actionContextOverrideTimeoutRef.current);
            actionContextOverrideTimeoutRef.current = null;
        }

        if (!actionContextSummaryOverride || !isProcessing) return;

        actionContextOverrideTimeoutRef.current = setTimeout(() => {
            actionContextOverrideTimeoutRef.current = null;
            setActionContextSummaryOverride(null);
        }, ACTION_CONTEXT_OVERRIDE_TIMEOUT_MS);

        return () => {
            if (actionContextOverrideTimeoutRef.current) {
                clearTimeout(actionContextOverrideTimeoutRef.current);
                actionContextOverrideTimeoutRef.current = null;
            }
        };
    }, [actionContextSummaryOverride, isProcessing]);

    const rememberIntentRequest = useCallback((intent: string, requestId: string | null) => {
        if (!requestId) {
            delete activeIntentRequestIdsRef.current[intent];
            return;
        }
        activeIntentRequestIdsRef.current[intent] = requestId;
    }, []);

    const resolveIntentRequestId = useCallback((intent: string, requestId?: string | null) => {
        return requestId || activeIntentRequestIdsRef.current[intent] || null;
    }, []);

    const resetOverlayRecommendationState = useCallback(() => {
        currentQuestionTurnIdRef.current = null;
        setCurrentQuestionTurnId('');
        setSession({ currentMode: manualSessionModeRef.current ?? 'general' });
        dispatchIntent({ type: 'RESET' });
        seqRef.current = 0;
    }, []);

    const activeQuickActionIds = useMemo(
        () => liveActiveQuickActions.map((action) => action.id),
        [liveActiveQuickActions],
    );

    const {
        recommendedButton,
        resetRecommendation,
        pinRecommendationForTurn,
        unlockRecommendationForTurn,
    } =
        useOverlayRecommendation({
            overlayCopilotMode: liveOverlayCopilotMode,
            detectedQuestionType,
            isMeetingActive,
            lastFinalSentenceRef,
            finalizedTranscriptRef,
            currentQuestionTurnId,
            activeQuickActionIds,
            transcriptRevision: lastFinalSentence,
        });

    const syncTranscriptUiFromRefs = useCallback(() => {
        setRollingTranscript(rollingTranscriptRef.current);
        setRollingTranscriptSpeakerLabel(rollingTranscriptSpeakerLabelRef.current);
        setLastFinalSentence(lastFinalSentenceRef.current);
        setIsInterviewerSpeaking(isInterviewerSpeakingRef.current);
    }, []);

    useEffect(() => {
        isTranscriptPausedRef.current = isTranscriptPaused;
    }, [isTranscriptPaused]);

    const toggleTranscriptPause = useCallback(() => {
        if (isTranscriptPausedRef.current) {
            isTranscriptPausedRef.current = false;
            setIsTranscriptPaused(false);
            return;
        }

        isTranscriptPausedRef.current = true;
        frozenTranscriptUiSnapshotRef.current = {
            rollingTranscript,
            rollingTranscriptSpeakerLabel,
            lastFinalSentence,
            isInterviewerSpeaking,
            overlayCopilotMode: liveOverlayCopilotMode,
            activeQuickActions: liveActiveQuickActions,
            recommendedButton,
            detectedQuestionType,
            contextSummary: liveContextSummary,
        };
        setIsTranscriptPaused(true);
    }, [
        rollingTranscript,
        rollingTranscriptSpeakerLabel,
        lastFinalSentence,
        isInterviewerSpeaking,
        liveOverlayCopilotMode,
        liveActiveQuickActions,
        recommendedButton,
        detectedQuestionType,
        liveContextSummary,
    ]);

    const markCurrentTurnFromText = useCallback((text: string, source: 'manual_input' | 'transcript' = 'transcript') => {
        const nextText = text.trim();
        if (nextText.length < 3) return;

        unlockRecommendationForTurn();
        currentTurnTextRef.current = nextText;
        const previousMode = intentState.detectedType;
        const questionTurnId = nextRequestId('question-turn');
        currentQuestionTurnIdRef.current = questionTurnId;
        setCurrentQuestionTurnId(questionTurnId);
        const seq = ++seqRef.current;
        console.log('[MODE_PIPELINE]', JSON.stringify({
            source,
            input: nextText,
            detectedMode: 'pending',
            previousMode,
            nextMode: 'pending',
        }));
        dispatchIntent({
            type: 'EVALUATE',
            combinedText: nextText,
            now: performance.now(),
            seq,
        });
    }, [intentState.detectedType, unlockRecommendationForTurn]);

    const onSessionReset = useCallback(() => {
        void window.electronAPI.cancelGeminiChatStream?.().catch(() => {});
        void window.electronAPI.cancelIntelligenceRequest?.().catch(() => {});
        void window.electronAPI.ragCancelQuery?.({ meetingId: LIVE_MEETING_RAG_ID }).catch(() => {});

        setMessages([]);
        setAttachedContext([]);
        setActiveResponseIndex(-1);
        setInputValue('');
        setIsProcessing(false);
        setRollingTranscript('');
        setRollingTranscriptSpeakerLabel('');
        setIsInterviewerSpeaking(false);
        setIsTranscriptPaused(false);
        currentTurnTextRef.current = '';
        finalizedTranscriptRef.current = '';
        rollingTranscriptRef.current = '';
        rollingTranscriptSpeakerLabelRef.current = '';
        isInterviewerSpeakingRef.current = false;
        isTranscriptPausedRef.current = false;
        setLastFinalSentence('');
        lastFinalSentenceRef.current = '';
        lastInterviewerFinalTimestampRef.current = 0;
        frozenTranscriptUiSnapshotRef.current = null;

        activeChatRequestIdRef.current = null;
        activeIntelligenceRequestIdRef.current = null;
        activeRagRequestIdRef.current = null;
        activeScreenScanRequestIdRef.current = null;
        activeIntentRequestIdsRef.current = {};
        requestStartTimeRef.current = null;
        currentSourceRef.current = undefined;
        manualSessionModeRef.current = null;
        persistManualSessionMode(null);
        setSession({ currentMode: 'general' });

        resetRecommendation();
        resetOverlayRecommendationState();
        analytics.trackConversationStarted();
    }, [persistManualSessionMode, resetRecommendation, resetOverlayRecommendationState]);

    const { isStalePayload, adoptSessionIdFromPayload } = useOverlayActiveSession({
        onSessionReset,
    });

    const resetAllRecommendationState = useCallback(() => {
        resetRecommendation();
        resetOverlayRecommendationState();
    }, [resetRecommendation, resetOverlayRecommendationState]);

    const cancelInFlightOverlayRequests = useCallback(async (nextRequestId?: string) => {
        const cancelIds = new Set<string>();
        if (activeChatRequestIdRef.current && activeChatRequestIdRef.current !== nextRequestId) {
            cancelIds.add(activeChatRequestIdRef.current);
        }
        if (activeIntelligenceRequestIdRef.current && activeIntelligenceRequestIdRef.current !== nextRequestId) {
            cancelIds.add(activeIntelligenceRequestIdRef.current);
        }
        if (activeRagRequestIdRef.current && activeRagRequestIdRef.current !== nextRequestId) {
            cancelIds.add(activeRagRequestIdRef.current);
        }
        if (activeScreenScanRequestIdRef.current && activeScreenScanRequestIdRef.current !== nextRequestId) {
            cancelIds.add(activeScreenScanRequestIdRef.current);
        }
        Object.values(activeIntentRequestIdsRef.current).forEach((id) => {
            if (id && id !== nextRequestId) cancelIds.add(id);
        });

        if (cancelIds.size > 0) {
            setMessages((prev) => prev.map((message) => {
                if (!message.requestId || !cancelIds.has(message.requestId) || !message.isStreaming) {
                    return message;
                }
                return {
                    ...message,
                    isStreaming: false,
                };
            }));
        }

        await Promise.allSettled([
            window.electronAPI.cancelGeminiChatStream?.(),
            ...Array.from(cancelIds).map((id) => window.electronAPI.cancelIntelligenceByRequest?.(id)),
            window.electronAPI.ragCancelQuery?.({ meetingId: LIVE_MEETING_RAG_ID }),
        ]);

        if (!nextRequestId || activeChatRequestIdRef.current !== nextRequestId) {
            activeChatRequestIdRef.current = null;
        }
        if (!nextRequestId || activeIntelligenceRequestIdRef.current !== nextRequestId) {
            activeIntelligenceRequestIdRef.current = null;
        }
        if (!nextRequestId || activeRagRequestIdRef.current !== nextRequestId) {
            activeRagRequestIdRef.current = null;
        }
        if (!nextRequestId || activeScreenScanRequestIdRef.current !== nextRequestId) {
            activeScreenScanRequestIdRef.current = null;
        }
        if (!nextRequestId) {
            setIsProcessing(false);
        }
        requestStartTimeRef.current = null;
        currentSourceRef.current = undefined;
    }, []);

    useEffect(() => {
        attachedContextRef.current = attachedContext;
    }, [attachedContext]);

    const appendScreenshotAttachment = useCallback((data: ScreenshotAttachment) => {
        if (!data?.path) return;
        setIsExpanded(true);
        setAttachedContext((prev) => {
            if (prev.some((s) => s.path === data.path)) {
                attachedContextRef.current = prev;
                return prev;
            }
            const next = [...prev, data].slice(-5);
            attachedContextRef.current = next;
            return next;
        });
    }, []);

    const clearAttachedContext = useCallback(() => {
        attachedContextRef.current = [];
        setAttachedContext([]);
    }, []);

    const removeAttachedContextAt = useCallback((index: number) => {
        setAttachedContext((prev) => {
            const next = prev.filter((_, i) => i !== index);
            attachedContextRef.current = next;
            return next;
        });
    }, []);

    const recomputeIntentFromFinalTranscript = useCallback(
        (questionTurnId: string) => {
            const combined = buildIntentTranscriptWindow(
                finalizedTranscriptRef.current,
                lastFinalSentenceRef.current,
            );
            if (combined.length < 3) return;

            unlockRecommendationForTurn();
            currentQuestionTurnIdRef.current = questionTurnId;
            setCurrentQuestionTurnId(questionTurnId);
            const seq = ++seqRef.current;
            console.log('[MODE_PIPELINE]', JSON.stringify({
                source: 'transcript',
                input: combined,
                detectedMode: 'pending',
                previousMode: intentState.detectedType,
                nextMode: 'pending',
            }));
            dispatchIntent({
                type: 'EVALUATE',
                combinedText: combined,
                now: performance.now(),
                seq,
            });
        },
        [intentState.detectedType, unlockRecommendationForTurn],
    );

    useEffect(() => {
        if (isTranscriptPaused) return;
        if (!frozenTranscriptUiSnapshotRef.current) return;

        frozenTranscriptUiSnapshotRef.current = null;
        syncTranscriptUiFromRefs();

        const latestFinal = lastFinalSentenceRef.current.trim();
        if (latestFinal.length < 3) return;

        const questionTurnId = nextRequestId('question-turn');
        recomputeIntentFromFinalTranscript(questionTurnId);
    }, [isTranscriptPaused, recomputeIntentFromFinalTranscript, syncTranscriptUiFromRefs]);

    const finishStreamingMessage = useCallback((requestId: string, intent?: string) => {
        setIsProcessing(false);
        currentSourceRef.current = undefined;
        if (activeIntelligenceRequestIdRef.current === requestId) {
            activeIntelligenceRequestIdRef.current = null;
        }
        if (activeChatRequestIdRef.current === requestId) {
            activeChatRequestIdRef.current = null;
        }
        if (activeRagRequestIdRef.current === requestId) {
            activeRagRequestIdRef.current = null;
        }
        if (activeScreenScanRequestIdRef.current === requestId) {
            activeScreenScanRequestIdRef.current = null;
        }

        let latency = 0;
        if (requestStartTimeRef.current) {
            latency = Date.now() - requestStartTimeRef.current;
            requestStartTimeRef.current = null;
        }
        analytics.trackModelUsed({
            model_name: currentModelRef.current,
            provider_type: detectProviderType(currentModelRef.current),
            latency_ms: latency,
        });

        setMessages((prev) => {
            const idx = prev.findIndex((msg) => msg.requestId === requestId);
            const lastMsg = idx >= 0 ? prev[idx] : null;
            if (!lastMsg || !lastMsg.isStreaming || lastMsg.role !== 'system') return prev;
            try {
                const parsed = JSON.parse(lastMsg.text);
                if (parsed?.__negotiationCoaching) {
                    const u = [...prev];
                    u[idx] = {
                        ...lastMsg,
                        isStreaming: false,
                        isNegotiationCoaching: true,
                        negotiationCoachingData: parsed.__negotiationCoaching,
                        text: '',
                    };
                    return u;
                }
            } catch {
                /* plain text */
            }
            const chips = generateResponseChips(lastMsg.text, intent ?? lastMsg.intent);
            const u = [...prev];
            u[idx] = {
                ...lastMsg,
                isStreaming: false,
                chips: chips.length > 0 ? chips : undefined,
            };
            return u;
        });
    }, []);

    const ipcStreamsCtx = useMemo(
        () => ({
            isStalePayload,
            activeChatRequestIdRef,
            activeIntelligenceRequestIdRef,
            activeRagRequestIdRef,
            activeScreenScanRequestIdRef,
            activeIntentRequestIdsRef,
            requestStartTimeRef,
            setMessages,
            setIsProcessing,
            setIsExpanded,
            nextMsgId,
            finishStreamingMessage,
            rememberIntentRequest,
            resolveIntentRequestId,
        }),
        [
            isStalePayload,
            nextMsgId,
            setIsExpanded,
            finishStreamingMessage,
            rememberIntentRequest,
            resolveIntentRequestId,
        ],
    );

    useOverlayIpcStreams(ipcStreamsCtx);

    useEffect(() => {
        window.electronAPI?.modesGetActive?.()
            .then((mode: any) => {
                setActiveModeLabel(mode?.name ?? null);
                setActiveModeTemplateId((mode?.templateType as ModeTemplateId | null | undefined) ?? null);
            })
            .catch(() => {});
        const unsub = window.electronAPI?.onModeChanged?.((data: any) => {
            setActiveModeLabel(data.name);
            setActiveModeTemplateId((data.templateId as ModeTemplateId | null | undefined) ?? null);
            // Reset stale sub-mode state for templates that support sub-mode detection.
            // For template-locked modes (general, sales, etc.) this is defensive —
            // resolveOverlayCopilotMode ignores sessionMode for those templates anyway.
            dispatchIntent({ type: 'RESET' });
            manualSessionModeRef.current = null;
            persistManualSessionMode(null);
            // Clear accumulated transcript so sub-mode detection starts fresh
            finalizedTranscriptRef.current = '';
            currentTurnTextRef.current = '';
            lastFinalSentenceRef.current = '';
        });
        return () => unsub?.();
    }, [persistManualSessionMode]);

    useEffect(() => {
        window.electronAPI?.getSessionMode?.()
            .then((result: any) => {
                if (!result?.mode) return;
                const nextMode = result.mode as SessionMode;
                setSession({ currentMode: nextMode });
            })
            .catch(() => {});
        const unsub = window.electronAPI?.onSessionModeChanged?.((data: any) => {
            if (!data?.mode) return;
            const nextMode = data.mode as SessionMode;
            manualSessionModeRef.current = nextMode === 'general' ? null : nextMode;
            persistManualSessionMode(manualSessionModeRef.current);
            setSession({ currentMode: nextMode });
        });
        return () => unsub?.();
    }, [persistManualSessionMode]);

    useEffect(() => {
        console.log('[MODE_DEBUG]', JSON.stringify({
            templateId: activeModeTemplateId,
            recommendationMode,
            liveOverlayCopilotMode,
            sessionMode: session.currentMode,
            finalResolvedMode: liveOverlayCopilotMode,
            sessionModeLocked: Boolean(manualSessionModeRef.current),
            overlayVersion: 'pro-v2',
            source: currentSourceRef.current,
            renderReason: 'mode_state_changed',
        }));
    }, [
        activeModeTemplateId,
        recommendationMode,
        liveOverlayCopilotMode,
        session.currentMode,
        detectedQuestionType,
    ]);

    useEffect(() => {
        if (!window.electronAPI?.onEnsureExpanded) return;
        return window.electronAPI.onEnsureExpanded(() => setIsExpanded(true));
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onMeetingStateChanged) return;
        window.electronAPI
            .getMeetingActive?.()
            .then((active: boolean) => {
                setIsMeetingActive(active);
                if (active) setMeetingStartTime(Date.now());
            })
            .catch(() => {});
        const unsubscribe = window.electronAPI.onMeetingStateChanged(({ isActive }: { isActive: boolean }) => {
            setIsMeetingActive(isActive);
            if (isActive) {
                setMeetingStartTime(Date.now());
            } else {
                resetAllRecommendationState();
            }
        });
        return () => unsubscribe();
    }, [resetAllRecommendationState]);

    useEffect(() => {
        if (!window.electronAPI?.onSttStatusChanged) return;
        const unsub = window.electronAPI.onSttStatusChanged((data: any) => {
            if (data.channel === 'interviewer') {
                setSttInterviewerStatus(data.status ?? data.state);
                setSttInterviewerError(data.error);
                setSttInterviewerProvider(data.provider || '');
            } else if (data.channel === 'user') {
                setSttUserStatus(data.status ?? data.state);
                setSttUserError(data.error);
            }
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        const cleanups: (() => void)[] = [];

        cleanups.push(
            window.electronAPI.onNativeAudioTranscript((transcript: any) => {
                adoptSessionIdFromPayload(transcript._sessionId);
                if (isStalePayload(transcript._sessionId)) return;
                if (transcript.speaker === 'user') return;
                if (transcript.speaker !== 'interviewer') return;

                const transcriptLabel = getTranscriptDisplayLabel(transcript);
                const isPaused = isTranscriptPausedRef.current;
                rollingTranscriptSpeakerLabelRef.current = transcriptLabel;
                isInterviewerSpeakingRef.current = !transcript.final;

                if (!isPaused) {
                    setRollingTranscriptSpeakerLabel(transcriptLabel);
                    setIsInterviewerSpeaking(!transcript.final);
                }

                if (transcript.final) {
                    const now = Date.now();
                    finalizedTranscriptRef.current +=
                        (finalizedTranscriptRef.current ? '  ·  ' : '') + transcript.text;
                    if (finalizedTranscriptRef.current.length > 5000) {
                        finalizedTranscriptRef.current = finalizedTranscriptRef.current.slice(-5000);
                    }
                    rollingTranscriptRef.current = finalizedTranscriptRef.current;
                    if (!isPaused) {
                        setRollingTranscript(finalizedTranscriptRef.current);
                    }

                    const gapSinceLastFinal = now - lastInterviewerFinalTimestampRef.current;
                    if (
                        lastInterviewerFinalTimestampRef.current > 0 &&
                        gapSinceLastFinal <= INTERVIEWER_TURN_GAP_MS
                    ) {
                        lastFinalSentenceRef.current =
                            lastFinalSentenceRef.current + ' ' + transcript.text;
                    } else {
                        lastFinalSentenceRef.current = transcript.text;
                    }
                    lastInterviewerFinalTimestampRef.current = now;
                    currentTurnTextRef.current = lastFinalSentenceRef.current;

                    if (!isPaused) {
                        setLastFinalSentence(lastFinalSentenceRef.current);
                        const questionTurnId = nextRequestId('question-turn');
                        recomputeIntentFromFinalTranscript(questionTurnId);
                    }

                    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
                    speakingTimerRef.current = setTimeout(() => {
                        isInterviewerSpeakingRef.current = false;
                        if (!isTranscriptPausedRef.current) {
                            setIsInterviewerSpeaking(false);
                        }
                    }, 3000);
                } else {
                    rollingTranscriptRef.current =
                        finalizedTranscriptRef.current +
                        (finalizedTranscriptRef.current ? '  ·  ' : '') +
                        transcript.text;

                    if (!isPaused) {
                        setRollingTranscript(rollingTranscriptRef.current);
                    }
                }
            }),
        );

        return () => cleanups.forEach((fn) => fn());
    }, [adoptSessionIdFromPayload, isStalePayload, recomputeIntentFromFinalTranscript]);

    useEffect(() => {
        currentModelRef.current = currentModel;
    }, [currentModel]);

    useEffect(() => {
        if (window.electronAPI?.getDefaultModel) {
            window.electronAPI
                .getDefaultModel()
                .then((result: { model?: string }) => {
                    if (result?.model) {
                        setCurrentModel(result.model);
                        currentModelRef.current = result.model;
                        window.electronAPI.setModel?.(result.model).catch(() => {});
                    }
                })
                .catch(() => {});
        }
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onModelChanged) return;
        return window.electronAPI.onModelChanged((modelId: string) => {
            setCurrentModel((prev) => (prev === modelId ? prev : modelId));
            currentModelRef.current = modelId;
        });
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onSettingsVisibilityChange) return;
        return window.electronAPI.onSettingsVisibilityChange((isVisible: boolean) => {
            setIsSettingsOpen(isVisible);
        });
    }, []);

    useEffect(() => {
        window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => {});
        const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v: boolean) => {
            setIsMousePassthrough(v);
        });
        return () => unsub?.();
    }, []);

    const toggleMousePassthrough = useCallback(() => {
        setIsMousePassthrough((prev) => {
            const next = !prev;
            window.electronAPI?.setOverlayMousePassthrough?.(next);
            return next;
        });
    }, []);

    useEffect(() => {
        if (!hasProContextAccess) return;
        window.electronAPI
            ?.getCustomNotesEnabled?.()
            .then((res: { success?: boolean; enabled?: boolean }) => {
                if (res?.success) setCustomNotesEnabled(Boolean(res.enabled));
            })
            .catch(() => {});
    }, [hasProContextAccess]);

    const toggleCustomContext = useCallback(async () => {
        const next = !customNotesEnabled;
        setCustomNotesEnabled(next);
        await window.electronAPI?.setCustomNotesEnabled?.(next);
    }, [customNotesEnabled]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isShortcutPressed(e, 'toggleMousePassthrough')) return;
            e.preventDefault();
            toggleMousePassthrough();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isShortcutPressed, toggleMousePassthrough]);

    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('teamsync_brainstorm_enabled');
            setBrainstormEnabled(stored !== 'false');
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const runAction = useCallback(
        async (
            intent: string,
            options?: {
                source?: string;
                analyticsKey?: string;
                message?: string;
                additionalContext?: string;
                imagePaths?: string[];
                profilePreference?: string;
                userBubbleText?: string;
                screenshotPreview?: string;
            },
        ) => {
            await cancelInFlightOverlayRequests();

            setIsExpanded(true);
            analytics.trackCommandExecuted(options?.analyticsKey ?? intent);

            const requestId = nextRequestId(intent);
            activeIntelligenceRequestIdRef.current = requestId;
            rememberIntentRequest(intent, requestId);
            setIsProcessing(true);
            requestStartTimeRef.current = Date.now();
            currentSourceRef.current = options?.source;

            const activeResponse = activeResponseRef.current;
            const activeResponseQuestion = activeResponse?.question?.trim() || '';
            const activeResponseText = activeResponse?.text?.trim() || '';
            const currentTurnText = currentTurnTextRef.current.trim();
            const latestFinalQuestion =
                activeResponseQuestion ||
                currentTurnText ||
                lastFinalSentenceRef.current.trim() ||
                finalizedTranscriptRef.current.split('  ·  ').pop()?.trim() ||
                '';
            const resolvedMessage =
                options?.message?.trim() || (intent === 'recap' ? '' : latestFinalQuestion);
            const activeResponseContext = activeResponse
                ? [
                    'ACTIVE RESPONSE CONTEXT:',
                    activeResponseQuestion ? `Original user question: ${activeResponseQuestion}` : '',
                    activeResponseText ? `Current answer excerpt: ${activeResponseText.slice(0, 1200)}` : '',
                    'Apply this action to the active response above, not to unrelated transcript text.',
                ].filter(Boolean).join('\n')
                : '';
            const mergedAdditionalContext = [
                options?.additionalContext,
                activeResponseContext,
            ].filter(Boolean).join('\n\n') || undefined;

            if (options?.userBubbleText || options?.screenshotPreview) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: nextMsgId(),
                        timestamp: Date.now(),
                        role: 'user',
                        text: options?.userBubbleText || options?.message || '',
                        hasScreenshot: Boolean(options?.screenshotPreview),
                        screenshotPreview: options?.screenshotPreview,
                    },
                ]);
            }

            setMessages((prev) => [
                ...prev,
                {
                    id: nextMsgId(),
                    timestamp: Date.now(),
                    requestId,
                    role: 'system',
                    text: '',
                    intent,
                    source: options?.source,
                    model: currentModelRef.current,
                    provider: detectProviderType(currentModelRef.current),
                    question: resolvedMessage || options?.userBubbleText || mergedAdditionalContext,
                    isStreaming: true,
                },
            ]);

            try {
                await window.electronAPI.generateAction({
                    intent: intent as ActionIntent,
                    message: resolvedMessage || undefined,
                    additionalContext: mergedAdditionalContext,
                    imagePaths: options?.imagePaths,
                    requestId,
                    profilePreference: options?.profilePreference as any,
                });
            } catch (err) {
                setIsProcessing(false);
                activeIntelligenceRequestIdRef.current = null;
                rememberIntentRequest(intent, null);
                setMessages((prev) => {
                    const idx = prev.findIndex((msg) => msg.requestId === requestId);
                    if (idx < 0) return prev;
                    const u = [...prev];
                    u[idx] = { ...u[idx], text: `❌ Error: ${err}`, isStreaming: false };
                    return u;
                });
            }
        },
        [cancelInFlightOverlayRequests, rememberIntentRequest],
    );

    const executeQuickAction = useCallback(
        async (action: OverlayQuickActionDef) => {
            if (!isTranscriptPausedRef.current) {
                pinRecommendationForTurn(action.id, currentQuestionTurnIdRef.current);
                setActionContextSummaryOverride({
                    label: derivedContextSummary.label,
                    detail:
                        ACTION_CONTEXT_MESSAGES[action.label] ?? `${action.label} in progress…`,
                });
            }
            await runAction(action.intent as string, {
                source: action.source,
                analyticsKey: action.analyticsKey,
                message: action.message,
                additionalContext: action.additionalContext,
                profilePreference: action.profilePreference,
            });
        },
        [derivedContextSummary.label, pinRecommendationForTurn, runAction],
    );

    const getQuickActionHandler = useCallback(
        (action: OverlayQuickActionDef): (() => void | Promise<void>) => {
            return () => executeQuickAction(action);
        },
        [executeQuickAction],
    );

    const handleManualSubmit = useCallback(
        async (text: string) => {
            const userText = text.trim();
            const currentAttachments = attachedContextRef.current;
            const hasAttachments = currentAttachments.length > 0;
            if (!userText && !hasAttachments) return;
            const promptText = userText || 'Analyze this screenshot';

            await cancelInFlightOverlayRequests();
            if (!isTranscriptPausedRef.current && userText) {
                markCurrentTurnFromText(userText, 'manual_input');
            }

            if (hasProContextAccess && hasNegotiationScript) {
                if (isSalaryRelatedText(userText) && !negotiationContextEnabled) {
                    negotiationAutoEnabledRef.current = true;
                    void handleToggleNegotiationContext(true);
                } else if (!isSalaryRelatedText(userText) && negotiationAutoEnabledRef.current && negotiationContextEnabled) {
                    negotiationAutoEnabledRef.current = false;
                    void handleToggleNegotiationContext(false);
                }
            }

            setInputValue('');
            clearAttachedContext();
            setIsExpanded(true);
            analytics.trackCommandExecuted('manual_input');
            currentSourceRef.current = 'Manual Input';

            const requestId = nextRequestId('manual');
            activeChatRequestIdRef.current = requestId;
            activeRagRequestIdRef.current = requestId;
            setIsProcessing(true);
            requestStartTimeRef.current = Date.now();

            setMessages((prev) => [
                ...prev,
                {
                    id: nextMsgId(),
                    timestamp: Date.now(),
                    role: 'user',
                    text: promptText,
                    hasScreenshot: hasAttachments,
                    screenshotPreview: currentAttachments[0]?.preview,
                },
                {
                    id: nextMsgId(),
                    timestamp: Date.now(),
                    requestId,
                    role: 'system',
                    text: '',
                    intent: 'manual_chat',
                    source: 'Manual Input',
                    model: currentModelRef.current,
                    provider: detectProviderType(currentModelRef.current),
                    question: promptText,
                    isStreaming: true,
                    hasScreenshot: hasAttachments,
                    screenshotPreview: currentAttachments[0]?.preview,
                },
            ]);

            const manualDetectedMode = detectRealtimeMode(promptText, 'general', 'general').nextType;
            const streamContext = buildManualStreamContext(promptText, manualDetectedMode, finalizedTranscriptRef.current);

            try {
                activeRagRequestIdRef.current = null;
                await window.electronAPI.streamGeminiChat(
                    promptText,
                    hasAttachments ? currentAttachments.map((attachment) => attachment.path) : undefined,
                    streamContext,
                    { requestId },
                );
            } catch (err) {
                setIsProcessing(false);
                activeChatRequestIdRef.current = null;
                activeRagRequestIdRef.current = null;
                setMessages((prev) => {
                    const idx = prev.findIndex((msg) => msg.requestId === requestId);
                    if (idx < 0) return prev;
                    const u = [...prev];
                    u[idx] = { ...u[idx], text: `❌ Error: ${err}`, isStreaming: false };
                    return u;
                });
            }
        },
        [
            cancelInFlightOverlayRequests,
            clearAttachedContext,
            handleToggleNegotiationContext,
            hasNegotiationScript,
            hasProContextAccess,
            markCurrentTurnFromText,
            negotiationContextEnabled,
        ],
    );

    const handleEndMeeting = useCallback(() => {
        onEndMeeting?.();
    }, [onEndMeeting]);

    const handleScreenScan = useCallback(async () => {
        try {
            await cancelInFlightOverlayRequests();

            const attached = attachedContextRef.current;
            const existingAttachment = attached[attached.length - 1] ?? null;
            const data = existingAttachment ?? await window.electronAPI.takeScreenshot();
            if (!data?.path) return;
            if (existingAttachment) {
                clearAttachedContext();
            }

            const requestId = nextRequestId('screen_scan');
            activeScreenScanRequestIdRef.current = requestId;
            rememberIntentRequest('screen_scan', requestId);
            setIsProcessing(true);
            setIsExpanded(true);
            requestStartTimeRef.current = Date.now();
            currentSourceRef.current = 'Screen Analysis';

            setMessages((prev) => [
                ...prev,
                {
                    id: nextMsgId(),
                    timestamp: Date.now(),
                    requestId,
                    role: 'system',
                    text: '',
                    intent: 'screen_scan',
                    source: 'Screen Analysis',
                    model: currentModelRef.current,
                    provider: detectProviderType(currentModelRef.current),
                    question: 'Screen analysis',
                    isStreaming: true,
                    hasScreenshot: true,
                    screenshotPreview: data.preview,
                },
            ]);

            const scanMode = getScreenScanModeForSessionMode(
                session.currentMode as OverlaySessionMode,
            );
            window.electronAPI.runScreenAnalysis({
                requestId,
                image: data.path,
                mode: scanMode,
            });

            analytics.trackCommandExecuted('screen_scan');
        } catch (err) {
            console.error('[V2] Screen scan error:', err);
            setIsProcessing(false);
            activeScreenScanRequestIdRef.current = null;
            rememberIntentRequest('screen_scan', null);
        }
    }, [cancelInFlightOverlayRequests, clearAttachedContext, rememberIntentRequest, session.currentMode]);

    useEffect(() => {
        const cleanupTaken = window.electronAPI.onScreenshotTaken?.(appendScreenshotAttachment);
        const cleanupAttached = window.electronAPI.onScreenshotAttached?.(appendScreenshotAttachment);
        return () => {
            cleanupTaken?.();
            cleanupAttached?.();
        };
    }, [appendScreenshotAttachment]);

    useEffect(() => {
        if (!window.electronAPI.onCaptureAndProcess) return;
        return window.electronAPI.onCaptureAndProcess((data) => {
            appendScreenshotAttachment(data);
            requestAnimationFrame(() => {
                void handleScreenScan();
            });
        });
    }, [appendScreenshotAttachment, handleScreenScan]);

    const toggleExpanded = useCallback(() => {
        setIsExpanded((prev) => !prev);
    }, []);

    const handleReset = useCallback(async () => {
        if (isProcessing) {
            await cancelInFlightOverlayRequests();
            return;
        }
        await window.electronAPI.resetIntelligence();
        onSessionReset();
    }, [cancelInFlightOverlayRequests, isProcessing, onSessionReset]);

    const responseHistory = useMemo(
        () => messages.filter((message) => message.role === 'system'),
        [messages],
    );

    const latestResponse = responseHistory[responseHistory.length - 1] ?? null;
    const latestResponseIdRef = useRef<string | null>(null);

    useEffect(() => {
        const latestId = latestResponse?.id ?? null;
        if (!latestId) {
            latestResponseIdRef.current = null;
            setActiveResponseIndex(-1);
            return;
        }

        if (latestResponseIdRef.current !== latestId) {
            latestResponseIdRef.current = latestId;
            setActiveResponseIndex(responseHistory.length - 1);
            return;
        }

        setActiveResponseIndex((index) => {
            if (responseHistory.length === 0) return -1;
            if (index < 0) return responseHistory.length - 1;
            return Math.min(index, responseHistory.length - 1);
        });
    }, [latestResponse?.id, responseHistory.length]);

    const activeResponse = activeResponseIndex >= 0
        ? responseHistory[activeResponseIndex] ?? latestResponse
        : latestResponse;

    useEffect(() => {
        activeResponseRef.current = activeResponse;
    }, [activeResponse]);

    const goToPreviousResponse = useCallback(() => {
        setActiveResponseIndex((index) => Math.max(0, index - 1));
    }, []);

    const goToNextResponse = useCallback(() => {
        setActiveResponseIndex((index) => Math.min(responseHistory.length - 1, index + 1));
    }, [responseHistory.length]);

    const responseNavigation = useMemo(() => {
        const total = responseHistory.length;
        const safeIndex = total > 0
            ? Math.min(Math.max(activeResponseIndex, 0), total - 1)
            : -1;
        return {
            activeIndex: safeIndex,
            total,
            canGoPrevious: safeIndex > 0,
            canGoNext: safeIndex >= 0 && safeIndex < total - 1,
        };
    }, [activeResponseIndex, responseHistory.length]);

    const frozenTranscriptUiSnapshot = frozenTranscriptUiSnapshotRef.current;
    const visibleRollingTranscript = isTranscriptPaused
        ? frozenTranscriptUiSnapshot?.rollingTranscript ?? rollingTranscript
        : rollingTranscript;
    const visibleRollingTranscriptSpeakerLabel = isTranscriptPaused
        ? frozenTranscriptUiSnapshot?.rollingTranscriptSpeakerLabel ?? rollingTranscriptSpeakerLabel
        : rollingTranscriptSpeakerLabel;
    const visibleLastFinalSentence = isTranscriptPaused
        ? frozenTranscriptUiSnapshot?.lastFinalSentence ?? lastFinalSentence
        : lastFinalSentence;
    const visibleIsInterviewerSpeaking = isTranscriptPaused
        ? frozenTranscriptUiSnapshot?.isInterviewerSpeaking ?? isInterviewerSpeaking
        : isInterviewerSpeaking;
    const visibleOverlayCopilotMode = isTranscriptPaused
        ? frozenTranscriptUiSnapshot?.overlayCopilotMode ?? liveOverlayCopilotMode
        : liveOverlayCopilotMode;
    const visibleActiveQuickActions = isTranscriptPaused
        ? frozenTranscriptUiSnapshot?.activeQuickActions ?? liveActiveQuickActions
        : liveActiveQuickActions;
    const visibleRecommendedButton = isTranscriptPaused
        ? frozenTranscriptUiSnapshot?.recommendedButton ?? recommendedButton
        : recommendedButton;
    const visibleDetectedQuestionType = isTranscriptPaused
        ? frozenTranscriptUiSnapshot?.detectedQuestionType ?? detectedQuestionType
        : detectedQuestionType;
    const visibleContextSummary = isTranscriptPaused
        ? frozenTranscriptUiSnapshot?.contextSummary ?? liveContextSummary
        : liveContextSummary;

    return {
        messages,
        isProcessing,
        isExpanded,
        lastFinalSentence: visibleLastFinalSentence,
        rollingTranscript: visibleRollingTranscript,
        rollingTranscriptSpeakerLabel: visibleRollingTranscriptSpeakerLabel,
        isInterviewerSpeaking: visibleIsInterviewerSpeaking,
        overlayCopilotMode: visibleOverlayCopilotMode,
        activeQuickActions: visibleActiveQuickActions,
        recommendedButton: visibleRecommendedButton,
        detectedQuestionType: visibleDetectedQuestionType,
        contextSummary: visibleContextSummary,
        responseHistory,
        activeResponse,
        activeResponseIndex: responseNavigation.activeIndex,
        responseHistoryTotal: responseNavigation.total,
        canGoPreviousResponse: responseNavigation.canGoPrevious,
        canGoNextResponse: responseNavigation.canGoNext,
        latestResponse,
        attachedContext,
        activeModeLabel,
        isMeetingActive,
        isTranscriptPaused,
        inputValue,
        showTranscript,
        meetingStartTime,
        sttInterviewerStatus,
        sttInterviewerError,
        sttInterviewerProvider,
        sttUserStatus,
        sttUserError,
        overlayOpacity,
        hasProContextAccess,
        currentModel,
        isSettingsOpen,
        isMousePassthrough,
        customNotesEnabled,
        setInputValue,
        setShowTranscript,
        setIsExpanded,
        clearAttachedContext,
        removeAttachedContextAt,
        runAction,
        executeQuickAction,
        getQuickActionHandler,
        handleManualSubmit,
        handleEndMeeting,
        handleScreenScan,
        handleReset,
        goToPreviousResponse,
        goToNextResponse,
        toggleExpanded,
        toggleTranscriptPause,
        toggleMousePassthrough,
        toggleCustomContext,
        scrollContainerRef,
    };
}
