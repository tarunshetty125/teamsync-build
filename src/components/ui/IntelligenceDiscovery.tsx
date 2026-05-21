// src/components/ui/IntelligenceDiscovery.tsx
// Phase 7: First-time intelligence feature discovery nudges.
// localStorage-only persistence. Small, dismissible, inline.
// Auto-dismiss after 15s. No annoying tours.

import React, { useState, useEffect, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasSeenDiscovery(key: string): boolean {
    try {
        return localStorage.getItem(key) === '1';
    } catch {
        return false;
    }
}

function markDiscoverySeen(key: string): void {
    try {
        localStorage.setItem(key, '1');
    } catch {
        // localStorage may be unavailable — silent
    }
}

// ---------------------------------------------------------------------------
// Animation constants
// ---------------------------------------------------------------------------

const NUDGE_ENTER = {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -2 },
    transition: { duration: 0.25, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] },
};

const AUTO_DISMISS_MS = 8_000;

// ---------------------------------------------------------------------------
// SignalDiscoveryNudge
// ---------------------------------------------------------------------------

interface SignalDiscoveryNudgeProps {
    readonly signalType: string;
    readonly signalLabel: string;
    readonly isLightTheme: boolean;
    readonly onDismiss?: () => void;
}

export const SignalDiscoveryNudge = memo<SignalDiscoveryNudgeProps>(
    function SignalDiscoveryNudge({ signalType, signalLabel, isLightTheme, onDismiss }) {
        const storageKey = `teamsync_discovery_seen_${signalType}`;
        const [visible, setVisible] = useState(() => !hasSeenDiscovery(storageKey));
        const [paused, setPaused] = useState(false);

        const dismiss = useCallback(() => {
            markDiscoverySeen(storageKey);
            setVisible(false);
            onDismiss?.();
        }, [storageKey, onDismiss]);

        // Auto-dismiss — pauses on hover
        useEffect(() => {
            if (!visible || paused) return;
            const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
            return () => clearTimeout(timer);
        }, [visible, paused, dismiss]);

        if (!visible) return null;

        const bg = isLightTheme ? 'rgba(0, 0, 0, 0.025)' : 'rgba(255, 255, 255, 0.03)';
        const border = isLightTheme ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)';
        const textColor = isLightTheme
            ? 'rgba(55, 65, 81, 0.80)'
            : 'rgba(255, 255, 255, 0.55)';
        const dismissColor = isLightTheme
            ? 'rgba(107, 114, 128, 0.50)'
            : 'rgba(255, 255, 255, 0.30)';

        return (
            <AnimatePresence>
                {visible && (
                    <motion.div
                        {...NUDGE_ENTER}
                        className="intel-animate"
                        onMouseEnter={() => setPaused(true)}
                        onMouseLeave={() => setPaused(false)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            background: bg,
                            border: `1px solid ${border}`,
                            fontSize: '11px',
                            lineHeight: 1.4,
                            color: textColor,
                        }}
                    >
                        <span>
                            ✨ AI detected {signalLabel} — Click to learn why
                        </span>
                        <button
                            onClick={dismiss}
                            className="cursor-pointer select-none flex-shrink-0"
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: '0 2px',
                                fontSize: '9px',
                                color: dismissColor,
                                cursor: 'pointer',
                                lineHeight: 1,
                            }}
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLElement).style.color = textColor;
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLElement).style.color = dismissColor;
                            }}
                            title="Dismiss"
                        >
                            ✕
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        );
    },
);

// ---------------------------------------------------------------------------
// ModeSuggestionNudge
// ---------------------------------------------------------------------------

interface ModeSuggestionNudgeProps {
    readonly suggestedMode: string;
    readonly isLightTheme: boolean;
    readonly onDismiss?: () => void;
    readonly onTryMode?: () => void;
}

export const ModeSuggestionNudge = memo<ModeSuggestionNudgeProps>(
    function ModeSuggestionNudge({ suggestedMode, isLightTheme, onDismiss, onTryMode }) {
        const storageKey = `teamsync_discovery_seen_mode_${suggestedMode}`;
        const [visible, setVisible] = useState(() => !hasSeenDiscovery(storageKey));
        const [paused, setPaused] = useState(false);

        const dismiss = useCallback(() => {
            markDiscoverySeen(storageKey);
            setVisible(false);
            onDismiss?.();
        }, [storageKey, onDismiss]);

        // Auto-dismiss — pauses on hover
        useEffect(() => {
            if (!visible || paused) return;
            const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
            return () => clearTimeout(timer);
        }, [visible, paused, dismiss]);

        const handleTryMode = useCallback(() => {
            onTryMode?.();
            dismiss();
        }, [onTryMode, dismiss]);

        if (!visible) return null;

        const bg = isLightTheme ? 'rgba(0, 0, 0, 0.025)' : 'rgba(255, 255, 255, 0.03)';
        const border = isLightTheme ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)';
        const textColor = isLightTheme
            ? 'rgba(55, 65, 81, 0.80)'
            : 'rgba(255, 255, 255, 0.55)';
        const linkColor = isLightTheme
            ? 'rgba(59, 130, 246, 0.85)'
            : 'rgba(96, 165, 250, 0.80)';
        const dismissColor = isLightTheme
            ? 'rgba(107, 114, 128, 0.50)'
            : 'rgba(255, 255, 255, 0.30)';

        return (
            <AnimatePresence>
                {visible && (
                    <motion.div
                        {...NUDGE_ENTER}
                        className="intel-animate"
                        onMouseEnter={() => setPaused(true)}
                        onMouseLeave={() => setPaused(false)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            background: bg,
                            border: `1px solid ${border}`,
                            fontSize: '11px',
                            lineHeight: 1.4,
                            color: textColor,
                        }}
                    >
                        <span>
                            💡{' '}
                            <span
                                onClick={handleTryMode}
                                className="cursor-pointer"
                                style={{ color: linkColor }}
                                onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLElement).style.opacity = '1';
                                }}
                                onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLElement).style.opacity = '0.85';
                                }}
                            >
                                Try {suggestedMode} Mode
                            </span>{' '}
                            for better analysis
                        </span>
                        <button
                            onClick={dismiss}
                            className="cursor-pointer select-none flex-shrink-0"
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: '0 2px',
                                fontSize: '9px',
                                color: dismissColor,
                                cursor: 'pointer',
                                lineHeight: 1,
                            }}
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLElement).style.color = textColor;
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLElement).style.color = dismissColor;
                            }}
                            title="Dismiss"
                        >
                            ✕
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        );
    },
);
