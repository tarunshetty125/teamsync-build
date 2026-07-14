import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { KeyRound, Sparkles } from 'lucide-react';
import { cn } from '../../src/lib/utils';
import { useResolvedTheme } from '../../src/hooks/useResolvedTheme';

interface TeamSyncApiPromoToasterProps {
    className?: string;
    isOpen: boolean;
    onDismiss: () => void;
    onOpenSettings: (tab: string) => void;
}

export const TeamSyncApiPromoToaster: React.FC<TeamSyncApiPromoToasterProps> = ({
    className,
    isOpen,
    onDismiss,
    onOpenSettings,
}) => {
    const isLight = useResolvedTheme() === 'light';

    const handleDismiss = () => {
        localStorage.setItem('teamsync_api_toaster_dismissed', Date.now().toString());
        onDismiss();
    };

    const handlePrimaryAction = () => {
        localStorage.setItem('teamsync_api_toaster_dismissed', Date.now().toString());
        onDismiss();
        onOpenSettings('api');
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className={`fixed inset-0 z-[9998] flex items-center justify-center ${isLight ? 'bg-black/30 backdrop-blur-[2px]' : 'bg-black/60 backdrop-blur-[2px]'}`}>
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 4 }}
                        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
                        className={cn(
                            'relative flex w-[520px] flex-col items-center overflow-hidden rounded-[28px] pb-[32px]',
                            isLight
                                ? 'border border-black/[0.08] bg-white shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15),0_8px_24px_-8px_rgba(0,0,0,0.1)]'
                                : 'border border-white/[0.08] bg-gradient-to-b from-[#16171A] to-[#111214] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6),0_8px_24px_-8px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]',
                            className
                        )}
                    >
                        <div className="flex w-full flex-col items-center px-[40px] pt-[36px] text-center">
                            <div className={`relative mb-[20px] flex h-[48px] w-[48px] items-center justify-center rounded-full border shadow-inner ${isLight ? 'border-[#38BDF8]/25 bg-[#38BDF8]/10' : 'border-white/10 bg-white/5'}`}>
                                <div className="absolute inset-0 rounded-full bg-[#38BDF8] opacity-20 blur-[24px]" />
                                <KeyRound size={24} className="relative z-10 text-[#38BDF8]" strokeWidth={1.5} />
                            </div>

                            <h3 className={`mb-[10px] text-[24px] font-[600] leading-[1.2] tracking-[-0.01em] antialiased ${isLight ? 'text-[#1C1C1E]' : 'text-[#F3F3F3]'}`}>
                                Connect TeamSync API.
                            </h3>
                            <p className={`max-w-[420px] text-[14px] font-medium leading-[1.6] antialiased ${isLight ? 'text-black/50' : 'text-white/60'}`}>
                                Add your TeamSync API key once to unlock hosted models, quota tracking, and subscription-linked Pro access across the app.
                            </p>
                        </div>

                        <div className="mt-7 mb-8 grid w-full grid-cols-3 gap-2 px-[32px]">
                            {['Hosted AI', 'Quota sync', 'Pro unlock'].map((label) => (
                                <div
                                    key={label}
                                    className={`rounded-[16px] border px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] ${isLight ? 'border-black/[0.06] bg-black/[0.03] text-black/55' : 'border-white/[0.07] bg-white/[0.05] text-white/55'}`}
                                >
                                    {label}
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={handlePrimaryAction}
                            className="group relative mb-[16px] h-[48px] w-[320px] overflow-hidden rounded-[16px] border border-white/5 shadow-[0_4px_16px_rgba(56,189,248,0.15)] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_8px_24px_rgba(56,189,248,0.25)] active:scale-[0.99]"
                        >
                            <div className="absolute inset-0 bg-gradient-to-b from-[#38BDF8] to-[#0EA5E9]" />
                            <div className="absolute inset-0 bg-white/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                            <span className="relative z-10 flex items-center justify-center gap-2 text-[15px] font-[600] tracking-wide text-white">
                                <Sparkles size={16} />
                                Open API settings
                            </span>
                        </button>

                        <button
                            onClick={handleDismiss}
                            className={`text-[13px] font-medium transition-colors duration-200 ${isLight ? 'text-black/30 hover:text-black/60' : 'text-white/30 hover:text-white/60'}`}
                        >
                            Not now
                        </button>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};