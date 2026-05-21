// src/components/ui/ExplainabilityDrawer.tsx
// Phase 7: Expandable "Why this?" micro-panel inside the intelligence footer.
// Collapsed = zero DOM. Expanded = framer-motion height animation.

import React, { useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExplainabilityDrawerProps {
    readonly signals: readonly { readonly label: string }[];
    readonly memoryCount: number;
    readonly confidencePercent: number;
    readonly confidenceTier: 'high' | 'moderate' | 'low';
    readonly isLightTheme: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_LABEL: Record<string, string> = {
    high: 'Confident',
    moderate: 'Moderate',
    low: 'Early signal',
};

const EXPAND_TRANSITION = {
    duration: 0.2,
    ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
};

// ---------------------------------------------------------------------------
// ExplainabilityDrawer
// ---------------------------------------------------------------------------

export const ExplainabilityDrawer = memo<ExplainabilityDrawerProps>(
    function ExplainabilityDrawer({
        signals,
        memoryCount,
        confidencePercent,
        confidenceTier,
        isLightTheme,
    }) {
        const [isOpen, setIsOpen] = useState(false);

        const toggle = useCallback(() => {
            setIsOpen((prev) => !prev);
        }, []);

        const mutedColor = isLightTheme
            ? 'rgba(107, 114, 128, 0.90)'
            : 'rgba(255, 255, 255, 0.45)';
        const secondaryColor = isLightTheme
            ? 'rgba(55, 65, 81, 0.85)'
            : 'rgba(255, 255, 255, 0.65)';
        const separatorBg = isLightTheme
            ? 'linear-gradient(90deg, transparent, rgba(0,0,0,0.05), transparent)'
            : 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)';

        return (
            <div>
                {/* Toggle trigger — always rendered */}
                <button
                    onClick={toggle}
                    className="flex items-center gap-1 cursor-pointer select-none transition-colors duration-150"
                    style={{
                        fontSize: '11px',
                        fontWeight: 500,
                        color: mutedColor,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                    }}
                    onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.color = secondaryColor;
                    }}
                    onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.color = mutedColor;
                    }}
                >
                    <span>Why this response?</span>
                    <span
                        style={{
                            display: 'inline-block',
                            fontSize: '9px',
                            transition: 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)',
                            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                    >
                        ▾
                    </span>
                </button>

                {/* Expandable content — zero DOM when collapsed */}
                <AnimatePresence initial={false}>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={EXPAND_TRANSITION}
                            style={{ overflow: 'hidden' }}
                        >
                            <div style={{ paddingTop: '8px' }}>
                                {/* Signal list */}
                                {signals.length > 0 && (
                                    <ul
                                        style={{
                                            listStyle: 'none',
                                            margin: 0,
                                            padding: '0 0 0 2px',
                                        }}
                                    >
                                        {signals.map((signal, i) => (
                                            <li
                                                key={i}
                                                style={{
                                                    fontSize: '11px',
                                                    lineHeight: '1.5',
                                                    color: secondaryColor,
                                                    paddingBottom: '2px',
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        color: mutedColor,
                                                        marginRight: '6px',
                                                    }}
                                                >
                                                    •
                                                </span>
                                                {signal.label}
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                {/* Thin gradient separator */}
                                <div
                                    style={{
                                        height: '1px',
                                        background: separatorBg,
                                        margin: '6px 0',
                                    }}
                                />

                                {/* Metadata */}
                                <div
                                    style={{
                                        fontSize: '10px',
                                        lineHeight: '1.6',
                                        color: mutedColor,
                                    }}
                                >
                                    {memoryCount > 0 && (
                                        <div>
                                            Context: {memoryCount}{' '}
                                            {memoryCount === 1
                                                ? 'memory'
                                                : 'memories'}{' '}
                                            used
                                        </div>
                                    )}
                                    <div>
                                        Confidence: {confidencePercent}% ·{' '}
                                        {TIER_LABEL[confidenceTier] ?? 'Unknown'}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        );
    },
);
