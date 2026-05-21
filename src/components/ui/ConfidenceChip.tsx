// src/components/ui/ConfidenceChip.tsx
// Phase 7: Premium confidence indicator chips.
// Tiny, glass-morphism pills that surface intelligence tier + signal metadata.
// GPU-only CSS animations. prefers-reduced-motion safe.

import React, { memo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfidenceChipProps {
    readonly tier: 'high' | 'moderate' | 'low';
    readonly isLightTheme: boolean;
}

interface SignalChipProps {
    readonly label: string;
    readonly isLightTheme: boolean;
    readonly animationDelay?: number;
}

// ---------------------------------------------------------------------------
// Color mapping
// ---------------------------------------------------------------------------

const TIER_CONFIG = {
    high: { label: 'Confident', rgb: '34, 197, 94' },
    moderate: { label: 'Moderate', rgb: '245, 158, 11' },
    low: { label: 'Early signal', rgb: '156, 163, 175' },
} as const;

// ---------------------------------------------------------------------------
// ConfidenceChip
// ---------------------------------------------------------------------------

export const ConfidenceChip = memo<ConfidenceChipProps>(function ConfidenceChip({
    tier,
    isLightTheme,
}) {
    const config = TIER_CONFIG[tier];
    const bgAlpha = isLightTheme ? '0.07' : '0.08';
    const borderAlpha = isLightTheme ? '0.12' : '0.14';
    const textAlpha = isLightTheme ? '0.85' : '1';

    return (
        <span
            className="inline-flex items-center px-2 py-[3px] rounded-full intel-animate"
            style={{
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                lineHeight: 1.2,
                background: `rgba(${config.rgb}, ${bgAlpha})`,
                border: `1px solid rgba(${config.rgb}, ${borderAlpha})`,
                color: `rgba(${config.rgb}, ${textAlpha})`,
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                animation: 'chip-enter 180ms cubic-bezier(0.23, 1, 0.32, 1) both',
            }}
        >
            {config.label}
        </span>
    );
});

// ---------------------------------------------------------------------------
// SignalChip
// ---------------------------------------------------------------------------

export const SignalChip = memo<SignalChipProps>(function SignalChip({
    label,
    isLightTheme,
    animationDelay = 0,
}) {
    const bgAlpha = isLightTheme ? '0.05' : '0.04';
    const borderAlpha = isLightTheme ? '0.07' : '0.06';

    return (
        <span
            className="inline-flex items-center px-2 py-[3px] rounded-full intel-animate"
            style={{
                fontSize: '10px',
                fontWeight: 500,
                letterSpacing: '0.04em',
                lineHeight: 1.2,
                background: isLightTheme
                    ? `rgba(0, 0, 0, ${bgAlpha})`
                    : `rgba(255, 255, 255, ${bgAlpha})`,
                border: `1px solid ${isLightTheme
                    ? `rgba(0, 0, 0, ${borderAlpha})`
                    : `rgba(255, 255, 255, ${borderAlpha})`
                }`,
                color: isLightTheme
                    ? 'rgba(0, 0, 0, 0.5)'
                    : 'rgba(255, 255, 255, 0.5)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                animation: 'chip-enter 180ms cubic-bezier(0.23, 1, 0.32, 1) both',
                animationDelay: `${animationDelay}ms`,
            }}
        >
            {label}
        </span>
    );
});
