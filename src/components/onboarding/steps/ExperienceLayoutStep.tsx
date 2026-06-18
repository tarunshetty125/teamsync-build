import { LayoutGroup, motion } from 'framer-motion';
import { Check, Code2, BriefcaseBusiness, MessageSquare, Blocks, Sparkles } from 'lucide-react';
import { useState } from 'react';
import {
  stepModalVariants,
  stepItemVariants,
  stepGroupVariants,
  modalFrameStyle,
  ModalFrameBorder,
} from './animations';

type ExperienceId =
  | 'technical_interview'
  | 'behavioral_interview'
  | 'meetings'
  | 'system_design'
  | 'general_assistant';

const EXPERIENCE_OPTIONS: Array<{
  id: ExperienceId;
  label: string;
  description: string;
  icon: typeof Code2;
  glow: string;
  border: string;
}> = [
  {
    id: 'technical_interview',
    label: 'Technical Interview',
    description: 'DSA, coding rounds, system design interviews',
    icon: Code2,
    glow: 'radial-gradient(circle at 75% 76%, rgba(58,213,224,0.56), rgba(12,45,57,0.6) 43%, rgba(5,5,5,0.04) 73%)',
    border: 'rgba(86,174,222,0.52)',
  },
  {
    id: 'behavioral_interview',
    label: 'Behavioral Interview',
    description: 'Storytelling, STAR method, culture fit',
    icon: BriefcaseBusiness,
    glow: 'radial-gradient(circle at 83% 78%, rgba(232,151,61,0.62), rgba(64,38,17,0.62) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(213,181,91,0.52)',
  },
  {
    id: 'meetings',
    label: 'Meetings',
    description: 'Team syncs, client calls, decision capture',
    icon: MessageSquare,
    glow: 'radial-gradient(circle at 78% 84%, rgba(188,48,211,0.66), rgba(39,8,47,0.6) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(205,35,190,0.52)',
  },
  {
    id: 'system_design',
    label: 'System Design',
    description: 'Architecture, tradeoffs, scalability',
    icon: Blocks,
    glow: 'radial-gradient(circle at 84% 84%, rgba(66,219,169,0.58), rgba(12,54,42,0.62) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(51,202,161,0.52)',
  },
  {
    id: 'general_assistant',
    label: 'General Assistant',
    description: 'Writing, brainstorming, daily productivity',
    icon: Sparkles,
    glow: 'radial-gradient(circle at 80% 80%, rgba(139,92,246,0.58), rgba(36,18,66,0.62) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(139,92,246,0.52)',
  },
];

export type ExperienceLayoutStepProps = {
  isAdvancing: boolean;
  onContinue: (experiences: string[]) => void;
};

