import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback, useReducer } from 'react';
import {
    Sparkles,
    Pencil,
    MessageSquare,
    RefreshCw,
    Settings,
    ArrowUp,
    ArrowRight,
    HelpCircle,
    ChevronUp,
    ChevronDown,
    Lightbulb,
    CornerDownLeft,
    Mic,
    MicOff,
    Image,
    Camera,
    X,
    LogOut,
    Zap,
    Edit3,
    SlidersHorizontal,
    LayoutGrid,
    Ghost,
    Link,
    Code,
    Copy,
    Check,
    PointerOff,
    BookOpen,
    Cpu,
    FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
// import { ModelSelector } from './ui/ModelSelector'; // REMOVED
import TopPill from './ui/TopPill';
import RollingTranscript from './ui/RollingTranscript';
import ProContextBar from './ui/ProContextBar';
import { NegotiationCoachingCard } from '../premium';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { analytics, detectProviderType } from '../lib/analytics/analytics.service';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getOverlayAppearance, OVERLAY_OPACITY_DEFAULT } from '../lib/overlayAppearance';

interface Message {
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
    chips?: ResponseChip[];
    isNegotiationCoaching?: boolean;
    negotiationCoachingData?: {
        tacticalNote: string;
        exactScript: string;
        showSilenceTimer: boolean;
        phase: string;
        theirOffer: number | null;
        yourTarget: number | null;
        currency: string;
    };
}

type ChipVariant = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';
interface ResponseChip { label: string; variant: ChipVariant; }

type RequestLifecycleStatus = 'streaming' | 'completed' | 'failed' | 'cancelled';

interface RequestLifecycle {
    requestId: string;
    messageId: string;
    status: RequestLifecycleStatus;
    intent?: string;
    questionTurnId?: string | null;
    startedAt: number;
}

