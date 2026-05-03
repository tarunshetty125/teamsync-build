/**
 * ProContextBar — "PRO CONTEXT ACTIVE" bottom bar for the overlay.
 *
 * Shows dynamic chips derived from the user's profile + JD:
 *   • Company · Role  (gray, from activeJD)
 *   • Resume loaded   (amber, highlighted)
 *   • X YOE · Domain  (gray, from experience)
 *   • Negotiation toggle (amber, inline with the other context chips)
 *
 * Animation: staggered chip entrance using Emil Kowalski's design principles:
 *   - ease-out (cubic-bezier(0.23, 1, 0.32, 1)) for entry
 *   - 40ms stagger between chips
 *   - scale(0.95) + opacity start (never scale(0))
 *   - Under 300ms total per chip
 */
import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ───────────────────────────────────────────────────────────────────

type ChipColor = 'lavender' | 'green' | 'gold' | 'amber';

interface ProContextChip {
    label: string;
    color: ChipColor;
}

const CHIP_COLORS: Record<ChipColor, { bg: string; text: string; border: string }> = {
    lavender: {
        bg: 'rgba(167, 139, 250, 0.12)',
        text: '#A78BFA',
        border: '1px solid rgba(167, 139, 250, 0.25)',
    },
    green: {
        bg: 'rgba(34, 197, 94, 0.12)',
        text: '#22C55E',
        border: '1px solid rgba(34, 197, 94, 0.25)',
    },
    gold: {
        bg: 'rgba(234, 179, 8, 0.12)',
        text: '#EAB308',
        border: '1px solid rgba(234, 179, 8, 0.25)',
    },
    amber: {
        bg: 'rgba(245, 158, 11, 0.18)',
        text: '#F59E0B',
        border: '1px solid rgba(245, 158, 11, 0.35)',
    },
};

interface ProfileData {
    hasActiveJD?: boolean;
    activeJD?: {
        company?: string;
        title?: string;
        level?: string;
        technologies?: string[];
    };
    experienceCount?: number;
    skills?: string[];
    identity?: {
        name?: string;
        email?: string;
    };
    // Domain inferred from top skill or title
    domain?: string;
}

interface ProContextBarProps {
    /** Whether the profile intelligence mode is active */
    profileModeEnabled: boolean;
    /** Whether live negotiation context is enabled */
    negotiationEnabled?: boolean;
    /** Whether a negotiation script exists and can be toggled into context */
    hasNegotiationScript?: boolean;
    /** Whether the negotiation toggle is updating */
    negotiationLoading?: boolean;
    /** Toggle live negotiation context in the orchestrator */
    onToggleNegotiation?: (enabled: boolean) => void;
}

// ─── Animation Constants (Emil's principles) ─────────────────────────────────

const CHIP_TRANSITION = {
    duration: 0.22,
    ease: [0.23, 1, 0.32, 1] as any, // Strong ease-out
};

const chipVariants = {
    hidden: {
        opacity: 0,
        scale: 0.95,
        y: 4,
    },
    visible: (i: number) => ({
        opacity: 1,
        scale: 1,
        y: 0,
        transition: {
            ...CHIP_TRANSITION,
            delay: i * 0.04, // 40ms stagger
        },
    }),
    exit: {
        opacity: 0,
        scale: 0.95,
        transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] as any },
    },
};

const barVariants = {
    hidden: { opacity: 0, y: 6 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.25,
            ease: [0.23, 1, 0.32, 1] as any,
        },
    },
    exit: {
        opacity: 0,
        y: 6,
        transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] as any },
    },
};

// ─── Component ───────────────────────────────────────────────────────────────

