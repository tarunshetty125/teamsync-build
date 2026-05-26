/**
 * useCluelyOverlayBridge.ts
 * 
 * THIN presentation adapter — NOT a parallel intelligence system.
 * 
 * Consumes the same IPC events and electronAPI calls as TeamSyncInterface.
 * Imports shared logic from overlayCopilotConfig.ts (getOverlayQuickActions, etc.).
 * All intelligence lives in the Electron main process — this hook just wires it up.
 */

import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { useShortcuts } from '../../hooks/useShortcuts';
import {
    getOverlayQuickActions,
    getRecommendedOverlayAction,
    resolveOverlayCopilotMode,
    type OverlayQuickActionDef,
    type OverlayRecommendationId,
} from '../../lib/modes/overlayCopilotConfig';
import type { ModeTemplateId } from '../../lib/modes/types';
import { analytics, detectProviderType } from '../../lib/analytics/analytics.service';
import { getTranscriptDisplayLabel } from '../../utils/transcriptSpeakers';

// ── Shared Types (mirrors TeamSyncInterface — NOT duplicating logic, just types) ──

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

type DetectedQuestionType = 'coding' | 'system_design' | 'behavioral' | 'follow_up' | 'general';
type SessionMode = DetectedQuestionType;
type ActionIntent = 'what_to_answer' | 'recap' | 'clarify' | 'brainstorm' | 'follow_up_questions' | 'answer_now';

// ── Minimal pure functions (small, stable, regex-only — no intelligence duplication) ──

const REGEX_NORMALIZE_FILLER = /\b(yeah|um|uh|uh+m|like|so|okay|ok|well|you know|i mean|basically|actually|right)\b/;