function generateResponseChips(text: string, _intent?: string): ResponseChip[] {
    if (!text || text.length < 40) return [];
    const chips: ResponseChip[] = [];
    const seen = new Set<string>();
    const add = (label: string, variant: ChipVariant) => {
        const key = label.toLowerCase();
        if (!seen.has(key) && chips.length < 5) { seen.add(key); chips.push({ label, variant }); }
    };

    // Salary / TC ranges  e.g. "$245K–$310K", "$280-295K", "250,000"
    const moneyRe = /\$(\d[\d,]*(?:\.\d+)?[Kk]?)\s*[–\-~to]+\s*\$(\d[\d,]*(?:\.\d+)?[Kk]?)/g;
    let m: RegExpExecArray | null;
    while ((m = moneyRe.exec(text)) !== null) {
        add(`${m[1]}–${m[2]}`, 'green');
    }

    // Single TC / salary mention  "$280K"
    if (chips.length === 0) {
        const singleMoney = /\$(\d[\d,]*[Kk]?)\b/.exec(text);
        if (singleMoney) add(singleMoney[0], 'green');
    }

    // Percentage mentions  "within 15%", "20% increase"
    const pctRe = /(?:within |up to |\+)?\d+(?:\.\d+)?%\s*(?:increase|raise|above|below|buffer|margin|counter)?/gi;
    while ((m = pctRe.exec(text)) !== null && chips.length < 5) {
        add(m[0].trim(), 'amber');
    }

    // Don't / Avoid imperative chips
    const dontRe = /(?:don['']t|never|avoid)\s+(?:say|mention|use|give|share)?\s*["']?([\w][\w\s"']{3,30})["']?/gi;
    while ((m = dontRe.exec(text)) !== null && chips.length < 5) {
        add(`Don't ${m[1].trim()}`, 'red');
    }

    // Do / Make sure imperative chips
    const doRe = /(?:(?:^|\n|\.|,)\s*(?:always|make sure|ensure|remember to|be sure to)\s+([^.\n,]{8,40}))/gi;
    while ((m = doRe.exec(text)) !== null && chips.length < 5) {
        const cap = m[1].trim();
        if (cap.length > 5) add(cap.charAt(0).toUpperCase() + cap.slice(1), 'blue');
    }

    // Time references  "2 weeks", "30 days"
    const timeRe = /\b(\d+\s*(?:days?|weeks?|months?|hours?))\b/gi;
    while ((m = timeRe.exec(text)) !== null && chips.length < 5) {
        add(m[0].trim(), 'purple');
    }

    // Key quoted terms  "flexible", "market rate"
    const quotedRe = /["']([\w][\w\s]{2,24})["']/g;
    while ((m = quotedRe.exec(text)) !== null && chips.length < 5) {
        add(`"${m[1]}"`, 'gray');
    }

    // Anchor / counter / target labels
    const anchorRe = /\b(anchor|target|floor|counter(?:offer)?)\s*:?\s*(\$[\d,K]+(?:\s*[–\-]\s*\$?[\d,K]+)?)/gi;
    while ((m = anchorRe.exec(text)) !== null && chips.length < 5) {
        add(`${m[1].charAt(0).toUpperCase() + m[1].slice(1)}: ${m[2]}`, 'amber');
    }

    return chips;
}

interface SttTelemetryData {
    type: 'provider_started' | 'provider_failed' | 'failover_triggered' | 'debug_failure_injected';
    provider: string;
    channel: 'user' | 'interviewer';
    sourceLabel: string;
    timestamp: number;
    reason?: string;
    nextProvider?: string;
    consecutiveFailures?: number;
    disabledUntil?: number | null;
    replayBufferEntries?: number;
    replayBufferDurationMs?: number;
}

interface SttMetricsData {
    channel: 'user' | 'interviewer';
    sourceLabel: string;
    activeProvider: string;
    started: boolean;
    replayInProgress: boolean;
    pendingWrites: number;
    replayBufferEntries: number;
    replayBufferDurationMs: number;
    failoverCount: number;
    totalTranscripts: number;
    totalFinalTranscripts: number;
    transcriptsPerSecond: number;
    providers: Array<{
        provider: string;
        starts: number;
        transcripts: number;
        finalTranscripts: number;
        failures: number;
        failovers: number;
        successRate: number;
        cooldownUntil: number | null;
        lastLatencyMs?: number;
        averageLatencyMs?: number;
    }>;
}

interface NativelyInterfaceProps {
    onEndMeeting?: () => void;
    overlayOpacity?: number;
    hasProContextAccess?: boolean;
}

// ── C1 Fix: Monotonic message ID counter to prevent collisions under rapid updates ──
let msgIdCounter = 0;
function nextMsgId(): string {
    return `${Date.now()}-${++msgIdCounter}`;
}

let requestIdCounter = 0;
function nextRequestId(prefix: string = 'req'): string {
    return `${prefix}-${Date.now()}-${++requestIdCounter}`;
}

function getSuggestedAnswerIntent(question: string): string {
    if (question === 'Code Hint') return 'code_hint';
    if (question === 'Brainstorming Approaches') return 'brainstorm';
    return 'what_to_answer';
}

// ── Context-Aware Question Type Detection (mirrors IntentClassifier patterns) ──
type DetectedQuestionType = 'coding' | 'system_design' | 'behavioral' | 'general';

// M3 Fix: Removed /g flags — these are always wrapped in new RegExp(..., 'gi') via cap()
const REGEX_NORMALIZE_BROKEN = /(\w)\.\s+(\w)/;
const REGEX_NORMALIZE_FILLER = /\b(yeah|um|uh|uh+m|like|so|okay|ok|well|you know|i mean|basically|actually|right)\b/;
const REGEX_NORMALIZE_SPACE = /\s+/;

const REGEX_CODING_CORE = /(write code|write a? ?(?:function|program|method|class|script)|implement|how to code)/;
const REGEX_SYSTEM_CORE = /(system design|design a|architecture|database schema|api design)/;
const REGEX_BEHAVIORAL_CORE = /(tell me about a time|describe a situation|give me an example|share an experience)/;

const REGEX_CODING_STRONG = /(algorithm|debug this|snippet|boilerplate|optimize|refactor|array|linked list|tree|graph|stack|queue|hash ?map|binary search|dynamic programming|recursion|time complexity|space complexity)/;
const REGEX_SYSTEM_STRONG = /(scalab|microservice|load balanc|distributed|high availability|caching strategy|caching|cache|cdn|message queue|rate limit|sharding|replication|partition|cap theorem|event driven|monolith|horizontal scal|fault toleran|throughput|latency|handle more users|high traffic|load)/;
const REGEX_BEHAVIORAL_STRONG = /(when have you|biggest challenge|how did you handle|conflict with|leadership|teamwork|failure|mistake|difficult decision|star method|tell me about|experience|challenge|conflict|pressure|strength|weakness|mentor|disagree|feedback|prioriti[zs]e|deadline|collaborate|accomplishment|introduce yourself|background|resume)/;

const REGEX_CODING_BOOST = /(faster|efficient)/;
const REGEX_SYSTEM_BOOST = /(tradeoff|trade-off|pros? and cons|downsides|advantages|disadvantages)/;

function normalizeTranscript(text: string) {
    let t = text.toLowerCase();
    t = t.replace(new RegExp(REGEX_NORMALIZE_BROKEN.source, 'g'), '$1$2'); // Fix broken words
    t = t.replace(/[\u201C\u201D\u2018\u2019]/g, '"');
    t = t.replace(/[\u2013\u2014]/g, '-');
    t = t.replace(/[^a-z0-9\s\-?:/]/g, ' '); // Keep semantic hints (?, :, /)
    t = t.replace(new RegExp(REGEX_NORMALIZE_FILLER.source, 'gi'), ' ');
    t = t.replace(new RegExp(REGEX_NORMALIZE_SPACE.source, 'g'), ' ').trim();
    return t;
}

function detectQuestionType(
    text: string, 
    currentType: DetectedQuestionType,
    lastStrongType: DetectedQuestionType
): { nextType: DetectedQuestionType; nextStrong?: DetectedQuestionType } {
    // Normalize: fix OCR/STT artifacts, collapse whitespace
    let t = normalizeTranscript(text);

    const scores = {
        coding: 0,
        system_design: 0,
        behavioral: 0,
        general: 0
    };

    // Helper to count regex matches with a cap to prevent inflation from repeated words
    const cap = (regex: RegExp) => {
        let count = 0;
        for (const _ of t.matchAll(new RegExp(regex.source, 'gi'))) {
            if (++count >= 3) break;
        }
        return count;
    };

    // --- PRIORITY WEIGHTING ---
    // Core Signals (+3)
    scores.coding += cap(REGEX_CODING_CORE) * 3;
    scores.system_design += cap(REGEX_SYSTEM_CORE) * 3;
    scores.behavioral += cap(REGEX_BEHAVIORAL_CORE) * 3;

    // Strong Signals (+2)
    scores.coding += cap(REGEX_CODING_STRONG) * 2;
    scores.system_design += cap(REGEX_SYSTEM_STRONG) * 2;
    scores.behavioral += cap(REGEX_BEHAVIORAL_STRONG) * 2;
    
    // Cross-pollination boosts for mixed queries (+1)
    scores.coding += cap(REGEX_CODING_BOOST);
    scores.system_design += cap(REGEX_SYSTEM_BOOST);

    // Weighted persistence (memory of previous intent)
    if (currentType !== 'general') {
        scores[currentType] += 0.5;
    }

    const entries = (Object.entries(scores) as [DetectedQuestionType, number][])
        .filter(([type]) => type !== 'general') // Evaluate active intents only
        .sort((a, b) => b[1] - a[1]);

    const [primary, primaryScore] = entries[0];
    const [, secondScore] = entries[1] || [null, 0];

    // Confidence fallback: if signal is too weak, use memory of last strong intent
    if (primaryScore < 2) {
        return { nextType: lastStrongType };
    }

    const nextStrong = primaryScore >= 3 ? primary : undefined;

    // Hysteresis: only switch if the primary intent beats the secondary intent cleanly
    const SWITCH_THRESHOLD = 2;
    if (primary !== currentType && currentType !== 'general' && (primaryScore - secondScore) < SWITCH_THRESHOLD) {
        return { nextType: currentType, nextStrong };
    }

    return { nextType: primary, nextStrong };
}

type IntentState = {
    detectedType: DetectedQuestionType;
    lastStrongType: DetectedQuestionType;
    lastStrongAt: number;
    seq: number;
};

type IntentAction =
    | { type: 'EVALUATE'; combinedText: string; now: number; seq: number }
    | { type: 'RESET' };

function intentReducer(state: IntentState, action: IntentAction): IntentState {
    switch (action.type) {
        case 'RESET':
            // Session isolation fix: wipe all classification state so no intent
            // from the previous meeting leaks into the next session.
            // lastStrongAt = 0 ensures the 6-second decay window fires immediately
            // on the first EVALUATE of the new session, preventing lastStrongType
            // from acting as a ghost signal.
            return {
                detectedType: 'general',
                lastStrongType: 'general',
                lastStrongAt: 0,
                seq: 0,
            };

        case 'EVALUATE': {
            if (action.seq < state.seq) return state; // ignore stale updates
            
            // Protect against empty / degenerate STT glitch resets
            if (!action.combinedText || action.combinedText.length < 5) return state;

            const { nextType, nextStrong } = detectQuestionType(
                action.combinedText, 
                state.detectedType, 
                state.lastStrongType
            );

            let newLastStrongType = nextStrong ?? state.lastStrongType;
            let newLastStrongAt = nextStrong ? action.now : state.lastStrongAt;

            // Handle Topic Memory Decay (Time-based, monotonic)
            if (!nextStrong) {
                const elapsed = action.now - state.lastStrongAt;
                if (elapsed > 6000 && state.lastStrongType !== 'general') { // ~6 seconds of ambiguous speech
                    newLastStrongType = 'general';
                }
            }

            // Optimization: avoid re-rendering if absolutely nothing changed
            if (
                state.detectedType === nextType && 
                state.lastStrongType === newLastStrongType && 
                state.lastStrongAt === newLastStrongAt
            ) {
                return { ...state, seq: action.seq }; // keep seq updated
            }

            if (process.env.NODE_ENV === 'development') {
                console.log('[INTENT]', {
                    type: nextType,
                    strong: nextStrong,
                    seq: action.seq
                });
            }

            return {
                detectedType: nextType,
                lastStrongType: newLastStrongType,
                lastStrongAt: newLastStrongAt,
                seq: action.seq
            };
        }
        default:
            return state;
    }
}

const NativelyInterface: React.FC<NativelyInterfaceProps> = ({
    onEndMeeting,
    overlayOpacity = OVERLAY_OPACITY_DEFAULT,
    hasProContextAccess = false,
}) => {
    const isLightTheme = useResolvedTheme() === 'light';
    const [forceSystemDesignMode, setForceSystemDesignMode] = useState(() => {
        return localStorage.getItem('natively_force_system_design_mode') === 'true';
    });
    const [negotiationContextEnabled, setNegotiationContextEnabled] = useState(false);
    const [negotiationToggleLoading, setNegotiationToggleLoading] = useState(false);
    const [hasNegotiationScript, setHasNegotiationScript] = useState(false);
    const [customNotesEnabled, setCustomNotesEnabled] = useState(true);

    const refreshNegotiationContextState = useCallback(async () => {
        if (!hasProContextAccess) {
            setNegotiationContextEnabled(false);
            setHasNegotiationScript(false);
            return;
        }

        try {
            const [negotiationState, aotState] = await Promise.all([
                window.electronAPI?.profileGetNegotiationState?.(),
                window.electronAPI?.getAOTState?.(),
            ]);
            setNegotiationContextEnabled(Boolean(negotiationState?.enabled ?? negotiationState?.isActive));
            setHasNegotiationScript(Boolean(aotState?.negotiation?.exists));
        } catch {
            setNegotiationContextEnabled(false);
        }
    }, [hasProContextAccess]);

    const handleToggleNegotiationContext = useCallback(async (enabled: boolean) => {
        if (!hasProContextAccess || !window.electronAPI?.profileSetNegotiationContextEnabled) {
            return;
        }

        setNegotiationToggleLoading(true);
        try {
            const result = await window.electronAPI.profileSetNegotiationContextEnabled(enabled);
            if (result?.success) {
                const nextEnabled = Boolean(result.enabled ?? result.isActive ?? enabled);
                setNegotiationContextEnabled(nextEnabled);
                if (typeof result.hasScript === 'boolean') {
                    setHasNegotiationScript(result.hasScript);
                }
                console.log(`[Overlay] Negotiation context ${nextEnabled ? 'on' : 'off'}`);
            } else if (result?.error) {
                console.warn('[Overlay] Failed to toggle negotiation context:', result.error);
            }
        } catch (error) {
            console.warn('[Overlay] Failed to toggle negotiation context:', error);
        } finally {
            setNegotiationToggleLoading(false);
        }
    }, [hasProContextAccess]);

    // Load custom context enabled state on mount
    useEffect(() => {
        if (hasProContextAccess) {
            window.electronAPI?.getCustomNotesEnabled?.().then(res => {
                if (res?.success) setCustomNotesEnabled(res.enabled);
            }).catch(() => {});
        }
    }, [hasProContextAccess]);

    useEffect(() => {
        void refreshNegotiationContextState();
    }, [refreshNegotiationContextState]);

    useEffect(() => {
        const unsubscribers: Array<() => void> = [];
        if (window.electronAPI?.onNegotiationStateChanged) {
            unsubscribers.push(window.electronAPI.onNegotiationStateChanged((data) => {
                setNegotiationContextEnabled(Boolean(data?.enabled ?? data?.isActive));
            }));
        }
        if (window.electronAPI?.onNegotiationRestored) {
            unsubscribers.push(window.electronAPI.onNegotiationRestored(() => {
                void refreshNegotiationContextState();
            }));
        }
        if (window.electronAPI?.onNegotiationRegenerated) {
            unsubscribers.push(window.electronAPI.onNegotiationRegenerated(() => {
                void refreshNegotiationContextState();
            }));
        }
        if (window.electronAPI?.onKnowledgeEngineReady) {
            unsubscribers.push(window.electronAPI.onKnowledgeEngineReady(() => {
                void refreshNegotiationContextState();
            }));
        }
        return () => {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };
    }, [refreshNegotiationContextState]);

    useEffect(() => {
        localStorage.setItem('natively_force_system_design_mode', String(forceSystemDesignMode));
    }, [forceSystemDesignMode]);

    // Source label tracking: set by handlers, read by stream listeners
    const currentSourceRef = useRef<string | undefined>(undefined);

    const sourceStyleMap: Record<string, { light: string; dark: string }> = {
        'What to Answer': { light: 'bg-blue-100/80 text-blue-700 border-blue-200/60', dark: 'bg-blue-500/15 text-blue-300 border-blue-400/25' },
        'Clarify':        { light: 'bg-amber-100/80 text-amber-700 border-amber-200/60', dark: 'bg-amber-500/15 text-amber-300 border-amber-400/25' },
        'Follow Up':      { light: 'bg-emerald-100/80 text-emerald-700 border-emerald-200/60', dark: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25' },
        'Recap':          { light: 'bg-teal-100/80 text-teal-700 border-teal-200/60', dark: 'bg-teal-500/15 text-teal-300 border-teal-400/25' },
        'Follow Up Questions': { light: 'bg-cyan-100/80 text-cyan-700 border-cyan-200/60', dark: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/25' },
        'Code Hint':      { light: 'bg-purple-100/80 text-purple-700 border-purple-200/60', dark: 'bg-purple-500/15 text-purple-300 border-purple-400/25' },
        'Brainstorm':     { light: 'bg-pink-100/80 text-pink-700 border-pink-200/60', dark: 'bg-pink-500/15 text-pink-300 border-pink-400/25' },
        'System Design Trade-offs': { light: 'bg-emerald-100/80 text-emerald-700 border-emerald-200/60', dark: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25' },
        'Answer Now':     { light: 'bg-indigo-100/80 text-indigo-700 border-indigo-200/60', dark: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/25' },
        'Manual Input':   { light: 'bg-slate-100/80 text-slate-600 border-slate-200/60', dark: 'bg-slate-500/15 text-slate-300 border-slate-400/25' },
    };
    const defaultSourceStyle = { light: 'bg-violet-100/80 text-violet-700 border-violet-200/60', dark: 'bg-violet-500/15 text-violet-300 border-violet-400/25' };

    const sourceIconMap: Record<string, string> = {
        'What to Answer': '💡',
        'Clarify': '❓',
        'Follow Up': '➡️',
        'Follow Up Questions': '📌',
        'Recap': '📝',
        'Code Hint': '💻',
        'Brainstorm': '🧠',
        'System Design Trade-offs': '⚖️',
        'Answer Now': '⚡',
        'Manual Input': '⌨️',
    };
    const [isExpanded, setIsExpanded] = useState(true);
    const [inputValue, setInputValue] = useState('');
    const { shortcuts, isShortcutPressed } = useShortcuts();
    const [messages, setMessages] = useState<Message[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [sttUserStatus, setSttUserStatus] = useState<'connected' | 'reconnecting' | 'failed'>('connected');
    const [sttUserError, setSttUserError] = useState<string>('');
    const [sttUserProvider, setSttUserProvider] = useState<string>('');
    const [sttInterviewerStatus, setSttInterviewerStatus] = useState<'connected' | 'reconnecting' | 'failed'>('connected');
    const [sttInterviewerError, setSttInterviewerError] = useState<string>('');
    const [sttInterviewerProvider, setSttInterviewerProvider] = useState<string>('');
    const [sttTelemetry, setSttTelemetry] = useState<{ user: SttTelemetryData | null; interviewer: SttTelemetryData | null }>({ user: null, interviewer: null });
    const [sttMetrics, setSttMetrics] = useState<{ user: SttMetricsData | null; interviewer: SttMetricsData | null }>({ user: null, interviewer: null });
    const [isProcessing, setIsProcessing] = useState(false);
    const isProcessingRef = useRef(false); // H4 Fix: Ref mirror for double-submit guard in async handlers
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isManualRecording, setIsManualRecording] = useState(false);
    const isRecordingRef = useRef(false);  // Ref to track recording state (avoids stale closure)
    // V2 Fix: tracks the active session ID so the transcript handler can drop
    // cross-session payloads that arrive via IPC after a rapid restart.
    const activeSessionIdRef = useRef<string | null>(null);
    const [manualTranscript, setManualTranscript] = useState('');
    const manualTranscriptRef = useRef<string>('');
    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('natively_interviewer_transcript');
        return stored !== 'false';
    });

    // Analytics State
    const requestStartTimeRef = useRef<number | null>(null);
    const activeIntentRequestIdsRef = useRef<Record<string, string>>({});
    const activeChatRequestIdRef = useRef<string | null>(null);
    const activeRagRequestIdRef = useRef<string | null>(null);
    const activeUiRequestIdRef = useRef<string | null>(null);
    const requestRegistryRef = useRef<Record<string, RequestLifecycle>>({});
    const currentQuestionTurnIdRef = useRef<string | null>(null);
    const [currentQuestionTurnId, setCurrentQuestionTurnId] = useState<string>('question-init');

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

    const updateRequestLifecycle = useCallback((requestId: string, patch: Partial<RequestLifecycle>) => {
        const current = requestRegistryRef.current[requestId];
        if (!current) return;
        requestRegistryRef.current[requestId] = { ...current, ...patch };
    }, []);

    const markRequestProcessing = useCallback((requestId: string) => {
        activeUiRequestIdRef.current = requestId;
        setIsProcessing(true);
    }, []);

    const clearProcessingForRequest = useCallback((requestId?: string | null) => {
        if (!requestId) return;
        if (activeUiRequestIdRef.current === requestId) {
            activeUiRequestIdRef.current = null;
            setIsProcessing(false);
        }
    }, []);

    const beginStreamingMessage = useCallback((requestId: string, message: Omit<Message, 'id'>) => {
        setMessages(prev => {
            const idx = prev.findIndex(msg => msg.requestId === requestId);
            const messageId = idx >= 0 ? prev[idx].id : nextMsgId();
            const nextMessage: Message = {
                id: messageId,
                requestId,
                questionTurnId: message.questionTurnId ?? currentQuestionTurnIdRef.current ?? undefined,
                ...message
            };
            requestRegistryRef.current[requestId] = {
                requestId,
                messageId,
                status: 'streaming',
                intent: nextMessage.intent,
                questionTurnId: nextMessage.questionTurnId ?? null,
                startedAt: requestRegistryRef.current[requestId]?.startedAt ?? Date.now(),
            };
            if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], ...nextMessage };
                return updated;
            }
            return [...prev, nextMessage];
        });
    }, []);

    const appendTokenToRequest = useCallback((requestId: string, token: string) => {
        const lifecycle = requestRegistryRef.current[requestId];
        if (!lifecycle || lifecycle.status !== 'streaming') return;
        setMessages(prev => {
            const idx = prev.findIndex(msg => msg.requestId === requestId);
            if (idx < 0) return prev;
            const updated = [...prev];
            const nextText = updated[idx].text + token;
            updated[idx] = {
                ...updated[idx],
                text: nextText,
                isCode: nextText.includes('```'),
            };
            return updated;
        });
    }, []);

    const finalizeRequestMessage = useCallback((requestId: string, finalText: string, extra?: Partial<Message>) => {
        const lifecycle = requestRegistryRef.current[requestId];
        if (!lifecycle || lifecycle.status !== 'streaming') return;
        updateRequestLifecycle(requestId, { status: 'completed' });
        setMessages(prev => {
            const idx = prev.findIndex(msg => msg.requestId === requestId);
            if (idx < 0) return prev;
            const updated = [...prev];
            const current = updated[idx];
            updated[idx] = {
                ...current,
                ...extra,
                text: finalText,
                isStreaming: false,
            };
            return updated;
        });
    }, []);

    const failRequestMessage = useCallback((requestId: string, errorText: string) => {
        const lifecycle = requestRegistryRef.current[requestId];
        if (lifecycle?.status === 'completed' || lifecycle?.status === 'cancelled') return;
        if (lifecycle) {
            updateRequestLifecycle(requestId, { status: 'failed' });
        }
        setMessages(prev => {
            const idx = prev.findIndex(msg => msg.requestId === requestId);
            if (idx < 0) {
                const messageId = nextMsgId();
                requestRegistryRef.current[requestId] = {
                    requestId,
                    messageId,
                    status: 'failed',
                    startedAt: Date.now(),
                };
                return [...prev, {
                    id: messageId,
                    requestId,
                    role: 'system',
                    text: errorText,
                }];
            }
            const updated = [...prev];
            const current = updated[idx];
            updated[idx] = {
                ...current,
                isStreaming: false,
                text: current.text
                    ? `${current.text}\n\n${errorText}`
                    : errorText,
            };
            return updated;
        });
    }, [updateRequestLifecycle]);

    const cancelRequestMessage = useCallback((requestId: string, reason?: string) => {
        const lifecycle = requestRegistryRef.current[requestId];
        if (!lifecycle || lifecycle.status !== 'streaming') return;
        updateRequestLifecycle(requestId, { status: 'cancelled' });
        setMessages(prev => {
            const idx = prev.findIndex(msg => msg.requestId === requestId);
            if (idx < 0) return prev;
            const updated = [...prev];
            const current = updated[idx];
            updated[idx] = {
                ...current,
                isStreaming: false,
                text: current.text || reason || '',
            };
            return updated;
        });
    }, [updateRequestLifecycle]);

    // Sync transcript setting
    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('natively_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const [rollingTranscript, setRollingTranscript] = useState('');  // For interviewer rolling text bar
    const finalizedTranscriptRef = useRef(''); // C6 Fix: Tracks finalized transcript separately from partials
    // Holds ONLY the last finalized STT sentence — shown in the transcript pill.
    // Updated exclusively when transcript.final === true so interim partials never appear.
    const [lastFinalSentence, setLastFinalSentence] = useState('');
    const lastFinalSentenceRef = useRef(''); // stable ref for session-reset without stale closure
    // Sentence-scoped dot state: currentSentenceId increments on every final STT segment.
    // lastResponseSentenceId is set when isProcessing falls to false (AI finished).
    // Dot is green when they differ (new unanswered question) and grey when they match.
    const [currentSentenceId, setCurrentSentenceId] = useState(0);
    const currentSentenceIdRef = useRef(0); // stable read in isProcessing effect
    const [lastResponseSentenceId, setLastResponseSentenceId] = useState(0);
    const prevIsProcessingRef = useRef(false); // tracks isProcessing transition for dot state
    const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);  // Track if actively speaking
    const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // H6 Fix: Prevents timer stacking
    const [voiceInput, setVoiceInput] = useState('');  // Accumulated user voice input
    const voiceInputRef = useRef<string>('');  // Ref for capturing in async handlers
    const textInputRef = useRef<HTMLInputElement>(null); // Ref for input focus
    const isStealthRef = useRef<boolean>(false); // Tracks if the next expansion should be stealthy
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const userHasScrolledRef = useRef(false);
    const [showJumpButton, setShowJumpButton] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    // Captures data from onCaptureAndProcess before the React state flush so
    // handleWhatToSay() can access it even in React 18 concurrent mode (where
    // a plain setTimeout(0) may fire before setAttachedContext flushes).
    const pendingCaptureRef = useRef<{ path: string; preview: string } | null>(null);

    // Latent Context State (Screenshots attached but not sent)
    const [attachedContext, setAttachedContext] = useState<Array<{ path: string, preview: string }>>([]);
    const attachedContextRef = useRef<Array<{ path: string, preview: string }>>([]); // C4 Fix: Ref mirror for stable access

    // Settings State with Persistence
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [hideChatHidesWidget, setHideChatHidesWidget] = useState(() => {
        const stored = localStorage.getItem('natively_hideChatHidesWidget');
        return stored ? stored === 'true' : true;
    });

    // Active mode name (shown as a badge near the Modes button)
    const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);

    useEffect(() => {
        // Load initial active mode name
        window.electronAPI?.modesGetActive?.()
            .then((mode: { name: string } | null) => setActiveModeLabel(mode?.name ?? null))
            .catch(() => {});
        // Live-update whenever mode is activated/deactivated
        const unsub = window.electronAPI?.onModeChanged?.((data: { id: string | null; name: string | null }) => {
            setActiveModeLabel(data.name);
        });
        return () => unsub?.();
    }, []);

    // Model Selection State
    const [currentModel, setCurrentModel] = useState<string>('gemini-3-flash-preview');
    const currentModelRef = useRef(currentModel); // C3 Fix: Ref for analytics in mount-only streaming effect

    // Dynamic Action Button Mode (Recap vs Brainstorm)
    const [actionButtonMode, setActionButtonMode] = useState<'recap' | 'brainstorm'>('recap');
    const actionButtonModeRef = useRef(actionButtonMode); // M6 Fix: Ref for stale closure in onGlobalShortcut

    useEffect(() => {
        // Load persisted mode
        window.electronAPI?.getActionButtonMode?.()?.then((mode: 'recap' | 'brainstorm') => {
            if (mode) setActionButtonMode(mode);
        }).catch(() => {});

        // Listen for live changes from SettingsPopup / IPC
        const unsubscribe = window.electronAPI?.onActionButtonModeChanged?.((mode: 'recap' | 'brainstorm') => {
            setActionButtonMode(mode);
        });
        return () => { unsubscribe?.(); };
    }, []);

    // ── Context-Aware Dynamic Buttons ──
    const [intentState, dispatchIntent] = useReducer(intentReducer, {
        detectedType: 'general',
        lastStrongType: 'general',
        lastStrongAt: performance.now(),
        seq: 0
    });
    
    const detectedQuestionType = intentState.detectedType;
    const effectiveQuestionType: DetectedQuestionType = forceSystemDesignMode ? 'system_design' : detectedQuestionType;

    const latestCombinedRef = useRef<string>('');
    const seqRef = useRef(0);

    const recomputeIntentFromFinalTranscript = useCallback((questionTurnId: string) => {
        latestCombinedRef.current = [
            lastFinalSentenceRef.current,
            finalizedTranscriptRef.current.slice(-1200),
        ].filter(Boolean).join('\n').trim();

        if (latestCombinedRef.current.length < 3) return;

        currentQuestionTurnIdRef.current = questionTurnId;
        setCurrentQuestionTurnId(questionTurnId);
        const seq = ++seqRef.current;
        dispatchIntent({
            type: 'EVALUATE',
            combinedText: latestCombinedRef.current,
            now: performance.now(),
            seq
        });
    }, []);

    const cancelInFlightOverlayRequests = useCallback(async (nextRequestId?: string) => {
        const streamingRequestIds = Object.values(requestRegistryRef.current)
            .filter((request) => request.status === 'streaming' && request.requestId !== nextRequestId)
            .map((request) => request.requestId);

        streamingRequestIds.forEach((requestId) => cancelRequestMessage(requestId));

        Object.entries(activeIntentRequestIdsRef.current).forEach(([intent, requestId]) => {
            if (!requestId || requestId === nextRequestId) return;
            const lifecycle = requestRegistryRef.current[requestId];
            if (lifecycle?.status !== 'completed') {
                delete activeIntentRequestIdsRef.current[intent];
            }
        });

        await Promise.allSettled([
            window.electronAPI.cancelGeminiChatStream?.(),
            window.electronAPI.cancelIntelligenceRequest?.(),
            window.electronAPI.ragCancelQuery?.({ meetingId: 'live-meeting-current' }),
        ]);

        if (!nextRequestId || activeChatRequestIdRef.current !== nextRequestId) {
            activeChatRequestIdRef.current = null;
        }
        if (!nextRequestId || activeRagRequestIdRef.current !== nextRequestId) {
            activeRagRequestIdRef.current = null;
        }
        if (!nextRequestId || activeUiRequestIdRef.current !== nextRequestId) {
            activeUiRequestIdRef.current = null;
            setIsProcessing(false);
        }
        requestStartTimeRef.current = null;
        currentSourceRef.current = undefined;
    }, [cancelRequestMessage]);

    const codeTheme = isLightTheme ? oneLight : vscDarkPlus;
    const codeLineNumberColor = isLightTheme ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.2)';
    const appearance = useMemo(
        () => getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'),
        [overlayOpacity, isLightTheme]
    );
    const overlayPanelClass = 'overlay-text-primary';
    const subtleSurfaceClass = 'overlay-subtle-surface';
    const codeBlockClass = 'overlay-code-block-surface';
    const codeHeaderClass = 'overlay-code-header-surface';
    const codeHeaderTextClass = 'overlay-text-muted';
    const quickActionClass = 'overlay-chip-surface overlay-text-interactive';
    const inputClass = `${isLightTheme ? 'focus:ring-black/10' : 'focus:ring-white/10'} overlay-input-surface overlay-input-text`;
    const controlSurfaceClass = 'overlay-control-surface overlay-text-interactive';

    useEffect(() => {
        // Load the persisted default model (not the runtime model)
        // Each new meeting starts with the default from settings
        if (window.electronAPI?.getDefaultModel) {
            window.electronAPI.getDefaultModel()
                .then((result: any) => {
                    if (result && result.model) {
                        setCurrentModel(result.model);
                        // Also set the runtime model to the default
                        window.electronAPI.setModel(result.model).catch(() => { });
                    }
                })
                .catch((err: any) => console.error("Failed to fetch default model:", err));
        }
    }, []);

    const handleModelSelect = (modelId: string) => {
        setCurrentModel(modelId);
        // Session-only: update runtime but don't persist as default
        window.electronAPI.setModel(modelId)
            .catch((err: any) => console.error("Failed to set model:", err));
    };

    // Listen for default model changes from Settings
    useEffect(() => {
        if (!window.electronAPI?.onModelChanged) return;
        const unsubscribe = window.electronAPI.onModelChanged((modelId: string) => {
            setCurrentModel(prev => prev === modelId ? prev : modelId);
        });
        return () => unsubscribe();
    }, []);

    // Global State Sync
    useEffect(() => {
        // Fetch initial state
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then(setIsUndetectable);
        }

        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((state) => {
                setIsUndetectable(state);
            });
            return () => unsubscribe();
        }
    }, []);

    // Persist Settings
    useEffect(() => {
        localStorage.setItem('natively_undetectable', String(isUndetectable));
        localStorage.setItem('natively_hideChatHidesWidget', String(hideChatHidesWidget));
    }, [isUndetectable, hideChatHidesWidget]);

    // Mouse Passthrough State
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [localOpacity, setLocalOpacity] = useState(overlayOpacity);
    useEffect(() => {
        window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => {});
        const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v) => setIsMousePassthrough(v));
        
        const unsubOpacity = window.electronAPI?.onOverlayOpacityChanged?.((val) => setLocalOpacity(val));

        return () => {
            unsub?.();
            unsubOpacity?.();
        };
    }, []);

    // Screen Recording Permission Warning Banner
    const [systemAudioWarning, setSystemAudioWarning] = useState<string | null>(null);
    useEffect(() => {
        const unsub = window.electronAPI?.onSystemAudioPermissionDenied?.((message: string) => {
            setSystemAudioWarning(message);
            setIsExpanded(true); // Force overlay open so user sees the warning
        });
        return () => unsub?.();
    }, []);

    // PR #173: STT not configured warning — shown when provider is 'none' during a meeting
    const [sttNotConfigured, setSttNotConfigured] = useState(false);
    useEffect(() => {
        let mounted = true;
        // Check current STT config on mount
        window.electronAPI?.getSttProvider?.().then((provider: string) => {
            if (mounted) setSttNotConfigured(provider === 'none');
        }).catch(() => {});

        // Listen for live config changes (e.g. user saves a key in Settings while meeting is active)
        const unsub = window.electronAPI?.onSttConfigChanged?.((data: { configured: boolean; provider: string }) => {
            if (mounted) setSttNotConfigured(!data.configured);
        });
        return () => {
            mounted = false;
            unsub?.();
        };
    }, []);

    // Auto-resize Window
    useLayoutEffect(() => {
        if (!contentRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Use getBoundingClientRect to get the exact rendered size including padding
                const rect = entry.target.getBoundingClientRect();

                // Send exact dimensions to Electron
                // Removed buffer to ensure tight fit
                console.log('[NativelyInterface] ResizeObserver:', Math.ceil(rect.width), Math.ceil(rect.height));
                window.electronAPI?.updateContentDimensions({
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height)
                });
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    // Force resize when attachedContext changes (screenshots added/removed)
    useEffect(() => {
        if (!contentRef.current) return;
        // Let the DOM settle, then measure and push new dimensions
        requestAnimationFrame(() => {
            if (!contentRef.current) return;
            const rect = contentRef.current.getBoundingClientRect();
            window.electronAPI?.updateContentDimensions({
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height)
            });
        });
    }, [attachedContext]);

    // Force initial sizing safety check
    useEffect(() => {
        const timer = setTimeout(() => {
            if (contentRef.current) {
                const rect = contentRef.current.getBoundingClientRect();
                window.electronAPI?.updateContentDimensions({
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height)
                });
            }
        }, 600);
        return () => clearTimeout(timer);
    }, []);

    // H2 Fix: useMemo instead of useEffect+state — eliminates one-render-behind lag
    const conversationContext = useMemo(() => {
        const MAX_CONTEXT_MESSAGES = 8;
        const MAX_CONTEXT_CHARS = 1400;
        const MAX_MESSAGE_CHARS = 180;

        const normalized = messages
            .filter((message) => (message.role !== 'user' || !message.hasScreenshot) && message.text.trim().length > 0)
            .slice(-MAX_CONTEXT_MESSAGES)
            .map((message) => {
                const speaker = message.role === 'interviewer' ? 'Interviewer' : message.role === 'user' ? 'User' : 'Assistant';
                const rawText = message.isNegotiationCoaching
                    ? '[negotiation coaching card]'
                    : message.isCode
                        ? '[code response omitted]'
                        : message.text.replace(/\s+/g, ' ').trim();
                const trimmedText = rawText.length > MAX_MESSAGE_CHARS
                    ? `${rawText.slice(0, MAX_MESSAGE_CHARS).trimEnd()}...`
                    : rawText;
                return `${speaker}: ${trimmedText}`;
            })
            .join('\n');

        return normalized.length > MAX_CONTEXT_CHARS
            ? `[...conversation truncated]\n${normalized.slice(-MAX_CONTEXT_CHARS)}`
            : normalized;
    }, [messages]);

    // Keep refs in sync with state for async handler access
    isProcessingRef.current = isProcessing;
    attachedContextRef.current = attachedContext;
    currentModelRef.current = currentModel;
    actionButtonModeRef.current = actionButtonMode;

    // DOT STATE FIX: When isProcessing transitions true → false the AI has finished.
    // Stamp lastResponseSentenceId with the current sentence counter so the dot
    // turns grey for exactly the question that was just answered.
    // currentSentenceIdRef is read (not state) to avoid stale-closure issues.
    useEffect(() => {
        if (prevIsProcessingRef.current === true && isProcessing === false) {
            setLastResponseSentenceId(currentSentenceIdRef.current);
        }
        prevIsProcessingRef.current = isProcessing;
    }, [isProcessing]);

    // Detect manual user scroll to toggle jump-to-latest button
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 120;
            userHasScrolledRef.current = !isNearBottom;
            setShowJumpButton(!isNearBottom);
            if (isNearBottom) setUnreadCount(0);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    const scrollToBottom = useCallback(() => {
        const container = scrollContainerRef.current;
        if (container) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
        userHasScrolledRef.current = false;
        setShowJumpButton(false);
        setUnreadCount(0);
    }, []);

    // Listen for settings window visibility changes
    useEffect(() => {
        if (!window.electronAPI?.onSettingsVisibilityChange) return;
        const unsubscribe = window.electronAPI.onSettingsVisibilityChange((isVisible) => {
            setIsSettingsOpen(isVisible);
        });
        return () => unsubscribe();
    }, []);

    // Sync Window Visibility with Expanded State
    useEffect(() => {
        if (isExpanded) {
            window.electronAPI.showWindow(isStealthRef.current);
            isStealthRef.current = false; // Reset back to default
        } else {
            // Slight delay to allow animation to clean up if needed, though immediate is safer for click-through
            // Using setTimeout to ensure the render cycle completes first
            // Increased to 400ms to allow "contract to bottom" exit animation to finish
            setTimeout(() => window.electronAPI.hideWindow(), 400);
        }
    }, [isExpanded]);

    // Keyboard shortcut to toggle expanded state (via Main Process)
    useEffect(() => {
        if (!window.electronAPI?.onToggleExpand) return;
        const unsubscribe = window.electronAPI.onToggleExpand(() => {
            setIsExpanded(prev => !prev);
        });
        return () => unsubscribe();
    }, []);

    // Ensure overlay is expanded when requested by main process (e.g. after switching to overlay mode).
    // IMPORTANT: set isStealthRef before setIsExpanded so that if isExpanded was false, the
    // isExpanded effect fires showWindow(true) instead of showWindow(false). Without this,
    // ensure-expanded on a collapsed overlay would trigger show()+focus(), breaking stealth.
    useEffect(() => {
        if (!window.electronAPI?.onEnsureExpanded) return;
        const unsubscribe = window.electronAPI.onEnsureExpanded(() => {
            isStealthRef.current = true;
            setIsExpanded(true);
        });
        return () => unsubscribe();
    }, []);

    // Session Reset Listener - Clears UI when a NEW meeting starts
    useEffect(() => {
        if (!window.electronAPI?.onSessionReset) return;
        const unsubscribe = window.electronAPI.onSessionReset((payload) => {
            console.log('[NativelyInterface] Resetting session state...');
            void window.electronAPI.cancelGeminiChatStream?.().catch(() => {});
            void window.electronAPI.cancelIntelligenceRequest?.().catch(() => {});
            void window.electronAPI.ragCancelQuery?.({ meetingId: 'live-meeting-current' }).catch(() => {});
            setMessages([]);
            setInputValue('');
            setAttachedContext([]);
            setManualTranscript('');
            setVoiceInput('');
            setIsProcessing(false);
            setRollingTranscript('');
            finalizedTranscriptRef.current = '';
            // Reset last-sentence pill so old question never leaks into new session
            setLastFinalSentence('');
            lastFinalSentenceRef.current = '';
            currentQuestionTurnIdRef.current = null;
            setCurrentQuestionTurnId('question-init');
            // Reset sentence-response mapping so dot starts green in the new session
            setCurrentSentenceId(0);
            currentSentenceIdRef.current = 0;
            setLastResponseSentenceId(0);
            // V2 Fix: update session ID ref from the payload embedded by main.ts
            if (payload?.sessionId) {
                activeSessionIdRef.current = payload.sessionId;
            }
            activeIntentRequestIdsRef.current = {};
            activeChatRequestIdRef.current = null;
            activeRagRequestIdRef.current = null;
            activeUiRequestIdRef.current = null;
            requestRegistryRef.current = {};

            // SESSION ISOLATION FIX: Reset intentReducer so no button mode from
            // the previous session leaks into the new one. seqRef/scheduledSeqRef
            // are also zeroed so any in-flight intent sequence is invalidated.
            dispatchIntent({ type: 'RESET' });
            seqRef.current = 0;

            // Track new conversation/session if applicable?
            // Actually 'app_opened' is global, 'assistant_started' is overlay.
            // Maybe 'conversation_started' event?
            analytics.trackConversationStarted();
        });
        return () => unsubscribe();
    }, []);


    const handleScreenshotAttach = (data: { path: string; preview: string }) => {
        setIsExpanded(true);
        setAttachedContext(prev => {
            // Prevent duplicates and cap at 5
            if (prev.some(s => s.path === data.path)) return prev;
            const updated = [...prev, data];
            return updated.slice(-5); // Keep last 5
        });
    };

    // STT Status listener — must survive isExpanded changes.
    // If registered inside the [isExpanded] effect, events are dropped during cleanup.
    useEffect(() => {
        return window.electronAPI.onSttStatusChanged((data) => {
            if (data.channel === 'user') {
                setSttUserStatus(data.state);
                setSttUserProvider(data.provider);
                if (data.error) setSttUserError(data.error);
                if (data.state === 'connected') setSttUserError('');
            } else if (data.channel === 'interviewer') {
                setSttInterviewerStatus(data.state);
                setSttInterviewerProvider(data.provider);
                if (data.error) setSttInterviewerError(data.error);
                if (data.state === 'connected') setSttInterviewerError('');
            }
        });
    }, []);

    useEffect(() => {
        const cleanups: Array<() => void> = [];
        window.electronAPI.getSttRuntimeState().then((state) => {
            setSttMetrics({
                user: state?.user || null,
                interviewer: state?.interviewer || null,
            });
        }).catch(() => {});

        cleanups.push(window.electronAPI.onSttTelemetry((data) => {
            setSttTelemetry((prev) => ({
                ...prev,
                [data.channel]: data,
            }));
        }));

        cleanups.push(window.electronAPI.onSttMetrics((data) => {
            setSttMetrics((prev) => ({
                ...prev,
                [data.channel]: data,
            }));
        }));

        return () => {
            cleanups.forEach((cleanup) => cleanup());
        };
    }, []);

    // Connect to Native Audio Backend
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        // Connection Status
        window.electronAPI.getNativeAudioStatus().then((status) => {
            setIsConnected(status.connected);
        }).catch(() => setIsConnected(false));

        cleanups.push(window.electronAPI.onNativeAudioConnected(() => {
            setIsConnected(true);
        }));
        cleanups.push(window.electronAPI.onNativeAudioDisconnected(() => {
            setIsConnected(false);
        }));

        // Real-time Transcripts
        cleanups.push(window.electronAPI.onNativeAudioTranscript((transcript) => {
            // V2 Fix: drop transcripts from a previous session that arrive via buffered IPC
            // after a rapid restart. _sessionId is embedded by main.ts at broadcast time.
            if (transcript._sessionId && activeSessionIdRef.current &&
                transcript._sessionId !== activeSessionIdRef.current) {
                return;
            }
            // When Answer button is active, capture USER transcripts for voice input
            // Use ref to avoid stale closure issue
            if (isRecordingRef.current && transcript.speaker === 'user') {
                if (transcript.final) {
                    // Accumulate final transcripts
                    setVoiceInput(prev => {
                        const updated = prev + (prev ? ' ' : '') + transcript.text;
                        voiceInputRef.current = updated;
                        return updated;
                    });
                    setManualTranscript('');  // Clear partial preview
                    manualTranscriptRef.current = '';
                } else {
                    // Show live partial transcript
                    setManualTranscript(transcript.text);
                    manualTranscriptRef.current = transcript.text;
                }
                return;  // Don't add to messages while recording
            }

            // Ignore user mic transcripts when not recording
            // Only interviewer (system audio) transcripts should appear in chat
            if (transcript.speaker === 'user') {
                return;  // Skip user mic input - only relevant when Answer button is active
            }

            // Only show interviewer (system audio) transcripts in rolling bar
            if (transcript.speaker !== 'interviewer') {
                return;  // Safety check for any other speaker types
            }

            // Route to rolling transcript bar - accumulate text continuously
            setIsInterviewerSpeaking(!transcript.final);

            if (transcript.final) {
                // C6 Fix: Append to finalized ref for correct partial handling
                finalizedTranscriptRef.current += (finalizedTranscriptRef.current ? '  ·  ' : '') + transcript.text;
                // C5 Fix: Cap transcript to prevent unbounded memory growth in long sessions
                if (finalizedTranscriptRef.current.length > 5000) {
                    finalizedTranscriptRef.current = finalizedTranscriptRef.current.slice(-5000);
                }
                setRollingTranscript(finalizedTranscriptRef.current);
                // Update pill to show ONLY this final sentence (no accumulation)
                lastFinalSentenceRef.current = transcript.text;
                setLastFinalSentence(transcript.text);
                const questionTurnId = nextRequestId('question-turn');
                currentQuestionTurnIdRef.current = questionTurnId;
                setCurrentQuestionTurnId(questionTurnId);
                // Increment sentence ID so dot immediately resets to green for this new question
                setCurrentSentenceId(prev => {
                    const next = prev + 1;
                    currentSentenceIdRef.current = next;
                    return next;
                });
                recomputeIntentFromFinalTranscript(questionTurnId);

                // H6 Fix: Clear previous timer to prevent stacking
                if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
                speakingTimerRef.current = setTimeout(() => {
                    setIsInterviewerSpeaking(false);
                }, 3000);
            } else {
                // C6 Fix: Partial transcripts appended to finalized ref — no data loss
                setRollingTranscript(
                    finalizedTranscriptRef.current
                        + (finalizedTranscriptRef.current ? '  ·  ' : '')
                        + transcript.text
                );
            }
        }));

        // AI Suggestions from native audio (legacy)
        cleanups.push(window.electronAPI.onSuggestionProcessingStart(() => {
            setIsProcessing(true);
            setIsExpanded(true);
        }));

        cleanups.push(window.electronAPI.onSuggestionGenerated((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: data.suggestion
            }]);
        }));

        cleanups.push(window.electronAPI.onSuggestionError((err) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `Error: ${err.error}`
            }]);
        }));



        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {
            // V2 Guard: drop tokens from a previous session
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const intent = getSuggestedAnswerIntent(data.question);
            const requestId = resolveIntentRequestId(intent, data.requestId);
            if (!requestId) return;
            appendTokenToRequest(requestId, data.token);
        }));

        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
            // V2 Guard: drop final answers from a previous session
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            if (userHasScrolledRef.current) {
                setUnreadCount(prev => prev + 1);
            }
            const intent = getSuggestedAnswerIntent(data.question);
            const requestId = resolveIntentRequestId(intent, data.requestId);
            if (!requestId) return;
            clearProcessingForRequest(requestId);
            const chips = generateResponseChips(data.answer, intent);
            finalizeRequestMessage(requestId, data.answer, {
                chips: chips.length > 0 ? chips : undefined,
            });
            rememberIntentRequest(intent, null);
            currentSourceRef.current = undefined;
        }));

        // STREAMING: Refinement
        cleanups.push(window.electronAPI.onIntelligenceRefinedAnswerToken((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId(data.intent, data.requestId);
            if (!requestId) return;
            appendTokenToRequest(requestId, data.token);
        }));

        cleanups.push(window.electronAPI.onIntelligenceRefinedAnswer((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId(data.intent, data.requestId);
            if (!requestId) return;
            clearProcessingForRequest(requestId);
            const chips = generateResponseChips(data.answer, data.intent);
            finalizeRequestMessage(requestId, data.answer, {
                chips: chips.length > 0 ? chips : undefined,
            });
            rememberIntentRequest(data.intent, null);
            currentSourceRef.current = undefined;
        }));

        // STREAMING: Recap
        cleanups.push(window.electronAPI.onIntelligenceRecapToken((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId('recap', data.requestId);
            if (!requestId) return;
            appendTokenToRequest(requestId, data.token);
        }));

        cleanups.push(window.electronAPI.onIntelligenceRecap((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId('recap', data.requestId);
            if (!requestId) return;
            clearProcessingForRequest(requestId);
            const chips = generateResponseChips(data.summary, 'recap');
            finalizeRequestMessage(requestId, data.summary, {
                chips: chips.length > 0 ? chips : undefined,
            });
            rememberIntentRequest('recap', null);
            currentSourceRef.current = undefined;
        }));

        cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsToken((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId('follow_up_questions', data.requestId);
            if (!requestId) return;
            appendTokenToRequest(requestId, data.token);
        }));

        cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsUpdate((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId('follow_up_questions', data.requestId);
            if (!requestId) return;
            clearProcessingForRequest(requestId);
            const chips = generateResponseChips(data.questions, 'follow_up_questions');
            finalizeRequestMessage(requestId, data.questions, {
                chips: chips.length > 0 ? chips : undefined,
            });
            rememberIntentRequest('follow_up_questions', null);
            currentSourceRef.current = undefined;
        }));

        cleanups.push(window.electronAPI.onIntelligenceSystemDesignTradeoffsToken((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId('system_design_tradeoffs', data.requestId);
            if (!requestId) return;
            appendTokenToRequest(requestId, data.token);
        }));

        cleanups.push(window.electronAPI.onIntelligenceSystemDesignTradeoffs((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId('system_design_tradeoffs', data.requestId);
            if (!requestId) return;
            clearProcessingForRequest(requestId);
            const chips = generateResponseChips(data.answer, 'system_design_tradeoffs');
            finalizeRequestMessage(requestId, data.answer, {
                chips: chips.length > 0 ? chips : undefined,
            });
            rememberIntentRequest('system_design_tradeoffs', null);
            currentSourceRef.current = undefined;
        }));

        cleanups.push(window.electronAPI.onIntelligenceManualResult((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId('manual', data.requestId);
            if (!requestId) return;
            clearProcessingForRequest(requestId);
            finalizeRequestMessage(requestId, `🎯 **Answer:**\n\n${data.answer}`);
            rememberIntentRequest('manual', null);
            currentSourceRef.current = undefined;
        }));

        cleanups.push(window.electronAPI.onIntelligenceError((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            if (data.requestId) {
                clearProcessingForRequest(data.requestId);
                failRequestMessage(data.requestId, `❌ Error (${data.mode}): ${data.error}`);
                return;
            }
            if (activeUiRequestIdRef.current) {
                clearProcessingForRequest(activeUiRequestIdRef.current);
            }
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `❌ Error (${data.mode}): ${data.error}`
            }]);
        }));
        return () => cleanups.forEach(fn => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // C2 Fix: mount-only — listeners must survive expand/collapse to prevent dropped tokens

    // Stable mount-only effect for screenshot listeners.
    // These MUST NOT be inside the [isExpanded] effect — when a screenshot is
    // taken, `switchToOverlay` fires `ensure-expanded` which can flip isExpanded
    // from false→true, triggering the [isExpanded] effect cleanup. If `screenshot-taken`
    // arrives during that teardown gap the event is silently dropped (same issue
    // as clarify streaming listeners below). handleScreenshotAttach only uses stable
    // useState setters so a mount-only closure is safe here.
    useEffect(() => {
        const cleanupTaken = window.electronAPI.onScreenshotTaken(handleScreenshotAttach);
        const cleanupAttached = window.electronAPI.onScreenshotAttached?.(handleScreenshotAttach);
        return () => {
            cleanupTaken?.();
            cleanupAttached?.();
        };
    }, []);

    // Stable mount-only effect for clarify streaming listeners.
    // These MUST NOT be inside the [isExpanded] effect — if the user
    // expands/collapses the panel while a clarify stream is in-flight,
    // the [isExpanded] effect would tear down and re-register listeners,
    // orphaning the final 'clarify' event and leaving isProcessing=true forever.
    useEffect(() => {
        const cleanupToken = window.electronAPI.onIntelligenceClarifyToken((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId('clarify', data.requestId);
            if (!requestId) return;
            appendTokenToRequest(requestId, data.token);
        });

        const cleanupFinal = window.electronAPI.onIntelligenceClarify((data) => {
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const requestId = resolveIntentRequestId('clarify', data.requestId);
            if (!requestId) return;
            clearProcessingForRequest(requestId);
            const chips = generateResponseChips(data.clarification, 'clarify');
            finalizeRequestMessage(requestId, data.clarification, {
                chips: chips.length > 0 ? chips : undefined,
            });
            rememberIntentRequest('clarify', null);
            currentSourceRef.current = undefined;
        });

        return () => {
            cleanupToken();
            cleanupFinal();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // intentionally empty — these listeners must survive isExpanded changes

    // Quick Actions - Updated to use new Intelligence APIs

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        analytics.trackCopyAnswer();
        // Optional: Trigger a small toast or state change for visual feedback
    };

    const handleWhatToSay = async () => {
        await cancelInFlightOverlayRequests();
        setIsExpanded(true);
        currentSourceRef.current = 'What to Answer';
        analytics.trackCommandExecuted('what_to_say');
        const requestId = nextRequestId('what');
        markRequestProcessing(requestId);
        rememberIntentRequest('what_to_answer', requestId);

        // Capture and clear attached image context.
        // Also merge in any screenshot from the capture-and-process shortcut that
        // arrived via pendingCaptureRef before the React state flush (React 18 fix).
        const pending = pendingCaptureRef.current;
        // C4 Fix: Use ref for stable access instead of potentially stale closure
        let currentAttachments = attachedContextRef.current;
        if (pending && !currentAttachments.some(s => s.path === pending.path)) {
            currentAttachments = [...currentAttachments, pending].slice(-5);
        }

        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            // Show the attached image in chat
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'user',
                text: 'What should I say about this?',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0].preview
            }]);
            // Scroll to bottom when user sends message
            setTimeout(() => {
            	messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        }

        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent: 'what_to_answer',
            source: currentSourceRef.current,
            isStreaming: true,
        });

        try {
            // Pass imagePath if attached
            await window.electronAPI.generateWhatToSay(
                undefined,
                currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
                forceSystemDesignMode ? 'system_design' : undefined,
                requestId
            );
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleSystemDesignTradeoffs = async () => {
        await cancelInFlightOverlayRequests();
        setIsExpanded(true);
        currentSourceRef.current = 'System Design Trade-offs';
        analytics.trackCommandExecuted('system_design_tradeoffs');
        const requestId = nextRequestId('tradeoffs');
        markRequestProcessing(requestId);
        rememberIntentRequest('system_design_tradeoffs', requestId);
        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent: 'system_design_tradeoffs',
            source: currentSourceRef.current,
            isStreaming: true,
        });

        try {
            await window.electronAPI.generateSystemDesignTradeoffs(requestId);
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleFollowUp = async (intent: string = 'rephrase') => {
        await cancelInFlightOverlayRequests();
        setIsExpanded(true);
        currentSourceRef.current = 'Follow Up';
        analytics.trackCommandExecuted('follow_up_' + intent);
        const requestId = nextRequestId(intent);
        markRequestProcessing(requestId);
        rememberIntentRequest(intent, requestId);
        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent,
            source: currentSourceRef.current,
            isStreaming: true,
        });

        try {
            await window.electronAPI.generateFollowUp(intent, undefined, requestId);
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleRecap = async () => {
        await cancelInFlightOverlayRequests();
        setIsExpanded(true);
        currentSourceRef.current = 'Recap';
        analytics.trackCommandExecuted('recap');
        const requestId = nextRequestId('recap');
        markRequestProcessing(requestId);
        rememberIntentRequest('recap', requestId);
        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent: 'recap',
            source: currentSourceRef.current,
            isStreaming: true,
        });

        try {
            await window.electronAPI.generateRecap(requestId);
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleFollowUpQuestions = async () => {
        await cancelInFlightOverlayRequests();
        setIsExpanded(true);
        currentSourceRef.current = 'Follow Up Questions';
        analytics.trackCommandExecuted('suggest_questions');
        const requestId = nextRequestId('followup-questions');
        markRequestProcessing(requestId);
        rememberIntentRequest('follow_up_questions', requestId);
        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent: 'follow_up_questions',
            source: currentSourceRef.current,
            isStreaming: true,
        });

        try {
            await window.electronAPI.generateFollowUpQuestions(requestId);
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleClarify = async () => {
        await cancelInFlightOverlayRequests();
        setIsExpanded(true);
        currentSourceRef.current = 'Clarify';
        analytics.trackCommandExecuted('clarify');
        const requestId = nextRequestId('clarify');
        markRequestProcessing(requestId);
        rememberIntentRequest('clarify', requestId);
        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent: 'clarify',
            source: currentSourceRef.current,
            isStreaming: true,
        });

        try {
            await window.electronAPI.generateClarify(requestId);
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleCodeHint = async () => {
        await cancelInFlightOverlayRequests();
        setIsExpanded(true);
        currentSourceRef.current = 'Code Hint';
        analytics.trackCommandExecuted('code_hint');
        const requestId = nextRequestId('code-hint');
        markRequestProcessing(requestId);
        rememberIntentRequest('code_hint', requestId);

        const currentAttachments = attachedContextRef.current;
        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            // Show the attached image in chat
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'user',
                text: 'Give me a code hint for this',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0].preview
            }]);
        	// Scroll to bottom when user sends message
        	setTimeout(() => {
        		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        }

        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent: 'code_hint',
            source: currentSourceRef.current,
            isStreaming: true,
        });

        try {
            await window.electronAPI.generateCodeHint(currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined, undefined, requestId);
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleBrainstorm = async () => {
        await cancelInFlightOverlayRequests();
        setIsExpanded(true);
        currentSourceRef.current = 'Brainstorm';
        analytics.trackCommandExecuted('brainstorm');
        const requestId = nextRequestId('brainstorm');
        markRequestProcessing(requestId);
        rememberIntentRequest('brainstorm', requestId);

        const currentAttachments = attachedContextRef.current;
        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            // Show the attached image in chat
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'user',
                text: 'Brainstorm with this context',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0].preview
            }]);
        	// Scroll to bottom when user sends message
        	setTimeout(() => {
        		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        }

        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent: 'brainstorm',
            source: currentSourceRef.current,
            isStreaming: true,
        });

        try {
            await window.electronAPI.generateBrainstorm(currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined, undefined, requestId);
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };


    // Setup Streaming Listeners
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        // Stream Token
        cleanups.push(window.electronAPI.onGeminiStreamToken((payload) => {
            const token = typeof payload === 'string' ? payload : payload.token;
            const requestId = typeof payload === 'string' ? activeChatRequestIdRef.current : (payload.requestId || activeChatRequestIdRef.current);
            if (!requestId) return;
            // Guard: if this token is the negotiation coaching JSON sentinel, accumulate it
            // silently. The JSON is always emitted as a single complete `yield JSON.stringify(...)`
            // call, so one parse attempt is sufficient. The onGeminiStreamDone handler will
            // detect the accumulated JSON and render the proper card UI — we just prevent the
            // raw JSON characters from ever appearing in the chat bubble.
            try {
                const parsed = JSON.parse(token);
                if (parsed?.__negotiationCoaching) {
                    // Store the raw JSON text (Done handler needs it) but don't show it.
                    setMessages(prev => {
                        const idx = prev.findIndex(msg => msg.requestId === requestId);
                        if (idx >= 0) {
                            const updated = [...prev];
                            updated[idx] = { ...updated[idx], text: token };
                            return updated;
                        }
                        return prev;
                    });
                    return; // Skip the normal append below
                }
            } catch {
                // Not JSON — normal text token, fall through to the standard append.
            }

            appendTokenToRequest(requestId, token);
        }));

        // Stream Done
        cleanups.push(window.electronAPI.onGeminiStreamDone((payload) => {
            const requestId = payload?.requestId || activeChatRequestIdRef.current;
            if (!requestId) return;
            clearProcessingForRequest(requestId);
            currentSourceRef.current = undefined;
            activeChatRequestIdRef.current = null;

            // Calculate latency if we have a start time
            let latency = 0;
            if (requestStartTimeRef.current) {
                latency = Date.now() - requestStartTimeRef.current;
                requestStartTimeRef.current = null;
            }

            // C3 Fix: Use ref to capture correct model without re-registering listeners
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
                        updateRequestLifecycle(requestId, { status: 'completed' });
                        const coaching = parsed.__negotiationCoaching;
                        const updated = [...prev];
                        updated[idx] = {
                            ...lastMsg,
                            isStreaming: false,
                            isNegotiationCoaching: true,
                            negotiationCoachingData: coaching,
                            text: '',
                        };
                        return updated;
                    }
                } catch {}
                return prev;
            });
            setMessages(prev => {
                const idx = prev.findIndex(msg => msg.requestId === requestId);
                const lastMsg = idx >= 0 ? prev[idx] : null;
                const lifecycle = requestRegistryRef.current[requestId];
                if (!lastMsg || lifecycle?.status !== 'streaming') return prev;
                const chips = generateResponseChips(lastMsg.text, lastMsg.intent);
                updateRequestLifecycle(requestId, { status: 'completed' });
                const updated = [...prev];
                updated[idx] = {
                    ...lastMsg,
                    isStreaming: false,
                    chips: chips.length > 0 ? chips : undefined,
                };
                return updated;
            });
        }));

        // Stream Error
        cleanups.push(window.electronAPI.onGeminiStreamError((payload) => {
            const error = typeof payload === 'string' ? payload : payload.error;
            const requestId = typeof payload === 'string' ? activeChatRequestIdRef.current : (payload.requestId || activeChatRequestIdRef.current);
            if (!requestId) return;
            clearProcessingForRequest(requestId);
            requestStartTimeRef.current = null; // Clear timer on error
            activeChatRequestIdRef.current = null;
            failRequestMessage(requestId, `❌ Error: ${error}`);
        }));

        // JIT RAG Stream listeners (for live meeting RAG responses)
        if (window.electronAPI.onRAGStreamChunk) {
            cleanups.push(window.electronAPI.onRAGStreamChunk((data: { chunk: string; requestId?: string }) => {
                const requestId = data.requestId || activeRagRequestIdRef.current;
                if (!requestId) return;
                // Same guard as onGeminiStreamToken: suppress raw JSON if this chunk is
                // the negotiation coaching sentinel. The onRAGStreamComplete handler will
                // convert it to the proper card UI.
                try {
                    const parsed = JSON.parse(data.chunk);
                    if (parsed?.__negotiationCoaching) {
                        setMessages(prev => {
                            const idx = prev.findIndex(msg => msg.requestId === requestId);
                            if (idx >= 0) {
                                const updated = [...prev];
                                updated[idx] = { ...updated[idx], text: data.chunk };
                                return updated;
                            }
                            return prev;
                        });
                        return; // Skip normal append
                    }
                } catch {
                    // Normal text chunk — fall through.
                }

                appendTokenToRequest(requestId, data.chunk);
            }));
        }

        if (window.electronAPI.onRAGStreamComplete) {
            cleanups.push(window.electronAPI.onRAGStreamComplete((data) => {
                const requestId = data.requestId || activeRagRequestIdRef.current;
                if (!requestId) return;
                clearProcessingForRequest(requestId);
                requestStartTimeRef.current = null;
                currentSourceRef.current = undefined;
                activeRagRequestIdRef.current = null;
                activeChatRequestIdRef.current = null;
                setMessages(prev => {
                    const idx = prev.findIndex(msg => msg.requestId === requestId);
                    const lastMsg = idx >= 0 ? prev[idx] : null;
                    if (!lastMsg || !lastMsg.isStreaming || lastMsg.role !== 'system') return prev;
                    try {
                        const parsed = JSON.parse(lastMsg.text);
                        if (parsed?.__negotiationCoaching) {
                            updateRequestLifecycle(requestId, { status: 'completed' });
                            const coaching = parsed.__negotiationCoaching;
                            const updated = [...prev];
                            updated[idx] = {
                                ...lastMsg,
                                isStreaming: false,
                                isNegotiationCoaching: true,
                                negotiationCoachingData: coaching,
                                text: '',
                            };
                            return updated;
                        }
                    } catch {}
                    return prev;
                });
                setMessages(prev => {
                    const idx = prev.findIndex(msg => msg.requestId === requestId);
                    const lastMsg = idx >= 0 ? prev[idx] : null;
                    const lifecycle = requestRegistryRef.current[requestId];
                    if (!lastMsg || lifecycle?.status !== 'streaming') return prev;
                    const chips = generateResponseChips(lastMsg.text, lastMsg.intent);
                    updateRequestLifecycle(requestId, { status: 'completed' });
                    const updated = [...prev];
                    updated[idx] = {
                        ...lastMsg,
                        isStreaming: false,
                        chips: chips.length > 0 ? chips : undefined,
                    };
                    return updated;
                });
            }));
        }

        if (window.electronAPI.onRAGStreamError) {
            cleanups.push(window.electronAPI.onRAGStreamError((data: { error: string; requestId?: string }) => {
                const requestId = data.requestId || activeRagRequestIdRef.current;
                if (!requestId) return;
                clearProcessingForRequest(requestId);
                requestStartTimeRef.current = null;
                activeRagRequestIdRef.current = null;
                activeChatRequestIdRef.current = null;
                failRequestMessage(requestId, `[RAG Error: ${data.error}]`);
            }));
        }

        return () => cleanups.forEach(fn => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // C3 Fix: mount-only — model captured via ref, prevents listener teardown mid-stream


    const handleAnswerNow = async () => {
        if (isManualRecording) {
            await cancelInFlightOverlayRequests();
            // Stop recording - send accumulated voice input to Gemini
            isRecordingRef.current = false;  // Update ref immediately
            setIsManualRecording(false);
            setManualTranscript('');  // Clear live preview
            currentSourceRef.current = 'Answer Now';

            // Send manual finalization signal to STT Providers
            window.electronAPI.finalizeMicSTT().catch(err => console.error('[NativelyInterface] Failed to send finalizeMicSTT:', err));

            const currentAttachments = attachedContextRef.current;
            setAttachedContext([]); // Clear context immediately on send

            const question = (voiceInputRef.current + (manualTranscriptRef.current ? ' ' + manualTranscriptRef.current : '')).trim();
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            manualTranscriptRef.current = '';

            if (!question && currentAttachments.length === 0) {
                // No voice input and no image — show real STT error if available
                if (sttUserStatus === 'failed' && sttUserError) {
                    setMessages(prev => [...prev, {
                        id: nextMsgId(),
                        role: 'system',
                        text: `❌ STT Error: ${sttUserError}`
                    }]);
                } else if (sttUserStatus === 'reconnecting') {
                    setMessages(prev => [...prev, {
                        id: nextMsgId(),
                        role: 'system',
                        text: '⏳ STT is reconnecting, try again in a moment.'
                    }]);
                } else {
                    setMessages(prev => [...prev, {
                        id: nextMsgId(),
                        role: 'system',
                        text: '⚠️ No speech detected. Try speaking closer to your microphone.'
                    }]);
                }
                return;
            }

            // Show user's spoken question
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'user',
                text: question,
                hasScreenshot: currentAttachments.length > 0,
                screenshotPreview: currentAttachments[0]?.preview
            }]);
            
            // Scroll to bottom when user sends message
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);

            // Add placeholder for streaming response
            const requestId = nextRequestId('answer-now');
            activeChatRequestIdRef.current = requestId;
            activeRagRequestIdRef.current = requestId;
            beginStreamingMessage(requestId, {
                role: 'system',
                text: '',
                isStreaming: true,
                source: currentSourceRef.current,
            });

            markRequestProcessing(requestId);

            try {
                let prompt = '';

                if (currentAttachments.length > 0) {
                    // Image + Voice Context
                    prompt = `You are a helper. The user has provided a screenshot and a spoken question/command.
User said: "${question}"

Instructions:
1. Analyze the screenshot in the context of what the user said.
2. Answer directly in at most 4 short bullet points.
3. Keep the answer under 120 words.
4. No preamble or filler.`;
                } else {
                    // JIT RAG pre-flight: try to use indexed meeting context first
                    const ragResult = await window.electronAPI.ragQueryLive?.(question, requestId);
                    if (ragResult?.success) {
                        // JIT RAG handled it — response streamed via rag:stream-chunk events
                        return;
                    }
                    activeRagRequestIdRef.current = null;

                    // Voice Only — direct answer, adaptive formatting
                    prompt = `Answer directly. Keep the response short.
- Coding: one clean code block, then at most 2 short bullets.
- Concept/definition: 3-5 short bullets max.
- How-to: 3-5 concise numbered steps max.
- Short factual: 1-2 sentences max.
Hard limit: under 120 words unless code is required.
No preamble. No meta-commentary. Start with the answer immediately.`;
                }

                // Call Streaming API: message = question, context = instructions
                requestStartTimeRef.current = Date.now();
                await window.electronAPI.streamGeminiChat(question, currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined, prompt, { skipSystemPrompt: true, ignoreKnowledgeMode: true, requestId });

            } catch (err) {
                // Initial invocation failing (e.g. IPC error before stream starts)
                clearProcessingForRequest(requestId);
                activeChatRequestIdRef.current = null;
                activeRagRequestIdRef.current = null;
                failRequestMessage(requestId, `❌ Error starting stream: ${err}`);
            }
        } else {
            // Start recording - reset voice input state
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            isRecordingRef.current = true;  // Update ref immediately
            setIsManualRecording(true);
            // O3 Fix: Removed dead try/catch — native audio is managed by main process
        }
    };

    const handleManualSubmit = async () => {
        if (!inputValue.trim() && attachedContextRef.current.length === 0) return;
        await cancelInFlightOverlayRequests();
        currentSourceRef.current = 'Manual Input';

        const userText = inputValue;
        const currentAttachments = attachedContextRef.current;

        // Clear inputs immediately
        setInputValue('');
        setAttachedContext([]);

        setMessages(prev => [...prev, {
            id: nextMsgId(),
            role: 'user',
            text: userText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : ''),
            hasScreenshot: currentAttachments.length > 0,
            screenshotPreview: currentAttachments[0]?.preview
        }]);

        // Scroll to bottom when user sends message
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        // Add placeholder for streaming response
        const requestId = nextRequestId('manual');
        activeChatRequestIdRef.current = requestId;
        activeRagRequestIdRef.current = requestId;
        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            isStreaming: true,
            source: currentSourceRef.current
        });

        setIsExpanded(true);
        markRequestProcessing(requestId);

        try {
            // JIT RAG pre-flight: try to use indexed meeting context first
            if (currentAttachments.length === 0) {
                const ragResult = await window.electronAPI.ragQueryLive?.(userText || '', requestId);
                if (ragResult?.success) {
                    // JIT RAG handled it — response streamed via rag:stream-chunk events
                    return;
                }
            }
            activeRagRequestIdRef.current = null;

            // Pass imagePath if attached, AND conversation context
            requestStartTimeRef.current = Date.now();
            const streamContext = [
                conversationContext.trim(),
                finalizedTranscriptRef.current.slice(-700),
                'RESPONSE RULES:\n- 3-5 bullets max when listing items.\n- Keep the answer under 120 words unless code is required.\n- No preamble.'
            ].filter(Boolean).join('\n') || undefined;
            await window.electronAPI.streamGeminiChat(
                userText || 'Analyze this screenshot',
                currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
                streamContext,
                { requestId }
            );
        } catch (err) {
            clearProcessingForRequest(requestId);
            activeChatRequestIdRef.current = null;
            activeRagRequestIdRef.current = null;
            failRequestMessage(requestId, `❌ Error starting stream: ${err}`);
        }
    };

    const clearChat = () => {
        setMessages([]);
    };




    const renderMessageText = (msg: Message) => {
        // Negotiation coaching card takes priority
        if (msg.isNegotiationCoaching && msg.negotiationCoachingData) {
            return (
                <NegotiationCoachingCard
                    {...msg.negotiationCoachingData}
                    phase={msg.negotiationCoachingData.phase as any}
                    onSilenceTimerEnd={() => {
                        setMessages(prev => prev.map(m =>
                            m.id === msg.id
                                ? { ...m, negotiationCoachingData: m.negotiationCoachingData ? { ...m.negotiationCoachingData, showSilenceTimer: false } : undefined }
                                : m
                        ));
                    }}
                />
            );
        }

        // Code-containing messages get special styling
        // We split by code blocks to keep the "Code Solution" UI intact for the code parts
        // But use ReactMarkdown for the text parts around it
        if (msg.isCode || (msg.role === 'system' && msg.text.includes('```'))) {
            const parts = msg.text.split(/(```[\s\S]*?```)/g);
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-violet-600' : 'text-purple-300'}`}>
                        <Code className="w-3.5 h-3.5" />
                        <span>Code Solution</span>
                    </div>
                    <div className={`space-y-2 text-[13px] leading-relaxed ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        {parts.map((part, i) => {
                            if (part.startsWith('```')) {
                                const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
                                if (match) {
                                    const lang = match[1] || 'python';
                                    const code = match[2].trim();
                                    return (
                                        <div key={i} className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`} style={appearance.codeBlockStyle}>
                                            {/* Minimalist Apple Header */}
                                            <div className={`px-3 py-1.5 border-b ${codeHeaderClass}`} style={appearance.codeHeaderStyle}>
                                                <span className={`text-[10px] uppercase tracking-widest font-semibold font-mono ${codeHeaderTextClass}`}>
                                                    {lang || 'CODE'}
                                                </span>
                                            </div>
                                            <div className="bg-transparent">
                                                <SyntaxHighlighter
                                                    language={lang}
                                                    style={codeTheme}
                                                    customStyle={{
                                                        margin: 0,
                                                        borderRadius: 0,
                                                        fontSize: '13px',
                                                        lineHeight: '1.6',
                                                        background: 'transparent',
                                                        padding: '16px',
                                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                    }}
                                                    wrapLongLines={true}
                                                    showLineNumbers={true}
                                                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: codeLineNumberColor, textAlign: 'right', fontSize: '11px' }}
                                                >
                                                    {code}
                                                </SyntaxHighlighter>
                                            </div>
                                        </div>
                                    );
                                }
                            }
                            // Regular text - Render with Markdown
                            return (
                                <div key={i} className="markdown-content">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                                            strong: ({ node, ...props }: any) => <strong className="font-bold overlay-text-strong" {...props} />,
                                            em: ({ node, ...props }: any) => <em className="italic overlay-text-secondary" {...props} />,
                                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                            ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                                            h1: ({ node, ...props }: any) => <h1 className="text-lg font-bold mb-2 mt-3 overlay-text-strong" {...props} />,
                                            h2: ({ node, ...props }: any) => <h2 className="text-base font-bold mb-2 mt-3 overlay-text-strong" {...props} />,
                                            h3: ({ node, ...props }: any) => <h3 className="text-sm font-bold mb-1 mt-2 overlay-text-primary" {...props} />,
                                            code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono whitespace-pre-wrap ${isLightTheme ? 'text-violet-700' : 'text-purple-200'}`} {...props} />,
                                            blockquote: ({ node, ...props }: any) => <blockquote className={`border-l-2 pl-3 italic my-2 ${isLightTheme ? 'border-violet-500/30 text-slate-600' : 'border-purple-500/50 text-slate-400'}`} {...props} />,
                                            a: ({ node, ...props }: any) => <a className={`hover:underline ${isLightTheme ? 'text-blue-600 hover:text-blue-700' : 'text-blue-400 hover:text-blue-300'}`} target="_blank" rel="noopener noreferrer" {...props} />,
                                        }}
                                    >
                                        {part}
                                    </ReactMarkdown>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // Custom Styled Labels (Shorten, Recap, Follow-up) - also use Markdown for content
        if (msg.intent === 'shorten') {
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-cyan-700' : 'text-cyan-300'}`}>
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Shortened</span>
                    </div>
                    <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-cyan-800' : 'text-cyan-100'}`} {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        }}>
                            {msg.text}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (msg.intent === 'recap') {
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-indigo-700' : 'text-indigo-300'}`}>
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Recap</span>
                    </div>
                    <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-indigo-800' : 'text-indigo-100'}`} {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        }}>
                            {msg.text}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (msg.intent === 'follow_up_questions') {
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-amber-700' : 'text-[#FFD60A]'}`}>
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>Follow-Up Questions</span>
                    </div>
                    <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-amber-800' : 'text-[#FFF9C4]'}`} {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        }}>
                            {msg.text}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (msg.intent === 'what_to_answer') {
            // Split text by code blocks (Handle unclosed blocks at EOF)
            const parts = msg.text.split(/(```[\s\S]*?(?:```|$))/g);

            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className="flex items-center gap-2 mb-2 text-emerald-400 font-semibold text-xs uppercase tracking-wide">
                        <span>Say this</span>
                    </div>
                    <div className="text-[14px] leading-relaxed overlay-text-primary">
                        {parts.map((part, i) => {
                            if (part.startsWith('```')) {
                                // Robust matching: handles unclosed blocks for streaming (```...$)
                                const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);

                                // Fallback logic: if it starts with ticks, treat as code (even if unclosed)
                                if (match || part.startsWith('```')) {
                                    const lang = (match && match[1]) ? match[1] : 'python';
                                    let code = '';

                                    if (match && match[2]) {
                                        code = match[2].trim();
                                    } else {
                                        // Manual strip if regex failed
                                        code = part.replace(/^```\w*\s*/, '').replace(/```$/, '').trim();
                                    }

                                    return (
                                        <div key={i} className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`} style={appearance.codeBlockStyle}>
                                            {/* Minimalist Apple Header */}
                                            <div className={`px-3 py-1.5 border-b ${codeHeaderClass}`} style={appearance.codeHeaderStyle}>
                                                <span className={`text-[10px] uppercase tracking-widest font-semibold font-mono ${codeHeaderTextClass}`}>
                                                    {lang || 'CODE'}
                                                </span>
                                            </div>

                                            <div className="bg-transparent">
                                                <SyntaxHighlighter
                                                    language={lang}
                                                    style={codeTheme}
                                                    customStyle={{
                                                        margin: 0,
                                                        borderRadius: 0,
                                                        fontSize: '13px',
                                                        lineHeight: '1.6',
                                                        background: 'transparent',
                                                        padding: '16px',
                                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                    }}
                                                    wrapLongLines={true}
                                                    showLineNumbers={true}
                                                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: codeLineNumberColor, textAlign: 'right', fontSize: '11px' }}
                                                >
                                                    {code}
                                                </SyntaxHighlighter>
                                            </div>
                                        </div>
                                    );
                                }
                            }
                            // Regular text - Render Markdown
                            return (
                                <div key={i} className="markdown-content">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-emerald-700' : 'text-emerald-100'}`} {...props} />,
                                            em: ({ node, ...props }: any) => <em className={`italic ${isLightTheme ? 'text-emerald-700/80' : 'text-emerald-200/80'}`} {...props} />,
                                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                            ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                                        }}
                                    >
                                        {part}
                                    </ReactMarkdown>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // Standard Text Messages (e.g. from User or Interviewer)
        // We still want basic markdown support here too
        return (
            <div className="markdown-content">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                        p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                        strong: ({ node, ...props }: any) => <strong className="font-bold opacity-100 overlay-text-strong" {...props} />,
                        em: ({ node, ...props }: any) => <em className="italic opacity-90 overlay-text-secondary" {...props} />,
                        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                        ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono ${isLightTheme ? 'text-slate-800' : ''}`} {...props} />,
                        a: ({ node, ...props }: any) => <a className="underline hover:opacity-80" target="_blank" rel="noopener noreferrer" {...props} />,
                    }}
                >
                    {msg.text}
                </ReactMarkdown>
            </div>
        );
    };


    // We use a ref to hold the latest handlers to avoid re-binding the event listener on every render
    const handlersRef = useRef({
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm
    });

    // Update ref on every render so the event listener always access latest state/props
    handlersRef.current = {
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const { handleWhatToSay, handleFollowUp, handleFollowUpQuestions, handleRecap, handleAnswerNow, handleClarify, handleCodeHint, handleBrainstorm } = handlersRef.current;

            // Chat Shortcuts (Scope: Local to Chat/Overlay usually, but we allow them here if focused)
            if (isShortcutPressed(e, 'whatToAnswer')) {
                e.preventDefault();
                handleWhatToSay();
            } else if (isShortcutPressed(e, 'clarify')) {
                e.preventDefault();
                handleClarify();
            } else if (isShortcutPressed(e, 'followUp')) {
                e.preventDefault();
                handleFollowUpQuestions();
            } else if (isShortcutPressed(e, 'dynamicAction4')) {
                e.preventDefault();
                if (actionButtonMode === 'brainstorm') {
                    handleBrainstorm();
                } else {
                    handleRecap();
                }
            } else if (isShortcutPressed(e, 'answer')) {
                e.preventDefault();
                handleAnswerNow();
            } else if (isShortcutPressed(e, 'codeHint')) {
                e.preventDefault();
                handleCodeHint();
            } else if (isShortcutPressed(e, 'brainstorm')) {
                e.preventDefault();
                handleBrainstorm();
            } else if (isShortcutPressed(e, 'scrollUp')) {
                e.preventDefault();
                scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' });
            } else if (isShortcutPressed(e, 'scrollDown')) {
                e.preventDefault();
                scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
            } else if (isShortcutPressed(e, 'moveWindowUp') || isShortcutPressed(e, 'moveWindowDown')) {
                // Prevent default scrolling when moving window
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isShortcutPressed]);

    // General Global Shortcuts (Rebindable)
    // We listen here to handle them when the window is focused (renderer side)
    // Global shortcuts (when window blurred) are handled by Main process -> GlobalShortcuts
    // But Main process events might not reach here if we don't listen, or we want unified handling.
    // Actually, KeybindManager registers global shortcuts. If they are registered as global, 
    // Electron might consume them before they reach here?
    // 'toggle-app' is Global.
    // 'toggle-visibility' is NOT Global in default config (isGlobal: false), so it depends on focus.
    // So we MUST listen for them here.

    // A2 Fix: Single definition — useRef initializer is just the first value, update on every render below
    const generalHandlersRef = useRef({} as {
        toggleVisibility: () => void;
        processScreenshots: () => void;
        resetCancel: () => Promise<void>;
        toggleMousePassthrough: () => void;
        takeScreenshot: () => Promise<void>;
        selectiveScreenshot: () => Promise<void>;
    });

    // Update ref on every render so event listeners always access latest state/props
    generalHandlersRef.current = {
        toggleVisibility: () => window.electronAPI.toggleWindow(),
        processScreenshots: handleWhatToSay,
        resetCancel: async () => {
            if (isProcessing) {
                await cancelInFlightOverlayRequests();
            } else {
                await window.electronAPI.resetIntelligence();
                setMessages([]);
                setAttachedContext([]);
                setInputValue('');
            }
        },
        // C7 Fix: Use functional update to prevent stale isMousePassthrough
        toggleMousePassthrough: () => {
            setIsMousePassthrough(prev => {
                const newState = !prev;
                window.electronAPI?.setOverlayMousePassthrough?.(newState);
                return newState;
            });
        },
        takeScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeScreenshot();
                if (data && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering screenshot:", err);
            }
        },
        selectiveScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeSelectiveScreenshot();
                if (data && !data.cancelled && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering selective screenshot:", err);
            }
        }
    };

    useEffect(() => {
        const handleGeneralKeyDown = (e: KeyboardEvent) => {
            const handlers = generalHandlersRef.current;
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (isShortcutPressed(e, 'toggleVisibility')) {
                // Always allow toggling visibility
                e.preventDefault();
                handlers.toggleVisibility();
            } else if (isShortcutPressed(e, 'processScreenshots')) {
                if (!isInput) {
                    e.preventDefault();
                    handlers.processScreenshots();
                }
                // If input focused, let default behavior (Enter) happen or handle it via onKeyDown in Input
            } else if (isShortcutPressed(e, 'resetCancel')) {
                e.preventDefault();
                handlers.resetCancel();
            } else if (isShortcutPressed(e, 'takeScreenshot')) {
                e.preventDefault();
                handlers.takeScreenshot();
            } else if (isShortcutPressed(e, 'selectiveScreenshot')) {
                e.preventDefault();
                handlers.selectiveScreenshot();
            } else if (isShortcutPressed(e, 'toggleMousePassthrough')) {
                e.preventDefault();
                handlers.toggleMousePassthrough();
            }
        };

        window.addEventListener('keydown', handleGeneralKeyDown);
        return () => window.removeEventListener('keydown', handleGeneralKeyDown);
    }, [isShortcutPressed]);

    // Global "Capture & Process" shortcut handler (issue #90)
    // Registered separately so it always has the latest handlersRef via stable ref access.
    // Main process takes the screenshot and sends "capture-and-process" with path+preview;
    // we attach the screenshot to context and immediately trigger AI analysis.
    useEffect(() => {
        if (!window.electronAPI.onCaptureAndProcess) return;
        const unsubscribe = window.electronAPI.onCaptureAndProcess((data) => {
            setIsExpanded(true);

            // Store screenshot in a stable ref BEFORE updating React state.
            // This fixes the React 18 concurrent mode timing race where setTimeout(0)
            // could fire before setAttachedContext had flushed, leaving handleWhatToSay
            // with an empty attachedContext and causing silent failures.
            pendingCaptureRef.current = data;

            setAttachedContext(prev => {
                if (prev.some(s => s.path === data.path)) return prev;
                return [...prev, data].slice(-5);
            });

            // Use requestAnimationFrame so we wait for at least one paint cycle —
            // more reliable than setTimeout(0) under React 18 concurrent scheduling.
            // The ref guarantees handleWhatToSay has the screenshot regardless of
            // whether the state update has flushed yet.
            requestAnimationFrame(() => {
                try {
                    handlersRef.current.handleWhatToSay();
                } finally {
                    pendingCaptureRef.current = null;
                }
            });
        });
        return unsubscribe;
    }, []);

    // Stealth Global Shortcuts Handler
    // Listens for shortcuts triggered when the app is in the background
    useEffect(() => {
        if (!window.electronAPI.onGlobalShortcut) return;
        const unsubscribe = window.electronAPI.onGlobalShortcut(({ action }) => {
            const handlers = handlersRef.current;
            const generalHandlers = generalHandlersRef.current;

            isStealthRef.current = true;

            if (action === 'whatToAnswer') handlers.handleWhatToSay();
            else if (action === 'shorten') handlers.handleFollowUp('shorten');
            else if (action === 'followUp') handlers.handleFollowUpQuestions();
            else if (action === 'recap') handlers.handleRecap();
            else if (action === 'dynamicAction4') {
                // M6 Fix: Use ref to avoid stale closure from [] deps
                if (actionButtonModeRef.current === 'brainstorm') handlers.handleBrainstorm();
                else handlers.handleRecap();
            }
            else if (action === 'answer') handlers.handleAnswerNow();
            else if (action === 'clarify') handlers.handleClarify();
            else if (action === 'codeHint') handlers.handleCodeHint();
            else if (action === 'brainstorm') handlers.handleBrainstorm();
            else if (action === 'scrollUp') scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' });
            else if (action === 'scrollDown') scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
            else if (action === 'processScreenshots') generalHandlers.processScreenshots();
            else if (action === 'resetCancel') generalHandlers.resetCancel();
            else if (action === 'takeScreenshot') generalHandlers.takeScreenshot();
            else if (action === 'selectiveScreenshot') generalHandlers.selectiveScreenshot();
            
            // Safety reset if it didn't trigger an expansion
            setTimeout(() => { isStealthRef.current = false; }, 500);
        });
        return unsubscribe;
    }, []);

    // ── Derived STT status for the rolling transcript indicator (interviewer channel) ──
    const interviewerSttIndicatorStatus = sttInterviewerStatus;
    // Strip consecutive error count from display — show only in expanded diagnostics
    const interviewerSttIndicatorError = sttInterviewerError?.replace(/\s*\(\d+ consecutive errors\):?/gi, '');

    const copyDiagnostics = async () => {
        const version = import.meta.env.VITE_APP_VERSION || 'unknown';
        const [arch, osVersion] = await Promise.all([
            window.electronAPI?.getArch?.().catch(() => 'unknown'),
            window.electronAPI?.getOsVersion?.().catch(() => 'unknown'),
        ]);
        const { categorizeSttError } = await import('../lib/sttErrorMapper');
        const userCat = sttUserError ? categorizeSttError(sttUserError) : null;
        const interviewerCat = sttInterviewerError ? categorizeSttError(sttInterviewerError) : null;
        const report = [
            '## STT Diagnostic Report',
            `App Version: ${version}`,
            `Platform: ${osVersion} (${arch})`,
            `---`,
            `Microphone Provider: ${sttUserProvider}`,
            `Microphone Status: ${sttUserStatus}`,
            `Microphone Active Provider: ${sttMetrics.user?.activeProvider || 'inactive'}`,
            `Microphone Fallback Event: ${sttTelemetry.user?.type || 'N/A'}`,
            `Microphone Failovers: ${sttMetrics.user?.failoverCount ?? 0}`,
            `Microphone Transcripts/sec: ${sttMetrics.user?.transcriptsPerSecond ?? 0}`,
            userCat ? `Microphone Category: ${userCat.title} [${userCat.category}]` : '',
            `Microphone Error: ${sttUserError || 'N/A'}`,
            `---`,
            `System Audio Provider: ${sttInterviewerProvider}`,
            `System Audio Status: ${sttInterviewerStatus}`,
            `System Active Provider: ${sttMetrics.interviewer?.activeProvider || 'inactive'}`,
            `System Fallback Event: ${sttTelemetry.interviewer?.type || 'N/A'}`,
            `System Failovers: ${sttMetrics.interviewer?.failoverCount ?? 0}`,
            `System Transcripts/sec: ${sttMetrics.interviewer?.transcriptsPerSecond ?? 0}`,
            interviewerCat ? `System Audio Category: ${interviewerCat.title} [${interviewerCat.category}]` : '',
            `System Audio Error: ${sttInterviewerError || 'N/A'}`,
            `Timestamp: ${new Date().toISOString()}`,
        ].filter(Boolean).join('\n');
        try {
            await navigator.clipboard.writeText(report);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = report;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
    };

    return (
        <div ref={contentRef} className="flex flex-col items-center w-fit mx-auto h-fit min-h-0 bg-transparent p-0 rounded-[24px] font-sans gap-2 overlay-text-primary">

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="flex flex-col items-center gap-2 w-full"
                    >
                        <TopPill
                            expanded={isExpanded}
                            onToggle={() => setIsExpanded(!isExpanded)}
                            onQuit={() => onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp()}
                            appearance={appearance}
                            onLogoClick={() => window.electronAPI?.setWindowMode?.('launcher')}
                        />
                        <div
                            className={`relative w-[600px] max-w-full backdrop-blur-2xl border-l border-r border-b rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
                            style={{ 
                                ...appearance.shellStyle, 
                                borderLeftColor: 'rgba(245, 158, 11, 0.2)',
                                borderRightColor: 'rgba(245, 158, 11, 0.2)',
                                borderBottomColor: 'rgba(245, 158, 11, 0.2)'
                            }}
                        >
                            {/* Constant Amber Line with Colliding Shines */}
                            <div className="absolute top-0 left-0 w-full h-[3px] bg-[#F59E0B]/30 z-[100] rounded-t-[24px] overflow-hidden">
                                {/* Left Shine */}
                                <motion.div 
                                    key="left-shine-slow"
                                    animate={{ left: ['-50%', '30%', '-50%'] }}
                                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                                    className="absolute top-0 h-full w-[40%] bg-gradient-to-r from-transparent via-[#F59E0B] to-transparent"
                                    style={{ boxShadow: '0 0 10px rgba(245,158,11,0.8)' }}
                                />
                                {/* Right Shine */}
                                <motion.div 
                                    key="right-shine-slow"
                                    animate={{ right: ['-50%', '30%', '-50%'] }}
                                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                                    className="absolute top-0 h-full w-[40%] bg-gradient-to-l from-transparent via-[#F59E0B] to-transparent"
                                    style={{ boxShadow: '0 0 10px rgba(245,158,11,0.8)' }}
                                />
                            </div>




                            {/* System Audio Permission Warning Banner */}
                            {systemAudioWarning && (
                                <div className="flex items-center justify-between mx-4 mt-3 mb-1 px-3.5 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-[12px] shadow-sm relative no-drag group/warning">
                                    <div className="flex flex-col gap-1 pr-3">
                                        <div className="flex items-center gap-2 text-[12.5px] text-yellow-600 dark:text-yellow-400/90 font-medium leading-tight">
                                            <div className="shrink-0 p-1 bg-yellow-500/20 rounded-full">
                                                <svg className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                </svg>
                                            </div>
                                            <span>Screen Recording Permission Denied</span>
                                        </div>
                                        <p className="text-[11px] text-yellow-600/70 dark:text-yellow-400/60 leading-snug pl-[26px]">
                                            {systemAudioWarning}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button 
                                            onClick={() => { window.electronAPI.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); }}
                                            className="px-3 py-1.5 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-700 dark:text-yellow-500 text-[11px] font-semibold transition-all active:scale-95 border border-yellow-500/20 shadow-sm"
                                        >
                                            Open Settings
                                        </button>
                                        <button 
                                            onClick={() => setSystemAudioWarning(null)}
                                            className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-yellow-600/50 hover:text-yellow-700 dark:text-yellow-500/50 dark:hover:text-yellow-400 transition-colors absolute top-1 right-1 opacity-0 group-hover/warning:opacity-100"
                                            title="Dismiss"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* PR #173: STT Not Configured Warning Banner */}
                            {sttNotConfigured && (
                                <div className="flex items-center justify-between mx-4 mt-3 mb-1 px-3.5 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-[12px] shadow-sm relative no-drag group/stt-warning">
                                    <div className="flex flex-col gap-1 pr-3">
                                        <div className="flex items-center gap-2 text-[12.5px] text-orange-600 dark:text-orange-400/90 font-medium leading-tight">
                                            <div className="shrink-0 p-1 bg-orange-500/20 rounded-full">
                                                <svg className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                                </svg>
                                            </div>
                                            <span>Transcription Not Configured</span>
                                        </div>
                                        <p className="text-[11px] text-orange-600/70 dark:text-orange-400/60 leading-snug pl-[26px]">
                                            No STT provider selected. Open Settings → Audio to pick one.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={() => { window.electronAPI?.toggleSettingsWindow?.(); }}
                                            className="px-3 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-700 dark:text-orange-500 text-[11px] font-semibold transition-all active:scale-95 border border-orange-500/20 shadow-sm"
                                        >
                                            Open Settings
                                        </button>
                                        <button
                                            onClick={() => setSttNotConfigured(false)}
                                            className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-orange-600/50 hover:text-orange-700 dark:text-orange-500/50 dark:hover:text-orange-400 transition-colors absolute top-1 right-1 opacity-0 group-hover/stt-warning:opacity-100"
                                            title="Dismiss"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Rolling Transcript Bar — includes STT status indicator inline */}
                            {(showTranscript && rollingTranscript) || interviewerSttIndicatorStatus !== 'connected' || sttUserStatus !== 'connected' ? (
                                <>
                                    <RollingTranscript
                                        text={showTranscript ? lastFinalSentence : ''}
                                        isActive={isInterviewerSpeaking}
                                        aiHasResponded={lastResponseSentenceId === currentSentenceId && currentSentenceId > 0}
                                        surfaceStyle={showTranscript ? appearance.transcriptStyle : undefined}
                                        interviewerChannel={{
                                            status: interviewerSttIndicatorStatus,
                                            error: interviewerSttIndicatorError,
                                            provider: sttMetrics.interviewer?.activeProvider || sttInterviewerProvider,
                                        }}
                                        microphoneChannel={{
                                            status: sttUserStatus,
                                            error: sttUserError,
                                            provider: sttMetrics.user?.activeProvider || sttUserProvider,
                                        }}
                                        onCopyDiagnostics={copyDiagnostics}
                                    />
                                </>
                            ) : null}

                            {/* Chat History - Only show if there are messages OR active states */}
                            {(messages.length > 0 || isManualRecording || isProcessing) && (
                                <>
                                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[clamp(300px,35vh,450px)] no-drag" style={{ scrollbarWidth: 'none' }}>
                                    {messages.map((msg) => (
                                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up w-full`}>
                                            <div className={`
                                                ${msg.role === 'user' ? 'max-w-[72.25%] px-[13.6px] py-[10.2px] bg-blue-500/10 backdrop-blur-md border border-blue-500/20 text-blue-100 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium' : msg.role === 'system' ? 'w-[85%]' : 'w-full'} 
                                                text-[14px] leading-relaxed relative group whitespace-pre-wrap
                                                ${msg.role === 'interviewer' ? 'overlay-text-muted italic pl-0 text-[13px] max-w-[85%]' : ''}
                                            `}>
                                                {msg.role === 'interviewer' && (
                                                    <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider overlay-text-muted">
                                                        Interviewer
                                                        {msg.isStreaming && <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />}
                                                    </div>
                                                )}
                                                {msg.role === 'user' && msg.hasScreenshot && (
                                                    <div className="flex items-center gap-1 text-[10px] opacity-70 mb-1 border-b pb-1 border-white/10">
                                                        <Image className="w-2.5 h-2.5" />
                                                        <span>Screenshot attached</span>
                                                    </div>
                                                )}
                                                
                                                {/* User & Interviewer Text Render */}
                                                {msg.role !== 'system' && renderMessageText(msg)}

                                                {/* Premium System Response Card */}
                                                {msg.role === 'system' && (
                                                    <div className="w-full relative group rounded-xl overflow-hidden bg-[#1A1512]/90 border border-[#F59E0B]/30 shadow-[0_4px_24px_rgba(0,0,0,0.4)] backdrop-blur-xl">
                                                        {/* Header */}
                                                        {msg.source && (
                                                            <div className="flex items-center justify-between px-4 py-2 border-b border-[#F59E0B]/15 bg-[#F59E0B]/5 relative z-10">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-[11px] font-bold text-[#F59E0B] tracking-[0.08em] uppercase">
                                                                        {sourceIconMap[msg.source] || '⚡'} {msg.source}
                                                                    </span>
                                                                </div>
                                                                {msg.isStreaming ? (
                                                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#F59E0B]/10 border border-[#F59E0B]/20">
                                                                        <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse"></div>
                                                                        <span className="text-[9px] font-bold text-[#F59E0B] tracking-wider uppercase">Live</span>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        )}
                                                        
                                                        {/* Body */}
                                                        <div className="p-4 text-[#F3F4F6] text-[14px] leading-relaxed relative z-10">
                                                            {!msg.isStreaming && (
                                                                <button
                                                                    onClick={() => handleCopy(msg.text)}
                                                                    className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/90 border border-white/5"
                                                                    title="Copy to clipboard"
                                                                >
                                                                    <Copy className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}
                                                            {renderMessageText(msg)}
                                                        </div>

                                                        {/* Response Chips */}
                                                        {!msg.isStreaming && msg.chips && msg.chips.length > 0 && (
                                                            <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                                                                {msg.chips.map((chip, i) => (
                                                                    <span
                                                                        key={i}
                                                                        className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-tight border cursor-default select-none"
                                                                        style={{
                                                                            animationDelay: `${i * 60}ms`,
                                                                            animation: 'fadeInUp 0.22s cubic-bezier(0.23,1,0.32,1) both',
                                                                            ...(chip.variant === 'green'  ? { background: 'rgba(34,197,94,0.12)',  color: '#4ADE80', border: '1px solid rgba(34,197,94,0.28)' } :
                                                                               chip.variant === 'amber'  ? { background: 'rgba(245,158,11,0.14)', color: '#FCD34D', border: '1px solid rgba(245,158,11,0.32)' } :
                                                                               chip.variant === 'red'    ? { background: 'rgba(239,68,68,0.12)',  color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.28)' } :
                                                                               chip.variant === 'blue'   ? { background: 'rgba(59,130,246,0.12)', color: '#93C5FD', border: '1px solid rgba(59,130,246,0.28)' } :
                                                                               chip.variant === 'purple' ? { background: 'rgba(167,139,250,0.12)', color: '#C4B5FD', border: '1px solid rgba(167,139,250,0.28)' } :
                                                                                                          { background: 'rgba(255,255,255,0.07)', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.12)' })
                                                                        }}
                                                                    >
                                                                        {chip.label}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}

                                    {/* Active Recording State with Live Transcription */}
                                    {isManualRecording && (
                                        <div className="flex flex-col items-end gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            {/* Live transcription preview */}
                                            {(manualTranscript || voiceInput) && (
                                                <div className="max-w-[85%] px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-[18px] rounded-tr-[4px]">
                                                    <span className="text-[13px] text-emerald-300">
                                                        {voiceInput}{voiceInput && manualTranscript ? ' ' : ''}{manualTranscript}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="px-3 py-2 flex gap-1.5 items-center">
                                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                                <span className="text-[10px] text-emerald-400/70 ml-1">Listening...</span>
                                            </div>
                                        </div>
                                    )}

                                    {isProcessing && (
                                        <div className="flex justify-start">
                                            <div className="px-3 py-2 flex gap-1.5">
                                                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Jump to latest button */}
                                {showJumpButton && (
                                    <div className="flex justify-center py-1 no-drag">
                                        <button
                                            onClick={scrollToBottom}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium overlay-chip-surface border border-transparent hover:border-white/10 hover:bg-white/[0.08] transition-all duration-200 overlay-text-muted hover:overlay-text-secondary"
                                        >
                                            <ChevronDown className="w-3 h-3" />
                                            {unreadCount > 0 ? (
                                                <>
                                                    <span>{unreadCount} new</span>
                                                    <span className="flex h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                                                </>
                                            ) : (
                                                'Latest'
                                            )}
                                        </button>
                                    </div>
                                )}
                                </>
                            )}

                            {/* Quick Actions - Dynamic Context-Aware Buttons */}
                            {(() => {
                                // ── Action Map ──
                                type ActionDef = { label: string; icon: string; handler: () => void; isRecommended?: boolean };
                                const actionSets: Record<DetectedQuestionType, ActionDef[]> = {
                                    coding: [
                                        { label: 'What to answer?', icon: '💡', handler: handleWhatToSay },
                                        { label: 'Code Hint', icon: '💻', handler: handleCodeHint, isRecommended: true },
                                        { label: 'Brainstorm', icon: '🧠', handler: handleBrainstorm },
                                        { label: 'Clarify', icon: '❓', handler: handleClarify },
                                    ],
                                    system_design: [
                                        { label: 'What to answer?', icon: '💡', handler: handleWhatToSay },
                                        { label: 'Brainstorm', icon: '🧠', handler: handleBrainstorm, isRecommended: true },
                                        { label: 'Clarify', icon: '❓', handler: handleClarify },
                                        { label: 'Trade-offs', icon: '⚖️', handler: handleSystemDesignTradeoffs },
                                    ],
                                    behavioral: [
                                        { label: 'What to answer?', icon: '💡', handler: handleWhatToSay },
                                        {
                                            label: 'STAR Story',
                                            icon: '⭐',
                                            handler: () => {
                                                const hasCompletedAssistantAnswer = messages.some(msg => msg.role === 'system' && !msg.isStreaming && msg.text.trim().length > 0);
                                                if (hasCompletedAssistantAnswer) handleFollowUp('add_example');
                                                else handleWhatToSay();
                                            },
                                            isRecommended: true
                                        },
                                        { label: 'Follow Up', icon: '➡️', handler: handleFollowUpQuestions },
                                        { label: actionButtonMode === 'brainstorm' ? 'Brainstorm' : 'Recap', icon: actionButtonMode === 'brainstorm' ? '🧠' : '📝', handler: actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap },
                                    ],
                                    general: [
                                        { label: 'What to answer?', icon: '💡', handler: handleWhatToSay },
                                        { label: 'Clarify', icon: '❓', handler: handleClarify },
                                        { label: actionButtonMode === 'brainstorm' ? 'Brainstorm' : 'Recap', icon: actionButtonMode === 'brainstorm' ? '🧠' : '📝', handler: actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap },
                                        { label: 'Follow Up', icon: '➡️', handler: handleFollowUpQuestions },
                                    ],
                                };

                                // Smart recommendation override via keywords
                                const actions = actionSets[effectiveQuestionType] || actionSets.general;
                                const combined = `${lastFinalSentence || finalizedTranscriptRef.current.slice(-500)}`.toLowerCase();
                                let recommendedIdx = actions.findIndex((a: ActionDef) => a.isRecommended);
                                if (recommendedIdx < 0) recommendedIdx = 0;

                                // Keyword-based overrides
                                if (effectiveQuestionType === 'coding') {
                                    if (/(optimiz|improv|faster|efficient|refactor)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Brainstorm');
                                    else if (/(explain|why|how does|approach)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Clarify');
                                } else if (effectiveQuestionType === 'system_design') {
                                    if (/(tradeoff|trade-off|pros? and cons|downsides|advantages|disadvantages)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Trade-offs');
                                    else if (/(scal|million|billion|traffic|handle more users)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Brainstorm');
                                } else if (effectiveQuestionType === 'behavioral') {
                                    if (/(follow.?up|next|then what)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Follow Up');
                                    else if (/(improv|better|stronger)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label.includes('Brainstorm') || a.label.includes('Recap'));
                                } else if (effectiveQuestionType === 'general') {
                                    // Silent general fallback UX boost
                                    recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Clarify');
                                }
                                if (recommendedIdx < 0) recommendedIdx = 0;

                                return (
                                    <div className={`flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 overflow-x-hidden transition-opacity duration-300 ease-in-out ${rollingTranscript && showTranscript ? 'pt-1' : 'pt-3'}`} style={{ opacity: localOpacity }}>
                                        <AnimatePresence mode="popLayout">
                                            {(() => {
                                                // Unique color per button label
                                                const buttonColors: Record<string, { gradient: string; glow: string }> = {
                                                    'What to answer?': { gradient: 'from-sky-400 via-sky-500 to-blue-600', glow: 'rgba(56,189,248,0.35)' },
                                                    'Code Hint':       { gradient: 'from-violet-400 via-violet-500 to-purple-600', glow: 'rgba(139,92,246,0.35)' },
                                                    'Brainstorm':      { gradient: 'from-amber-400 via-orange-500 to-orange-600', glow: 'rgba(251,146,60,0.35)' },
                                                    'Clarify':         { gradient: 'from-cyan-400 via-cyan-500 to-teal-600', glow: 'rgba(34,211,238,0.35)' },
                                                    'STAR Story':      { gradient: 'from-pink-400 via-pink-500 to-rose-600', glow: 'rgba(244,114,182,0.35)' },
                                                    'Follow Up':       { gradient: 'from-amber-400 via-yellow-500 to-amber-600', glow: 'rgba(245,158,11,0.35)' },
                                                    'Trade-offs':      { gradient: 'from-teal-400 via-teal-500 to-emerald-600', glow: 'rgba(20,184,166,0.35)' },
                                                    'Recap':           { gradient: 'from-slate-400 via-slate-500 to-gray-600', glow: 'rgba(148,163,184,0.3)' },
                                                };
                                                const fallbackColor = { gradient: 'from-indigo-400 via-indigo-500 to-blue-600', glow: 'rgba(99,102,241,0.35)' };

                                                return actions.map((action: ActionDef, idx: number) => {
                                                    const isRec = idx === recommendedIdx;
                                                    const colors = buttonColors[action.label] || fallbackColor;
                                                    return (
                                                        <motion.button
                                                            key={`${currentQuestionTurnId}-${effectiveQuestionType}-${action.label}`}
                                                            layout
                                                            initial={{ opacity: 0, y: 6, scale: 0.92 }}
                                                            animate={{ opacity: 1, y: 0, scale: isRec ? 1.03 : 1 }}
                                                            exit={{ opacity: 0, y: -4, scale: 0.92 }}
                                                            transition={{ duration: 0.2, delay: idx * 0.04, ease: [0.25, 1, 0.5, 1] }}
                                                            whileHover={{ scale: isRec ? 1.07 : 1.05, y: -1, filter: 'brightness(1.12)' }}
                                                            whileTap={{ scale: 0.95 }}
                                                            onClick={() => { if (!isProcessing) action.handler(); }}
                                                            className={`group relative overflow-hidden flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap shrink-0 no-drag text-white`}
                                                            style={{
                                                                boxShadow: `inset 0 1px 1px rgba(255,255,255,${isRec ? '0.5' : '0.3'}), inset 0 -1px 2px rgba(0,0,0,0.1), 0 2px 8px ${colors.glow}, 0 0 0 1px rgba(255,255,255,${isRec ? '0.1' : '0.06'})`,
                                                            }}
                                                        >
                                                            {/* Unique gradient per button */}
                                                            <div className={`absolute inset-0 bg-gradient-to-b ${colors.gradient}`} />
                                                            {/* Top highlight band */}
                                                            <div className="absolute inset-x-2 top-0 h-[40%] bg-gradient-to-b from-white/30 to-transparent blur-[1.5px] rounded-b-lg pointer-events-none z-10" style={{ opacity: isRec ? 0.7 : 0.5 }} />
                                                            {/* Hover glow */}
                                                            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-10" />
                                                            {/* Content */}
                                                            <span className="relative z-20 text-[12px] leading-none">{action.icon}</span>
                                                            <span className="relative z-20 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]">{action.label}</span>
                                                        </motion.button>
                                                    );
                                                });
                                            })()}
                                        </AnimatePresence>

                                        {/* Answer Button — jelly pill design */}
                                        <motion.button
                                            onClick={handleAnswerNow}
                                            whileHover={{ scale: 1.04, filter: 'brightness(1.12)' }}
                                            whileTap={{ scale: 0.96 }}
                                            transition={{ duration: 0.18, ease: 'easeOut' }}
                                            className="group relative overflow-hidden text-white px-4 py-1.5 rounded-full font-medium tracking-normal flex items-center justify-center gap-1.5 shrink-0 min-w-[74px] whitespace-nowrap no-drag text-[11px]"
                                            style={{
                                                boxShadow: isManualRecording
                                                    ? 'inset 0 1px 1px rgba(255,255,255,0.5), inset 0 -1px 2px rgba(0,0,0,0.1), 0 2px 8px rgba(239,68,68,0.4), 0 0 0 1px rgba(255,255,255,0.1)'
                                                    : 'inset 0 1px 1px rgba(255,255,255,0.5), inset 0 -1px 2px rgba(0,0,0,0.1), 0 2px 8px rgba(16,185,129,0.35), 0 0 0 1px rgba(255,255,255,0.1)',
                                                transition: 'box-shadow 0.4s ease-out',
                                            }}
                                        >
                                            {/* Emerald gradient (Answer state) */}
                                            <div
                                                className="absolute inset-0 bg-gradient-to-b from-emerald-400 via-emerald-500 to-teal-600 transition-opacity duration-400 ease-out"
                                                style={{ opacity: isManualRecording ? 0 : 1 }}
                                            />
                                            {/* Red gradient (Stop state) */}
                                            <div
                                                className="absolute inset-0 bg-gradient-to-b from-red-400 via-red-500 to-red-600 transition-opacity duration-400 ease-out"
                                                style={{ opacity: isManualRecording ? 1 : 0 }}
                                            />
                                            {/* Top highlight band */}
                                            <div className="absolute inset-x-2 top-0 h-[40%] bg-gradient-to-b from-white/35 to-transparent blur-[1.5px] rounded-b-lg opacity-70 pointer-events-none z-10" />
                                            {/* Hover glow */}
                                            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-10" />

                                            {/* Content */}
                                            <div className="relative z-20 flex items-center gap-1.5">
                                                <AnimatePresence mode="wait" initial={false}>
                                                    {isManualRecording ? (
                                                        <motion.div
                                                            key="stop"
                                                            initial={{ opacity: 0, y: 4 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -4 }}
                                                            transition={{ duration: 0.18, ease: 'easeOut' }}
                                                            className="flex items-center gap-1.5"
                                                        >
                                                            <span className="relative flex h-[5px] w-[5px]">
                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
                                                                <span className="relative inline-flex rounded-full h-[5px] w-[5px] bg-white" />
                                                            </span>
                                                            Stop
                                                        </motion.div>
                                                    ) : (
                                                        <motion.div
                                                            key="answer"
                                                            initial={{ opacity: 0, y: 4 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -4 }}
                                                            transition={{ duration: 0.18, ease: 'easeOut' }}
                                                            className="flex items-center gap-1.5"
                                                        >
                                                            <Zap className="w-3 h-3 opacity-90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]" />
                                                            Answer
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        </motion.button>
                                    </div>
                                );
                            })()}

                            {/* Input Area */}
                            <div className="p-3 pt-0">
                                {/* Latent Context Preview (Attached Screenshot) */}
                                {attachedContext.length > 0 && (
                                    <div className={`mb-2 rounded-lg p-2 transition-all duration-200 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-[11px] font-medium overlay-text-primary">
                                                {attachedContext.length} screenshot{attachedContext.length > 1 ? 's' : ''} attached
                                            </span>
                                            <button
                                                onClick={() => setAttachedContext([])}
                                                className="p-1 rounded-full transition-colors overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                                                title="Remove all"
                                                style={appearance.iconStyle}
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <div className="flex gap-1.5 overflow-x-auto max-w-full pb-1">
                                            {attachedContext.map((ctx, idx) => (
                                                <div key={ctx.path} className="relative group/thumb flex-shrink-0">
                                                    <img
                                                        src={ctx.preview}
                                                        alt={`Screenshot ${idx + 1}`}
                                                        className={`h-10 w-auto rounded border ${isLightTheme ? 'border-black/15' : 'border-white/20'}`}
                                                    />
                                                    <button
                                                        onClick={() => setAttachedContext(prev => prev.filter((_, i) => i !== idx))}
                                                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                                                        title="Remove"
                                                    >
                                                        <X className="w-2.5 h-2.5 text-white" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <span className="text-[10px] overlay-text-muted">Ask a question or click Answer</span>
                                    </div>
                                )}

                                <div className="relative group">
                                    <input
                                        ref={textInputRef}
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                                        className={`w-full bg-black/[0.15] border border-white/[0.08] hover:border-white/[0.15] focus:border-white/20 focus:ring-2 focus:ring-white/10 rounded-[12px] pl-3.5 pr-10 py-2.5 focus:outline-none transition-all duration-200 backdrop-blur-3xl shadow-sm text-[13px] placeholder-[#FDE68A]/40 ${inputClass}`}
                                        style={{ ...appearance.inputStyle, color: '#FDE68A' }}
                                    />

                                    {/* Custom Rich Placeholder */}
                                    {!inputValue && (
                                        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] text-[#FDE68A]/60">
                                            <span>Ask anything on screen or conversation, or</span>
                                            <div className="flex items-center gap-1 opacity-80">
                                                {(shortcuts.selectiveScreenshot || ['⌘', 'Shift', 'H']).map((key, i) => (
                                                    <React.Fragment key={i}>
                                                        {i > 0 && <span className="text-[10px]">+</span>}
                                                        <kbd className="px-1.5 py-0.5 rounded border border-[#FDE68A]/20 bg-black/20 text-[10px] font-sans min-w-[20px] text-center text-[#FDE68A]/90">{key}</kbd>
                                                    </React.Fragment>
                                                ))}
                                            </div>
                                            <span>for selective screenshot</span>
                                        </div>
                                    )}

                                    {!inputValue && (
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none opacity-20">
                                            <span className="text-[10px]">↵</span>
                                        </div>
                                    )}
                                </div>

                                {/* Bottom Row */}
                                <div className="flex items-center justify-between mt-3 px-0.5">
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={(e) => {
                                                // Calculate position for detached window
                                                if (!contentRef.current) return;
                                                const contentRect = contentRef.current.getBoundingClientRect();
                                                const buttonRect = e.currentTarget.getBoundingClientRect();
                                                const GAP = 8;

                                                const x = window.screenX + buttonRect.left;
                                                const y = window.screenY + contentRect.bottom + GAP;

                                                window.electronAPI.toggleModelSelector({ x, y });
                                            }}
                                            className={`
                                                flex items-center justify-between px-3 py-1.5
                                                bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.05]
                                                rounded-[10px] transition-colors duration-150 shadow-sm
                                                text-[12px] font-medium w-[140px] backdrop-blur-3xl
                                                interaction-base interaction-press
                                                ${controlSurfaceClass}
                                            `}
                                            style={{ ...appearance.controlStyle, color: '#FDE68A' }}
                                        >
                                            <span className="truncate min-w-0 flex-1">
                                                {(() => {
                                                    const m = currentModel;
                                                    if (m.startsWith('ollama-')) return m.replace('ollama-', '');
                                                    if (m === 'gemini-3.1-flash-lite-preview') return 'Gemini 3.1 Flash';
                                                    if (m === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
                                                    if (m === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
                                                    if (m === 'gpt-5.4') return 'GPT 5.4';
                                                    if (m === 'claude-sonnet-4-6') return 'Sonnet 4.6';
                                                    return m;
                                                })()}
                                            </span>
                                            <ChevronDown size={14} className="shrink-0 transition-transform" />
                                        </button>

                                        <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />

                                        <div className="relative group">
                                            <button
                                                onClick={(e) => {
                                                    if (isSettingsOpen) {
                                                        // If open, just close it (toggle will handle logic but we can be explicit or just toggle)
                                                        // Actually toggle-settings-window handles hiding if visible, so logic is same.
                                                        window.electronAPI.toggleSettingsWindow();
                                                        return;
                                                    }

                                                    if (!contentRef.current) return;

                                                    const contentRect = contentRef.current.getBoundingClientRect();
                                                    const buttonRect = e.currentTarget.getBoundingClientRect();
                                                    const POPUP_WIDTH = 270; // Matches SettingsWindowHelper actual width
                                                    const GAP = 8; // Same gap as between TopPill and main body (gap-2 = 8px)

                                                    // X: Left-aligned relative to the Settings Button
                                                    const x = window.screenX + buttonRect.left;

                                                    // Y: Below the main content + gap
                                                    const y = window.screenY + contentRect.bottom + GAP;

                                                    window.electronAPI.toggleSettingsWindow({ x, y });
                                                }}
                                                className={`
                                            w-7 h-7 flex items-center justify-center rounded-lg
                                            interaction-base interaction-press
                                            ${isSettingsOpen
                                                    ? 'overlay-icon-surface overlay-icon-surface-hover overlay-text-primary'
                                                    : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                                        `}

                                                style={appearance.iconStyle}
                                            >
                                                <SlidersHorizontal className="w-3.5 h-3.5" />
                                            </button>
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded-[8px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none backdrop-blur-xl shadow-lg border border-white/10 z-50">
                                                Settings
                                            </div>
                                        </div>



                                        {/* Mouse Passthrough Toggle */}
                                        <div className="relative group">
                                            <button
                                                onClick={() => {
                                                    setIsMousePassthrough(prev => {
                                                        const newState = !prev;
                                                        console.log(`[Overlay] Mouse passthrough mode ${newState ? 'on' : 'off'}`);
                                                        window.electronAPI?.setOverlayMousePassthrough?.(newState);
                                                        return newState;
                                                    });
                                                }}
                                                className={`
                                                    w-7 h-7 flex items-center justify-center rounded-lg
                                                    interaction-base interaction-press
                                                    ${isMousePassthrough
                                                        ? 'overlay-icon-surface overlay-icon-surface-hover text-sky-400 opacity-100'
                                                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                                                `}

                                                style={appearance.iconStyle}
                                            >
                                                <PointerOff className={`w-3.5 h-3.5 ${isMousePassthrough ? 'animate-flame' : ''}`} />
                                            </button>
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded-[8px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none backdrop-blur-xl shadow-lg border border-white/10 z-50">
                                                Mouse Passthrough
                                            </div>
                                        </div>

                                        {/* Stealth Mode (Opacity) Toggle */}
                                        <div className="relative group">
                                            <button
                                                onClick={() => {
                                                    setLocalOpacity(prev => {
                                                        // Fallback to 1.0 if prev is NaN or undefined somehow
                                                        if (!prev || isNaN(prev)) prev = 1.0;
                                                        
                                                        const rounded = Math.round(prev * 100);
                                                        let nextOpacity = 1.0;
                                                        
                                                        if (rounded >= 90) nextOpacity = 0.6;
                                                        else if (rounded >= 50) nextOpacity = 0.2;
                                                        else nextOpacity = 1.0;

                                                        console.log(`[Overlay] Opacity/stealth mode set to ${nextOpacity} (${nextOpacity < 1.0 ? 'on' : 'off'})`);
                                                        window.electronAPI?.setOverlayOpacity?.(nextOpacity);
                                                        return nextOpacity;
                                                    });
                                                }}
                                                className={`
                                                    w-7 h-7 flex items-center justify-center rounded-lg
                                                    interaction-base interaction-press
                                                    ${localOpacity < 1.0
                                                        ? 'overlay-icon-surface overlay-icon-surface-hover text-purple-400 opacity-100'
                                                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                                                `}

                                                style={appearance.iconStyle}
                                            >
                                                <Ghost className={`w-3.5 h-3.5 ${localOpacity < 1.0 ? 'animate-flame' : ''}`} />
                                            </button>
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded-[8px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none backdrop-blur-xl shadow-lg border border-white/10 z-50">
                                                Overlay Opacity
                                            </div>
                                        </div>

                                        <div className="relative group">
                                            <button
                                                onClick={() => {
                                                    setForceSystemDesignMode(prev => {
                                                        const next = !prev;
                                                        console.log(`[Overlay] System design mode ${next ? 'on' : 'off'}`);
                                                        window.electronAPI?.overlayLogSystemDesignMode?.(next);
                                                        return next;
                                                    });
                                                }}
                                                className={`
                                                    w-7 h-7 flex items-center justify-center rounded-lg
                                                    interaction-base interaction-press
                                                    ${forceSystemDesignMode
                                                        ? 'overlay-icon-surface overlay-icon-surface-hover text-teal-400 opacity-100'
                                                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                                                `}
                                                style={appearance.iconStyle}
                                            >
                                                <Cpu className={`w-3.5 h-3.5 ${forceSystemDesignMode ? 'animate-flame' : ''}`} />
                                            </button>
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded-[8px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none backdrop-blur-xl shadow-lg border border-white/10 z-50">
                                                System Design Mode
                                            </div>
                                        </div>

                                        {/* Custom Context Toggle — Pro only */}
                                        {hasProContextAccess && (
                                            <div className="relative group">
                                                <button
                                                    onClick={async () => {
                                                        const next = !customNotesEnabled;
                                                        setCustomNotesEnabled(next);
                                                        console.log(`[Overlay] Custom context ${next ? 'on' : 'off'}`);
                                                        await window.electronAPI?.setCustomNotesEnabled?.(next);
                                                    }}
                                                    className={`
                                                        w-7 h-7 flex items-center justify-center rounded-lg
                                                        interaction-base interaction-press
                                                        ${customNotesEnabled
                                                            ? 'overlay-icon-surface overlay-icon-surface-hover text-amber-400 opacity-100'
                                                            : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                                                    `}
                                                    style={appearance.iconStyle}
                                                >
                                                    <FileText className={`w-3.5 h-3.5 ${customNotesEnabled ? 'animate-flame' : ''}`} />
                                                </button>
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded-[8px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none backdrop-blur-xl shadow-lg border border-white/10 z-50">
                                                    {customNotesEnabled ? 'Custom Context: ON' : 'Custom Context: OFF'}
                                                </div>
                                            </div>
                                        )}

                                    </div>

                                    <button
                                        onClick={handleManualSubmit}
                                        disabled={!inputValue.trim()}
                                    className={`
                                    w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200
                                    interaction-base interaction-press
                                    ${inputValue.trim()
                                                ? 'bg-[#007AFF] text-white shadow-[0_2px_8px_rgba(0,122,255,0.4)] hover:bg-[#007AFF]/90 border border-white/10'
                                                : 'bg-white/[0.08] border border-white/[0.05] text-white/40 cursor-not-allowed'
                                            }
                                `}
                                    style={inputValue.trim() ? undefined : appearance.iconStyle}
                                    >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* ─── Pro Context Bar ─────────────────────────────── */}
                        <div className="w-[600px] max-w-full transition-opacity duration-300 ease-in-out" style={{ opacity: localOpacity }}>
                            <ProContextBar
                                profileModeEnabled={hasProContextAccess}
                                negotiationEnabled={negotiationContextEnabled}
                                hasNegotiationScript={hasNegotiationScript}
                                negotiationLoading={negotiationToggleLoading}
                                onToggleNegotiation={handleToggleNegotiationContext}
                            />
                        </div>

                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default NativelyInterface;
