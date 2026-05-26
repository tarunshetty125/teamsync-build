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

export interface CluelyOverlayBridgeProps {
    onEndMeeting?: () => void;
    overlayOpacity?: number;
    hasProContextAccess?: boolean;
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

    const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);
    const [activeModeTemplateId, setActiveModeTemplateId] = useState<ModeTemplateId | null>(null);
    const [isMeetingActive, setIsMeetingActive] = useState(false);
    const [session, setSession] = useState<{ currentMode: SessionMode }>({ currentMode: 'general' });
    const sessionRef = useRef(session);
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
        lastStrongAt: 0,
        seq: 0,
    } satisfies IntentState);
    const [currentQuestionTurnId, setCurrentQuestionTurnId] = useState('');
    const currentQuestionTurnIdRef = useRef<string | null>(null);

    const [sttInterviewerStatus, setSttInterviewerStatus] = useState<string>('connected');
    const [sttInterviewerError, setSttInterviewerError] = useState<string | undefined>();
    const [sttInterviewerProvider, setSttInterviewerProvider] = useState<string>('');
    const [sttUserStatus, setSttUserStatus] = useState<string>('connected');
    const [sttUserError, setSttUserError] = useState<string | undefined>();

    const lastFinalSentenceRef = useRef('');
    const finalizedTranscriptRef = useRef('');
    const lastInterviewerFinalTimestampRef = useRef(0);
    const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    const detectedQuestionType = intentState.detectedType;
    const currentSessionMode = session.currentMode;
    const recommendationMode: SessionMode =
        currentSessionMode === 'system_design' ? 'system_design' : detectedQuestionType;
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

    const contextSummary = useMemo(
        () =>
            deriveContextSummary(
                overlayCopilotMode,
                lastFinalSentenceRef.current || finalizedTranscriptRef.current,
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [overlayCopilotMode, lastFinalSentence, currentQuestionTurnId, detectedQuestionType],
    );

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
        setSession({ currentMode: 'general' });
        dispatchIntent({ type: 'RESET' });
        seqRef.current = 0;
    }, []);

    const activeQuickActionIds = useMemo(
        () => activeQuickActions.map((action) => action.id),
        [activeQuickActions],
    );

    const { recommendedButton, resetRecommendation, unlockRecommendationForTurn } =
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

    const onSessionReset = useCallback(() => {
        void window.electronAPI.cancelGeminiChatStream?.().catch(() => {});
        void window.electronAPI.cancelIntelligenceRequest?.().catch(() => {});
        void window.electronAPI.ragCancelQuery?.({ meetingId: LIVE_MEETING_RAG_ID }).catch(() => {});

        setMessages([]);
        setInputValue('');
        setIsProcessing(false);
        setRollingTranscript('');
        setRollingTranscriptSpeakerLabel('');
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
        if (activeIntelligenceRequestIdRef.current && activeIntelligenceRequestIdRef.current !== nextRequestId) {
            cancelIds.add(activeIntelligenceRequestIdRef.current);
        }
        if (activeScreenScanRequestIdRef.current && activeScreenScanRequestIdRef.current !== nextRequestId) {
            cancelIds.add(activeScreenScanRequestIdRef.current);
        }
        Object.values(activeIntentRequestIdsRef.current).forEach((id) => {
            if (id && id !== nextRequestId) cancelIds.add(id);
        });

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
                if (result?.mode) setSession({ currentMode: result.mode });
            })
            .catch(() => {});
        const unsub = window.electronAPI?.onSessionModeChanged?.((data: any) => {
            if (data?.mode) setSession({ currentMode: data.mode });
        });
        return () => unsub?.();
    }, []);

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
            await runAction(action.intent as string, {
                source: action.source,
                analyticsKey: action.analyticsKey,
                message: action.message,
                additionalContext: action.additionalContext,
                profilePreference: action.profilePreference,
            });
        },
        [runAction],
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
        [cancelInFlightOverlayRequests],
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
                sessionRef.current.currentMode as OverlaySessionMode,
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
    }, [cancelInFlightOverlayRequests, rememberIntentRequest]);

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
        contextSummary,
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
