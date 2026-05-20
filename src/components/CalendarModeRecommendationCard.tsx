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

function getConfidenceLabel(confidence: number): 'High Confidence' | 'Medium Confidence' | 'Low Confidence' {
    if (confidence >= 80) return 'High Confidence';
    if (confidence >= 60) return 'Medium Confidence';
    return 'Low Confidence';
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

/* ── Shared pane style (embedded glass compartment) ────────────── */
const pane = (isLight: boolean) =>
    isLight
        ? 'rounded-[16px] bg-white/28 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.7),0_1px_3px_rgba(15,23,42,0.04)] backdrop-blur-[18px]'
        : 'rounded-[16px] bg-white/[0.04] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.08),0_1px_3px_rgba(0,0,0,0.12)] backdrop-blur-[18px]';

/* ── Section label style ───────────────────────────────────────── */
const sectionLabel = (isLight: boolean) =>
    `text-[9px] font-semibold uppercase tracking-[0.14em] ${isLight ? 'text-slate-400' : 'text-white/36'}`;

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

    return (
        <div
            className={`relative overflow-hidden rounded-[24px] ${
                isLight
                    ? 'bg-white/48 shadow-[0_24px_80px_rgba(15,23,42,0.16),0_0_0_0.5px_rgba(255,255,255,0.6),inset_0_1px_0_rgba(255,255,255,0.85)]'
                    : 'bg-[rgba(28,30,38,0.62)] shadow-[0_24px_80px_rgba(2,6,23,0.48),0_0_0_0.5px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.10)]'
            }`}
            style={{ backdropFilter: 'blur(24px) saturate(180%)' }}
        >
            {/* ── Ambient layers ─────────────────────────────────── */}
            <div className="absolute inset-0 pointer-events-none">
                {/* Radial colour wash */}
                <div className={`absolute inset-0 ${
                    isLight
                        ? 'bg-[radial-gradient(circle_at_12%_14%,rgba(255,255,255,0.42),transparent_32%),radial-gradient(circle_at_85%_8%,rgba(186,216,255,0.14),transparent_26%)]'
                        : 'bg-[radial-gradient(circle_at_12%_14%,rgba(255,255,255,0.09),transparent_30%),radial-gradient(circle_at_85%_8%,rgba(140,180,255,0.07),transparent_24%)]'
                }`} />
                {/* Diagonal refraction */}
                <div className={`absolute inset-0 opacity-[0.06] ${
                    isLight
                        ? 'bg-[linear-gradient(118deg,rgba(15,23,42,0.06),transparent_38%,rgba(125,211,252,0.10))]'
                        : 'bg-[linear-gradient(118deg,rgba(255,255,255,0.06),transparent_38%,rgba(125,211,252,0.08))]'
                }`} />
                {/* Apple highlight band — faint top edge light */}
                <div className={`absolute inset-x-0 top-0 h-16 ${
                    isLight
                        ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.65),rgba(255,255,255,0))]'
                        : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0))]'
                }`} />
            </div>

            {/* ── Content ────────────────────────────────────────── */}
            <div className="relative z-10 flex flex-col px-5 py-4">

                {/* ── Header row ─────────────────────────────────── */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                            isLight
                                ? 'bg-white/50 text-slate-500 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.8)]'
                                : 'bg-white/[0.06] text-white/56 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.08)]'
                        }`}>
                            <Sparkles className="h-2.5 w-2.5" />
                            Upcoming Event
                        </div>
                        <h3 className={`text-[20px] font-semibold leading-[1.08] tracking-[-0.035em] ${
                            isLight ? 'text-slate-950' : 'text-white'
                        }`}>
                            {recommendation.title}
                        </h3>
                        <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${
                            isLight ? 'text-slate-500' : 'text-white/50'
                        }`}>
                            <CalendarClock className="h-3 w-3" />
                            <span className="font-medium">
                                {getDateLabel(recommendation.startTime)} • {getTimeLabel(recommendation.startTime)}
                            </span>
                        </div>
                    </div>
                    {showCloseButton && (
                        <button
                            type="button"
                            onClick={onClose ?? onDismiss}
                            aria-label="Close recommendation"
                            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-200 ${
                                isLight
                                    ? 'bg-white/36 text-slate-400 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.7)] hover:bg-white/56 hover:text-slate-700'
                                    : 'bg-white/[0.06] text-white/36 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)] hover:bg-white/[0.10] hover:text-white/64'
                            }`}
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                {/* ── Summary + Recommended Mode ─────────────────── */}
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    {/* Summary pane */}
                    <div className={`${pane(isLight)} px-4 py-3`}>
                        <div className={sectionLabel(isLight)}>Summary</div>
                        <p className={`mt-1 text-[12px] leading-[1.5] ${
                            isLight ? 'text-slate-700' : 'text-white/72'
                        }`}>
                            {recommendation.summary}
                        </p>
                    </div>

                    {/* Recommended Mode pane */}
                    <div className={`${pane(isLight)} px-4 py-3`}>
                        <div className={sectionLabel(isLight)}>Recommended Mode</div>
                        <div className={`mt-1 flex items-center gap-2 text-[13px] font-semibold ${
                            isLight ? 'text-slate-950' : 'text-white'
                        }`}>
                            <WandSparkles className={`h-3.5 w-3.5 ${isLight ? 'text-sky-600' : 'text-sky-300'}`} />
                            {recommendation.recommendedModeLabel}
                        </div>
                        <div className="mt-2.5">
                            <div className={sectionLabel(isLight)}>Confidence</div>
                            <div className="mt-1 flex items-center gap-2">
                                {/* Frosted confidence capsule */}
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] backdrop-blur-[10px] ${
                                    isLight
                                        ? 'bg-sky-500/[0.07] text-sky-700 shadow-[inset_0_0.5px_0_rgba(56,189,248,0.12)]'
                                        : 'bg-sky-400/[0.08] text-sky-200 shadow-[inset_0_0.5px_0_rgba(56,189,248,0.10)]'
                                }`}>
                                    {confidenceLabel}
                                </span>
                                <span className={`text-[11px] font-medium ${
                                    isLight ? 'text-slate-600' : 'text-white/60'
                                }`}>
                                    {recommendation.confidence}%
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Why This Mode ──────────────────────────────── */}
                <div className={`mt-2 ${pane(isLight)} px-4 py-3`}>
                    <div className={sectionLabel(isLight)}>Why This Mode?</div>
                    <p className={`mt-0.5 text-[12px] leading-[1.5] ${
                        isLight ? 'text-slate-700' : 'text-white/72'
                    }`}>
                        {whyLine}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {recommendation.matchedSignals.map((signal) => (
                            <span
                                key={signal}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold backdrop-blur-[8px] transition-all duration-200 hover:brightness-110 ${
                                    isLight
                                        ? 'bg-emerald-500/[0.06] text-emerald-700 shadow-[inset_0_0.5px_0_rgba(52,211,153,0.15)]'
                                        : 'bg-emerald-400/[0.07] text-emerald-200 shadow-[inset_0_0.5px_0_rgba(52,211,153,0.10)]'
                                }`}
                            >
                                <Check className="h-2.5 w-2.5" />
                                {signal}
                            </span>
                        ))}
                    </div>
                </div>

                {/* ── References + Override ───────────────────────── */}
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_190px]">
                    {recommendation.suggestedReferences.length > 0 ? (
                        <div className={`${pane(isLight)} px-4 py-3`}>
                            <div className={sectionLabel(isLight)}>Suggested References</div>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                                {recommendation.suggestedReferences.map((reference) => (
                                    <span
                                        key={reference}
                                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium backdrop-blur-[8px] ${
                                            isLight
                                                ? 'bg-slate-500/[0.06] text-slate-600 shadow-[inset_0_0.5px_0_rgba(100,116,139,0.10)]'
                                                : 'bg-white/[0.05] text-white/60 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)]'
                                        }`}
                                    >
                                        <Check className="h-2.5 w-2.5" />
                                        {reference}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : <div />}

                    {/* Override dropdown — compact, secondary */}
                    <div className={`${pane(isLight)} px-4 py-3`}>
                        <div className={`text-[9px] font-medium tracking-[0.10em] uppercase ${
                            isLight ? 'text-slate-400' : 'text-white/32'
                        }`}>
                            Wrong recommendation?
                        </div>
                        <div className="relative mt-1.5">
                            <select
                                value={selectedModeId}
                                onChange={(event) => setSelectedModeId(event.target.value as ModeOptionId)}
                                className={`w-full appearance-none rounded-xl px-3 py-2 text-[11px] font-medium outline-none transition-colors backdrop-blur-[10px] ${
                                    isLight
                                        ? 'bg-white/50 text-slate-800 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.7)] focus:bg-white/70'
                                        : 'bg-white/[0.06] text-white/86 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)] focus:bg-white/[0.09]'
                                }`}
                            >
                                {MODE_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className={`pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 ${
                                isLight ? 'text-slate-400' : 'text-white/32'
                            }`} />
                        </div>
                    </div>
                </div>

                {/* ── Footer: error + apply ───────────────────────── */}
                <div className="pt-3">
                    {error && (
                        <div className={`mb-2 rounded-full px-3 py-1.5 text-[10px] font-medium ${
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
        </div>
    );
};

export default CalendarModeRecommendationCard;
