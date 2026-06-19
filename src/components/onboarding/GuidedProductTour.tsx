import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type TourStep = {
  id:
    | 'control-center'
    | 'overlay-control'
    | 'interview-mode'
    | 'settings'
    | 'profile-intelligence'
    | 'settings-audio-provider'
    | 'settings-calendar-sync'
    | 'settings-ai-providers';
  title: string;
  description: string;
  settingsTab?: 'profile' | 'audio' | 'calendar' | 'ai-providers';
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
    description: 'Search meetings, ask Quietly, and move through your workspace from one command surface.',
  },
  {
    id: 'overlay-control',
    title: 'Overlay',
    description: 'Start Quietly when you want live screen and audio intelligence during a session.',
  },
  {
    id: 'interview-mode',
    title: 'Interview Mode',
    description: 'Switch into specialized modes for interviews, coding rounds, and meeting contexts.',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Open the control surface for workspace, intelligence, and provider configuration.',
  },
  {
    id: 'profile-intelligence',
    title: 'Quietly Intelligence',
    description: 'Add resume and role context when you want Quietly to answer from your background.',
    settingsTab: 'profile',
  },
  {
    id: 'settings-audio-provider',
    title: 'Audio Engine',
    description: 'Choose the speech provider and input path Quietly uses for live transcription.',
    settingsTab: 'audio',
  },
  {
    id: 'settings-calendar-sync',
    title: 'Calendar Context',
    description: 'Connect calendars so meetings can start with agenda and attendee context.',
    settingsTab: 'calendar',
  },
  {
    id: 'settings-ai-providers',
    title: 'AI Providers',
    description: 'Review provider routing and model configuration without leaving the workspace.',
    settingsTab: 'ai-providers',
  },
];

function readTargetRect(id: string): DOMRect | null {
  const target = document.querySelector(`[data-tour-id="${id}"]`);
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return rect;
}

function isSettingsMounted() {
  return Boolean(document.getElementById('settings-backdrop'));
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
  const [hasResolvedTarget, setHasResolvedTarget] = useState(false);
  const onOpenSettingsRef = useRef(onOpenSettings);
  const onCloseSettingsRef = useRef(onCloseSettings);
  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  useEffect(() => {
    onOpenSettingsRef.current = onOpenSettings;
    onCloseSettingsRef.current = onCloseSettings;
  }, [onCloseSettings, onOpenSettings]);

  useEffect(() => {
    if (!isOpen) return;
    setIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let raf = 0;
    let timer = 0;
    if (step.settingsTab) {
      onOpenSettingsRef.current(step.settingsTab);
    } else {
      onCloseSettingsRef.current();
    }

    setTargetRect(null);
    setHasResolvedTarget(false);
    const startedAt = performance.now();
    const maxPollMs = step.settingsTab ? 2200 : 900;

    const updateRect = () => {
      if (cancelled) return;
      const canMeasure = Boolean(step.settingsTab) || !isSettingsMounted();
      const nextRect = canMeasure ? readTargetRect(step.id) : null;
      const elapsed = performance.now() - startedAt;
      setTargetRect(nextRect);
      if (nextRect || elapsed >= maxPollMs) {
        setHasResolvedTarget(true);
      }

      if (elapsed < maxPollMs) {
        raf = window.requestAnimationFrame(updateRect);
      }
    };

    timer = window.setTimeout(updateRect, step.settingsTab ? 120 : 220);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [isOpen, step.id, step.settingsTab]);

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
          className="pointer-events-none fixed inset-0 z-[3600]"
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

          {hasResolvedTarget ? (
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
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
