// src/components/ui/TimelineSignalCard.tsx
// Phase 7: Grouped timeline signal visualization for team meeting intelligence.
// Animate ONLY group entry. Nested items appear instantly. No busy motion.

import React, { useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimelineSignalItem {
    readonly text: string;
    readonly detail?: string;
}

export interface TimelineSignalGroup {
    readonly type: 'decision' | 'ownership' | 'blocker' | 'deadline' | 'action';
    readonly label: string;
    readonly items: readonly TimelineSignalItem[];
}

interface TimelineSignalCardProps {
    readonly groups: readonly TimelineSignalGroup[];
    readonly isLightTheme: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUP_COLORS: Record<TimelineSignalGroup['type'], string> = {
    decision: '34, 197, 94',
    ownership: '59, 130, 246',
    blocker: '239, 68, 68',
    deadline: '245, 158, 11',
    action: '167, 139, 250',
};

const GROUP_ENTRY = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.24, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] },
};

const COLLAPSE_TRANSITION = {
    duration: 0.2,
    ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
};

// ---------------------------------------------------------------------------
// CollapsibleGroup (internal)
// ---------------------------------------------------------------------------

const CollapsibleGroup = memo<{
    group: TimelineSignalGroup;
    isLightTheme: boolean;
}>(function CollapsibleGroup({ group, isLightTheme }) {
    const [isOpen, setIsOpen] = useState(true);
    const toggle = useCallback(() => setIsOpen((p) => !p), []);

    const rgb = GROUP_COLORS[group.type] || '156, 163, 175';
    const borderColor = `rgba(${rgb}, ${isLightTheme ? '0.20' : '0.30'})`;
    const labelColor = `rgba(${rgb}, ${isLightTheme ? '0.85' : '1'})`;
    const textColor = isLightTheme
        ? 'rgba(55, 65, 81, 0.85)'
        : 'rgba(255, 255, 255, 0.65)';
    const detailColor = isLightTheme
        ? 'rgba(107, 114, 128, 0.80)'
        : 'rgba(255, 255, 255, 0.40)';

    return (
        <motion.div
            {...GROUP_ENTRY}
            style={{
                borderLeft: `2px solid ${borderColor}`,
                paddingLeft: '12px',
                paddingTop: '4px',
                paddingBottom: '4px',
            }}
        >
            {/* Group header — clickable to collapse */}
            <button
                onClick={toggle}
                className="flex items-center gap-1.5 w-full cursor-pointer select-none"
                style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                }}
            >
                <span
                    style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: labelColor,
                        lineHeight: 1.2,
                    }}
                >
                    {group.label}
                </span>
                <ChevronDown
                    style={{
                        width: '10px',
                        height: '10px',
                        color: detailColor,
                        transition: 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)',
                        transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    }}
                />
            </button>

            {/* Items — no individual animation, appear instantly */}
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={COLLAPSE_TRANSITION}
                        style={{ overflow: 'hidden' }}
                    >
                        <div style={{ paddingTop: '4px' }}>
                            {group.items.map((item, i) => (
                                <div key={i} style={{ paddingBottom: '3px' }}>
                                    <div
                                        style={{
                                            fontSize: '12px',
                                            lineHeight: '1.5',
                                            color: textColor,
                                        }}
                                    >
                                        <span style={{ color: detailColor, marginRight: '6px' }}>
                                            ●
                                        </span>
                                        {item.text}
                                    </div>
                                    {item.detail && (
                                        <div
                                            style={{
                                                fontSize: '11px',
                                                lineHeight: '1.4',
                                                color: detailColor,
                                                fontStyle: 'italic',
                                                paddingLeft: '16px',
                                            }}
                                        >
                                            {item.detail}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
});

// ---------------------------------------------------------------------------
// TimelineSignalCard
// ---------------------------------------------------------------------------

export const TimelineSignalCard = memo<TimelineSignalCardProps>(
    function TimelineSignalCard({ groups, isLightTheme }) {
        if (groups.length === 0) return null;

        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                }}
            >
                {groups.map((group, i) => (
                    <CollapsibleGroup
                        key={`${group.type}-${i}`}
                        group={group}
                        isLightTheme={isLightTheme}
                    />
                ))}
            </div>
        );
    },
);
