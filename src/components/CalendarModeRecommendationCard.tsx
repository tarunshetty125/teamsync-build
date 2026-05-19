import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Check, ChevronDown, Sparkles, WandSparkles } from 'lucide-react';

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
            className={`relative h-full overflow-hidden rounded-[22px] border ${
                isLight ? 'border-black/8 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)]' : 'border-white/10 bg-[#0f1117]'
            }`}
        >
            <div className="absolute inset-0 pointer-events-none">
                <div className={`absolute inset-0 ${
                    isLight
                        ? 'bg-[radial-gradient(circle_at_14%_18%,rgba(168,85,247,0.16),transparent_34%),radial-gradient(circle_at_85%_12%,rgba(59,130,246,0.1),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.78),rgba(248,250,252,0.94))]'
                        : 'bg-[radial-gradient(circle_at_12%_18%,rgba(168,85,247,0.3),transparent_34%),radial-gradient(circle_at_86%_14%,rgba(96,165,250,0.16),transparent_28%),linear-gradient(180deg,rgba(15,17,23,0.96),rgba(8,10,15,0.98))]'
                }`} />
                <div className={`absolute inset-0 opacity-[0.06] ${
                    isLight ? 'bg-[linear-gradient(120deg,rgba(15,23,42,0.14),transparent_40%,rgba(168,85,247,0.16))]' : 'bg-[linear-gradient(120deg,rgba(255,255,255,0.12),transparent_40%,rgba(168,85,247,0.18))]'
                }`} />
            </div>

            <div className="relative z-10 flex h-full flex-col px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className={`mb-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            isLight ? 'bg-violet-500/10 text-violet-700' : 'bg-violet-400/12 text-violet-200'
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
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                    <div className={`rounded-[18px] border px-4 py-3 ${
                        isLight ? 'border-black/6 bg-white/75' : 'border-white/8 bg-white/[0.03]'
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

                    <div className={`rounded-[18px] border px-4 py-3 ${
                        isLight ? 'border-black/6 bg-white/72' : 'border-white/8 bg-white/[0.03]'
                    }`}>
                        <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            isLight ? 'text-slate-500' : 'text-white/42'
                        }`}>
                            Recommended Mode
                        </div>
                        <div className={`mt-1.5 flex items-center gap-2 text-[14px] font-semibold ${
                            isLight ? 'text-slate-950' : 'text-white'
                        }`}>
                            <WandSparkles className={`h-4 w-4 ${isLight ? 'text-violet-700' : 'text-violet-200'}`} />
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
                                        ? 'border-violet-200 bg-violet-500/8 text-violet-700'
                                        : 'border-violet-400/18 bg-violet-400/10 text-violet-200'
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

                <div className={`mt-3 rounded-[18px] border px-4 py-3 ${
                    isLight ? 'border-black/6 bg-white/75' : 'border-white/8 bg-white/[0.03]'
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
                        <div className={`rounded-[18px] border px-4 py-3 ${
                            isLight ? 'border-black/6 bg-white/72' : 'border-white/8 bg-white/[0.03]'
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
                                                ? 'border-violet-200/80 bg-violet-500/8 text-violet-700'
                                                : 'border-violet-400/18 bg-violet-400/10 text-violet-200'
                                        }`}
                                    >
                                        <Check className="h-3 w-3" />
                                        {reference}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : <div />}

                    <div className={`rounded-[18px] border px-4 py-3 ${
                        isLight ? 'border-black/6 bg-white/72' : 'border-white/8 bg-white/[0.03]'
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
                                className={`w-full appearance-none rounded-xl border px-3 py-2 text-[12px] font-medium outline-none transition-colors ${
                                    isLight
                                        ? 'border-black/8 bg-white text-slate-900 focus:border-violet-300'
                                        : 'border-white/10 bg-white/[0.04] text-white focus:border-violet-300/50'
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

                <div className="mt-auto pt-4">
                    {error && (
                        <div className={`mb-3 rounded-full px-3 py-2 text-[11px] font-medium ${
                            isLight ? 'bg-rose-500/10 text-rose-700' : 'bg-rose-500/12 text-rose-200'
                        }`}>
                            {error}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onDismiss}
                            className={`rounded-full px-4 py-2 text-[12px] font-medium transition-colors ${
                                isLight
                                    ? 'text-slate-600 hover:bg-slate-900/6 hover:text-slate-900'
                                    : 'text-white/64 hover:bg-white/8 hover:text-white'
                            }`}
                        >
                            Dismiss
                        </button>
                        <motion.button
                            type="button"
                            whileTap={{ scale: 0.97 }}
                            onClick={() => onApply(selectedModeId)}
                            disabled={applying}
                            className={`rounded-full px-4 py-2 text-[12px] font-semibold transition-all ${
                                isLight
                                    ? 'bg-slate-950 text-white shadow-[0_12px_30px_rgba(15,23,42,0.16)] hover:bg-slate-800'
                                    : 'bg-white text-slate-950 shadow-[0_12px_30px_rgba(255,255,255,0.12)] hover:bg-violet-50'
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
