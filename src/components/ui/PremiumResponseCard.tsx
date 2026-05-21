// src/components/ui/PremiumResponseCard.tsx
// Phase 7: Extracted premium AI response card.
// Identical rendering when intelligence metadata absent.
// No hard separators — soft spacing rhythm only.
// Intelligence footer: collapsed by default, zero DOM when collapsed.

import React, { useState, useCallback, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import { ConfidenceChip, SignalChip } from './ConfidenceChip';
import { ExplainabilityDrawer } from './ExplainabilityDrawer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Intelligence metadata optionally attached to system messages */
export interface IntelligenceMetadata {
    readonly confidenceTier?: 'high' | 'moderate' | 'low';
    readonly confidencePercent?: number;
    readonly signalCount?: number;
    readonly signals?: readonly { readonly label: string }[];
    readonly memoryCount?: number;
}

interface ResponseChip {
    readonly label: string;
    readonly variant: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';
}

interface PremiumResponseCardMessage {
    readonly id: string;
    readonly text: string;
    readonly source?: string;
    readonly isStreaming?: boolean;
    readonly chips?: readonly ResponseChip[];
    readonly intelligenceMetadata?: IntelligenceMetadata;
}

interface PremiumResponseCardProps {
    readonly message: PremiumResponseCardMessage;
    readonly isLightTheme: boolean;
    readonly sourceIconMap: Record<string, string>;
    readonly renderMessageText: (msg: any) => React.ReactNode;
    readonly onCopy?: () => void;
}

// ---------------------------------------------------------------------------
// Accent color mapping (preserved from original inline card)
// ---------------------------------------------------------------------------

const ACCENT_MAP: Record<string, [string, string]> = {
    'What to Answer': ['16,185,129', '#34D399'],
    'Clarify': ['245,158,11', '#FCD34D'],
    'Follow Up': ['6,182,212', '#67E8F9'],
    'Follow Up Questions': ['168,85,247', '#C4B5FD'],
    'Recap': ['99,102,241', '#A5B4FC'],
    'Code Hint': ['139,92,246', '#C4B5FD'],
    'Brainstorm': ['244,114,182', '#FBCFE8'],
    'Screen Scan': ['251,146,60', '#FDBA74'],
    'System Design Trade-offs': ['16,185,129', '#34D399'],
    'Answer Now': ['99,102,241', '#A5B4FC'],
    'Manual Input': ['148,163,184', '#CBD5E1'],
};

const DEFAULT_ACCENT: [string, string] = ['255,255,255', 'rgba(255,255,255,0.6)'];

// ---------------------------------------------------------------------------
// Chip variant styles
// ---------------------------------------------------------------------------

const CHIP_STYLES: Record<string, { bg: string; color: string; border: string }> = {
    green: { bg: 'rgba(34,197,94,0.10)', color: '#4ADE80', border: '1px solid rgba(34,197,94,0.20)' },
    amber: { bg: 'rgba(245,158,11,0.10)', color: '#FCD34D', border: '1px solid rgba(245,158,11,0.22)' },
    red: { bg: 'rgba(239,68,68,0.10)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.20)' },
    blue: { bg: 'rgba(59,130,246,0.10)', color: '#93C5FD', border: '1px solid rgba(59,130,246,0.20)' },
    purple: { bg: 'rgba(167,139,250,0.10)', color: '#C4B5FD', border: '1px solid rgba(167,139,250,0.20)' },
    gray: { bg: 'rgba(255,255,255,0.05)', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.08)' },
};

const CHIP_STYLES_LIGHT: Record<string, { bg: string; color: string; border: string }> = {
    green: { bg: 'rgba(34,197,94,0.08)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.15)' },
    amber: { bg: 'rgba(245,158,11,0.08)', color: '#d97706', border: '1px solid rgba(245,158,11,0.15)' },
    red: { bg: 'rgba(239,68,68,0.08)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.15)' },
    blue: { bg: 'rgba(59,130,246,0.08)', color: '#2563eb', border: '1px solid rgba(59,130,246,0.15)' },
    purple: { bg: 'rgba(167,139,250,0.08)', color: '#7c3aed', border: '1px solid rgba(167,139,250,0.15)' },
    gray: { bg: 'rgba(0,0,0,0.03)', color: '#6b7280', border: '1px solid rgba(0,0,0,0.06)' },
};

// ---------------------------------------------------------------------------
// Internal CopyButton (preserved from original)
// ---------------------------------------------------------------------------

const CopyButton = memo<{
    text: string;
    isLightTheme: boolean;
    accentRgb: string;
    onCopy?: () => void;
}>(function CopyButton({ text, isLightTheme: lt, accentRgb, onCopy }) {
    const [copied, setCopied] = useState(false);

    const handleCopyClick = useCallback(() => {
        navigator.clipboard.writeText(text);
        onCopy?.();
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [text, onCopy]);

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
            <span className="text-[9px] font-medium tracking-wide">
                {copied ? 'Copied' : 'Copy'}
            </span>
        </button>
    );
});

// ---------------------------------------------------------------------------
// IntelligenceFooter (internal, lazy-rendered)
// ---------------------------------------------------------------------------

const IntelligenceFooter = memo<{
    metadata: IntelligenceMetadata;
    isLightTheme: boolean;
}>(function IntelligenceFooter({ metadata, isLightTheme }) {
    const {
        signalCount = 0,
        signals = [],
        memoryCount = 0,
        confidencePercent = 0,
        confidenceTier = 'low',
    } = metadata;

    if (signalCount === 0 && signals.length === 0) return null;

    const borderColor = isLightTheme
        ? 'rgba(0, 0, 0, 0.04)'
        : 'rgba(255, 255, 255, 0.04)';
    const mutedColor = isLightTheme
        ? 'rgba(107, 114, 128, 0.70)'
        : 'rgba(255, 255, 255, 0.40)';

    return (
        <div
            style={{
                borderTop: `1px solid ${borderColor}`,
                padding: '10px 16px 8px',
            }}
        >
            <div
                className="flex items-center justify-between"
                style={{ fontSize: '11px', color: mutedColor }}
            >
                {/* Signal count */}
                <span style={{ fontWeight: 500 }}>
                    {signalCount || signals.length} Signal{(signalCount || signals.length) !== 1 ? 's' : ''}
                </span>

                {/* Explainability drawer toggle */}
                {signals.length > 0 && (
                    <ExplainabilityDrawer
                        signals={signals}
                        memoryCount={memoryCount}
                        confidencePercent={confidencePercent}
                        confidenceTier={confidenceTier}
                        isLightTheme={isLightTheme}
                    />
                )}
            </div>
        </div>
    );
});

// ---------------------------------------------------------------------------
// PremiumResponseCard
// ---------------------------------------------------------------------------

export const PremiumResponseCard = memo<PremiumResponseCardProps>(
    function PremiumResponseCard({
        message: msg,
        isLightTheme,
        sourceIconMap,
        renderMessageText,
        onCopy,
    }) {
        const accentKey = msg.source || '';
        const [_rgb, _accentText] = ACCENT_MAP[accentKey] || DEFAULT_ACCENT;
        const _icon = sourceIconMap[accentKey] || '⚡';

        // Intelligence metadata
        const intel = msg.intelligenceMetadata;
        const hasIntel = intel != null && (
            (intel.signalCount ?? 0) > 0 ||
            (intel.signals?.length ?? 0) > 0
        );

        // Timestamp (relative)
        const timestamp = useMemo(() => {
            // Simplified — could be wired to msg.timestamp later
            return msg.isStreaming ? undefined : 'Just now';
        }, [msg.isStreaming]);

        const chipStyles = isLightTheme ? CHIP_STYLES_LIGHT : CHIP_STYLES;

        return (
            <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="w-full relative group rounded-2xl overflow-hidden"
                style={{
                    background: isLightTheme
                        ? `linear-gradient(180deg, rgba(255,255,255,0.88), rgba(${_rgb},0.03))`
                        : `linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))`,
                    border: isLightTheme
                        ? '1px solid rgba(0,0,0,0.06)'
                        : `1px solid rgba(255,255,255,0.08)`,
                    boxShadow: isLightTheme
                        ? '0 2px 16px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.9)'
                        : `0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)`,
                    backdropFilter: 'blur(18px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(18px) saturate(140%)',
                    contain: 'layout paint',
                }}
            >
                {/* Subtle radial accent glow */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background: `radial-gradient(ellipse at 15% -25%, rgba(${_rgb},${isLightTheme ? '0.04' : '0.07'}) 0%, transparent 55%)`,
                    }}
                />

                {/* ─── Header ─── */}
                {msg.source && (
                    <div className="flex items-center justify-between px-4 pt-3 pb-0 relative z-10">
                        <div className="flex items-center gap-2">
                            {/* Mode pill */}
                            <div
                                className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-full"
                                style={{
                                    background: isLightTheme ? `rgba(${_rgb},0.07)` : `rgba(${_rgb},0.10)`,
                                    border: `1px solid rgba(${_rgb},${isLightTheme ? '0.10' : '0.16'})`,
                                }}
                            >
                                <span className="text-[10px] leading-none">{_icon}</span>
                                <span
                                    className="text-[10px] font-bold tracking-[0.08em] uppercase leading-none"
                                    style={{ color: isLightTheme ? `rgb(${_rgb})` : _accentText }}
                                >
                                    {msg.source}
                                </span>
                            </div>

                            {/* Confidence chip — only when intelligence data present */}
                            {intel?.confidenceTier && (
                                <ConfidenceChip
                                    tier={intel.confidenceTier}
                                    isLightTheme={isLightTheme}
                                />
                            )}

                            {/* Streaming indicator */}
                            {msg.isStreaming && (
                                <div
                                    className="inline-flex items-center gap-1 px-1.5 py-[3px] rounded-full"
                                    style={{
                                        background: isLightTheme ? 'rgba(59,130,246,0.06)' : 'rgba(255,255,255,0.04)',
                                        border: `1px solid ${isLightTheme ? 'rgba(59,130,246,0.10)' : 'rgba(255,255,255,0.06)'}`,
                                    }}
                                >
                                    <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isLightTheme ? 'bg-blue-500' : 'bg-white/60'}`} />
                                    <span className={`text-[9px] font-bold tracking-wider uppercase ${isLightTheme ? 'text-blue-500' : 'text-white/40'}`}>Live</span>
                                </div>
                            )}

                            {/* Timestamp — subtle, after streaming completes */}
                            {timestamp && !msg.isStreaming && (
                                <span
                                    style={{
                                        fontSize: '10px',
                                        color: isLightTheme ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.25)',
                                        fontWeight: 400,
                                    }}
                                >
                                    {timestamp}
                                </span>
                            )}
                        </div>

                        {/* Copy button */}
                        {!msg.isStreaming && (
                            <CopyButton
                                text={msg.text}
                                isLightTheme={isLightTheme}
                                accentRgb={_rgb}
                                onCopy={onCopy}
                            />
                        )}
                    </div>
                )}

                {/* ─── Body ─── soft spacing, no separator */}
                <div
                    className={`px-4 ${msg.source ? 'pt-3' : 'pt-3.5'} pb-3 relative z-10`}
                    style={{
                        fontSize: '13.5px',
                        lineHeight: '1.68',
                        fontWeight: 420,
                        color: isLightTheme ? '#1f2937' : '#E5E7EB',
                        WebkitFontSmoothing: 'antialiased',
                    }}
                >
                    {/* Copy button for no-source cards */}
                    {!msg.source && !msg.isStreaming && (
                        <div className="absolute top-2 right-2 z-20">
                            <CopyButton
                                text={msg.text}
                                isLightTheme={isLightTheme}
                                accentRgb="255,255,255"
                                onCopy={onCopy}
                            />
                        </div>
                    )}
                    {renderMessageText(msg)}
                </div>

                {/* ─── Response Chips ─── soft spacing, no separator */}
                {!msg.isStreaming && msg.chips && msg.chips.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                        {msg.chips.map((chip, i) => {
                            const style = chipStyles[chip.variant] || chipStyles.gray;
                            return (
                                <span
                                    key={i}
                                    className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-tight cursor-default select-none intel-animate"
                                    style={{
                                        animationDelay: `${i * 60}ms`,
                                        animation: 'fadeInUp 0.22s cubic-bezier(0.23,1,0.32,1) both',
                                        backdropFilter: 'blur(8px)',
                                        background: style.bg,
                                        color: style.color,
                                        border: style.border,
                                    }}
                                >
                                    {chip.label}
                                </span>
                            );
                        })}
                    </div>
                )}

                {/* ─── Intelligence Footer ─── only when metadata present, collapsed by default */}
                {hasIntel && intel && !msg.isStreaming && (
                    <IntelligenceFooter
                        metadata={intel}
                        isLightTheme={isLightTheme}
                    />
                )}
            </motion.div>
        );
    },
);
