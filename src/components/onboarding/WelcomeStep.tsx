import { motion } from 'framer-motion';
import { AudioLines, Eye, FileText, Layers, Sparkles } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.11,
      delayChildren: 0.15,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 220, damping: 22 },
  },
};

interface WelcomeStepProps {
  onContinue: () => void;
}

const FEATURES = [
  {
    icon: Eye,
    title: 'Screen understanding',
    description: 'See IDEs, browser tabs, shared decks, and live interview prompts in context.',
    bg: 'rgba(99,102,241,0.06)',
    border: 'rgba(129,140,248,0.18)',
    iconBg: 'rgba(99,102,241,0.12)',
    iconBorder: 'rgba(129,140,248,0.25)',
    iconColor: 'rgba(165,180,252,0.85)',
    dot: '#a5b4fc',
  },
  {
    icon: AudioLines,
    title: 'Live transcription',
    description: 'Capture microphone and meeting audio in realtime with production STT.',
    bg: 'rgba(139,92,246,0.06)',
    border: 'rgba(167,139,250,0.18)',
    iconBg: 'rgba(139,92,246,0.12)',
    iconBorder: 'rgba(167,139,250,0.25)',
    iconColor: 'rgba(196,181,253,0.85)',
    dot: '#c4b5fd',
  },
  {
    icon: Sparkles,
    title: 'Interview assistance',
    description: 'Answer faster with contextual prompts, overlays, and instant follow-through.',
    bg: 'rgba(16,185,129,0.06)',
    border: 'rgba(52,211,153,0.18)',
    iconBg: 'rgba(16,185,129,0.12)',
    iconBorder: 'rgba(52,211,153,0.25)',
    iconColor: 'rgba(110,231,183,0.85)',
    dot: '#6ee7b7',
  },
  {
    icon: FileText,
    title: 'Notes generation',
    description: 'Turn meetings into summaries, action items, and searchable intelligence.',
    bg: 'rgba(245,158,11,0.06)',
    border: 'rgba(251,191,36,0.18)',
    iconBg: 'rgba(245,158,11,0.12)',
    iconBorder: 'rgba(251,191,36,0.25)',
    iconColor: 'rgba(253,230,138,0.85)',
    dot: '#fde68a',
  },
];

// Isolated typing component — never re-renders parent
const TypewriterText = memo(function TypewriterText({
  text,
  startDelay = 0,
}: {
  text: string;
  startDelay?: number;
}) {
  const [displayed, setDisplayed] = useState('');
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    indexRef.current = 0;
    setDisplayed('');

    const startTimer = setTimeout(() => {
      const tick = () => {
        if (indexRef.current < text.length) {
          indexRef.current += 1;
          setDisplayed(text.slice(0, indexRef.current));
          timerRef.current = setTimeout(tick, 22);
        }
      };
      tick();
    }, startDelay);

    return () => {
      clearTimeout(startTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, startDelay]);

  return (
    <span>
      {displayed}
      {displayed.length < text.length && (
        <span className="ml-px inline-block h-[1em] w-px animate-pulse bg-white/40 align-middle" />
      )}
    </span>
  );
});

function FeatureCard({
  feature,
  index,
}: {
  feature: (typeof FEATURES)[number];
  index: number;
}) {
  const Icon = feature.icon;
  const typeDelay = 400 + index * 600;

  return (
    <motion.div
      variants={cardVariants}
      className="group relative flex items-center gap-3 overflow-hidden rounded-[18px] p-4 backdrop-blur-[40px] backdrop-saturate-[160%] transition-all"
      style={{
        background: feature.bg,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: feature.border,
      }}
    >
      {/* Inner glass shimmer */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.04] via-transparent to-transparent" />
      {/* Accent dot top-right */}
      <div
        className="pointer-events-none absolute right-4 top-4 h-1.5 w-1.5 rounded-full opacity-70"
        style={{ background: feature.dot, boxShadow: `0 0 8px ${feature.dot}` }}
      />

      {/* Icon */}
      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
        style={{
          background: feature.iconBg,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: feature.iconBorder,
          color: feature.iconColor,
        }}
      >
        <Icon className="h-4 w-4" strokeWidth={1.5} />
      </div>

      {/* Text */}
      <div className="relative min-w-0">
        <h2 className="text-[13px] font-medium text-white/90">{feature.title}</h2>
        <p className="mt-0.5 min-h-[2.5em] text-[11px] leading-relaxed text-white/40">
          <TypewriterText text={feature.description} startDelay={typeDelay} />
        </p>
      </div>
    </motion.div>
  );
}

export function WelcomeStep({ onContinue }: WelcomeStepProps) {
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
      {/* Left hero glass panel */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col justify-between overflow-hidden rounded-[24px] border border-white/15 border-t-white/25 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-[50px] backdrop-saturate-[180%]"
        style={{ background: 'rgba(255,255,255,0.055)' }}
      >
        {/* Inner glass reflection gradient */}
        <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-gradient-to-br from-white/[0.07] via-transparent to-white/[0.02]" />

        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-md">
            <Layers className="h-3 w-3" />
            TeamSync Realtime Intelligence
          </div>

          <h1 className="mt-4 text-[22px] font-medium leading-[1.15] tracking-[-0.03em] text-white">
            TeamSync needs permissions to power realtime meeting intelligence.
          </h1>

          <p className="mt-3 text-[13px] leading-relaxed text-white/55">
            Grant these once so TeamSync can capture meetings, understand shared screens, and keep the overlay live while you work.
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {['meeting capture', 'overlay intelligence', 'context-aware'].map(pill => (
              <span
                key={pill}
                className="rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-[11px] text-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-sm"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="relative mt-6 inline-flex w-fit items-center justify-center gap-2 overflow-hidden rounded-xl border border-emerald-400/30 bg-emerald-500/[0.15] px-5 py-2.5 text-[13px] font-semibold text-emerald-200 shadow-[0_0_20px_rgba(52,211,153,0.12),inset_0_1px_0_rgba(52,211,153,0.2)] backdrop-blur-xl transition-all active:scale-[0.97] hover:bg-emerald-500/25 hover:border-emerald-400/50 hover:shadow-[0_0_28px_rgba(52,211,153,0.2)]"
        >
          Continue setup
        </button>
      </motion.div>

      {/* Right: feature cards with orchestrated spring stagger */}
      <motion.div
        className="flex flex-col gap-2"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {FEATURES.map((feature, index) => (
          <FeatureCard key={feature.title} feature={feature} index={index} />
        ))}
      </motion.div>
    </div>
  );
}
