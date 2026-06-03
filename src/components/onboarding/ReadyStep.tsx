import { motion } from 'framer-motion';
import { Monitor, Mic, Accessibility, Zap } from 'lucide-react';

interface ReadyStepProps {
  onLaunch: () => void;
}

const CAPABILITIES = [
  {
    icon: Monitor,
    label: 'Screen Recording',
    sublabel: 'Full context capture',
    bg: 'var(--bg-elevated)',
    border: 'var(--border-subtle)',
    iconBg: 'var(--bg-input)',
    iconBorder: 'var(--border-subtle)',
    iconColor: 'var(--text-secondary)',
    dot: 'var(--text-tertiary)',
  },
  {
    icon: Mic,
    label: 'Microphone',
    sublabel: 'Realtime transcription',
    bg: 'var(--bg-elevated)',
    border: 'var(--border-subtle)',
    iconBg: 'var(--bg-input)',
    iconBorder: 'var(--border-subtle)',
    iconColor: 'var(--text-secondary)',
    dot: 'var(--text-tertiary)',
  },
  {
    icon: Accessibility,
    label: 'Accessibility',
    sublabel: 'Overlay intelligence',
    bg: 'var(--bg-elevated)',
    border: 'var(--border-subtle)',
    iconBg: 'var(--bg-input)',
    iconBorder: 'var(--border-subtle)',
    iconColor: 'var(--text-secondary)',
    dot: 'var(--text-tertiary)',
  },
];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.3 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 220, damping: 22 },
  },
};

export function ReadyStep({ onLaunch }: ReadyStepProps) {
  return (
    <div className="mx-auto max-w-[820px]">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated p-8 shadow-[0_16px_40px_rgba(0,0,0,0.12)]"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />

        <div className="relative">
          <div className="flex flex-col items-center text-center">
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 18, delay: 0.1 }}
              className="relative flex h-20 w-20 items-center justify-center"
            >
              <div className="relative flex h-20 w-20 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                  <Zap className="h-6 w-6 text-emerald-300" strokeWidth={1.5} />
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="mt-5 inline-flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              All systems live
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="mt-4 text-[32px] font-medium leading-[1.1] tracking-[-0.04em] text-text-primary"
            >
              TeamSync is ready.
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.32, duration: 0.5 }}
              className="mx-auto mt-3 max-w-[44ch] text-[13px] leading-relaxed text-text-secondary"
            >
              Your system is configured for realtime transcription, screen understanding, meeting capture, interview assistance, and overlay intelligence.
            </motion.p>
          </div>

          <motion.div
            className="mt-7 grid gap-2.5 sm:grid-cols-3"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            {CAPABILITIES.map((cap) => {
              const Icon = cap.icon;
              return (
                <motion.div
                  key={cap.label}
                  variants={itemVariants}
                  className="relative overflow-hidden rounded-xl p-4 shadow-[0_12px_28px_rgba(0,0,0,0.08)]"
                  style={{
                    background: cap.bg,
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: cap.border,
                  }}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
                  <div
                    className="pointer-events-none absolute right-3.5 top-3.5 h-1.5 w-1.5 rounded-full opacity-60"
                    style={{ background: cap.dot }}
                  />

                  <div className="relative flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: cap.iconBg,
                        borderWidth: 1,
                        borderStyle: 'solid',
                        borderColor: cap.iconBorder,
                        color: cap.iconColor,
                      }}
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <div>
                      <div className="text-[13px] font-medium text-text-primary">{cap.label}</div>
                      <div className="mt-0.5 text-[11px] text-text-secondary">{cap.sublabel}</div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="mt-7 flex justify-center"
          >
            <motion.button
              type="button"
              onClick={onLaunch}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              className="group relative inline-flex h-10 items-center justify-center gap-2 rounded-md bg-text-primary px-5 text-[14px] font-semibold text-bg-primary shadow-sm transition-opacity hover:opacity-90"
            >
              <Zap
                className="relative h-4 w-4 transition-transform duration-300 group-hover:rotate-12"
                strokeWidth={1.5}
              />
              <span className="relative">Launch TeamSync</span>
            </motion.button>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
