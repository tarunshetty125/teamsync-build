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
    Cpu
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
// import { ModelSelector } from './ui/ModelSelector'; // REMOVED
import TopPill from './ui/TopPill';
import RollingTranscript from './ui/RollingTranscript';
import SttRuntimePanel from './ui/SttRuntimePanel';
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
    isStreaming?: boolean;
    hasScreenshot?: boolean;
    screenshotPreview?: string;
    isCode?: boolean;
    intent?: string;
    source?: string;
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
}

// ── C1 Fix: Monotonic message ID counter to prevent collisions under rapid updates ──
let msgIdCounter = 0;
function nextMsgId(): string {
    return `${Date.now()}-${++msgIdCounter}`;
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

type IntentAction = { type: 'EVALUATE'; combinedText: string; now: number; seq: number };

function intentReducer(state: IntentState, action: IntentAction): IntentState {
    switch (action.type) {
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

const NativelyInterface: React.FC<NativelyInterfaceProps> = ({ onEndMeeting, overlayOpacity = OVERLAY_OPACITY_DEFAULT }) => {
    const isLightTheme = useResolvedTheme() === 'light';

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
    const [manualTranscript, setManualTranscript] = useState('');
    const manualTranscriptRef = useRef<string>('');
    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('natively_interviewer_transcript');
        return stored !== 'false';
    });

    // Analytics State
    const requestStartTimeRef = useRef<number | null>(null);

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

    // Refs for safe synchronous access in visibility listener
    const latestCombinedRef = useRef<string>('');
    const requestIdRef = useRef(0);
    const timeoutRef = useRef<number | NodeJS.Timeout | null>(null);
    const seqRef = useRef(0);
    const scheduledSeqRef = useRef(0);
    const pendingRef = useRef(false);

    // Visibility recovery listener
    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === 'visible' && pendingRef.current) {
                pendingRef.current = false;
                requestIdRef.current++; // invalidate stale work
                dispatchIntent({ 
                    type: 'EVALUATE', 
                    combinedText: latestCombinedRef.current, 
                    now: performance.now(),
                    seq: ++seqRef.current
                });
            }
        };

        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, []);

    useEffect(() => {
        if (document.visibilityState !== 'visible') {
            pendingRef.current = true;
            return; // Prevent stale updates from background execution, but queue one flush
        }

        if (timeoutRef.current) clearTimeout(timeoutRef.current as any);
        
        const nextSeq = seqRef.current + 1;
        scheduledSeqRef.current = nextSeq;
        
        timeoutRef.current = setTimeout(() => {
            // Prevent double-invocation strict mode execution races
            if (scheduledSeqRef.current !== nextSeq) return; 
            
            // Combine rolling transcript + last few interviewer messages for detection
            const interviewerMsgs = messages
                .filter(m => m.role === 'interviewer')
                .slice(-3)
                .map(m => m.text)
                .join(' ');
            
            // Ignore weak user input
            const userWeight = inputValue.length > 10 ? inputValue : '';
            
            // Weight recent context higher by repeating interviewer messages
            latestCombinedRef.current = `
                ${interviewerMsgs}
                ${interviewerMsgs}
                ${rollingTranscript.slice(-1500)}
                ${userWeight}
            `.trim();
            if (latestCombinedRef.current.length < 3) return;

            const seq = (seqRef.current = nextSeq);

            dispatchIntent({ 
                type: 'EVALUATE', 
                combinedText: latestCombinedRef.current, 
                now: performance.now(),
                seq
            });
        }, 300);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current as any);
        };
    }, [rollingTranscript, messages, inputValue]);

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
    useEffect(() => {
        window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => {});
        const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v) => setIsMousePassthrough(v));
        return () => unsub?.();
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
        return messages
            .filter(m => m.role !== 'user' || !m.hasScreenshot)
            .map(m => `${m.role === 'interviewer' ? 'Interviewer' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .slice(-20)
            .join('\n');
    }, [messages]);

    // Keep refs in sync with state for async handler access
    isProcessingRef.current = isProcessing;
    attachedContextRef.current = attachedContext;
    currentModelRef.current = currentModel;
    actionButtonModeRef.current = actionButtonMode;

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
        const unsubscribe = window.electronAPI.onSessionReset(() => {
            console.log('[NativelyInterface] Resetting session state...');
            setMessages([]);
            setInputValue('');
            setAttachedContext([]);
            setManualTranscript('');
            setVoiceInput('');
            setIsProcessing(false);
            setRollingTranscript('');
            finalizedTranscriptRef.current = '';
            // Optionally reset connection status if needed, but connection persists

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
                if (finalizedTranscriptRef.current.length > 8000) {
                    finalizedTranscriptRef.current = finalizedTranscriptRef.current.slice(-8000);
                }
                setRollingTranscript(finalizedTranscriptRef.current);

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
            // Progressive update for 'what_to_answer' mode
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];

                // If we already have a streaming message for this intent, append
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + data.token
                    };
                    return updated;
                }

                // Otherwise, start a new one (First token)
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: data.token,
                    intent: 'what_to_answer',
                    source: currentSourceRef.current,
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
            if (userHasScrolledRef.current) {
                setUnreadCount(prev => prev + 1);
            }
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];

                // If we were streaming, finalize it
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
                    // Start new array to avoid mutation
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.answer, // Ensure final consistency
                        isStreaming: false
                    };
                    return updated;
                }

                // If we missed the stream (or not streaming), append fresh
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: data.answer,  // Plain text, no markdown - ready to speak
                    intent: 'what_to_answer',
                    source: currentSourceRef.current
                }];
            });
            currentSourceRef.current = undefined;
        }));

        // STREAMING: Refinement
        cleanups.push(window.electronAPI.onIntelligenceRefinedAnswerToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === data.intent) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + data.token
                    };
                    return updated;
                }
                // New stream start (e.g. user clicked Shorten)
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: data.token,
                    intent: data.intent,
                    source: currentSourceRef.current,
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceRefinedAnswer((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === data.intent) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.answer,
                        isStreaming: false
                    };
                    return updated;
                }
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: data.answer,
                    intent: data.intent,
                    source: currentSourceRef.current
                }];
            });
            currentSourceRef.current = undefined;
        }));

        // STREAMING: Recap
        cleanups.push(window.electronAPI.onIntelligenceRecapToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'recap') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + data.token
                    };
                    return updated;
                }
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: data.token,
                    intent: 'recap',
                    source: currentSourceRef.current,
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceRecap((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'recap') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.summary,
                        isStreaming: false
                    };
                    return updated;
                }
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: data.summary,
                    intent: 'recap',
                    source: currentSourceRef.current
                }];
            });
            currentSourceRef.current = undefined;
        }));

        // STREAMING: Follow-Up Questions (Rendered as message? Or specific UI?)
        // Currently interface typically renders follow-up Qs as a message or button update.
        // Let's assume message for now based on existing 'follow_up_questions_update' handling
        // But wait, existing handle just sets state?
        // Let's check how 'follow_up_questions_update' was handled.
        // It was handled separate locally in this component maybe?
        // Ah, I need to see the existing listener for 'onIntelligenceFollowUpQuestionsUpdate'

        // Let's implemented token streaming for it anyway, likely it updates a message bubble 
        // OR it might update a specialized "Suggested Questions" area.
        // Assuming it's a message for consistency with "Copilot" approach.

        cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'follow_up_questions') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + data.token
                    };
                    return updated;
                }
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: data.token,
                    intent: 'follow_up_questions',
                    source: currentSourceRef.current,
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsUpdate((data) => {
            // This event name is slightly different ('update' vs 'answer')
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'follow_up_questions') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.questions,
                        isStreaming: false
                    };
                    return updated;
                }
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: data.questions,
                    intent: 'follow_up_questions',
                    source: currentSourceRef.current
                }];
            });
            currentSourceRef.current = undefined;
        }));

        cleanups.push(window.electronAPI.onIntelligenceManualResult((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `🎯 **Answer:**\n\n${data.answer}`,
                source: currentSourceRef.current
            }]);
            currentSourceRef.current = undefined;
        }));

        cleanups.push(window.electronAPI.onIntelligenceError((data) => {
            setIsProcessing(false);
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
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'clarify') {
                    const updated = [...prev];
                    updated[prev.length - 1] = { ...lastMsg, text: lastMsg.text + data.token };
                    return updated;
                }
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system' as const,
                    text: data.token,
                    intent: 'clarify',
                    source: currentSourceRef.current,
                    isStreaming: true
                }];
            });
        });

        const cleanupFinal = window.electronAPI.onIntelligenceClarify((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'clarify') {
                    const updated = [...prev];
                    updated[prev.length - 1] = { ...lastMsg, text: data.clarification, isStreaming: false };
                    return updated;
                }
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system' as const,
                    text: data.clarification,
                    intent: 'clarify',
                    source: currentSourceRef.current
                }];
            });
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
        if (isProcessingRef.current) return; // H4 Fix: prevent double-submit
        setIsExpanded(true);
        setIsProcessing(true);
        currentSourceRef.current = 'What to Answer';
        analytics.trackCommandExecuted('what_to_say');

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

        try {
            // Pass imagePath if attached
            await window.electronAPI.generateWhatToSay(undefined, currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFollowUp = async (intent: string = 'rephrase') => {
        setIsExpanded(true);
        setIsProcessing(true);
        currentSourceRef.current = 'Follow Up';
        analytics.trackCommandExecuted('follow_up_' + intent);

        try {
            await window.electronAPI.generateFollowUp(intent);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRecap = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        currentSourceRef.current = 'Recap';
        analytics.trackCommandExecuted('recap');

        try {
            await window.electronAPI.generateRecap();
        } catch (err) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFollowUpQuestions = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        currentSourceRef.current = 'Follow Up Questions';
        analytics.trackCommandExecuted('suggest_questions');

        try {
            await window.electronAPI.generateFollowUpQuestions();
        } catch (err) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleClarify = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        currentSourceRef.current = 'Clarify';
        analytics.trackCommandExecuted('clarify');

        try {
            await window.electronAPI.generateClarify();
        } catch (err) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCodeHint = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        currentSourceRef.current = 'Code Hint';
        analytics.trackCommandExecuted('code_hint');

        const currentAttachments = attachedContext;
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

        try {
            await window.electronAPI.generateCodeHint(currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleBrainstorm = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        currentSourceRef.current = 'Brainstorm';
        analytics.trackCommandExecuted('brainstorm');

        const currentAttachments = attachedContext;
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

        try {
            await window.electronAPI.generateBrainstorm(currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };


    // Setup Streaming Listeners
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        // Stream Token
        cleanups.push(window.electronAPI.onGeminiStreamToken((token) => {
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
                        const lastMsg = prev[prev.length - 1];
                        if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                            const updated = [...prev];
                            updated[prev.length - 1] = { ...lastMsg, text: token };
                            return updated;
                        }
                        return prev;
                    });
                    return; // Skip the normal append below
                }
            } catch {
                // Not JSON — normal text token, fall through to the standard append.
            }

            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.text + token,
                        // H3 Fix: Only check for triple-backtick fences — 'def '/'function ' caused false positives
                        isCode: (lastMsg.text + token).includes('```')
                    };
                    return updated;
                }
                return prev;
            });
        }));

        // Stream Done
        cleanups.push(window.electronAPI.onGeminiStreamDone(() => {
            setIsProcessing(false);
            currentSourceRef.current = undefined;

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
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                    // Detect negotiation coaching response
                    try {
                        const parsed = JSON.parse(lastMsg.text);
                        if (parsed?.__negotiationCoaching) {
                            const coaching = parsed.__negotiationCoaching;
                            return [...prev.slice(0, -1), {
                                ...lastMsg,
                                isStreaming: false,
                                isNegotiationCoaching: true,
                                negotiationCoachingData: coaching,
                                text: '',
                            }];
                        }
                    } catch {}
                    // Normal completion
                    return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
                }
                return prev;
            });
        }));

        // Stream Error
        cleanups.push(window.electronAPI.onGeminiStreamError((error) => {
            setIsProcessing(false);
            requestStartTimeRef.current = null; // Clear timer on error
            setMessages(prev => {
                // Append error to the current message or add new one?
                // Let's add a new error block if the previous one confusing,
                // or just update status.
                // Ideally we want to show the partial response AND the error.
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        isStreaming: false,
                        text: lastMsg.text + `\n\n[Error: ${error}]`
                    };
                    return updated;
                }
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: `❌ Error: ${error}`
                }];
            });
        }));

        // JIT RAG Stream listeners (for live meeting RAG responses)
        if (window.electronAPI.onRAGStreamChunk) {
            cleanups.push(window.electronAPI.onRAGStreamChunk((data: { chunk: string }) => {
                // Same guard as onGeminiStreamToken: suppress raw JSON if this chunk is
                // the negotiation coaching sentinel. The onRAGStreamComplete handler will
                // convert it to the proper card UI.
                try {
                    const parsed = JSON.parse(data.chunk);
                    if (parsed?.__negotiationCoaching) {
                        setMessages(prev => {
                            const lastMsg = prev[prev.length - 1];
                            if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                                const updated = [...prev];
                                updated[prev.length - 1] = { ...lastMsg, text: data.chunk };
                                return updated;
                            }
                            return prev;
                        });
                        return; // Skip normal append
                    }
                } catch {
                    // Normal text chunk — fall through.
                }

                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                        const updated = [...prev];
                        updated[prev.length - 1] = {
                            ...lastMsg,
                            text: lastMsg.text + data.chunk,
                            isCode: (lastMsg.text + data.chunk).includes('```')
                        };
                        return updated;
                    }
                    return prev;
                });
            }));
        }

        if (window.electronAPI.onRAGStreamComplete) {
            cleanups.push(window.electronAPI.onRAGStreamComplete(() => {
                setIsProcessing(false);
                requestStartTimeRef.current = null;
                currentSourceRef.current = undefined;
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                        // Detect negotiation coaching response
                        try {
                            const parsed = JSON.parse(lastMsg.text);
                            if (parsed?.__negotiationCoaching) {
                                const coaching = parsed.__negotiationCoaching;
                                return [...prev.slice(0, -1), {
                                    ...lastMsg,
                                    isStreaming: false,
                                    isNegotiationCoaching: true,
                                    negotiationCoachingData: coaching,
                                    text: '',
                                }];
                            }
                        } catch {}
                        // Normal completion
                        return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
                    }
                    if (lastMsg && lastMsg.isStreaming) {
                        const updated = [...prev];
                        updated[prev.length - 1] = { ...lastMsg, isStreaming: false };
                        return updated;
                    }
                    return prev;
                });
            }));
        }

        if (window.electronAPI.onRAGStreamError) {
            cleanups.push(window.electronAPI.onRAGStreamError((data: { error: string }) => {
                setIsProcessing(false);
                requestStartTimeRef.current = null;
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.isStreaming) {
                        const updated = [...prev];
                        updated[prev.length - 1] = {
                            ...lastMsg,
                            isStreaming: false,
                            text: lastMsg.text + `\n\n[RAG Error: ${data.error}]`
                        };
                        return updated;
                    }
                    return prev;
                });
            }));
        }

        return () => cleanups.forEach(fn => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // C3 Fix: mount-only — model captured via ref, prevents listener teardown mid-stream


    const handleAnswerNow = async () => {
        if (isManualRecording) {
            // Stop recording - send accumulated voice input to Gemini
            isRecordingRef.current = false;  // Update ref immediately
            setIsManualRecording(false);
            setManualTranscript('');  // Clear live preview
            currentSourceRef.current = 'Answer Now';

            // Send manual finalization signal to STT Providers
            window.electronAPI.finalizeMicSTT().catch(err => console.error('[NativelyInterface] Failed to send finalizeMicSTT:', err));

            const currentAttachments = attachedContext;
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
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: '',
                isStreaming: true,
                source: currentSourceRef.current
            }]);

            setIsProcessing(true);

            try {
                let prompt = '';

                if (currentAttachments.length > 0) {
                    // Image + Voice Context
                    prompt = `You are a helper. The user has provided a screenshot and a spoken question/command.
User said: "${question}"

Instructions:
1. Analyze the screenshot in the context of what the user said.
2. Provide a direct, helpful answer.
3. Be concise.`;
                } else {
                    // JIT RAG pre-flight: try to use indexed meeting context first
                    const ragResult = await window.electronAPI.ragQueryLive?.(question);
                    if (ragResult?.success) {
                        // JIT RAG handled it — response streamed via rag:stream-chunk events
                        return;
                    }

                    // Voice Only — direct answer, adaptive formatting
                    prompt = `Answer directly. Adapt your format to the question type:
- **Coding**: Clean code block with language tag. Add 1-2 line explanation above if needed.
- **Concept/Definition**: Bold key term, then 2-4 bullet points covering what, why, and key aspects.
- **How-to/Steps**: Numbered list, each step concise.
- **Short factual**: 1-2 sentences max.
No preamble like "Sure!" or "Great question". No meta-commentary. Start with the answer immediately.`;
                }

                // Call Streaming API: message = question, context = instructions
                requestStartTimeRef.current = Date.now();
                await window.electronAPI.streamGeminiChat(question, currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined, prompt, { skipSystemPrompt: true, ignoreKnowledgeMode: true });

            } catch (err) {
                // Initial invocation failing (e.g. IPC error before stream starts)
                setIsProcessing(false);
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    // If we just added the empty streaming placeholder, remove it or fill it with error
                    if (last && last.isStreaming && last.text === '') {
                        return prev.slice(0, -1).concat({
                            id: nextMsgId(),
                            role: 'system',
                            text: `❌ Error starting stream: ${err}`
                        });
                    }
                    return [...prev, {
                        id: nextMsgId(),
                        role: 'system',
                        text: `❌ Error: ${err}`
                    }];
                });
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
        if (isProcessingRef.current) return; // H4 Fix: prevent double-submit
        if (!inputValue.trim() && attachedContext.length === 0) return;
        currentSourceRef.current = 'Manual Input';

        const userText = inputValue;
        const currentAttachments = attachedContext;

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
        setMessages(prev => [...prev, {
            id: nextMsgId(),
            role: 'system',
            text: '',
            isStreaming: true,
            source: currentSourceRef.current
        }]);

        setIsExpanded(true);
        setIsProcessing(true);

        try {
            // JIT RAG pre-flight: try to use indexed meeting context first
            if (currentAttachments.length === 0) {
                const ragResult = await window.electronAPI.ragQueryLive?.(userText || '');
                if (ragResult?.success) {
                    // JIT RAG handled it — response streamed via rag:stream-chunk events
                    return;
                }
            }

            // Pass imagePath if attached, AND conversation context
            requestStartTimeRef.current = Date.now();
            await window.electronAPI.streamGeminiChat(
                userText || 'Analyze this screenshot',
                currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
                conversationContext // Pass context so "answer this" works
            );
        } catch (err) {
            setIsProcessing(false);
            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.isStreaming && last.text === '') {
                    // remove the empty placeholder
                    return prev.slice(0, -1).concat({
                        id: nextMsgId(),
                        role: 'system',
                        text: `❌ Error starting stream: ${err}`
                    });
                }
                return [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: `❌ Error: ${err}`
                }];
            });
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
                setIsProcessing(false);
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
                            className={`relative w-[600px] max-w-full backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
                            style={appearance.shellStyle}
                        >



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
                                        text={showTranscript ? rollingTranscript : ''}
                                        isActive={isInterviewerSpeaking}
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
                                    <SttRuntimePanel
                                        sttUserStatus={sttUserStatus}
                                        sttUserError={sttUserError}
                                        sttUserProvider={sttUserProvider}
                                        sttInterviewerStatus={sttInterviewerStatus}
                                        sttInterviewerError={sttInterviewerError}
                                        sttInterviewerProvider={sttInterviewerProvider}
                                        sttTelemetry={sttTelemetry}
                                        sttMetrics={sttMetrics}
                                    />
                                </>
                            ) : null}

                            {/* Chat History - Only show if there are messages OR active states */}
                            {(messages.length > 0 || isManualRecording || isProcessing) && (
                                <>
                                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[clamp(300px,35vh,450px)] no-drag" style={{ scrollbarWidth: 'none' }}>
                                    {messages.map((msg) => (
                                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
                                            <div className={`
                      ${msg.role === 'user' ? 'max-w-[72.25%] px-[13.6px] py-[10.2px]' : 'max-w-[85%] px-4 py-3'} text-[14px] leading-relaxed relative group whitespace-pre-wrap
                      ${msg.role === 'user'
                                                    ? (isLightTheme
                                                        ? 'bg-blue-500/10 backdrop-blur-md border border-blue-500/20 text-blue-900 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                                                        : 'bg-blue-600/20 backdrop-blur-md border border-blue-500/30 text-blue-100 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium')
                                                    : ''
                                                }
                      ${msg.role === 'system'
                                                    ? 'overlay-text-primary font-normal'
                                                    : ''
                                                }
                      ${msg.role === 'interviewer'
                                                    ? 'overlay-text-muted italic pl-0 text-[13px]'
                                                    : ''
                                                }
                    `}>
                                                {msg.role === 'interviewer' && (
                                                    <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider overlay-text-muted">
                                                        Interviewer
                                                        {msg.isStreaming && <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />}
                                                    </div>
                                                )}
                                                {msg.role === 'user' && msg.hasScreenshot && (
                                                    <div className={`flex items-center gap-1 text-[10px] opacity-70 mb-1 border-b pb-1 ${isLightTheme ? 'border-black/10' : 'border-white/10'}`}>
                                                        <Image className="w-2.5 h-2.5" />
                                                        <span>Screenshot attached</span>
                                                    </div>
                                                )}
                                                {msg.role === 'system' && !msg.isStreaming && (
                                                    <button
                                                        onClick={() => handleCopy(msg.text)}
                                                        className="absolute top-2 right-2 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                                                        title="Copy to clipboard"
                                                        style={appearance.iconStyle}
                                                    >
                                                        <Copy className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                {msg.role === 'system' && msg.source && (() => {
                                                    const sStyle = sourceStyleMap[msg.source] || defaultSourceStyle;
                                                    const sIcon = sourceIconMap[msg.source] || '⚡';
                                                    return (
                                                        <div className="mb-1.5 flex items-center">
                                                            <span
                                                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border transition-transform duration-150 hover:scale-105 ${isLightTheme ? sStyle.light : sStyle.dark}`}
                                                            >
                                                                <span className="text-[10px] leading-none">{sIcon}</span>
                                                                {msg.source}
                                                            </span>
                                                        </div>
                                                    );
                                                })()}
                                                {renderMessageText(msg)}
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
                                        { label: 'Trade-offs', icon: '⚖️', handler: handleFollowUpQuestions },
                                    ],
                                    behavioral: [
                                        { label: 'What to answer?', icon: '💡', handler: handleWhatToSay },
                                        { label: 'STAR Story', icon: '⭐', handler: handleClarify, isRecommended: true },
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
                                const actions = actionSets[detectedQuestionType] || actionSets.general;
                                const combined = `${rollingTranscript} ${inputValue}`.toLowerCase();
                                let recommendedIdx = actions.findIndex((a: ActionDef) => a.isRecommended);
                                if (recommendedIdx < 0) recommendedIdx = 0;

                                // Keyword-based overrides
                                if (detectedQuestionType === 'coding') {
                                    if (/(optimiz|improv|faster|efficient|refactor)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Brainstorm');
                                    else if (/(explain|why|how does|approach)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Clarify');
                                } else if (detectedQuestionType === 'system_design') {
                                    if (/(tradeoff|trade-off|pros? and cons|downsides|advantages|disadvantages)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Trade-offs');
                                    else if (/(scal|million|billion|traffic|handle more users)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Brainstorm');
                                } else if (detectedQuestionType === 'behavioral') {
                                    if (/(follow.?up|next|then what)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Follow Up');
                                    else if (/(improv|better|stronger)/.test(combined)) recommendedIdx = actions.findIndex((a: ActionDef) => a.label.includes('Brainstorm') || a.label.includes('Recap'));
                                } else if (detectedQuestionType === 'general') {
                                    // Silent general fallback UX boost
                                    recommendedIdx = actions.findIndex((a: ActionDef) => a.label === 'Clarify');
                                }
                                if (recommendedIdx < 0) recommendedIdx = 0;

                                return (
                                    <div className={`flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 overflow-x-hidden ${rollingTranscript && showTranscript ? 'pt-1' : 'pt-3'}`}>
                                        <AnimatePresence mode="popLayout">
                                            {actions.map((action: ActionDef, idx: number) => {
                                                const isRec = idx === recommendedIdx;
                                                return (
                                                    <motion.button
                                                        key={`${detectedQuestionType}-${action.label}`}
                                                        layout
                                                        initial={{ opacity: 0, y: 6, scale: 0.92 }}
                                                        animate={{ opacity: 1, y: 0, scale: isRec ? 1.03 : 1 }}
                                                        exit={{ opacity: 0, y: -4, scale: 0.92 }}
                                                        transition={{ duration: 0.2, delay: idx * 0.04, ease: [0.25, 1, 0.5, 1] }}
                                                        whileHover={{ scale: isRec ? 1.07 : 1.05, y: -1 }}
                                                        whileTap={{ scale: 0.95 }}
                                                        onClick={() => { if (!isProcessing) action.handler(); }}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors duration-150 ease-out whitespace-nowrap shrink-0 no-drag ${
                                                            isRec
                                                                ? 'bg-accent-primary/[0.12] hover:bg-accent-primary/[0.18] border-accent-primary/40 overlay-text-primary suggestion-glow'
                                                                : `${quickActionClass} hover:bg-white/[0.08] hover:border-white/15`
                                                        }`}
                                                        style={isRec ? undefined : appearance.chipStyle}
                                                    >
                                                        <span className="text-[12px] leading-none">{action.icon}</span>
                                                        {action.label}
                                                    </motion.button>
                                                );
                                            })}
                                        </AnimatePresence>

                                        {/* Answer Button — always present */}
                                        <button
                                            onClick={handleAnswerNow}
                                            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all active:scale-95 duration-200 interaction-base interaction-press min-w-[74px] whitespace-nowrap shrink-0 ${isManualRecording
                                                ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                                                : 'overlay-chip-surface overlay-text-interactive hover:text-emerald-500 hover:bg-emerald-500/10'
                                                }`}
                                            style={isManualRecording ? undefined : appearance.chipStyle}
                                        >
                                            {isManualRecording ? (
                                                <>
                                                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                                    Stop
                                                </>
                                            ) : (
                                                <><Zap className="w-3 h-3 opacity-70" /> Answer</>
                                            )}
                                        </button>
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

                                        className={`w-full border focus:ring-1 rounded-xl pl-3 pr-10 py-2.5 focus:outline-none transition-all duration-200 ease-sculpted text-[13px] leading-relaxed ${inputClass}`}
                                        style={appearance.inputStyle}
                                    />

                                    {/* Custom Rich Placeholder */}
                                    {!inputValue && (
                                        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] overlay-text-muted">
                                            <span>Ask anything on screen or conversation, or</span>
                                            <div className="flex items-center gap-1 opacity-80">
                                                {(shortcuts.selectiveScreenshot || ['⌘', 'Shift', 'H']).map((key, i) => (
                                                    <React.Fragment key={i}>
                                                        {i > 0 && <span className="text-[10px]">+</span>}
                                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center overlay-control-surface overlay-text-secondary" style={appearance.controlStyle}>{key}</kbd>
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
                                                flex items-center gap-2 px-3 py-1.5
                                                border rounded-lg transition-colors
                                                text-xs font-medium w-[140px]
                                                interaction-base interaction-press
                                                ${controlSurfaceClass}
                                            `}
                                            style={appearance.controlStyle}
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

                                        <div className="relative">
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
                                        </div>



                                        {/* Mouse Passthrough Toggle */}
                                        <div className="relative">
                                            <button
                                                onClick={() => {
                                                    setIsMousePassthrough(prev => {
                                                        const newState = !prev;
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
                                                <PointerOff className="w-3.5 h-3.5" />
                                            </button>
                                        </div>

                                    </div>

                                    <button
                                        onClick={handleManualSubmit}
                                        disabled={!inputValue.trim()}
                                    className={`
                                    w-7 h-7 rounded-full flex items-center justify-center
                                    interaction-base interaction-press
                                    ${inputValue.trim()
                                                ? 'bg-[#007AFF] text-white shadow-lg shadow-blue-500/20 hover:bg-[#0071E3]'
                                                : 'overlay-icon-surface overlay-text-muted cursor-not-allowed'
                                            }
                                `}
                                    style={inputValue.trim() ? undefined : appearance.iconStyle}
                                    >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default NativelyInterface;
