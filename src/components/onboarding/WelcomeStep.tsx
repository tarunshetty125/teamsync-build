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
    bg: 'var(--bg-elevated)',
    border: 'var(--border-subtle)',
    iconBg: 'var(--bg-input)',
    iconBorder: 'var(--border-subtle)',
    iconColor: 'var(--text-secondary)',
    dot: 'var(--text-tertiary)',
  },
  {
    icon: AudioLines,
    title: 'Live transcription',
    description: 'Capture microphone and meeting audio in realtime with production STT.',
    bg: 'var(--bg-elevated)',
    border: 'var(--border-subtle)',
    iconBg: 'var(--bg-input)',
    iconBorder: 'var(--border-subtle)',
    iconColor: 'var(--text-secondary)',
    dot: 'var(--text-tertiary)',
  },
  {
    icon: Sparkles,
    title: 'Interview assistance',
    description: 'Answer faster with contextual prompts, overlays, and instant follow-through.',
    bg: 'var(--bg-elevated)',
    border: 'var(--border-subtle)',
    iconBg: 'var(--bg-input)',
    iconBorder: 'var(--border-subtle)',
    iconColor: 'var(--text-secondary)',
    dot: 'var(--text-tertiary)',
  },
  {
    icon: FileText,
    title: 'Notes generation',
    description: 'Turn meetings into summaries, action items, and searchable intelligence.',
    bg: 'var(--bg-elevated)',
    border: 'var(--border-subtle)',
    iconBg: 'var(--bg-input)',
    iconBorder: 'var(--border-subtle)',
    iconColor: 'var(--text-secondary)',
    dot: 'var(--text-tertiary)',
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
        <span className="ml-px inline-block h-[1em] w-px animate-pulse bg-text-tertiary align-middle" />
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
      className="group relative flex items-center gap-3 overflow-hidden rounded-xl p-4 shadow-[0_12px_28px_rgba(0,0,0,0.10)] transition-all hover:-translate-y-0.5"
      style={{
        background: feature.bg,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: feature.border,
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div
        className="pointer-events-none absolute right-4 top-4 h-1.5 w-1.5 rounded-full opacity-60"
        style={{ background: feature.dot }}
      />

      <div
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
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

      <div className="relative min-w-0">
        <h2 className="text-[13px] font-medium text-text-primary">{feature.title}</h2>
        <p className="mt-0.5 min-h-[2.5em] text-[11px] leading-relaxed text-text-secondary">
          <TypewriterText text={feature.description} startDelay={typeDelay} />
        </p>
      </div>
    </motion.div>
  );
}

export function WelcomeStep({ onContinue }: WelcomeStepProps) {
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated p-6 shadow-[0_16px_40px_rgba(0,0,0,0.12)]"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />

        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-input px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-text-secondary">
            <Layers className="h-3 w-3" />
            TeamSync Realtime Intelligence
          </div>

          <h1 className="mt-4 text-[22px] font-medium leading-[1.15] tracking-[-0.03em] text-text-primary">
            TeamSync needs permissions to power realtime meeting intelligence.
          </h1>

          <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
            Grant these once so TeamSync can capture meetings, understand shared screens, and keep the overlay live while you work.
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {['meeting capture', 'overlay intelligence', 'context-aware'].map(pill => (
              <span
                key={pill}
                className="rounded-md border border-border-subtle bg-bg-input px-2.5 py-1 text-[11px] text-text-secondary"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="relative mt-6 inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md bg-text-primary px-4 text-[13px] font-semibold text-bg-primary shadow-sm transition-all hover:opacity-90 active:scale-[0.98]"
        >
          Continue setup
        </button>
      </motion.div>

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
