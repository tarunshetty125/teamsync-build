import { motion } from 'framer-motion';
import { Eye, AudioLines, Sparkles, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { PermissionCard } from './PermissionCard';
import type { PermissionKind, PermissionStatusSnapshot } from '../../lib/permissions/types';
import { isPermissionStatusOperational } from '../../lib/permissions/utils';

interface PermissionsStepProps {
  status: PermissionStatusSnapshot | null;
  isChecking: boolean;
  activePermission: PermissionKind | null;
  lastError: string | null;
  onRequest: (permission: PermissionKind) => void;
  onOpenSettings: (permission: PermissionKind) => void;
  onRetry: () => void;
  onContinue: () => void;
  onQuit: () => void;
}

function PermissionModalFrameBorder() {
  const bottomFadeMask = 'linear-gradient(to bottom, #000 0, #000 calc(100% - 30px), transparent calc(100% - 10px))';

  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-[15px] border border-[#a1a3aa]/50"
      style={{
        WebkitMaskImage: bottomFadeMask,
        maskImage: bottomFadeMask,
      }}
    />
  );
}

export function PermissionsStep({
  status,
  isChecking,
  activePermission,
  lastError,
  onRequest,
  onOpenSettings,
  onRetry,
  onContinue,
  onQuit,
}: PermissionsStepProps) {
  const snapshot = status ?? {
    screenRecording: 'not_requested',
    microphone: 'not_requested',
    accessibility: 'not_requested',
    restartRequired: false,
    platform: 'darwin' as NodeJS.Platform,
    checkedAt: new Date().toISOString(),
  };

  const allReady = isPermissionStatusOperational(snapshot);

  const screenPrimary =
    snapshot.screenRecording === 'granted'
      ? { label: 'Retry Check', onClick: onRetry, variant: 'secondary' as const }
      : snapshot.screenRecording === 'denied'
        ? { label: 'Open Settings', onClick: () => onOpenSettings('screenRecording') }
        : snapshot.screenRecording === 'restart_required'
          ? { label: 'Retry Check', onClick: onRetry }
          : { label: 'Grant Access', onClick: () => onRequest('screenRecording') };

  const microphonePrimary =
    snapshot.microphone === 'granted'
      ? { label: 'Retry Check', onClick: onRetry, variant: 'secondary' as const }
      : snapshot.microphone === 'denied'
        ? { label: 'Open Settings', onClick: () => onOpenSettings('microphone') }
        : { label: 'Grant Access', onClick: () => onRequest('microphone') };

  const accessibilityPrimary =
    snapshot.accessibility === 'granted'
      ? { label: 'Retry Check', onClick: onRetry, variant: 'secondary' as const }
      : snapshot.accessibility === 'denied'
        ? { label: 'Open Settings', onClick: () => onOpenSettings('accessibility') }
        : { label: 'Grant Access', onClick: () => onRequest('accessibility') };

  return (
    <motion.section
      initial={{ opacity: 0, y: 56 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full overflow-hidden rounded-[15px] bg-[#020202] px-[24px] pb-[18px] pt-[23px] shadow-[0_22px_72px_rgba(0,0,0,0.64),0_0_70px_rgba(69,49,105,0.14)] backdrop-blur-[24px]"
      data-testid="startup-permissions-modal"
    >
      <PermissionModalFrameBorder />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(96,84,154,0.16),transparent_34%),radial-gradient(circle_at_12%_94%,rgba(54,177,157,0.11),transparent_38%),radial-gradient(circle_at_82%_90%,rgba(190,119,51,0.12),transparent_42%)]" />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -left-20 -top-24 h-[170px] w-[230px] rounded-full bg-[radial-gradient(circle,rgba(126,108,213,0.23),rgba(69,52,130,0.10)_44%,transparent_72%)] blur-[46px]"
        animate={{ opacity: [0.45, 0.75, 0.45], scale: [1, 1.08, 1] }}
        transition={{ duration: 5.6, repeat: Infinity, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-8 h-[180px] w-[220px] rounded-full bg-[radial-gradient(circle,rgba(49,205,171,0.14),rgba(19,77,67,0.08)_45%,transparent_72%)] blur-[54px]"
        animate={{ opacity: [0.32, 0.62, 0.32], scale: [1.02, 1, 1.02] }}
        transition={{ duration: 6.2, repeat: Infinity, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-38%] top-0 h-px w-[42%] bg-gradient-to-r from-transparent via-white/35 to-transparent"
        animate={{ x: ['0%', '310%'], opacity: [0, 0.75, 0] }}
        transition={{ duration: 3.8, repeat: Infinity, repeatDelay: 1.8, ease: [0.22, 1, 0.36, 1] }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#020202]" />

      <div className="relative mx-auto max-w-[350px] text-center">
        <motion.div
          animate={{ y: [0, -2, 0], boxShadow: ['0 0 26px rgba(255,255,255,0.06)', '0 0 34px rgba(126,108,213,0.16)', '0 0 26px rgba(255,255,255,0.06)'] }}
          transition={{ duration: 4.4, repeat: Infinity, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto flex h-[34px] w-[34px] items-center justify-center rounded-full border border-white/10 bg-white/[0.045] text-white/[0.62]"
        >
          <ShieldCheck className="h-[15px] w-[15px]" strokeWidth={1.8} />
        </motion.div>
        <h2 className="mt-[10px] text-[28px] font-semibold leading-[1.04] text-white/[0.9] drop-shadow-[0_0_10px_rgba(255,255,255,0.22)]">
          Enable access
        </h2>
        <p className="mx-auto mt-[8px] max-w-[310px] text-[12px] font-semibold leading-[1.38] text-white/[0.54]">
          TeamSync needs these permissions before the workspace can launch.
        </p>
        <div className="mx-auto mt-[11px] h-px w-[96px] bg-gradient-to-r from-transparent via-white/[0.18] to-transparent" />
      </div>

      <div className="relative mt-[15px] flex flex-col gap-[7px]">
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-2 top-4 h-[120px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.035),transparent_62%)] blur-[18px]"
          animate={{ opacity: [0.45, 0.75, 0.45] }}
          transition={{ duration: 5.2, repeat: Infinity, ease: [0.22, 1, 0.36, 1] }}
        />
        {snapshot.restartRequired ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-3 overflow-hidden rounded-[14px] border border-sky-300/20 bg-sky-400/[0.08] p-[14px] sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <div className="text-[13px] font-bold text-sky-200/90">Restart TeamSync to finish screen access.</div>
              <p className="mt-1 text-[12px] font-medium leading-relaxed text-sky-100/[0.48]">
                macOS has registered Screen Recording, but the app needs a fresh launch.
              </p>
            </div>
            <button
              type="button"
              onClick={onQuit}
              className="h-[34px] rounded-full border border-sky-200/[0.18] bg-sky-200/[0.08] px-4 text-[12px] font-bold text-sky-100/80 transition-all hover:bg-sky-200/[0.14] active:scale-[0.98]"
            >
              Quit TeamSync
            </button>
          </motion.div>
        ) : null}

        {lastError ? (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-[15px] bg-[linear-gradient(145deg,rgba(251,113,133,0.30),rgba(255,255,255,0.045)_48%,rgba(245,158,11,0.11))] p-px shadow-[0_14px_34px_rgba(0,0,0,0.28),0_0_26px_rgba(251,113,133,0.08)]"
            aria-live="polite"
          >
            <div className="relative overflow-hidden rounded-[14px] bg-[linear-gradient(180deg,rgba(23,17,21,0.96),rgba(10,9,11,0.98))] px-[11px] py-[9px] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_96%_86%,rgba(251,113,133,0.13),transparent_48%)]" />
              <div className="relative flex items-center gap-[10px]">
                <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] border border-rose-200/[0.16] bg-rose-300/[0.08] text-rose-100 shadow-[0_0_22px_rgba(251,113,133,0.16)]">
                  <AlertTriangle className="h-[14px] w-[14px]" strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-white/[0.9]">Permission check failed</div>
                  <p className="mt-px truncate text-[9px] font-semibold leading-[1.35] text-rose-100/[0.62]">
                    {lastError}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onRetry}
                  className="h-[25px] shrink-0 rounded-full border border-white/[0.11] bg-white/[0.06] px-[10px] text-[9px] font-bold text-white/[0.68] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:bg-white/[0.10] hover:text-white"
                >
                  Retry
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}

        <PermissionCard
          icon={Eye}
          title="Screen understanding"
          description="See IDEs, browser tabs, shared decks, and live interview prompts in context."
          detail="If macOS has already been allowed but TeamSync still shows restart required, quit and relaunch once."
          status={snapshot.screenRecording}
          isBusy={activePermission === 'screenRecording' && isChecking}
          primaryAction={screenPrimary}
          accent={{
            border: 'linear-gradient(145deg, rgba(111,201,238,0.32), rgba(255,255,255,0.045) 48%, rgba(111,201,238,0.12))',
            glow: 'radial-gradient(circle at 94% 84%, rgba(74,170,219,0.16), transparent 48%)',
            iconGlow: 'rgba(74,170,219,0.20)',
            statusGlow: 'rgba(74,170,219,0.12)',
          }}
          secondaryAction={
            snapshot.screenRecording === 'denied' || snapshot.screenRecording === 'restart_required'
              ? { label: 'Retry', onClick: onRetry, variant: 'secondary' }
              : undefined
          }
        />

        <PermissionCard
          icon={AudioLines}
          title="Live transcription"
          description="Capture microphone and meeting audio in realtime with production STT."
          detail="Reopen System Settings and enable TeamSync under Privacy & Security -> Microphone."
          status={snapshot.microphone}
          isBusy={activePermission === 'microphone' && isChecking}
          primaryAction={microphonePrimary}
          accent={{
            border: 'linear-gradient(145deg, rgba(159,139,255,0.28), rgba(255,255,255,0.045) 48%, rgba(124,142,255,0.11))',
            glow: 'radial-gradient(circle at 94% 84%, rgba(132,111,238,0.14), transparent 48%)',
            iconGlow: 'rgba(139,119,255,0.18)',
            statusGlow: 'rgba(139,119,255,0.11)',
          }}
          secondaryAction={
            snapshot.microphone === 'denied'
              ? { label: 'Retry', onClick: onRetry, variant: 'secondary' }
              : undefined
          }
        />

        <PermissionCard
          icon={Sparkles}
          title="Interview assistance"
          description="Answer faster with contextual prompts, overlays, and instant follow-through."
          detail="Grant Accessibility in Privacy & Security -> Accessibility so TeamSync stays responsive."
          status={snapshot.accessibility}
          isBusy={activePermission === 'accessibility' && isChecking}
          primaryAction={accessibilityPrimary}
          accent={{
            border: 'linear-gradient(145deg, rgba(94,218,174,0.26), rgba(255,255,255,0.045) 48%, rgba(224,157,74,0.10))',
            glow: 'radial-gradient(circle at 94% 84%, rgba(82,205,164,0.14), transparent 48%)',
            iconGlow: 'rgba(82,205,164,0.17)',
            statusGlow: 'rgba(82,205,164,0.11)',
          }}
          secondaryAction={
            snapshot.accessibility === 'denied'
              ? { label: 'Retry', onClick: onRetry, variant: 'secondary' }
              : undefined
          }
        />
      </div>

      <div className="relative mt-[14px] flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-[32px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-[12px] text-[10px] font-bold text-white/[0.56] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white/[0.74] active:scale-[0.98]"
        >
          <RefreshCw className="h-[11px] w-[11px]" strokeWidth={1.8} />
          Refresh
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!allReady}
          className="inline-flex h-[34px] min-w-[130px] items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.92] px-[18px] text-[12px] font-bold text-[#050505] shadow-[0_0_28px_rgba(255,255,255,0.12)] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:bg-white active:scale-[0.985] disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.06] disabled:text-white/[0.34] disabled:shadow-none"
        >
          Continue setup
        </button>
      </div>
    </motion.section>
  );
}