const ProContextBar: React.FC<ProContextBarProps> = ({
    profileModeEnabled,
    negotiationEnabled = false,
    hasNegotiationScript = false,
    negotiationLoading = false,
    onToggleNegotiation,
}) => {
    const [profileData, setProfileData] = useState<ProfileData | null>(null);

    // Fetch profile data on mount and when profile mode changes
    useEffect(() => {
        if (!profileModeEnabled) return;

        let mounted = true;

        const fetchProfile = async () => {
            try {
                const data = await window.electronAPI?.profileGetProfile?.();
                if (mounted && data) {
                    setProfileData(data);
                }
            } catch {
                // Silent — fallback chips will render
            }
        };

        void fetchProfile();

        // Re-fetch when profile updates
        const unsub = (window.electronAPI as any)?.onProfileUpdated?.(() => {
            void fetchProfile();
        });

        return () => {
            mounted = false;
            unsub?.();
        };
    }, [profileModeEnabled]);

    // Build dynamic chips from profile data, with fallback defaults
    const chips = useMemo<ProContextChip[]>(() => {
        const result: ProContextChip[] = [];

        // Chip 1: Company · Role (lavender) — truncated to fit single line
        if (profileData?.hasActiveJD && profileData.activeJD) {
            const company = profileData.activeJD.company?.trim();
            const title = profileData.activeJD.title?.trim();
            if (company && title) {
                // Shorten: "Stripe · Sr. Backend" instead of "Stripe · Senior Backend Engineer"
                const shortTitle = title.length > 15 ? title.slice(0, 14) + '…' : title;
                result.push({ label: `${company} · ${shortTitle}`, color: 'lavender' });
            } else if (company) {
                result.push({ label: company, color: 'lavender' });
            }
        }

        // Chip 2: Resume loaded (green)
        result.push({ label: 'Resume loaded', color: 'green' });

        // Chip 3: X YOE · Domain (gold)
        if (profileData?.experienceCount && profileData.experienceCount > 0) {
            let domain = '';
            if (profileData.activeJD?.technologies?.length) {
                domain = profileData.activeJD.technologies[0];
            } else if (profileData.skills?.length) {
                domain = profileData.skills[0];
            }
            const label = domain
                ? `${profileData.experienceCount} YOE · ${domain}`
                : `${profileData.experienceCount} YOE`;
            result.push({ label, color: 'gold' });
        }

        return result;
    }, [profileData]);

    // Don't render when profile mode is off
    if (!profileModeEnabled) return null;

    return (
        <AnimatePresence>
            <motion.div
                key="pro-context-bar"
                variants={barVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="w-full no-drag draggable-area"
                style={{
                    background: 'rgba(5, 5, 5, 0.75)',
                    border: '1px solid rgba(255, 255, 255, 0.04)',
                    borderRadius: '16px',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25), inset 0 1px rgba(255,255,255,0.03)',
                    padding: '12px 16px',
                    backdropFilter: 'blur(20px) saturate(140%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(140%)',
                }}
            >
                <div
                    className="mb-2"
                    style={{
                        fontSize: '10px',
                        letterSpacing: '0.12em',
                        color: '#F59E0B',
                        fontWeight: 600,
                        textTransform: 'uppercase' as const,
                    }}
                >
                    PRO CONTEXT ACTIVE
                </div>

                {/* Chips — staggered entry */}
                <div className="flex flex-nowrap items-center gap-1.5 overflow-hidden">
                    <AnimatePresence mode="popLayout">
                        {chips.map((chip, i) => (
                            <motion.span
                                key={chip.label}
                                custom={i}
                                variants={chipVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                layout
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    background: CHIP_COLORS[chip.color].bg,
                                    padding: '4px 10px',
                                    borderRadius: '999px',
                                    fontSize: '11px',
                                    color: CHIP_COLORS[chip.color].text,
                                    fontWeight: 500,
                                    border: CHIP_COLORS[chip.color].border,
                                    cursor: 'default',
                                    whiteSpace: 'nowrap',
                                    flexShrink: chip.color === 'lavender' ? 1 : 0,
                                    minWidth: 0,
                                    maxWidth: chip.color === 'lavender' ? '280px' : undefined,
                                    overflow: chip.color === 'lavender' ? 'hidden' : undefined,
                                    textOverflow: chip.color === 'lavender' ? 'ellipsis' : undefined,
                                }}
                            >
                                {chip.label}
                            </motion.span>
                        ))}
                        {hasNegotiationScript && (
                            <motion.button
                                key="negotiation-toggle"
                                type="button"
                                custom={chips.length}
                                variants={chipVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                layout
                                disabled={negotiationLoading || !onToggleNegotiation}
                                onClick={() => onToggleNegotiation?.(!negotiationEnabled)}
                                className="no-drag transition-all disabled:cursor-wait disabled:opacity-60"
                                aria-pressed={negotiationEnabled}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '8px',
                                    minWidth: '118px',
                                    background: negotiationEnabled ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.14)',
                                    padding: '4px 8px 4px 10px',
                                    borderRadius: '999px',
                                    fontSize: '11px',
                                    color: negotiationEnabled ? '#D1FAE5' : '#FCA5A5',
                                    fontWeight: 600,
                                    border: negotiationEnabled ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(239, 68, 68, 0.3)',
                                    boxShadow: negotiationEnabled ? 'inset 0 1px 0 rgba(255,255,255,0.05), 0 6px 18px rgba(16,185,129,0.12)' : 'inset 0 1px 0 rgba(255,255,255,0.03), 0 6px 18px rgba(239,68,68,0.08)',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                }}
                            >
                                <span style={{ letterSpacing: '0.01em' }}>
                                    {negotiationLoading ? 'Updating negotiation' : 'Negotiation'}
                                </span>
                                <span
                                    aria-hidden="true"
                                    style={{
                                        position: 'relative',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        width: '28px',
                                        height: '18px',
                                        borderRadius: '999px',
                                        background: negotiationEnabled ? '#1FD39A' : '#EF4444',
                                        border: negotiationEnabled ? '1px solid rgba(31, 211, 154, 0.6)' : '1px solid rgba(248, 113, 113, 0.55)',
                                        transition: 'background 180ms ease, border-color 180ms ease',
                                        flexShrink: 0,
                                    }}
                                >
                                    <span
                                        style={{
                                            position: 'absolute',
                                            top: '1px',
                                            left: negotiationEnabled ? '11px' : '1px',
                                            width: '14px',
                                            height: '14px',
                                            borderRadius: '999px',
                                            background: '#050505',
                                            boxShadow: '0 1px 4px rgba(0,0,0,0.28)',
                                            transition: 'left 180ms cubic-bezier(0.23, 1, 0.32, 1)',
                                        }}
                                    />
                                </span>
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

export default ProContextBar;
