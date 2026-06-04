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
    animateEntrance?: boolean;
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

function getConfidencePercent(confidence: number): number {
    if (!Number.isFinite(confidence)) return 0;
    const percent = confidence <= 1 ? confidence * 100 : confidence;
    return Math.max(0, Math.min(100, Math.round(percent)));
}

function getConfidenceLabel(confidencePercent: number): string {
    if (confidencePercent >= 90) return 'Very high match';
    if (confidencePercent >= 80) return 'High match';
    if (confidencePercent >= 60) return 'Medium match';
    return 'Low match';
}

function buildWhyLine(recommendation: CalendarModeRecommendation): string {
    const signals = recommendation.matchedSignals
        .map((signal) => signal.toLowerCase())
        .filter(Boolean);
    const [first, second, third] = signals;

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

const sectionLabel = 'text-[11px] font-medium text-text-tertiary';
const panelClass = 'rounded-lg border border-border-subtle bg-bg-primary p-3';

const CalendarModeRecommendationCard: React.FC<CalendarModeRecommendationCardProps> = ({
    recommendation,
    isLight,
    applying = false,
    error = null,
    showCloseButton = false,
    animateEntrance = true,
    onClose,
    onApply,
    onDismiss,
}) => {
    const [selectedModeId, setSelectedModeId] = useState<ModeOptionId>(recommendation.recommendedMode);

    useEffect(() => {
        setSelectedModeId(recommendation.recommendedMode);
    }, [recommendation.eventId, recommendation.recommendedMode]);

    const confidencePercent = useMemo(
        () => getConfidencePercent(recommendation.confidence),
        [recommendation.confidence]
    );

    const confidenceLabel = useMemo(
        () => getConfidenceLabel(confidencePercent),
        [confidencePercent]
    );

    const whyLine = useMemo(
        () => buildWhyLine(recommendation),
        [recommendation]
    );

    const confidenceTone = useMemo(() => {
        if (confidencePercent >= 80) {
            return {
                chip: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/15',
                bar: 'bg-emerald-500',
            };
        }

        if (confidencePercent >= 60) {
            return {
                chip: 'text-amber-600 bg-amber-500/10 border-amber-500/15',
                bar: 'bg-amber-500',
            };
        }

        return {
            chip: 'text-rose-600 bg-rose-500/10 border-rose-500/15',
            bar: 'bg-rose-500',
        };
    }, [confidencePercent]);

    return (
        <motion.div
            initial={animateEntrance ? { opacity: 0, y: 12 } : false}
            animate={animateEntrance ? { opacity: 1, y: 0 } : undefined}
            exit={animateEntrance ? { opacity: 0, y: 10 } : undefined}
            transition={animateEntrance ? { duration: 0.22, ease: [0.23, 1, 0.32, 1] } : undefined}
            className={`relative overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated ${
                isLight
                    ? 'shadow-[0_18px_48px_rgba(15,23,42,0.12)]'
                    : 'shadow-[0_18px_48px_rgba(0,0,0,0.34)]'
            }`}
        >
            <div className="flex items-start justify-between gap-4 border-b border-border-subtle bg-bg-primary px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/15 bg-emerald-500/10 text-emerald-500">
                        <Sparkles size={18} />
                    </div>
                    <div className="min-w-0">
                        <p className={sectionLabel}>Suggested mode</p>
                        <h3 className="mt-1 truncate text-[20px] font-semibold leading-tight text-text-primary">
                            {recommendation.title}
                        </h3>
                        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-text-secondary">
                            <CalendarClock size={13} />
                            <span className="font-medium">
                                {getDateLabel(recommendation.startTime)} at {getTimeLabel(recommendation.startTime)}
                            </span>
                        </div>
                    </div>
                </div>

                {showCloseButton && (
                    <button
                        type="button"
                        onClick={onClose ?? onDismiss}
                        aria-label="Close recommendation"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-elevated text-text-secondary transition-colors hover:bg-bg-item-surface hover:text-text-primary active:scale-[0.98]"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
                <div className="space-y-3">
                    <section className={panelClass}>
                        <p className={sectionLabel}>Summary</p>
                        <p className="mt-2 text-[13px] leading-6 text-text-secondary">
                            {recommendation.summary}
                        </p>
                    </section>

                    <section className={panelClass}>
                        <p className={sectionLabel}>Why this mode?</p>
                        <p className="mt-2 text-[13px] leading-6 text-text-secondary">
                            {whyLine}
                        </p>
                        {recommendation.matchedSignals.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {recommendation.matchedSignals.map((signal) => (
                                    <span
                                        key={signal}
                                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/15 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-600"
                                    >
                                        <Check size={12} />
                                        {signal}
                                    </span>
                                ))}
                            </div>
                        )}
                    </section>

                    {recommendation.suggestedReferences.length > 0 && (
                        <section className={panelClass}>
                            <p className={sectionLabel}>Suggested references</p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {recommendation.suggestedReferences.map((reference) => (
                                    <span
                                        key={reference}
                                        className="rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 text-[11px] font-medium text-text-secondary"
                                    >
                                        {reference}
                                    </span>
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                <aside className="flex min-w-0 flex-col gap-3 rounded-lg border border-border-subtle bg-bg-primary p-3">
                    <div>
                        <p className={sectionLabel}>Recommended mode</p>
                        <div className="mt-2 flex items-center gap-2 text-[14px] font-semibold text-text-primary">
                            <WandSparkles size={15} className="text-blue-500" />
                            <span className="min-w-0 truncate">{recommendation.recommendedModeLabel}</span>
                        </div>
                    </div>

                    <div className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
                        <div className="flex items-center justify-between gap-2">
                            <p className={sectionLabel}>Confidence</p>
                            <span className={`rounded-md border px-2 py-1 text-[11px] font-medium ${confidenceTone.chip}`}>
                                {confidenceLabel}
                            </span>
                        </div>
                        <div className="mt-3 flex items-end justify-between gap-3">
                            <span className="text-[24px] font-semibold leading-none text-text-primary tabular-nums">
                                {confidencePercent}%
                            </span>
                            <span className="text-[12px] text-text-secondary">calendar match</span>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-item-surface">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${confidencePercent}%` }}
                                transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1], delay: 0.1 }}
                                className={`h-full rounded-full ${confidenceTone.bar}`}
                            />
                        </div>
                    </div>

                    <div className="mt-auto">
                        <p className={sectionLabel}>Change mode</p>
                        <div className="relative mt-2">
                            <select
                                value={selectedModeId}
                                onChange={(event) => setSelectedModeId(event.target.value as ModeOptionId)}
                                className="h-9 w-full appearance-none rounded-md border border-border-subtle bg-bg-elevated px-3 pr-8 text-[12px] font-medium text-text-primary outline-none transition-colors focus:border-border-muted focus:bg-bg-item-surface"
                            >
                                {MODE_OPTIONS.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
                        </div>
                    </div>
                </aside>
            </div>

            <div className="border-t border-border-subtle bg-bg-primary px-5 py-4">
                {error && (
                    <div className="mb-3 rounded-md border border-rose-500/15 bg-rose-500/10 px-3 py-2 text-[12px] font-medium text-rose-600">
                        {error}
                    </div>
                )}

                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose ?? onDismiss}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-border-subtle bg-bg-elevated px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-item-surface hover:text-text-primary active:scale-[0.98]"
                    >
                        Close
                    </button>
                    <button
                        type="button"
                        onClick={() => onApply(selectedModeId)}
                        disabled={applying}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-text-primary px-4 text-[13px] font-semibold text-bg-primary transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
                    >
                        <Sparkles size={14} />
                        {applying ? 'Applying...' : 'Apply mode'}
                    </button>
                </div>
            </div>
        </motion.div>
    );
};

export default CalendarModeRecommendationCard;
