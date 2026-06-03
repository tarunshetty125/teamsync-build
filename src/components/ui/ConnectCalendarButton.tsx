import React, { useState, useEffect } from 'react';
import { ArrowRight, Loader, Check } from 'lucide-react';
import { motion } from 'framer-motion';

interface ConnectCalendarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'default' | 'dark';
    onConnect?: () => void;
}

const ConnectCalendarButton: React.FC<ConnectCalendarButtonProps> = ({ className = '', variant: _variant = 'default', onConnect, ...props }) => {
    const [loading, setLoading] = useState(false);
    const [connected, setConnected] = useState(false);

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