export function ExperienceLayoutStep({ isAdvancing, onContinue }: ExperienceLayoutStepProps) {
  const [selectedExperiences, setSelectedExperiences] = useState<Set<ExperienceId>>(() => {
    try {
      const stored = localStorage.getItem('teamsync_experiences');
      if (stored) return new Set(JSON.parse(stored) as ExperienceId[]);
    } catch { /* ignore */ }
    return new Set<ExperienceId>();
  });

  const toggleExperience = (id: ExperienceId) => {
    setSelectedExperiences((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleContinue = () => {
    if (selectedExperiences.size === 0 || isAdvancing) return;
    onContinue(Array.from(selectedExperiences));
  };

  return (
    <motion.section
      key="onboarding-v3-experience"
      variants={stepModalVariants}
      initial="hidden"
      animate={isAdvancing ? 'advanceExit' : 'visible'}
      exit="exit"
      data-testid="onboarding-v3-experience"
      className={`relative w-[calc(100vw-32px)] max-w-[540px] transform-gpu overflow-hidden rounded-[15px] bg-[#0b0d12]/[0.70] px-[36px] pb-[28px] pt-[44px] shadow-[0_26px_90px_rgba(0,0,0,0.50),inset_0_1px_0_rgba(255,255,255,0.065)] backdrop-blur-[34px] will-change-transform ${
        isAdvancing ? 'pointer-events-none' : ''
      }`}
      style={modalFrameStyle}
    >
      <ModalFrameBorder />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_93%,rgba(109,55,28,0.13),transparent_43%),radial-gradient(circle_at_70%_94%,rgba(91,45,18,0.11),transparent_46%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#08090d] opacity-70" />

      {/* Header */}
      <motion.div variants={stepItemVariants} className="mx-auto max-w-[460px] text-center">
        <h2 className="relative text-[34px] font-semibold leading-[1.06] text-white/88 drop-shadow-[0_0_10px_rgba(255,255,255,0.20)]">
          What will you use TeamSync for?
        </h2>
        <p className="relative mx-auto mt-[14px] max-w-[360px] text-[13px] font-semibold leading-[1.48] text-white/52">
          Select all that apply. This helps us personalize your experience.
        </p>
      </motion.div>

      {/* Experience Cards */}
      <motion.div variants={stepItemVariants} className="relative mt-[28px]">
        <LayoutGroup>
          <motion.div variants={stepGroupVariants} className="grid grid-cols-2 gap-[7px]">
            {EXPERIENCE_OPTIONS.map((option) => {
              const isSelected = selectedExperiences.has(option.id);
              const Icon = option.icon;
              return (
                <motion.button
                  key={option.id}
                  type="button"
                  variants={stepItemVariants}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.985 }}
                  onClick={() => toggleExperience(option.id)}
                  disabled={isAdvancing}
                  className="group relative h-[82px] overflow-hidden rounded-[12px] border bg-[#0b0d12]/[0.52] p-[12px] text-left backdrop-blur-[18px] transition-colors duration-200"
                  style={{
                    borderColor: isSelected ? 'rgba(255,255,255,0.50)' : option.border,
                    boxShadow: isSelected
                      ? `0 0 28px ${option.border}, inset 0 0 0 1px rgba(255,255,255,0.06)`
                      : 'inset 0 0 0 1px rgba(255,255,255,0.03)',
                  }}
                >
                  <span
                    className="pointer-events-none absolute inset-0 opacity-80 transition-opacity duration-200 group-hover:opacity-100"
                    style={{ background: option.glow }}
                  />
                  <span className="pointer-events-none absolute inset-0 rounded-[12px] bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.06),transparent_42%)]" />
                  {isSelected && (
                    <motion.span
                      layoutId="experience-selected-ring"
                      className="pointer-events-none absolute inset-0 rounded-[12px] border border-white/30"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    />
                  )}
                  <div className="relative z-10 flex items-start gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-white/10 bg-white/[0.06]">
                      <Icon className="h-3.5 w-3.5 text-white/70" strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold leading-tight text-white/84">
                        {option.label}
                      </div>
                      <div className="mt-[4px] text-[11px] font-medium leading-[1.4] text-white/48">
                        {option.description}
                      </div>
                    </div>
                    {isSelected && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white/90"
                      >
                        <Check className="h-3 w-3 text-[#0b0d12]" strokeWidth={3} />
                      </motion.div>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        </LayoutGroup>
      </motion.div>

      {/* Continue Button */}
      <motion.div variants={stepItemVariants} className="mt-[24px]">
        <motion.button
          type="button"
          whileHover={selectedExperiences.size > 0 && !isAdvancing ? { y: -1, scale: 1.006 } : undefined}
          whileTap={selectedExperiences.size > 0 && !isAdvancing ? { scale: 0.986 } : undefined}
          onClick={handleContinue}
          disabled={selectedExperiences.size === 0 || isAdvancing}
          className="group relative inline-flex h-[42px] w-full items-center justify-center gap-2 overflow-hidden rounded-full border border-white/[0.16] bg-white/[0.94] px-5 text-[13px] font-semibold text-[#050506] shadow-[0_12px_32px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors duration-300 hover:bg-white disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.08] disabled:text-white/[0.36] disabled:shadow-none"
        >
          <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-white/70" />
          Continue
        </motion.button>
      </motion.div>
    </motion.section>
  );
}
