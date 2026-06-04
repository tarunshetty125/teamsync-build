import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type TeamSyncOnboardingV1 = {
  persona: string;
  industry: string;
  discoverySource: string;
  completedAt: string;
  onboardingVersion: 1;
  completedInVersion: string;
};

export type GoogleAuthUserWithOnboarding = {
  id?: string;
  googleId?: string;
  name: string;
  email: string;
  picture?: string;
  calendarConnected?: boolean;
  isNewUser?: boolean;
  onboardingV1?: TeamSyncOnboardingV1 | null;
};

type ReferenceOnboardingModalProps = {
  isOpen: boolean;
  user: GoogleAuthUserWithOnboarding | null;
  onComplete: (user: GoogleAuthUserWithOnboarding) => void;
};

type Option = {
  id: string;
  label: string;
};

type PersonaOption = Option & {
  description: string;
  glow: string;
  border: string;
};

const PERSONA_OPTIONS: PersonaOption[] = [
  {
    id: 'interview_preparation',
    label: 'Interview Preparation',
    description: 'Interviews, prep calls, career practice',
    glow: 'radial-gradient(circle at 75% 76%, rgba(58,213,224,0.74), rgba(12,45,57,0.78) 43%, rgba(5,5,5,0.04) 73%)',
    border: 'rgba(86,174,222,0.72)',
  },
  {
    id: 'meetings_calls',
    label: 'Meetings & Calls',
    description: 'Client calls, team syncs, stakeholder meetings',
    glow: 'radial-gradient(circle at 83% 78%, rgba(232,151,61,0.82), rgba(64,38,17,0.82) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(213,181,91,0.76)',
  },
  {
    id: 'developer',
    label: 'Developer',
    description: 'Code reviews, standups, technical deep dives',
    glow: 'radial-gradient(circle at 78% 84%, rgba(188,48,211,0.86), rgba(39,8,47,0.8) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(205,35,190,0.82)',
  },
  {
    id: 'explore_teamsync',
    label: 'Explore TeamSync',
    description: 'Explore how TeamSync fits in with your workflow',
    glow: 'radial-gradient(circle at 84% 84%, rgba(66,219,169,0.78), rgba(12,54,42,0.82) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(51,202,161,0.78)',
  },
];

const INDUSTRY_OPTIONS: Option[] = [
  { id: 'engineering', label: 'Engineering' },
  { id: 'cloud_computing', label: 'Cloud Computing' },
  { id: 'devops', label: 'DevOps' },
  { id: 'data_analytics', label: 'Data Analytics' },
  { id: 'design', label: 'Design' },
  { id: 'finance', label: 'Finance' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'product', label: 'Product' },
  { id: 'sales', label: 'Sales' },
  { id: 'recruiting', label: 'Recruiting' },
  { id: 'operations', label: 'Operations' },
  { id: 'hr', label: 'HR' },
  { id: 'management', label: 'Management' },
  { id: 'student', label: 'Student' },
  { id: 'other', label: 'Other' },
];

const DISCOVERY_OPTIONS: Option[] = [
  { id: 'google', label: 'Google' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'friend', label: 'Friend' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'twitter_x', label: 'X/Twitter' },
  { id: 'email', label: 'Email' },
  { id: 'other', label: 'Other' },
];

const exitTransition = {
  duration: 0.26,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};

const modalEntryState = {
  opacity: 0,
  y: 108,
  scale: 0.978,
};

const modalVisibleState = {
  opacity: 1,
  y: 0,
  scale: 1,
};

const modalExitState = {
  opacity: 0,
  y: -14,
  scale: 0.996,
  transition: exitTransition,
};

const modalVariants: Variants = {
  hidden: modalEntryState,
  visible: {
    ...modalVisibleState,
    transition: {
      type: 'spring',
      duration: 0.96,
      bounce: 0.18,
      delayChildren: 0.18,
      staggerChildren: 0.075,
    },
  },
  advanceExit: {
    opacity: 0,
    y: 118,
    scale: 0.982,
    transition: {
      duration: 0.88,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: modalExitState,
};

const contentItemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 18,
    scale: 0.992,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      duration: 0.72,
      bounce: 0.12,
    },
  },
};

const contentGroupVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.1,
      staggerChildren: 0.065,
    },
  },
};

const modalFrameStyle = {
  backfaceVisibility: 'hidden' as const,
};

function ModalFrameBorder({
  radiusClass = 'rounded-[15px]',
  borderClass = 'border-[#a1a3aa]/55',
}: {
  radiusClass?: string;
  borderClass?: string;
}) {
  const bottomFadeMask = 'linear-gradient(to bottom, #000 0, #000 calc(100% - 30px), transparent calc(100% - 10px))';

  return (
    <div
      className={`pointer-events-none absolute inset-0 ${radiusClass} border ${borderClass}`}
      style={{
        WebkitMaskImage: bottomFadeMask,
        maskImage: bottomFadeMask,
      }}
    />
  );
}

function ChipGroup({
  options,
  selected,
  onSelect,
  layoutId,
  testId,
}: {
  options: Option[];
  selected: string | null;
  onSelect: (id: string) => void;
  layoutId: string;
  testId?: string;
}) {
  return (
    <LayoutGroup>
      <motion.div variants={contentGroupVariants} className="flex flex-wrap gap-[8px]">
        {options.map((option) => {
          const isSelected = selected === option.id;
          return (
            <motion.button
              key={option.id}
              type="button"
              layout
              variants={contentItemVariants}
              whileHover={{ scale: 1.025 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => onSelect(option.id)}
              data-testid={testId}
              className={`relative h-[34px] overflow-hidden rounded-full border px-[13px] text-[14px] font-semibold transition-colors duration-200 ${
                isSelected
                  ? 'border-[#7b8190] bg-[#242832] text-white/88'
                  : 'border-[#3a4050] bg-[#191c24] text-white/62 hover:border-[#596174] hover:text-white/82'
              }`}
            >
              {isSelected ? (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 rounded-full bg-white/[0.08] shadow-[0_0_22px_rgba(255,255,255,0.11)]"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              ) : null}
              <span className="relative z-10">{option.label}</span>
            </motion.button>
          );
        })}
      </motion.div>
    </LayoutGroup>
  );
}

export function ReferenceOnboardingModal({
  isOpen,
  user,
  onComplete,
}: ReferenceOnboardingModalProps) {
  const [step, setStep] = useState<'persona' | 'details' | 'complete'>('persona');
  const [persona, setPersona] = useState<string | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const [discoverySource, setDiscoverySource] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isAdvancingToDetails, setIsAdvancingToDetails] = useState(false);
  const advanceTimerRef = useRef<number | null>(null);

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current === null) return;
    window.clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
  };

  useEffect(() => {
    clearAdvanceTimer();
    if (!isOpen) return;
    setStep('persona');
    setPersona(null);
    setIndustry(null);
    setDiscoverySource(null);
    setIsSaving(false);
    setSaveError(null);
    setIsAdvancingToDetails(false);

    return clearAdvanceTimer;
  }, [isOpen, user?.email]);

  const handlePersonaSelect = (id: string) => {
    if (isSaving || isAdvancingToDetails) return;
    setPersona(id);
    setSaveError(null);
    setIsAdvancingToDetails(true);
    clearAdvanceTimer();
    advanceTimerRef.current = window.setTimeout(() => {
      setStep('details');
      setIsAdvancingToDetails(false);
      advanceTimerRef.current = null;
    }, 2000);
  };

  const handleSave = async (
    personaValue = persona,
    industryValue = industry,
    discoverySourceValue = discoverySource
  ) => {
    if (!personaValue || !industryValue || !discoverySourceValue || isSaving) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await window.electronAPI?.googleSaveOnboardingV1?.({
        persona: personaValue,
        industry: industryValue,
        discoverySource: discoverySourceValue,
        onboardingVersion: 1,
        completedInVersion: '1.0.0',
      });

      if (!result?.success || result.user?.onboardingV1?.onboardingVersion !== 1) {
        throw new Error(result?.error || 'Could not save onboarding. Please try again.');
      }

      setStep('complete');
      window.setTimeout(() => {
        onComplete(result.user as GoogleAuthUserWithOnboarding);
      }, 780);
    } catch (error: any) {
      setSaveError(error?.message || 'Could not save onboarding. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleIndustrySelect = (id: string) => {
    if (isSaving) return;
    setIndustry(id);
    setSaveError(null);
    if (persona && discoverySource) {
      void handleSave(persona, id, discoverySource);
    }
  };

  const handleDiscoverySourceSelect = (id: string) => {
    if (isSaving) return;
    setDiscoverySource(id);
    setSaveError(null);
    if (persona && industry) {
      void handleSave(persona, industry, id);
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="teamsync-reference-onboarding"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[130] flex items-start justify-center overflow-hidden bg-[linear-gradient(180deg,rgba(0,0,0,0.70)_0%,rgba(0,0,0,0.50)_42%,rgba(0,0,0,0.24)_100%)] pt-[154px] text-white backdrop-blur-[6px] backdrop-saturate-[0.72]"
          data-testid="reference-onboarding-backdrop"
        >
          <AnimatePresence mode="wait">
            {step === 'persona' ? (
              <motion.div
                key="persona-modal"
                variants={modalVariants}
                initial="hidden"
                animate={isAdvancingToDetails ? 'advanceExit' : 'visible'}
                exit="exit"
                className={`relative w-[calc(100vw-32px)] max-w-[500px] transform-gpu overflow-hidden rounded-[15px] bg-[#020202] px-[40px] pb-[16px] pt-[50px] shadow-[0_26px_90px_rgba(0,0,0,0.62)] will-change-transform ${
                  isAdvancingToDetails ? 'pointer-events-none' : ''
                }`}
                data-testid="persona-modal"
                style={modalFrameStyle}
              >
                <ModalFrameBorder />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_93%,rgba(109,55,28,0.13),transparent_43%),radial-gradient(circle_at_70%_94%,rgba(91,45,18,0.11),transparent_46%)]" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#020202]" />
                <motion.div variants={contentItemVariants} className="mx-auto max-w-[420px] text-center">
                  <h2 className="relative whitespace-nowrap text-[37px] font-semibold leading-[1.04] text-white/88 drop-shadow-[0_0_10px_rgba(255,255,255,0.24)]">
                    Which one fits you best?
                  </h2>
                  <p className="relative mx-auto mt-[18px] max-w-[330px] text-[14px] font-semibold leading-[1.45] text-white/56">
                    TeamSync adapts to you and your meetings - fitting into your daily rhythm.
                  </p>
                </motion.div>

                <motion.div
                  variants={contentGroupVariants}
                  className="relative mt-[52px] grid grid-cols-2 gap-[8px]"
                  data-testid="persona-card-grid"
                >
                  {PERSONA_OPTIONS.map((option) => {
                    const isSelected = option.id === persona;
                    return (
                      <motion.button
                        key={option.id}
                        type="button"
                        variants={contentItemVariants}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.985 }}
                        onClick={() => handlePersonaSelect(option.id)}
                        className="group relative h-[136px] overflow-hidden rounded-[14px] border bg-[#050505] p-[16px] text-left transition-colors duration-200"
                        data-testid="persona-card"
                        style={{
                          borderColor: isSelected ? 'rgba(255,255,255,0.58)' : option.border,
                          boxShadow: isSelected
                            ? `0 0 32px ${option.border}, inset 0 0 0 1px rgba(255,255,255,0.08)`
                            : 'inset 0 0 0 1px rgba(255,255,255,0.03)',
                        }}
                      >
                        <div
                          className="pointer-events-none absolute inset-0 opacity-90 transition-opacity duration-200 group-hover:opacity-100"
                          style={{ background: option.glow }}
                        />
                        <div className="pointer-events-none absolute inset-0 rounded-[14px] bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.08),transparent_42%)]" />
                        {isSelected ? (
                          <motion.div
                            layoutId="persona-selected-highlight"
                            className="pointer-events-none absolute inset-0 rounded-[14px] border border-white/36"
                            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                          />
                        ) : null}
                        <div className="relative z-10">
                          <div className="text-[16px] font-bold leading-tight text-white/84">
                            {option.label}
                          </div>
                          <div className="mt-[12px] max-w-[18ch] text-[14px] font-semibold leading-[1.5] text-white/58">
                            {option.description}
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                </motion.div>

              </motion.div>
            ) : null}

            {step === 'details' ? (
              <motion.div
                key="details-modal"
                variants={modalVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="relative max-h-none w-[calc(100vw-32px)] max-w-[500px] transform-gpu overflow-hidden rounded-[15px] bg-[#020202] px-[40px] pb-[28px] pt-[49px] shadow-[0_26px_90px_rgba(0,0,0,0.62)] will-change-transform"
                data-testid="industry-modal"
                style={modalFrameStyle}
              >
                <ModalFrameBorder />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_92%,rgba(91,44,24,0.13),transparent_43%),radial-gradient(circle_at_68%_90%,rgba(84,43,16,0.10),transparent_48%)]" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#020202]" />
                <motion.div variants={contentItemVariants} className="mx-auto max-w-[420px] text-center">
                  <h2 className="relative text-[40px] font-semibold leading-[1.05] text-white/88 drop-shadow-[0_0_10px_rgba(255,255,255,0.24)]">
                    Tell us more
                  </h2>
                  <p className="relative mx-auto mt-[17px] max-w-[430px] whitespace-nowrap text-[14px] font-semibold leading-[1.45] text-white/56">
                    We'll use this to customize your onboarding experience.
                  </p>
                </motion.div>

                <motion.div variants={contentItemVariants} className="relative mt-[34px]">
                  <div className="text-[17px] font-bold leading-tight text-white/90">
                    What industry are you in?
                  </div>
                  <div className="mt-[10px]">
                    <ChipGroup
                      options={INDUSTRY_OPTIONS}
                      selected={industry}
                      onSelect={handleIndustrySelect}
                      layoutId="industry-chip-highlight"
                      testId="industry-chip"
                    />
                  </div>
                </motion.div>

                <motion.div variants={contentItemVariants} className="relative mt-[32px]">
                  <div className="text-[17px] font-bold leading-tight text-white/90">
                    How did you hear about TeamSync?
                  </div>
                  <div className="mt-[10px]">
                    <ChipGroup
                      options={DISCOVERY_OPTIONS}
                      selected={discoverySource}
                      onSelect={handleDiscoverySourceSelect}
                      layoutId="discovery-chip-highlight"
                      testId="discovery-chip"
                    />
                  </div>
                </motion.div>

                {(saveError || isSaving) ? (
                  <motion.div variants={contentItemVariants} className="relative mt-[18px] min-h-[16px] text-[12px] font-semibold leading-snug text-white/42">
                    {isSaving ? 'Saving...' : `${saveError} Select a chip to retry.`}
                  </motion.div>
                ) : null}
              </motion.div>
            ) : null}

            {step === 'complete' ? (
              <motion.div
                key="complete-modal"
                variants={modalVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="relative flex w-[calc(100vw-32px)] max-w-[552px] transform-gpu flex-col items-center overflow-hidden rounded-[24px] bg-[#050505] px-[40px] py-[54px] text-center shadow-[0_26px_90px_rgba(0,0,0,0.62)] will-change-transform"
                style={modalFrameStyle}
              >
                <ModalFrameBorder radiusClass="rounded-[24px]" borderClass="border-white/[0.08]" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#050505]" />
                <motion.div
                  initial={{ scale: 0.72, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-300/24 bg-emerald-400/12 text-emerald-200 shadow-[0_0_36px_rgba(52,211,153,0.24)]"
                >
                  <Check className="h-6 w-6" strokeWidth={2.4} />
                </motion.div>
                <div className="mt-6 text-[30px] font-semibold tracking-[-0.01em] text-white/90">
                  TeamSync is ready
                </div>
                <p className="mt-3 max-w-[320px] text-[14px] font-semibold leading-[1.45] text-white/50">
                  Opening your default workspace.
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
