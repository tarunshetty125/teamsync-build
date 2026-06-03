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
    Code2,
    Copy,
    Check,
    PointerOff,
    BookOpen,
    Cpu,
    FileText,
    Layers,
    DollarSign,
    TrendingUp,
    Target,
    Users,
    Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
// import { ModelSelector } from './ui/ModelSelector'; // REMOVED
import TopPill from './ui/TopPill';
import RollingTranscript from './ui/RollingTranscript';
import ProContextBar from './ui/ProContextBar';
import CodeBlock from './ui/CodeBlock';
import MermaidRenderer from './ui/MermaidRenderer';
import { PremiumResponseCard } from './ui/PremiumResponseCard';
import { SkeletonLoader, EmptyListeningState, ErrorFallback } from './ui/PremiumStates';
import { SignalDiscoveryNudge } from './ui/IntelligenceDiscovery';
import ScreenScanOverlay, { type ScreenScanOverlayMode, type ScreenScanOverlayPhase } from './ScreenScanOverlay';
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
import type { ModeTemplateId } from '../lib/modes/types';
import { getTranscriptDisplayLabel } from '../utils/transcriptSpeakers';
import {
    getOverlayQuickActions,
    getRecommendedOverlayAction,
    resolveOverlayCopilotMode,
    MODE_DISPLAY_LABELS,
    type OverlayQuickActionDef,
    type OverlayRecommendationId,
} from '../lib/modes/overlayCopilotConfig';
import { detectRealtimeMode } from '../lib/overlay/overlayIntent';

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
    intelligenceMetadata?: {
        confidenceTier?: 'high' | 'moderate' | 'low';
        confidencePercent?: number;
        signalCount?: number;
        signals?: readonly { readonly label: string }[];
        memoryCount?: number;
    };
}

type ChipVariant = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';
interface ResponseChip { label: string; variant: ChipVariant; }

type InsightToneKey =
    | 'general'
    | 'technical'
    | 'sales'
    | 'recruiting'
    | 'team'
    | 'lecture'
    | 'job';

type RequestLifecycleStatus = 'streaming' | 'completed' | 'failed' | 'cancelled';

interface RequestLifecycle {
    requestId: string;
    messageId: string;
    status: RequestLifecycleStatus;
    intent?: string;
    questionTurnId?: string | null;
    startedAt: number;
}

interface ScreenScanOverlayState {
    visible: boolean;
    phase: ScreenScanOverlayPhase;
    requestId: string | null;
    mode: ScreenScanOverlayMode;
    answer: string;
    chips: ResponseChip[];
    expanded: boolean;
}

