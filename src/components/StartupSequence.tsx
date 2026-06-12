import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import startupArtwork from '../assets/quietly-ai-startup.jpg';

interface StartupSequenceProps {
    onComplete: () => void;
    isReady: boolean;
}

type StartupPhase = 'enter' | 'resolved' | 'hold' | 'exit';

const MIN_STARTUP_DURATION_MS = 2050;
const RESOLVED_PHASE_MS = 80;
const HOLD_PHASE_MS = 1200;
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
const SOFT_EASE = [0.22, 1, 0.36, 1] as const;

const StartupSequence: React.FC<StartupSequenceProps> = ({ onComplete, isReady }) => {
    const [minDurationElapsed, setMinDurationElapsed] = useState(false);
    const [phase, setPhase] = useState<Exclude<StartupPhase, 'exit'>>('enter');
    const [artworkReady, setArtworkReady] = useState(false);
    const hasCompletedRef = useRef(false);
    const shouldReduceMotion = useReducedMotion();

    useEffect(() => {
        let isCancelled = false;
        const image = new Image();

        const markReady = () => {
            if (isCancelled) return;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!isCancelled) setArtworkReady(true);
                });
            });
        };

        if (typeof image.decode === 'function') {
            image.src = startupArtwork;
            image.decode().then(markReady).catch(markReady);
        } else {
            image.onload = markReady;
            image.onerror = markReady;
            image.src = startupArtwork;
        }

        return () => {
            isCancelled = true;
            image.onload = null;
            image.onerror = null;
        };
    }, []);

    useEffect(() => {
        const minTimer = setTimeout(() => {
            setMinDurationElapsed(true);
        }, shouldReduceMotion ? 600 : MIN_STARTUP_DURATION_MS);

        return () => {
            clearTimeout(minTimer);
        };
    }, [shouldReduceMotion]);

    useEffect(() => {
        if (!artworkReady) return;

        const resolvedTimer = setTimeout(() => {
            setPhase('resolved');
        }, shouldReduceMotion ? 80 : RESOLVED_PHASE_MS + 30);

        const holdTimer = setTimeout(() => {
            setPhase('hold');
        }, shouldReduceMotion ? 180 : HOLD_PHASE_MS + 120);

        return () => {
            clearTimeout(resolvedTimer);
            clearTimeout(holdTimer);
        };
    }, [artworkReady, shouldReduceMotion]);

    useEffect(() => {
        if (isReady && minDurationElapsed && artworkReady && phase === 'hold' && !hasCompletedRef.current) {
            hasCompletedRef.current = true;
            onComplete();
        }
    }, [artworkReady, isReady, minDurationElapsed, onComplete, phase]);

    const surfaceVariants: Variants = shouldReduceMotion
        ? {
            enter: { opacity: 1 },
            resolved: { opacity: 1 },
            hold: { opacity: 1 },
            exit: { opacity: 0, transition: { duration: 0.42, ease: 'linear' } },
        }
        : {
            enter: { opacity: 1 },
            resolved: { opacity: 1 },
            hold: { opacity: 1 },
            exit: {
                opacity: 0,
                scale: 1.018,
                transition: { duration: 0.48, ease: EASE_IN_OUT },
            },
        };

    const materialVariants: Variants = shouldReduceMotion
        ? {
            enter: { opacity: 0 },
            resolved: { opacity: 0.9, transition: { duration: 0.18, ease: 'linear' } },
            hold: { opacity: 0.9 },
            exit: { opacity: 0, transition: { duration: 0.28, ease: 'linear' } },
        }
        : {
            enter: { opacity: 0, scale: 1.006 },
            resolved: {
                opacity: 1,
                scale: 1,
                transition: { duration: 0.92, ease: SOFT_EASE },
            },
            hold: {
                opacity: 1,
                scale: [1, 1.0035, 1.001],
                transition: {
                    opacity: { duration: 0.24, ease: EASE_IN_OUT },
                    scale: { duration: 2.4, ease: EASE_IN_OUT, repeat: Infinity, repeatType: 'mirror' },
                },
            },
            exit: {
                opacity: 0.24,
                scale: 1.008,
                transition: { duration: 0.48, ease: EASE_IN_OUT },
            },
        };

    const stageVariants: Variants = shouldReduceMotion
        ? {
            enter: { opacity: 0 },
            resolved: { opacity: 1, transition: { duration: 0.22, ease: 'linear' } },
            hold: { opacity: 1 },
            exit: { opacity: 0, transition: { duration: 0.36, ease: 'linear' } },
        }
        : {
            enter: { opacity: 0, y: 5, scale: 0.992 },
            resolved: {
                opacity: 1,
                y: 0,
                scale: 1,
                transition: { delay: 0.02, duration: 0.86, ease: SOFT_EASE },
            },
            hold: {
                opacity: 1,
                y: 0,
                scale: 1,
                transition: { duration: 0.24, ease: EASE_IN_OUT },
            },
            exit: {
                opacity: 0,
                y: -5,
                scale: 1.008,
                transition: { duration: 0.48, ease: EASE_IN_OUT },
            },
        };

    const liftVariants: Variants = shouldReduceMotion
        ? {
            enter: { opacity: 0 },
            resolved: { opacity: 0.32, transition: { duration: 0.22, ease: 'linear' } },
            hold: { opacity: 0.32 },
            exit: { opacity: 0, transition: { duration: 0.28, ease: 'linear' } },
        }
        : {
            enter: { opacity: 0 },
            resolved: { opacity: 0.42, transition: { delay: 0.08, duration: 0.92, ease: SOFT_EASE } },
            hold: {
                opacity: [0.34, 0.42, 0.34],
                transition: { duration: 2.8, ease: EASE_IN_OUT, repeat: Infinity, repeatType: 'mirror' },
            },
            exit: { opacity: 0, transition: { duration: 0.36, ease: EASE_IN_OUT } },
        };

    const curtainLeftVariants: Variants = shouldReduceMotion
        ? {
            enter: { opacity: 1 },
            resolved: { opacity: 0, transition: { duration: 0.24, ease: 'linear' } },
            hold: { opacity: 0 },
            exit: { opacity: 0 },
        }
        : {
            enter: { x: '0%', opacity: 1 },
            resolved: { x: '-103%', opacity: 1, transition: { delay: 0.08, duration: 1.02, ease: SOFT_EASE } },
            hold: { x: '-103%', opacity: 1 },
            exit: { opacity: 0, transition: { duration: 0.2, ease: EASE_IN_OUT } },
        };

    const curtainRightVariants: Variants = shouldReduceMotion
        ? {
            enter: { opacity: 1 },
            resolved: { opacity: 0, transition: { duration: 0.24, ease: 'linear' } },
            hold: { opacity: 0 },
            exit: { opacity: 0 },
        }
        : {
            enter: { x: '0%', opacity: 1 },
            resolved: { x: '103%', opacity: 1, transition: { delay: 0.08, duration: 1.02, ease: SOFT_EASE } },
            hold: { x: '103%', opacity: 1 },
            exit: { opacity: 0, transition: { duration: 0.2, ease: EASE_IN_OUT } },
        };

    const sweepVariants: Variants = shouldReduceMotion
        ? {
            enter: { opacity: 0 },
            resolved: { opacity: 0 },
            hold: { opacity: 0 },
            exit: { opacity: 0 },
        }
        : {
            enter: { opacity: 0, x: '-42%' },
            resolved: {
                opacity: [0, 0.54, 0],
                x: ['-42%', '4%', '42%'],
                transition: { delay: 0.34, duration: 1.15, ease: EASE_IN_OUT, times: [0, 0.5, 1] },
            },
            hold: { opacity: 0, x: '42%' },
            exit: { opacity: 0 },
        };

    const bloomVariants: Variants = shouldReduceMotion
        ? {
            enter: { opacity: 0 },
            resolved: { opacity: 0.42, transition: { duration: 0.24, ease: 'linear' } },
            hold: { opacity: 0.36 },
            exit: { opacity: 0, transition: { duration: 0.3, ease: 'linear' } },
        }
        : {
            enter: { opacity: 0, scale: 0.96 },
            resolved: {
                opacity: 0.56,
                scale: 1,
                transition: { delay: 0.12, duration: 1.0, ease: SOFT_EASE },
            },
            hold: {
                opacity: [0.34, 0.44, 0.34],
                scale: [1, 1.012, 1],
                transition: { duration: 3.2, ease: EASE_IN_OUT, repeat: Infinity, repeatType: 'mirror' },
            },
            exit: { opacity: 0, scale: 1.04, transition: { duration: 0.42, ease: EASE_IN_OUT } },
        };

    const activePhase = artworkReady ? phase : 'enter';

    return (
        <motion.div
            className="teamsync-startup-surface fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
            variants={surfaceVariants}
            initial="enter"
            animate={activePhase}
            exit="exit"
        >
            <motion.div className="teamsync-startup-stage relative overflow-hidden" variants={stageVariants}>
                <motion.img
                    aria-hidden="true"
                    src={startupArtwork}
                    alt=""
                    draggable={false}
                    className="teamsync-startup-material absolute inset-0 h-full w-full select-none object-cover"
                    variants={materialVariants}
                />
                <motion.div aria-hidden="true" className="teamsync-startup-artwork-lift absolute inset-0" variants={liftVariants} />
                <motion.div aria-hidden="true" className="teamsync-startup-bloom absolute inset-0" variants={bloomVariants} />
                <motion.div aria-hidden="true" className="teamsync-startup-sweep absolute inset-y-0 w-[42%]" variants={sweepVariants} />
                <motion.div aria-hidden="true" className="teamsync-startup-curtain teamsync-startup-curtain-left absolute inset-y-0 left-0 w-1/2" variants={curtainLeftVariants} />
                <motion.div aria-hidden="true" className="teamsync-startup-curtain teamsync-startup-curtain-right absolute inset-y-0 right-0 w-1/2" variants={curtainRightVariants} />
            </motion.div>
            <h1 className="sr-only">TeamSync</h1>
        </motion.div>
    );
};

export default StartupSequence;
