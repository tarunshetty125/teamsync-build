import { AnimatePresence, motion } from 'framer-motion';
import { BriefcaseBusiness, Calendar, Code2, FileText, Loader2, Mic, Play, X, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  getPersonaLabel,
  isPersonaId,
  type FirstSuccessActionId,
  type GoogleAuthUserWithOnboardingV2,
  type PersonaId,
} from './onboardingV2Types';

type FirstSuccessPromptProps = {
  isOpen: boolean;
  user: GoogleAuthUserWithOnboardingV2 | null;
  persona: string | null | undefined;
  onStartMeeting: () => Promise<boolean> | boolean | void;
  onAuthUserChange: (user: GoogleAuthUserWithOnboardingV2) => void;
  onComplete: (action: FirstSuccessActionId) => void;
  onSkip: () => void;
};

type PromptAction = {
  id: FirstSuccessActionId;
  title: string;
  description: string;
  icon: LucideIcon;
};

const ACTIONS: Record<PersonaId, PromptAction[]> = {
  interview_preparation: [
    {
      id: 'upload_resume_jd',
      title: 'Upload Resume + JD',
      description: 'Ground interview answers in your background and target role.',
      icon: FileText,
    },
  ],
  meetings_calls: [
    {
      id: 'connect_calendar',
      title: 'Connect Calendar',
      description: 'Let Quietly prepare from upcoming meeting context.',
      icon: Calendar,
    },
  ],
  developer: [
    {
      id: 'open_technical_interview_mode',
      title: 'Technical Interview Mode',
      description: 'Activate DSA, system design, and engineering interview support.',
      icon: BriefcaseBusiness,
    },
    {
      id: 'open_coding_mode',
      title: 'Coding Mode',
      description: 'Tune the live assistant toward implementation reasoning.',
      icon: Code2,
    },
  ],
  explore_quietly: [
    {
      id: 'start_first_session',
      title: 'Start First Session',
      description: 'Open the live overlay and experience Quietly in context.',
      icon: Play,
    },
  ],
};

async function activateMode(templateType: 'technical-interview') {
  const allModes = await window.electronAPI?.modesGetAll?.();
  let targetMode = allModes?.find((mode) => mode.templateType === templateType);
  if (!targetMode) {
    const created = await window.electronAPI?.modesCreate?.({ templateType });
    if (!created?.success || !created.mode) {
      throw new Error(created?.error || 'Could not create mode.');
    }
    targetMode = created.mode;
  }
  if (!targetMode?.id) throw new Error('Mode is unavailable.');
  const active = await window.electronAPI?.modesSetActive?.(targetMode.id);
  if (!active?.success) throw new Error(active?.error || 'Could not activate mode.');
  await window.electronAPI?.modesSetSelected?.(targetMode.id).catch(() => {});
}

export function FirstSuccessPrompt({
  isOpen,
  user,
  persona,
  onStartMeeting,
  onAuthUserChange,
  onComplete,
  onSkip,
}: FirstSuccessPromptProps) {
  const [busyAction, setBusyAction] = useState<FirstSuccessActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolvedPersona = isPersonaId(persona) ? persona : 'explore_quietly';
  const actions = useMemo(() => ACTIONS[resolvedPersona], [resolvedPersona]);

  const runAction = async (action: FirstSuccessActionId) => {
    if (busyAction) return;
    setBusyAction(action);
    setError(null);
    try {
      if (action === 'upload_resume_jd') {
        const resume = await window.electronAPI?.profileSelectFile?.();
        if (resume?.cancelled) return;
        if (!resume?.fileToken) throw new Error(resume?.error || 'Select a resume to continue.');
        const resumeUpload = await window.electronAPI?.profileUploadResume?.(resume.fileToken);
        if (!resumeUpload?.success) throw new Error(resumeUpload?.error || 'Could not upload resume.');

        const jd = await window.electronAPI?.profileSelectFile?.();
        if (jd?.cancelled) return;
        if (!jd?.fileToken) throw new Error(jd?.error || 'Select a job description to continue.');
        const jdUpload = await window.electronAPI?.profileUploadJD?.(jd.fileToken);
        if (!jdUpload?.success) throw new Error(jdUpload?.error || 'Could not upload job description.');
      }

      if (action === 'connect_calendar') {
        const result = await window.electronAPI?.googleConnectCalendar?.(user?.email);
        const updatedUser = result?.user ?? result?.authState?.user;
        if (!result?.success || !updatedUser?.calendarConnected) {
          throw new Error(result?.error || 'Could not connect calendar.');
        }
        onAuthUserChange(updatedUser);
      }

      if (action === 'open_technical_interview_mode') {
        await activateMode('technical-interview');
      }

      if (action === 'open_coding_mode') {
        const result = await window.electronAPI?.setSessionMode?.('coding');
        if (!result?.success) throw new Error('Could not open coding mode.');
      }

      if (action === 'start_first_session') {
        const started = await onStartMeeting();
        if (started === false) throw new Error('Could not start the first session.');
      }

      onComplete(action);
    } catch (err: any) {
      setError(err?.message || 'Action failed. Please try again.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.aside
          key="onboarding-v2-first-success"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.99 }}
          transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-5 right-5 z-[90] w-[360px] overflow-hidden rounded-[18px] border border-white/[0.12] bg-[#08090d]/[0.88] p-5 text-white shadow-[0_22px_70px_rgba(0,0,0,0.46)] backdrop-blur-[28px]"
          data-testid="onboarding-v2-first-success"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_86%_86%,rgba(82,205,164,0.14),transparent_46%),radial-gradient(circle_at_16%_0%,rgba(126,108,213,0.12),transparent_36%)]" />
          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-[8px] border border-white/[0.10] bg-white/[0.055] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/[0.42]">
                  <Mic className="h-3 w-3" />
                  First value
                </div>
                <h2 className="mt-3 text-[18px] font-semibold tracking-[-0.02em] text-white/[0.92]">
                  Try {getPersonaLabel(resolvedPersona)}
                </h2>
              </div>
              <button
                type="button"
                onClick={onSkip}
                className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[11px] font-semibold text-white/[0.48] transition-colors hover:bg-white/[0.06] hover:text-white/[0.78]"
              >
                <X className="h-3.5 w-3.5" />
                Skip
              </button>
            </div>
            <p className="mt-2 text-[12px] font-medium leading-5 text-white/[0.52]">
              Take one action now, or skip and explore the workspace.
            </p>

            <div className="mt-4 space-y-2">
              {actions.map((action) => {
                const Icon = action.icon;
                const isBusy = busyAction === action.id;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => { void runAction(action.id); }}
                    disabled={Boolean(busyAction)}
                    className="group flex w-full items-start gap-3 rounded-[14px] border border-white/[0.10] bg-white/[0.055] p-3 text-left transition-all hover:border-white/[0.18] hover:bg-white/[0.075] active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-white/[0.10] bg-white/[0.055] text-white/[0.72]">
                      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" strokeWidth={1.7} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-white/[0.88]">{action.title}</span>
                      <span className="mt-0.5 block text-[11px] font-medium leading-4 text-white/[0.48]">{action.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {error ? (
              <div className="mt-3 rounded-[10px] border border-rose-300/18 bg-rose-300/[0.08] px-3 py-2 text-[11px] font-medium text-rose-100/76">
                {error}
              </div>
            ) : null}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
