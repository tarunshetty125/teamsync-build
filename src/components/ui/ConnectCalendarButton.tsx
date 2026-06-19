import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, Loader, Check } from 'lucide-react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';

type CalendarButtonHTMLProps = Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    | 'onDrag'
    | 'onDragStart'
    | 'onDragEnd'
    | 'onDragCapture'
    | 'onDragStartCapture'
    | 'onDragEndCapture'
    | 'onAnimationStart'
    | 'onAnimationEnd'
    | 'onAnimationIteration'
    | 'onAnimationStartCapture'
    | 'onAnimationEndCapture'
    | 'onAnimationIterationCapture'
>;

interface ConnectCalendarButtonProps extends CalendarButtonHTMLProps {
    variant?: 'default' | 'dark' | 'magnetic';
    onConnect?: () => void;
}

const magneticSpring = { stiffness: 260, damping: 24, mass: 0.62 };
const textSpring = { stiffness: 340, damping: 25, mass: 0.5 };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const ConnectCalendarButton: React.FC<ConnectCalendarButtonProps> = ({ className = '', variant = 'default', onConnect, ...props }) => {
    const [loading, setLoading] = useState(false);
    const [connected, setConnected] = useState(false);
    const [clickFlashKey, setClickFlashKey] = useState(0);
    const prefersReducedMotion = useReducedMotion();
    const magneticFieldRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const magneticX = useMotionValue(0);
    const magneticY = useMotionValue(0);
    const magneticScale = useMotionValue(1);
    const magneticRotate = useMotionValue(0);
    const magneticTextX = useMotionValue(0);
    const magneticTextY = useMotionValue(0);
    const x = useSpring(magneticX, magneticSpring);
    const y = useSpring(magneticY, magneticSpring);
    const scale = useSpring(magneticScale, magneticSpring);
    const rotateZ = useSpring(magneticRotate, magneticSpring);
    const textX = useSpring(magneticTextX, textSpring);
    const textY = useSpring(magneticTextY, textSpring);

    useEffect(() => {
        let cancelled = false;
        let unsubscribe: (() => void) | undefined;

        const syncConnectionState = async () => {
            try {
                const result = await window.electronAPI?.googleVerifySession?.();
                const authState = result?.authState || await window.electronAPI?.googleGetAuthState?.();
                if (cancelled) return;

                const isConnected = Boolean(authState?.calendarConnected);
                setConnected(isConnected);
                if (isConnected) {
                    onConnect?.();
                }
            } catch {
                if (!cancelled) setConnected(false);
            }

            unsubscribe = window.electronAPI?.onCalendarStatusChanged?.((status) => {
                if (cancelled) return;

                setConnected(status.connected);
                if (status.connected) {
                    onConnect?.();
                }
            });
        };

        void syncConnectionState();

        return () => {
            cancelled = true;
            unsubscribe?.();
        };
    }, []);

    const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
        if (props.onClick) props.onClick(e);
        if (connected) return;
        if (variant === 'magnetic' && !prefersReducedMotion) {
            setClickFlashKey((key) => key + 1);
        }

        setLoading(true);
        try {
            const authState = await window.electronAPI?.googleGetAuthState?.();
            const result = await window.electronAPI?.googleConnectCalendar?.(authState?.user?.email);
            if (result?.success && result.user?.calendarConnected) {
                setConnected(true);
                onConnect?.();
                import('../../lib/analytics/analytics.service').then(({ analytics }) => {
                    analytics.trackCalendarConnected();
                });
            } else if (result?.error) {
                console.error(result.error);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const resetMagnet = () => {
        magneticX.set(0);
        magneticY.set(0);
        magneticScale.set(1);
        magneticRotate.set(0);
        magneticTextX.set(0);
        magneticTextY.set(0);
        buttonRef.current?.style.setProperty('--calendar-pill-x', '52%');
        buttonRef.current?.style.setProperty('--calendar-pill-y', '26%');
    };

    const updateMagnetFromPointer = (clientX: number, clientY: number) => {
        if (prefersReducedMotion || loading || props.disabled) return;

        const field = magneticFieldRef.current;
        const button = buttonRef.current;
        if (!field || !button) return;

        const fieldRect = field.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const centerX = fieldRect.left + fieldRect.width / 2;
        const centerY = fieldRect.top + fieldRect.height / 2;
        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const distance = Math.hypot(dx, dy);
        const activationRadius = 220;
        const strength = Math.pow(clamp(1 - distance / activationRadius, 0, 1), 1.18);

        if (strength < 0.015) {
            resetMagnet();
            return;
        }

        magneticX.set(clamp(dx * 0.2 * strength, -18, 18));
        magneticY.set(clamp(dy * 0.18 * strength, -12, 12));
        magneticScale.set(1 + 0.025 * strength);
        magneticRotate.set(clamp(dx * 0.012 * strength, -1.4, 1.4));
        magneticTextX.set(clamp(dx * 0.18 * strength, -8, 8));
        magneticTextY.set(clamp(dy * 0.2 * strength, -7, 7));

        const highlightX = clamp(((clientX - buttonRect.left) / buttonRect.width) * 100, 14, 86);
        const highlightY = clamp(((clientY - buttonRect.top) / buttonRect.height) * 100, 8, 68);
        button.style.setProperty('--calendar-pill-x', `${highlightX}%`);
        button.style.setProperty('--calendar-pill-y', `${highlightY}%`);
    };

    useEffect(() => {
        if (variant !== 'magnetic' || connected || typeof window === 'undefined') return;

        let animationFrame: number | null = null;
        let latestPointer: { x: number; y: number } | null = null;

        const handleWindowPointerMove = (event: PointerEvent) => {
            latestPointer = { x: event.clientX, y: event.clientY };
            if (animationFrame !== null) return;

            animationFrame = window.requestAnimationFrame(() => {
                animationFrame = null;
                if (latestPointer) {
                    updateMagnetFromPointer(latestPointer.x, latestPointer.y);
                }
            });
        };

        window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
        window.addEventListener('pointerleave', resetMagnet);

        return () => {
            if (animationFrame !== null) {
                window.cancelAnimationFrame(animationFrame);
            }
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerleave', resetMagnet);
        };
    }, [variant, connected, loading, props.disabled, prefersReducedMotion]);

    if (variant === 'magnetic' && connected) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 2 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className={`relative flex min-h-[56px] w-full items-center justify-center ${className}`}
            >
                <div
                    className="
                        relative inline-flex h-[42px] min-w-[166px] items-center justify-center gap-1.5
                        overflow-hidden rounded-full px-5
                        text-[12px] font-semibold tracking-[-0.005em] text-emerald-950
                        select-none
                    "
                    style={{
                        background: 'radial-gradient(circle at 48% 20%, rgba(245,255,250,0.96) 0%, rgba(172,255,217,0.8) 26%, rgba(52,211,153,0.84) 58%, rgba(16,185,129,0.96) 100%)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -18px 24px rgba(5,150,105,0.28), 0 16px 30px rgba(3,7,18,0.35), 0 0 0 1px rgba(209,250,229,0.28)',
                    }}
                >
                    <span className="pointer-events-none absolute inset-x-[10%] top-1 h-[42%] rounded-full bg-gradient-to-b from-white/70 via-white/30 to-transparent blur-[7px]" />
                    <Check size={13} strokeWidth={2.5} className="relative z-10" />
                    <span className="relative z-10">Calendar connected</span>
                </div>
            </motion.div>
        );
    }

    if (connected) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 2 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className={`
                    relative
                    inline-flex h-9 items-center gap-2
                    rounded-md border border-emerald-500/20
                    bg-emerald-500/10 px-3
                    text-[12px] font-semibold text-emerald-600
                    select-none
                    ${className}
                `}
            >
                <Check size={14} strokeWidth={2.4} />
                Calendar connected
            </motion.div>
        );
    }

    if (variant === 'magnetic') {
        return (
            <div
                ref={magneticFieldRef}
                className={`relative flex min-h-[56px] w-full items-center justify-center overflow-visible ${className}`}
            >
                <motion.button
                    {...props}
                    ref={buttonRef}
                    type={props.type || 'button'}
                    onClick={handleClick}
                    disabled={loading || props.disabled}
                    whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 24 }}
                    className={`
                        group relative inline-flex h-[42px] min-w-[162px] items-center justify-center
                        overflow-hidden rounded-full px-5
                        text-[13px] font-semibold tracking-[-0.005em] text-[#050009]
                        outline-none transition-[filter] duration-200 ease-out
                        focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#150036]
                        disabled:cursor-wait disabled:opacity-80
                    `}
                    style={{
                        x,
                        y,
                        scale,
                        rotateZ,
                        background: 'radial-gradient(circle at var(--calendar-pill-x, 52%) var(--calendar-pill-y, 26%), rgba(255,255,255,0.98) 0%, rgba(226,207,255,0.92) 20%, rgba(169,92,255,0.9) 48%, rgba(83,45,236,0.98) 100%)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.68), inset 0 -15px 22px rgba(55,28,207,0.42), inset 0 -2px 8px rgba(30,4,88,0.38), 0 12px 24px rgba(10,0,45,0.44), 0 0 0 1px rgba(229,214,255,0.24)',
                    }}
                >
                    <span className="pointer-events-none absolute inset-x-[8%] top-1 h-[46%] rounded-full bg-gradient-to-b from-white/75 via-white/30 to-transparent blur-[8px]" />
                    <span className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(100deg,transparent_0%,rgba(255,255,255,0.18)_42%,rgba(255,255,255,0.34)_50%,transparent_62%)] opacity-75 transition-transform duration-500 group-hover:translate-x-2" />
                    {clickFlashKey > 0 && (
                        <motion.span
                            key={clickFlashKey}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 z-20 rounded-full bg-white"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 1, 1, 0] }}
                            transition={{
                                duration: 0.18,
                                times: [0, 0.16, 0.42, 1],
                                ease: [0.16, 1, 0.3, 1],
                            }}
                        />
                    )}
                    {loading ? <Loader size={13} className="relative z-10 animate-spin" /> : null}
                    <motion.span
                        className="relative z-10 drop-shadow-[0_1px_1px_rgba(255,255,255,0.22)]"
                        style={{ x: textX, y: textY }}
                    >
                        {loading ? 'Connecting...' : 'Connect calendar'}
                    </motion.span>
                </motion.button>
            </div>
        );
    }

    return (
        <button
            {...props}
            onClick={handleClick}
            disabled={loading || props.disabled}
            className={`
                group relative inline-flex h-9 items-center gap-2
                rounded-md bg-text-primary px-3.5
                text-[13px] font-semibold text-bg-primary
                transition-opacity duration-150 ease-out
                hover:opacity-90
                active:scale-[0.98]
                ${loading ? 'opacity-80 cursor-wait' : ''}
                ${className}
            `}
        >
            {loading ? <Loader size={14} className="animate-spin" /> : null}
            {loading ? 'Connecting...' : 'Connect calendar'}
            {!loading && <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />}
        </button>
    );
};

export default ConnectCalendarButton;
