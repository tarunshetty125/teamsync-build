import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Check, ChevronDown, Sparkles, WandSparkles, X } from 'lucide-react';

type CalendarModeRecommendation = {
    eventId: string;
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    recommendedMode: 'technical-interview' | 'sales' | 'lecture' | 'team-meet' | 'recruiting' | 'looking-for-work';
    recommendedModeLabel: string;
    confidence: number;
    matchedSignals: string[];
    summary: string;
    suggestedReferences: string[];
};

type ModeOptionId =
    | 'technical-interview'
    | 'sales'
    | 'lecture'
    | 'team-meet'
    | 'recruiting'
    | 'looking-for-work'
    | 'general';

interface CalendarModeRecommendationCardProps {
    recommendation: CalendarModeRecommendation;
    isLight: boolean;
    applying?: boolean;
    error?: string | null;
    showCloseButton?: boolean;
    onClose?: () => void;
    onApply: (modeId: ModeOptionId) => void;
    onDismiss: () => void;
}

const MODE_OPTIONS: Array<{ id: ModeOptionId; label: string }> = [
    { id: 'technical-interview', label: 'Technical Interview' },
    { id: 'sales', label: 'Sales' },
    { id: 'lecture', label: 'Lecture' },
    { id: 'team-meet', label: 'Team Meet' },
    { id: 'recruiting', label: 'Recruiting' },
    { id: 'looking-for-work', label: 'Looking for Work' },
    { id: 'general', label: 'General' },
];

