// src/components/ui/PremiumStates.tsx
// Phase 7: Premium empty, loading, and error states.
// Replaces basic bouncing dots with polished, mode-aware states.
// GPU-only CSS animations. No framer-motion (simple states).

import React, { memo, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
// EmptyListeningState
// ---------------------------------------------------------------------------

interface EmptyListeningStateProps {
    readonly modeLabel?: string;
    readonly isLightTheme: boolean;
}

export const EmptyListeningState = memo<EmptyListeningStateProps>(
    function EmptyListeningState({ modeLabel, isLightTheme }) {
        const textColor = isLightTheme
            ? 'rgba(107, 114, 128, 0.80)'
            : 'rgba(255, 255, 255, 0.45)';

        const label = modeLabel
            ? `Listening for ${modeLabel} signals\u2026`
            : 'Listening for signals\u2026';

        return (
            <div
                className="flex items-center justify-center gap-2.5 py-4"
                style={{ contain: 'layout paint' }}
            >
                {/* Pulsing orb */}
                <div
                    className="intel-animate"
                    style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: isLightTheme
                            ? 'rgba(107, 114, 128, 0.40)'
                            : 'rgba(255, 255, 255, 0.35)',
                        animation: 'intel-pulse 2s ease-in-out infinite',
                    }}
                />
                <span
                    style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        letterSpacing: '0.03em',
                        color: textColor,
                    }}
                >
                    {label}
                </span>
            </div>
        );
    },
);

// ---------------------------------------------------------------------------
// SkeletonLoader
// ---------------------------------------------------------------------------

interface SkeletonLoaderProps {
    readonly isLightTheme: boolean;
}

const SKELETON_WIDTHS = ['100%', '85%', '60%'] as const;

export const SkeletonLoader = memo<SkeletonLoaderProps>(
    function SkeletonLoader({ isLightTheme }) {
        const barBg = isLightTheme
            ? 'linear-gradient(90deg, rgba(0,0,0,0.03), rgba(0,0,0,0.06), rgba(0,0,0,0.03))'
            : 'linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,255,255,0.06), rgba(255,255,255,0.03))';

        const containerBg = isLightTheme
            ? 'rgba(255, 255, 255, 0.6)'
            : 'rgba(255, 255, 255, 0.03)';

        const containerBorder = isLightTheme
            ? '1px solid rgba(0, 0, 0, 0.04)'
            : '1px solid rgba(255, 255, 255, 0.05)';

        return (
            <div
                className="rounded-2xl overflow-hidden"
                style={{
                    background: containerBg,
                    border: containerBorder,
                    padding: '16px',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    contain: 'layout paint',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {SKELETON_WIDTHS.map((width, i) => (
                        <div
                            key={i}
                            className="intel-animate"
                            style={{
                                width,
                                height: '10px',
                                borderRadius: '999px',
                                background: barBg,
                                backgroundSize: '200% 100%',
                                animation: 'skeleton-shimmer 1.8s linear infinite',
                                animationDelay: `${i * 150}ms`,
                            }}
                        />
                    ))}
                </div>
            </div>
        );
    },
);

// ---------------------------------------------------------------------------
// ErrorFallback
// ---------------------------------------------------------------------------

interface ErrorFallbackProps {
    readonly onRetry?: () => void;
    readonly isLightTheme: boolean;
}

export const ErrorFallback = memo<ErrorFallbackProps>(
    function ErrorFallback({ onRetry, isLightTheme }) {
        const mutedColor = isLightTheme
            ? 'rgba(107, 114, 128, 0.70)'
            : 'rgba(255, 255, 255, 0.40)';

        const handleRetry = useCallback(() => {
            onRetry?.();
        }, [onRetry]);

        return (
            <div
                className="flex items-center gap-2 py-3 px-1"
                style={{ contain: 'layout paint' }}
            >
                <AlertCircle
                    style={{
                        width: '14px',
                        height: '14px',
                        color: mutedColor,
                        flexShrink: 0,
                    }}
                />
                <span
                    style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        color: mutedColor,
                    }}
                >
                    Something went wrong
                </span>
                {onRetry && (
                    <button
                        onClick={handleRetry}
                        className="cursor-pointer select-none"
                        style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: isLightTheme
                                ? 'rgba(59, 130, 246, 0.80)'
                                : 'rgba(96, 165, 250, 0.70)',
                            background: isLightTheme
                                ? 'rgba(59, 130, 246, 0.06)'
                                : 'rgba(96, 165, 250, 0.08)',
                            border: `1px solid ${isLightTheme
                                ? 'rgba(59, 130, 246, 0.10)'
                                : 'rgba(96, 165, 250, 0.12)'
                            }`,
                            borderRadius: '999px',
                            padding: '3px 10px',
                            cursor: 'pointer',
                            transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1)',
                        }}
                        onMouseDown={(e) => {
                            (e.currentTarget as HTMLElement).style.transform = 'scale(0.97)';
                        }}
                        onMouseUp={(e) => {
                            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                        }}
                        onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                        }}
                    >
                        Retry
                    </button>
                )}
            </div>
        );
    },
);
