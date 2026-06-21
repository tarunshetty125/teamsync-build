import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, MoreHorizontal, Settings, RefreshCw, Ghost, Download, DownloadCloud, CheckCircle, AlertCircle, Sparkles, Calendar, Users, FileText, BriefcaseBusiness, Code2, MessageSquareText, CircleDot, Video, Clock3, CheckCircle2, PlugZap, Trash2, ExternalLink, Lock, type LucideIcon } from 'lucide-react';
import { generateMeetingPDF } from '../utils/pdfGenerator';
import { generateMeetingMarkdown, generateMeetingHTML } from '../utils/meetingExporters';
import icon from "./icon.png";
import ConnectCalendarButton from './ui/ConnectCalendarButton';
import MeetingDetails from './MeetingDetails';
import TopSearchPill from './TopSearchPill';
import GlobalChatOverlay from './GlobalChatOverlay';
import { motion, AnimatePresence, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import CalendarModeRecommendationCard from './CalendarModeRecommendationCard';
import { analytics } from '../lib/analytics/analytics.service'; // Added analytics import
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { isMac } from '../utils/platformUtils';
import WindowControls from './WindowControls';
import { getUpcomingEvents, NormalizedEvent } from '../utils/filter';
import { formatTimeRange } from '../utils/time';

type RecommendationModeId =
    | 'technical-interview'
    | 'sales'
    | 'lecture'
    | 'team-meet'
    | 'recruiting'
    | 'looking-for-work';

type ModeOverrideId = RecommendationModeId | 'general';

interface CalendarModeRecommendation {
    eventId: string;
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    recommendedMode: RecommendationModeId;
    recommendedModeLabel: string;
    confidence: number;
    matchedSignals: string[];
    summary: string;
    suggestedReferences: string[];
}

type CalendarParticipant = {
    email: string;
    name: string;
};

type MagneticCalendarRefreshButtonProps = {
    onClick: () => void;
    disabled: boolean;
    isRefreshing: boolean;
};

const calendarRefreshMagneticSpring = { stiffness: 260, damping: 24, mass: 0.62 };
const calendarRefreshTextSpring = { stiffness: 340, damping: 25, mass: 0.5 };

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const MagneticCalendarRefreshButton: React.FC<MagneticCalendarRefreshButtonProps> = ({
    onClick,
    disabled,
    isRefreshing,
}) => {
    const [clickFlashKey, setClickFlashKey] = useState(0);
    const prefersReducedMotion = useReducedMotion();
    const fieldRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const magneticX = useMotionValue(0);
    const magneticY = useMotionValue(0);
    const magneticScale = useMotionValue(1);
    const magneticRotate = useMotionValue(0);
    const labelMotionX = useMotionValue(0);
    const labelMotionY = useMotionValue(0);
    const x = useSpring(magneticX, calendarRefreshMagneticSpring);
    const y = useSpring(magneticY, calendarRefreshMagneticSpring);
    const scale = useSpring(magneticScale, calendarRefreshMagneticSpring);
    const rotateZ = useSpring(magneticRotate, calendarRefreshMagneticSpring);
    const labelX = useSpring(labelMotionX, calendarRefreshTextSpring);
    const labelY = useSpring(labelMotionY, calendarRefreshTextSpring);

    const resetMagnet = () => {
        magneticX.set(0);
        magneticY.set(0);
        magneticScale.set(1);
        magneticRotate.set(0);
        labelMotionX.set(0);
        labelMotionY.set(0);
        buttonRef.current?.style.setProperty('--calendar-refresh-pill-x', '52%');
        buttonRef.current?.style.setProperty('--calendar-refresh-pill-y', '26%');
    };

    const updateMagnetFromPointer = (clientX: number, clientY: number) => {
        if (prefersReducedMotion || disabled) return;

        const field = fieldRef.current;
        const button = buttonRef.current;
        if (!field || !button) return;

        const fieldRect = field.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const centerX = fieldRect.left + fieldRect.width / 2;
        const centerY = fieldRect.top + fieldRect.height / 2;
        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const distance = Math.hypot(dx, dy);
        const strength = Math.pow(clampNumber(1 - distance / 220, 0, 1), 1.18);

        if (strength < 0.015) {
            resetMagnet();
            return;
        }

        magneticX.set(clampNumber(dx * 0.2 * strength, -18, 18));
        magneticY.set(clampNumber(dy * 0.18 * strength, -12, 12));
        magneticScale.set(1 + 0.025 * strength);
        magneticRotate.set(clampNumber(dx * 0.012 * strength, -1.4, 1.4));
        labelMotionX.set(clampNumber(dx * 0.18 * strength, -8, 8));
        labelMotionY.set(clampNumber(dy * 0.2 * strength, -7, 7));

        const highlightX = clampNumber(((clientX - buttonRect.left) / buttonRect.width) * 100, 14, 86);
        const highlightY = clampNumber(((clientY - buttonRect.top) / buttonRect.height) * 100, 8, 68);
        button.style.setProperty('--calendar-refresh-pill-x', `${highlightX}%`);
        button.style.setProperty('--calendar-refresh-pill-y', `${highlightY}%`);
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;

        let animationFrame: number | null = null;
        let latestPointer: { x: number; y: number } | null = null;

        const handleWindowPointerMove = (event: PointerEvent) => {
            latestPointer = { x: event.clientX, y: event.clientY };
            if (animationFrame !== null) return;

            animationFrame = window.requestAnimationFrame(() => {
                animationFrame = null;
                if (latestPointer) {
                    updateMagnetFromPointer(latestPointer.x, latestPointer.y);
                }
            });
        };

        window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
        window.addEventListener('pointerleave', resetMagnet);

        return () => {
            if (animationFrame !== null) {
                window.cancelAnimationFrame(animationFrame);
            }
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerleave', resetMagnet);
        };
    }, [disabled, prefersReducedMotion]);

    const handleClick = () => {
        if (!prefersReducedMotion) {
            setClickFlashKey((key) => key + 1);
        }
        onClick();
    };

    return (
        <div ref={fieldRef} className="relative flex min-h-[50px] flex-1 items-center justify-center overflow-visible">
            <motion.div style={{ x, y, scale, rotateZ }}>
                <button
                    ref={buttonRef}
                    type="button"
                    onClick={handleClick}
                    disabled={disabled}
                    className="
                        group relative inline-flex h-[40px] min-w-[168px] items-center justify-center gap-2
                        overflow-hidden rounded-full px-4 text-[13px] font-semibold tracking-[-0.005em] text-[#050009]
                        outline-none
                        focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1025]
                        disabled:cursor-wait disabled:opacity-80
                    "
                    style={{
                        background: 'radial-gradient(circle at var(--calendar-refresh-pill-x, 52%) var(--calendar-refresh-pill-y, 26%), rgba(255,255,255,0.98) 0%, rgba(226,207,255,0.92) 20%, rgba(169,92,255,0.9) 48%, rgba(83,45,236,0.98) 100%)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.68), inset 0 -15px 22px rgba(55,28,207,0.42), inset 0 -2px 8px rgba(30,4,88,0.38), 0 12px 24px rgba(10,0,45,0.44), 0 0 0 1px rgba(229,214,255,0.24)',
                    }}
                >
                    <span className="pointer-events-none absolute inset-x-[8%] top-1 h-[46%] rounded-full bg-gradient-to-b from-white/75 via-white/30 to-transparent blur-[8px]" />
                    <span className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(100deg,transparent_0%,rgba(255,255,255,0.18)_42%,rgba(255,255,255,0.34)_50%,transparent_62%)] opacity-75 transition-transform duration-500 group-hover:translate-x-2" />
                    {clickFlashKey > 0 && (
                        <motion.span
                            key={clickFlashKey}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-20 rounded-full bg-white"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 1, 1, 0] }}
                            transition={{
                                duration: 0.18,
                                times: [0, 0.16, 0.42, 1],
                                ease: [0.16, 1, 0.3, 1],
                            }}
                        />
                    )}
                    <motion.span className="relative z-10 flex items-center gap-2 drop-shadow-[0_1px_1px_rgba(255,255,255,0.22)]" style={{ x: labelX, y: labelY }}>
                        <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                        <span>{isRefreshing ? 'Refreshing...' : 'Refresh calendar'}</span>
                    </motion.span>
                </button>
            </motion.div>
        </div>
    );
};

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    active?: boolean; // UI state
    time?: string; // Optional for compatibility
    calendarEventId?: string;
    source?: 'manual' | 'calendar';
}

interface LauncherProps {
    onStartMeeting: (metadata?: any) => Promise<boolean> | boolean | void;
    onOpenSettings: (tab?: string) => void;
    onOpenModes?: () => void;
    onOpenProfile?: () => void;
    onPageChange?: (isMain: boolean) => void;
    ollamaPullStatus?: 'idle' | 'downloading' | 'complete' | 'failed';
    ollamaPullPercent?: number;
    ollamaPullMessage?: string;
}

