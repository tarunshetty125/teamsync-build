/**
 * useCluelyOverlayBridge.ts
 *
 * Thin presentation adapter — same IPC/brain as TeamSyncInterface, separate renderer only.
 */

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { useShortcuts } from '../../hooks/useShortcuts';
import {
    getOverlayQuickActions,
    resolveOverlayCopilotMode,
    type OverlayQuickActionDef,
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
    requestId?: string;
    questionTurnId?: string;
    isStreaming?: boolean;
    hasScreenshot?: boolean;
    screenshotPreview?: string;
    isCode?: boolean;
    intent?: string;
    source?: string;
    chips?: Array<{ label: string; variant: string }>;
    isNegotiationCoaching?: boolean;
    negotiationCoachingData?: any;
    intelligenceMetadata?: any;
}

type SessionMode = DetectedQuestionType;
type ActionIntent = 'what_to_answer' | 'recap' | 'clarify' | 'brainstorm' | 'follow_up_questions' | 'answer_now';

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

export interface CluelyOverlayBridgeProps {
    onEndMeeting?: () => void;
    overlayOpacity?: number;
    hasProContextAccess?: boolean;
}

function readPersistedManualSessionMode(): SessionMode | null {
    try {
        if (localStorage.getItem(MANUAL_SESSION_MODE_EXPLICIT_KEY) !== 'true') return null;
        const stored = localStorage.getItem(MANUAL_SESSION_MODE_KEY);
        if (
            stored === 'behavioral'
            || stored === 'coding'
            || stored === 'follow_up'
            || stored === 'general'
            || stored === 'salary'
            || stored === 'system_design'
        ) {
            return stored;
        }
    } catch {
        /* ignore localStorage access issues */
    }
    return null;
}

