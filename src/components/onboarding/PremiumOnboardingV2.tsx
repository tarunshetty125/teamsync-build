import { AnimatePresence, LayoutGroup, motion, type Variants } from 'framer-motion';
import type React from 'react';
import {
  AudioLines,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Code2,
  Eye,
  FileText,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isPermissionStatusOperational } from '../../lib/permissions/utils';
import type { PermissionKind, PermissionStatusSnapshot } from '../../lib/permissions/types';
import { usePermissionsStore } from '../../stores/usePermissionsStore';
import appIcon from '../icon.png';
import {
  DISCOVERY_OPTIONS,
  INDUSTRY_OPTIONS,
  PERSONA_OPTIONS,
  getPersonaLabel,
  isPersonaId,
  type DiscoverySourceId,
  type GoogleAuthUserWithOnboardingV2,
  type IndustryId,
  type PersonaId,
} from './onboardingV2Types';

type PremiumOnboardingStep =
  | 'welcome'
  | 'permissions'
  | 'oauth'
  | 'persona'
  | 'industry'
  | 'discovery'
  | 'building'
  | 'activation';

type AuthUiState = 'idle' | 'checking' | 'waiting' | 'success' | 'error';

type PremiumOnboardingV2Props = {
  isOpen: boolean;
  initialUser: GoogleAuthUserWithOnboardingV2 | null;
  skipIntroScreens?: boolean;
  startAtPermissions?: boolean;
  onAuthUserChange: (user: GoogleAuthUserWithOnboardingV2) => void;
  onLaunch: (user: GoogleAuthUserWithOnboardingV2) => void;
};

const STEP_HANDOFF_DELAY_MS = 700;

const modalVariants: Variants = {
  hidden: { opacity: 0, y: 56 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      duration: 0.6,
      bounce: 0.16,
      ease: [0.22, 1, 0.36, 1],
      staggerChildren: 0.07,
      delayChildren: 0.14,
    },
  },
  advanceExit: {
    opacity: 0,
    y: 80,
    scale: 0.97,
    transition: {
      duration: 0.52,
      ease: [0.32, 0, 0.67, 0],
    },
  },
  exit: {
    opacity: 0,
    y: 80,
    scale: 0.97,
    transition: {
      duration: 0.38,
      ease: [0.32, 0, 0.67, 0],
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', duration: 0.54, bounce: 0.12, ease: [0.22, 1, 0.36, 1] },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', duration: 0.52, bounce: 0.12, ease: [0.22, 1, 0.36, 1] },
  },
};

const legacyExitTransition = {
  duration: 0.38,
  ease: [0.32, 0, 0.67, 0] as [number, number, number, number],
};

const legacyModalVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 80,
    scale: 0.97,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      duration: 0.72,
      bounce: 0.14,
      delayChildren: 0.14,
      staggerChildren: 0.06,
    },
  },
  advanceExit: {
    opacity: 0,
    y: 80,
    scale: 0.97,
    transition: {
      duration: 0.52,
      ease: [0.32, 0, 0.67, 0],
    },
  },
  exit: {
    opacity: 0,
    y: 80,
    scale: 0.97,
    transition: legacyExitTransition,
  },
};

