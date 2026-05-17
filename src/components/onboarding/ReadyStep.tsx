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
    bg: 'rgba(99,102,241,0.07)',
    border: 'rgba(129,140,248,0.2)',
    iconBg: 'rgba(99,102,241,0.14)',
    iconBorder: 'rgba(129,140,248,0.28)',
    iconColor: 'rgba(165,180,252,0.9)',
    dot: '#a5b4fc',
  },
  {
    icon: Mic,
    label: 'Microphone',
    sublabel: 'Realtime transcription',
    bg: 'rgba(139,92,246,0.07)',
    border: 'rgba(167,139,250,0.2)',
    iconBg: 'rgba(139,92,246,0.14)',
    iconBorder: 'rgba(167,139,250,0.28)',
    iconColor: 'rgba(196,181,253,0.9)',
    dot: '#c4b5fd',
  },
  {
    icon: Accessibility,
    label: 'Accessibility',
    sublabel: 'Overlay intelligence',
    bg: 'rgba(16,185,129,0.07)',
    border: 'rgba(52,211,153,0.2)',
    iconBg: 'rgba(16,185,129,0.14)',
    iconBorder: 'rgba(52,211,153,0.28)',
    iconColor: 'rgba(110,231,183,0.9)',
    dot: '#6ee7b7',
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
        className="relative overflow-hidden rounded-[28px] border border-white/15 border-t-white/25 p-8 shadow-[0_8px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-[50px] backdrop-saturate-[180%]"
        style={{ background: 'rgba(255,255,255,0.05)' }}
      >
        {/* Inner glass gradient */}
        <div className="pointer-events-none absolute inset-0 rounded-[28px] bg-gradient-to-br from-white/[0.07] via-transparent to-emerald-500/[0.03]" />
        {/* Emerald ambient orb */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/[0.07] blur-[60px]" />

        <div className="relative">
          {/* Header */}
          <div className="flex flex-col items-center text-center">
            {/* Animated icon */}
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 18, delay: 0.1 }}
              className="relative flex h-20 w-20 items-center justify-center"
            >
              {/* Outer ring ping */}
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/10" />
              {/* Glass circle */}
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/[0.12] shadow-[0_0_40px_rgba(52,211,153,0.18),inset_0_1px_0_rgba(52,211,153,0.25)] backdrop-blur-xl">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-400/20 bg-emerald-500/15 shadow-[0_0_20px_rgba(52,211,153,0.3)]">
                  <Zap className="h-6 w-6 text-emerald-300" strokeWidth={1.5} />
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/[0.1] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-300 shadow-[inset_0_1px_0_rgba(52,211,153,0.2)] backdrop-blur-md"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
              All systems live
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="mt-4 text-[32px] font-medium leading-[1.1] tracking-[-0.04em] text-white"
            >
              TeamSync is ready.
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.32, duration: 0.5 }}
              className="mx-auto mt-3 max-w-[44ch] text-[13px] leading-relaxed text-white/45"
            >
              Your system is configured for realtime transcription, screen understanding, meeting capture, interview assistance, and overlay intelligence.
            </motion.p>
          </div>

          {/* Capability cards */}
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
                  className="relative overflow-hidden rounded-[18px] p-4 backdrop-blur-[30px]"
                  style={{
                    background: cap.bg,
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: cap.border,
                  }}
                >
                  {/* Glass shimmer */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.04] to-transparent" />
                  {/* Accent dot */}
                  <div
                    className="pointer-events-none absolute right-3.5 top-3.5 h-1.5 w-1.5 rounded-full opacity-70"
                    style={{ background: cap.dot, boxShadow: `0 0 8px ${cap.dot}` }}
                  />

                  <div className="relative flex items-center gap-3">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
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
                      <div className="text-[13px] font-medium text-white/90">{cap.label}</div>
                      <div className="mt-0.5 text-[11px] text-white/35">{cap.sublabel}</div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>

          {/* Inject button keyframes */}
          <style>{`
            @keyframes launch-glow {
              0%, 100% { box-shadow: 0 0 20px rgba(56,189,248,0.12), inset 0 1px 0 rgba(56,189,248,0.22); }
              50%      { box-shadow: 0 0 40px rgba(56,189,248,0.32), 0 0 70px rgba(56,189,248,0.1), inset 0 1px 0 rgba(56,189,248,0.3); }
            }
            @keyframes wave-flow {
              0%   { transform: translateX(-100%) skewX(-12deg); }
              100% { transform: translateX(400%) skewX(-12deg); }
            }
            @keyframes wave-flow-2 {
              0%   { transform: translateX(-100%) skewX(-12deg); }
              100% { transform: translateX(400%) skewX(-12deg); }
            }
          `}</style>

          {/* Launch button */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="mt-7 flex justify-center"
          >
            <motion.button
              type="button"
              onClick={onLaunch}
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 380, damping: 16 }}
              className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl border border-sky-400/35 bg-sky-500/[0.15] px-7 py-3 text-[14px] font-semibold text-sky-200 backdrop-blur-xl"
              style={{ animation: 'launch-glow 2.8s ease-in-out infinite' }}
            >
              {/* Wave 1 — primary */}
              <span
                className="pointer-events-none absolute inset-y-0 w-[60px]"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(186,230,253,0.3) 40%, rgba(224,242,254,0.15) 60%, transparent 100%)',
                  filter: 'blur(3px)',
                  animation: 'wave-flow 2.2s cubic-bezier(0.4,0,0.2,1) infinite',
                }}
              />
              {/* Wave 2 — trailing, offset */}
              <span
                className="pointer-events-none absolute inset-y-0 w-[40px]"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(125,211,252,0.18) 50%, transparent 100%)',
                  filter: 'blur(5px)',
                  animation: 'wave-flow-2 2.2s cubic-bezier(0.4,0,0.2,1) 0.35s infinite',
                }}
              />
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
