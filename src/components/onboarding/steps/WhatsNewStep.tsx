import { motion, AnimatePresence } from 'framer-motion';
import {
  Smartphone,
  Brain,
  Terminal,
  Sparkles,
  Cloud,
  Layers,
  LayoutGrid,
  ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/* ── Types ── */
export type WhatsNewStepProps = {
  isAdvancing: boolean;
  onContinue: () => void;
  onSkip: () => void;
};

/* ── Feature data ── */
interface Feature {
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;          // HSL color for icon circle
  accentGlow: string;      // Matching top-edge glow
  wide?: boolean;          // Spans 2 columns
}

const FEATURES: Feature[] = [
  {
    title: 'Quietly Mirror',
    description: 'Mirror AI responses to your phone in real-time with a spatial glass UI.',
    icon: Smartphone,
    accent: 'hsl(195, 90%, 50%)',
    accentGlow: 'rgba(14, 165, 233, 0.35)',
  },
  {
    title: 'Persona',
    description: 'Upload your resume, JD, and context — AI learns who you are.',
    icon: Brain,
    accent: 'hsl(38, 85%, 55%)',
    accentGlow: 'rgba(217, 167, 49, 0.30)',
  },
  {
    title: 'Codex CLI',
    description: 'Run OpenAI Codex models locally as your streaming AI provider.',
    icon: Terminal,
    accent: 'hsl(152, 68%, 46%)',
    accentGlow: 'rgba(34, 197, 94, 0.30)',
  },
  {
    title: 'Skills & Commands',
    description: 'Type / or $ in the overlay to invoke custom AI skills and workflows instantly.',
    icon: Sparkles,
    accent: 'hsl(270, 76%, 62%)',
    accentGlow: 'rgba(168, 85, 247, 0.30)',
    wide: true,
  },
  {
    title: 'AI Providers',
    description: 'New AWS Bedrock support via CLI — connect enterprise AI at scale.',
    icon: Cloud,
    accent: 'hsl(24, 85%, 55%)',
    accentGlow: 'rgba(234, 134, 45, 0.30)',
  },
  {
    title: 'Pro Overlay V2',
    description: 'Redesigned overlay with floating bar, better streaming, and spatial depth.',
    icon: Layers,
    accent: 'hsl(217, 85%, 56%)',
    accentGlow: 'rgba(59, 130, 246, 0.30)',
  },
  {
    title: 'Meeting Modes',
    description: '11 specialized modes — Interview, Sales, Lecture, Recruiting, and more. Each auto-tunes AI responses.',
    icon: LayoutGrid,
    accent: 'hsl(172, 66%, 50%)',
    accentGlow: 'rgba(45, 212, 191, 0.28)',
    wide: true,
  },
];

/* ── Animation variants ── */
const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.15,
    },
  },
};

const itemUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE },
  },
};

const cardVariant = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, duration: 0.65, bounce: 0.10 },
  },
};

/* ── Feature Card ── */
function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  return (
    <motion.div
      variants={cardVariant}
      className={`group relative overflow-hidden rounded-[16px] p-5 ${feature.wide ? 'col-span-2' : ''}`}
      style={{
        background: '#0f1218',
        border: '1px solid rgba(255,255,255,0.06)',
        minHeight: '130px',
      }}
    >
      {/* Top edge glow */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-60"
        style={{
          background: `linear-gradient(90deg, transparent 10%, ${feature.accentGlow} 50%, transparent 90%)`,
        }}
      />
      {/* Inner radial glow */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: `radial-gradient(ellipse 60% 50% at 50% 0%, ${feature.accentGlow} 0%, transparent 70%)`,
        }}
      />

      {/* Icon circle */}
      <div
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-[10px]"
        style={{
          background: `${feature.accent}18`,
          border: `1px solid ${feature.accent}28`,
        }}
      >
        <Icon
          size={17}
          strokeWidth={1.8}
          style={{ color: feature.accent }}
        />
      </div>

      {/* Title */}
      <h3
        className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-white/92"
        style={{ letterSpacing: '-0.01em' }}
      >
        {feature.title}
      </h3>

      {/* Description */}
      <p className="mt-1.5 text-[12.5px] font-medium leading-[1.45] text-white/48">
        {feature.description}
      </p>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

export function WhatsNewStep({ isAdvancing, onContinue, onSkip }: WhatsNewStepProps) {
  return (
    <motion.div
      key="whats-new-step"
      initial={{ opacity: 0 }}
      animate={isAdvancing ? { opacity: 0, scale: 1.02 } : { opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
      transition={{ duration: 0.4, ease: EASE }}
      className={`fixed inset-0 z-[140] flex items-center justify-center overflow-hidden ${isAdvancing ? 'pointer-events-none' : ''}`}
      style={{
        backgroundColor: '#08090f',
        fontFamily: "'Inter', 'Geist', ui-sans-serif, system-ui, sans-serif",
      }}
    >
      {/* Subtle dot grid */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />
      {/* Vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 80% 70% at 50% 45%, transparent 30%, #08090f 100%)',
        }}
      />

      {/* Content */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="relative z-10 mx-auto flex w-full max-w-[820px] flex-col items-center px-6"
      >
        {/* Eyebrow */}
        <motion.div
          variants={itemUp}
          className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/[0.06] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-300/70"
        >
          <Sparkles size={12} />
          Quietly 2.7
        </motion.div>

        {/* Title */}
        <motion.h1
          variants={itemUp}
          className="text-center text-[42px] font-semibold leading-[1.06] tracking-[-0.04em] text-white/92"
          style={{ textShadow: '0 0 40px rgba(255,255,255,0.08)' }}
        >
          What's New
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          variants={itemUp}
          className="mt-3 text-center text-[15px] font-medium leading-relaxed text-white/45"
        >
          Seven powerful upgrades to supercharge your meetings
        </motion.p>

        {/* Bento Grid */}
        <motion.div
          variants={containerVariants}
          className="mt-8 grid w-full grid-cols-3 gap-3"
        >
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div variants={itemUp} className="mt-8 flex flex-col items-center gap-3">
          <motion.button
            type="button"
            onClick={onContinue}
            disabled={isAdvancing}
            whileHover={{ scale: 1.02, y: -1 }}
            whileTap={{ scale: 0.98 }}
            className="group relative flex h-[50px] w-[260px] items-center justify-center gap-2 overflow-hidden rounded-full text-[15px] font-semibold text-white outline-none transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #082f49 0%, #0ea5e9 52%, #2563eb 100%)',
              boxShadow:
                'inset 0 1px 1px rgba(255,255,255,0.5), inset 0 -1px 2px rgba(8,47,73,0.3), 0 4px 16px rgba(14,165,233,0.32), 0 0 0 1px rgba(255,255,255,0.10)',
            }}
          >
            {/* Glass bevel */}
            <span
              className="pointer-events-none absolute inset-x-3 top-0 h-[40%] rounded-b-full"
              style={{
                background: 'linear-gradient(to bottom, rgba(255,255,255,0.35), transparent)',
                filter: 'blur(2px)',
                opacity: 0.75,
              }}
            />
            <span className="relative z-10 flex items-center gap-2">
              Get Started
              <ArrowRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
          </motion.button>

          <button
            type="button"
            onClick={onSkip}
            disabled={isAdvancing}
            className="text-[13px] font-medium text-white/30 transition-colors hover:text-white/50 disabled:cursor-not-allowed"
          >
            Skip
          </button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