const legacyContentItemVariants: Variants = {
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

const legacyContentGroupVariants: Variants = {
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
  radiusClass = 'rounded-[18px]',
  borderClass = 'border-[#a1a3aa]/45',
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

const PERMISSION_DETAILS: Array<{
  kind: PermissionKind;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    kind: 'screenRecording',
    title: 'Screen Understanding',
    description: 'See IDEs, browser tabs, docs, shared screens, and interview prompts.',
    icon: Eye,
  },
  {
    kind: 'microphone',
    title: 'Live Transcription',
    description: 'Capture meetings, calls, interviews, and spoken context as they happen.',
    icon: AudioLines,
  },
  {
    kind: 'accessibility',
    title: 'Interview Assistance',
    description: 'Keep the overlay responsive for context-aware answers and quick actions.',
    icon: Sparkles,
  },
];

const PERSONA_CARD_TREATMENT: Record<PersonaId, { glow: string; border: string }> = {
  interview_preparation: {
    glow: 'radial-gradient(circle at 75% 76%, rgba(58,213,224,0.74), rgba(12,45,57,0.78) 43%, rgba(5,5,5,0.04) 73%)',
    border: 'rgba(86,174,222,0.72)',
  },
  meetings_calls: {
    glow: 'radial-gradient(circle at 83% 78%, rgba(232,151,61,0.82), rgba(64,38,17,0.82) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(213,181,91,0.76)',
  },
  developer: {
    glow: 'radial-gradient(circle at 78% 84%, rgba(188,48,211,0.86), rgba(39,8,47,0.8) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(205,35,190,0.82)',
  },
  explore_quietly: {
    glow: 'radial-gradient(circle at 84% 84%, rgba(66,219,169,0.78), rgba(12,54,42,0.82) 45%, rgba(5,5,5,0.04) 74%)',
    border: 'rgba(51,202,161,0.78)',
  },
};

const LEGACY_PERSONA_DESCRIPTION: Record<PersonaId, string> = {
  interview_preparation: 'Interviews, prep calls, career practice',
  meetings_calls: 'Client calls, team syncs, stakeholder meetings',
  developer: 'Code reviews, standups, technical deep dives',
  explore_quietly: 'Explore how Quietly fits in with your workflow',
};

const ACTIVATION_COPY: Record<PersonaId, Array<{ title: string; detail: string; icon: LucideIcon }>> = {
  interview_preparation: [
    { title: 'Resume Intelligence Ready', detail: 'Quietly can ground interview answers in your profile.', icon: FileText },
    { title: 'Interview Intelligence Ready', detail: 'Live answers are tuned for behavioral and technical prompts.', icon: BriefcaseBusiness },
  ],
  developer: [
    { title: 'Technical Interview Mode Available', detail: 'DSA, system design, and tradeoff reasoning are ready.', icon: Code2 },
    { title: 'Coding Assistance Ready', detail: 'Quietly can help structure explanations and implementation steps.', icon: Monitor },
  ],
  meetings_calls: [
    { title: 'Calendar Intelligence Available', detail: 'Meetings can use agenda and attendee context once connected.', icon: BriefcaseBusiness },
    { title: 'Live Meeting Assistance Ready', detail: 'Capture decisions, blockers, action items, and follow-ups.', icon: AudioLines },
  ],
  explore_quietly: [
    { title: 'Workspace Ready', detail: 'Your launcher is prepared for the first live session.', icon: Sparkles },
    { title: 'Live Assistance Available', detail: 'Screen, audio, and overlay intelligence are ready to work.', icon: Zap },
  ],
};

function GoogleLogo({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function AuroraBackdrop({ isSoft = false }: { isSoft?: boolean }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${isSoft ? 'bg-[#10131a]' : 'bg-[#050506]'}`}>
      <motion.div
        className="absolute -left-[16%] -top-[24%] h-[520px] w-[660px] rounded-full bg-[radial-gradient(circle,rgba(109,94,194,0.34),rgba(49,38,85,0.17)_44%,transparent_72%)] blur-[108px]"
        animate={{ opacity: isSoft ? [0.72, 0.96, 0.72] : [0.54, 0.85, 0.54], scale: [1, 1.07, 1] }}
        transition={{ duration: 8.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-[14%] top-[10%] h-[440px] w-[540px] rounded-full bg-[radial-gradient(circle,rgba(61,188,156,0.18),rgba(21,79,70,0.10)_48%,transparent_74%)] blur-[110px]"
        animate={{ opacity: isSoft ? [0.52, 0.82, 0.52] : [0.32, 0.68, 0.32], scale: [1.02, 1, 1.02] }}
        transition={{ duration: 9.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-[30%] left-[18%] h-[460px] w-[620px] rounded-full bg-[radial-gradient(circle,rgba(218,137,64,0.18),rgba(94,54,26,0.10)_44%,transparent_73%)] blur-[124px]"
        animate={{ opacity: isSoft ? [0.46, 0.74, 0.46] : [0.28, 0.55, 0.28], scale: [1, 1.06, 1] }}
        transition={{ duration: 10.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div
        className={
          isSoft
            ? 'absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.08)_58%,rgba(0,0,0,0.34)_100%)]'
            : 'absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.22)_58%,rgba(0,0,0,0.62)_100%)]'
        }
      />
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27280%27 height=%27280%27 viewBox=%270 0 280 280%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.86%27 numOctaves=%273%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27280%27 height=%27280%27 filter=%27url(%23n)%27 opacity=%270.55%27/%3E%3C/svg%3E")',
        }}
      />
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled = false,
  icon,
  testId,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  testId?: string;
}) {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { y: -1, scale: 1.006 }}
      whileTap={disabled ? undefined : { scale: 0.986 }}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="group relative inline-flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-[10px] border border-white/[0.18] bg-white/[0.92] px-5 text-[14px] font-semibold text-[#050506] shadow-[0_0_34px_rgba(255,255,255,0.13)] transition-colors duration-300 hover:bg-white disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.08] disabled:text-white/[0.34] disabled:shadow-none"
    >
      <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-white/70" />
      {icon}
      <span>{children}</span>
    </motion.button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center justify-center rounded-[9px] border border-white/10 bg-white/[0.045] px-3 text-[12px] font-semibold text-white/[0.58] transition-all hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white/[0.78] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function StepShell({
  eyebrow,
  title,
  description,
  children,
  footer,
  testId,
  isAdvancing = false,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  testId: string;
  isAdvancing?: boolean;
}) {
  return (
    <motion.section
      key={testId}
      variants={modalVariants}
      initial="hidden"
      animate={isAdvancing ? 'advanceExit' : 'visible'}
      exit="exit"
      data-testid={testId}
      className={`relative w-[calc(100vw-32px)] max-w-[620px] transform-gpu overflow-hidden rounded-[18px] bg-[#020202]/[0.94] px-8 py-8 text-white shadow-[0_26px_90px_rgba(0,0,0,0.62),0_0_80px_rgba(89,72,150,0.12)] backdrop-blur-[34px] ${
        isAdvancing ? 'pointer-events-none' : ''
      }`}
      style={{ ...modalFrameStyle, willChange: 'transform, opacity' }}
    >
      <ModalFrameBorder />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.28] to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_92%,rgba(109,55,28,0.14),transparent_43%),radial-gradient(circle_at_72%_92%,rgba(84,43,16,0.11),transparent_48%),radial-gradient(circle_at_18%_8%,rgba(126,108,213,0.12),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#020202]" />
      <div className="relative">
        {eyebrow ? (
          <motion.div variants={itemVariants} className="mb-5 inline-flex items-center gap-2 rounded-[8px] border border-white/[0.10] bg-white/[0.055] px-3 py-1.5 text-[11px] font-semibold text-white/[0.58]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/80 shadow-[0_0_14px_rgba(110,231,183,0.45)]" />
            {eyebrow}
          </motion.div>
        ) : null}
        <motion.h1 variants={itemVariants} className="max-w-[11ch] text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] text-white/[0.92] drop-shadow-[0_0_12px_rgba(255,255,255,0.16)]">
          {title}
        </motion.h1>
        <motion.p variants={itemVariants} className="mt-4 max-w-[48ch] text-[15px] font-medium leading-7 text-white/[0.56]">
          {description}
        </motion.p>
        {children}
        {footer ? <motion.div variants={itemVariants} className="mt-8">{footer}</motion.div> : null}
      </div>
    </motion.section>
  );
}

function GoogleAuthScreen({
  authState,
  authError,
  isAdvancing,
  onRefresh,
  onSignIn,
}: {
  authState: AuthUiState;
  authError: string | null;
  isAdvancing: boolean;
  onRefresh: () => void;
  onSignIn: () => void;
}) {
  const isBusy = authState === 'checking' || authState === 'waiting' || isAdvancing;
  const isChecking = authState === 'checking';
  const buttonLabel = isChecking
    ? 'Refreshing session'
    : authState === 'waiting'
      ? 'Waiting for Google'
      : 'Continue with Google';

  return (
    <motion.section
      key="onboarding-v2-oauth"
      variants={legacyModalVariants}
      initial="hidden"
      animate={isAdvancing ? 'advanceExit' : 'visible'}
      exit="exit"
      data-testid="onboarding-v2-oauth"
      className={`relative w-[calc(100vw-40px)] max-w-[500px] transform-gpu overflow-hidden rounded-[15px] bg-[#020202] px-[40px] pb-[36px] pt-[44px] text-center text-white shadow-[0_26px_90px_rgba(0,0,0,0.62),0_0_70px_rgba(84,91,120,0.14)] backdrop-blur-[34px] ${
        isAdvancing ? 'pointer-events-none' : ''
      }`}
      style={{ ...modalFrameStyle, willChange: 'transform, opacity' }}
    >
      <ModalFrameBorder radiusClass="rounded-[15px]" borderClass="border-[#a1a3aa]/55" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.30] to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(115,123,161,0.16),transparent_36%),radial-gradient(circle_at_72%_96%,rgba(48,93,83,0.13),transparent_48%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#020202]" />

      <motion.div variants={legacyContentGroupVariants} className="relative flex flex-col items-center">
        <motion.div
          variants={legacyContentItemVariants}
          className="mb-7 flex h-[62px] w-[62px] items-center justify-center rounded-[18px] border border-white/[0.10] bg-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
        >
          {isBusy ? <Loader2 className="h-5 w-5 animate-spin text-white/[0.72]" /> : <img src={appIcon} alt="Quietly" className="h-10 w-10 object-contain" />}
        </motion.div>

        <motion.div variants={legacyContentItemVariants} className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.045] px-3 py-1.5 text-[11px] font-semibold text-white/[0.54]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/75 shadow-[0_0_12px_rgba(110,231,183,0.42)]" />
          Secure account
        </motion.div>

        <motion.h1 variants={legacyContentItemVariants} className="text-[31px] font-semibold leading-[1.04] tracking-[-0.035em] text-white/[0.94]">
          {isChecking ? 'Checking your session' : 'Continue with Google'}
        </motion.h1>
        <motion.p variants={legacyContentItemVariants} className="mt-4 max-w-[360px] text-[13px] font-medium leading-6 text-white/[0.52]">
          {isChecking
            ? 'Quietly is refreshing your account before choosing the right workspace path.'
            : 'Sign in once so Quietly can save your profile and open the right activation path.'}
        </motion.p>

        {authError ? (
          <motion.div variants={legacyContentItemVariants} className="mt-6 w-full rounded-[12px] border border-rose-300/18 bg-rose-300/[0.08] px-4 py-3 text-left text-[12px] font-medium leading-5 text-rose-100/76">
            {authError}
          </motion.div>
        ) : null}

        <motion.button
          type="button"
          variants={legacyContentItemVariants}
          whileHover={isBusy ? undefined : { y: -1, scale: 1.006 }}
          whileTap={isBusy ? undefined : { scale: 0.986 }}
          onClick={isChecking ? onRefresh : onSignIn}
          disabled={isBusy}
          className="mt-8 inline-flex h-[42px] w-full max-w-[318px] items-center justify-center gap-2.5 overflow-hidden rounded-full border border-white/[0.16] bg-white/[0.94] px-5 text-[13px] font-semibold text-[#050506] shadow-[0_12px_32px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors duration-300 hover:bg-white disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.08] disabled:text-white/[0.36] disabled:shadow-none"
        >
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleLogo size={17} />}
          <span>{buttonLabel}</span>
        </motion.button>
      </motion.div>
    </motion.section>
  );
}

function getFirstName(user: GoogleAuthUserWithOnboardingV2 | null): string {
  const name = user?.name?.trim();
  if (!name) return 'there';
  return name.split(/\s+/)[0] || name;
}

function getPermissionState(snapshot: PermissionStatusSnapshot, kind: PermissionKind) {
  return snapshot[kind];
}

function getNextPermission(snapshot: PermissionStatusSnapshot): PermissionKind | null {
  if (snapshot.screenRecording !== 'granted') return 'screenRecording';
  if (snapshot.microphone !== 'granted') return 'microphone';
  if (snapshot.accessibility !== 'granted') return 'accessibility';
  return null;
}

function PermissionsScreen({
  status,
  isChecking,
  activePermission,
  lastError,
  isAdvancing,
  onRequest,
  onOpenSettings,
  onRetry,
  onContinue,
  onQuit,
}: {
  status: PermissionStatusSnapshot | null;
  isChecking: boolean;
  activePermission: PermissionKind | null;
  lastError: string | null;
  isAdvancing: boolean;
  onRequest: (permission: PermissionKind) => void;
  onOpenSettings: (permission: PermissionKind) => void;
  onRetry: () => void;
  onContinue: () => void;
  onQuit: () => void;
}) {
  const snapshot = status ?? {
    screenRecording: 'not_requested',
    microphone: 'not_requested',
    accessibility: 'not_requested',
    restartRequired: false,
    platform: 'darwin' as NodeJS.Platform,
    checkedAt: new Date().toISOString(),
  };
  const allReady = isPermissionStatusOperational(snapshot);
  const nextPermission = getNextPermission(snapshot);
  const nextPermissionState = nextPermission ? getPermissionState(snapshot, nextPermission) : null;
  const permissionLabel = nextPermission
    ? PERMISSION_DETAILS.find((item) => item.kind === nextPermission)?.title ?? 'Permission'
    : 'Permissions';
  const primaryLabel = allReady
    ? 'Continue'
    : snapshot.restartRequired
      ? 'Quit Quietly'
      : nextPermissionState === 'denied'
        ? `Open ${permissionLabel} Settings`
        : isChecking
          ? 'Checking access'
          : `Enable ${permissionLabel}`;

  const handlePrimary = () => {
    if (allReady) {
      onContinue();
      return;
    }
    if (snapshot.restartRequired) {
      onQuit();
      return;
    }
    if (!nextPermission) return;
    if (nextPermissionState === 'denied' || nextPermissionState === 'restart_required') {
      onOpenSettings(nextPermission);
      return;
    }
    onRequest(nextPermission);
  };

  return (
    <StepShell
      testId="onboarding-v2-permissions"
      eyebrow="Access"
      title="Enable Quietly intelligence"
      description="Grant the desktop access Quietly needs to understand your screen, hear live context, and keep assistance responsive."
      isAdvancing={isAdvancing}
      footer={
        <div className="flex flex-col gap-3">
          <PrimaryButton
            onClick={handlePrimary}
            disabled={isChecking && !allReady}
            icon={isChecking && !allReady ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          >
            {primaryLabel}
          </PrimaryButton>
          <div className="flex items-center justify-center">
            <SecondaryButton onClick={onRetry} disabled={isChecking}>
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              Refresh status
            </SecondaryButton>
          </div>
        </div>
      }
    >
      <motion.div variants={itemVariants} className="mt-7 space-y-3">
        {PERMISSION_DETAILS.map((permission) => {
          const Icon = permission.icon;
          const state = getPermissionState(snapshot, permission.kind);
          const isReady = state === 'granted';
          const isActive = activePermission === permission.kind && isChecking;
          return (
            <motion.div
              key={permission.kind}
              variants={cardVariants}
              className="relative overflow-hidden rounded-[14px] border border-white/[0.10] bg-white/[0.055] p-4"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_94%_76%,rgba(255,255,255,0.055),transparent_48%)]" />
              <div className="relative flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-white/[0.10] bg-white/[0.055] text-white/[0.72]">
                  <Icon className="h-4.5 w-4.5" strokeWidth={1.7} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-[14px] font-semibold text-white/[0.9]">{permission.title}</h2>
                    <span className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-bold uppercase tracking-[0.12em] ${
                      isReady
                        ? 'border-emerald-300/20 bg-emerald-300/[0.10] text-emerald-100'
                        : state === 'denied'
                          ? 'border-rose-300/20 bg-rose-300/[0.10] text-rose-100'
                          : 'border-white/[0.10] bg-white/[0.045] text-white/[0.44]'
                    }`}>
                      {isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : isReady ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                      {isReady ? 'Enabled' : state === 'denied' ? 'Blocked' : 'Required'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12px] font-medium leading-5 text-white/[0.50]">{permission.description}</p>
                </div>
              </div>
            </motion.div>
          );
        })}
        {lastError ? (
          <motion.div variants={itemVariants} className="rounded-[12px] border border-rose-300/18 bg-rose-300/[0.08] px-4 py-3 text-[12px] font-medium text-rose-100/76">
            {lastError}
          </motion.div>
        ) : null}
      </motion.div>
    </StepShell>
  );
}