export function useCluelyOverlayBridge(props: CluelyOverlayBridgeProps) {
    const { onEndMeeting, overlayOpacity = 0.65, hasProContextAccess = false } = props;
    const { isShortcutPressed } = useShortcuts();

    const [messages, setMessages] = useState<V2Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(true);
    const [lastFinalSentence, setLastFinalSentence] = useState('');
    const [rollingTranscript, setRollingTranscript] = useState('');
    const [rollingTranscriptSpeakerLabel, setRollingTranscriptSpeakerLabel] = useState('');
    const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);
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
    const lastInterviewerFinalTimestampRef = useRef(0);
    const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const actionContextOverrideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const overlayCopilotMode = useMemo(
        () =>
            resolveOverlayCopilotMode(
                isMeetingActive ? activeModeTemplateId : 'general',
                isMeetingActive ? recommendationMode : 'general',
            ),
        [activeModeTemplateId, isMeetingActive, recommendationMode],
    );

    const activeQuickActions = useMemo(
        () => getOverlayQuickActions(overlayCopilotMode, brainstormEnabled),
        [overlayCopilotMode, brainstormEnabled],
    );

    const derivedContextSummary = useMemo(
        () =>
            deriveContextSummary(
                overlayCopilotMode,
                lastFinalSentenceRef.current || finalizedTranscriptRef.current,
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [overlayCopilotMode, lastFinalSentence, currentQuestionTurnId, detectedQuestionType],
    );

    const effectiveContextSummary = actionContextSummaryOverride ?? derivedContextSummary;

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
        () => activeQuickActions.map((action) => action.id),
        [activeQuickActions],
    );

    const {
        recommendedButton,
        resetRecommendation,
        pinRecommendationForTurn,
        unlockRecommendationForTurn,
    } =
        useOverlayRecommendation({
            overlayCopilotMode,
            detectedQuestionType,
            isMeetingActive,
            lastFinalSentenceRef,
            finalizedTranscriptRef,
            currentQuestionTurnId,
            activeQuickActionIds,
            transcriptRevision: lastFinalSentence,
        });

    const markCurrentTurnFromText = useCallback((text: string) => {
        const nextText = text.trim();
        if (nextText.length < 3) return;

        unlockRecommendationForTurn();
        currentTurnTextRef.current = nextText;
        const questionTurnId = nextRequestId('question-turn');
        currentQuestionTurnIdRef.current = questionTurnId;
        setCurrentQuestionTurnId(questionTurnId);
        const seq = ++seqRef.current;
        dispatchIntent({
            type: 'EVALUATE',
            combinedText: nextText,
            now: performance.now(),
            seq,
        });
    }, [unlockRecommendationForTurn]);

    const onSessionReset = useCallback(() => {
        void window.electronAPI.cancelGeminiChatStream?.().catch(() => {});
        void window.electronAPI.cancelIntelligenceRequest?.().catch(() => {});
        void window.electronAPI.ragCancelQuery?.({ meetingId: LIVE_MEETING_RAG_ID }).catch(() => {});

        setMessages([]);
        setInputValue('');
        setIsProcessing(false);
        setRollingTranscript('');
        setRollingTranscriptSpeakerLabel('');
        currentTurnTextRef.current = '';
        finalizedTranscriptRef.current = '';
        setLastFinalSentence('');
        lastFinalSentenceRef.current = '';
        lastInterviewerFinalTimestampRef.current = 0;

        activeChatRequestIdRef.current = null;
        activeIntelligenceRequestIdRef.current = null;
        activeRagRequestIdRef.current = null;
        activeScreenScanRequestIdRef.current = null;
        activeIntentRequestIdsRef.current = {};
        requestStartTimeRef.current = null;
        currentSourceRef.current = undefined;

        resetRecommendation();
        resetOverlayRecommendationState();
        analytics.trackConversationStarted();
    }, [resetRecommendation, resetOverlayRecommendationState]);

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

    const recomputeIntentFromFinalTranscript = useCallback(
        (questionTurnId: string) => {
            const finalOnly = lastFinalSentenceRef.current?.trim() || '';
            if (finalOnly.length < 3) return;

            unlockRecommendationForTurn();
            currentQuestionTurnIdRef.current = questionTurnId;
            setCurrentQuestionTurnId(questionTurnId);
            const seq = ++seqRef.current;
            dispatchIntent({
                type: 'EVALUATE',
                combinedText: finalOnly,
                now: performance.now(),
                seq,
            });
        },
        [unlockRecommendationForTurn],
    );

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
            finishStreamingMessage,
            rememberIntentRequest,
            resolveIntentRequestId,
        }),
        [
            isStalePayload,
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
        });
        return () => unsub?.();
    }, []);

    useEffect(() => {
        window.electronAPI?.getSessionMode?.()
            .then((result: any) => {
                if (!result?.mode) return;
                const nextMode = result.mode as SessionMode;
                if (!manualSessionModeRef.current && nextMode !== 'general') {
                    manualSessionModeRef.current = nextMode;
                    persistManualSessionMode(nextMode);
                }
                setSession({ currentMode: manualSessionModeRef.current ?? nextMode });
            })
            .catch(() => {});
        const unsub = window.electronAPI?.onSessionModeChanged?.((data: any) => {
            if (!data?.mode) return;
            const nextMode = data.mode as SessionMode;
            manualSessionModeRef.current = nextMode;
            persistManualSessionMode(nextMode);
            setSession({ currentMode: nextMode });
        });
        return () => unsub?.();
    }, [persistManualSessionMode]);

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
                setRollingTranscriptSpeakerLabel(transcriptLabel);
                setIsInterviewerSpeaking(!transcript.final);

                if (transcript.final) {
                    const now = Date.now();
                    finalizedTranscriptRef.current +=
                        (finalizedTranscriptRef.current ? '  ·  ' : '') + transcript.text;
                    if (finalizedTranscriptRef.current.length > 5000) {
                        finalizedTranscriptRef.current = finalizedTranscriptRef.current.slice(-5000);
                    }
                    setRollingTranscript(finalizedTranscriptRef.current);

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
                    setLastFinalSentence(lastFinalSentenceRef.current);
                    currentTurnTextRef.current = lastFinalSentenceRef.current;

                    const questionTurnId = nextRequestId('question-turn');
                    recomputeIntentFromFinalTranscript(questionTurnId);

                    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
                    speakingTimerRef.current = setTimeout(() => setIsInterviewerSpeaking(false), 3000);
                } else {
                    setRollingTranscript(
                        finalizedTranscriptRef.current +
                            (finalizedTranscriptRef.current ? '  ·  ' : '') +
                            transcript.text,
                    );
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

            const latestFinalQuestion =
                lastFinalSentenceRef.current.trim() ||
                finalizedTranscriptRef.current.split('  ·  ').pop()?.trim() ||
                '';
            const resolvedMessage =
                options?.message?.trim() || (intent === 'recap' ? '' : latestFinalQuestion);

            if (options?.userBubbleText || options?.screenshotPreview) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: nextMsgId(),
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
                    requestId,
                    role: 'system',
                    text: '',
                    intent,
                    source: options?.source,
                    isStreaming: true,
                },
            ]);

            try {
                await window.electronAPI.generateAction({
                    intent: intent as ActionIntent,
                    message: resolvedMessage || undefined,
                    additionalContext: options?.additionalContext,
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
            pinRecommendationForTurn(action.id, currentQuestionTurnIdRef.current);
            setActionContextSummaryOverride({
                label: derivedContextSummary.label,
                detail:
                    ACTION_CONTEXT_MESSAGES[action.label] ?? `${action.label} in progress…`,
            });
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
            if (!userText) return;

            await cancelInFlightOverlayRequests();
            markCurrentTurnFromText(userText);

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
                { id: nextMsgId(), role: 'user', text: userText },
                {
                    id: nextMsgId(),
                    requestId,
                    role: 'system',
                    text: '',
                    intent: 'manual_chat',
                    source: 'Manual Input',
                    isStreaming: true,
                },
            ]);

            const streamContext =
                [
                    finalizedTranscriptRef.current.slice(-700),
                    [
                        'RESPONSE RULES:',
                        '- ANY coding / DSA problem: **Problem:**, **Approach:**, **Complexity:**, **Solution:** (mandatory fenced code).',
                        '- ANY system design question (URL shortener, Instagram, Uber, notifications, etc.): full 10-section answer per SYSTEM DESIGN format — requirements, ```mermaid``` diagram, components, data flow, DB, scaling, tradeoffs, spoken summary. Diagram is mandatory.',
                        '- Mermaid rules for system design: use the exact opening fence ```mermaid and exact closing fence ``` with no attributes on the fence line.',
                        '- Flowchart architecture diagrams must start with graph TD or flowchart TD and must use --> arrows, never ->.',
                        '- Reuse the exact same node ID every time. Do not rename the same component with different IDs later in the diagram.',
                        '- Use sequenceDiagram only when the user explicitly asks for a sequence/login flow.',
                        '- Other questions: concise answer under 120 words.',
                        '- No preamble.',
                    ].join('\n'),
                ]
                    .filter(Boolean)
                    .join('\n\n') || undefined;

            try {
                activeRagRequestIdRef.current = null;
                await window.electronAPI.streamGeminiChat(
                    userText,
                    undefined,
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

            const data = await window.electronAPI.takeScreenshot();
            if (!data?.path) return;

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
                    requestId,
                    role: 'system',
                    text: '',
                    intent: 'screen_scan',
                    source: 'Screen Analysis',
                    isStreaming: true,
                    hasScreenshot: true,
                    screenshotPreview: data.preview,
                },
            ]);

            const scanMode = getScreenScanModeForSessionMode(
                session.currentMode as OverlaySessionMode,
            );
            console.debug('[V2][ScreenScan] handleScreenScan', {
                requestId,
                scanMode,
                screenshotPath: data.path,
                hasPreview: Boolean(data.preview),
            });
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
    }, [cancelInFlightOverlayRequests, rememberIntentRequest, session.currentMode]);

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

    const latestResponse = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'system') return messages[i];
        }
        return null;
    }, [messages]);

    useEffect(() => {
        console.debug('[V2][Bridge] latestResponse recomputed', {
            totalMessages: messages.length,
            latestResponseId: latestResponse?.id ?? null,
            latestResponseRequestId: latestResponse?.requestId ?? null,
            latestResponseIntent: latestResponse?.intent ?? null,
            latestResponseSource: latestResponse?.source ?? null,
            latestResponseIsStreaming: latestResponse?.isStreaming ?? null,
            latestResponseTextLength: latestResponse?.text.length ?? 0,
            isProcessing,
        });
    }, [isProcessing, latestResponse, messages.length]);

    return {
        messages,
        isProcessing,
        isExpanded,
        lastFinalSentence,
        rollingTranscript,
        rollingTranscriptSpeakerLabel,
        isInterviewerSpeaking,
        overlayCopilotMode,
        activeQuickActions,
        recommendedButton,
        detectedQuestionType,
        contextSummary: effectiveContextSummary,
        latestResponse,
        activeModeLabel,
        isMeetingActive,
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
        runAction,
        executeQuickAction,
        getQuickActionHandler,
        handleManualSubmit,
        handleEndMeeting,
        handleScreenScan,
        handleReset,
        toggleExpanded,
        toggleMousePassthrough,
        toggleCustomContext,
        scrollContainerRef,
    };
}