function hasNegotiationScriptAvailable(aotState?: any, profileData?: any): boolean {
    return Boolean(
        aotState?.negotiation?.exists ||
        profileData?.aot?.negotiation_script ||
        profileData?.negotiationScript
    );
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

function normalizeInsightSections(text: string): string {
    return text.replace(
        /^(Summary|Why this answer|Say this|Risk\s*\/\s*Tradeoff|Risk|Tradeoff|Next question|Next step|Action items?|Key takeaway|Why it matters)\s*:\s*/gim,
        '\n### $1\n'
    );
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

interface TeamSyncInterfaceProps {
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

const OVERLAY_HIDE_ANIMATION_MS = 240;

// ── Salary / negotiation keyword detection (shared across all input paths) ──
const SALARY_PATTERNS: RegExp[] = [
    /\bsalary\b/i,
    /\bcompensation\b/i,
    /\btotal\s*comp/i,
    /\b(?:salary|pay)\s*expect/i,
    /\bexpect.*(?:salary|pay|comp)/i,
    /\bpackage\b/i,
    /\boffer\b/i,
    /\bctc\b/i,
    /\bin[\s-]?hand/i,
    /\bnegotiat/i,
    /\bhow much.*(?:pay|earn|make|want|expect)/i,
    /\bwhat.*(?:pay|earning|making|expect)/i,
    /\bcurrent.*(?:salary|ctc|comp)/i,
    /\bexpected.*(?:salary|ctc|comp)/i,
];
function isSalaryRelatedText(text: string): boolean {
    return text.length >= 5 && SALARY_PATTERNS.some(p => p.test(text));
}

function getSuggestedAnswerIntent(question: string): string {
    if (question === 'Code Hint') return 'code_hint';
    if (question === 'Brainstorming Approaches') return 'brainstorm';
    return 'what_to_answer';
}

// ── Context-Aware Question Type Detection (mirrors IntentClassifier patterns) ──
type DetectedQuestionType = 'coding' | 'system_design' | 'behavioral' | 'follow_up' | 'salary' | 'general';
type SessionMode = DetectedQuestionType | 'salary';

type ActionIntent =
    | 'what_to_answer'
    | 'recap'
    | 'clarify'
    | 'brainstorm'
    | 'follow_up_questions'
    | 'answer_now';

type OverlaySessionState = {
    currentMode: SessionMode;
};

function getScreenScanModeForSessionMode(mode: SessionMode): 'coding' | 'interview_question' | 'ui_general' {
    if (mode === 'coding') return 'coding';
    if (mode === 'general') return 'ui_general';
    return 'interview_question';
}

// M3 Fix: Removed /g flags — these are always wrapped in new RegExp(..., 'gi') via cap()
const REGEX_NORMALIZE_BROKEN = /(\w)\.\s+(\w)/;
const REGEX_NORMALIZE_FILLER = /\b(yeah|um|uh|uh+m|like|so|okay|ok|well|you know|i mean|basically|actually|right)\b/;
const REGEX_NORMALIZE_SPACE = /\s+/;

const REGEX_CODING_CORE = /(write code|write a? ?(?:function|program|method|class|script)|implement|how to code)/;
const REGEX_SYSTEM_DIRECT = /\b(system design|design (?:a|an|the)\s+(?:system|backend|architecture|platform|service|app|api|database|cache|queue|notification|feed|timeline|search|payments?|booking|ride(?:-|\s)?sharing(?: platform)?|rideshare|url shortener|chat|messaging|social network|streaming|video|marketplace|e ?commerce|storage|distributed system)|(?:design|build|scale|architect)\s+(?:twitter|instagram|uber|netflix|youtube|whatsapp|slack|discord|flipkart|swiggy|zomato|amazon|paytm|upi|google drive|dropbox|stripe)(?:\s+(?:backend|system|architecture|platform|service|app))?|redesign (?:the )?(?:backend|system|architecture|platform|service|app)|architecture of (?:the )?(?:system|backend|platform|service|app|database)|build(?:ing)? (?:a|an|the)\s+(?:platform|system|backend|service|app|api|database|cache|queue|notification|feed|timeline|search|payments?|booking|ride(?:-|\s)?sharing(?: platform)?|rideshare|url shortener|chat|messaging|social network))\b/;
const REGEX_SYSTEM_ARCH = /\b(backend|front ?end|service|services|distributed|microservice|api gateway|gateway|queue|message queue|event[-\s]?driven|cache|caching|redis|kafka|database|db|storage|partition|replication|shard(?:ing)?|load balanc(?:er|ing)|cdn|edge|availability|consistency|latency|throughput|qps|rps|slo|sla|index(?:es)?|read write|read\/write|pipeline|worker|job queue|cron|batch|stream(?:ing)?|pub ?sub|pubsub)\b/;
const REGEX_SYSTEM_SCALE = /\b(scale|scaling|scalable|millions?(?: of)? users?|billions?(?: of)? users?|100m users?|10m users?|users? at scale|traffic|spike|spikes|burst|high traffic|peak traffic|performance|bottleneck|concurren|throughput|latency|qps|rps|requests per second|low latency|high throughput|capacity|growth|high load|load spike|load test|sudden(?:ly)? (?:spike|traffic|load)|traffic surge|surge|fault toleran|redundan|high availability|\bha\b|\d+\s*(?:k|m|b|thousand|million|billion))\b/;
const REGEX_SYSTEM_FRAMING = /\b(suppose|imagine|let s say|lets say|what if|consider|assume|scenario|in production|real[-\s]?world|in the real world|if suddenly|suddenly|at scale|in practice|what would happen|what happens|how would(?: you| we| this| the system)?|walk me through (?:the )?(?:architecture|system|backend|design)|talk through (?:the )?(?:architecture|system|backend|design))\b/;
const REGEX_SYSTEM_REASONING = /\b(tradeoff|trade-?off|pros? and cons|optimiz|handle|redesign|architecture|improv|fail(?:ed|ure|s)?|failure|fallback|retry|retries|recover|recovery|failover|avoid downtime|downtime|single point of failure|consistency|availability|durability|reliability|fault toleran|resilien|degrad|graceful|circuit breaker|rate limit|idempotent|backoff|queueing|bottleneck)\b/;
const REGEX_NON_SYSTEM_DESIGN = /\b(singleton|factory|observer|strategy|decorator|adapter|prototype|builder|solid|oop|object oriented|design patterns?|class diagram|uml|inheritance|polymorphism|encapsulation|bfs|dfs|binary tree|tree traversal|traversal|dynamic programming|dp\b|algorithm|leetcode|database normalization|normalization|normal forms?|1nf|2nf|3nf)\b/;
const REGEX_BEHAVIORAL_CORE = /(tell me about a time|describe a situation|give me an example|share an experience|tell me about yourself|introduce yourself|walk me through (?:your )?(?:background|resume)|background|resume|personal experience|worked on|built|developed|impact|result|outcome)/;

const REGEX_CODING_STRONG = /(algorithm|debug this|snippet|boilerplate|optimize|refactor|array|linked list|tree|graph|stack|queue|hash ?map|binary search|dynamic programming|recursion|time complexity|space complexity)/;
const REGEX_BEHAVIORAL_STRONG = /(when have you|biggest challenge|how did you handle|conflict with|leadership|teamwork|failure|mistake|difficult decision|star method|tell me about|tell me about yourself|experience|challenge|conflict|pressure|strength|strengths|weakness|weaknesses|mentor|disagree|feedback|prioriti[zs]e|deadline|collaborate|accomplishment|introduce yourself|background|resume|project|projects|worked on|built|developed|owned|ownership|impact|result|results|outcome|outcomes|personal)/;
const REGEX_FOLLOW_UP_CORE = /(what happened next|then what|and after that|what.s next|how did that go|can you elaborate|tell me more|go deeper|expand on)/;
const REGEX_FOLLOW_UP_STRONG = /(follow.?up|continuation|building on|going back to|earlier you said|you mentioned)/;

const REGEX_CODING_BOOST = /(faster|efficient)/;
const SYSTEM_SIGNAL_MIN_BUCKETS = 2;
const SYSTEM_SIGNAL_MIN_SCORE = 3;
const SYSTEM_FAST_SWITCH_SCORE = 5;
const INTENT_TRANSCRIPT_SEGMENTS = 8;
const INTENT_TRANSCRIPT_MAX_CHARS = 1200;

type SystemSignalScore = {
    score: number;
    bucketHits: number;
    strong: boolean;
    directHits: number;
    archHits: number;
    scaleHits: number;
    framingHits: number;
    reasoningHits: number;
};

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

function scoreSystemDesignSignals(cap: (regex: RegExp) => number): SystemSignalScore {
    const directHits = cap(REGEX_SYSTEM_DIRECT);
    const archHits = cap(REGEX_SYSTEM_ARCH);
    const scaleHits = cap(REGEX_SYSTEM_SCALE);
    const framingHits = cap(REGEX_SYSTEM_FRAMING);
    const reasoningHits = cap(REGEX_SYSTEM_REASONING);

    const bucketHits = [directHits, archHits, scaleHits, framingHits, reasoningHits].filter((v) => v > 0).length;
    const score =
        directHits * 4
        + archHits * 2
        + scaleHits * 2
        + reasoningHits * 1.5
        + framingHits;
    const strong =
        directHits > 0
        || (archHits > 0 && scaleHits > 0 && reasoningHits > 0)
        || (archHits >= 2 && (framingHits > 0 || reasoningHits > 0))
        || (archHits > 0 && reasoningHits >= 2);

    return {
        score,
        bucketHits,
        strong,
        directHits,
        archHits,
        scaleHits,
        framingHits,
        reasoningHits,
    };
}

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

function detectQuestionType(
    text: string,
    currentType: DetectedQuestionType,
    lastStrongType: DetectedQuestionType
): { nextType: DetectedQuestionType; nextStrong?: DetectedQuestionType } {
    return detectRealtimeMode(text, currentType, lastStrongType);
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

const TeamSyncInterface: React.FC<TeamSyncInterfaceProps> = ({
    onEndMeeting,
    overlayOpacity = OVERLAY_OPACITY_DEFAULT,
    hasProContextAccess = false,
}) => {
    const isLightTheme = useResolvedTheme() === 'light';
    const [session, setSession] = useState<OverlaySessionState>({ currentMode: 'general' });
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
            const [, aotState, profileData] = await Promise.all([
                window.electronAPI?.profileGetNegotiationState?.(),
                window.electronAPI?.getAOTState?.(),
                window.electronAPI?.profileGetProfile?.(),
            ]);
            const scriptAvailable = hasNegotiationScriptAvailable(aotState, profileData);

            setHasNegotiationScript(scriptAvailable);
            // Always start OFF on fresh mount. Salary detection will auto-enable when needed.
            if (window.electronAPI?.profileSetNegotiationContextEnabled) {
                await window.electronAPI.profileSetNegotiationContextEnabled(false).catch(() => {});
            }
            setNegotiationContextEnabled(false);
        } catch {
            setNegotiationContextEnabled(false);
            setHasNegotiationScript(false);
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
            }).catch(() => { });
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
        if (window.electronAPI?.onProfileUpdated) {
            unsubscribers.push(window.electronAPI.onProfileUpdated(() => {
                void refreshNegotiationContextState();
            }));
        }
        return () => {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };
    }, [refreshNegotiationContextState]);

    useEffect(() => {
        let mounted = true;
        window.electronAPI?.getSessionMode?.()
            .then((result) => {
                if (!mounted || !result?.mode) return;
                setSession({ currentMode: result.mode });
            })
            .catch(() => { });

        const unsubscribe = window.electronAPI?.onSessionModeChanged?.((data) => {
            if (!data?.mode) return;
            setSession({ currentMode: data.mode });
        });

        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, []);

    // Source label tracking: set by handlers, read by stream listeners
    const currentSourceRef = useRef<string | undefined>(undefined);

    const sourceStyleMap: Record<string, { light: string; dark: string }> = {
        'What to Answer': { light: 'bg-blue-100/80 text-blue-700 border-blue-200/60', dark: 'bg-blue-500/15 text-blue-300 border-blue-400/25' },
        'Clarify': { light: 'bg-amber-100/80 text-amber-700 border-amber-200/60', dark: 'bg-amber-500/15 text-amber-300 border-amber-400/25' },
        'Follow Up': { light: 'bg-emerald-100/80 text-emerald-700 border-emerald-200/60', dark: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25' },
        'Recap': { light: 'bg-teal-100/80 text-teal-700 border-teal-200/60', dark: 'bg-teal-500/15 text-teal-300 border-teal-400/25' },
        'Follow Up Questions': { light: 'bg-cyan-100/80 text-cyan-700 border-cyan-200/60', dark: 'bg-cyan-500/15 text-cyan-300 border-cyan-400/25' },
        'Code Hint': { light: 'bg-purple-100/80 text-purple-700 border-purple-200/60', dark: 'bg-purple-500/15 text-purple-300 border-purple-400/25' },
        'Brainstorm': { light: 'bg-pink-100/80 text-pink-700 border-pink-200/60', dark: 'bg-pink-500/15 text-pink-300 border-pink-400/25' },
        'Screen Scan': { light: 'bg-orange-100/80 text-orange-700 border-orange-200/60', dark: 'bg-orange-500/15 text-orange-300 border-orange-400/25' },
        'System Design Trade-offs': { light: 'bg-emerald-100/80 text-emerald-700 border-emerald-200/60', dark: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25' },
        'Answer Now': { light: 'bg-indigo-100/80 text-indigo-700 border-indigo-200/60', dark: 'bg-indigo-500/15 text-indigo-300 border-indigo-400/25' },
        'Manual Input': { light: 'bg-slate-100/80 text-slate-600 border-slate-200/60', dark: 'bg-slate-500/15 text-slate-300 border-slate-400/25' },
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
        'Screen Scan': '🔍',
        'System Design Trade-offs': '⚖️',
        'Answer Now': '⚡',
        'Manual Input': '⌨️',
    };
    const [isExpanded, setIsExpanded] = useState(true);
    const [inputValue, setInputValue] = useState('');
    const { shortcuts, isShortcutPressed } = useShortcuts();
    const [messages, setMessages] = useState<Message[]>([]);
    const [screenScanOverlay, setScreenScanOverlay] = useState<ScreenScanOverlayState>({
        visible: false,
        phase: 'hidden',
        requestId: null,
        mode: 'ui_general',
        answer: '',
        chips: [],
        expanded: false,
    });
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
        const stored = localStorage.getItem('teamsync_interviewer_transcript');
        return stored !== 'false';
    });

    // Analytics State
    const requestStartTimeRef = useRef<number | null>(null);
    const screenScanDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeScanRequestIdRef = useRef<string | null>(null);
    const isScreenScanInFlightRef = useRef(false);
    const handleScreenScanRef = useRef<() => Promise<void>>(async () => { });
    const activeIntentRequestIdsRef = useRef<Record<string, string>>({});
    const activeChatRequestIdRef = useRef<string | null>(null);
    const activeRagRequestIdRef = useRef<string | null>(null);
    const activeUiRequestIdRef = useRef<string | null>(null);
    const activeOverlayAbortRef = useRef<AbortController | null>(null);
    const requestRegistryRef = useRef<Record<string, RequestLifecycle>>({});
    const currentQuestionTurnIdRef = useRef<string | null>(null);
    const intelligenceTimelineRef = useRef<{ signals: any[]; batchId: string; timestamp: number } | null>(null);
    const intelligenceExplanationRef = useRef<any>(null);
    const intelligenceModeSuggestionRef = useRef<{ predictedMode: string; predictedModeName: string; currentMode: string; confidence: number; timestamp: number } | null>(null);
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

    const resolveSuggestedAnswerRequest = useCallback((data: { question?: string; intent?: string; requestId?: string | null }) => {
        if (data.requestId) {
            const lifecycle = requestRegistryRef.current[data.requestId];
            if (lifecycle?.intent) {
                return { intent: lifecycle.intent, requestId: data.requestId };
            }
            if (data.intent && activeIntentRequestIdsRef.current[data.intent] === data.requestId) {
                return { intent: data.intent, requestId: data.requestId };
            }
        }

        const fallbackIntent = data.intent || (data.question ? getSuggestedAnswerIntent(data.question) : null);
        if (!fallbackIntent) return null;

        const fallbackRequestId = resolveIntentRequestId(fallbackIntent);
        if (!fallbackRequestId) return null;

        return { intent: fallbackIntent, requestId: fallbackRequestId };
    }, [resolveIntentRequestId]);

    const updateRequestLifecycle = useCallback((requestId: string, patch: Partial<RequestLifecycle>) => {
        const current = requestRegistryRef.current[requestId];
        if (!current) return;
        requestRegistryRef.current[requestId] = { ...current, ...patch };
    }, []);

    const clearScreenScanDismissTimer = useCallback(() => {
        if (screenScanDismissTimerRef.current) {
            clearTimeout(screenScanDismissTimerRef.current);
            screenScanDismissTimerRef.current = null;
        }
    }, []);

    const hideScreenScanOverlay = useCallback(() => {
        clearScreenScanDismissTimer();
        setScreenScanOverlay({
            visible: false,
            phase: 'hidden',
            requestId: null,
            mode: 'ui_general',
            answer: '',
            chips: [],
            expanded: false,
        });
    }, [clearScreenScanDismissTimer]);

    const showScreenScanOverlayPhase = useCallback((
        requestId: string,
        phase: Exclude<ScreenScanOverlayPhase, 'hidden'>,
        patch?: Partial<ScreenScanOverlayState>,
    ) => {
        clearScreenScanDismissTimer();
        setScreenScanOverlay((prev) => ({
            visible: true,
            phase,
            requestId,
            mode: patch?.mode ?? prev.mode ?? 'ui_general',
            answer: patch?.answer ?? '',
            chips: patch?.chips ?? [],
            expanded: patch?.expanded ?? false,
        }));
    }, [clearScreenScanDismissTimer]);

    const showScreenScanResult = useCallback((requestId: string, mode: ScreenScanOverlayMode, answer: string, chips: ResponseChip[] = []) => {
        clearScreenScanDismissTimer();
        setScreenScanOverlay((current) => current.requestId === requestId ? {
            visible: false,
            phase: 'hidden',
            requestId: null,
            mode,
            answer,
            chips,
            expanded: false,
        } : current);
    }, [clearScreenScanDismissTimer]);

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

    useEffect(() => {
        return () => {
            clearScreenScanDismissTimer();
            activeOverlayAbortRef.current?.abort();
            if (recommendationTimerRef.current) {
                clearTimeout(recommendationTimerRef.current);
                recommendationTimerRef.current = null;
            }
        };
    }, [clearScreenScanDismissTimer]);

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && screenScanOverlay.visible) {
                hideScreenScanOverlay();
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [hideScreenScanOverlay, screenScanOverlay.visible]);

    // Sync transcript setting
    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('teamsync_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const [rollingTranscript, setRollingTranscript] = useState('');  // For interviewer rolling text bar
    const [rollingTranscriptSpeakerLabel, setRollingTranscriptSpeakerLabel] = useState('');
    const finalizedTranscriptRef = useRef(''); // C6 Fix: Tracks finalized transcript separately from partials
    // Holds the merged interviewer turn (consecutive segments within a 15s gap).
    // Updated exclusively when transcript.final === true so interim partials never appear.
    const [lastFinalSentence, setLastFinalSentence] = useState('');
    const lastFinalSentenceRef = useRef(''); // stable ref for session-reset without stale closure
    // Rolling turn accumulator: tracks timestamp of last finalized interviewer segment
    // to decide whether to merge or start a new turn
    const lastInterviewerFinalTimestampRef = useRef<number>(0);
    const INTERVIEWER_TURN_GAP_MS = 15_000; // 15s — same as backend SessionTracker
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
    const overlayHideTimerRef = useRef<number | null>(null);
    const suppressOverlayResizeRef = useRef(false);
    const lastOverlayDimensionsRef = useRef<{ width: number; height: number } | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const userHasScrolledRef = useRef(false);
    const [showJumpButton, setShowJumpButton] = useState(false);
    const [showScrollUpButton, setShowScrollUpButton] = useState(false);
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
        const stored = localStorage.getItem('teamsync_hideChatHidesWidget');
        return stored ? stored === 'true' : true;
    });

    // Active mode name (shown as a badge near the Modes button)
    const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);
    const [activeModeTemplateId, setActiveModeTemplateId] = useState<ModeTemplateId | null>(null);
    const [isMeetingActive, setIsMeetingActive] = useState(false);

    useEffect(() => {
        // Load initial active mode metadata
        window.electronAPI?.modesGetActive?.()
            .then((mode) => {
                setActiveModeLabel(mode?.name ?? null);
                setActiveModeTemplateId((mode?.templateType as ModeTemplateId | null | undefined) ?? null);
            })
            .catch(() => { });
        // Live-update whenever mode is activated/deactivated
        const unsub = window.electronAPI?.onModeChanged?.((data: { id: string | null; name: string | null; templateId?: string | null }) => {
            setActiveModeLabel(data.name);
            setActiveModeTemplateId((data.templateId as ModeTemplateId | null | undefined) ?? null);
        });
        return () => unsub?.();
    }, []);

    // Model Selection State
    const [currentModel, setCurrentModel] = useState<string>('gemini-3-flash-preview');
    const currentModelRef = useRef(currentModel); // C3 Fix: Ref for analytics in mount-only streaming effect

    // ── User-Controlled Mode + Recommendation Hints ──
    const [intentState, dispatchIntent] = useReducer(intentReducer, {
        detectedType: 'general',
        lastStrongType: 'general',
        lastStrongAt: performance.now(),
        seq: 0
    });
    const [recommendedButton, setRecommendedButton] = useState<OverlayRecommendationId>('what_to_answer');
    const recommendedButtonRef = useRef<OverlayRecommendationId>('what_to_answer');

    // Brainstorm/Recap toggle — persisted in localStorage
    const [brainstormEnabled, setBrainstormEnabled] = useState<boolean>(() => {
        try { return localStorage.getItem('teamsync_brainstorm_enabled') !== 'false'; } catch { return true; }
    });
    useEffect(() => {
        localStorage.setItem('teamsync_brainstorm_enabled', String(brainstormEnabled));
    }, [brainstormEnabled]);

    // Cross-window sync: listen for Interview Mode toggle changes from SettingsPopup
    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('teamsync_brainstorm_enabled');
            const val = stored !== 'false';
            setBrainstormEnabled(val);
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const recommendationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recommendationLockTurnIdRef = useRef<string | null>(null);
    const screenContextTextRef = useRef('');
    const fourthActionHandlerRef = useRef<() => void | Promise<void>>(() => { });

    const detectedQuestionType = intentState.detectedType;
    const currentSessionMode = session.currentMode;
    const recommendationMode: SessionMode =
        currentSessionMode === 'system_design' ? 'system_design' : detectedQuestionType;
    const overlayCopilotMode = useMemo(
        () => resolveOverlayCopilotMode(isMeetingActive ? activeModeTemplateId : 'general', isMeetingActive ? recommendationMode : 'general'),
        [activeModeTemplateId, isMeetingActive, recommendationMode]
    );

    useEffect(() => {
        console.log('[MODE_DEBUG]', JSON.stringify({
            templateId: activeModeTemplateId,
            recommendationMode,
            liveOverlayCopilotMode: overlayCopilotMode,
            sessionMode: currentSessionMode,
            finalResolvedMode: overlayCopilotMode,
            sessionModeLocked: currentSessionMode !== 'general',
            overlayVersion: 'v1',
            source: currentSourceRef.current,
            renderReason: 'mode_state_changed',
        }));
    }, [activeModeTemplateId, recommendationMode, overlayCopilotMode, currentSessionMode]);

    const resetOverlayRecommendationState = useCallback(() => {
        if (recommendationTimerRef.current) {
            clearTimeout(recommendationTimerRef.current);
            recommendationTimerRef.current = null;
        }
        recommendationLockTurnIdRef.current = null;
        currentQuestionTurnIdRef.current = null;
        setCurrentQuestionTurnId('');
        latestCombinedRef.current = '';
        screenContextTextRef.current = '';
        recommendedButtonRef.current = 'what_to_answer';
        setRecommendedButton('what_to_answer');
        setSession({ currentMode: 'general' });
        dispatchIntent({ type: 'RESET' });
        seqRef.current = 0;
        hideScreenScanOverlay();
    }, [hideScreenScanOverlay]);

    // Compute dynamic button labels based on active TeamSync mode and brainstorm toggle
    const activeQuickActions = useMemo(
        () => getOverlayQuickActions(overlayCopilotMode, brainstormEnabled),
        [overlayCopilotMode, brainstormEnabled]
    );

    useEffect(() => {
        if (currentSessionMode !== 'general') {
            console.log('[Realtime Overlay] Session mode locked by user:', currentSessionMode);
        }
    }, [currentSessionMode]);

    useEffect(() => {
        if (process.env.NODE_ENV !== 'development') return;
        if (detectedQuestionType === currentSessionMode) return;
        console.debug('[Realtime Overlay] Ignoring transcript mode mismatch', {
            detectedIntent: detectedQuestionType,
            sessionMode: currentSessionMode,
        });
    }, [currentSessionMode, detectedQuestionType]);

    const latestCombinedRef = useRef<string>('');
    const seqRef = useRef(0);

    const markCurrentTurnFromText = useCallback((text: string, source: 'manual_input' | 'transcript') => {
        const combined = text.trim();
        if (combined.length < 3) return;

        recommendationLockTurnIdRef.current = null;
        latestCombinedRef.current = combined;
        lastFinalSentenceRef.current = combined;
        const questionTurnId = nextRequestId('question-turn');
        currentQuestionTurnIdRef.current = questionTurnId;
        setCurrentQuestionTurnId(questionTurnId);
        const seq = ++seqRef.current;
        console.log('[MODE_PIPELINE]', JSON.stringify({
            source,
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
    }, [intentState.detectedType]);

    const recomputeIntentFromFinalTranscript = useCallback((questionTurnId: string) => {
        const combined = buildIntentTranscriptWindow(
            finalizedTranscriptRef.current,
            lastFinalSentenceRef.current,
        );
        if (combined.length < 3) return;

        recommendationLockTurnIdRef.current = null;
        latestCombinedRef.current = combined;
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
            seq
        });
    }, [intentState.detectedType]);

    const previousDetectedQuestionTypeRef = useRef<SessionMode>('general');
    useEffect(() => {
        if (previousDetectedQuestionTypeRef.current === detectedQuestionType) return;
        console.log('[MODE_PIPELINE]', JSON.stringify({
            source: currentSourceRef.current === 'Manual Input' ? 'manual_input' : 'transcript',
            input: latestCombinedRef.current || lastFinalSentenceRef.current,
            detectedMode: detectedQuestionType,
            previousMode: previousDetectedQuestionTypeRef.current,
            nextMode: recommendationMode,
        }));
        previousDetectedQuestionTypeRef.current = detectedQuestionType;
    }, [detectedQuestionType, recommendationMode]);

    useEffect(() => {
        screenContextTextRef.current = screenScanOverlay.answer || '';
    }, [screenScanOverlay.answer]);

    useEffect(() => {
        if (!currentQuestionTurnId) return;
        if (recommendationLockTurnIdRef.current === currentQuestionTurnId) return;

        if (recommendationTimerRef.current) {
            clearTimeout(recommendationTimerRef.current);
        }

        recommendationTimerRef.current = setTimeout(() => {
            if (recommendationLockTurnIdRef.current === currentQuestionTurnId) return;

            const combined = normalizeTranscript(`${lastFinalSentenceRef.current || ''} ${screenContextTextRef.current || ''}`.trim());
            const nextRecommendation = getRecommendedOverlayAction(overlayCopilotMode, combined);

            if (nextRecommendation !== recommendedButtonRef.current) {
                recommendedButtonRef.current = nextRecommendation;
                setRecommendedButton(nextRecommendation);
            }
        }, 300);

        return () => {
            if (recommendationTimerRef.current) {
                clearTimeout(recommendationTimerRef.current);
                recommendationTimerRef.current = null;
            }
        };
    }, [currentQuestionTurnId, overlayCopilotMode, screenScanOverlay.answer]);

    // ── Auto-detect salary questions and toggle negotiation context ──
    const negotiationAutoEnabledRef = useRef(false);
    useEffect(() => {
        if (!currentQuestionTurnId || !hasProContextAccess || !hasNegotiationScript) return;

        const text = lastFinalSentenceRef.current?.trim() || '';
        if (text.length < 5) return;

        const isSalary = isSalaryRelatedText(text);

        if (isSalary && !negotiationContextEnabled) {
            negotiationAutoEnabledRef.current = true;
            handleToggleNegotiationContext(true);
            console.log(`[Overlay] Auto-enabled negotiation context — salary keyword detected source=transcript textLength=${text.length} redacted=true`);
        } else if (!isSalary && negotiationAutoEnabledRef.current && negotiationContextEnabled) {
            negotiationAutoEnabledRef.current = false;
            handleToggleNegotiationContext(false);
            console.log(`[Overlay] Auto-disabled negotiation context — non-salary question source=transcript textLength=${text.length} redacted=true`);
        }
    }, [currentQuestionTurnId, hasProContextAccess, hasNegotiationScript, negotiationContextEnabled, handleToggleNegotiationContext]);

    const cancelInFlightOverlayRequests = useCallback(async (nextRequestId?: string) => {
        const streamingRequestIds = Object.values(requestRegistryRef.current)
            .filter((request) => request.status === 'streaming' && request.requestId !== nextRequestId)
            .map((request) => request.requestId);

        streamingRequestIds.forEach((requestId) => cancelRequestMessage(requestId));

        const targetedCancellationIds = new Set<string>();
        streamingRequestIds.forEach((requestId) => targetedCancellationIds.add(requestId));
        if (activeUiRequestIdRef.current && activeUiRequestIdRef.current !== nextRequestId) {
            targetedCancellationIds.add(activeUiRequestIdRef.current);
        }
        if (activeScanRequestIdRef.current && activeScanRequestIdRef.current !== nextRequestId) {
            targetedCancellationIds.add(activeScanRequestIdRef.current);
        }

        Object.entries(activeIntentRequestIdsRef.current).forEach(([intent, requestId]) => {
            if (!requestId || requestId === nextRequestId) return;
            const lifecycle = requestRegistryRef.current[requestId];
            if (lifecycle?.status !== 'completed') {
                delete activeIntentRequestIdsRef.current[intent];
            }
        });

        await Promise.allSettled([
            window.electronAPI.cancelGeminiChatStream?.(),
            ...Array.from(targetedCancellationIds).map((requestId) =>
                window.electronAPI.cancelIntelligenceByRequest?.(requestId)
            ),
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
        if (!nextRequestId || screenScanOverlay.requestId !== nextRequestId) {
            hideScreenScanOverlay();
        }
        if (!nextRequestId || activeScanRequestIdRef.current !== nextRequestId) {
            activeScanRequestIdRef.current = null;
            isScreenScanInFlightRef.current = false;
        }
    }, [cancelRequestMessage, hideScreenScanOverlay, screenScanOverlay.requestId]);

    const runAction = useCallback(async (
        intent: ActionIntent,
        options?: {
            source: string;
            analyticsKey: string;
            message?: string;
            additionalContext?: string;
            imagePaths?: string[];
            profilePreference?: 'default' | 'force_on' | 'force_off';
            userBubbleText?: string;
            screenshotPreview?: string;
        }
    ) => {
        const controller = new AbortController();
        activeOverlayAbortRef.current?.abort();
        activeOverlayAbortRef.current = controller;

        await cancelInFlightOverlayRequests();
        if (controller.signal.aborted) return null;

        setIsExpanded(true);
        currentSourceRef.current = options?.source;
        analytics.trackCommandExecuted(options?.analyticsKey ?? intent);

        const requestId = nextRequestId(intent);
        markRequestProcessing(requestId);
        rememberIntentRequest(intent, requestId);
        const latestFinalQuestion =
            lastFinalSentenceRef.current.trim()
            || finalizedTranscriptRef.current.split('  ·  ').pop()?.trim()
            || '';
        const resolvedMessage = options?.message?.trim()
            || (intent === 'recap' ? '' : latestFinalQuestion);

        if (options?.userBubbleText || options?.screenshotPreview) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'user',
                text: options?.userBubbleText || options?.message || '',
                hasScreenshot: Boolean(options?.screenshotPreview),
                screenshotPreview: options?.screenshotPreview,
            }]);
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        }

        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent,
            source: options?.source,
            isStreaming: true,
        });

        // Auto-scroll to the new response — the user explicitly clicked an action
        // button, so they expect to see the new AI output even if they scrolled up.
        userHasScrolledRef.current = false;
        setShowJumpButton(false);
        setUnreadCount(0);
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        try {
            requestStartTimeRef.current = Date.now();
            await window.electronAPI.generateAction({
                intent,
                message: resolvedMessage || undefined,
                additionalContext: options?.additionalContext,
                imagePaths: options?.imagePaths,
                requestId,
                profilePreference: options?.profilePreference,
            });
            return requestId;
        } catch (err) {
            if (!controller.signal.aborted) {
                clearProcessingForRequest(requestId);
                rememberIntentRequest(intent, null);
                failRequestMessage(requestId, `❌ Error starting stream: ${err}`);
            }
            return null;
        } finally {
            if (activeOverlayAbortRef.current === controller) {
                activeOverlayAbortRef.current = null;
            }
        }
    }, [
        beginStreamingMessage,
        cancelInFlightOverlayRequests,
        clearProcessingForRequest,
        failRequestMessage,
        markRequestProcessing,
        rememberIntentRequest,
    ]);

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

    const pushOverlayDimensions = useCallback((target: Element | null, options?: { force?: boolean }) => {
        if (!target) return;
        if (suppressOverlayResizeRef.current && !options?.force) return;

        const rect = target.getBoundingClientRect();
        const width = Math.ceil(rect.width);
        const height = Math.ceil(rect.height);
        if (!width || !height) return;

        const previousDimensions = lastOverlayDimensionsRef.current;
        if (
            previousDimensions &&
            previousDimensions.width === width &&
            previousDimensions.height === height
        ) {
            return;
        }

        lastOverlayDimensionsRef.current = { width, height };
        window.electronAPI?.updateContentDimensions({ width, height });
    }, []);

    // Classic overlay: keep main-process default dimensions at v1 (600px). Pro v2 registers separately.
    useEffect(() => {
        window.electronAPI?.setOverlayV2Layout?.(false).catch(() => { });
    }, []);

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
        localStorage.setItem('teamsync_undetectable', String(isUndetectable));
        localStorage.setItem('teamsync_hideChatHidesWidget', String(hideChatHidesWidget));
    }, [isUndetectable, hideChatHidesWidget]);

    // Mouse Passthrough State
    const [isOverlayDragging, setIsOverlayDragging] = useState(false);
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    const [localOpacity, setLocalOpacity] = useState(overlayOpacity);
    useEffect(() => {
        window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => { });
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
        }).catch(() => { });

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
                pushOverlayDimensions(entry.target);
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, [pushOverlayDimensions]);

    // Force resize when attachedContext changes (screenshots added/removed)
    useEffect(() => {
        if (!contentRef.current) return;
        // Let the DOM settle, then measure and push new dimensions
        requestAnimationFrame(() => {
            pushOverlayDimensions(contentRef.current, { force: true });
        });
    }, [attachedContext, pushOverlayDimensions]);

    // Force initial sizing safety check
    useEffect(() => {
        const timer = setTimeout(() => {
            pushOverlayDimensions(contentRef.current, { force: true });
        }, 600);
        return () => clearTimeout(timer);
    }, [pushOverlayDimensions]);

    useEffect(() => {
        if (!window.electronAPI?.onOverlayDragStateChanged) return;

        const unsubscribe = window.electronAPI.onOverlayDragStateChanged((dragging) => {
            setIsOverlayDragging(prev => (prev === dragging ? prev : dragging));

            if (dragging) {
                suppressOverlayResizeRef.current = true;
                return;
            }

            if (!isExpanded || overlayHideTimerRef.current) return;

            suppressOverlayResizeRef.current = false;
            requestAnimationFrame(() => {
                pushOverlayDimensions(contentRef.current, { force: true });
            });
        });

        return () => unsubscribe();
    }, [isExpanded, pushOverlayDimensions]);

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
    recommendedButtonRef.current = recommendedButton;

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
            const isNearTop = scrollTop < 80;
            const hasOverflow = scrollHeight > clientHeight + 80;
            userHasScrolledRef.current = !isNearBottom;
            setShowJumpButton(!isNearBottom);
            setShowScrollUpButton(!isNearTop && hasOverflow);
            if (isNearBottom) setUnreadCount(0);
        };

        container.addEventListener('scroll', handleScroll, { passive: true });
        // Run once to set initial state
        handleScroll();
        return () => container.removeEventListener('scroll', handleScroll);
    }, [messages.length]);

    const scrollToBottom = useCallback(() => {
        const container = scrollContainerRef.current;
        if (container) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
        userHasScrolledRef.current = false;
        setShowJumpButton(false);
        setUnreadCount(0);
    }, []);

    const scrollToTop = useCallback(() => {
        const container = scrollContainerRef.current;
        if (container) {
            container.scrollTo({ top: 0, behavior: 'smooth' });
        }
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
        if (overlayHideTimerRef.current) {
            clearTimeout(overlayHideTimerRef.current);
            overlayHideTimerRef.current = null;
        }

        if (isExpanded) {
            suppressOverlayResizeRef.current = false;
            window.electronAPI.showWindow(isStealthRef.current);
            requestAnimationFrame(() => {
                pushOverlayDimensions(contentRef.current, { force: true });
            });
            isStealthRef.current = false; // Reset back to default
        } else {
            // Freeze the Electron window size during the exit animation so the
            // overlay fades out cleanly instead of snapping down to its empty shell.
            suppressOverlayResizeRef.current = true;
            overlayHideTimerRef.current = window.setTimeout(() => {
                window.electronAPI.hideWindow();
                overlayHideTimerRef.current = null;
            }, OVERLAY_HIDE_ANIMATION_MS + 40);
        }
    }, [isExpanded, pushOverlayDimensions]);

    useEffect(() => {
        return () => {
            if (overlayHideTimerRef.current) {
                clearTimeout(overlayHideTimerRef.current);
            }
        };
    }, []);

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
            console.log('[TeamSyncInterface] Resetting session state...');
            activeOverlayAbortRef.current?.abort();
            void window.electronAPI.cancelGeminiChatStream?.().catch(() => { });
            void window.electronAPI.cancelIntelligenceRequest?.().catch(() => { });
            void window.electronAPI.ragCancelQuery?.({ meetingId: 'live-meeting-current' }).catch(() => { });
            setMessages([]);
            setInputValue('');
            setAttachedContext([]);
            setManualTranscript('');
            setVoiceInput('');
            setIsProcessing(false);
            setRollingTranscript('');
            setRollingTranscriptSpeakerLabel('');
            finalizedTranscriptRef.current = '';
            // Reset last-sentence pill so old question never leaks into new session
            setLastFinalSentence('');
            lastFinalSentenceRef.current = '';
            lastInterviewerFinalTimestampRef.current = 0;
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
            resetOverlayRecommendationState();

            // Track new conversation/session if applicable?
            // Actually 'app_opened' is global, 'assistant_started' is overlay.
            // Maybe 'conversation_started' event?
            analytics.trackConversationStarted();
        });
        return () => unsubscribe();
    }, [resetOverlayRecommendationState]);

    useEffect(() => {
        if (!window.electronAPI?.onMeetingStateChanged) return;
        window.electronAPI.getMeetingActive?.()
            .then((active) => setIsMeetingActive(active))
            .catch(() => { });
        const unsubscribe = window.electronAPI.onMeetingStateChanged(({ isActive }) => {
            setIsMeetingActive(isActive);
            if (!isActive) {
                resetOverlayRecommendationState();
            }
        });
        return () => unsubscribe();
    }, [resetOverlayRecommendationState]);


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
        }).catch(() => { });

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
            const transcriptLabel = getTranscriptDisplayLabel(transcript);
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

            setRollingTranscriptSpeakerLabel(transcriptLabel);

            // Route to rolling transcript bar - accumulate text continuously
            setIsInterviewerSpeaking(!transcript.final);

            if (transcript.final) {
                const now = Date.now();
                // C6 Fix: Append to finalized ref for correct partial handling
                finalizedTranscriptRef.current += (finalizedTranscriptRef.current ? '  ·  ' : '') + transcript.text;
                // C5 Fix: Cap transcript to prevent unbounded memory growth in long sessions
                if (finalizedTranscriptRef.current.length > 5000) {
                    finalizedTranscriptRef.current = finalizedTranscriptRef.current.slice(-5000);
                }
                setRollingTranscript(finalizedTranscriptRef.current);

                // Merge consecutive interviewer segments within a 15s gap
                // so that natural pauses (2-3s) don't split a single question
                const gapSinceLastFinal = now - lastInterviewerFinalTimestampRef.current;
                if (lastInterviewerFinalTimestampRef.current > 0 && gapSinceLastFinal <= INTERVIEWER_TURN_GAP_MS) {
                    // Same turn — append to existing merged text
                    lastFinalSentenceRef.current = lastFinalSentenceRef.current + ' ' + transcript.text;
                } else {
                    // New turn — start fresh
                    lastFinalSentenceRef.current = transcript.text;
                }
                lastInterviewerFinalTimestampRef.current = now;
                setLastFinalSentence(lastFinalSentenceRef.current);

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

        cleanups.push(window.electronAPI.onIntelligenceActionToken((data) => {
            // Manual input already streams through gemini-stream-* IPC.
            // Ignoring the mirrored manual_chat action channel prevents duplicated chunks
            // that corrupt markdown/code fences and break Mermaid rendering.
            if (data.intent === 'manual_chat') return;
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            if (!data.requestId || activeUiRequestIdRef.current !== data.requestId) return;
            appendTokenToRequest(data.requestId, data.token);
        }));

        cleanups.push(window.electronAPI.onIntelligenceActionResult((data) => {
            if (data.intent === 'manual_chat') return;
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            if (!data.requestId) return;
            if (userHasScrolledRef.current) {
                setUnreadCount(prev => prev + 1);
            }
            clearProcessingForRequest(data.requestId);
            try {
                const parsed = JSON.parse(data.content);
                if (parsed?.__negotiationCoaching) {
                    finalizeRequestMessage(data.requestId, '', {
                        isNegotiationCoaching: true,
                        negotiationCoachingData: parsed.__negotiationCoaching,
                    });
                    rememberIntentRequest(data.intent as ActionIntent, null);
                    currentSourceRef.current = undefined;
                    return;
                }
            } catch { }

            const chips = generateResponseChips(data.content, data.intent);

            // Map _intelligence from IPC payload → intelligenceMetadata for PremiumResponseCard
            let intelligenceMetadata: Message['intelligenceMetadata'] = undefined;
            if (data._intelligence) {
                const intel = data._intelligence;
                const confidenceTier: 'high' | 'moderate' | 'low' =
                    intel.signalStrength === 'strong' ? 'high' :
                    intel.signalStrength === 'moderate' ? 'moderate' : 'low';
                intelligenceMetadata = {
                    confidenceTier,
                    confidencePercent: typeof intel.confidence === 'number'
                        ? Math.round(intel.confidence * 100) : undefined,
                    signalCount: intel.timelineCount ?? 0,
                    memoryCount: intel.memoryHits ?? 0,
                };
                // Enrich with live intelligence data from supplementary IPC channels
                const timeline = intelligenceTimelineRef.current;
                if (timeline?.signals?.length) {
                    intelligenceMetadata.signalCount = Math.max(intelligenceMetadata.signalCount ?? 0, timeline.signals.length);
                }
                const explanation = intelligenceExplanationRef.current;
                if (explanation?.signals && Array.isArray(explanation.signals)) {
                    intelligenceMetadata.signals = explanation.signals;
                    intelligenceExplanationRef.current = null; // consume once
                }
            }

            finalizeRequestMessage(data.requestId, data.content, {
                chips: chips.length > 0 ? chips : undefined,
                ...(intelligenceMetadata ? { intelligenceMetadata } : {}),
            });
            rememberIntentRequest(data.intent as ActionIntent, null);
            currentSourceRef.current = undefined;
        }));



        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {
            // V2 Guard: drop tokens from a previous session
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            const resolved = resolveSuggestedAnswerRequest(data);
            if (!resolved) return;
            appendTokenToRequest(resolved.requestId, data.token);
        }));

        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
            // V2 Guard: drop final answers from a previous session
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            if (userHasScrolledRef.current) {
                setUnreadCount(prev => prev + 1);
            }
            const resolved = resolveSuggestedAnswerRequest(data);
            if (!resolved) return;
            clearProcessingForRequest(resolved.requestId);
            const chips = generateResponseChips(data.answer, resolved.intent);
            finalizeRequestMessage(resolved.requestId, data.answer, {
                chips: chips.length > 0 ? chips : undefined,
            });
            rememberIntentRequest(resolved.intent, null);
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

        // STREAMING: Screen Scan (Context-Aware Screen Intelligence)
        cleanups.push(window.electronAPI.onIntelligenceScreenScanToken((data) => {
            // V2 Guard
            if ((data as any)._sessionId && activeSessionIdRef.current && (data as any)._sessionId !== activeSessionIdRef.current) return;
            if ((data as any).requestId && activeScanRequestIdRef.current && (data as any).requestId !== activeScanRequestIdRef.current) return;
            const requestId = resolveIntentRequestId('screen_scan', (data as any).requestId);
            if (!requestId) return;
            if (activeScanRequestIdRef.current && requestId !== activeScanRequestIdRef.current) return;
            setScreenScanOverlay((prev) => prev.requestId === requestId
                ? { ...prev, visible: true, phase: 'processing', mode: data.mode as ScreenScanOverlayMode }
                : prev);
            appendTokenToRequest(requestId, data.token);
        }));

        cleanups.push(window.electronAPI.onIntelligenceScreenScanResult((data) => {
            // V2 Guard
            if ((data as any)._sessionId && activeSessionIdRef.current && (data as any)._sessionId !== activeSessionIdRef.current) return;
            if ((data as any).requestId && activeScanRequestIdRef.current && (data as any).requestId !== activeScanRequestIdRef.current) return;
            const requestId = resolveIntentRequestId('screen_scan', (data as any).requestId);
            if (!requestId) return;
            if (activeScanRequestIdRef.current && requestId !== activeScanRequestIdRef.current) return;
            clearProcessingForRequest(requestId);
            const chips = generateResponseChips(data.answer, 'screen_scan');
            showScreenScanResult(requestId, data.mode as ScreenScanOverlayMode, data.answer, chips);
            finalizeRequestMessage(requestId, data.answer, {
                chips: chips.length > 0 ? chips : undefined,
            });
            activeScanRequestIdRef.current = null;
            isScreenScanInFlightRef.current = false;
            rememberIntentRequest('screen_scan', null);
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
            if (data.mode === 'manual') return;
            // V2 Guard
            if (data._sessionId && activeSessionIdRef.current && data._sessionId !== activeSessionIdRef.current) return;
            if (data.requestId) {
                clearProcessingForRequest(data.requestId);
                if (data.mode === 'screen_scan') {
                    hideScreenScanOverlay();
                    if (!activeScanRequestIdRef.current || data.requestId === activeScanRequestIdRef.current) {
                        activeScanRequestIdRef.current = null;
                        isScreenScanInFlightRef.current = false;
                    }
                }
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

        if (window.electronAPI.onScreenshotCaptureBlocked) {
            cleanups.push(window.electronAPI.onScreenshotCaptureBlocked((data) => {
                setIsExpanded(true);
                setMessages(prev => [...prev, {
                    id: nextMsgId(),
                    role: 'system',
                    text: data.error
                }]);
            }));
        }
        // Intelligence Surface Layer listeners (HIGH-001)
        cleanups.push(window.electronAPI.onAdaptiveModeSuggestion((data) => {
            intelligenceModeSuggestionRef.current = data;
        }));
        cleanups.push(window.electronAPI.onTimelineBatch((data) => {
            intelligenceTimelineRef.current = data;
        }));
        cleanups.push(window.electronAPI.onExplanation((data) => {
            intelligenceExplanationRef.current = data;
        }));

        return () => cleanups.forEach(fn => fn());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appendTokenToRequest, clearProcessingForRequest, finalizeRequestMessage, rememberIntentRequest, resolveSuggestedAnswerRequest]); // C2 Fix: mount-only — listeners must survive expand/collapse to prevent dropped tokens

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
        const pending = pendingCaptureRef.current;
        let currentAttachments = attachedContextRef.current;
        if (pending && !currentAttachments.some(s => s.path === pending.path)) {
            currentAttachments = [...currentAttachments, pending].slice(-5);
        }

        if (currentAttachments.length > 0) {
            setAttachedContext([]);
        }
        pendingCaptureRef.current = null;

        await runAction('what_to_answer', {
            source: 'What to Answer',
            analyticsKey: 'what_to_say',
            imagePaths: currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
            userBubbleText: currentAttachments.length > 0 ? 'What should I say about this?' : undefined,
            screenshotPreview: currentAttachments[0]?.preview,
        });
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

        userHasScrolledRef.current = false;
        setShowJumpButton(false);
        setUnreadCount(0);
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

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

        userHasScrolledRef.current = false;
        setShowJumpButton(false);
        setUnreadCount(0);
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        try {
            await window.electronAPI.generateFollowUp(intent, undefined, requestId);
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleRecap = async () => {
        await runAction('recap', {
            source: 'Recap',
            analyticsKey: 'recap',
        });
    };

    const handleFollowUpQuestions = async () => {
        await runAction('follow_up_questions', {
            source: 'Follow Up Questions',
            analyticsKey: 'suggest_questions',
        });
    };

    const handleClarify = async () => {
        await runAction('clarify', {
            source: 'Clarify',
            analyticsKey: 'clarify',
        });
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

        userHasScrolledRef.current = false;
        setShowJumpButton(false);
        setUnreadCount(0);
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        try {
            await window.electronAPI.generateCodeHint(currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined, undefined, requestId);
        } catch (err) {
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleBrainstorm = async () => {
        const currentAttachments = attachedContextRef.current;
        if (currentAttachments.length > 0) {
            setAttachedContext([]);
        }

        await runAction('brainstorm', {
            source: 'Brainstorm',
            analyticsKey: 'brainstorm',
            imagePaths: currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
            userBubbleText: currentAttachments.length > 0 ? 'Brainstorm with this context' : undefined,
            screenshotPreview: currentAttachments[0]?.preview,
        });
    };

    const handleScreenScan = async () => {
        console.log('[DEBUG] Analyze Screen button clicked');
        const requestId = nextRequestId('screen-scan');
        const previousScanRequestId = activeScanRequestIdRef.current;
        activeScanRequestIdRef.current = requestId;
        isScreenScanInFlightRef.current = true;

        await cancelInFlightOverlayRequests(requestId);
        setIsExpanded(true);
        currentSourceRef.current = 'Screen Scan';
        analytics.trackCommandExecuted('screen_scan');
        if (previousScanRequestId && previousScanRequestId !== requestId) {
            await window.electronAPI.cancelIntelligenceByRequest(previousScanRequestId);
        }
        markRequestProcessing(requestId);
        rememberIntentRequest('screen_scan', requestId);
        showScreenScanOverlayPhase(requestId, 'scanning');

        const pending = pendingCaptureRef.current;
        let currentAttachments = attachedContextRef.current;
        if (pending && !currentAttachments.some((s) => s.path === pending.path)) {
            currentAttachments = [...currentAttachments, pending].slice(-5);
        }
        let attachmentForScan = currentAttachments[currentAttachments.length - 1] ?? null;

        try {
            if (!attachmentForScan) {
                const capturedPath = await window.electronAPI.captureScreen();
                if (!capturedPath) {
                    pendingCaptureRef.current = null;
                    hideScreenScanOverlay();
                    failRequestMessage(requestId, 'Unable to capture the screen right now. Try again.');
                    activeScanRequestIdRef.current = null;
                    isScreenScanInFlightRef.current = false;
                    rememberIntentRequest('screen_scan', null);
                    return;
                }
                attachmentForScan = { path: capturedPath, preview: '' };
            } else {
                setAttachedContext([]);
            }

            pendingCaptureRef.current = null;

            if (attachmentForScan) {
                setMessages(prev => [...prev, {
                    id: nextMsgId(),
                    role: 'user',
                    text: '🔍 Analyze this screen',
                    hasScreenshot: true,
                    screenshotPreview: attachmentForScan?.preview
                }]);
                setTimeout(() => {
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
            }

            showScreenScanOverlayPhase(requestId, 'processing');

            beginStreamingMessage(requestId, {
                role: 'system',
                text: '',
                intent: 'screen_scan',
                source: currentSourceRef.current,
                isStreaming: true,
            });

            window.electronAPI.runScreenAnalysis({
                requestId,
                image: attachmentForScan?.path ?? '',
                mode: getScreenScanModeForSessionMode(session.currentMode),
            });
        } catch (err) {
            pendingCaptureRef.current = null;
            hideScreenScanOverlay();
            activeScanRequestIdRef.current = null;
            isScreenScanInFlightRef.current = false;
            failRequestMessage(requestId, `Error: ${err}`);
            rememberIntentRequest('screen_scan', null);
        }
    };

    handleScreenScanRef.current = handleScreenScan;

    const handleExplain = async () => {
        await cancelInFlightOverlayRequests();
        setIsExpanded(true);
        currentSourceRef.current = 'Explain';
        analytics.trackCommandExecuted('explain');

        const requestId = nextRequestId('explain');
        const currentAttachments = attachedContextRef.current;
        const question = lastFinalSentenceRef.current.trim() || finalizedTranscriptRef.current.split('  ·  ').pop()?.trim() || '';

        if (!question && currentAttachments.length === 0) {
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'system',
                text: '⚠️ Nothing to explain yet. Wait for a finalized question or add context.'
            }]);
            return;
        }

        markRequestProcessing(requestId);
        rememberIntentRequest('answer_now', requestId);

        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            setMessages(prev => [...prev, {
                id: nextMsgId(),
                role: 'user',
                text: question || 'Explain this',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0]?.preview
            }]);
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        }

        beginStreamingMessage(requestId, {
            role: 'system',
            text: '',
            intent: 'answer_now',
            source: currentSourceRef.current,
            isStreaming: true,
        });

        userHasScrolledRef.current = false;
        setShowJumpButton(false);
        setUnreadCount(0);
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        try {
            await window.electronAPI.generateAnswerNow(
                question || 'Explain this',
                currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
                `Explain the current topic or question clearly.
- 3-5 short bullets max.
- Define the key idea simply.
- Keep it under 120 words.
- No preamble.`,
                session.currentMode,
                requestId
            );
        } catch (err) {
            rememberIntentRequest('answer_now', null);
            failRequestMessage(requestId, `Error: ${err}`);
        } finally {
            clearProcessingForRequest(requestId);
        }
    };

    const handleStarStory = useCallback(() => {
        const hasCompletedAssistantAnswer = messages.some(msg => msg.role === 'system' && !msg.isStreaming && msg.text.trim().length > 0);
        if (hasCompletedAssistantAnswer) {
            void handleFollowUp('add_example');
            return;
        }
        void handleWhatToSay();
    }, [handleFollowUp, handleWhatToSay, messages]);

    const handleSummarize = useCallback(() => {
        void handleRecap();
    }, [handleRecap]);

    const executeQuickAction = useCallback(async (action: OverlayQuickActionDef) => {
        await runAction(action.intent as ActionIntent, {
            source: action.source,
            analyticsKey: action.analyticsKey,
            message: action.message,
            additionalContext: action.additionalContext,
            profilePreference: action.profilePreference,
        });
    }, [runAction]);

    const getQuickActionHandler = useCallback((action: OverlayQuickActionDef): (() => void | Promise<void>) => {
        switch (action.id) {
            case 'what_to_answer':
                return handleWhatToSay;
            case 'recap':
                return handleRecap;
            case 'clarify':
                return handleClarify;
            case 'brainstorm':
                return handleBrainstorm;
            case 'follow_up_questions':
                return handleFollowUpQuestions;
            default:
                return () => executeQuickAction(action);
        }
    }, [
        executeQuickAction,
        handleWhatToSay,
        handleRecap,
        handleClarify,
        handleBrainstorm,
        handleFollowUpQuestions,
    ]);

    fourthActionHandlerRef.current = activeQuickActions[2]
        ? getQuickActionHandler(activeQuickActions[2])
        : handleWhatToSay;

    // Setup Streaming Listeners
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        // Stream Token
        cleanups.push(window.electronAPI.onGeminiStreamToken((payload) => {
            const token = typeof payload === 'string' ? payload : payload.token;
            const requestId = typeof payload === 'string' ? activeChatRequestIdRef.current : (payload.requestId || activeChatRequestIdRef.current);
            if (!requestId) return;
            // Guard: skip structured JSON tokens (negotiation coaching).
            // The JSON is emitted as a single complete token — one parse attempt is sufficient.
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
                } catch { }
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
                    } catch { }
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
            try {
                await window.electronAPI.finalizeMicSTT();
            } catch (err) {
                console.error('[TeamSyncInterface] Failed to send finalizeMicSTT:', err);
            }

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

            // Auto-detect salary in voice input and toggle negotiation
            if (hasProContextAccess && hasNegotiationScript && question) {
                if (isSalaryRelatedText(question) && !negotiationContextEnabled) {
                    negotiationAutoEnabledRef.current = true;
                    handleToggleNegotiationContext(true);
                    console.log(`[Overlay] Auto-enabled negotiation context — salary keyword detected source=voice textLength=${question.length} redacted=true`);
                } else if (!isSalaryRelatedText(question) && negotiationAutoEnabledRef.current && negotiationContextEnabled) {
                    negotiationAutoEnabledRef.current = false;
                    handleToggleNegotiationContext(false);
                    console.log(`[Overlay] Auto-disabled negotiation context — non-salary question source=voice textLength=${question.length} redacted=true`);
                }
            }

            await runAction('answer_now', {
                source: 'Answer Now',
                analyticsKey: 'answer_now',
                message: question,
                imagePaths: currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
                userBubbleText: question,
                screenshotPreview: currentAttachments[0]?.preview,
            });
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
        if (userText.trim()) {
            markCurrentTurnFromText(userText, 'manual_input');
        }

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

        // Auto-detect salary in manual input and toggle negotiation
        if (hasProContextAccess && hasNegotiationScript && userText) {
            if (isSalaryRelatedText(userText) && !negotiationContextEnabled) {
                negotiationAutoEnabledRef.current = true;
                handleToggleNegotiationContext(true);
                console.log(`[Overlay] Auto-enabled negotiation context — salary keyword detected source=manual textLength=${userText.length} redacted=true`);
            } else if (!isSalaryRelatedText(userText) && negotiationAutoEnabledRef.current && negotiationContextEnabled) {
                negotiationAutoEnabledRef.current = false;
                handleToggleNegotiationContext(false);
                console.log(`[Overlay] Auto-disabled negotiation context — non-salary question source=manual textLength=${userText.length} redacted=true`);
            }
        }

        // Scroll to bottom when user sends message
        userHasScrolledRef.current = false;
        setShowJumpButton(false);
        setUnreadCount(0);
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
            activeRagRequestIdRef.current = null;

            // Pass imagePath if attached, AND conversation context.
            // Live RAG is now injected by the unified backend action path when available.
            requestStartTimeRef.current = Date.now();
            const manualDetectedMode = detectRealtimeMode(userText, 'general', 'general').nextType;
            const transcriptWindow = manualDetectedMode === 'system_design' ? 250 : 700;
            const normalizedManualInput = userText.trim().toLowerCase();
            const manualWordCount = normalizedManualInput.split(/\s+/).filter(Boolean).length;
            const referencesPriorContext = /\b(continue|elaborate|expand|go deeper|follow up|follow-up|what about|and what|and how|again|that|this|it|they|those|these|earlier|previous|above|last answer|conversation|transcript|meeting|call|based on|from the meeting|from this|using this|screenshot|screen)\b/i.test(normalizedManualInput);
            const standaloneManualInput = currentAttachments.length === 0
                && !referencesPriorContext
                && manualWordCount > 0
                && (
                    ((manualDetectedMode === 'coding' || manualDetectedMode === 'system_design') && manualWordCount <= 18)
                    || (manualDetectedMode === 'general' && manualWordCount <= 14)
                );
	            const streamContext = [
	                conversationContext.trim(),
	                standaloneManualInput ? '' : `RECENT OVERLAY TRANSCRIPT:\n${finalizedTranscriptRef.current.slice(-transcriptWindow)}`,
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



    // ── Premium Copy Button with success state ──
    const CopyButton: React.FC<{ text: string; isLightTheme: boolean; accentRgb: string }> = ({ text, isLightTheme: lt, accentRgb }) => {
        const [copied, setCopied] = useState(false);
        const handleCopyClick = () => {
            navigator.clipboard.writeText(text);
            analytics.trackCopyAnswer();
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        };
        return (
            <button
                onClick={handleCopyClick}
                className="flex items-center gap-1 px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200"
                style={{
                    opacity: copied ? 1 : undefined,
                    background: copied
                        ? (lt ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.12)')
                        : (lt ? 'rgba(0,0,0,0.03)' : `rgba(${accentRgb},0.06)`),
                    border: `1px solid ${copied
                        ? 'rgba(34,197,94,0.20)'
                        : (lt ? 'rgba(0,0,0,0.05)' : `rgba(${accentRgb},0.12)`)}`,
                    color: copied ? '#22C55E' : (lt ? '#9CA3AF' : 'rgba(255,255,255,0.45)'),
                }}
                title={copied ? 'Copied!' : 'Copy response'}
            >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span className="text-[9px] font-medium tracking-wide">{copied ? 'Copied' : 'Copy'}</span>
            </button>
        );
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

        // ── Streaming guard: render plain text while tokens arrive ──
        // Partial markdown (unclosed **bold**, half lists, broken code fences)
        // looks messy through ReactMarkdown. Show clean plain text during streaming,
        // then full markdown renders once streaming completes.
        if (msg.isStreaming) {
            const streamText = msg.text.trim();

            // Hide negotiation coaching JSON that leaks during streaming.
            // Tokens arrive char-by-char so JSON.parse guard in token handler fails on partial data.
            // No valid AI response text starts with '{', so intercept immediately.
            if (streamText.startsWith('{')) {
                return (
                    <div className="flex items-center gap-2 py-1">
                        <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isLightTheme ? 'bg-emerald-500' : 'bg-emerald-400'}`} />
                        <span className={`text-[12px] font-medium ${isLightTheme ? 'text-gray-400' : 'text-white/40'}`}>Generating response…</span>
                    </div>
                );
            }

            return (
                <div
                    className="whitespace-pre-wrap break-words"
                    style={{
                        fontSize: '13.5px',
                        lineHeight: '1.68',
                        color: isLightTheme ? '#1f2937' : '#E5E7EB',
                    }}
                >
                    {msg.text}
                    <span className="inline-block w-[5px] h-[14px] ml-0.5 rounded-sm animate-pulse" style={{
                        background: isLightTheme ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.4)',
                        verticalAlign: 'text-bottom',
                    }} />
                </div>
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
                    <div className={`space-y-1 text-[13px] leading-relaxed ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        {parts.map((part, i) => {
                            if (part.startsWith('```')) {
                                const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
                                if (match) {
                                    const lang = match[1] || 'python';
                                    const code = match[2].trim();
                                    if (lang.toLowerCase() === 'mermaid') {
                                        return <MermaidRenderer key={i} chart={code} isLightTheme={isLightTheme} />;
                                    }
                                    return <CodeBlock key={i} code={code} language={lang} isLightTheme={isLightTheme} />;
                                }
                            }
                            // Regular text - Render with Markdown
                            return (
                                <div key={i} className="markdown-content">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            p: ({ node, ...props }: any) => <p className="mb-1.5 last:mb-0 whitespace-pre-wrap" {...props} />,
                                            strong: ({ node, ...props }: any) => <strong className="font-bold overlay-text-strong" {...props} />,
                                            em: ({ node, ...props }: any) => <em className="italic overlay-text-secondary" {...props} />,
                                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-1.5 space-y-0.5" {...props} />,
                                            ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-1.5 space-y-0.5" {...props} />,
                                            li: ({ node, ...props }: any) => <li className="pl-0.5" {...props} />,
                                            h1: ({ node, ...props }: any) => <h1 className="text-lg font-bold mb-1.5 mt-2.5 overlay-text-strong" {...props} />,
                                            h2: ({ node, ...props }: any) => <h2 className="text-base font-bold mb-1.5 mt-2.5 overlay-text-strong" {...props} />,
                                            h3: ({ node, ...props }: any) => <h3 className="text-sm font-bold mb-1 mt-2 overlay-text-primary" {...props} />,
                                            code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono whitespace-pre-wrap ${isLightTheme ? 'text-violet-700' : 'text-purple-200'}`} {...props} />,
                                            blockquote: ({ node, ...props }: any) => <blockquote className={`border-l-2 pl-3 italic my-1.5 ${isLightTheme ? 'border-violet-500/30 text-slate-600' : 'border-purple-500/50 text-slate-400'}`} {...props} />,
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

                                    return <CodeBlock key={i} code={code} language={lang} isLightTheme={isLightTheme} />;
                                }
                            }
                            // Regular text - Render Markdown
                            return (
                                <div key={i} className="markdown-content">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            p: ({ node, ...props }: any) => <p className="mb-1.5 last:mb-0" {...props} />,
                                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-emerald-700' : 'text-emerald-100'}`} {...props} />,
                                            em: ({ node, ...props }: any) => <em className={`italic ${isLightTheme ? 'text-emerald-700/80' : 'text-emerald-200/80'}`} {...props} />,
                                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-1.5 space-y-0.5" {...props} />,
                                            ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-1.5 space-y-0.5" {...props} />,
                                            li: ({ node, ...props }: any) => <li className="pl-0.5" {...props} />,
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
        // For system messages, apply normalizeInsightSections to create elegant section headers
        let displayText = msg.role === 'system' ? normalizeInsightSections(msg.text) : msg.text;

        // Guard: if the final text is a JSON object (e.g. LLM returned structured JSON
        // instead of markdown), extract the readable content from it.
        if (msg.role === 'system' && displayText.trimStart().startsWith('{')) {
            try {
                const parsed = JSON.parse(displayText);
                // Extract content from common JSON response shapes
                const extracted = parsed?.content || parsed?.answer || parsed?.text || parsed?.response || parsed?.message;
                if (typeof extracted === 'string' && extracted.trim()) {
                    displayText = extracted;
                } else {
                    // JSON has no recognizable text field — render a summary of all string values
                    const values = Object.values(parsed)
                        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
                    if (values.length > 0) {
                        displayText = values.join('\n\n');
                    }
                }
            } catch {
                // Not valid JSON — render as-is
            }
        }

        // If the text contains code fences, split and render with CodeBlock
        if (displayText.includes('```')) {
            const parts = displayText.split(/(```[\s\S]*?(?:```|$))/g);
            return (
                <div className="markdown-content">
                    {parts.map((part, i) => {
                        if (part.startsWith('```')) {
                            const match = part.match(/```(\w*)\s*([\s\S]*?)(?:```|$)/);
                            if (match) {
                                const lang = match[1] || 'text';
                                const code = match[2].trim();
                                if (lang.toLowerCase() === 'mermaid') {
                                    return <MermaidRenderer key={i} chart={code} isLightTheme={isLightTheme} />;
                                }
                                return <CodeBlock key={i} code={code} language={lang} isLightTheme={isLightTheme} />;
                            }
                        }
                        if (!part.trim()) return null;
                        return (
                            <ReactMarkdown
                                key={i}
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                                components={{
                                    p: ({ node, ...props }: any) => <p className="mb-1.5 last:mb-0 whitespace-pre-wrap" {...props} />,
                                    strong: ({ node, ...props }: any) => <strong className="font-bold opacity-100 overlay-text-strong" {...props} />,
                                    em: ({ node, ...props }: any) => <em className="italic opacity-90 overlay-text-secondary" {...props} />,
                                    ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-1.5 space-y-0.5" {...props} />,
                                    ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-1.5 space-y-0.5" {...props} />,
                                    li: ({ node, ...props }: any) => <li className="pl-0.5" {...props} />,
                                    h3: ({ node, ...props }: any) => (
                                        <h3 className={`text-[11px] font-bold uppercase tracking-[0.06em] mt-3.5 mb-1 pb-1 border-b ${isLightTheme ? 'text-gray-400 border-black/[0.05]' : 'text-white/30 border-white/[0.06]'}`} {...props} />
                                    ),
                                    code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono ${isLightTheme ? 'text-slate-800' : ''}`} {...props} />,
                                    a: ({ node, ...props }: any) => <a className="underline hover:opacity-80" target="_blank" rel="noopener noreferrer" {...props} />,
                                }}
                            >
                                {part}
                            </ReactMarkdown>
                        );
                    })}
                </div>
            );
        }

        return (
            <div className="markdown-content">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                        p: ({ node, ...props }: any) => <p className="mb-1.5 last:mb-0 whitespace-pre-wrap" {...props} />,
                        strong: ({ node, ...props }: any) => <strong className="font-bold opacity-100 overlay-text-strong" {...props} />,
                        em: ({ node, ...props }: any) => <em className="italic opacity-90 overlay-text-secondary" {...props} />,
                        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-1.5 space-y-0.5" {...props} />,
                        ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-1.5 space-y-0.5" {...props} />,
                        li: ({ node, ...props }: any) => <li className="pl-0.5" {...props} />,
                        h3: ({ node, ...props }: any) => (
                            <h3 className={`text-[11px] font-bold uppercase tracking-[0.06em] mt-3.5 mb-1 pb-1 border-b ${isLightTheme ? 'text-gray-400 border-black/[0.05]' : 'text-white/30 border-white/[0.06]'}`} {...props} />
                        ),
                        code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono ${isLightTheme ? 'text-slate-800' : ''}`} {...props} />,
                        a: ({ node, ...props }: any) => <a className="underline hover:opacity-80" target="_blank" rel="noopener noreferrer" {...props} />,
                    }}
                >
                    {displayText}
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
        handleBrainstorm,
        handleScreenScan
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
        handleBrainstorm,
        handleScreenScan
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const { handleWhatToSay, handleFollowUp, handleFollowUpQuestions, handleRecap, handleAnswerNow, handleClarify, handleCodeHint, handleBrainstorm } = handlersRef.current;
            const target = e.target as HTMLElement | null;
            const isInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

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
                fourthActionHandlerRef.current();
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
            } else if (!isInput && e.key === 'PageUp') {
                e.preventDefault();
                scrollContainerRef.current?.scrollBy({ top: -320, behavior: 'smooth' });
            } else if (!isInput && e.key === 'PageDown') {
                e.preventDefault();
                scrollContainerRef.current?.scrollBy({ top: 320, behavior: 'smooth' });
            } else if (!isInput && e.key === 'Home') {
                e.preventDefault();
                scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (!isInput && e.key === 'End') {
                e.preventDefault();
                const container = scrollContainerRef.current;
                if (container) {
                    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                }
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
        processScreenshots: handleScreenScan,
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
                const data = await window.electronAPI.takeScreenshot({ requireVision: true });
                if (data && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering screenshot:", err);
            }
        },
        selectiveScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeSelectiveScreenshot({ requireVision: true });
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
                    handlersRef.current.handleScreenScan();
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
                fourthActionHandlerRef.current();
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
        <div
            ref={contentRef}
            data-overlay-dragging={isOverlayDragging ? 'true' : undefined}
            className="flex flex-col items-center w-fit mx-auto h-fit min-h-0 bg-transparent p-0 rounded-[24px] font-sans gap-2 overlay-text-primary"
        >

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: OVERLAY_HIDE_ANIMATION_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
                        className="flex flex-col items-center gap-2 w-full transform-gpu"
                        style={{ willChange: 'transform, opacity' }}
                    >
                        <TopPill
                            expanded={isExpanded}
                            onToggle={() => setIsExpanded(!isExpanded)}
                            onQuit={() => onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp()}
                            appearance={appearance}
                            onLogoClick={() => window.electronAPI?.setWindowMode?.('launcher')}
                        />
                        <div className="relative w-[600px] max-w-full">
                            <motion.div
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-x-[7.5%] top-[-2px] z-[110] h-[18px] overflow-visible"
                                animate={isOverlayDragging
                                    ? { opacity: 0.72, scaleX: 1, y: 0 }
                                    : {
                                        opacity: [0.62, 1, 0.62],
                                        scaleX: [0.985, 1.01, 0.985],
                                        y: [0, -1, 0],
                                    }}
                                transition={isOverlayDragging
                                    ? { duration: 0.14, ease: 'easeOut' }
                                    : {
                                        duration: 3.4,
                                        repeat: Infinity,
                                        ease: [0.4, 0, 0.2, 1],
                                    }}
                                style={{ transformOrigin: 'center top' }}
                            >
                                <div
                                    className="absolute inset-x-[-6%] top-[-6px] h-[18px] rounded-full"
                                    style={{
                                        background: 'radial-gradient(ellipse at center, rgba(150,96,255,0.58) 0%, rgba(110,64,255,0.4) 30%, rgba(140,92,255,0.15) 58%, rgba(140,92,255,0) 84%)',
                                        filter: 'blur(7px) saturate(145%)',
                                        opacity: 0.92,
                                    }}
                                />
                                <div
                                    className="absolute inset-x-0 top-[1px] h-[5px] rounded-full"
                                    style={{
                                        background: 'linear-gradient(90deg, rgba(92,52,255,0) 0%, rgba(92,52,255,0.08) 7%, rgba(112,72,255,0.54) 16%, rgba(140,88,255,0.9) 29%, rgba(196,144,255,0.98) 50%, rgba(140,88,255,0.9) 71%, rgba(112,72,255,0.54) 84%, rgba(92,52,255,0.08) 93%, rgba(92,52,255,0) 100%)',
                                        boxShadow: '0 0 18px rgba(140,88,255,0.34), 0 0 36px rgba(92,52,255,0.18)',
                                        filter: 'saturate(150%)',
                                    }}
                                />
                                <div
                                    className="absolute inset-x-[11%] top-[2px] h-[2px] rounded-full"
                                    style={{
                                        background: 'linear-gradient(90deg, rgba(232,220,255,0) 0%, rgba(224,208,255,0.42) 16%, rgba(248,240,255,1) 50%, rgba(224,208,255,0.42) 84%, rgba(232,220,255,0) 100%)',
                                        boxShadow: '0 0 10px rgba(224,208,255,0.24)',
                                        opacity: 0.96,
                                    }}
                                />
                            </motion.div>
                            <div
                                className={`relative w-full backdrop-blur-2xl border border-white/[0.12] rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
                                style={{
                                    ...appearance.shellStyle,
                                    borderColor: isLightTheme ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)',
                                    borderTopColor: 'transparent',
                                }}
                            >

                            {/* ScreenScanOverlay removed — screen scan results now appear only in the chat messages to avoid duplicate responses */}




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
                                        speakerLabel={showTranscript ? rollingTranscriptSpeakerLabel : ''}
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
                            {messages.length === 0 && !isManualRecording && !isProcessing && isConnected && (
                                <div className="flex-1 flex items-center justify-center p-4">
                                    <EmptyListeningState isLightTheme={isLightTheme} />
                                </div>
                            )}

                            {(messages.length > 0 || isManualRecording || isProcessing) && (
                                <>
                                    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[clamp(300px,35vh,450px)] no-drag" style={{ scrollbarWidth: 'none' }}>
                                        {messages.map((msg) => (
                                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up w-full`}>
                                                <div className={`
                                                ${msg.role === 'user' ? `max-w-[72.25%] px-[13.6px] py-[10.2px] backdrop-blur-md rounded-[20px] rounded-tr-[4px] shadow-sm font-medium ${isLightTheme ? 'bg-[#007AFF]/10 border border-[#007AFF]/15 text-[#007AFF]' : 'bg-[#0A84FF]/12 border border-[#0A84FF]/20 text-blue-100'}` : msg.role === 'system' ? 'w-[85%]' : 'w-full'} 
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

                                                    {/* Premium System Response Card / ErrorFallback */}
                                                    {msg.role === 'system' && (
                                                        msg.text.startsWith('❌') ? (
                                                            <ErrorFallback isLightTheme={isLightTheme} />
                                                        ) : (
                                                            <>
                                                                <PremiumResponseCard
                                                                    message={msg}
                                                                    isLightTheme={isLightTheme}
                                                                    sourceIconMap={sourceIconMap}
                                                                    renderMessageText={renderMessageText}
                                                                    onCopy={() => analytics.trackCopyAnswer()}
                                                                />
                                                                {msg.intelligenceMetadata?.confidenceTier && (
                                                                    <SignalDiscoveryNudge
                                                                        signalType={msg.intelligenceMetadata.confidenceTier}
                                                                        signalLabel={`${msg.intelligenceMetadata.confidenceTier} confidence`}
                                                                        isLightTheme={isLightTheme}
                                                                    />
                                                                )}
                                                            </>
                                                        )
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

                                        {isProcessing && !messages.some(m => m.isStreaming) && (
                                            <div className="flex justify-start w-[85%]">
                                                <SkeletonLoader isLightTheme={isLightTheme} />
                                            </div>
                                        )}
                                        <div ref={messagesEndRef} />
                                    </div>

                                    {/* Scroll Navigation — single contextual button */}
                                    {showScrollUpButton && !showJumpButton && (
                                        <div className="flex justify-center py-1.5 no-drag">
                                            <button
                                                onClick={scrollToTop}
                                                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium backdrop-blur-md transition-all duration-200 ${isLightTheme ? 'bg-black/[0.04] hover:bg-black/[0.07] text-gray-500 hover:text-gray-700 border border-black/[0.06]' : 'bg-white/[0.06] hover:bg-white/[0.10] text-white/50 hover:text-white/80 border border-white/[0.08]'}`}
                                                title="Scroll to top"
                                            >
                                                <ChevronUp className="w-3 h-3" />
                                            </button>
                                        </div>
                                    )}
                                    {showJumpButton && (
                                        <div className="flex justify-center py-1.5 no-drag">
                                            <button
                                                onClick={scrollToBottom}
                                                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium backdrop-blur-md transition-all duration-200 ${isLightTheme ? 'bg-black/[0.04] hover:bg-black/[0.07] text-gray-500 hover:text-gray-700 border border-black/[0.06]' : 'bg-white/[0.06] hover:bg-white/[0.10] text-white/50 hover:text-white/80 border border-white/[0.08]'}`}
                                                title="Scroll to bottom"
                                            >
                                                <ChevronDown className="w-3 h-3" />
                                                {unreadCount > 0 && (
                                                    <>
                                                        <span>{unreadCount} new</span>
                                                        <span className="flex h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Quick Actions - Static Buttons with Recommendation Glow */}
                            {(() => {
                                type ActionDef = OverlayQuickActionDef & { handler: () => void | Promise<void> };
                                const actions: ActionDef[] = activeQuickActions.map((action) => ({
                                    ...action,
                                    handler: getQuickActionHandler(action),
                                }));
                                const isRecommendedAnswer = recommendedButton === 'answer_now';

                                return (
                                    <div className={`flex flex-nowrap justify-center items-center gap-2 px-3 pb-3 overflow-x-auto scrollbar-none transition-opacity duration-300 ease-in-out ${rollingTranscript && showTranscript ? 'pt-1' : 'pt-3'}`} style={{ opacity: localOpacity, width: '95%', margin: '0 auto' }}>
                                        <AnimatePresence mode="popLayout">
                                            {/* Mode Indicator Pill — inline with action buttons */}
                                            {(() => {
                                                const modeDisplay = MODE_DISPLAY_LABELS[overlayCopilotMode];
                                                if (!modeDisplay?.label) return null;

                                                const MODE_ICONS: Record<string, React.ComponentType<any>> = {
                                                    Code2, MessageSquare, Layers, DollarSign, TrendingUp,
                                                    BookOpen, Target, Users, Briefcase, Sparkles,
                                                };
                                                const IconComponent = MODE_ICONS[modeDisplay.icon];

                                                return (
                                                    <motion.div
                                                        key={`mode-pill-${overlayCopilotMode}`}
                                                        initial={{ opacity: 0, x: 8, scale: 0.9 }}
                                                        animate={{ opacity: 1, x: 0, scale: 1 }}
                                                        exit={{ opacity: 0, x: -8, scale: 0.9 }}
                                                        transition={{ duration: 0.15, ease: [0.25, 1, 0.5, 1] }}
                                                        className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full flex-none whitespace-nowrap pointer-events-none"
                                                        style={{
                                                            background: modeDisplay.color.replace(/[\d.]+\)$/, '0.08)'),
                                                            border: `1px solid ${modeDisplay.color}`,
                                                        }}
                                                    >
                                                        {IconComponent && <IconComponent className="w-3 h-3" style={{ color: modeDisplay.color.replace(/[\d.]+\)$/, '0.9)') }} />}
                                                        <span className={`text-[10px] font-semibold tracking-wide ${isLightTheme ? 'text-gray-600' : 'text-white/70'}`}>
                                                            {modeDisplay.label}
                                                        </span>
                                                    </motion.div>
                                                );
                                            })()}
                                            {(() => {
                                                // macOS Control Center glassmorphism — Apple-style tinted glass per button
                                                const glassColors: Record<string, { bg: string; border: string; tint: string }> = {
                                                    // Default actions
                                                    what_to_answer: { bg: 'rgba(10,132,255,0.14)', border: 'rgba(10,132,255,0.28)', tint: 'rgba(10,132,255,0.06)' },
                                                    recap: { bg: 'rgba(142,142,147,0.14)', border: 'rgba(142,142,147,0.25)', tint: 'rgba(142,142,147,0.06)' },
                                                    clarify: { bg: 'rgba(48,209,88,0.14)', border: 'rgba(48,209,88,0.28)', tint: 'rgba(48,209,88,0.06)' },
                                                    brainstorm: { bg: 'rgba(255,159,10,0.14)', border: 'rgba(255,159,10,0.28)', tint: 'rgba(255,159,10,0.06)' },
                                                    follow_up_questions: { bg: 'rgba(175,82,222,0.14)', border: 'rgba(175,82,222,0.28)', tint: 'rgba(175,82,222,0.06)' },
                                                    // Technical interview actions
                                                    tech_hint: { bg: 'rgba(175,82,222,0.14)', border: 'rgba(175,82,222,0.28)', tint: 'rgba(175,82,222,0.06)' },
                                                    tech_optimal_solution: { bg: 'rgba(10,132,255,0.14)', border: 'rgba(10,132,255,0.28)', tint: 'rgba(10,132,255,0.06)' },
                                                    tech_complexity: { bg: 'rgba(255,159,10,0.14)', border: 'rgba(255,159,10,0.28)', tint: 'rgba(255,159,10,0.06)' },
                                                    tech_edge_case: { bg: 'rgba(48,209,88,0.14)', border: 'rgba(48,209,88,0.28)', tint: 'rgba(48,209,88,0.06)' },
                                                    // System design actions
                                                    system_tradeoffs: { bg: 'rgba(10,132,255,0.14)', border: 'rgba(10,132,255,0.28)', tint: 'rgba(10,132,255,0.06)' },
                                                    system_clarify: { bg: 'rgba(48,209,88,0.14)', border: 'rgba(48,209,88,0.28)', tint: 'rgba(48,209,88,0.06)' },
                                                    system_approaches: { bg: 'rgba(255,159,10,0.14)', border: 'rgba(255,159,10,0.28)', tint: 'rgba(255,159,10,0.06)' },
                                                    system_deep_dive: { bg: 'rgba(175,82,222,0.14)', border: 'rgba(175,82,222,0.28)', tint: 'rgba(175,82,222,0.06)' },
                                                    // Sales actions
                                                    sales_objection: { bg: 'rgba(10,132,255,0.14)', border: 'rgba(10,132,255,0.28)', tint: 'rgba(10,132,255,0.06)' },
                                                    sales_pricing: { bg: 'rgba(48,209,88,0.14)', border: 'rgba(48,209,88,0.28)', tint: 'rgba(48,209,88,0.06)' },
                                                    sales_discovery: { bg: 'rgba(255,159,10,0.14)', border: 'rgba(255,159,10,0.28)', tint: 'rgba(255,159,10,0.06)' },
                                                    sales_negotiation: { bg: 'rgba(175,82,222,0.14)', border: 'rgba(175,82,222,0.28)', tint: 'rgba(175,82,222,0.06)' },
                                                    // Lecture actions
                                                    lecture_explain: { bg: 'rgba(10,132,255,0.14)', border: 'rgba(10,132,255,0.28)', tint: 'rgba(10,132,255,0.06)' },
                                                    lecture_summary: { bg: 'rgba(142,142,147,0.14)', border: 'rgba(142,142,147,0.25)', tint: 'rgba(142,142,147,0.06)' },
                                                    lecture_takeaway: { bg: 'rgba(255,159,10,0.14)', border: 'rgba(255,159,10,0.28)', tint: 'rgba(255,159,10,0.06)' },
                                                    lecture_question: { bg: 'rgba(175,82,222,0.14)', border: 'rgba(175,82,222,0.28)', tint: 'rgba(175,82,222,0.06)' },
                                                    // Recruiting actions
                                                    recruiting_strength: { bg: 'rgba(48,209,88,0.14)', border: 'rgba(48,209,88,0.28)', tint: 'rgba(48,209,88,0.06)' },
                                                    recruiting_red_flag: { bg: 'rgba(255,69,58,0.14)', border: 'rgba(255,69,58,0.28)', tint: 'rgba(255,69,58,0.06)' },
                                                    recruiting_follow_up: { bg: 'rgba(10,132,255,0.14)', border: 'rgba(10,132,255,0.28)', tint: 'rgba(10,132,255,0.06)' },
                                                    recruiting_evaluation: { bg: 'rgba(255,159,10,0.14)', border: 'rgba(255,159,10,0.28)', tint: 'rgba(255,159,10,0.06)' },
                                                    // Team meeting actions
                                                    team_decision: { bg: 'rgba(10,132,255,0.14)', border: 'rgba(10,132,255,0.28)', tint: 'rgba(10,132,255,0.06)' },
                                                    team_action_item: { bg: 'rgba(48,209,88,0.14)', border: 'rgba(48,209,88,0.28)', tint: 'rgba(48,209,88,0.06)' },
                                                    team_risk: { bg: 'rgba(255,159,10,0.14)', border: 'rgba(255,159,10,0.28)', tint: 'rgba(255,159,10,0.06)' },
                                                    team_owner: { bg: 'rgba(175,82,222,0.14)', border: 'rgba(175,82,222,0.28)', tint: 'rgba(175,82,222,0.06)' },
                                                    // Job / looking-for-work actions
                                                    job_star: { bg: 'rgba(255,159,10,0.14)', border: 'rgba(255,159,10,0.28)', tint: 'rgba(255,159,10,0.06)' },
                                                    job_resume_alignment: { bg: 'rgba(10,132,255,0.14)', border: 'rgba(10,132,255,0.28)', tint: 'rgba(10,132,255,0.06)' },
                                                    job_confidence: { bg: 'rgba(175,82,222,0.14)', border: 'rgba(175,82,222,0.28)', tint: 'rgba(175,82,222,0.06)' },
                                                    job_improvement: { bg: 'rgba(48,209,88,0.14)', border: 'rgba(48,209,88,0.28)', tint: 'rgba(48,209,88,0.06)' },
                                                };
                                                const fallbackGlass = { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.15)', tint: 'rgba(255,255,255,0.04)' };

                                                return actions.map((action: ActionDef, idx: number) => {
                                                    const isRec = action.id === recommendedButton;
                                                    const glass = glassColors[action.id] || fallbackGlass;
                                                    return (
                                                        <motion.button
                                                            key={`${currentQuestionTurnId}-${overlayCopilotMode}-${action.id}`}
                                                            layout
                                                            initial={{ opacity: 0, y: 6, scale: 0.92 }}
                                                            animate={{ opacity: 1, y: 0, scale: isRec ? 1.03 : 1 }}
                                                            exit={{ opacity: 0, y: -4, scale: 0.92 }}
                                                            transition={{ duration: 0.14, delay: idx * 0.03, ease: [0.25, 1, 0.5, 1] }}
                                                            whileHover={{ scale: isRec ? 1.06 : 1.04, y: -1, transition: { duration: 0.12 } }}
                                                            whileTap={{ scale: 0.96, transition: { duration: 0.08 } }}
                                                            onClick={() => {
                                                                if (isProcessing) return;
                                                                recommendationLockTurnIdRef.current = currentQuestionTurnIdRef.current;
                                                                if (recommendedButtonRef.current !== action.id) {
                                                                    recommendedButtonRef.current = action.id;
                                                                    setRecommendedButton(action.id);
                                                                }
                                                                action.handler();
                                                            }}
                                                            className={`group relative flex items-center justify-center gap-1.5 px-3.5 py-[7px] rounded-full text-[11px] font-semibold whitespace-nowrap flex-none min-w-fit no-drag backdrop-blur-xl ${isLightTheme ? 'text-gray-700' : 'text-white/90'}`}
                                                            style={{
                                                                background: isRec
                                                                    ? `linear-gradient(135deg, ${glass.bg.replace(/[\d.]+\)$/, m => `${parseFloat(m) * 2.5})`)} 0%, ${glass.tint} 100%)`
                                                                    : `linear-gradient(135deg, ${glass.bg} 0%, ${glass.tint} 100%)`,
                                                                border: `1px solid ${isRec ? glass.border : glass.border.replace(/[\d.]+\)$/, m => `${parseFloat(m) * 0.7})`)}`,
                                                                boxShadow: isRec
                                                                    ? `0 2px 12px ${glass.bg}, inset 0 1px 0 rgba(255,255,255,0.12)`
                                                                    : `inset 0 1px 0 rgba(255,255,255,0.06)`,
                                                                transition: 'all 0.15s ease',
                                                            }}
                                                        >
                                                            {/* Content */}
                                                            <span className="relative z-20 text-[11px] leading-none shrink-0">{action.icon}</span>
                                                            <span className={`relative z-20 drop-shadow-[0_1px_2px_rgba(0,0,0,0.15)] ${isLightTheme ? 'text-gray-700' : 'text-white/90'}`}>{action.label}</span>
                                                        </motion.button>
                                                    );
                                                });
                                            })()}
                                        </AnimatePresence>

                                        {/* Answer Button — glassmorphic pill */}
                                        <motion.button
                                            onClick={() => {
                                                recommendationLockTurnIdRef.current = currentQuestionTurnIdRef.current;
                                                if (recommendedButtonRef.current !== 'answer_now') {
                                                    recommendedButtonRef.current = 'answer_now';
                                                    setRecommendedButton('answer_now');
                                                }
                                                void handleAnswerNow();
                                            }}
                                            whileHover={{ scale: 1.04, transition: { duration: 0.12 } }}
                                            whileTap={{ scale: 0.96, transition: { duration: 0.08 } }}
                                            transition={{ duration: 0.14, ease: 'easeOut' }}
                                            className={`group relative px-3.5 py-[7px] rounded-full font-semibold tracking-normal flex items-center justify-center gap-1.5 flex-none min-w-fit whitespace-nowrap no-drag text-[11px] backdrop-blur-xl ${isLightTheme ? 'text-gray-700' : 'text-white/90'}`}
                                            style={{
                                                background: isManualRecording
                                                    ? 'linear-gradient(135deg, rgba(239,68,68,0.22) 0%, rgba(239,68,68,0.08) 100%)'
                                                    : `linear-gradient(135deg, rgba(16,185,129,${isRecommendedAnswer ? '0.28' : '0.14'}) 0%, rgba(16,185,129,0.06) 100%)`,
                                                border: isManualRecording
                                                    ? '1px solid rgba(239,68,68,0.35)'
                                                    : `1px solid rgba(16,185,129,${isRecommendedAnswer ? '0.35' : '0.22'})`,
                                                boxShadow: isManualRecording
                                                    ? '0 2px 12px rgba(239,68,68,0.15), inset 0 1px 0 rgba(255,255,255,0.1)'
                                                    : isRecommendedAnswer
                                                        ? '0 2px 12px rgba(16,185,129,0.2), inset 0 1px 0 rgba(255,255,255,0.1)'
                                                        : 'inset 0 1px 0 rgba(255,255,255,0.06)',
                                                transition: 'all 0.35s ease',
                                            }}
                                        >
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
                                        className={`w-full border rounded-[12px] pl-3.5 pr-10 py-2.5 focus:outline-none transition-all duration-200 backdrop-blur-3xl shadow-sm text-[13px] ${isLightTheme ? 'bg-black/[0.04] border-black/[0.08] hover:border-black/[0.12] focus:border-black/[0.18] focus:ring-2 focus:ring-black/[0.06] text-gray-800 placeholder-gray-400' : 'bg-white/[0.06] border-white/[0.08] hover:border-white/[0.14] focus:border-white/[0.22] focus:ring-2 focus:ring-white/[0.08] text-white/90 placeholder-white/30'} ${inputClass}`}
                                        style={appearance.inputStyle}
                                    />

                                    {/* Custom Rich Placeholder */}
                                    {!inputValue && (
                                        <div className={`absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] ${isLightTheme ? 'text-gray-400' : 'text-white/40'}`}>
                                            <span>Ask anything on screen or conversation, or</span>
                                            <div className="flex items-center gap-1 opacity-80">
                                                {(shortcuts.selectiveScreenshot || ['⌘', 'Shift', 'H']).map((key, i) => (
                                                    <React.Fragment key={i}>
                                                        {i > 0 && <span className="text-[10px]">+</span>}
                                                        <kbd className={`px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center ${isLightTheme ? 'border-gray-300 bg-gray-100 text-gray-500' : 'border-white/15 bg-white/[0.06] text-white/60'}`}>{key}</kbd>
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
                                                rounded-[10px] transition-colors duration-150 shadow-sm
                                                text-[12px] font-medium w-[140px] backdrop-blur-3xl
                                                interaction-base interaction-press
                                                ${isLightTheme ? 'bg-black/[0.04] hover:bg-black/[0.07] border border-black/[0.06] text-gray-600' : 'bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-white/80'}
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
                                                {localOpacity >= 0.9 ? 'Opacity: Full' : `Opacity: ${Math.round(localOpacity * 100)}%`}
                                            </div>
                                        </div>

                                        <div className="relative group">
                                            <button
                                                onClick={async () => {
                                                    const nextMode: SessionMode = currentSessionMode === 'system_design' ? 'general' : 'system_design';
                                                    console.log(`[Overlay] System design mode ${nextMode === 'system_design' ? 'on' : 'off'}`);
                                                    window.electronAPI?.overlayLogSystemDesignMode?.(nextMode === 'system_design');
                                                    setSession({ currentMode: nextMode });
                                                    try {
                                                        await window.electronAPI?.setSessionMode?.(nextMode);
                                                    } catch (error) {
                                                        console.warn('[Overlay] Failed to persist session mode:', error);
                                                    }
                                                }}
                                                className={`
                                                    w-7 h-7 flex items-center justify-center rounded-lg
                                                    interaction-base interaction-press
                                                    ${currentSessionMode === 'system_design'
                                                        ? 'overlay-icon-surface overlay-icon-surface-hover text-teal-400 opacity-100'
                                                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'}
                                                `}
                                                style={appearance.iconStyle}
                                            >
                                                <Cpu className={`w-3.5 h-3.5 ${currentSessionMode === 'system_design' ? 'animate-flame' : ''}`} />
                                            </button>
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 text-[10px] tracking-wide font-medium bg-black/90 text-white/90 rounded-[8px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none backdrop-blur-xl shadow-lg border border-white/10 z-50">
                                                System Design Mode
                                            </div>
                                        </div>

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

                                        <div className="relative group p-[1px] rounded-full overflow-hidden flex items-center justify-center">
                                            {/* Rotating Glowing Border */}
                                            <motion.div
                                                animate={isOverlayDragging ? { rotate: 0 } : { rotate: 360 }}
                                                transition={isOverlayDragging
                                                    ? { duration: 0.12, ease: 'linear' }
                                                    : { duration: 3, repeat: Infinity, ease: "linear" }}
                                                className="absolute inset-[-150%] opacity-70"
                                                style={{ background: 'conic-gradient(from 0deg, transparent 0deg, transparent 290deg, #F59E0B 360deg)' }}
                                            />
                                            <button
                                                onClick={handleScreenScan}
                                                className={`relative h-[26px] px-3.5 rounded-full flex items-center justify-center gap-1.5 transition-all duration-200 shadow-sm interaction-base interaction-press text-[11px] font-bold tracking-wide whitespace-nowrap z-10 ${isLightTheme ? 'text-[#B76E79]' : 'text-[#E6B7B0]'}`}
                                                style={{
                                                    background: isLightTheme
                                                        ? 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(246,248,252,0.94))'
                                                        : 'linear-gradient(180deg, rgba(28,28,30,0.98), rgba(35,35,38,0.94))',
                                                    boxShadow: isLightTheme
                                                        ? 'inset 0 1px 0 rgba(255,255,255,0.92), 0 1px 0 rgba(255,255,255,0.55)'
                                                        : 'inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 0 rgba(0,0,0,0.22)',
                                                }}
                                                title="Capture and scan screen"
                                            >
                                                <Camera className={`w-3 h-3 ${isLightTheme ? 'text-[#C47A86]' : 'text-[#EBC0B8]'}`} />
                                                Analyse Screen
                                            </button>
                                        </div>
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

export default TeamSyncInterface;
