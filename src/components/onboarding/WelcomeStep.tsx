import { motion } from 'framer-motion';
import { AudioLines, Eye, FileText, Sparkles, Waves } from 'lucide-react';

interface WelcomeStepProps {
  onContinue: () => void;
}

const FEATURES = [
  {
    icon: Eye,
    title: 'Screen understanding',
    description: 'See IDEs, browser tabs, shared decks, and live interview prompts in context.',
  },
  {
    icon: AudioLines,
    title: 'Live transcription',
    description: 'Capture both your microphone and meeting audio in realtime with production STT.',
  },
  {
    icon: Sparkles,
    title: 'Interview assistance',
    description: 'Answer faster with contextual prompts, overlays, and instant follow-through.',
  },
  {
    icon: FileText,
    title: 'Notes generation',
    description: 'Turn meetings into summaries, action items, and searchable intelligence.',
  },
];

export function WelcomeStep({ onContinue }: WelcomeStepProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(90,157,255,0.22),transparent_34%),linear-gradient(180deg,rgba(15,22,32,0.98),rgba(7,11,18,0.96))] p-7 shadow-[0_30px_90px_rgba(0,0,0,0.44)]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.08),transparent_28%)]" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/7 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/72">
            <Waves className="h-3.5 w-3.5" />
            TeamSync realtime intelligence
          </div>

          <h1 className="mt-6 max-w-[12ch] font-celeb text-[40px] leading-[0.98] tracking-[-0.05em] text-white sm:text-[52px]">
            TeamSync needs permissions to power realtime meeting intelligence.
          </h1>

          <p className="mt-5 max-w-[58ch] text-base leading-7 text-white/68">
            Grant a few system-level permissions once so TeamSync can capture meetings, understand shared screens,
            support interviews, and keep the overlay assistant live while you work.
          </p>

          <div className="mt-8 flex flex-wrap gap-3 text-sm text-white/58">
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">meeting capture</span>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">overlay intelligence</span>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5">context-aware assistance</span>
          </div>

          <button
            type="button"
            onClick={onContinue}
            className="mt-10 inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold tracking-[-0.01em] text-[#08111c] shadow-[0_16px_40px_rgba(255,255,255,0.16)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/92"
          >
            Continue setup
          </button>
        </div>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        {FEATURES.map((feature, index) => {
          const Icon = feature.icon;

          return (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, delay: 0.08 * index, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(22,28,38,0.92),rgba(12,17,26,0.9))] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.28)]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/7 text-white">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-lg font-medium tracking-[-0.02em] text-white">{feature.title}</h2>
              <p className="mt-2 text-sm leading-6 text-white/62">{feature.description}</p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
