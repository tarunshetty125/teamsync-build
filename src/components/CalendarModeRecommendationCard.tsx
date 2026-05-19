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
            className={`relative overflow-hidden rounded-[28px] backdrop-blur-[40px] ${
                isLight
                    ? 'bg-white/54 shadow-[0_28px_90px_rgba(15,23,42,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]'
                    : 'bg-[rgba(30,34,42,0.72)] shadow-[0_28px_90px_rgba(2,6,23,0.52),inset_0_1px_0_rgba(255,255,255,0.12)]'
            }`}
        >
            <div className="absolute inset-0 pointer-events-none">
                <div className={`absolute inset-0 ${
                    isLight
                        ? 'bg-[radial-gradient(circle_at_14%_18%,rgba(255,255,255,0.48),transparent_30%),radial-gradient(circle_at_82%_10%,rgba(191,219,254,0.18),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.56),rgba(241,245,249,0.28))]'
                        : 'bg-[radial-gradient(circle_at_14%_16%,rgba(255,255,255,0.12),transparent_28%),radial-gradient(circle_at_82%_8%,rgba(191,219,254,0.1),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0))]'
                }`} />
                <div className={`absolute inset-0 opacity-[0.08] ${
                    isLight ? 'bg-[linear-gradient(120deg,rgba(15,23,42,0.08),transparent_40%,rgba(125,211,252,0.14))]' : 'bg-[linear-gradient(120deg,rgba(255,255,255,0.08),transparent_40%,rgba(125,211,252,0.12))]'
                }`} />
                <div className={`absolute inset-x-0 top-0 h-24 ${
                    isLight
                        ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.75),rgba(255,255,255,0))]'
                        : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0))]'
                }`} />
            </div>

            <div className="relative z-10 flex flex-col px-6 py-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className={`mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            isLight ? 'bg-white/65 text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]' : 'bg-white/[0.08] text-white/68 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]'
                        }`}>
                            <Sparkles className="h-3 w-3" />
                            Upcoming Event
                        </div>
                        <h3 className={`text-[22px] font-semibold leading-[1.05] tracking-[-0.03em] ${
                            isLight ? 'text-slate-950' : 'text-white'
                        }`}>
                            {recommendation.title}
                        </h3>
                        <div className={`mt-2 flex items-center gap-2 text-[12px] ${
                            isLight ? 'text-slate-600' : 'text-white/58'
                        }`}>
                            <CalendarClock className="h-3.5 w-3.5" />
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
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                                isLight
                                    ? 'bg-white/54 text-slate-500 shadow-[0_10px_24px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-white/72 hover:text-slate-950'
                                    : 'bg-white/[0.07] text-white/56 shadow-[0_10px_24px_rgba(2,6,23,0.2),inset_0_1px_0_rgba(255,255,255,0.1)] hover:bg-white/[0.12] hover:text-white'
                            }`}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    <div className={`rounded-[20px] px-5 py-4 ${
                        isLight
                            ? 'bg-white/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[22px]'
                            : 'bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-[22px]'
                    }`}>
                        <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            isLight ? 'text-slate-500' : 'text-white/42'
                        }`}>
                            Summary
                        </div>
                        <p className={`mt-1.5 text-[13px] leading-[1.45] ${
                            isLight ? 'text-slate-700' : 'text-white/76'
                        }`}>
                            {recommendation.summary}
                        </p>
                    </div>

                    <div className={`rounded-[20px] px-5 py-4 ${
                        isLight
                            ? 'bg-white/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[22px]'
                            : 'bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-[22px]'
                    }`}>
                        <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            isLight ? 'text-slate-500' : 'text-white/42'
                        }`}>
                            Recommended Mode
                        </div>
                        <div className={`mt-1.5 flex items-center gap-2 text-[14px] font-semibold ${
                            isLight ? 'text-slate-950' : 'text-white'
                        }`}>
                            <WandSparkles className={`h-4 w-4 ${isLight ? 'text-sky-700' : 'text-sky-200'}`} />
                            {recommendation.recommendedModeLabel}
                        </div>
                        <div className="mt-3">
                            <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                                isLight ? 'text-slate-500' : 'text-white/42'
                            }`}>
                                Confidence
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                                <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                                    isLight
                                        ? 'border-sky-200 bg-sky-500/8 text-sky-700'
                                        : 'border-sky-300/18 bg-sky-300/10 text-sky-200'
                                }`}>
                                    {confidenceLabel}
                                </span>
                                <span className={`text-[12px] font-medium ${
                                    isLight ? 'text-slate-700' : 'text-white/72'
                                }`}>
                                    {recommendation.confidence}%
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`mt-3 rounded-[20px] px-5 py-4 ${
                    isLight
                        ? 'bg-white/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[22px]'
                        : 'bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-[22px]'
                }`}>
                    <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                        isLight ? 'text-slate-500' : 'text-white/42'
                    }`}>
                        Why This Mode?
                    </div>
                    <p className={`mt-1 text-[13px] leading-[1.45] ${
                        isLight ? 'text-slate-700' : 'text-white/76'
                    }`}>
                        {whyLine}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {recommendation.matchedSignals.map((signal) => (
                            <span
                                key={signal}
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${
                                    isLight
                                        ? 'border-emerald-200 bg-emerald-500/8 text-emerald-700'
                                        : 'border-emerald-400/18 bg-emerald-400/10 text-emerald-200'
                                }`}
                            >
                                <Check className="h-3 w-3" />
                                {signal}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                    {recommendation.suggestedReferences.length > 0 ? (
                        <div className={`rounded-[20px] px-5 py-4 ${
                            isLight
                                ? 'bg-white/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[22px]'
                                : 'bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-[22px]'
                        }`}>
                            <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                                isLight ? 'text-slate-500' : 'text-white/42'
                            }`}>
                                Suggested References
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {recommendation.suggestedReferences.map((reference) => (
                                    <span
                                        key={reference}
                                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${
                                            isLight
                                                ? 'border-slate-200 bg-slate-100/80 text-slate-700'
                                                : 'border-white/12 bg-white/[0.08] text-white/72'
                                        }`}
                                    >
                                        <Check className="h-3 w-3" />
                                        {reference}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : <div />}

                    <div className={`rounded-[20px] px-5 py-4 ${
                        isLight
                            ? 'bg-white/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[22px]'
                            : 'bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-[22px]'
                    }`}>
                        <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            isLight ? 'text-slate-500' : 'text-white/42'
                        }`}>
                            Not This Mode?
                        </div>
                        <div className="relative mt-2">
                            <select
                                value={selectedModeId}
                                onChange={(event) => setSelectedModeId(event.target.value as ModeOptionId)}
                                className={`w-full appearance-none rounded-2xl px-3.5 py-3 text-[12px] font-medium outline-none transition-colors ${
                                    isLight
                                        ? 'bg-white/76 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] focus:bg-white'
                                        : 'bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] focus:bg-white/[0.11]'
                                }`}
                            >
                                {MODE_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className={`pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${
                                isLight ? 'text-slate-500' : 'text-white/45'
                            }`} />
                        </div>
                    </div>
                </div>

                <div className="pt-5">
                    {error && (
                        <div className={`mb-3 rounded-full px-3 py-2 text-[11px] font-medium ${
                            isLight ? 'bg-rose-500/10 text-rose-700' : 'bg-rose-500/12 text-rose-200'
                        }`}>
                            {error}
                        </div>
                    )}

                    <div className="flex items-center justify-end">
                        <motion.button
                            type="button"
                            whileTap={{ scale: 0.97 }}
                            onClick={() => onApply(selectedModeId)}
                            disabled={applying}
                            className={`rounded-full px-5 py-2.5 text-[12px] font-semibold transition-all ${
                                isLight
                                    ? 'bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.16)] hover:bg-slate-800'
                                    : 'bg-white/92 text-slate-950 shadow-[0_16px_40px_rgba(255,255,255,0.12)] hover:bg-white'
                            } ${applying ? 'cursor-wait opacity-70' : ''}`}
                        >
                            {applying ? 'Applying...' : 'Apply Mode'}
                        </motion.button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CalendarModeRecommendationCard;
