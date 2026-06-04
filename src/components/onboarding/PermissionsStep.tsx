import { motion } from 'framer-motion';
import { Eye, AudioLines, Sparkles, RefreshCw, ShieldCheck } from 'lucide-react';
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
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full overflow-hidden rounded-[15px] bg-[#020202] px-[40px] pb-[30px] pt-[48px] shadow-[0_26px_90px_rgba(0,0,0,0.62)]"
      data-testid="startup-permissions-modal"
    >
      <PermissionModalFrameBorder />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_95%,rgba(109,55,28,0.13),transparent_43%),radial-gradient(circle_at_72%_92%,rgba(84,43,16,0.10),transparent_48%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#020202]" />

      <div className="relative mx-auto max-w-[430px] text-center">
        <div className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/[0.62] shadow-[0_0_26px_rgba(255,255,255,0.06)]">
          <ShieldCheck className="h-[19px] w-[19px]" strokeWidth={1.8} />
        </div>
        <h2 className="mt-[20px] text-[38px] font-semibold leading-[1.04] text-white/[0.88] drop-shadow-[0_0_10px_rgba(255,255,255,0.24)]">
          Enable access
        </h2>
        <p className="mx-auto mt-[16px] max-w-[360px] text-[14px] font-semibold leading-[1.45] text-white/[0.56]">
          TeamSync needs these permissions before the workspace can launch.
        </p>
      </div>

      <div className="relative mt-[30px] flex flex-col gap-[10px]">
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
          <div className="overflow-hidden rounded-[14px] border border-rose-300/20 bg-rose-400/[0.08] px-4 py-3 text-[13px] font-semibold text-rose-100/[0.72]">
            {lastError}
          </div>
        ) : null}

          <PermissionCard
            icon={Eye}
            title="Screen understanding"
            description="See IDEs, browser tabs, shared decks, and live interview prompts in context."
            detail="If macOS has already been allowed but TeamSync still shows restart required, quit and relaunch once."
            status={snapshot.screenRecording}
            isBusy={activePermission === 'screenRecording' && isChecking}
            primaryAction={screenPrimary}
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
            secondaryAction={
              snapshot.accessibility === 'denied'
                ? { label: 'Retry', onClick: onRetry, variant: 'secondary' }
                : undefined
            }
          />
      </div>

      <div className="relative mt-[24px] flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-[38px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-[15px] text-[12px] font-bold text-white/[0.56] transition-all hover:border-white/[0.18] hover:bg-white/[0.06] hover:text-white/[0.74] active:scale-[0.98]"
        >
          <RefreshCw className="h-[13px] w-[13px]" strokeWidth={1.8} />
          Refresh
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!allReady}
          className="inline-flex h-[42px] min-w-[154px] items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.92] px-[22px] text-[14px] font-bold text-[#050505] shadow-[0_0_30px_rgba(255,255,255,0.12)] transition-colors duration-200 hover:bg-white active:scale-[0.985] disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.06] disabled:text-white/[0.34] disabled:shadow-none"
        >
          Continue setup
        </button>
      </div>
    </motion.section>
  );
}