function normalizeTranscript(text: string): string {
    let t = text.toLowerCase();
    t = t.replace(/(\w)\.\s+(\w)/g, '$1$2');
    t = t.replace(/[\u201C\u201D\u2018\u2019]/g, '"');
    t = t.replace(/[\u2013\u2014]/g, '-');
    t = t.replace(/[^a-z0-9\s\-?:/]/g, ' ');
    t = t.replace(new RegExp(REGEX_NORMALIZE_FILLER.source, 'gi'), ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
}

// Regex classification — same patterns as TeamSyncInterface (pure function, stable)
const REGEX_CODING_CORE = /(write code|write a? ?(?:function|program|method|class|script)|implement|how to code)/;
const REGEX_SYSTEM_CORE = /(system design|design a|architecture|database schema|api design)/;
const REGEX_BEHAVIORAL_CORE = /(tell me about a time|describe a situation|give me an example|share an experience|tell me about yourself|introduce yourself|walk me through (?:your )?(?:background|resume)|background|resume|personal experience|worked on|built|developed|impact|result|outcome)/;
const REGEX_CODING_STRONG = /(algorithm|debug this|snippet|boilerplate|optimize|refactor|array|linked list|tree|graph|stack|queue|hash ?map|binary search|dynamic programming|recursion|time complexity|space complexity)/;
const REGEX_SYSTEM_STRONG = /(scalab|microservice|load balanc|distributed|high availability|caching strategy|caching|cache|cdn|message queue|rate limit|sharding|replication|partition|cap theorem|event driven|monolith|horizontal scal|fault toleran|throughput|latency|handle more users|high traffic|load)/;
const REGEX_BEHAVIORAL_STRONG = /(when have you|biggest challenge|how did you handle|conflict with|leadership|teamwork|failure|mistake|difficult decision|star method|tell me about|tell me about yourself|experience|challenge|conflict|pressure|strength|strengths|weakness|weaknesses|mentor|disagree|feedback|prioriti[zs]e|deadline|collaborate|accomplishment|introduce yourself|background|resume|project|projects|worked on|built|developed|owned|ownership|impact|result|results|outcome|outcomes|personal)/;
const REGEX_FOLLOW_UP_CORE = /(what happened next|then what|and after that|what.s next|how did that go|can you elaborate|tell me more|go deeper|expand on)/;
const REGEX_FOLLOW_UP_STRONG = /(follow.?up|continuation|building on|going back to|earlier you said|you mentioned)/;
const REGEX_CODING_BOOST = /(faster|efficient)/;
const REGEX_SYSTEM_BOOST = /(tradeoff|trade-off|pros? and cons|downsides|advantages|disadvantages)/;

function detectQuestionType(
    text: string,
    currentType: DetectedQuestionType,
    _lastStrongType: DetectedQuestionType
): { nextType: DetectedQuestionType; nextStrong?: DetectedQuestionType } {
    if (/tell me about yourself|introduce yourself/i.test(text)) {
        return { nextType: 'behavioral', nextStrong: 'behavioral' };
    }
    let t = normalizeTranscript(text);
    const scores: Record<DetectedQuestionType, number> = { coding: 0, system_design: 0, behavioral: 0, follow_up: 0, general: 0 };
    const cap = (regex: RegExp) => { let c = 0; for (const _ of t.matchAll(new RegExp(regex.source, 'gi'))) { if (++c >= 3) break; } return c; };

    scores.coding += cap(REGEX_CODING_CORE) * 3;
    scores.system_design += cap(REGEX_SYSTEM_CORE) * 3;
    scores.behavioral += cap(REGEX_BEHAVIORAL_CORE) * 3;
    scores.coding += cap(REGEX_CODING_STRONG) * 2;
    scores.system_design += cap(REGEX_SYSTEM_STRONG) * 2;
    scores.behavioral += cap(REGEX_BEHAVIORAL_STRONG) * 2;
    scores.coding += cap(REGEX_CODING_BOOST);
    scores.system_design += cap(REGEX_SYSTEM_BOOST);
    scores.follow_up += cap(REGEX_FOLLOW_UP_CORE) * 3;
    scores.follow_up += cap(REGEX_FOLLOW_UP_STRONG) * 2;

    const wordCount = t.split(/\s+/).filter((w: string) => w.length > 0).length;
    if (scores.general >= scores.follow_up && wordCount <= 8 && wordCount >= 2) {
        scores.follow_up = Math.max(scores.follow_up, 2);
    }
    if (currentType !== 'general') scores[currentType] += 0.5;

    const entries = (Object.entries(scores) as [DetectedQuestionType, number][])
        .filter(([type]) => type !== 'general')
        .sort((a, b) => b[1] - a[1]);
    const [primary, primaryScore] = entries[0];
    const [, secondScore] = entries[1] || [null, 0];
    if (primaryScore < 2) return { nextType: 'general' };
    const nextStrong = primaryScore >= 3 ? primary : undefined;
    if (primary !== currentType && currentType !== 'general' && (primaryScore - secondScore) < 2) {
        return { nextType: currentType, nextStrong };
    }
    return { nextType: primary, nextStrong };
}

// Intent reducer — small, pure state machine
type IntentState = { detectedType: DetectedQuestionType; lastStrongType: DetectedQuestionType; lastStrongAt: number; seq: number };
type IntentAction = { type: 'EVALUATE'; combinedText: string; now: number; seq: number } | { type: 'RESET' };

function intentReducer(state: IntentState, action: IntentAction): IntentState {
    if (action.type === 'RESET') return { detectedType: 'general', lastStrongType: 'general', lastStrongAt: 0, seq: 0 };
    if (action.type === 'EVALUATE') {
        if (action.seq < state.seq || !action.combinedText || action.combinedText.length < 5) return state;
        const { nextType, nextStrong } = detectQuestionType(action.combinedText, state.detectedType, state.lastStrongType);
        let newLastStrongType = nextStrong ?? state.lastStrongType;
        let newLastStrongAt = nextStrong ? action.now : state.lastStrongAt;
        if (!nextStrong && (action.now - state.lastStrongAt) > 6000 && state.lastStrongType !== 'general') {
            newLastStrongType = 'general';
        }
        if (state.detectedType === nextType && state.lastStrongType === newLastStrongType && state.lastStrongAt === newLastStrongAt) {
            return { ...state, seq: action.seq };
        }
        return { detectedType: nextType, lastStrongType: newLastStrongType, lastStrongAt: newLastStrongAt, seq: action.seq };
    }
    return state;
}

// Response chip generation
function generateResponseChips(text: string, _intent?: string): Array<{ label: string; variant: string }> {
    if (!text || text.length < 40) return [];
    const chips: Array<{ label: string; variant: string }> = [];
    const seen = new Set<string>();
    const add = (label: string, variant: string) => {
        const key = label.toLowerCase();
        if (!seen.has(key) && chips.length < 5) { seen.add(key); chips.push({ label, variant }); }
    };
    const moneyRe = /\$(\d[\d,]*(?:\.\d+)?[Kk]?)\s*[–\-~to]+\s*\$(\d[\d,]*(?:\.\d+)?[Kk]?)/g;
    let m: RegExpExecArray | null;
    while ((m = moneyRe.exec(text)) !== null) add(`${m[1]}–${m[2]}`, 'green');
    if (chips.length === 0) { const s = /\$(\d[\d,]*[Kk]?)\b/.exec(text); if (s) add(s[0], 'green'); }
    return chips;
}

// ── Context Summary — regex-only derivation, NO AI call ──

const MODE_LABELS: Record<string, string> = {
    behavioral: 'Behavioral interview',
    coding: 'Technical coding',
    system_design: 'System design',
    general: 'General discussion',
    follow_up: 'Follow-up discussion',
    sales: 'Sales conversation',
    lecture: 'Lecture / learning',
    recruiting: 'Candidate evaluation',
    'team-meet': 'Team meeting',
    'looking-for-work': 'Job interview prep',
    'technical-interview': 'Technical interview',
};

const TOPIC_KEYWORDS: [RegExp, string][] = [
    [/\b(docker|kubernetes|k8s|container)/i, 'Docker/Kubernetes'],
    [/\b(binary search|sorting|linked list|tree|graph|hash.?map)/i, 'data structures'],
    [/\b(salary|compensation|ctc|package|offer)\b/i, 'compensation'],
    [/\b(strengths?|weakness|experience|challenge)\b/i, 'strengths and experience'],
    [/\b(scalab|load.?balanc|caching|microservice)/i, 'scalability'],
    [/\b(react|angular|vue|next\.?js|typescript)/i, 'frontend frameworks'],
    [/\b(aws|gcp|azure|cloud)/i, 'cloud infrastructure'],
    [/\b(sql|database|postgres|mongo|redis)/i, 'data systems'],
    [/\b(python|java|golang|rust|c\+\+)/i, 'programming languages'],
    [/\b(api|rest|graphql|grpc)/i, 'API design'],
    [/\b(testing|unit test|integration test|tdd)/i, 'testing'],
    [/\b(leadership|team lead|managed|mentor)/i, 'leadership'],
    [/\b(agile|scrum|sprint|kanban)/i, 'agile methodology'],
];

export function deriveContextSummary(
    mode: string,
    recentTranscript: string
): { label: string; detail: string } {
    const modeLabel = MODE_LABELS[mode] || 'Discussion';
    let topic = '';
    for (const [regex, replacement] of TOPIC_KEYWORDS) {
        if (regex.test(recentTranscript)) {
            topic = replacement;
            break;
        }
    }
    if (topic) {
        return { label: modeLabel, detail: topic };
    }
    // No topic detected — show contextual hint instead of repeating label
    const wordCount = recentTranscript.trim().split(/\s+/).filter(Boolean).length;
    const detail = wordCount > 5 ? 'Analyzing conversation…' : 'Listening for context…';
    return { label: modeLabel, detail };
}


// ── Monotonic IDs ──

let v2MsgCounter = 0;
function nextMsgId(): string { return `v2-${Date.now()}-${++v2MsgCounter}`; }

let v2ReqCounter = 0;
function nextRequestId(prefix: string = 'v2'): string { return `${prefix}-${Date.now()}-${++v2ReqCounter}`; }

const INTERVIEWER_TURN_GAP_MS = 15_000;

// ── The Bridge Hook ──

export interface CluelyOverlayBridgeProps {
    onEndMeeting?: () => void;
    overlayOpacity?: number;
    hasProContextAccess?: boolean;
}

export function useCluelyOverlayBridge(props: CluelyOverlayBridgeProps) {
    const { onEndMeeting, overlayOpacity = 0.65, hasProContextAccess = false } = props;
    const { isShortcutPressed } = useShortcuts();

    // ── Core State ──
    const [messages, setMessages] = useState<V2Message[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(true);
    const [lastFinalSentence, setLastFinalSentence] = useState('');
    const [rollingTranscript, setRollingTranscript] = useState('');
    const [rollingTranscriptSpeakerLabel, setRollingTranscriptSpeakerLabel] = useState('');
    const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);

    // Mode state
    const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);
    const [activeModeTemplateId, setActiveModeTemplateId] = useState<ModeTemplateId | null>(null);
    const [isMeetingActive, setIsMeetingActive] = useState(false);
    const [session, setSession] = useState<{ currentMode: SessionMode }>({ currentMode: 'general' });
    const [brainstormEnabled, setBrainstormEnabled] = useState<boolean>(() => {
        try { return localStorage.getItem('teamsync_brainstorm_enabled') !== 'false'; } catch { return true; }
    });

    // Intent classification
    const [intentState, dispatchIntent] = useReducer(intentReducer, {
        detectedType: 'general', lastStrongType: 'general', lastStrongAt: 0, seq: 0
    });
    const [recommendedButton, setRecommendedButton] = useState<OverlayRecommendationId>('what_to_answer');
    const recommendedButtonRef = useRef<OverlayRecommendationId>('what_to_answer');

    // STT status
    const [sttInterviewerStatus, setSttInterviewerStatus] = useState<string>('connected');
    const [sttInterviewerError, setSttInterviewerError] = useState<string | undefined>();
    const [sttInterviewerProvider, setSttInterviewerProvider] = useState<string>('');
    const [sttUserStatus, setSttUserStatus] = useState<string>('connected');
    const [sttUserError, setSttUserError] = useState<string | undefined>();

    // Refs
    const lastFinalSentenceRef = useRef('');
    const finalizedTranscriptRef = useRef('');
    const lastInterviewerFinalTimestampRef = useRef(0);
    const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeRequestIdRef = useRef<string | null>(null);
    const requestStartTimeRef = useRef<number | null>(null);
    const [currentModel, setCurrentModel] = useState('gemini-3-flash-preview');
    const currentModelRef = useRef('gemini-3-flash-preview');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [customNotesEnabled, setCustomNotesEnabled] = useState(true);
    const currentSourceRef = useRef<string | undefined>();
    const seqRef = useRef(0);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Input state
    const [inputValue, setInputValue] = useState('');
    const [showTranscript, setShowTranscript] = useState(false);

    // Timer
    const [meetingStartTime, setMeetingStartTime] = useState(() => Date.now());

    // ── Derived: Mode resolution (uses existing imported functions) ──
    const detectedQuestionType = intentState.detectedType;
    const currentSessionMode = session.currentMode;
    const recommendationMode: SessionMode = currentSessionMode === 'system_design' ? 'system_design' : detectedQuestionType;
    const overlayCopilotMode = useMemo(
        () => resolveOverlayCopilotMode(isMeetingActive ? activeModeTemplateId : 'general', isMeetingActive ? recommendationMode : 'general'),
        [activeModeTemplateId, isMeetingActive, recommendationMode]
    );

    const activeQuickActions = useMemo(
        () => getOverlayQuickActions(overlayCopilotMode, brainstormEnabled),
        [overlayCopilotMode, brainstormEnabled]
    );

    // Context summary (regex-derived)
    const contextSummary = useMemo(
        () => deriveContextSummary(overlayCopilotMode, lastFinalSentenceRef.current || finalizedTranscriptRef.current),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [overlayCopilotMode, lastFinalSentence]
    );

    // ── IPC: Mode changes ──
    useEffect(() => {
        window.electronAPI?.modesGetActive?.()
            .then((mode: any) => {
                setActiveModeLabel(mode?.name ?? null);
                setActiveModeTemplateId((mode?.templateType as ModeTemplateId | null | undefined) ?? null);
            })
            .catch(() => { });
        const unsub = window.electronAPI?.onModeChanged?.((data: any) => {
            setActiveModeLabel(data.name);
            setActiveModeTemplateId((data.templateId as ModeTemplateId | null | undefined) ?? null);
        });
        return () => unsub?.();
    }, []);

    // ── IPC: Session mode ──
    useEffect(() => {
        window.electronAPI?.getSessionMode?.()
            .then((result: any) => {
                if (result?.mode) setSession({ currentMode: result.mode });
            })
            .catch(() => { });
        const unsub = window.electronAPI?.onSessionModeChanged?.((data: any) => {
            if (data?.mode) setSession({ currentMode: data.mode });
        });
        return () => unsub?.();
    }, []);

    // Expand when main switches to overlay (same as v1 TeamSyncInterface)
    useEffect(() => {
        if (!window.electronAPI?.onEnsureExpanded) return;
        const unsubscribe = window.electronAPI.onEnsureExpanded(() => {
            setIsExpanded(true);
        });
        return () => unsubscribe();
    }, []);

    // ── IPC: Meeting lifecycle ──
    useEffect(() => {
        if (!window.electronAPI?.onMeetingStateChanged) return;
        window.electronAPI.getMeetingActive?.()
            .then((active: boolean) => {
                setIsMeetingActive(active);
                if (active) setMeetingStartTime(Date.now());
            })
            .catch(() => { });
        const unsubscribe = window.electronAPI.onMeetingStateChanged(({ isActive }: { isActive: boolean }) => {
            setIsMeetingActive(isActive);
            if (isActive) {
                // Reset timer for new meeting
                setMeetingStartTime(Date.now());
            }
        });
        return () => unsubscribe();
    }, []);

    // ── IPC: STT status ──
    useEffect(() => {
        if (!window.electronAPI?.onSttStatusChanged) return;
        const unsub = window.electronAPI.onSttStatusChanged((data: any) => {
            if (data.channel === 'interviewer') {
                setSttInterviewerStatus(data.status);
                setSttInterviewerError(data.error);
                setSttInterviewerProvider(data.provider || '');
            } else if (data.channel === 'user') {
                setSttUserStatus(data.status);
                setSttUserError(data.error);
            }
        });
        return () => unsub();
    }, []);

    // ── IPC: Transcript ──
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        cleanups.push(window.electronAPI.onNativeAudioTranscript((transcript: any) => {
            if (transcript.speaker === 'user') return;
            if (transcript.speaker !== 'interviewer') return;

            const transcriptLabel = getTranscriptDisplayLabel(transcript);
            setRollingTranscriptSpeakerLabel(transcriptLabel);
            setIsInterviewerSpeaking(!transcript.final);

            if (transcript.final) {
                const now = Date.now();
                finalizedTranscriptRef.current += (finalizedTranscriptRef.current ? '  ·  ' : '') + transcript.text;
                if (finalizedTranscriptRef.current.length > 5000) {
                    finalizedTranscriptRef.current = finalizedTranscriptRef.current.slice(-5000);
                }
                setRollingTranscript(finalizedTranscriptRef.current);

                const gapSinceLastFinal = now - lastInterviewerFinalTimestampRef.current;
                if (lastInterviewerFinalTimestampRef.current > 0 && gapSinceLastFinal <= INTERVIEWER_TURN_GAP_MS) {
                    lastFinalSentenceRef.current = lastFinalSentenceRef.current + ' ' + transcript.text;
                } else {
                    lastFinalSentenceRef.current = transcript.text;
                }
                lastInterviewerFinalTimestampRef.current = now;
                setLastFinalSentence(lastFinalSentenceRef.current);

                // Intent classification
                const seq = ++seqRef.current;
                dispatchIntent({
                    type: 'EVALUATE',
                    combinedText: lastFinalSentenceRef.current,
                    now: performance.now(),
                    seq,
                });

                // Recommendation
                const rec = getRecommendedOverlayAction(overlayCopilotMode, lastFinalSentenceRef.current);
                if (rec) {
                    recommendedButtonRef.current = rec;
                    setRecommendedButton(rec);
                }

                if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
                speakingTimerRef.current = setTimeout(() => setIsInterviewerSpeaking(false), 3000);
            } else {
                setRollingTranscript(
                    finalizedTranscriptRef.current
                    + (finalizedTranscriptRef.current ? '  ·  ' : '')
                    + transcript.text
                );
            }
        }));

        return () => cleanups.forEach(fn => fn());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [overlayCopilotMode]);

    // ── IPC: Streaming responses (same electronAPI calls as V1) ──
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        // Stream Token
        cleanups.push(window.electronAPI.onGeminiStreamToken((payload: any) => {
            const token = typeof payload === 'string' ? payload : payload.token;
            const requestId = typeof payload === 'string' ? activeRequestIdRef.current : (payload.requestId || activeRequestIdRef.current);
            if (!requestId) return;
            // Skip negotiation coaching JSON
            try {
                const parsed = JSON.parse(token);
                if (parsed?.__negotiationCoaching) {
                    setMessages(prev => {
                        const idx = prev.findIndex(msg => msg.requestId === requestId);
                        if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], text: token }; return u; }
                        return prev;
                    });
                    return;
                }
            } catch { /* normal text token */ }

            setMessages(prev => {
                const idx = prev.findIndex(msg => msg.requestId === requestId);
                if (idx < 0) return prev;
                const u = [...prev];
                const nextText = u[idx].text + token;
                u[idx] = { ...u[idx], text: nextText, isCode: nextText.includes('```') };
                return u;
            });
        }));

        // Stream Done
        cleanups.push(window.electronAPI.onGeminiStreamDone((payload: any) => {
            const requestId = payload?.requestId || activeRequestIdRef.current;
            if (!requestId) return;
            setIsProcessing(false);
            currentSourceRef.current = undefined;
            activeRequestIdRef.current = null;

            let latency = 0;
            if (requestStartTimeRef.current) {
                latency = Date.now() - requestStartTimeRef.current;
                requestStartTimeRef.current = null;
            }
            analytics.trackModelUsed({
                model_name: currentModelRef.current,
                provider_type: detectProviderType(currentModelRef.current),
                latency_ms: latency
            });

            setMessages(prev => {
                const idx = prev.findIndex(msg => msg.requestId === requestId);
                const lastMsg = idx >= 0 ? prev[idx] : null;
                if (!lastMsg || !lastMsg.isStreaming || lastMsg.role !== 'system') return prev;
                try {
                    const parsed = JSON.parse(lastMsg.text);
                    if (parsed?.__negotiationCoaching) {
                        const u = [...prev];
                        u[idx] = { ...lastMsg, isStreaming: false, isNegotiationCoaching: true, negotiationCoachingData: parsed.__negotiationCoaching, text: '' };
                        return u;
                    }
                } catch { }
                const chips = generateResponseChips(lastMsg.text, lastMsg.intent);
                const u = [...prev];
                u[idx] = { ...lastMsg, isStreaming: false, chips: chips.length > 0 ? chips : undefined };
                return u;
            });
        }));

        // Stream Error
        cleanups.push(window.electronAPI.onGeminiStreamError((payload: any) => {
            const error = typeof payload === 'string' ? payload : payload.error;
            const requestId = typeof payload === 'string' ? activeRequestIdRef.current : (payload.requestId || activeRequestIdRef.current);
            if (!requestId) return;
            setIsProcessing(false);
            requestStartTimeRef.current = null;
            activeRequestIdRef.current = null;
            setMessages(prev => {
                const idx = prev.findIndex(msg => msg.requestId === requestId);
                if (idx < 0) return prev;
                const u = [...prev];
                u[idx] = { ...u[idx], text: `❌ Error: ${error}`, isStreaming: false };
                return u;
            });
        }));

        // RAG Stream
        if (window.electronAPI.onRAGStreamChunk) {
            cleanups.push(window.electronAPI.onRAGStreamChunk((data: any) => {
                const requestId = data.requestId || activeRequestIdRef.current;
                if (!requestId) return;
                try {
                    const parsed = JSON.parse(data.chunk);
                    if (parsed?.__negotiationCoaching) {
                        setMessages(prev => {
                            const idx = prev.findIndex(msg => msg.requestId === requestId);
                            if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], text: data.chunk }; return u; }
                            return prev;
                        });
                        return;
                    }
                } catch { }
                setMessages(prev => {
                    const idx = prev.findIndex(msg => msg.requestId === requestId);
                    if (idx < 0) return prev;
                    const u = [...prev];
                    u[idx] = { ...u[idx], text: u[idx].text + data.chunk };
                    return u;
                });
            }));
        }

        if (window.electronAPI.onRAGStreamComplete) {
            cleanups.push(window.electronAPI.onRAGStreamComplete((data: any) => {
                const requestId = data.requestId || activeRequestIdRef.current;
                if (!requestId) return;
                setIsProcessing(false);
                activeRequestIdRef.current = null;
                setMessages(prev => {
                    const idx = prev.findIndex(msg => msg.requestId === requestId);
                    const lastMsg = idx >= 0 ? prev[idx] : null;
                    if (!lastMsg || !lastMsg.isStreaming || lastMsg.role !== 'system') return prev;
                    try {
                        const parsed = JSON.parse(lastMsg.text);
                        if (parsed?.__negotiationCoaching) {
                            const u = [...prev];
                            u[idx] = { ...lastMsg, isStreaming: false, isNegotiationCoaching: true, negotiationCoachingData: parsed.__negotiationCoaching, text: '' };
                            return u;
                        }
                    } catch { }
                    const chips = generateResponseChips(lastMsg.text, lastMsg.intent);
                    const u = [...prev];
                    u[idx] = { ...lastMsg, isStreaming: false, chips: chips.length > 0 ? chips : undefined };
                    return u;
                });
            }));
        }

        if (window.electronAPI.onRAGStreamError) {
            cleanups.push(window.electronAPI.onRAGStreamError((data: any) => {
                const requestId = data.requestId || activeRequestIdRef.current;
                if (!requestId) return;
                setIsProcessing(false);
                activeRequestIdRef.current = null;
                setMessages(prev => {
                    const idx = prev.findIndex(msg => msg.requestId === requestId);
                    if (idx < 0) return prev;
                    const u = [...prev];
                    u[idx] = { ...u[idx], text: `❌ RAG Error: ${data.error}`, isStreaming: false };
                    return u;
                });
            }));
        }

        // ── Intelligence Action events (for generateAction — Suggest, Clarify, etc.) ──
        if (window.electronAPI.onIntelligenceActionToken) {
            cleanups.push(window.electronAPI.onIntelligenceActionToken((data: any) => {
                const requestId = data.requestId || activeRequestIdRef.current;
                if (!requestId) return;
                const token = data.token;
                if (!token) return;

                // Skip negotiation coaching JSON
                try {
                    const parsed = JSON.parse(token);
                    if (parsed?.__negotiationCoaching) {
                        setMessages(prev => {
                            const idx = prev.findIndex(msg => msg.requestId === requestId);
                            if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], text: token }; return u; }
                            return prev;
                        });
                        return;
                    }
                } catch { /* normal text token */ }

                setMessages(prev => {
                    const idx = prev.findIndex(msg => msg.requestId === requestId);
                    if (idx < 0) return prev;
                    const u = [...prev];
                    const nextText = u[idx].text + token;
                    u[idx] = { ...u[idx], text: nextText, isCode: nextText.includes('```') };
                    return u;
                });
            }));
        }

        if (window.electronAPI.onIntelligenceActionResult) {
            cleanups.push(window.electronAPI.onIntelligenceActionResult((data: any) => {
                const requestId = data.requestId || activeRequestIdRef.current;
                if (!requestId) return;
                setIsProcessing(false);
                currentSourceRef.current = undefined;
                activeRequestIdRef.current = null;

                setMessages(prev => {
                    const idx = prev.findIndex(msg => msg.requestId === requestId);
                    const lastMsg = idx >= 0 ? prev[idx] : null;
                    if (!lastMsg || !lastMsg.isStreaming || lastMsg.role !== 'system') return prev;
                    try {
                        const parsed = JSON.parse(lastMsg.text);
                        if (parsed?.__negotiationCoaching) {
                            const u = [...prev];
                            u[idx] = { ...lastMsg, isStreaming: false, isNegotiationCoaching: true, negotiationCoachingData: parsed.__negotiationCoaching, text: '' };
                            return u;
                        }
                    } catch { }
                    const chips = generateResponseChips(lastMsg.text, lastMsg.intent);
                    const u = [...prev];
                    u[idx] = { ...lastMsg, isStreaming: false, chips: chips.length > 0 ? chips : undefined };
                    return u;
                });
            }));
        }

        return () => cleanups.forEach(fn => fn());
    }, []);

    // ── Model sync ──
    useEffect(() => {
        currentModelRef.current = currentModel;
    }, [currentModel]);

    useEffect(() => {
        if (window.electronAPI?.getDefaultModel) {
            window.electronAPI.getDefaultModel()
                .then((result: { model?: string }) => {
                    if (result?.model) {
                        setCurrentModel(result.model);
                        currentModelRef.current = result.model;
                        window.electronAPI.setModel?.(result.model).catch(() => { });
                    }
                })
                .catch(() => { });
        }
    }, []);

    useEffect(() => {
        if (!window.electronAPI?.onModelChanged) return;
        const unsubscribe = window.electronAPI.onModelChanged((modelId: string) => {
            setCurrentModel(prev => (prev === modelId ? prev : modelId));
            currentModelRef.current = modelId;
        });
        return () => unsubscribe();
    }, []);

    // ── Overlay settings popup visibility ──
    useEffect(() => {
        if (!window.electronAPI?.onSettingsVisibilityChange) return;
        const unsubscribe = window.electronAPI.onSettingsVisibilityChange((isVisible: boolean) => {
            setIsSettingsOpen(isVisible);
        });
        return () => unsubscribe();
    }, []);

    // ── Mouse passthrough ──
    useEffect(() => {
        window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => { });
        const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v: boolean) => {
            setIsMousePassthrough(v);
        });
        return () => unsub?.();
    }, []);

    const toggleMousePassthrough = useCallback(() => {
        setIsMousePassthrough(prev => {
            const next = !prev;
            window.electronAPI?.setOverlayMousePassthrough?.(next);
            return next;
        });
    }, []);

    // ── Custom context toggle (Pro) ──
    useEffect(() => {
        if (!hasProContextAccess) return;
        window.electronAPI?.getCustomNotesEnabled?.()
            .then((res: { success?: boolean; enabled?: boolean }) => {
                if (res?.success) setCustomNotesEnabled(Boolean(res.enabled));
            })
            .catch(() => { });
    }, [hasProContextAccess]);

    const toggleCustomContext = useCallback(async () => {
        const next = !customNotesEnabled;
        setCustomNotesEnabled(next);
        await window.electronAPI?.setCustomNotesEnabled?.(next);
    }, [customNotesEnabled]);

    // Keyboard shortcut: mouse passthrough (same as v1 overlay)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isShortcutPressed(e, 'toggleMousePassthrough')) return;
            e.preventDefault();
            toggleMousePassthrough();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isShortcutPressed, toggleMousePassthrough]);

    // ── Brainstorm toggle sync ──
    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('teamsync_brainstorm_enabled');
            setBrainstormEnabled(stored !== 'false');
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    // ── Thin action runner (calls same electronAPI as V1) ──
    const runAction = useCallback(async (
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
        }
    ) => {
        // Cancel previous
        if (activeRequestIdRef.current) {
            try {
                await Promise.allSettled([
                    window.electronAPI.cancelGeminiChatStream?.(),
                    window.electronAPI.cancelIntelligenceByRequest?.(activeRequestIdRef.current),
                ]);
            } catch { }
        }

        setIsExpanded(true);
        analytics.trackCommandExecuted(options?.analyticsKey ?? intent);

        const requestId = nextRequestId(intent);
        activeRequestIdRef.current = requestId;
        setIsProcessing(true);
        requestStartTimeRef.current = Date.now();
        currentSourceRef.current = options?.source;

        const latestFinalQuestion = lastFinalSentenceRef.current.trim()
            || finalizedTranscriptRef.current.split('  ·  ').pop()?.trim()
            || '';
        const resolvedMessage = options?.message?.trim()
            || (intent === 'recap' ? '' : latestFinalQuestion);

        // User bubble
        if (options?.userBubbleText || options?.screenshotPreview) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'user',
                text: options?.userBubbleText || options?.message || '',
                hasScreenshot: Boolean(options?.screenshotPreview),
                screenshotPreview: options?.screenshotPreview,
            }]);
        }

        // Streaming placeholder
        setMessages(prev => [...prev, {
            id: nextMsgId(),
            requestId,
            role: 'system',
            text: '',
            intent,
            source: options?.source,
            isStreaming: true,
        }]);

        try {
            await window.electronAPI.generateAction({
                intent: intent as any,
                message: resolvedMessage || undefined,
                additionalContext: options?.additionalContext,
                imagePaths: options?.imagePaths,
                requestId,
                profilePreference: options?.profilePreference as any,
            });
        } catch (err) {
            setIsProcessing(false);
            activeRequestIdRef.current = null;
            setMessages(prev => {
                const idx = prev.findIndex(msg => msg.requestId === requestId);
                if (idx < 0) return prev;
                const u = [...prev];
                u[idx] = { ...u[idx], text: `❌ Error: ${err}`, isStreaming: false };
                return u;
            });
        }
    }, []);

    // ── executeQuickAction — thin wrapper around runAction ──
    const executeQuickAction = useCallback(async (action: OverlayQuickActionDef) => {
        await runAction(action.intent as string, {
            source: action.source,
            analyticsKey: action.analyticsKey,
            message: action.message,
            additionalContext: action.additionalContext,
            profilePreference: action.profilePreference,
        });
    }, [runAction]);

    // ── getQuickActionHandler — maps action defs to handler functions ──
    const getQuickActionHandler = useCallback((action: OverlayQuickActionDef): (() => void | Promise<void>) => {
        return () => executeQuickAction(action);
    }, [executeQuickAction]);

    // ── Manual input submit ──
    const handleManualSubmit = useCallback(async (text: string) => {
        if (!text.trim()) return;
        setInputValue('');
        await runAction('what_to_answer', {
            source: 'Manual Input',
            analyticsKey: 'manual_input',
            message: text.trim(),
            userBubbleText: text.trim(),
        });
    }, [runAction]);

    // ── End meeting ──
    const handleEndMeeting = useCallback(() => {
        onEndMeeting?.();
    }, [onEndMeeting]);

    // ── Screen Analyse — takes screenshot + runs screen scan ──
    const handleScreenScan = useCallback(async () => {
        try {
            const data = await window.electronAPI.takeScreenshot();
            if (!data?.path) return;

            const requestId = nextRequestId('screen_scan');
            activeRequestIdRef.current = requestId;
            setIsProcessing(true);
            setIsExpanded(true);
            requestStartTimeRef.current = Date.now();
            currentSourceRef.current = 'Screen Analysis';

            // Add streaming placeholder
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                requestId,
                role: 'system',
                text: '',
                intent: 'screen_scan',
                source: 'Screen Analysis',
                isStreaming: true,
                hasScreenshot: true,
                screenshotPreview: data.preview,
            }]);

            // Trigger screen analysis through existing IPC
            window.electronAPI.runScreenAnalysis({
                requestId,
                image: data.path,
            });

            analytics.trackCommandExecuted('screen_scan');
        } catch (err) {
            console.error('[V2] Screen scan error:', err);
            setIsProcessing(false);
        }
    }, []);

    // ── Toggle ──
    const toggleExpanded = useCallback(() => {
        setIsExpanded(prev => !prev);
    }, []);

    // ── Reset ──
    const handleReset = useCallback(async () => {
        if (isProcessing && activeRequestIdRef.current) {
            try {
                await Promise.allSettled([
                    window.electronAPI.cancelGeminiChatStream?.(),
                    window.electronAPI.cancelIntelligenceByRequest?.(activeRequestIdRef.current),
                ]);
            } catch { }
            setIsProcessing(false);
            activeRequestIdRef.current = null;
        } else {
            await window.electronAPI.resetIntelligence();
            setMessages([]);
            setInputValue('');
            lastFinalSentenceRef.current = '';
            finalizedTranscriptRef.current = '';
            setLastFinalSentence('');
            setRollingTranscript('');
            dispatchIntent({ type: 'RESET' });
            seqRef.current = 0;
            recommendedButtonRef.current = 'what_to_answer';
            setRecommendedButton('what_to_answer');
            setSession({ currentMode: 'general' });
        }
    }, [isProcessing]);

    // ── Latest response (for the right panel) ──
    const latestResponse = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'system') return messages[i];
        }
        return null;
    }, [messages]);

    return {
        // State
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

        // Setters
        setInputValue,
        setShowTranscript,
        setIsExpanded,

        // Handlers
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

        // Refs
        scrollContainerRef,
    };
}