function getDateLabel(startTime: string): string {
    const start = new Date(startTime);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();

    if (sameDay(start, today)) return 'Today';
    if (sameDay(start, tomorrow)) return 'Tomorrow';

    return start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getTimeLabel(startTime: string): string {
    return new Date(startTime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function getConfidenceLabel(confidence: number): string {
    if (confidence >= 90) return 'Very High Match';
    if (confidence >= 80) return 'High Match';
    if (confidence >= 60) return 'Medium Match';
    return 'Low Match';
}

function buildWhyLine(recommendation: CalendarModeRecommendation): string {
    const [first, second, third] = recommendation.matchedSignals.map((signal) => signal.toLowerCase());

    switch (recommendation.recommendedMode) {
        case 'technical-interview':
            return second
                ? `${first} + ${second}${third ? ` + ${third}` : ''} detected.`
                : 'Interview-related keywords detected.';
        case 'sales':
            return second
                ? `${first} + ${second} signals detected.`
                : 'Sales-related signals detected.';
        case 'lecture':
            return second
                ? `${first} + ${second} course-related keywords detected.`
                : 'Lecture-related keywords detected.';
        case 'team-meet':
            return second
                ? `${first} + ${second} team meeting signals detected.`
                : 'Team meeting signals detected.';
        case 'recruiting':
            return second
                ? `${first} + ${second} hiring signals detected.`
                : 'Recruiting-related keywords detected.';
        case 'looking-for-work':
            return second
                ? `${first} + ${second} job prep signals detected.`
                : 'Career-prep signals detected.';
        default:
            return 'Relevant event signals detected.';
    }
}

/* ── Premium glass pane (layered glass compartment) ──────────────
   ring-1 refraction border + inset top/bottom lighting + ambient shadow */
const pane = (isLight: boolean) =>
    isLight
        ? 'rounded-[14px] bg-white/30 ring-1 ring-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),inset_0_-0.5px_0_rgba(0,0,0,0.03),0_0.5px_2px_rgba(15,23,42,0.05)] backdrop-blur-[20px] transition-[background-color,box-shadow] duration-200 hover:bg-white/38'
        : 'rounded-[14px] bg-white/[0.045] ring-1 ring-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.09),inset_0_-0.5px_0_rgba(0,0,0,0.15),0_0.5px_2px_rgba(0,0,0,0.14)] backdrop-blur-[20px] transition-[background-color,box-shadow] duration-200 hover:bg-white/[0.07]';

/* ── Section label style ─────────────────────────────────────────
   Refined uppercase with wider tracking + calibrated opacity     */
const sectionLabel = (isLight: boolean) =>
    `text-[9px] font-semibold uppercase tracking-[0.16em] ${isLight ? 'text-slate-400/80' : 'text-white/28'}`;

const CalendarModeRecommendationCard: React.FC<CalendarModeRecommendationCardProps> = ({
    recommendation,
    isLight,
    applying = false,
    error = null,
    showCloseButton = false,
    onClose,
    onApply,
    onDismiss,
}) => {
    const [selectedModeId, setSelectedModeId] = useState<ModeOptionId>(recommendation.recommendedMode);

    useEffect(() => {
        setSelectedModeId(recommendation.recommendedMode);
    }, [recommendation.eventId, recommendation.recommendedMode]);

    const confidenceLabel = useMemo(
        () => getConfidenceLabel(recommendation.confidence),
        [recommendation.confidence]
    );

    const whyLine = useMemo(
        () => buildWhyLine(recommendation),
        [recommendation]
    );

    /* ── Confidence colour tokens (pill + bar) ─────────────────── */
    const confidenceColor = useMemo(() => {
        if (recommendation.confidence >= 80)
            return {
                pill: isLight
                    ? 'bg-emerald-500/[0.08] text-emerald-700 shadow-[inset_0_0.5px_0_rgba(16,185,129,0.15)]'
                    : 'bg-emerald-400/[0.10] text-emerald-300 shadow-[inset_0_0.5px_0_rgba(16,185,129,0.12)]',
                bar: 'bg-emerald-400/70',
            };
        if (recommendation.confidence >= 60)
            return {
                pill: isLight
                    ? 'bg-amber-500/[0.08] text-amber-700 shadow-[inset_0_0.5px_0_rgba(245,158,11,0.15)]'
                    : 'bg-amber-400/[0.10] text-amber-300 shadow-[inset_0_0.5px_0_rgba(245,158,11,0.12)]',
                bar: 'bg-amber-400/70',
            };
        return {
            pill: isLight
                ? 'bg-rose-500/[0.08] text-rose-700 shadow-[inset_0_0.5px_0_rgba(244,63,94,0.15)]'
                : 'bg-rose-400/[0.10] text-rose-300 shadow-[inset_0_0.5px_0_rgba(244,63,94,0.12)]',
            bar: 'bg-rose-400/70',
        };
    }, [recommendation.confidence, isLight]);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.97, filter: 'blur(6px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
            className={`relative overflow-hidden rounded-[22px] ${
                isLight
                    ? 'bg-white/50 shadow-[0_20px_60px_rgba(15,23,42,0.14),0_0_0_0.5px_rgba(255,255,255,0.65),inset_0_1.5px_0_rgba(255,255,255,0.9)]'
                    : 'bg-[rgba(24,26,32,0.65)] shadow-[0_20px_60px_rgba(2,6,23,0.50),0_0_0_0.5px_rgba(255,255,255,0.07),inset_0_1.5px_0_rgba(255,255,255,0.09)]'
            }`}
            style={{ backdropFilter: 'blur(28px) saturate(190%)' }}
        >
            {/* ── Ambient glass layers ────────────────────────────── */}
            <div className="absolute inset-0 pointer-events-none">
                {/* Radial colour wash — organic ellipse shapes */}
                <div className={`absolute inset-0 ${
                    isLight
                        ? 'bg-[radial-gradient(ellipse_at_10%_8%,rgba(255,255,255,0.50),transparent_36%),radial-gradient(ellipse_at_88%_6%,rgba(186,216,255,0.16),transparent_28%)]'
                        : 'bg-[radial-gradient(ellipse_at_10%_8%,rgba(255,255,255,0.08),transparent_34%),radial-gradient(ellipse_at_88%_6%,rgba(140,180,255,0.06),transparent_26%)]'
                }`} />
                {/* Diagonal refraction — subtle prismatic sweep */}
                <div className={`absolute inset-0 ${
                    isLight
                        ? 'bg-[linear-gradient(118deg,rgba(15,23,42,0.03),transparent_42%,rgba(125,211,252,0.06))]'
                        : 'bg-[linear-gradient(118deg,rgba(255,255,255,0.04),transparent_42%,rgba(125,211,252,0.05))]'
                }`} />
                {/* Top highlight band — faint inner edge glow */}
                <div className={`absolute inset-x-0 top-0 h-12 ${
                    isLight
                        ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.70),rgba(255,255,255,0))]'
                        : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0))]'
                }`} />
                {/* Bottom ambient edge fade */}
                <div className={`absolute inset-x-0 bottom-0 h-16 ${
                    isLight
                        ? 'bg-[linear-gradient(0deg,rgba(241,245,249,0.14),transparent)]'
                        : 'bg-[linear-gradient(0deg,rgba(0,0,0,0.12),transparent)]'
                }`} />
            </div>

            {/* ── Content ─────────────────────────────────────────── */}
            <div className="relative z-10 flex flex-col px-5 pt-4 pb-3.5">

                {/* ── Header row ──────────────────────────────────── */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        {/* Eyebrow badge — refined glass chip */}
                        <div className={`mb-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[8.5px] font-semibold uppercase tracking-[0.16em] ${
                            isLight
                                ? 'bg-white/45 text-slate-500/80 ring-1 ring-white/40 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.8)]'
                                : 'bg-white/[0.05] text-white/40 ring-1 ring-white/[0.06] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.07)]'
                        }`}>
                            <Sparkles className="h-2.5 w-2.5 opacity-70" />
                            Upcoming Event
                        </div>
                        {/* Hero title — bold, tight tracking, strong presence */}
                        <h3 className={`text-[22px] font-bold leading-[1.04] tracking-[-0.04em] ${
                            isLight ? 'text-slate-950' : 'text-white'
                        }`}>
                            {recommendation.title}
                        </h3>
                        {/* Date/time — quiet secondary info */}
                        <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${
                            isLight ? 'text-slate-500/80' : 'text-white/40'
                        }`}>
                            <CalendarClock className="h-3 w-3 opacity-70" />
                            <span className="font-medium tracking-[-0.01em]">
                                {getDateLabel(recommendation.startTime)} · {getTimeLabel(recommendation.startTime)}
                            </span>
                        </div>
                    </div>
                    {showCloseButton && (
                        <button
                            type="button"
                            onClick={onClose ?? onDismiss}
                            aria-label="Close recommendation"
                            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                                isLight
                                    ? 'bg-white/30 text-slate-400 ring-1 ring-white/40 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.7)] hover:bg-white/50 hover:text-slate-700'
                                    : 'bg-white/[0.05] text-white/30 ring-1 ring-white/[0.06] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)] hover:bg-white/[0.09] hover:text-white/60'
                            }`}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </div>

                {/* ── Summary + Recommended Mode ──────────────────── */}
                <div className="mt-3 grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    {/* Summary pane */}
                    <div className={`${pane(isLight)} px-3.5 py-2.5`}>
                        <div className={sectionLabel(isLight)}>Summary</div>
                        <p className={`mt-1 text-[11.5px] leading-[1.6] tracking-[-0.006em] ${
                            isLight ? 'text-slate-700' : 'text-white/65'
                        }`}>
                            {recommendation.summary}
                        </p>
                    </div>

                    {/* Recommended Mode + Confidence pane */}
                    <div className={`${pane(isLight)} px-3.5 py-2.5`}>
                        <div className={sectionLabel(isLight)}>Recommended Mode</div>
                        <div className={`mt-1 flex items-center gap-2 text-[13px] font-semibold tracking-[-0.01em] ${
                            isLight ? 'text-slate-950' : 'text-white'
                        }`}>
                            <WandSparkles className={`h-3.5 w-3.5 ${isLight ? 'text-sky-600' : 'text-sky-300'}`} />
                            {recommendation.recommendedModeLabel}
                        </div>

                        {/* ── Upgraded Confidence indicator ───────── */}
                        <div className="mt-2.5">
                            <div className={sectionLabel(isLight)}>Confidence</div>
                            <div className="mt-1 flex items-center gap-2">
                                {/* Frosted confidence capsule with semantic label */}
                                <span className={`inline-flex rounded-full px-2 py-[2.5px] text-[9px] font-bold uppercase tracking-[0.06em] backdrop-blur-[10px] ${confidenceColor.pill}`}>
                                    {confidenceLabel}
                                </span>
                                <span className={`text-[11px] font-semibold tabular-nums tracking-[-0.01em] ${
                                    isLight ? 'text-slate-600' : 'text-white/50'
                                }`}>
                                    {recommendation.confidence}%
                                </span>
                            </div>
                            {/* Subtle visual confidence bar */}
                            <div className={`mt-2 h-[2.5px] rounded-full overflow-hidden ${
                                isLight ? 'bg-black/[0.04]' : 'bg-white/[0.06]'
                            }`}>
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${recommendation.confidence}%` }}
                                    transition={{ duration: 0.8, ease: [0.23, 1, 0.32, 1], delay: 0.25 }}
                                    className={`h-full rounded-full ${confidenceColor.bar}`}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Why This Mode ────────────────────────────────── */}
                <div className={`mt-1.5 ${pane(isLight)} px-3.5 py-2.5`}>
                    <div className={sectionLabel(isLight)}>Why This Mode?</div>
                    <p className={`mt-0.5 text-[11.5px] leading-[1.6] tracking-[-0.006em] ${
                        isLight ? 'text-slate-700' : 'text-white/65'
                    }`}>
                        {whyLine}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {recommendation.matchedSignals.map((signal) => (
                            <span
                                key={signal}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] font-semibold backdrop-blur-[8px] transition-all duration-200 hover:brightness-110 ${
                                    isLight
                                        ? 'bg-emerald-500/[0.07] text-emerald-700 ring-1 ring-emerald-500/[0.10] shadow-[inset_0_0.5px_0_rgba(52,211,153,0.15)]'
                                        : 'bg-emerald-400/[0.08] text-emerald-300/90 ring-1 ring-emerald-400/[0.08] shadow-[inset_0_0.5px_0_rgba(52,211,153,0.10)]'
                                }`}
                            >
                                <Check className="h-2.5 w-2.5" />
                                {signal}
                            </span>
                        ))}
                    </div>
                </div>

                {/* ── References + Override ─────────────────────────── */}
                <div className="mt-1.5 grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(0,1fr)_176px]">
                    {recommendation.suggestedReferences.length > 0 ? (
                        <div className={`${pane(isLight)} px-3.5 py-2.5`}>
                            <div className={sectionLabel(isLight)}>Suggested References</div>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                                {recommendation.suggestedReferences.map((reference) => (
                                    <span
                                        key={reference}
                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[9px] font-medium backdrop-blur-[8px] transition-all duration-200 hover:brightness-110 ${
                                            isLight
                                                ? 'bg-slate-500/[0.06] text-slate-600 ring-1 ring-slate-400/[0.08] shadow-[inset_0_0.5px_0_rgba(100,116,139,0.10)]'
                                                : 'bg-white/[0.05] text-white/55 ring-1 ring-white/[0.05] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)]'
                                        }`}
                                    >
                                        <Check className="h-2.5 w-2.5 opacity-60" />
                                        {reference}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : <div />}

                    {/* Override dropdown — AI correction path */}
                    <div className={`${pane(isLight)} px-3.5 py-2.5`}>
                        <div className={`text-[9px] font-medium tracking-[0.12em] uppercase ${
                            isLight ? 'text-slate-400/70' : 'text-white/24'
                        }`}>
                            Not the right mode?
                        </div>
                        <div className="relative mt-1.5">
                            <select
                                value={selectedModeId}
                                onChange={(event) => setSelectedModeId(event.target.value as ModeOptionId)}
                                className={`w-full appearance-none rounded-xl px-3 py-[7px] text-[11px] font-medium outline-none transition-all duration-200 backdrop-blur-[10px] ${
                                    isLight
                                        ? 'bg-white/45 text-slate-800 ring-1 ring-white/50 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.7)] focus:bg-white/65 focus:ring-white/70'
                                        : 'bg-white/[0.06] text-white/80 ring-1 ring-white/[0.07] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)] focus:bg-white/[0.09] focus:ring-white/[0.12]'
                                }`}
                            >
                                {MODE_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className={`pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 ${
                                isLight ? 'text-slate-400/60' : 'text-white/24'
                            }`} />
                        </div>
                    </div>
                </div>

                {/* ── Footer: error + apply ─────────────────────────── */}
                <div className={`mt-3 pt-3 border-t ${
                    isLight ? 'border-black/[0.04]' : 'border-white/[0.05]'
                }`}>
                    {error && (
                        <div className={`mb-2 rounded-xl px-3 py-1.5 text-[10px] font-medium ${
                            isLight ? 'bg-rose-500/8 text-rose-700' : 'bg-rose-500/10 text-rose-200'
                        }`}>
                            {error}
                        </div>
                    )}

                    <div className="flex items-center justify-end">
                        <motion.button
                            type="button"
                            whileHover={{ scale: 1.02, filter: 'brightness(1.1)' }}
                            whileTap={{ scale: 0.97 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                            onClick={() => onApply(selectedModeId)}
                            disabled={applying}
                            className={`group relative overflow-hidden text-white px-5 py-2 rounded-full font-semibold text-[12px] tracking-[-0.01em] backdrop-blur-xl ${applying ? 'cursor-wait opacity-70' : ''}`}
                            style={{
                                boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.65), inset 0 -1px 2px rgba(0,0,0,0.08), 0 2px 10px rgba(16,185,129,0.40), 0 0 0 0.5px rgba(255,255,255,0.12)',
                            }}
                        >
                            {/* Green gradient background */}
                            <div className="absolute inset-0 bg-gradient-to-b from-emerald-400 via-emerald-500 to-green-600" />
                            {/* Top highlight band */}
                            <div className="absolute inset-x-3 top-0 h-[40%] bg-gradient-to-b from-white/35 to-transparent blur-[2px] rounded-b-lg opacity-80 pointer-events-none z-10" />
                            {/* Hover glow */}
                            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-10" />
                            {/* Label */}
                            <span className="relative z-20 drop-shadow-[0_1px_1px_rgba(0,0,0,0.10)]">
                                {applying ? 'Applying...' : 'Apply Mode'}
                            </span>
                        </motion.button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

export default CalendarModeRecommendationCard;
