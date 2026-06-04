import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type TourStep = {
  id: 'control-center' | 'profile-intelligence' | 'overlay-control' | 'interview-mode' | 'settings';
  title: string;
  description: string;
};

type GuidedProductTourProps = {
  isOpen: boolean;
  onOpenSettings: (tab?: string) => void;
  onCloseSettings: () => void;
  onComplete: () => void;
  onSkip: () => void;
};

const TOUR_STEPS: TourStep[] = [
  {
    id: 'control-center',
    title: 'Control Center',
    description: 'Search meetings, ask TeamSync, and move through your workspace from one command surface.',
  },
  {
    id: 'profile-intelligence',
    title: 'Profile Intelligence',
    description: 'Add resume and role context when you want TeamSync to answer from your background.',
  },
  {
    id: 'overlay-control',
    title: 'Overlay',
    description: 'Start TeamSync when you want live screen and audio intelligence during a session.',
  },
  {
    id: 'interview-mode',
    title: 'Interview Mode',
    description: 'Switch into specialized modes for interviews, coding rounds, and meeting contexts.',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Tune providers, audio, calendar, profile, and workspace preferences when needed.',
  },
];

function readTargetRect(id: string): DOMRect | null {
  const target = document.querySelector(`[data-tour-id="${id}"]`);
  if (!target) return null;
  return target.getBoundingClientRect();
}

function clampPanelPosition(rect: DOMRect | null) {
  const panelWidth = 320;
  const panelHeight = 160;
  if (!rect) {
    return {
      left: Math.max(24, (window.innerWidth - panelWidth) / 2),
      top: Math.max(24, (window.innerHeight - panelHeight) / 2),
    };
  }

  const preferredLeft = rect.left + rect.width / 2 - panelWidth / 2;
  const below = rect.bottom + 16;
  const above = rect.top - panelHeight - 16;
  return {
    left: Math.min(Math.max(24, preferredLeft), Math.max(24, window.innerWidth - panelWidth - 24)),
    top: below + panelHeight < window.innerHeight - 24 ? below : Math.max(24, above),
  };
}

export function GuidedProductTour({
  isOpen,
  onOpenSettings,
  onCloseSettings,
  onComplete,
  onSkip,
}: GuidedProductTourProps) {
  const [index, setIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  useEffect(() => {
    if (!isOpen) return;
    setIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (step.id === 'profile-intelligence') {
      onOpenSettings('profile');
    } else {
      onCloseSettings();
    }

    const updateRect = () => setTargetRect(readTargetRect(step.id));
    const t = window.setTimeout(updateRect, step.id === 'profile-intelligence' ? 180 : 60);
    window.addEventListener('resize', updateRect);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', updateRect);
    };
  }, [isOpen, onCloseSettings, onOpenSettings, step.id]);

  const panelPosition = useMemo(() => clampPanelPosition(targetRect), [targetRect]);

  const handleNext = () => {
    if (isLast) {
      onComplete();
      return;
    }
    setIndex((value) => value + 1);
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="guided-product-tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none fixed inset-0 z-[95]"
          data-testid="onboarding-v2-tour"
        >
          {targetRect ? (
            <motion.div
              layout
              className="absolute rounded-[14px] border border-white/40 shadow-[0_0_0_9999px_rgba(0,0,0,0.18),0_0_32px_rgba(255,255,255,0.14)]"
              style={{
                left: targetRect.left - 6,
                top: targetRect.top - 6,
                width: targetRect.width + 12,
                height: targetRect.height + 12,
              }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            />
          ) : null}

          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 10, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto fixed w-[320px] overflow-hidden rounded-[16px] border border-white/[0.12] bg-[#08090d]/[0.88] p-4 text-white shadow-[0_22px_70px_rgba(0,0,0,0.46)] backdrop-blur-[28px]"
            style={{ left: panelPosition.left, top: panelPosition.top }}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_88%_92%,rgba(126,108,213,0.16),transparent_46%)]" />
            <div className="relative">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/[0.38]">
                  {index + 1} / {TOUR_STEPS.length}
                </span>
                <button
                  type="button"
                  onClick={onSkip}
                  className="inline-flex h-7 items-center gap-1 rounded-[8px] px-2 text-[11px] font-semibold text-white/[0.48] transition-colors hover:bg-white/[0.06] hover:text-white/[0.78]"
                >
                  <X className="h-3.5 w-3.5" />
                  Skip
                </button>
              </div>
              <h2 className="text-[16px] font-semibold text-white/[0.92]">{step.title}</h2>
              <p className="mt-2 text-[12px] font-medium leading-5 text-white/[0.55]">{step.description}</p>
              <button
                type="button"
                onClick={handleNext}
                className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-[9px] border border-white/[0.16] bg-white/[0.92] px-4 text-[12px] font-bold text-[#050506] transition-colors hover:bg-white active:scale-[0.985]"
              >
                {isLast ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Finish tour
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
