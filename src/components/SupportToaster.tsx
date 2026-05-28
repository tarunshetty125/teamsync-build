
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart } from 'lucide-react';
import { cn } from '../lib/utils';

interface SupportToasterProps {
    className?: string;
}

const ROTATING_WORDS = [
    'workflow',
    'daily driver',
    'edge',
    'process',
    'hustle',
    'stack',
];

const WORD_CYCLE_MS = 2400;

export const SupportToaster: React.FC<SupportToasterProps> = ({ className }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [hasDonated, setHasDonated] = useState(false);
    const [isButtonHovered, setIsButtonHovered] = useState(false);
    const [wordIndex, setWordIndex] = useState(0);

    // Cycle through rotating words
    useEffect(() => {
        if (!isVisible) return;
        const interval = setInterval(() => {
            setWordIndex(prev => (prev + 1) % ROTATING_WORDS.length);
        }, WORD_CYCLE_MS);
        return () => clearInterval(interval);
    }, [isVisible]);

    useEffect(() => {
        let mounted = true;

        const checkStatus = async () => {
            // Wait 10s before checking
            await new Promise(resolve => setTimeout(resolve, 10000));

            try {
                if (!window.electronAPI?.getDonationStatus) return;

                const status = await window.electronAPI.getDonationStatus();
                if (mounted) {
                    setHasDonated(status.hasDonated);
                    if (status.shouldShow) {
                        setIsVisible(true);
                        window.electronAPI.markDonationToastShown();
                    }
                }
            } catch (e) {
                console.error("Failed to check donation status:", e);
            }
        };

        checkStatus();

        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!import.meta.env.DEV) return;
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                console.log("Debug: Toggling Donation Toaster");
                setIsVisible(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const clickTimeRef = React.useRef<number | null>(null);

    useEffect(() => {
        const handleFocus = async () => {
            if (clickTimeRef.current) {
                const elapsed = Date.now() - clickTimeRef.current;
                if (elapsed > 20000) { // 20 seconds
                    console.log("User returned from support link after >20s. Presuming donation.");
                    await window.electronAPI?.setDonationComplete();
                    setHasDonated(true);
                    setIsVisible(false);
                }
                clickTimeRef.current = null;
            }
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const handleDismiss = useCallback(() => {
        setIsVisible(false);
    }, []);

    const handleSupport = useCallback(() => {
        clickTimeRef.current = Date.now();
        if (window.electronAPI?.openExternal) {
            window.electronAPI.openExternal('https://github.com/TarunShetty256/');
        } else {
            window.open('https://github.com/TarunShetty256/', '_blank');
        }
    }, []);

    if (!isVisible) return null;

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    className="fixed inset-0 z-[9999] flex items-center justify-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                >
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-[6px]" />

                    {/* Outer Shell — Double-Bezel architecture */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: 6 }}
                        transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
                        className="relative"
                    >
                        {/* Ambient cosmic glow behind the card */}
                        <div
                            className="absolute -inset-[80px] rounded-full opacity-[0.10] pointer-events-none"
                            style={{
                                background: 'radial-gradient(ellipse at 40% 40%, #8B5CF6 0%, transparent 50%), radial-gradient(ellipse at 60% 60%, #3B82F6 0%, transparent 50%), radial-gradient(ellipse at 50% 30%, #06B6D4 0%, transparent 60%)',
                            }}
                        />

                        {/* Outer bezel */}
                        <div
                            className={cn(
                                "relative p-[1.5px] rounded-[32px]",
                                "bg-gradient-to-b from-[#8B5CF6]/20 via-white/[0.06] to-[#3B82F6]/10",
                                className
                            )}
                        >
                            {/* Inner card */}
                            <div
                                className={cn(
                                    "relative w-[480px] overflow-hidden",
                                    "rounded-[31px]",
                                    "bg-[#0C0D0F]",
                                    "shadow-[0_40px_80px_-20px_rgba(0,0,0,0.7),0_12px_32px_-8px_rgba(0,0,0,0.5)]",
                                    "flex flex-col items-center",
                                )}
                            >
                                {/* Top inset highlight line */}
                                <div className="absolute top-0 left-[15%] right-[15%] h-[1px] bg-gradient-to-r from-transparent via-[#8B5CF6]/30 to-transparent" />

                                {/* Subtle noise texture */}
                                <div
                                    className="absolute inset-0 pointer-events-none opacity-[0.03]"
                                    style={{
                                        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
                                    }}
                                />

                                {/* ── Content ── */}
                                <div className="relative z-10 flex flex-col items-center w-full pt-[48px] pb-[40px] px-[44px]">

                                    {/* Heart icon with liquid fill */}
                                    <div className="relative mb-[32px] w-[36px] h-[36px]">
                                        <style>
                                            {`
                                                @keyframes supportWaveMove {
                                                    from { background-position-x: 0; }
                                                    to { background-position-x: -36px; }
                                                }
                                                @keyframes cosmicSpin {
                                                    from { transform: rotate(0deg); }
                                                    to { transform: rotate(360deg); }
                                                }
                                                @keyframes cosmicShift {
                                                    0%, 100% { background-position: 0% 50%; }
                                                    50% { background-position: 100% 50%; }
                                                }
                                            `}
                                        </style>

                                        {/* Ambient glow behind icon */}
                                        <div className="absolute inset-[-10px] blur-[30px] opacity-25 rounded-full" style={{ background: 'linear-gradient(135deg, #8B5CF6, #3B82F6, #06B6D4)' }} />

                                        {/* Liquid Container (Masked to Heart Shape) */}
                                        <div
                                            className="absolute inset-0 z-10"
                                            style={{
                                                maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'/%3E%3C/svg%3E")`,
                                                WebkitMaskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'/%3E%3C/svg%3E")`,
                                                maskSize: 'contain',
                                                WebkitMaskSize: 'contain',
                                                maskRepeat: 'no-repeat',
                                                WebkitMaskRepeat: 'no-repeat',
                                                maskPosition: 'center',
                                                WebkitMaskPosition: 'center',
                                            }}
                                        >
                                            <motion.div
                                                initial={{ height: "0%" }}
                                                animate={{ height: isButtonHovered ? "100%" : "0%" }}
                                                transition={{ duration: 1.2, ease: [0.32, 0.72, 0, 1] }}
                                                className="absolute bottom-0 left-0 right-0 w-full"
                                                style={{
                                                    background: 'linear-gradient(135deg, #8B5CF6, #3B82F6, #06B6D4, #EC4899)',
                                                    backgroundSize: '200% 200%',
                                                    animation: 'cosmicShift 3s ease infinite',
                                                }}
                                            >
                                                <div
                                                    className="absolute -top-[5px] left-0 right-0 h-[10px] w-full"
                                                    style={{
                                                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='20' viewBox='0 0 100 20' preserveAspectRatio='none'%3E%3Cpath d='M0 20 V10 Q25 0 50 10 T100 10 V20 H0 Z' fill='%238B5CF6' /%3E%3C/svg%3E")`,
                                                        backgroundSize: '36px 100%',
                                                        animation: 'supportWaveMove 1s linear infinite',
                                                    }}
                                                />
                                            </motion.div>
                                        </div>

                                        {/* Outline Overlay */}
                                        <Heart
                                            size={36}
                                            className="text-[#A78BFA] drop-shadow-[0_0_16px_rgba(139,92,246,0.4)] relative z-20 pointer-events-none"
                                            strokeWidth={1.5}
                                        />
                                    </div>

                                    {/* ── Typography Stack ── */}
                                    <div className="flex flex-col items-center text-center">

                                        {/* Eyebrow tag */}
                                        <div className="mb-[16px] px-[12px] py-[4px] rounded-full bg-white/[0.04] border border-white/[0.06]">
                                            <span className="text-[10px] uppercase tracking-[0.18em] font-medium text-white/40">
                                                Solo Developer
                                            </span>
                                        </div>

                                        {/* Headline with rotating word */}
                                        <h3 className="text-[28px] font-semibold leading-[1.15] text-[#F5F5F5] tracking-[-0.02em] mb-[16px] antialiased">
                                            Part of your{' '}
                                            <span className="relative inline-flex overflow-hidden align-bottom" style={{ height: '1.2em', minWidth: '120px' }}>
                                                <AnimatePresence mode="wait">
                                                    <motion.span
                                                        key={wordIndex}
                                                        initial={{ y: '100%', opacity: 0, filter: 'blur(4px)' }}
                                                        animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
                                                        exit={{ y: '-100%', opacity: 0, filter: 'blur(4px)' }}
                                                        transition={{
                                                            duration: 0.4,
                                                            ease: [0.23, 1, 0.32, 1],
                                                        }}
                                                        className="absolute left-0 right-0 text-transparent bg-clip-text whitespace-nowrap"
                                                        style={{ backgroundImage: 'linear-gradient(90deg, #8B5CF6, #3B82F6, #06B6D4)', backgroundSize: '200% auto', animation: 'cosmicShift 4s ease infinite' }}
                                                    >
                                                        {ROTATING_WORDS[wordIndex]}
                                                    </motion.span>
                                                </AnimatePresence>
                                            </span>
                                            .
                                        </h3>

                                        {/* Body */}
                                        <p className="text-[13.5px] leading-[1.65] text-white/50 max-w-[360px] font-normal antialiased">
                                            TeamSync is built and maintained by one person.<br />
                                            If it's become part of how you work, your support<br />
                                            keeps it alive and moving forward.
                                        </p>
                                    </div>

                                    {/* ── Actions ── */}
                                    <div className="mt-[36px] w-full flex flex-col items-center">

                                        {/* Primary Button — cosmic gradient border pill */}
                                        <div className="relative group w-[300px] h-[50px]">
                                            {/* Static cosmic gradient border */}
                                            <div
                                                className="absolute -inset-[1.5px] rounded-full opacity-70 group-hover:opacity-100 transition-opacity duration-500"
                                                style={{
                                                    background: 'linear-gradient(135deg, #8B5CF6, #3B82F6, #06B6D4, #EC4899)',
                                                }}
                                            />
                                            {/* Cosmic glow on hover */}
                                            <div
                                                className="absolute -inset-[6px] rounded-full opacity-0 group-hover:opacity-40 transition-opacity duration-500 blur-[12px]"
                                                style={{
                                                    background: 'linear-gradient(135deg, #8B5CF6, #3B82F6, #06B6D4, #EC4899)',
                                                }}
                                            />
                                            <button
                                                onClick={handleSupport}
                                                onMouseEnter={() => setIsButtonHovered(true)}
                                                onMouseLeave={() => setIsButtonHovered(false)}
                                                className={cn(
                                                    "relative flex items-center justify-center gap-[8px]",
                                                    "w-full h-full rounded-full overflow-hidden",
                                                    "transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                                                    "active:scale-[0.97]",
                                                )}
                                            >
                                                {/* Button inner background */}
                                                <div className="absolute inset-0 bg-[#0C0D0F]" />
                                                <div
                                                    className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                                                    style={{
                                                        background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(59,130,246,0.10), rgba(6,182,212,0.08))',
                                                    }}
                                                />
                                                {/* Top highlight */}
                                                <div className="absolute top-0 left-[15%] right-[15%] h-[1px] bg-gradient-to-r from-transparent via-[#8B5CF6]/25 to-transparent" />

                                                <span className="relative z-10 text-[14px] font-semibold text-white/90 group-hover:text-white tracking-[0.01em]">
                                                    Support the Builder
                                                </span>

                                                {/* Trailing icon in its own circular nest */}
                                                <span className="relative z-10 w-[28px] h-[28px] rounded-full bg-white/[0.06] group-hover:bg-white/[0.10] flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-[2px] group-hover:-translate-y-[1px] group-hover:scale-105">
                                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-white/80 group-hover:text-white">
                                                        <path d="M2.5 9.5L9.5 2.5M9.5 2.5H4.5M9.5 2.5V7.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                                                    </svg>
                                                </span>
                                            </button>
                                        </div>

                                        {/* Secondary dismiss */}
                                        <button
                                            onClick={handleDismiss}
                                            className="mt-[18px] text-[13px] text-white/25 font-medium hover:text-white/50 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
                                        >
                                            Not now
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
