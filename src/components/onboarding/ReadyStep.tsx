import { motion } from 'framer-motion';
import { Check, CheckCircle2, Sparkles } from 'lucide-react';

interface ReadyStepProps {
  onLaunch: () => void;
}

const READY_ITEMS = ['Screen Recording', 'Microphone', 'Accessibility'];

export function ReadyStep({ onLaunch }: ReadyStepProps) {
  return (
    <div className="mx-auto max-w-[760px]">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-[36px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(101,214,173,0.18),transparent_36%),linear-gradient(180deg,rgba(16,24,31,0.98),rgba(8,13,20,0.96))] p-8 shadow-[0_34px_110px_rgba(0,0,0,0.42)]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,0.08),transparent_26%)]" />
        <div className="relative text-center">
          <motion.div
            initial={{ scale: 0.82, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.08 }}
            className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-emerald-200/18 bg-emerald-300/12 shadow-[0_0_60px_rgba(82,213,161,0.16)]"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-300/16">
              <CheckCircle2 className="h-9 w-9 text-emerald-200" />
            </div>
          </motion.div>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/7 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/72">
            <Sparkles className="h-3.5 w-3.5" />
            All systems live
          </div>

          <h2 className="mt-5 font-celeb text-[44px] leading-none tracking-[-0.05em] text-white sm:text-[54px]">
            TeamSync is ready.
          </h2>

          <p className="mx-auto mt-4 max-w-[46ch] text-base leading-7 text-white/66">
            Your system is configured for realtime transcription, screen understanding, meeting capture, interview assistance, and overlay intelligence.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {READY_ITEMS.map((item, index) => (
              <motion.div
                key={item}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.36, delay: 0.12 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-4 text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-300/18 text-emerald-100">
                    <Check className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium tracking-[-0.01em] text-white">{item}</span>
                </div>
              </motion.div>
            ))}
          </div>

          <button
            type="button"
            onClick={onLaunch}
            className="mt-10 inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3.5 text-sm font-semibold tracking-[-0.01em] text-[#08111c] shadow-[0_18px_48px_rgba(255,255,255,0.15)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/92"
          >
            Launch TeamSync
          </button>
        </div>
      </motion.div>
    </div>
  );
}