// Helper to format date groups
const getGroupLabel = (dateStr: string) => {
    if (dateStr === "Today") return "Today"; // Backward compatibility

    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (checkDate.getTime() === today.getTime()) return "Today";
    if (checkDate.getTime() === yesterday.getTime()) return "Yesterday";

    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// Helper to format time (e.g. 3:14pm)
const formatTime = (dateStr: string) => {
    if (dateStr === "Today") return "Just now"; // Legacy
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
};

const isToday = (dateStr: string) => getGroupLabel(dateStr) === 'Today';

const cleanInlineText = (value?: string) => {
    if (!value) return '';
    return value
        .replace(/<br\s*\/?>(\r?\n)?/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[#*_`>•-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const truncateSentence = (value: string, maxLength = 112) => {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 1).trim()}...`;
};

const getMeetingSummaryLine = (meeting: Meeting) => {
    if (meeting.title === 'Processing...') return 'Transcript is being processed into notes.';

    const summary = cleanInlineText(meeting.summary);
    if (summary) return truncateSentence(summary);

    const firstKeyPoint = meeting.detailedSummary?.keyPoints?.find(Boolean);
    if (firstKeyPoint) return truncateSentence(cleanInlineText(firstKeyPoint));

    const usageCount = meeting.usage?.length ?? 0;
    if (usageCount > 0) return `${usageCount} AI assist ${usageCount === 1 ? 'interaction' : 'interactions'} captured.`;

    return 'No AI summary captured yet.';
};

const getMeetingTypeMeta = (meeting: Meeting): { label: string; Icon: LucideIcon; tone: string } => {
    const title = meeting.title.toLowerCase();
    const usageTypes = new Set((meeting.usage ?? []).map((item) => item.type));

    if (meeting.title === 'Processing...') {
        return { label: 'Processing', Icon: RefreshCw, tone: 'text-blue-500 bg-blue-500/10 border-blue-500/15' };
    }

    if (title.includes('interview') || title.includes('technical') || title.includes('coding') || usageTypes.has('followup_questions')) {
        return { label: 'Interview', Icon: Code2, tone: 'text-amber-500 bg-amber-500/10 border-amber-500/15' };
    }

    if (title.includes('sales') || title.includes('customer') || title.includes('discovery')) {
        return { label: 'Customer', Icon: BriefcaseBusiness, tone: 'text-sky-500 bg-sky-500/10 border-sky-500/15' };
    }

    if (title.includes('standup') || title.includes('sync') || title.includes('team') || meeting.source === 'calendar') {
        return { label: 'Team sync', Icon: Users, tone: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/15' };
    }

    if (usageTypes.has('chat') || usageTypes.has('assist')) {
        return { label: 'Assisted', Icon: MessageSquareText, tone: 'text-violet-500 bg-violet-500/10 border-violet-500/15' };
    }

    return { label: 'Meeting', Icon: FileText, tone: 'text-text-secondary bg-bg-item-surface border-border-subtle' };
};

const getMeetingStatusMeta = (meeting: Meeting) => {
    if (meeting.title === 'Processing...') {
        return { label: 'Processing', className: 'text-blue-500 bg-blue-500/10 border-blue-500/15' };
    }

    if (cleanInlineText(meeting.summary) || (meeting.detailedSummary?.keyPoints?.length ?? 0) > 0) {
        return { label: 'Summary ready', className: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/15' };
    }

    if ((meeting.usage?.length ?? 0) > 0) {
        return { label: 'Assisted', className: 'text-violet-500 bg-violet-500/10 border-violet-500/15' };
    }

    return { label: 'Captured', className: 'text-text-secondary bg-bg-item-surface border-border-subtle' };
};

const inferTopicsFromEvent = (event: NormalizedEvent | null, recommendation: CalendarModeRecommendation | null) => {
    const topics = new Set<string>();

    recommendation?.matchedSignals?.slice(0, 3).forEach((signal) => {
        const cleaned = cleanInlineText(signal).replace(/_/g, ' ');
        if (cleaned) topics.add(cleaned);
    });

    const text = `${event?.summary ?? ''} ${event?.description ?? ''}`.toLowerCase();
    const topicMap: Array<[string, string]> = [
        ['interview', 'Interview loop'],
        ['technical', 'Technical depth'],
        ['coding', 'Coding discussion'],
        ['system design', 'System design'],
        ['roadmap', 'Roadmap decisions'],
        ['planning', 'Planning'],
        ['sales', 'Customer context'],
        ['demo', 'Demo flow'],
        ['retro', 'Retrospective'],
        ['standup', 'Status updates'],
        ['sync', 'Team alignment'],
        ['hiring', 'Hiring pipeline'],
        ['recruit', 'Recruiting'],
    ];

    topicMap.forEach(([keyword, label]) => {
        if (text.includes(keyword)) topics.add(label);
    });

    if (topics.size === 0 && event?.platform) {
        topics.add(event.isInterview ? 'Interview preparation' : 'Agenda review');
    }

    return Array.from(topics).slice(0, 4);
};

const buildPreparationNotes = (event: NormalizedEvent | null, recommendation: CalendarModeRecommendation | null) => {
    const notes: string[] = [];

    if (recommendation?.summary) {
        notes.push(truncateSentence(cleanInlineText(recommendation.summary), 92));
    }

    recommendation?.suggestedReferences?.slice(0, 2).forEach((reference) => {
        const cleaned = cleanInlineText(reference);
        if (cleaned) notes.push(truncateSentence(cleaned, 92));
    });

    if (event?.description && notes.length < 3) {
        notes.push(truncateSentence(`Review event notes: ${cleanInlineText(event.description)}`, 92));
    }

    if (notes.length < 3) {
        notes.push('Confirm the agenda and the first decision you need from the room.');
    }

    if (notes.length < 3) {
        notes.push('Keep Quietly ready for follow-up questions and concise recap capture.');
    }

    return notes.slice(0, 3);
};

const getParticipantLabel = (participants: CalendarParticipant[] | null) => {
    if (participants === null) return 'Checking participants...';
    if (participants.length === 0) return 'Participant details unavailable';

    const names = participants
        .slice(0, 3)
        .map((participant) => participant.name || participant.email)
        .filter(Boolean);

    const extra = participants.length - names.length;
    return extra > 0 ? `${names.join(', ')} +${extra}` : names.join(', ');
};

const getRecommendationConfidenceLabel = (confidence: number) => {
    if (!Number.isFinite(confidence)) return '0% confidence';
    const percent = confidence <= 1 ? confidence * 100 : confidence;
    const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
    return `${clampedPercent}% confidence`;
};

type RefreshNotification = {
    title: string;
    message: string;
    tone: 'success' | 'warning';
};

const CALENDAR_REFRESH_GATE_MESSAGE = 'Connect Google Calendar before refreshing calendar events.';

const Launcher: React.FC<LauncherProps> = ({ onStartMeeting, onOpenSettings, onOpenModes, onOpenProfile, onPageChange, ollamaPullStatus = 'idle', ollamaPullPercent = 0, ollamaPullMessage = '' }) => {
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [isDetectable, setIsDetectable] = useState(false);
    const [planTier, setPlanTier] = useState<'free' | 'pro' | 'pro_plus'>('free');
    const isProPlus = planTier === 'pro_plus';
    const [isMeetingActive, setIsMeetingActive] = useState(false);
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
    const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
    const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
    const [isCalendarConnected, setIsCalendarConnected] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showEvents, setShowEvents] = useState(false);
    const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
    const [refreshNotification, setRefreshNotification] = useState<RefreshNotification | null>(null);
    const [calendarRecommendation, setCalendarRecommendation] = useState<CalendarModeRecommendation | null>(null);
    const [isCalendarRecommendationOpen, setIsCalendarRecommendationOpen] = useState(false);
    const [isApplyingCalendarMode, setIsApplyingCalendarMode] = useState(false);
    const [calendarRecommendationError, setCalendarRecommendationError] = useState<string | null>(null);

    // Global search state (for AI chat overlay)
    const [isGlobalChatOpen, setIsGlobalChatOpen] = useState(false);
    const [submittedGlobalQuery, setSubmittedGlobalQuery] = useState('');

    const [showModesOnboarding, setShowModesOnboarding] = useState(false);
    const [showProfileOnboarding, setShowProfileOnboarding] = useState(false);
    const launcherScrollRef = useRef<HTMLElement | null>(null);
    const refreshNotificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
    const [nextEventParticipants, setNextEventParticipants] = useState<CalendarParticipant[] | null>(null);

    const upcomingCalendarEvents = useMemo(() => getUpcomingEvents(upcomingEvents), [upcomingEvents]);
    const nextCalendarEvent = upcomingCalendarEvents[0] ?? null;
    const nextCalendarEventId = nextCalendarEvent?.id ?? null;

    const showRefreshNotification = (notification: RefreshNotification) => {
        if (refreshNotificationTimerRef.current) {
            clearTimeout(refreshNotificationTimerRef.current);
        }

        setRefreshNotification(notification);
        refreshNotificationTimerRef.current = setTimeout(() => {
            setRefreshNotification(null);
            refreshNotificationTimerRef.current = null;
        }, 3000);
    };

    useEffect(() => {
        return () => {
            if (refreshNotificationTimerRef.current) {
                clearTimeout(refreshNotificationTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        setNextEventParticipants(null);

        if (!isCalendarConnected || !nextCalendarEventId || !window.electronAPI?.getCalendarAttendees) {
            setNextEventParticipants([]);
            return () => {
                cancelled = true;
            };
        }

        window.electronAPI.getCalendarAttendees(nextCalendarEventId)
            .then((participants) => {
                if (!cancelled) {
                    setNextEventParticipants(Array.isArray(participants) ? participants : []);
                }
            })
            .catch(() => {
                if (!cancelled) setNextEventParticipants([]);
            });

        return () => {
            cancelled = true;
        };
    }, [isCalendarConnected, nextCalendarEventId]);

    const fetchMeetings = () => {
        if (window.electronAPI && window.electronAPI.getRecentMeetings) {
            window.electronAPI.getRecentMeetings().then(setMeetings).catch(err => console.error("Failed to fetch meetings:", err));
        }
    };

    const applyEvents = (events: any[]) => {
        const safeEvents = Array.isArray(events) ? events : [];
        setUpcomingEvents(safeEvents);
        // Keep the calendar panel mounted whenever we have fetched events at all.
        // The panel itself handles the "next 8 hours" empty state.
        setShowEvents(safeEvents.length > 0);
        setCalendarRecommendationError(null);
        void refreshCalendarRecommendation(safeEvents);
    };

    const refreshCalendarRecommendation = async (events: any[]) => {
        if (!window.electronAPI?.calendarIntelligenceEvaluateEvents) return;
        try {
            const recommendation = await window.electronAPI.calendarIntelligenceEvaluateEvents(events);
            setCalendarRecommendation(recommendation);
            setIsCalendarRecommendationOpen(false);
            setCalendarRecommendationError(null);
        } catch (error) {
            console.error('Failed to evaluate calendar recommendation:', error);
        }
    };

    const syncCalendarConnection = async (): Promise<boolean> => {
        try {
            const result = await window.electronAPI?.googleVerifySession?.();
            if (result?.authState) {
                const connected = Boolean(result.authState.calendarConnected);
                setIsCalendarConnected(connected);
                return connected;
            }

            const authState = await window.electronAPI?.googleGetAuthState?.();
            const connected = Boolean(authState?.calendarConnected);
            setIsCalendarConnected(connected);
            return connected;
        } catch {
            setIsCalendarConnected(false);
            return false;
        }
    };

    const fetchEvents = async (options: { notifyWhenDisconnected?: boolean; skipConnectionCheck?: boolean } = {}): Promise<boolean> => {
        const calendarConnected = options.skipConnectionCheck ? true : await syncCalendarConnection();
        if (!calendarConnected) {
            applyEvents([]);
            if (options.notifyWhenDisconnected) {
                showRefreshNotification({
                    title: 'Calendar not connected',
                    message: CALENDAR_REFRESH_GATE_MESSAGE,
                    tone: 'warning',
                });
            }
            return false;
        }

        try {
            if (window.electronAPI?.googleGetCalendarEvents) {
                const result = await window.electronAPI.googleGetCalendarEvents();
                if (result?.events && Array.isArray(result.events)) {
                    applyEvents(result.events);
                    // Backend responded with events payload => calendar connection is valid,
                    // even when there are zero events in the next window.
                    setIsCalendarConnected(true);
                    return true;
                } else if (result && result.success === false) {
                    // Backend returned an error, e.g. 'Calendar not connected'
                    // Do not fallback to legacy, since backend is the source of truth
                    console.warn("Backend calendar fetch returned error:", result.error);
                    if (result.error === 'Calendar not connected') {
                        setIsCalendarConnected(false);
                        applyEvents([]);
                        if (options.notifyWhenDisconnected) {
                            showRefreshNotification({
                                title: 'Calendar not connected',
                                message: CALENDAR_REFRESH_GATE_MESSAGE,
                                tone: 'warning',
                            });
                        }
                    }
                    return false;
                }
            }
        } catch (err) {
            console.warn("Backend calendar fetch failed:", err);
        }

        applyEvents([]);
        return false;
    };

    const handleRefresh = async () => {
        try {
            const calendarConnected = await syncCalendarConnection();
            if (!calendarConnected) {
                applyEvents([]);
                showRefreshNotification({
                    title: 'Calendar not connected',
                    message: CALENDAR_REFRESH_GATE_MESSAGE,
                    tone: 'warning',
                });
                return;
            }

            setIsRefreshing(true);
            setIsSyncingCalendar(true);
            analytics.trackCommandExecuted('refresh_calendar');

            const refreshedCalendar = await fetchEvents({ notifyWhenDisconnected: true, skipConnectionCheck: true });
            if (refreshedCalendar) {
                showRefreshNotification({
                    title: 'Refreshed',
                    message: 'Synced with calendar',
                    tone: 'success',
                });
            }
            fetchMeetings();
        } catch (e) {
            console.error("Refresh failed in handleRefresh:", e);
        } finally {
            setTimeout(() => setIsSyncingCalendar(false), 320);
            // Ensure distinct feedback provided (min 500ms spin)
            setTimeout(() => setIsRefreshing(false), 500);
        }
    };

    // Keybinds
    const { isShortcutPressed } = useShortcuts();
    const isLight = useResolvedTheme() === 'light';
    useEffect(() => {
        let mounted = true;
        console.log("Launcher mounted");
        // Seed demo meeting on first launch so new users see an example in the launcher
        if (window.electronAPI && window.electronAPI.seedDemo) {
            window.electronAPI.seedDemo().catch(err => console.error("Failed to seed demo:", err));
        }

        // Onboarding sequence: Modes (4s) → 2s gap → Quietly Intelligence (4s)
        const modesShowTimer = setTimeout(() => {
            if (mounted) {
                setShowModesOnboarding(true);
                // Auto-dismiss Modes after 4 seconds
                const modesHideTimer = setTimeout(() => {
                    if (mounted) {
                        setShowModesOnboarding(false);
                        // Show Quietly Intelligence after 2 second gap
                        const profileShowTimer = setTimeout(() => {
                            if (mounted) {
                                setShowProfileOnboarding(true);
                                // Auto-dismiss Quietly Intelligence after 4 seconds
                                const profileHideTimer = setTimeout(() => {
                                    if (mounted) setShowProfileOnboarding(false);
                                }, 4000);
                                timers.push(profileHideTimer);
                            }
                        }, 2000);
                        timers.push(profileShowTimer);
                    }
                }, 4000);
                timers.push(modesHideTimer);
            }
        }, 3000);
        const timers: ReturnType<typeof setTimeout>[] = [modesShowTimer];

        // Sync initial undetectable state
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then((undetectable) => {
                if (mounted) setIsDetectable(!undetectable);
            });
        }

        // Fetch plan tier for UI gating
        window.electronAPI?.licenseGetTier?.().then((result) => {
            if (mounted && result?.tier) setPlanTier(result.tier);
        }).catch(() => {});

        // Listen for undetectable changes
        let removeUndetectableListener: (() => void) | undefined;
        if (window.electronAPI?.onUndetectableChanged) {
            removeUndetectableListener = window.electronAPI.onUndetectableChanged((undetectable) => {
                setIsDetectable(!undetectable);
            });
        }

        fetchMeetings();
        fetchEvents();

        void syncCalendarConnection();
        if (window.electronAPI?.calendarIntelligenceGetRecommendation) {
            void window.electronAPI.calendarIntelligenceGetRecommendation()
                .then((recommendation) => {
                    if (mounted) {
                        setCalendarRecommendation(recommendation);
                        setIsCalendarRecommendationOpen(false);
                        setCalendarRecommendationError(null);
                    }
                })
                .catch(() => { });
        }

        let removeCalendarStatusListener: (() => void) | undefined;
        if (window.electronAPI?.onCalendarStatusChanged) {
            removeCalendarStatusListener = window.electronAPI.onCalendarStatusChanged((status) => {
                if (!mounted) return;

                setIsCalendarConnected(Boolean(status.connected));
            });
        }

        let removeCalendarRecommendationListener: (() => void) | undefined;
        if (window.electronAPI?.onCalendarRecommendationChanged) {
            removeCalendarRecommendationListener = window.electronAPI.onCalendarRecommendationChanged((recommendation) => {
                if (!mounted) return;
                setCalendarRecommendation(recommendation);
                setIsCalendarRecommendationOpen(false);
                setCalendarRecommendationError(null);
            });
        }

        const handleCalendarStatusSync = (event: Event) => {
            const customEvent = event as CustomEvent<{ connected: boolean }>;
            if (!mounted) return;
            if (customEvent.detail && typeof customEvent.detail.connected === 'boolean') {
                setIsCalendarConnected(customEvent.detail.connected);
                return;
            }
            void syncCalendarConnection();
        };
        window.addEventListener('teamsync:calendar-status-changed', handleCalendarStatusSync as EventListener);

        // Sync initial meeting active state — guarded so unmounted component isn't written to
        if (window.electronAPI?.getMeetingActive) {
            window.electronAPI.getMeetingActive()
                .then((active) => { if (mounted) setIsMeetingActive(active); })
                .catch(() => { });
        }

        // Listen for meeting state changes (e.g. meeting started/ended from overlay)
        let removeMeetingStateListener: (() => void) | undefined;
        if (window.electronAPI?.onMeetingStateChanged) {
            removeMeetingStateListener = window.electronAPI.onMeetingStateChanged(({ isActive }) => {
                setIsMeetingActive(isActive);
            });
        }

        // Listen for background updates (e.g. after meeting processing finishes)
        const removeMeetingsListener = window.electronAPI.onMeetingsUpdated(() => {
            console.log("Received meetings-updated event");
            fetchMeetings();
        });

        // Simple polling for events every minute
        const interval = setInterval(fetchEvents, 60000);

        return () => {
            mounted = false;
            if (removeMeetingsListener) removeMeetingsListener();
            if (removeUndetectableListener) removeUndetectableListener();
            if (removeMeetingStateListener) removeMeetingStateListener();
            if (removeCalendarStatusListener) removeCalendarStatusListener();
            if (removeCalendarRecommendationListener) removeCalendarRecommendationListener();
            window.removeEventListener('teamsync:calendar-status-changed', handleCalendarStatusSync as EventListener);
            clearInterval(interval);
            timers.forEach(t => clearTimeout(t));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Mount-only: stable setup that must run exactly once

    // Separate effect for keyboard listener — re-registers when isShortcutPressed changes
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const isInput = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

            if (!selectedMeeting && !isGlobalChatOpen && !isInput) {
                const currentIndex = flattenedMeetings.findIndex((meeting) => meeting.id === selectedMeetingId);
                if (e.key === 'ArrowDown' && flattenedMeetings.length > 0) {
                    e.preventDefault();
                    const nextMeeting = flattenedMeetings[Math.min(flattenedMeetings.length - 1, Math.max(0, currentIndex) + 1)];
                    if (nextMeeting) {
                        setSelectedMeetingId(nextMeeting.id);
                    }
                    return;
                } else if (e.key === 'ArrowUp' && flattenedMeetings.length > 0) {
                    e.preventDefault();
                    const nextMeeting = flattenedMeetings[Math.max(0, Math.max(0, currentIndex) - 1)];
                    if (nextMeeting) {
                        setSelectedMeetingId(nextMeeting.id);
                    }
                    return;
                } else if (e.key === 'Enter' && currentIndex >= 0) {
                    e.preventDefault();
                    void handleOpenMeeting(flattenedMeetings[currentIndex]);
                    return;
                } else if (e.key === 'PageUp') {
                    e.preventDefault();
                    launcherScrollRef.current?.scrollBy({ top: -360, behavior: 'smooth' });
                    return;
                } else if (e.key === 'PageDown') {
                    e.preventDefault();
                    launcherScrollRef.current?.scrollBy({ top: 360, behavior: 'smooth' });
                    return;
                }
            }

            if (isShortcutPressed(e, 'toggleVisibility')) {
                e.preventDefault();
                window.electronAPI.toggleWindow();
            } else if (isShortcutPressed(e, 'moveWindowUp')) {
                e.preventDefault();
                window.electronAPI.moveWindowUp?.();
            } else if (isShortcutPressed(e, 'moveWindowDown')) {
                e.preventDefault();
                window.electronAPI.moveWindowDown?.();
            } else if (isShortcutPressed(e, 'moveWindowLeft')) {
                e.preventDefault();
                window.electronAPI.moveWindowLeft?.();
            } else if (isShortcutPressed(e, 'moveWindowRight')) {
                e.preventDefault();
                window.electronAPI.moveWindowRight?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isGlobalChatOpen, isShortcutPressed, meetings, selectedMeeting, selectedMeetingId]);

    const handleDismissCalendarRecommendation = async () => {
        if (!calendarRecommendation) return;
        setCalendarRecommendation(null);
        setIsCalendarRecommendationOpen(false);
        setCalendarRecommendationError(null);

        try {
            await window.electronAPI?.calendarIntelligenceDismiss?.(calendarRecommendation.eventId);
        } catch (error) {
            console.error('Failed to dismiss calendar recommendation:', error);
        }
    };

    const handleApplyCalendarRecommendation = async (modeId: ModeOverrideId) => {
        if (!calendarRecommendation || isApplyingCalendarMode) return;

        setIsApplyingCalendarMode(true);
        setCalendarRecommendationError(null);

        try {
            const allModes = await window.electronAPI.modesGetAll();
            let targetMode = allModes.find((mode) => mode.templateType === modeId);

            if (!targetMode) {
                const created = await window.electronAPI.modesCreate({ templateId: modeId });
                if (!created.success || !created.mode?.id) {
                    throw new Error(created.error || 'Unable to create the recommended mode.');
                }

                targetMode = created.mode;
            }

            if (!targetMode?.id) {
                throw new Error('Unable to resolve the recommended mode.');
            }

            const result = await window.electronAPI.modesSetActive(targetMode.id);
            if (!result.success) {
                if (result.error === 'PRO_REQUIRED') {
                    throw new Error('Pro or trial access is required to apply this mode.');
                }
                throw new Error(result.error || 'Unable to apply the recommended mode.');
            }

            analytics.trackCommandExecuted(modeId === calendarRecommendation.recommendedMode ? 'calendar_apply_mode' : 'calendar_override_mode');
            await window.electronAPI?.calendarIntelligenceDismiss?.(calendarRecommendation.eventId);

            // Sync the selected mode in ModesSettings so it highlights the newly active mode
            await window.electronAPI?.modesSetSelected?.(targetMode.id).catch(() => { });

            // Inject calendar event context into the AI prompt pipeline
            try {
                await window.electronAPI?.modesSetMeetingContext?.({
                    eventTitle: calendarRecommendation.title,
                    description: calendarRecommendation.description,
                    startTime: calendarRecommendation.startTime,
                    endTime: calendarRecommendation.endTime,
                    participants: nextEventParticipants ?? undefined,
                });
            } catch (contextError) {
                console.warn('Failed to set meeting context:', contextError);
            }

            setCalendarRecommendation(null);
            setIsCalendarRecommendationOpen(false);

            // Open the Modes panel so the user can see the mode is now active
            onOpenModes?.();
        } catch (error) {
            console.error('Failed to apply calendar recommendation:', error);
            setCalendarRecommendationError(error instanceof Error ? error.message : 'Unable to apply the recommended mode.');
        } finally {
            setIsApplyingCalendarMode(false);
        }
    };

    useEffect(() => {
        if (!calendarRecommendation || !isCalendarRecommendationOpen) return;

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsCalendarRecommendationOpen(false);
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [calendarRecommendation, isCalendarRecommendationOpen]);

    if (!window.electronAPI) {
        return <div className="text-white p-10">Error: Electron API not initialized. Check preload script.</div>;
    }

    const toggleDetectable = () => {
        if (!isProPlus) return;
        const newState = !isDetectable;
        setIsDetectable(newState);
        window.electronAPI?.setUndetectable(!newState); // Note: setUndetectable takes the *undetectable* state, which is inverse of *detectable*
        analytics.trackModeSelected(newState ? 'launcher' : 'undetectable'); // If visible (detectable), mode is normal/launcher. If not detectable, mode is undetectable.
    };

    // Separate the demo/guide meeting so it's always pinned at the bottom
    const demoMeeting = meetings.find((m) => m.id === 'demo-meeting');
    const regularMeetings = meetings.filter((m) => m.id !== 'demo-meeting');

    // Group regular meetings by date
    const groupedMeetings = regularMeetings.reduce((acc, meeting) => {
        const label = getGroupLabel(meeting.date);
        if (!acc[label]) acc[label] = [];
        acc[label].push(meeting);
        return acc;
    }, {} as Record<string, Meeting[]>);

    // Group order (Today, Yesterday, then others sorted new to old is implicit via API return order ideally, 
    // but JS object key order isn't guaranteed. We can use a Map or just known keys.)
    // Simple sort for keys:
    const sortedGroups = Object.keys(groupedMeetings).sort((a, b) => {
        if (a === 'Today') return -1;
        if (b === 'Today') return 1;
        if (a === 'Yesterday') return -1;
        if (b === 'Yesterday') return 1;
        // Approximation for others: parse date
        return new Date(b).getTime() - new Date(a).getTime();
    });

    // Append the demo meeting as a pinned bottom group
    if (demoMeeting) {
        const pinnedLabel = 'Getting Started';
        groupedMeetings[pinnedLabel] = [demoMeeting];
        sortedGroups.push(pinnedLabel);
    }

    const flattenedMeetings = sortedGroups.flatMap((label) => groupedMeetings[label]);
    const todayMeetings = meetings.filter((meeting) => isToday(meeting.date));
    const nextEventTimeLabel = nextCalendarEvent
        ? new Date(nextCalendarEvent.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
        : null;
    const nextEventWindowLabel = nextCalendarEvent
        ? formatTimeRange(nextCalendarEvent.startTime, nextCalendarEvent.endTime)
        : null;
    const likelyTopics = inferTopicsFromEvent(nextCalendarEvent, calendarRecommendation);
    const preparationNotes = buildPreparationNotes(nextCalendarEvent, calendarRecommendation);
    const todaySummaryLabel = todayMeetings.length > 0
        ? `${todayMeetings.length} ${todayMeetings.length === 1 ? 'meeting' : 'meetings'} captured today`
        : 'No meetings captured today';
    const nextEventLabel = isCalendarConnected
        ? (nextCalendarEvent ? `${nextCalendarEvent.summary} at ${nextEventTimeLabel}` : 'No upcoming event')
        : 'Calendar not connected';


    const [forwardMeeting, setForwardMeeting] = useState<Meeting | null>(null);
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [menuEntered, setMenuEntered] = useState(false);

    useEffect(() => {
        setMenuEntered(false);
    }, [activeMenuId]);

    useEffect(() => {
        if (flattenedMeetings.length === 0) {
            setSelectedMeetingId(null);
            return;
        }

        if (!selectedMeetingId || !flattenedMeetings.some((meeting) => meeting.id === selectedMeetingId)) {
            setSelectedMeetingId(flattenedMeetings[0]?.id ?? null);
        }
    }, [flattenedMeetings, selectedMeetingId]);

    useEffect(() => {
        if (!selectedMeetingId) {
            return;
        }

        const node = document.querySelector<HTMLElement>(`[data-meeting-id="${selectedMeetingId}"]`);
        node?.scrollIntoView({ block: 'nearest' });
    }, [selectedMeetingId]);

    // Global click listener to close menu
    useEffect(() => {
        const handleClickOutside = () => setActiveMenuId(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    // Notify parent if we are on the main launcher list view
    useEffect(() => {
        if (onPageChange) {
            onPageChange(!selectedMeeting && !isGlobalChatOpen);
        }
    }, [selectedMeeting, isGlobalChatOpen, onPageChange]);

    const handleOpenMeeting = async (meeting: Meeting) => {
        setForwardMeeting(null); // Clear forward history on new navigation
        setSelectedMeetingId(meeting.id);
        console.log("[Launcher] Opening meeting:", meeting.id);
        analytics.trackCommandExecuted('open_meeting_details');

        // Fetch full meeting details including transcript and usage
        if (window.electronAPI && window.electronAPI.getMeetingDetails) {
            try {
                console.log("[Launcher] Fetching full meeting details...");
                const fullMeeting = await window.electronAPI.getMeetingDetails(meeting.id);
                console.log("[Launcher] Got meeting details:", fullMeeting);
                console.log("[Launcher] Transcript count:", fullMeeting?.transcript?.length);
                console.log("[Launcher] Usage count:", fullMeeting?.usage?.length);
                if (fullMeeting) {
                    setSelectedMeeting(fullMeeting);
                    return;
                }
            } catch (err) {
                console.error("[Launcher] Failed to fetch meeting details:", err);
            }
        } else {
            console.warn("[Launcher] getMeetingDetails not available on electronAPI");
        }
        // Fallback to list-view data if fetch fails
        setSelectedMeeting(meeting);
    };

    const handleBack = () => {
        setForwardMeeting(selectedMeeting);
        setSelectedMeeting(null);
    };

    const handleForward = () => {
        if (forwardMeeting) {
            setSelectedMeeting(forwardMeeting);
            setForwardMeeting(null);
        }
    };

    // Helper to format duration to mm:ss or mmm:ss
    // Helper to format duration to mm:ss or mmm:ss
    const formatDurationPill = (durationStr: string) => {
        if (!durationStr) return "00:00";

        // Check if it's already in colon format (e.g. "5:30", "105:20")
        if (durationStr.includes(':')) {
            const parts = durationStr.split(':');
            const mins = parts[0];
            const secs = parts[1] || "00";

            // Allow 3 digits for mins if >= 100, otherwise pad to 2
            const formattedMins = mins.length >= 3 ? mins : mins.padStart(2, '0');
            return `${formattedMins}:${secs}`;
        }

        // Fallback for "X min" format (legacy)
        const minutes = parseInt(durationStr.replace('min', '').trim()) || 0;
        const mm = minutes.toString().padStart(2, '0');
        return `${mm}:00`;
    };

    const handlePrepareMeeting = () => {
        if (!nextCalendarEvent) {
            void handleRefresh();
            return;
        }

        if (calendarRecommendation) {
            setIsCalendarRecommendationOpen(true);
            analytics.trackCommandExecuted('calendar_prepare_meeting');
            return;
        }

        analytics.trackCommandExecuted('calendar_prepare_start_meeting');
        void onStartMeeting({
            title: nextCalendarEvent.summary,
            calendarEventId: nextCalendarEvent.id,
            source: 'calendar',
        });
    };

    return (
        <div className="h-full w-full flex flex-col bg-bg-primary text-text-primary font-sans overflow-hidden selection:bg-accent-secondary/30">
            {/* 1. Header (Static) */}
            <header className="relative w-full h-[40px] shrink-0 flex items-center justify-between pl-0 drag-region select-none bg-bg-secondary border-b border-border-subtle z-[200]">
                {/* Left: Spacing for Traffic Lights + Navigation Arrows */}
                <div className="flex items-center gap-1 no-drag">
                    {isMac && <div className="w-[70px]" />} {/* Traffic Light Spacer (macOS only) */}

                    {/* Back Button */}
                    <button
                        onClick={selectedMeeting ? handleBack : undefined}
                        disabled={!selectedMeeting}
                        className={`
                            transition-all duration-300 p-1 flex items-center justify-center mt-1 ml-2
                            ${selectedMeeting
                                ? `text-text-secondary hover:text-text-primary ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`
                                : 'text-text-tertiary opacity-50 cursor-default'}
                        `}
                    >
                        <ArrowLeft size={16} />
                    </button>

                    {/* Forward Button */}
                    <button
                        onClick={handleForward}
                        disabled={!forwardMeeting}
                        className={`
                            transition-all duration-300 p-1 flex items-center justify-center mt-1
                            ${forwardMeeting
                                ? `text-text-secondary hover:text-text-primary ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`
                                : 'text-text-tertiary opacity-0 cursor-default'}
                        `}
                    >
                        <ArrowRight size={16} />
                    </button>
                </div>


                {/* Center: Spotlight-style Search Pill */}
                <TopSearchPill
                    dataTourId="control-center"
                    meetings={meetings}
                    onAIQuery={(query) => {
                        analytics.trackCommandExecuted('ai_query_search');
                        setSubmittedGlobalQuery(query);
                        setIsGlobalChatOpen(true);
                    }}
                    onLiteralSearch={(query) => {
                        // For now, also use AI query for literal search
                        // Could be enhanced to do fuzzy filtering in the UI
                        analytics.trackCommandExecuted('literal_search');
                        setSubmittedGlobalQuery(query);
                        setIsGlobalChatOpen(true);
                    }}
                    onOpenMeeting={(meetingId) => {
                        const meeting = meetings.find(m => m.id === meetingId);
                        if (meeting) {
                            handleOpenMeeting(meeting);
                            analytics.trackCommandExecuted('open_meeting_from_search');
                        }
                    }}
                />

                {/* Right: Actions */}
                <div className={`flex items-center gap-1 no-drag shrink-0 ${isMac ? 'mr-1' : ''}`}>
                    {/* Profile Knowledge icon + onboarding tooltip */}
                    <div className="relative group/profile-btn select-none">
                        <button
                            onClick={() => {
                                setShowProfileOnboarding(false);
                                onOpenProfile?.();
                            }}
                            title="Profile Knowledge"
                            className={`p-2 text-text-secondary hover:text-text-primary transition-all duration-300 ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`}
                        >
                            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                            </svg>
                        </button>

                        <AnimatePresence>
                            {showProfileOnboarding && (
                                <motion.div
                                    initial={{ opacity: 0, y: 6, scale: 0.96, filter: "blur(4px)" }}
                                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                                    exit={{ opacity: 0, y: -2, scale: 0.98, filter: "blur(2px)", transition: { duration: 0.15, ease: "easeOut" } }}
                                    transition={{ type: "spring", stiffness: 350, damping: 25, mass: 1 }}
                                    className={`absolute top-[38px] right-2 w-[270px] rounded-[20px] p-4 z-[300] origin-top-right backdrop-blur-[40px] saturate-[180%] transform-gpu ${isLight
                                        ? 'bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]'
                                        : 'bg-[#18181A]/70 shadow-[0_8px_30px_rgb(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)]'
                                        }`}
                                >
                                    {/* Triangle Pointer */}
                                    <div className={`absolute -top-[5px] right-[14px] w-2.5 h-2.5 rotate-45 rounded-tl-[3px] ${isLight
                                        ? 'bg-white/70 border-t border-l border-black/5 backdrop-blur-[40px]'
                                        : 'bg-[#18181A]/70 border-t border-l border-white/5 backdrop-blur-[40px]'
                                        }`} />

                                    <div className="relative flex gap-3">
                                        <div className={`w-9 h-9 flex items-center justify-center shrink-0 rounded-full ${isLight
                                            ? 'bg-violet-500 bg-opacity-10 text-violet-500'
                                            : 'bg-violet-500 bg-opacity-15 text-violet-400'
                                            }`}>
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                                <circle cx="12" cy="7" r="4" />
                                            </svg>
                                        </div>
                                        <div className="flex-1 pt-[2px]">
                                            <h3 className="text-[14px] font-semibold tracking-[-0.015em] mb-1 flex items-center gap-2">
                                                <span className={isLight ? 'text-slate-900' : 'text-slate-100'}>Profile Knowledge</span>
                                                <span className={`text-[10px] font-medium px-1.5 py-[1px] rounded-[5px] ${isLight
                                                    ? 'bg-violet-50 text-violet-600 border border-violet-100/50'
                                                    : 'bg-violet-500/10 text-violet-400'
                                                    }`}>
                                                    Beta
                                                </span>
                                            </h3>
                                            <p className={`text-[12px] leading-[1.35] mb-3.5 tracking-[-0.01em] ${isLight ? 'text-slate-500' : 'text-slate-400'
                                                }`}>
                                                Your career graph — resume, skills, and job context for personalized AI.
                                            </p>
                                            <div className="flex justify-end gap-1.5 isolate">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setShowProfileOnboarding(false);
                                                    }}
                                                    className={`text-[12px] font-medium px-3.5 py-[6px] rounded-full transition-all active:scale-95 ${isLight
                                                        ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/60'
                                                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/10'
                                                        }`}
                                                >
                                                    Dismiss
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onOpenProfile?.();
                                                        setShowProfileOnboarding(false);
                                                    }}
                                                    className={`text-[12px] font-medium px-4 py-[6px] rounded-full transition-all active:scale-95 shadow-sm ${isLight
                                                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                                                        : 'bg-slate-100 text-slate-900 hover:bg-white'
                                                        }`}
                                                >
                                                    Try it out
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <div className="relative group/modes-btn select-none">
                        <button
                            data-tour-id="interview-mode"
                            onClick={() => {
                                setShowModesOnboarding(false);
                                setTimeout(() => setShowProfileOnboarding(true), 2000);
                                onOpenModes?.();
                            }}
                            title="Modes"
                            className={`p-2 text-text-secondary hover:text-text-primary transition-all duration-300 ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`}
                        >
                            <svg width={18} height={18} viewBox="0 0 14 14" fill="none">
                                <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9" />
                                <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9" />
                                <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9" />
                                <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.35" />
                            </svg>
                        </button>

                        <AnimatePresence>
                            {showModesOnboarding && (
                                <motion.div
                                    initial={{ opacity: 0, y: 6, scale: 0.96, filter: "blur(4px)" }}
                                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                                    exit={{ opacity: 0, y: -2, scale: 0.98, filter: "blur(2px)", transition: { duration: 0.15, ease: "easeOut" } }}
                                    transition={{ type: "spring", stiffness: 350, damping: 25, mass: 1 }}
                                    className={`absolute top-[38px] right-2 w-[270px] rounded-[20px] p-4 z-[300] origin-top-right backdrop-blur-[40px] saturate-[180%] transform-gpu ${isLight
                                        ? 'bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]'
                                        : 'bg-[#18181A]/70 shadow-[0_8px_30px_rgb(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)]'
                                        }`}
                                >
                                    {/* Triangle Pointer */}
                                    <div className={`absolute -top-[5px] right-[14px] w-2.5 h-2.5 rotate-45 rounded-tl-[3px] ${isLight
                                        ? 'bg-white/70 border-t border-l border-black/5 backdrop-blur-[40px]'
                                        : 'bg-[#18181A]/70 border-t border-l border-white/5 backdrop-blur-[40px]'
                                        }`} />

                                    <div className="relative flex gap-3">
                                        <div className={`w-9 h-9 flex items-center justify-center shrink-0 rounded-full ${isLight
                                            ? 'bg-orange-500 bg-opacity-10 text-orange-500'
                                            : 'bg-orange-500 bg-opacity-15 text-orange-400'
                                            }`}>
                                            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
                                                <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9" />
                                                <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9" />
                                                <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9" />
                                                <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.4" />
                                            </svg>
                                        </div>
                                        <div className="flex-1 pt-[2px]">
                                            <h3 className="text-[14px] font-semibold tracking-[-0.015em] mb-1 flex items-center gap-2">
                                                <span className={isLight ? 'text-slate-900' : 'text-slate-100'}>Modes</span>
                                                <span className={`text-[10px] font-medium px-1.5 py-[1px] rounded-[5px] ${isLight
                                                    ? 'bg-orange-50 text-orange-600 border border-orange-100/50'
                                                    : 'bg-orange-500/10 text-orange-400'
                                                    }`}>
                                                    Beta
                                                </span>
                                            </h3>
                                            <p className={`text-[12px] leading-[1.35] mb-3.5 tracking-[-0.01em] ${isLight ? 'text-slate-500' : 'text-slate-400'
                                                }`}>
                                                Custom instructions and formulas designed for different meeting contexts.
                                            </p>
                                            <div className="flex justify-end gap-1.5 isolate">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setShowModesOnboarding(false);
                                                        setTimeout(() => setShowProfileOnboarding(true), 2000);
                                                    }}
                                                    className={`text-[12px] font-medium px-3.5 py-[6px] rounded-full transition-all active:scale-95 ${isLight
                                                        ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/60'
                                                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/10'
                                                        }`}
                                                >
                                                    Dismiss
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onOpenModes?.();
                                                        setShowModesOnboarding(false);
                                                        setTimeout(() => setShowProfileOnboarding(true), 2000);
                                                    }}
                                                    className={`text-[12px] font-medium px-4 py-[6px] rounded-full transition-all active:scale-95 shadow-sm ${isLight
                                                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                                                        : 'bg-slate-100 text-slate-900 hover:bg-white'
                                                        }`}
                                                >
                                                    Try it out
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <button
                        data-tour-id="settings"
                        onClick={() => {
                            onOpenSettings();
                        }}
                        title="Settings"
                        className={`p-2 text-text-secondary hover:text-text-primary transition-all duration-300 ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`}
                    >
                        <Settings size={18} />
                    </button>
                    {!isMac && <WindowControls />}
                </div>
            </header>

            <div className="relative flex-1 flex flex-col overflow-hidden">
                {!isDetectable && (
                    <div className={`absolute inset-1 border-2 border-dashed rounded-2xl pointer-events-none z-[100] ${isLight ? 'border-black/15' : 'border-white/20'}`} />
                )}
                <AnimatePresence mode="wait">
                    {selectedMeeting ? (
                        <motion.div
                            key="details"
                            className="flex-1 overflow-hidden"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <MeetingDetails
                                meeting={selectedMeeting}
                                onBack={handleBack}
                                onOpenSettings={onOpenSettings}
                            />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="launcher"
                            className="relative flex-1 flex flex-col overflow-hidden"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >

                            {/* Main Area - Fixed Top, Scrollable Bottom */}
                            {/* Top Section is now effectively static due to parent flex col */}

                            {/* TOP SECTION: contextual workspace surface */}
                            <section className="relative px-8 pt-5 pb-6 border-b border-border-subtle shrink-0 overflow-hidden" style={{ backgroundColor: '#08080f' }}>
                                {/* Animated grid lines — breathing pulse */}
                                <style>{`
                                  @keyframes launcherGridPulse {
                                    0%, 100% { opacity: 0.45; transform: scale(1); }
                                    50% { opacity: 0.85; transform: scale(1.02); }
                                  }
                                `}</style>
                                <div
                                    className="absolute inset-[-20px] z-0 pointer-events-none"
                                    style={{
                                        backgroundImage: `
                                          linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px),
                                          linear-gradient(to bottom, rgba(255,255,255,0.12) 1px, transparent 1px)
                                        `,
                                        backgroundSize: '48px 48px',
                                        animation: 'launcherGridPulse 6s ease-in-out infinite',
                                        willChange: 'transform, opacity',
                                    }}
                                />
                                {/* Radial fade */}
                                <div
                                    className="absolute inset-0 z-0 pointer-events-none"
                                    style={{
                                        background: `radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, #08080f 100%)`,
                                    }}
                                />
                                <div className="relative z-10 max-w-5xl mx-auto space-y-4">
                                    <div className="flex items-start justify-between gap-5">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-text-primary">Today</h1>
                                                <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${isCalendarConnected ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/15' : 'text-text-secondary bg-bg-elevated border-border-subtle'}`}>
                                                    <CircleDot size={10} className={isCalendarConnected ? 'fill-emerald-500 text-emerald-500' : ''} />
                                                    {isCalendarConnected ? 'Calendar connected' : 'Calendar off'}
                                                </span>
                                            </div>
                                            <p className="mt-1 text-[13px] text-text-secondary">{todaySummaryLabel}</p>
                                            <div className="mt-3 flex max-w-[620px] flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                                                <span className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-elevated px-2.5 py-1.5">
                                                    <FileText size={12} />
                                                    {todayMeetings.length} today
                                                </span>
                                                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border-subtle bg-bg-elevated px-2.5 py-1.5">
                                                    <Clock3 size={12} />
                                                    <span className="truncate">Next event: {nextEventLabel}</span>
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                            <AnimatePresence>
                                                {ollamaPullStatus !== 'idle' && (
                                                    <motion.div
                                                        initial={{ opacity: 0, scale: 0.96, y: 6 }}
                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                        exit={{ opacity: 0, scale: 0.96, y: 6 }}
                                                        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                                                        className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2"
                                                    >
                                                        {ollamaPullStatus === 'downloading' ? (
                                                            <DownloadCloud size={14} className="text-blue-500" />
                                                        ) : ollamaPullStatus === 'complete' ? (
                                                            <CheckCircle size={14} className="text-emerald-500" />
                                                        ) : (
                                                            <AlertCircle size={14} className="text-red-500" />
                                                        )}
                                                        <div className="min-w-[120px]">
                                                            <span className="block text-[11px] font-medium text-text-secondary">
                                                                {ollamaPullStatus === 'downloading' ? `Setting up AI memory ${ollamaPullPercent}%` : ollamaPullMessage}
                                                            </span>
                                                            {ollamaPullStatus === 'downloading' && (
                                                                <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-bg-item-surface">
                                                                    <div className="h-full rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${ollamaPullPercent}%` }} />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>

                                            {calendarRecommendation && (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsCalendarRecommendationOpen(true)}
                                                    className="inline-flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary hover:bg-bg-item-surface active:scale-[0.98]"
                                                    title="Open suggestion"
                                                >
                                                    <Sparkles size={14} />
                                                    Suggestion
                                                </button>
                                            )}

                                            <button
                                                onClick={handleRefresh}
                                                disabled={isRefreshing}
                                                className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:text-text-primary hover:bg-bg-item-surface active:scale-[0.98] ${isRefreshing || isSyncingCalendar ? 'text-blue-500' : ''}`}
                                                title="Refresh calendar and meetings"
                                            >
                                                <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
                                            </button>

                                            <div className={`flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-2.5 ${!isProPlus ? 'opacity-50 cursor-not-allowed' : ''}`} title={!isProPlus ? 'Pro Plus plan required for Stealth' : ''}>
                                                {!isProPlus ? <Lock size={13} className="text-text-secondary" /> : <Ghost size={13} className="text-text-secondary" />}
                                                <span className="text-[12px] font-medium text-text-secondary">{isDetectable ? 'Detectable' : 'Undetectable'}</span>
                                                {!isProPlus && <span className="text-[9px] font-semibold px-1 py-[1px] rounded bg-violet-500/10 text-violet-400">PRO+</span>}
                                                <button
                                                    type="button"
                                                    aria-label="Toggle detectable mode"
                                                    className={`relative h-4 w-8 rounded-full transition-colors ${!isProPlus ? 'cursor-not-allowed bg-bg-toggle-switch' : !isDetectable ? 'bg-accent-primary' : 'bg-bg-toggle-switch'}`}
                                                    onClick={toggleDetectable}
                                                    disabled={!isProPlus}
                                                >
                                                    <span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${!isDetectable && isProPlus ? 'translate-x-4' : 'translate-x-0'}`} />
                                                </button>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onOpenSettings?.('about');
                                                }}
                                                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-teal-500/20 bg-teal-500/10 px-3.5 text-[12px] font-semibold text-teal-400 transition-all hover:bg-teal-500/15 hover:text-teal-300 active:scale-[0.97]"
                                            >
                                                What's New in 2.7
                                                <ExternalLink size={12} />
                                            </button>

                                            <motion.button
                                                data-tour-id="overlay-control"
                                                onClick={() => {
                                                    if (isMeetingActive) {
                                                        window.electronAPI?.setWindowMode?.('overlay', true);
                                                        analytics.trackCommandExecuted('resume_meeting_from_launcher');
                                                    } else {
                                                        onStartMeeting();
                                                        analytics.trackCommandExecuted('start_teamsync_cta');
                                                    }
                                                }}
                                                whileHover={{ scale: 1.01, filter: 'brightness(1.1)' }}
                                                whileTap={{ scale: 0.99 }}
                                                transition={{ duration: 0.18, ease: 'easeOut' }}
                                                className="group relative flex h-10 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full px-4 font-celeb text-white backdrop-blur-xl"
                                                style={{
                                                    boxShadow: isMeetingActive
                                                        ? 'inset 0 1px 1px rgba(255,255,255,0.6), inset 0 -1px 2px rgba(6,78,59,0.32), 0 2px 10px rgba(20,184,166,0.28), 0 0 0 1px rgba(255,255,255,0.14)'
                                                        : 'inset 0 1px 1px rgba(255,255,255,0.6), inset 0 -1px 2px rgba(8,47,73,0.3), 0 2px 10px rgba(14,165,233,0.32), 0 0 0 1px rgba(255,255,255,0.14)',
                                                    transition: 'box-shadow 0.5s ease-out',
                                                }}
                                            >
                                                <div
                                                    className="absolute inset-0 transition-opacity duration-500 ease-out"
                                                    style={{
                                                        opacity: isMeetingActive ? 0 : 1,
                                                        background: 'linear-gradient(135deg, #082f49 0%, #0ea5e9 52%, #2563eb 100%)',
                                                    }}
                                                />
                                                <div
                                                    className="absolute inset-0 transition-opacity duration-500 ease-out"
                                                    style={{
                                                        opacity: isMeetingActive ? 1 : 0,
                                                        background: 'linear-gradient(135deg, #064e3b 0%, #10b981 52%, #14b8a6 100%)',
                                                    }}
                                                />
                                                <div className="pointer-events-none absolute inset-x-2.5 top-0 z-10 h-[38%] rounded-b-lg bg-gradient-to-b from-white/35 to-transparent opacity-80 blur-[2px]" />
                                                <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-tr from-transparent via-white/5 to-cyan-100/15 opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

                                                <div className="relative z-20 flex items-center gap-2">
                                                    <AnimatePresence mode="wait" initial={false}>
                                                        {isMeetingActive ? (
                                                            <motion.div
                                                                key="meeting"
                                                                initial={{ opacity: 0, y: 6 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                exit={{ opacity: 0, y: -6 }}
                                                                transition={{ duration: 0.22, ease: 'easeOut' }}
                                                                className="flex items-center gap-2"
                                                            >
                                                                <span className="relative flex h-2 w-2 shrink-0">
                                                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
                                                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                                                                </span>
                                                                <span className="text-[17px] font-medium leading-none tracking-normal drop-shadow-[0_1px_1px_rgba(0,0,0,0.14)]">Meeting ongoing</span>
                                                            </motion.div>
                                                        ) : (
                                                            <motion.div
                                                                key="start"
                                                                initial={{ opacity: 0, y: 6 }}
                                                                animate={{ opacity: 1, y: 0 }}
                                                                exit={{ opacity: 0, y: -6 }}
                                                                transition={{ duration: 0.22, ease: 'easeOut' }}
                                                                className="flex h-6 items-center gap-2"
                                                            >
                                                                <img src={icon} alt="Quietly" className="h-[30px] w-[30px] object-contain brightness-0 invert opacity-90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.16)]" />
                                                                <span className="text-[17px] font-medium leading-none tracking-normal drop-shadow-[0_1px_1px_rgba(0,0,0,0.14)]">Start Quietly</span>
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            </motion.button>
                                        </div>
                                    </div>

                                    <AnimatePresence mode="wait">
                                        {isCalendarConnected ? (
                                            <motion.article
                                                key="calendar-connected"
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -6 }}
                                                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                                                className="group relative grid min-h-[246px] grid-cols-[minmax(0,1.8fr)_minmax(250px,0.9fr)] overflow-hidden rounded-xl"
                                                style={{
                                                    background: 'linear-gradient(180deg, #021b33 0%, #082f49 22%, #0c4a6e 50%, #083d5e 76%, #021b33 100%)',
                                                    boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.08), inset 0 -1px 2px rgba(2,27,51,0.85), 0 16px 40px rgba(2,27,51,0.35), 0 0 0 1px rgba(186,230,253,0.06)',
                                                }}
                                            >
                                                {/* Vertical blue curtain streaks */}
                                                <style>{`
                                                  @keyframes curtainShimmer {
                                                    0% { opacity: 0.4; transform: scaleY(1); }
                                                    50% { opacity: 0.7; transform: scaleY(1.02); }
                                                    100% { opacity: 0.4; transform: scaleY(1); }
                                                  }
                                                  @keyframes connectedAuroraMove {
                                                    0% { transform: translateX(-25%) translateY(-8%) rotate(-3deg); }
                                                    33% { transform: translateX(12%) translateY(12%) rotate(2deg); }
                                                    66% { transform: translateX(-10%) translateY(-4%) rotate(-1deg); }
                                                    100% { transform: translateX(-25%) translateY(-8%) rotate(-3deg); }
                                                  }
                                                  @keyframes connectedAuroraMove2 {
                                                    0% { transform: translateX(18%) translateY(8%) rotate(2deg); }
                                                    33% { transform: translateX(-18%) translateY(-12%) rotate(-3deg); }
                                                    66% { transform: translateX(12%) translateY(4%) rotate(1deg); }
                                                    100% { transform: translateX(18%) translateY(8%) rotate(2deg); }
                                                  }
                                                `}</style>
                                                <div
                                                    className="pointer-events-none absolute inset-0 z-[1]"
                                                    style={{
                                                        backgroundImage: `
                                                          repeating-linear-gradient(90deg,
                                                            transparent 0px,
                                                            transparent 8px,
                                                            rgba(14,165,233,0.08) 8px,
                                                            rgba(14,165,233,0.04) 10px,
                                                            transparent 10px,
                                                            transparent 14px,
                                                            rgba(125,211,252,0.06) 14px,
                                                            rgba(125,211,252,0.03) 15px,
                                                            transparent 15px,
                                                            transparent 22px,
                                                            rgba(56,189,248,0.06) 22px,
                                                            rgba(56,189,248,0.03) 24px
                                                          )
                                                        `,
                                                        animation: 'curtainShimmer 6s ease-in-out infinite',
                                                        willChange: 'opacity, transform',
                                                    }}
                                                />
                                                {/* Central blue/cyan glow */}
                                                <div
                                                    className="pointer-events-none absolute inset-0 z-[2]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 70% 80% at 40% 55%, rgba(14,165,233,0.36) 0%, rgba(2,132,199,0.2) 34%, transparent 68%)',
                                                    }}
                                                />
                                                {/* Sky top accent */}
                                                <div
                                                    className="pointer-events-none absolute inset-0 z-[2]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 54% 42% at 55% 10%, rgba(186,230,253,0.18) 0%, rgba(56,189,248,0.1) 42%, transparent 72%)',
                                                    }}
                                                />
                                                {/* Black vignette edges */}
                                                <div
                                                    className="pointer-events-none absolute inset-0 z-[3]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 85% 85% at 40% 50%, transparent 30%, rgba(2,27,51,0.74) 100%)',
                                                    }}
                                                />
                                                {/* Moving aurora blobs */}
                                                <div
                                                    className="pointer-events-none absolute inset-[-40%] z-[2]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 40% 50% at 50% 50%, rgba(14,165,233,0.24) 0%, rgba(2,132,199,0.14) 42%, transparent 72%)',
                                                        animation: 'connectedAuroraMove 9s ease-in-out infinite',
                                                        willChange: 'transform',
                                                    }}
                                                />
                                                <div
                                                    className="pointer-events-none absolute inset-[-40%] z-[2]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 35% 45% at 50% 50%, rgba(125,211,252,0.16) 0%, rgba(2,132,199,0.08) 38%, transparent 68%)',
                                                        animation: 'connectedAuroraMove2 11s ease-in-out infinite',
                                                        willChange: 'transform',
                                                    }}
                                                />
                                                {/* Specular highlight */}
                                                <div className="pointer-events-none absolute inset-x-4 top-0 z-10 h-[25%] rounded-b-xl bg-gradient-to-b from-white/8 to-transparent opacity-50 blur-[3px]" />
                                                <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-tr from-transparent via-white/[0.02] to-sky-300/5 opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

                                                <div className="relative z-20 min-w-0 p-5">
                                                    <div className="flex items-center justify-between gap-4">
                                                        <div className="min-w-0">
                                                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Next meeting</p>
                                                            <h2 className="mt-2 truncate text-[24px] font-semibold leading-tight tracking-[-0.025em] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
                                                                {nextCalendarEvent ? nextCalendarEvent.summary : 'No upcoming meetings'}
                                                            </h2>
                                                        </div>
                                                        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium ${nextCalendarEvent ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/20' : 'text-slate-400 bg-white/5 border-white/10'}`}>
                                                            <Calendar size={12} />
                                                            {nextCalendarEvent ? 'Ready' : 'Clear'}
                                                        </span>
                                                    </div>

                                                    <div className="mt-4 grid grid-cols-3 gap-3">
                                                        <div className="rounded-lg border border-white/8 bg-white/[0.04] p-3 backdrop-blur-sm">
                                                            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-slate-400">
                                                                <Clock3 size={12} />
                                                                Start time
                                                            </div>
                                                            <p className="truncate text-[13px] font-semibold text-white/90">{nextEventWindowLabel ?? 'No time scheduled'}</p>
                                                        </div>
                                                        <div className="rounded-lg border border-white/8 bg-white/[0.04] p-3 backdrop-blur-sm">
                                                            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-slate-400">
                                                                <Users size={12} />
                                                                Participants
                                                            </div>
                                                            <p className="truncate text-[13px] font-semibold text-white/90">{nextCalendarEvent ? getParticipantLabel(nextEventParticipants) : 'No event selected'}</p>
                                                        </div>
                                                        <div className="rounded-lg border border-white/8 bg-white/[0.04] p-3 backdrop-blur-sm">
                                                            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-slate-400">
                                                                <Video size={12} />
                                                                Source
                                                            </div>
                                                            <p className="truncate text-[13px] font-semibold text-white/90">{nextCalendarEvent ? nextCalendarEvent.platform.toUpperCase() : 'Calendar'}</p>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 grid grid-cols-[0.85fr_1.15fr] gap-4">
                                                        <div>
                                                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Likely topics</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {(likelyTopics.length > 0 ? likelyTopics : ['Agenda review']).map((topic) => (
                                                                    <span key={topic} className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-slate-300">
                                                                        {topic}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <div>
                                                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Preparation notes</p>
                                                            <div className="space-y-1.5">
                                                                {preparationNotes.map((note) => (
                                                                    <div key={note} className="flex items-start gap-2 text-[12px] leading-[1.35] text-slate-300">
                                                                        <CheckCircle2 size={13} className="mt-[1px] shrink-0 text-emerald-400" />
                                                                        <span className="line-clamp-1">{note}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <aside className="relative z-20 flex min-w-0 flex-col justify-between border-l border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
                                                    <div className="space-y-3">
                                                        <div>
                                                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Calendar window</p>
                                                            <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-white">{upcomingCalendarEvents.length}</p>
                                                            <p className="text-[12px] text-slate-400">upcoming {upcomingCalendarEvents.length === 1 ? 'event' : 'events'}</p>
                                                        </div>
                                                        <div className="rounded-lg border border-white/8 bg-white/[0.06] p-3">
                                                            <p className="text-[11px] font-medium text-slate-400">Recommendation</p>
                                                            <p className="mt-1 truncate text-[13px] font-semibold text-white/90">
                                                                {calendarRecommendation ? calendarRecommendation.recommendedModeLabel : 'General meeting mode'}
                                                            </p>
                                                            <p className="mt-1 text-[12px] text-slate-400">
                                                                {calendarRecommendation ? getRecommendationConfidenceLabel(calendarRecommendation.confidence) : 'No mode change suggested'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                                        {nextCalendarEvent ? (
                                                            <button
                                                                type="button"
                                                                onClick={handlePrepareMeeting}
                                                                className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-white px-3 text-[13px] font-semibold text-[#0f172a] transition-opacity hover:opacity-90 active:scale-[0.98]"
                                                            >
                                                                <Sparkles size={14} />
                                                                Prepare meeting
                                                            </button>
                                                        ) : (
                                                            <MagneticCalendarRefreshButton
                                                                onClick={handlePrepareMeeting}
                                                                disabled={isRefreshing || isSyncingCalendar}
                                                                isRefreshing={isRefreshing || isSyncingCalendar}
                                                            />
                                                        )}
                                                        {nextCalendarEvent?.meetingLink && (
                                                            <button
                                                                type="button"
                                                                onClick={() => void window.electronAPI?.openExternal?.(nextCalendarEvent.meetingLink!)}
                                                                className="inline-flex h-9 items-center justify-center rounded-md border border-white/15 bg-white/[0.08] px-3 text-[12px] font-medium text-slate-300 transition-colors hover:bg-white/[0.12] hover:text-white active:scale-[0.98]"
                                                            >
                                                                Join
                                                            </button>
                                                        )}
                                                    </div>
                                                </aside>
                                            </motion.article>
                                        ) : (
                                            <motion.article
                                                key="calendar-onboarding"
                                                initial={{ opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -6 }}
                                                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                                                className="group relative grid min-h-[228px] grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] overflow-hidden rounded-xl"
                                                style={{
                                                    background: 'linear-gradient(180deg, #020210 0%, #0a0a2e 15%, #0c1445 40%, #111b5e 60%, #0a0a2e 85%, #020210 100%)',
                                                    boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.08), inset 0 -1px 2px rgba(2,2,16,0.8), 0 16px 40px rgba(10,10,46,0.3), 0 0 0 1px rgba(255,255,255,0.04)',
                                                }}
                                            >
                                                {/* Vertical blue curtain streaks */}
                                                <style>{`
                                                  @keyframes curtainShimmer2 {
                                                    0% { opacity: 0.45; transform: scaleY(1); }
                                                    50% { opacity: 0.75; transform: scaleY(1.02); }
                                                    100% { opacity: 0.45; transform: scaleY(1); }
                                                  }
                                                  @keyframes calendarAuroraMove {
                                                    0% { transform: translateX(-30%) translateY(-10%) rotate(-5deg); }
                                                    33% { transform: translateX(10%) translateY(15%) rotate(3deg); }
                                                    66% { transform: translateX(-15%) translateY(-5%) rotate(-2deg); }
                                                    100% { transform: translateX(-30%) translateY(-10%) rotate(-5deg); }
                                                  }
                                                  @keyframes calendarAuroraMove2 {
                                                    0% { transform: translateX(20%) translateY(10%) rotate(3deg); }
                                                    33% { transform: translateX(-20%) translateY(-15%) rotate(-4deg); }
                                                    66% { transform: translateX(15%) translateY(5%) rotate(2deg); }
                                                    100% { transform: translateX(20%) translateY(10%) rotate(3deg); }
                                                  }
                                                `}</style>
                                                <div
                                                    className="pointer-events-none absolute inset-0 z-[1]"
                                                    style={{
                                                        backgroundImage: `
                                                          repeating-linear-gradient(90deg,
                                                            transparent 0px,
                                                            transparent 8px,
                                                            rgba(59,130,246,0.06) 8px,
                                                            rgba(59,130,246,0.03) 10px,
                                                            transparent 10px,
                                                            transparent 14px,
                                                            rgba(99,102,241,0.05) 14px,
                                                            rgba(99,102,241,0.02) 15px,
                                                            transparent 15px,
                                                            transparent 22px,
                                                            rgba(59,130,246,0.04) 22px,
                                                            rgba(59,130,246,0.02) 24px
                                                          )
                                                        `,
                                                        animation: 'curtainShimmer2 5s ease-in-out infinite',
                                                        willChange: 'opacity, transform',
                                                    }}
                                                />
                                                {/* Central purple glow */}
                                                <div
                                                    className="pointer-events-none absolute inset-0 z-[2]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 75% 85% at 45% 55%, rgba(109,40,217,0.35) 0%, rgba(79,70,229,0.18) 30%, transparent 65%)',
                                                    }}
                                                />
                                                {/* Teal/green top accent */}
                                                <div
                                                    className="pointer-events-none absolute inset-0 z-[2]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 50% 40% at 55% 8%, rgba(52,211,153,0.15) 0%, rgba(56,189,248,0.08) 40%, transparent 70%)',
                                                    }}
                                                />
                                                {/* Black vignette edges */}
                                                <div
                                                    className="pointer-events-none absolute inset-0 z-[3]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 85% 85% at 45% 50%, transparent 30%, rgba(2,2,16,0.7) 100%)',
                                                    }}
                                                />
                                                {/* Moving aurora blobs */}
                                                <div
                                                    className="pointer-events-none absolute inset-[-40%] z-[2]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 40% 50% at 50% 50%, rgba(109,40,217,0.22) 0%, rgba(139,92,246,0.1) 40%, transparent 70%)',
                                                        animation: 'calendarAuroraMove 8s ease-in-out infinite',
                                                        willChange: 'transform',
                                                    }}
                                                />
                                                <div
                                                    className="pointer-events-none absolute inset-[-40%] z-[2]"
                                                    style={{
                                                        background: 'radial-gradient(ellipse 35% 45% at 50% 50%, rgba(52,211,153,0.1) 0%, rgba(56,189,248,0.06) 35%, transparent 65%)',
                                                        animation: 'calendarAuroraMove2 10s ease-in-out infinite',
                                                        willChange: 'transform',
                                                    }}
                                                />
                                                {/* Specular highlight */}
                                                <div className="pointer-events-none absolute inset-x-4 top-0 z-10 h-[25%] rounded-b-xl bg-gradient-to-b from-white/8 to-transparent opacity-50 blur-[3px]" />
                                                <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-tr from-transparent via-white/[0.02] to-indigo-300/5 opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

                                                <div className="relative z-20 p-5">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white/80 backdrop-blur-sm">
                                                            <PlugZap size={18} />
                                                        </div>
                                                        <div>
                                                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-purple-200/70">Calendar onboarding</p>
                                                            <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.025em] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)]">Connect calendar context</h2>
                                                        </div>
                                                    </div>
                                                    <p className="mt-4 max-w-[62ch] text-[13px] leading-6 text-purple-100/70">
                                                        Quietly can prepare from your next event before the meeting starts and keep saved notes tied to the calendar title.
                                                    </p>
                                                </div>

                                                <aside className="relative z-20 flex flex-col justify-between border-l border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm">
                                                    <div>
                                                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-purple-200/70">Benefits</p>
                                                        <div className="mt-3 space-y-2">
                                                            {[
                                                                'See the next meeting before starting capture',
                                                                'Surface likely topics and prep notes',
                                                                'Preserve calendar context in saved recaps',
                                                            ].map((benefit) => (
                                                                <div key={benefit} className="flex items-start gap-2 text-[12px] leading-[1.35] text-purple-100/80">
                                                                    <CheckCircle2 size={13} className="mt-[1px] shrink-0 text-emerald-400" />
                                                                    <span>{benefit}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="mt-4">
                                                        <ConnectCalendarButton
                                                            variant="magnetic"
                                                            onConnect={() => setIsCalendarConnected(true)}
                                                        />
                                                    </div>
                                                </aside>
                                            </motion.article>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </section>

                            {/* BOTTOM SECTION: Black Background (Scrollable content) */}
                            <main ref={launcherScrollRef} className="flex-1 overflow-y-auto custom-scrollbar bg-bg-primary">
                                <section className="px-8 py-8 min-h-full">
                                    <div className="max-w-4xl mx-auto space-y-8">

                                        {/* Iterating Date Groups */}
                                        {sortedGroups.map((label) => (
                                            <section key={label}>
                                                <h3 className="text-[13px] font-medium text-text-secondary mb-3 pl-1">{label}</h3>
                                                <div className="space-y-2">
                                                    {groupedMeetings[label].map((m) => {
                                                        const typeMeta = getMeetingTypeMeta(m);
                                                        const statusMeta = getMeetingStatusMeta(m);
                                                        const TypeIcon = typeMeta.Icon;

                                                        return (
                                                            <motion.div
                                                                key={m.id}
                                                                data-meeting-id={m.id}
                                                                layoutId={`meeting-${m.id}`}
                                                                className={`group relative flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${selectedMeetingId === m.id ? 'border-border-muted bg-bg-elevated' : 'border-transparent bg-transparent hover:border-border-subtle hover:bg-bg-elevated'}`}
                                                                onClick={() => handleOpenMeeting(m)}
                                                            >
                                                                <div
                                                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${typeMeta.tone}`}
                                                                    title={typeMeta.label}
                                                                >
                                                                    <TypeIcon size={16} className={m.title === 'Processing...' ? 'animate-spin' : ''} />
                                                                </div>

                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex min-w-0 items-center gap-2">
                                                                        <div className={`truncate text-[14px] font-semibold ${m.title === 'Processing...' ? 'text-blue-500 italic' : 'text-text-primary'}`}>
                                                                            {m.title}
                                                                        </div>
                                                                        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium ${statusMeta.className}`}>
                                                                            {statusMeta.label}
                                                                        </span>
                                                                    </div>
                                                                    <p className="mt-1 truncate text-[12px] leading-5 text-text-secondary">
                                                                        {getMeetingSummaryLine(m)}
                                                                    </p>
                                                                </div>

                                                                {/* Time & Duration Section */}
                                                                <div className="flex shrink-0 items-center gap-3 pr-8">
                                                                    {m.title === 'Processing...' ? (
                                                                        <div className="flex items-center gap-2">
                                                                            <RefreshCw size={12} className="animate-spin text-blue-500" />
                                                                            <span className="text-xs text-blue-500 font-medium">Finalizing...</span>
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            <span className="relative z-10 rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-center text-[10px] font-medium tracking-wide text-text-secondary tabular-nums">
                                                                                {formatDurationPill(m.duration)}
                                                                            </span>

                                                                            {/* Time Text (Should fade out on hover) */}
                                                                            <span className="min-w-[60px] text-right text-[12px] font-medium text-text-secondary tabular-nums">
                                                                                {formatTime(m.date)}
                                                                            </span>
                                                                        </>
                                                                    )}
                                                                </div>

                                                                {/* Context Menu Trigger (Slides in on hover) */}
                                                                <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 translate-x-4 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0">
                                                                    <button
                                                                        className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            setActiveMenuId(activeMenuId === m.id ? null : m.id);
                                                                        }}
                                                                    >
                                                                        <MoreHorizontal size={16} />
                                                                    </button>
                                                                </div>

                                                                {/* Dropdown Menu */}
                                                                <AnimatePresence>
                                                                    {activeMenuId === m.id && (
                                                                        <motion.div
                                                                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                                                            exit={{ opacity: 0, scale: 0.95, y: 5 }}
                                                                            transition={{ duration: 0.1 }}
                                                                            layout
                                                                            className={`absolute right-0 top-full mt-1 backdrop-blur-xl rounded-lg shadow-2xl z-50 overflow-hidden border ${isLight ? 'bg-bg-elevated border-border-muted shadow-[0_8px_24px_rgba(0,0,0,0.12)]' : 'bg-[#1E1E1E]/80 border-white/10'}`}
                                                                            style={{ width: confirmingDeleteId === m.id ? 200 : 140 }}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onMouseEnter={() => setMenuEntered(true)}
                                                                            onMouseLeave={() => {
                                                                                if (menuEntered && confirmingDeleteId !== m.id) setActiveMenuId(null);
                                                                            }}
                                                                        >
                                                                            <div className="p-1 flex flex-col gap-0.5">
                                                                                <AnimatePresence mode="wait" initial={false}>
                                                                                    {confirmingDeleteId === m.id ? (
                                                                                        <motion.div
                                                                                            key="confirm"
                                                                                            initial={{ opacity: 0 }}
                                                                                            animate={{ opacity: 1 }}
                                                                                            exit={{ opacity: 0 }}
                                                                                            transition={{ duration: 0.12 }}
                                                                                            className="px-3 py-2"
                                                                                        >
                                                                                            <p className={`text-[12px] font-medium text-center mb-2 ${isLight ? 'text-text-primary' : 'text-white/90'}`}>Delete this meeting?</p>
                                                                                            <div className="flex justify-between gap-2">
                                                                                                <button
                                                                                                    className={`flex-1 text-[12px] px-2 py-1.5 rounded-md transition-colors ${isLight ? 'text-text-secondary hover:text-text-primary hover:bg-bg-item-surface' : 'text-white/50 hover:text-white/80 hover:bg-white/10'}`}
                                                                                                    onClick={() => {
                                                                                                        setConfirmingDeleteId(null);
                                                                                                        setActiveMenuId(null);
                                                                                                    }}
                                                                                                >
                                                                                                    Cancel
                                                                                                </button>
                                                                                                <button
                                                                                                    className="flex-1 text-[12px] px-2 py-1.5 rounded-md font-semibold text-red-400 bg-red-500/15 hover:bg-red-500/25 transition-colors"
                                                                                                    onClick={async () => {
                                                                                                        if (window.electronAPI && window.electronAPI.deleteMeeting) {
                                                                                                            const success = await window.electronAPI.deleteMeeting(m.id);
                                                                                                            if (success) {
                                                                                                                setMeetings(prev => prev.filter(meeting => meeting.id !== m.id));
                                                                                                            }
                                                                                                        }
                                                                                                        setConfirmingDeleteId(null);
                                                                                                        setActiveMenuId(null);
                                                                                                    }}
                                                                                                >
                                                                                                    Delete
                                                                                                </button>
                                                                                            </div>
                                                                                        </motion.div>
                                                                                    ) : (
                                                                                        <motion.div
                                                                                            key="menu"
                                                                                            initial={{ opacity: 0 }}
                                                                                            animate={{ opacity: 1 }}
                                                                                            exit={{ opacity: 0 }}
                                                                                            transition={{ duration: 0.12 }}
                                                                                        >
                                                                                            <button
                                                                                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary rounded-lg transition-colors text-left ${isLight ? 'hover:bg-bg-item-surface' : 'hover:bg-white/10'}`}
                                                                                                onClick={async () => {
                                                                                                    setActiveMenuId(null);
                                                                                                    analytics.trackPdfExported();
                                                                                                    if (window.electronAPI && window.electronAPI.getMeetingDetails) {
                                                                                                        try {
                                                                                                            const fullMeeting = await window.electronAPI.getMeetingDetails(m.id);
                                                                                                            if (fullMeeting) {
                                                                                                                generateMeetingPDF(fullMeeting);
                                                                                                            } else {
                                                                                                                generateMeetingPDF(m);
                                                                                                            }
                                                                                                        } catch (e) {
                                                                                                            console.error("Failed to fetch details for PDF", e);
                                                                                                            generateMeetingPDF(m);
                                                                                                        }
                                                                                                    } else {
                                                                                                        generateMeetingPDF(m);
                                                                                                    }
                                                                                                }}
                                                                                            >
                                                                                                <Download size={13} />
                                                                                                Export PDF
                                                                                            </button>
                                                                                            <button
                                                                                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary rounded-lg transition-colors text-left ${isLight ? 'hover:bg-bg-item-surface' : 'hover:bg-white/10'}`}
                                                                                                onClick={async () => {
                                                                                                    setActiveMenuId(null);
                                                                                                    if (window.electronAPI && window.electronAPI.getMeetingDetails) {
                                                                                                        try {
                                                                                                            const fullMeeting = await window.electronAPI.getMeetingDetails(m.id);
                                                                                                            generateMeetingMarkdown(fullMeeting || m);
                                                                                                        } catch { generateMeetingMarkdown(m); }
                                                                                                    } else { generateMeetingMarkdown(m); }
                                                                                                }}
                                                                                            >
                                                                                                <FileText size={13} />
                                                                                                Export MD
                                                                                            </button>
                                                                                            <button
                                                                                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary rounded-lg transition-colors text-left ${isLight ? 'hover:bg-bg-item-surface' : 'hover:bg-white/10'}`}
                                                                                                onClick={async () => {
                                                                                                    setActiveMenuId(null);
                                                                                                    if (window.electronAPI && window.electronAPI.getMeetingDetails) {
                                                                                                        try {
                                                                                                            const fullMeeting = await window.electronAPI.getMeetingDetails(m.id);
                                                                                                            generateMeetingHTML(fullMeeting || m);
                                                                                                        } catch { generateMeetingHTML(m); }
                                                                                                    } else { generateMeetingHTML(m); }
                                                                                                }}
                                                                                            >
                                                                                                <Code2 size={13} />
                                                                                                Export HTML
                                                                                            </button>
                                                                                            <div className={`my-0.5 h-px ${isLight ? 'bg-border-subtle' : 'bg-white/8'}`} />
                                                                                            <button
                                                                                                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-lg transition-colors text-left"
                                                                                                onClick={() => setConfirmingDeleteId(m.id)}
                                                                                            >
                                                                                                <Trash2 size={13} />
                                                                                                Delete
                                                                                            </button>
                                                                                        </motion.div>
                                                                                    )}
                                                                                </AnimatePresence>
                                                                            </div>
                                                                        </motion.div>
                                                                    )}
                                                                </AnimatePresence>
                                                            </motion.div>
                                                        );
                                                    })}
                                                </div>
                                            </section>
                                        ))}

                                        {meetings.length === 0 && (
                                            <div className="p-4 text-text-tertiary text-sm">No recent meetings.</div>
                                        )}

                                    </div>
                                </section>
                            </main>

                            <AnimatePresence>
                                {calendarRecommendation && isCalendarRecommendationOpen && (
                                    <motion.div
                                        key="calendar-recommendation-popup"
                                        initial={false}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 1 }}
                                        transition={{ duration: 0 }}
                                        className="pointer-events-none absolute inset-0 z-30"
                                    >
                                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.06),transparent_18%),linear-gradient(180deg,rgba(15,23,42,0.16),rgba(15,23,42,0.34))] backdrop-blur-[20px]" />
                                        <div className="absolute inset-0 flex items-center justify-center px-8 py-16">
                                            <div className="mx-auto flex w-full max-w-[980px] justify-center">
                                                <motion.div
                                                    initial={{ opacity: 0, y: 8, scale: 0.99 }}
                                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                                    exit={{ opacity: 0, y: 8, scale: 0.99 }}
                                                    transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1], delay: 0.03 }}
                                                    className="pointer-events-auto w-full max-w-[960px] will-change-transform"
                                                >
                                                    <CalendarModeRecommendationCard
                                                        recommendation={calendarRecommendation}
                                                        isLight={isLight}
                                                        applying={isApplyingCalendarMode}
                                                        error={calendarRecommendationError}
                                                        showCloseButton
                                                        animateEntrance={false}
                                                        onClose={() => setIsCalendarRecommendationOpen(false)}
                                                        onApply={handleApplyCalendarRecommendation}
                                                        onDismiss={handleDismissCalendarRecommendation}
                                                    />
                                                </motion.div>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>



            {/* Notification Toast - Liquid Glass (macOS 26 Tahoe Concept) */}
            <AnimatePresence>
                {refreshNotification && (
                    <motion.div
                        initial={{ x: 300, opacity: 0, scale: 0.9 }}
                        animate={{ x: 0, opacity: 1, scale: 1 }}
                        exit={{ x: 300, opacity: 0, scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 350, damping: 30, mass: 1 }}
                        className={`fixed bottom-10 right-10 z-[2000] flex items-center gap-4 pl-4 pr-6 py-3.5 rounded-[18px] backdrop-blur-xl saturate-[180%] ring-1 ring-black/10 ${isLight ? 'bg-bg-elevated/90 border border-border-muted shadow-[0_8px_32px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.9)]' : 'bg-[#2A2A2E]/40 border border-white/10 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(255,255,255,0.05)]'}`}
                    >
                        {/* Liquid Icon Orb */}
                        <div className={`relative flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-b shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] border border-white/5 ${refreshNotification.tone === 'warning' ? 'from-amber-400/20 to-amber-600/20' : 'from-blue-400/20 to-blue-600/20'}`}>
                            <div className={`absolute inset-0 rounded-full blur-md ${refreshNotification.tone === 'warning' ? 'bg-amber-500/20' : 'bg-blue-500/20'}`} />
                            {refreshNotification.tone === 'warning' ? (
                                <AlertCircle size={15} className="text-amber-300 drop-shadow-[0_0_5px_rgba(245,158,11,0.6)]" />
                            ) : (
                                <RefreshCw size={15} className="text-blue-300 animate-[spin_2s_linear_infinite] drop-shadow-[0_0_5px_rgba(59,130,246,0.6)]" />
                            )}
                        </div>

                        {/* Text Content */}
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[14px] font-semibold text-text-primary leading-none tracking-tight">{refreshNotification.title}</span>
                            <span className="text-[11px] text-text-tertiary font-medium leading-none tracking-wide">{refreshNotification.message}</span>
                        </div>

                        {/* Specular Highlight Overlay */}
                        <div className="absolute inset-0 rounded-[18px] bg-gradient-to-tr from-white/5 via-transparent to-transparent pointer-events-none" />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Global Chat Overlay */}
            <GlobalChatOverlay
                isOpen={isGlobalChatOpen}
                onClose={() => {
                    setIsGlobalChatOpen(false);
                    setSubmittedGlobalQuery('');
                }}
                initialQuery={submittedGlobalQuery}
            />
        </div >
    );
};

export default Launcher;
