import { motion } from 'framer-motion';
import { Check, Rocket, Settings, Command, Keyboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  stepModalVariants,
  stepItemVariants,
  modalFrameStyle,
  ModalFrameBorder,
} from './animations';

const CHECKLIST_ITEMS = [
  { label: 'Permissions configured', delay: 0.3 },
  { label: 'Overlay configured', delay: 0.55 },
  { label: 'Shortcuts available', delay: 0.8 },
  { label: 'Ready to launch', delay: 1.05 },
];

const SHORTCUTS = [
  { keys: ['⌘', '1'], label: 'What To Answer' },
  { keys: ['⌘', '2'], label: 'Clarify' },
  { keys: ['⌘', '6'], label: 'Code Hint' },
  { keys: ['⌘', '⇧', 'Space'], label: 'Stealth Typing' },
];

export type SuccessStepProps = {
  isAdvancing: boolean;
  onLaunch: () => void;
  onOpenSettings: () => void;
};

export function SuccessStep({ isAdvancing, onLaunch, onOpenSettings }: SuccessStepProps) {
  const [showChecklist, setShowChecklist] = useState(false);
  const [checklistDone, setChecklistDone] = useState(false);

  useEffect(() => {
    const showTimer = setTimeout(() => setShowChecklist(true), 400);
    const doneTimer = setTimeout(() => setChecklistDone(true), 1600);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  return (
    <motion.section
      key="onboarding-v3-success"
      variants={stepModalVariants}
      initial="hidden"
      animate={isAdvancing ? 'advanceExit' : 'visible'}
      exit="exit"
      data-testid="onboarding-v3-success"
      className={`relative w-[calc(100vw-32px)] max-w-[540px] transform-gpu overflow-hidden rounded-[15px] bg-[#0b0d12]/[0.70] px-[36px] pb-[28px] pt-[44px] shadow-[0_26px_90px_rgba(0,0,0,0.50),inset_0_1px_0_rgba(255,255,255,0.065)] backdrop-blur-[34px] will-change-transform ${
        isAdvancing ? 'pointer-events-none' : ''
      }`}
      style={modalFrameStyle}
    >
      <ModalFrameBorder />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(74,222,128,0.08),transparent_50%),radial-gradient(circle_at_18%_93%,rgba(109,55,28,0.13),transparent_43%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#08090d] opacity-70" />

      {/* Hero */}
      <motion.div variants={stepItemVariants} className="text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', duration: 0.8, bounce: 0.22, delay: 0.1 }}
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] border border-emerald-500/20 bg-emerald-500/10 shadow-[0_0_40px_rgba(74,222,128,0.12)]"
        >
          <Rocket className="h-7 w-7 text-emerald-400" strokeWidth={1.5} />
        </motion.div>
        <h2 className="text-[38px] font-semibold leading-[1.04] text-white/90 drop-shadow-[0_0_12px_rgba(255,255,255,0.18)]">
          You're Ready.
        </h2>
        <p className="mx-auto mt-[12px] max-w-[320px] text-[13px] font-semibold leading-[1.48] text-white/50">
          TeamSync is configured and ready to assist you in real time.
        </p>
      </motion.div>

      {/* Animated Checklist */}
      <motion.div variants={stepItemVariants} className="mt-[28px] space-y-[6px]">
        {CHECKLIST_ITEMS.map((item) => (
          <motion.div
            key={item.label}
            initial={{ x: -12, opacity: 0 }}
            animate={showChecklist ? { x: 0, opacity: 1 } : { x: -12, opacity: 0 }}
            transition={{
              delay: item.delay,
              duration: 0.5,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="flex items-center gap-3 rounded-[10px] border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={showChecklist ? { scale: 1 } : { scale: 0 }}
              transition={{
                delay: item.delay + 0.15,
                type: 'spring',
                stiffness: 500,
                damping: 28,
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20"
            >
              <Check className="h-3 w-3 text-emerald-400" strokeWidth={3} />
            </motion.div>
            <span className="text-[13px] font-semibold text-white/70">{item.label}</span>
          </motion.div>
        ))}
      </motion.div>

      {/* Shortcut Cheat Sheet */}
      <motion.div variants={stepItemVariants} className="mt-[22px]">
        <div className="mb-[10px] flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/30">
          <Keyboard className="h-3.5 w-3.5" strokeWidth={2} />
          Quick shortcuts
        </div>
        <div className="grid grid-cols-2 gap-[6px]">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.label}
              className="flex items-center gap-2.5 rounded-[8px] border border-white/[0.05] bg-white/[0.02] px-2.5 py-2"
            >
              <div className="flex items-center gap-[3px]">
                {shortcut.keys.map((key, i) => (
                  <kbd
                    key={`${shortcut.label}-${i}`}
                    className="flex h-5 min-w-[22px] items-center justify-center rounded-[4px] border border-white/[0.12] bg-white/[0.06] px-1 text-[10px] font-semibold text-white/50"
                  >
                    {key === '⌘' ? <Command className="h-2.5 w-2.5" /> : key}
                  </kbd>
                ))}
              </div>
              <span className="text-[11px] font-medium text-white/44">{shortcut.label}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* CTAs */}
      <motion.div
        variants={stepItemVariants}
        className="mt-[24px] space-y-[8px]"
      >
        {/* Primary: Launch */}
        <motion.button
          type="button"
          whileHover={checklistDone && !isAdvancing ? { y: -1, scale: 1.006 } : undefined}
          whileTap={checklistDone && !isAdvancing ? { scale: 0.986 } : undefined}
          onClick={onLaunch}
          disabled={!checklistDone || isAdvancing}
          className="group relative inline-flex h-[46px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-full border border-white/[0.16] bg-white/[0.94] px-5 text-[14px] font-bold text-[#050506] shadow-[0_12px_32px_rgba(255,255,255,0.10),inset_0_1px_0_rgba(255,255,255,0.7)] transition-all duration-300 hover:bg-white disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.06] disabled:text-white/[0.30] disabled:shadow-none"
        >
          <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-white/70" />
          <Rocket className="h-4 w-4" strokeWidth={2} />
          Launch TeamSync
        </motion.button>

        {/* Secondary: Open Settings */}
        <motion.button
          type="button"
          whileHover={!isAdvancing ? { scale: 1.006 } : undefined}
          whileTap={!isAdvancing ? { scale: 0.986 } : undefined}
          onClick={onOpenSettings}
          disabled={isAdvancing}
          className="inline-flex h-[38px] w-full items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 text-[12px] font-semibold text-white/40 transition-colors hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white/60"
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
          Open Settings
        </motion.button>
      </motion.div>
    </motion.section>
  );
}