function PersonaScreen({
  selected,
  isAdvancing,
  onSelect,
}: {
  selected: PersonaId | null;
  isAdvancing: boolean;
  onSelect: (persona: PersonaId) => void;
}) {
  return (
    <motion.div
      key="persona-modal"
      variants={legacyModalVariants}
      initial="hidden"
      animate={isAdvancing ? 'advanceExit' : 'visible'}
      exit="exit"
      className={`relative w-[calc(100vw-32px)] max-w-[500px] transform-gpu overflow-hidden rounded-[15px] bg-[#0b0d12]/[0.70] px-[40px] pb-[16px] pt-[50px] shadow-[0_26px_90px_rgba(0,0,0,0.50),inset_0_1px_0_rgba(255,255,255,0.065)] backdrop-blur-[34px] will-change-transform ${
        isAdvancing ? 'pointer-events-none' : ''
      }`}
      data-testid="onboarding-v2-persona"
      style={modalFrameStyle}
    >
      <ModalFrameBorder radiusClass="rounded-[15px]" borderClass="border-[#a1a3aa]/55" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_93%,rgba(109,55,28,0.13),transparent_43%),radial-gradient(circle_at_70%_94%,rgba(91,45,18,0.11),transparent_46%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#08090d] opacity-70" />
      <motion.div variants={legacyContentItemVariants} className="mx-auto max-w-[420px] text-center">
        <h2 className="relative text-[37px] font-semibold leading-[1.04] text-white/88 drop-shadow-[0_0_10px_rgba(255,255,255,0.24)]">
          What brings you to Quietly?
        </h2>
        <p className="relative mx-auto mt-[18px] max-w-[330px] text-[14px] font-semibold leading-[1.45] text-white/56">
          Quietly adapts to you and your meetings - fitting into your daily rhythm.
        </p>
      </motion.div>

      <LayoutGroup>
        <motion.div
          variants={legacyContentGroupVariants}
          className="relative mt-[52px] grid grid-cols-2 gap-[8px]"
          data-testid="onboarding-v2-persona-options"
        >
          {PERSONA_OPTIONS.map((option) => {
            const isSelected = selected === option.id;
            const treatment = PERSONA_CARD_TREATMENT[option.id];
            return (
              <motion.button
                key={option.id}
                type="button"
                variants={legacyContentItemVariants}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.985 }}
                onClick={() => onSelect(option.id)}
                disabled={isAdvancing}
                className="group relative h-[136px] overflow-hidden rounded-[14px] border bg-[#0b0d12]/[0.52] p-[16px] text-left backdrop-blur-[18px] transition-colors duration-200"
                data-testid="onboarding-v2-persona-option"
                style={{
                  borderColor: isSelected ? 'rgba(255,255,255,0.58)' : treatment.border,
                  boxShadow: isSelected
                    ? `0 0 32px ${treatment.border}, inset 0 0 0 1px rgba(255,255,255,0.08)`
                    : 'inset 0 0 0 1px rgba(255,255,255,0.03)',
                }}
              >
                <span
                  className="pointer-events-none absolute inset-0 opacity-90 transition-opacity duration-200 group-hover:opacity-100"
                  style={{ background: treatment.glow }}
                />
                <span className="pointer-events-none absolute inset-0 rounded-[14px] bg-[radial-gradient(circle_at_30%_18%,rgba(255,255,255,0.08),transparent_42%)]" />
                {isSelected ? (
                  <motion.span
                    layoutId="onboarding-v2-persona-selected"
                    className="pointer-events-none absolute inset-0 rounded-[14px] border border-white/36"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  />
                ) : null}
                <div className="relative z-10">
                  <div className="text-[16px] font-bold leading-tight text-white/84">
                    {option.label}
                  </div>
                  <div className="mt-[12px] max-w-[18ch] text-[14px] font-semibold leading-[1.5] text-white/58">
                    {LEGACY_PERSONA_DESCRIPTION[option.id]}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </motion.div>
      </LayoutGroup>
    </motion.div>
  );
}

function ChipDecisionScreen<T extends string>({
  testId,
  eyebrow,
  title,
  description,
  options,
  selected,
  isAdvancing,
  layoutId,
  onSelect,
}: {
  testId: string;
  eyebrow: string;
  title: string;
  description: string;
  options: Array<{ id: T; label: string }>;
  selected: T | null;
  isAdvancing: boolean;
  layoutId: string;
  onSelect: (id: T) => void;
}) {
  return (
    <motion.div
      key={`${testId}-legacy-details-modal`}
      variants={legacyModalVariants}
      initial="hidden"
      animate={isAdvancing ? 'advanceExit' : 'visible'}
      exit="exit"
      className={`relative max-h-none w-[calc(100vw-32px)] max-w-[500px] transform-gpu overflow-hidden rounded-[15px] bg-[#0b0d12]/[0.70] px-[40px] pb-[28px] pt-[49px] shadow-[0_26px_90px_rgba(0,0,0,0.50),inset_0_1px_0_rgba(255,255,255,0.065)] backdrop-blur-[34px] will-change-transform ${
        isAdvancing ? 'pointer-events-none' : ''
      }`}
      data-testid={testId}
      style={modalFrameStyle}
    >
      <ModalFrameBorder radiusClass="rounded-[15px]" borderClass="border-[#a1a3aa]/55" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_92%,rgba(91,44,24,0.13),transparent_43%),radial-gradient(circle_at_68%_90%,rgba(84,43,16,0.10),transparent_48%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#08090d] opacity-70" />
      <motion.div variants={legacyContentItemVariants} className="mx-auto max-w-[420px] text-center">
        <h2 className="relative text-[40px] font-semibold leading-[1.05] text-white/88 drop-shadow-[0_0_10px_rgba(255,255,255,0.24)]">
          {eyebrow === 'Discovery' ? 'One last thing' : 'Tell us more'}
        </h2>
        <p className="relative mx-auto mt-[17px] max-w-[430px] text-[14px] font-semibold leading-[1.45] text-white/56">
          {description}
        </p>
      </motion.div>

      <motion.div variants={legacyContentItemVariants} className="relative mt-[34px]">
        <div className="text-[17px] font-bold leading-tight text-white/90">
          {title}
        </div>
        <div className="mt-[10px]">
          <LayoutGroup>
            <motion.div variants={legacyContentGroupVariants} className="flex flex-wrap gap-[8px]" data-testid={`${testId}-options`}>
              {options.map((option) => {
                const isSelected = selected === option.id;
                return (
                  <motion.button
                    key={option.id}
                    type="button"
                    layout
                    variants={legacyContentItemVariants}
                    whileHover={{ scale: 1.025 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => onSelect(option.id)}
                    disabled={isAdvancing}
                    data-testid={`${testId}-option`}
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
        </div>
      </motion.div>
    </motion.div>
  );
}

function BuildingScreen({
  persona,
  industry,
  discoverySource,
  error,
  isSaving,
  isAdvancing,
  onRetry,
}: {
  persona: PersonaId | null;
  industry: IndustryId | null;
  discoverySource: DiscoverySourceId | null;
  error: string | null;
  isSaving: boolean;
  isAdvancing: boolean;
  onRetry: () => void;
}) {
  const progress = ['Understanding your workflow', 'Personalizing intelligence', 'Preparing workspace'];
  return (
    <StepShell
      testId="onboarding-v2-building"
      eyebrow="Workspace"
      title="Building your workspace..."
      description="Quietly is preparing the first workspace from your profile."
      isAdvancing={isAdvancing}
      footer={error ? (
        <PrimaryButton onClick={onRetry} disabled={isSaving} icon={isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}>
          Retry save
        </PrimaryButton>
      ) : undefined}
    >
      <motion.div variants={itemVariants} className="mt-8 rounded-[16px] border border-white/[0.10] bg-white/[0.055] p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['Persona', persona ? getPersonaLabel(persona) : 'Selected'],
            ['Industry', INDUSTRY_OPTIONS.find((option) => option.id === industry)?.label ?? 'Selected'],
            ['Source', DISCOVERY_OPTIONS.find((option) => option.id === discoverySource)?.label ?? 'Selected'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[12px] border border-white/[0.08] bg-black/[0.18] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/[0.36]">{label}</p>
              <p className="mt-1 truncate text-[13px] font-semibold text-white/[0.82]">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-3">
          {progress.map((item, index) => (
            <motion.div
              key={item}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + index * 0.32, duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-3 text-[13px] font-semibold text-white/[0.74]"
            >
              <motion.span
                initial={{ scale: 0.75, opacity: 0.4 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.46 + index * 0.32, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-300/[0.10] text-emerald-100"
              >
                <Check className="h-3.5 w-3.5" />
              </motion.span>
              {item}
            </motion.div>
          ))}
        </div>
      </motion.div>
      {error ? (
        <motion.div variants={itemVariants} className="mt-5 rounded-[12px] border border-rose-300/18 bg-rose-300/[0.08] px-4 py-3 text-[12px] font-medium text-rose-100/76">
          {error}
        </motion.div>
      ) : null}
    </StepShell>
  );
}

function ActivationScreen({
  user,
  persona,
  isAdvancing,
  onLaunch,
}: {
  user: GoogleAuthUserWithOnboardingV2 | null;
  persona: PersonaId;
  isAdvancing: boolean;
  onLaunch: () => void;
}) {
  const copy = ACTIVATION_COPY[persona];
  return (
    <StepShell
      testId="onboarding-v2-activation"
      eyebrow="Ready"
      title={`Welcome, ${getFirstName(user)}.`}
      description="Based on your profile, Quietly has prepared the workspace around the moments where it can help fastest."
      isAdvancing={isAdvancing}
      footer={
        <PrimaryButton onClick={onLaunch} icon={<Zap className="h-4 w-4" />} testId="onboarding-v2-launch">
          Launch Quietly
        </PrimaryButton>
      }
    >
      <motion.div variants={itemVariants} className="mt-8">
        <p className="mb-3 text-[12px] font-bold uppercase tracking-[0.16em] text-white/[0.38]">Based on your profile</p>
        <div className="space-y-3">
          {copy.map((item) => {
            const Icon = item.icon;
            return (
              <motion.div
                key={item.title}
                variants={cardVariants}
                className="relative overflow-hidden rounded-[15px] border border-white/[0.10] bg-white/[0.06] p-4"
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_92%_82%,rgba(110,231,183,0.10),transparent_45%)]" />
                <div className="relative flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-emerald-300/20 bg-emerald-300/[0.10] text-emerald-100">
                    <Icon className="h-4.5 w-4.5" strokeWidth={1.7} />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold text-white/[0.9]">{item.title}</h2>
                    <p className="mt-1 text-[12px] font-medium leading-5 text-white/[0.50]">{item.detail}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </StepShell>
  );
}

export function PremiumOnboardingV2({
  isOpen,
  initialUser,
  skipIntroScreens: _skipIntroScreens = false,
  startAtPermissions: _startAtPermissions = false,
  onAuthUserChange,
  onLaunch,
}: PremiumOnboardingV2Props) {
  // Simplified flow: always start at OAuth login
  const initialStep: PremiumOnboardingStep = 'oauth';
  const [step, setStep] = useState<PremiumOnboardingStep>(() => initialStep);
  const [authUser, setAuthUser] = useState<GoogleAuthUserWithOnboardingV2 | null>(initialUser);
  const [persona, setPersona] = useState<PersonaId | null>(null);
  const [industry, setIndustry] = useState<IndustryId | null>(null);
  const [discoverySource, setDiscoverySource] = useState<DiscoverySourceId | null>(null);
  const [authState, setAuthState] = useState<AuthUiState>('idle');
  const [authError, setAuthError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [advancingStep, setAdvancingStep] = useState<PremiumOnboardingStep | null>(null);
  const hasInitializedOpenStateRef = useRef(false);
  const saveAttemptKeyRef = useRef<string | null>(null);
  const authAttemptRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  const stepRef = useRef<PremiumOnboardingStep>(initialStep);

  const status = usePermissionsStore((state) => state.status);
  const isChecking = usePermissionsStore((state) => state.isChecking);
  const lastError = usePermissionsStore((state) => state.lastError);
  const activePermission = usePermissionsStore((state) => state.activePermission);
  const requestPermission = usePermissionsStore((state) => state.requestPermission);
  const refreshPermissions = usePermissionsStore((state) => state.refreshPermissions);
  const openSettings = usePermissionsStore((state) => state.openSettings);
  const completePermissionsOnboarding = usePermissionsStore((state) => state.completeOnboarding);

  const resolvedPersona = useMemo<PersonaId>(() => {
    if (persona) return persona;
    const storedPersona = authUser?.onboardingV1?.persona;
    return isPersonaId(storedPersona) ? storedPersona : 'explore_quietly';
  }, [authUser?.onboardingV1?.persona, persona]);

  useEffect(() => {
    setAuthUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => () => {
    if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    authAttemptRef.current += 1;
  }, []);

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setAdvancingStep(null);
  };

  const transitionToStep = (nextStep: PremiumOnboardingStep, afterTransition?: () => void) => {
    clearAdvanceTimer();
    setAdvancingStep(stepRef.current);
    advanceTimerRef.current = window.setTimeout(() => {
      stepRef.current = nextStep;
      setStep(nextStep);
      setAdvancingStep(null);
      advanceTimerRef.current = null;
      afterTransition?.();
    }, STEP_HANDOFF_DELAY_MS);
  };

  const finishOnboardingAfterHandoff = () => {
    if (!authUser || advancingStep) return;
    clearAdvanceTimer();
    setAdvancingStep(stepRef.current);
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      setAdvancingStep(null);
      onLaunch(authUser);
    }, STEP_HANDOFF_DELAY_MS);
  };

  const routeAuthenticatedUser = (user: GoogleAuthUserWithOnboardingV2) => {
    setAuthUser(user);
    onAuthUserChange(user);
    const completedOnboarding = user.onboardingV1?.onboardingVersion === 1;
    if (completedOnboarding) {
      // Returning user — skip straight to launcher
      onLaunch(user);
      return;
    }
    // New user — show persona selection
    transitionToStep('persona');
  };

  const verifyExistingSession = async () => {
    const attemptId = authAttemptRef.current + 1;
    authAttemptRef.current = attemptId;
    setAuthState('checking');
    setAuthError(null);
    try {
      const result = await window.electronAPI?.googleVerifySession?.();
      if (authAttemptRef.current !== attemptId) return;
      if (result?.success && result.user) {
        setAuthState('success');
        routeAuthenticatedUser(result.user);
      } else {
        setAuthState('idle');
      }
    } catch (error: any) {
      if (authAttemptRef.current !== attemptId) return;
      setAuthState('idle');
      setAuthError(error?.message || null);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      hasInitializedOpenStateRef.current = false;
      saveAttemptKeyRef.current = null;
      authAttemptRef.current += 1;
      clearAdvanceTimer();
      return;
    }

    if (hasInitializedOpenStateRef.current) return;

    hasInitializedOpenStateRef.current = true;
    saveAttemptKeyRef.current = null;
    stepRef.current = initialStep;
    setStep(initialStep);
    setPersona(null);
    setIndustry(null);
    setDiscoverySource(null);
    setAuthError(null);
    setSaveError(null);
    setIsSaving(false);
    setAdvancingStep(null);

    if (initialStep === 'oauth') {
      void verifyExistingSession();
    } else {
      setAuthState('idle');
    }
  }, [isOpen, initialStep, initialUser?.email]);

  const handleWelcomeContinue = () => {
    if (advancingStep) return;
    if (status && isPermissionStatusOperational(status)) {
      completePermissionsOnboarding();
      transitionToStep('oauth', () => { void verifyExistingSession(); });
      return;
    }
    transitionToStep('permissions');
  };

  const handlePermissionsContinue = () => {
    if (advancingStep) return;
    completePermissionsOnboarding();
    transitionToStep('oauth', () => { void verifyExistingSession(); });
  };

  const handleGoogleSignIn = async () => {
    if (advancingStep) return;
    const attemptId = authAttemptRef.current + 1;
    authAttemptRef.current = attemptId;
    setAuthState('waiting');
    setAuthError(null);
    try {
      if (!window.electronAPI?.googleSignIn) {
        throw new Error('Google sign in is only available in the desktop app.');
      }
      const result = await window.electronAPI.googleSignIn();
      if (authAttemptRef.current !== attemptId) return;
      if (result?.success && result.user) {
        setAuthState('success');
        routeAuthenticatedUser(result.user);
      } else {
        setAuthState('error');
        setAuthError(result?.error || 'Sign in failed. Please try again.');
      }
    } catch (error: any) {
      if (authAttemptRef.current !== attemptId) return;
      setAuthState('error');
      setAuthError(error?.message || 'Failed to start sign in.');
    }
  };

  const handlePersonaSelect = (selectedPersona: PersonaId) => {
    if (advancingStep) return;
    setPersona(selectedPersona);
    transitionToStep('industry');
  };

  const handleIndustrySelect = (selectedIndustry: IndustryId) => {
    if (advancingStep) return;
    setIndustry(selectedIndustry);
    transitionToStep('discovery');
  };

  const handleDiscoverySelect = async (selectedDiscovery: DiscoverySourceId) => {
    if (advancingStep) return;
    setDiscoverySource(selectedDiscovery);
    // Save onboarding and launch directly
    completePermissionsOnboarding();
    setIsSaving(true);
    try {
      const result = await window.electronAPI?.googleSaveOnboardingV1?.({
        persona: persona || 'explore_quietly',
        industry: industry || 'other',
        discoverySource: selectedDiscovery,
        onboardingVersion: 1,
        completedInVersion: '1.0.0',
      });
      if (result?.success && result.user) {
        const savedUser = result.user;
        setAuthUser(savedUser);
        onAuthUserChange(savedUser);
        // Animate out then launch
        clearAdvanceTimer();
        setAdvancingStep('discovery');
        advanceTimerRef.current = window.setTimeout(() => {
          advanceTimerRef.current = null;
          setAdvancingStep(null);
          onLaunch(savedUser);
        }, STEP_HANDOFF_DELAY_MS);
      } else {
        // Fallback: launch anyway with current user
        if (authUser) onLaunch(authUser);
      }
    } catch (error: any) {
      console.error('[Onboarding] Save failed:', error);
      // Launch anyway — don't block user
      if (authUser) onLaunch(authUser);
    } finally {
      setIsSaving(false);
    }
  };

  // Building step removed — save happens inline in handleDiscoverySelect
  const renderStep = () => {
    if (step === 'oauth') {
      return (
        <GoogleAuthScreen
          authState={authState}
          authError={authError}
          isAdvancing={advancingStep === 'oauth'}
          onRefresh={verifyExistingSession}
          onSignIn={handleGoogleSignIn}
        />
      );
    }

    if (step === 'persona') {
      return (
        <PersonaScreen
          selected={persona}
          isAdvancing={advancingStep === 'persona'}
          onSelect={handlePersonaSelect}
        />
      );
    }

    if (step === 'industry') {
      return (
        <ChipDecisionScreen
          testId="onboarding-v2-industry"
          eyebrow="Industry"
          title="What industry are you in?"
          description="This helps Quietly tune examples, language, and likely context."
          options={INDUSTRY_OPTIONS}
          selected={industry}
          isAdvancing={advancingStep === 'industry'}
          layoutId="onboarding-v2-industry-selected"
          onSelect={handleIndustrySelect}
        />
      );
    }

    if (step === 'discovery') {
      return (
        <ChipDecisionScreen
          testId="onboarding-v2-discovery"
          eyebrow="Discovery"
          title="How did you hear about Quietly?"
          description="One last signal so we can understand how people find the product."
          options={DISCOVERY_OPTIONS}
          selected={discoverySource}
          isAdvancing={advancingStep === 'discovery'}
          layoutId="onboarding-v2-discovery-selected"
          onSelect={handleDiscoverySelect}
        />
      );
    }

    return null;
  };

  if (!isOpen) return null;

  const isIntentStep = step === 'persona' || step === 'industry' || step === 'discovery';

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="teamsync-premium-onboarding-v2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed inset-0 z-[140] flex min-h-screen items-center justify-center overflow-y-auto px-4 py-10 text-white backdrop-blur-[6px] backdrop-saturate-[0.72] ${
          isIntentStep
            ? 'bg-[linear-gradient(180deg,rgba(0,0,0,0.34)_0%,rgba(0,0,0,0.22)_42%,rgba(0,0,0,0.12)_100%)]'
            : 'bg-[linear-gradient(180deg,rgba(0,0,0,0.70)_0%,rgba(0,0,0,0.50)_42%,rgba(0,0,0,0.24)_100%)]'
        }`}
      >
        <AuroraBackdrop isSoft={isIntentStep} />
        <AnimatePresence mode="wait">{renderStep()}</AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
