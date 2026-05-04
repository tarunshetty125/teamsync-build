import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, ScanSearch, Sparkles, X } from 'lucide-react';

export type ScreenScanOverlayPhase = 'hidden' | 'scanning' | 'processing' | 'result';
export type ScreenScanOverlayMode =
    | 'coding'
    | 'interview_question'
    | 'slides_presentation'
    | 'document_text'
    | 'ui_general';

interface ScreenScanOverlayProps {
    visible: boolean;
    phase: ScreenScanOverlayPhase;
    mode: ScreenScanOverlayMode;
    answer: string;
    chips?: Array<{ label: string; variant: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray' }>;
    expanded: boolean;
    onToggleExpanded: () => void;
    onClose: () => void;
}

const MODE_META: Record<ScreenScanOverlayMode, { label: string; icon: string }> = {
    coding: { label: 'Code', icon: '⚡' },
    interview_question: { label: 'Interview', icon: '🎯' },
    slides_presentation: { label: 'Slides', icon: '📊' },
    document_text: { label: 'Document', icon: '📄' },
    ui_general: { label: 'Screen', icon: '🔍' },
};

function getPreviewText(answer: string): string {
    const trimmed = answer.trim();
    if (!trimmed) return '';
    const lines = trimmed
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3);
    return lines.join('\n');
}

export const ScreenScanOverlay: React.FC<ScreenScanOverlayProps> = ({
    visible,
    phase,
    mode,
    answer,
    chips = [],
    expanded,
    onToggleExpanded,
    onClose,
}) => {
    const meta = MODE_META[mode];
    const previewText = getPreviewText(answer);

    return (
        <AnimatePresence>
            {visible && phase === 'scanning' ? (
                <motion.div
                    key="screen-scan-scanning"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-[120] pointer-events-none"
                >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.12),rgba(8,10,14,0.68))]" />
                    <div className="absolute inset-5 rounded-[20px] border border-amber-300/15 bg-black/10 backdrop-blur-[2px]">
                        <div className="absolute left-4 top-4 h-8 w-8 border-l-2 border-t-2 border-amber-300/80" />
                        <div className="absolute right-4 top-4 h-8 w-8 border-r-2 border-t-2 border-amber-300/80" />
                        <div className="absolute bottom-4 left-4 h-8 w-8 border-b-2 border-l-2 border-amber-300/80" />
                        <div className="absolute bottom-4 right-4 h-8 w-8 border-b-2 border-r-2 border-amber-300/80" />

                        <motion.div
                            animate={{ top: ['14%', '78%', '14%'] }}
                            transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity }}
                            className="absolute left-8 right-8 h-px bg-gradient-to-r from-transparent via-amber-300 to-transparent shadow-[0_0_24px_rgba(252,211,77,0.75)]"
                        />

                        <div className="absolute inset-x-0 bottom-8 flex justify-center">
                            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-black/40 px-3.5 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-amber-100 shadow-[0_12px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                                <ScanSearch className="h-3.5 w-3.5" />
                                Scanning Screen
                            </div>
                        </div>
                    </div>
                </motion.div>
            ) : null}

            {visible && phase !== 'hidden' ? (
                <motion.div
                    key={`screen-scan-chip-${phase}`}
                    initial={{ opacity: 0, y: 18, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 18, scale: 0.96 }}
                    transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    className="absolute bottom-4 right-4 z-[130] w-[min(320px,calc(100%-2rem))]"
                >
                    <div
                        className="overflow-hidden rounded-[20px] border border-white/12 bg-[linear-gradient(180deg,rgba(28,24,19,0.96),rgba(15,15,19,0.96))] shadow-[0_20px_60px_rgba(0,0,0,0.42)] backdrop-blur-2xl"
                    >
                        <div className="flex items-center justify-between border-b border-white/8 px-3.5 py-2.5">
                            <div className="flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/14 text-[13px] text-amber-200">
                                    {phase === 'result' ? meta.icon : '🧠'}
                                </span>
                                <div className="flex flex-col">
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-200/90">
                                        {phase === 'processing' ? 'Analyzing screen' : phase === 'result' ? 'Suggestions' : 'Scanning'}
                                    </span>
                                    <span className="text-[11px] text-white/55">
                                        {phase === 'result' ? meta.label : 'Context-aware screen intelligence'}
                                    </span>
                                </div>
                            </div>

                            <button
                                onClick={onClose}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/8 bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                                aria-label="Close screen scan overlay"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        {phase === 'processing' ? (
                            <div className="flex items-center gap-3 px-4 py-4 text-[13px] text-white/88">
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                                    className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/10"
                                >
                                    <Brain className="h-4 w-4 text-amber-200" />
                                </motion.div>
                                <div>
                                    <div className="font-medium">Analyzing screen...</div>
                                    <div className="mt-0.5 text-[11px] text-white/50">
                                        Extracting text, detecting context, routing response
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {phase === 'result' ? (
                            <button
                                onClick={onToggleExpanded}
                                className="block w-full text-left"
                            >
                                <div className="px-4 py-3.5">
                                    <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-300/14 bg-amber-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-100">
                                        <Sparkles className="h-3 w-3" />
                                        {meta.label}
                                    </div>

                                    <div
                                        className={`whitespace-pre-wrap text-[13px] leading-relaxed text-white/90 ${
                                            expanded ? '' : ''
                                        }`}
                                        style={expanded ? undefined : {
                                            display: '-webkit-box',
                                            WebkitLineClamp: 5,
                                            WebkitBoxOrient: 'vertical',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {expanded ? answer : previewText || answer}
                                    </div>

                                    <div className="mt-3 text-[11px] font-medium text-white/45">
                                        {expanded ? 'Click to collapse' : 'Click to expand'}
                                    </div>

                                    {chips.length > 0 ? (
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            {chips.map((chip) => (
                                                <span
                                                    key={chip.label}
                                                    className="inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold tracking-[0.02em]"
                                                    style={
                                                        chip.variant === 'green' ? { background: 'rgba(34,197,94,0.12)', color: '#4ADE80', borderColor: 'rgba(34,197,94,0.28)' } :
                                                        chip.variant === 'amber' ? { background: 'rgba(245,158,11,0.14)', color: '#FCD34D', borderColor: 'rgba(245,158,11,0.32)' } :
                                                        chip.variant === 'red' ? { background: 'rgba(239,68,68,0.12)', color: '#FCA5A5', borderColor: 'rgba(239,68,68,0.28)' } :
                                                        chip.variant === 'blue' ? { background: 'rgba(59,130,246,0.12)', color: '#93C5FD', borderColor: 'rgba(59,130,246,0.28)' } :
                                                        chip.variant === 'purple' ? { background: 'rgba(167,139,250,0.12)', color: '#C4B5FD', borderColor: 'rgba(167,139,250,0.28)' } :
                                                        { background: 'rgba(255,255,255,0.07)', color: '#D1D5DB', borderColor: 'rgba(255,255,255,0.12)' }
                                                    }
                                                >
                                                    {chip.label}
                                                </span>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            </button>
                        ) : null}
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
};

export default ScreenScanOverlay;
