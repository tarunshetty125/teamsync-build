import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { categorizeSttError, type SttErrorCategory } from '../../lib/sttErrorMapper';
import ChannelCard from './ChannelCard';

interface ChannelStatus {
    status: 'connected' | 'reconnecting' | 'failed';
    error?: string;
    provider?: string;
}

interface RollingTranscriptProps {
    /** The LAST finalized sentence only (not the full cumulative text) */
    text: string;
    speakerLabel?: string;
    isActive?: boolean;
    /**
     * True while the AI is still processing/streaming a response.
     * Dot = green+blinking when false (waiting), grey+static when true (answered).
     */
    aiHasResponded?: boolean;
    surfaceStyle?: React.CSSProperties;
    /** System audio (interviewer) channel */
    interviewerChannel?: ChannelStatus;
    /** User microphone channel */
    microphoneChannel?: ChannelStatus;
    onCopyDiagnostics?: () => void;
    variant?: 'default' | 'pro-v2';
}

const RollingTranscript: React.FC<RollingTranscriptProps> = ({
    text, speakerLabel, isActive: _isActive = true, aiHasResponded = false, surfaceStyle: _surfaceStyle,
    interviewerChannel, microphoneChannel,
    onCopyDiagnostics,
    variant = 'default',
}) => {
    const [copied, setCopied] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const intStatus = interviewerChannel?.status ?? 'connected';
    const micStatus = microphoneChannel?.status ?? 'connected';
    const intError = interviewerChannel?.error;
    const micError = microphoneChannel?.error;
    const intProvider = interviewerChannel?.provider;
    const micProvider = microphoneChannel?.provider;

    const anyFailed = intStatus === 'failed' || micStatus === 'failed';
    const anyReconnecting = intStatus === 'reconnecting' || micStatus === 'reconnecting';
    const isNormal = !anyFailed && !anyReconnecting && micStatus === 'connected';

    const intErrorCategory: SttErrorCategory | null = (intStatus === 'failed' && intError)
        ? categorizeSttError(intError)
        : null;
    const micErrorCategory: SttErrorCategory | null = (micStatus === 'failed' && micError)
        ? categorizeSttError(micError)
        : null;

    useEffect(() => {
        if (intStatus === 'connected' && micStatus === 'connected') setExpanded(false);
    }, [intStatus, micStatus]);

    const handleCopy = () => {
        if (onCopyDiagnostics) {
            onCopyDiagnostics();
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const stateSurface: React.CSSProperties = anyFailed
        ? { background: 'linear-gradient(180deg, rgba(220,38,38,0.12) 0%, rgba(220,38,38,0.04) 50%, transparent 100%)' }
        : {};

    const isCompactStrip = anyReconnecting && !anyFailed;
    const isProV2 = variant === 'pro-v2';

    // Trim and quote the sentence for display
    const displayText = text?.trim() ?? '';
    const quoted = displayText ? `"${displayText}"` : '';
    const trimmedSpeakerLabel = speakerLabel?.trim() ?? '';
    const speakerToneClass = (() => {
        const lower = trimmedSpeakerLabel.toLowerCase();
        if (lower === 'interviewer') {
            return 'border-red-400/30 bg-red-500/20 text-red-200';
        }
        if (lower === 'you') {
            return 'border-orange-400/30 bg-orange-500/20 text-orange-200';
        }
        return 'border-white/10 bg-white/[0.06] text-[var(--overlay-text-primary)]/90';
    })();

    const rootStyle: React.CSSProperties = isProV2
        ? {
            display: 'flex',
            justifyContent: 'center',
            width: '100%',
        }
        : {};

    const shellStyle: React.CSSProperties = isProV2
        ? {
            width: 'fit-content',
            maxWidth: '100%',
            padding: 0,
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'linear-gradient(180deg, rgba(22,22,26,0.72) 0%, rgba(15,15,18,0.62) 100%)',
            boxShadow: '0 14px 28px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(255,255,255,0.03)',
            backdropFilter: 'blur(24px) saturate(150%)',
            WebkitBackdropFilter: 'blur(24px) saturate(150%)',
            overflow: 'hidden',
        }
        : {};

    return (
        <div className="relative w-full" style={rootStyle}>
            <div
                className="relative w-full overflow-hidden"
                style={{ ...shellStyle, ...stateSurface }}
            >
                {anyFailed && <div className="absolute inset-0 bg-red-500/10 stt-pulse-red" />}
                {anyReconnecting && !anyFailed && <div className="absolute inset-0 bg-amber-500/10 stt-pulse-amber" />}

                <div className={isCompactStrip ? 'w-fit mx-auto pt-1 pb-1 px-3' : isProV2 ? 'w-fit max-w-full mx-auto px-4 py-2' : 'w-[90%] mx-auto pt-2 pb-1'}>

                    {/* ── Normal transcript pill ── */}
                    {isNormal && (
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={displayText || 'empty'}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
                                className={`flex items-center gap-2 min-h-[28px] ${isProV2 ? 'max-w-[min(72vw,760px)]' : ''}`}
                            >
                                {/* Status dot: green+pulse when waiting, grey when AI responded */}
                                <motion.span
                                    animate={{
                                        backgroundColor: aiHasResponded
                                            ? 'rgba(148, 163, 184, 0.6)'   // slate-400/60 — answered
                                            : 'rgba(52, 211, 153, 0.85)',   // emerald-400/85 — waiting
                                        scale: aiHasResponded ? 1 : [1, 1.35, 1],
                                        opacity: aiHasResponded ? 0.55 : 1,
                                    }}
                                    transition={
                                        aiHasResponded
                                            ? { duration: 0.6, ease: [0.4, 0, 0.2, 1] }
                                            : { scale: { repeat: Infinity, duration: 1.1, ease: 'easeInOut' }, backgroundColor: { duration: 0.6 } }
                                    }
                                    style={{
                                        display: 'inline-block',
                                        width: 7,
                                        height: 7,
                                        borderRadius: '50%',
                                        flexShrink: 0,
                                    }}
                                />

                                {/* Sentence text */}
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                    {trimmedSpeakerLabel ? (
                                        <span className={`inline-flex max-w-[40%] items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${speakerToneClass}`}>
                                            {trimmedSpeakerLabel}
                                        </span>
                                    ) : null}
                                    {quoted ? (
                                        <span
                                            className={`min-w-0 flex-1 overflow-hidden text-[13px] italic leading-snug ${isProV2 ? 'whitespace-nowrap text-ellipsis' : 'whitespace-nowrap text-ellipsis'}`}
                                            style={{
                                                color: aiHasResponded
                                                    ? 'var(--overlay-text-muted)'
                                                    : 'var(--overlay-text-primary)',
                                                transition: 'color 0.5s ease',
                                                maxWidth: '100%',
                                            }}
                                            title={displayText}
                                        >
                                            {quoted}
                                        </span>
                                    ) : (
                                        <span className="text-[13px] italic leading-snug text-[var(--overlay-text-muted)] opacity-40">
                                            Listening…
                                        </span>
                                    )}
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    )}

                    {/* Reconnecting state */}
                    {anyReconnecting && !anyFailed && (
                        <span className="flex items-center justify-center w-full text-[12px] leading-7 stt-state-enter">
                            <span className="text-amber-400/70 font-medium tracking-wide">
                                Reconnecting
                            </span>
                        </span>
                    )}
                </div>

                {/* Error chips row */}
                {(anyFailed || anyReconnecting) && (
                    <div className="relative w-[90%] mx-auto">
                        <span className="flex items-center justify-center w-full text-[12px] leading-7 pl-3 stt-state-enter gap-3">
                            {intStatus === 'failed' && intErrorCategory && (
                                <span className="flex items-center gap-1.5 text-red-400 font-medium tracking-wide truncate max-w-[44%]">
                                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                        <line x1="23" y1="9" x2="17" y2="15"/>
                                        <line x1="17" y1="9" x2="23" y2="15"/>
                                    </svg>
                                    System: {intErrorCategory.title}
                                </span>
                            )}

                            {intStatus === 'failed' && micStatus === 'failed' && (
                                <span className="text-red-400/40 font-light">/</span>
                            )}

                            {micStatus === 'failed' && micErrorCategory && (
                                <span className="flex items-center gap-1.5 text-red-400 font-medium tracking-wide truncate max-w-[44%]">
                                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                        <line x1="12" y1="19" x2="12" y2="22"/>
                                    </svg>
                                    Mic: {micErrorCategory.title}
                                </span>
                            )}

                            <button
                                aria-label={expanded ? 'Collapse error details' : 'Expand error details'}
                                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setExpanded(!expanded);
                                    }
                                }}
                                className="absolute right-1 flex items-center justify-center w-6 h-6 rounded-md text-red-400/70 hover:text-red-400 hover:bg-red-500/[0.12] transition-all duration-200 flex-shrink-0"
                            >
                                <svg
                                    className={`w-3 h-3 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="6 9 12 15 18 9" />
                                </svg>
                            </button>
                        </span>
                    </div>
                )}
            </div>

            {/* Expanded diagnostics panel */}
            {expanded && (
                <motion.div
                    initial={{ opacity: 0, height: 0, scale: 0.98 }}
                    animate={{ opacity: 1, height: 'auto', scale: 1 }}
                    exit={{ opacity: 0, height: 0, scale: 0.98 }}
                    transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    className="mt-4 mb-6 w-[92%] mx-auto overflow-hidden"
                >
                    <div className="relative rounded-2xl overflow-hidden backdrop-blur-xl border border-white/10 shadow-lg shadow-black/10">
                        <div className="absolute inset-0 bg-gradient-to-br from-white/3 via-transparent to-white/2 pointer-events-none" />
                        <div className="relative p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="relative flex items-center justify-center w-5 h-5">
                                        <div className={`absolute inset-0 rounded-full ${
                                            anyFailed ? 'bg-red-500/20 animate-pulse' : anyReconnecting ? 'bg-amber-500/20' : 'bg-sky-500/20'
                                        }`} />
                                        <div className={`w-2 h-2 rounded-full ${
                                            anyFailed ? 'bg-red-400' : anyReconnecting ? 'bg-amber-400' : 'bg-sky-400'
                                        }`} />
                                    </div>
                                    <span className="text-[11px] font-semibold tracking-[0.08em] uppercase overlay-text-muted">
                                        Audio Diagnostics
                                    </span>
                                </div>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                    anyFailed ? 'bg-red-500/20 text-red-400/80' : anyReconnecting ? 'bg-amber-500/20 text-amber-400/80' : 'bg-sky-500/20 text-sky-400/80'
                                }`}>
                                    {anyFailed ? 'Issues Detected' : anyReconnecting ? 'Reconnecting' : 'Healthy'}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                                <ChannelCard
                                    name="System Audio"
                                    status={intStatus}
                                    provider={intProvider}
                                    error={intError}
                                    errorCategory={intErrorCategory}
                                    iconConnected={
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                                        </svg>
                                    }
                                    iconReconnecting={
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                        </svg>
                                    }
                                    iconFailed={
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                            <line x1="23" y1="9" x2="17" y2="15"/>
                                            <line x1="17" y1="9" x2="23" y2="15"/>
                                        </svg>
                                    }
                                />
                                <ChannelCard
                                    name="Microphone"
                                    status={micStatus}
                                    provider={micProvider}
                                    error={micError}
                                    errorCategory={micErrorCategory}
                                    iconConnected={
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12"/>
                                        </svg>
                                    }
                                    iconReconnecting={
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                        </svg>
                                    }
                                    iconFailed={
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <line x1="1" y1="1" x2="23" y2="23"/>
                                            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                                            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                                            <line x1="12" y1="19" x2="12" y2="22"/>
                                            <line x1="8" y1="23" x2="16" y2="23"/>
                                        </svg>
                                    }
                                />
                            </div>

                            {onCopyDiagnostics && (
                                <div className="flex items-center justify-center pt-2 border-t border-white/5">
                                    <button
                                        onClick={handleCopy}
                                        aria-label="Copy STT error details"
                                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold tracking-wide transition-all duration-200 interaction-press ${
                                            copied
                                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                : 'bg-white/5 hover:bg-white/10 overlay-text-secondary hover:overlay-text-primary border border-white/5 hover:border-white/15'
                                        }`}
                                    >
                                        {copied ? (
                                            <>
                                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                                <span>Copied</span>
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                </svg>
                                                <span>Copy Report</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
};

export default RollingTranscript;
