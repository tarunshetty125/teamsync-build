import { motion } from 'framer-motion';
import { Accessibility, CheckCircle2, Mic, MonitorSmartphone, RotateCcw, ShieldAlert } from 'lucide-react';
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

  const enabledCount = [
    snapshot.screenRecording === 'granted',
    snapshot.microphone === 'granted',
    snapshot.accessibility === 'granted',
  ].filter(Boolean).length;

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
    <div className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,22,31,0.98),rgba(9,14,21,0.96))] p-6 shadow-[0_26px_90px_rgba(0,0,0,0.4)]"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/7 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/72">
              <ShieldAlert className="h-3.5 w-3.5" />
              Permissions checklist
            </div>
            <h2 className="mt-4 text-[34px] font-celeb leading-none tracking-[-0.04em] text-white">
              Turn on every capability TeamSync needs.
            </h2>
            <p className="mt-3 max-w-[62ch] text-sm leading-6 text-white/62">
              TeamSync checks these permissions in realtime and updates automatically when macOS changes under the
              hood. Finish all three to unlock meeting capture, overlay intelligence, and live context.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-3 text-sm text-white/72">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">System status</div>
            <div className="mt-2 flex items-center gap-2 text-base text-white">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <span>{enabledCount} of 3 enabled</span>
            </div>
          </div>
        </div>
      </motion.div>

      {snapshot.restartRequired ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 rounded-[26px] border border-sky-400/25 bg-sky-400/10 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <div className="text-sm font-semibold tracking-[-0.01em] text-sky-50">Please restart TeamSync to finish enabling screen access.</div>
            <p className="mt-1 text-sm leading-6 text-sky-50/72">
              macOS has registered Screen Recording, but the app needs a fresh launch before screen understanding can go live.
            </p>
          </div>
          <button
            type="button"
            onClick={onQuit}
            className="inline-flex items-center justify-center rounded-2xl border border-sky-100/20 bg-white px-4 py-2.5 text-sm font-semibold text-[#08111c] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/92"
          >
            Quit TeamSync
          </button>
        </motion.div>
      ) : null}

      {lastError ? (
        <div className="rounded-[22px] border border-rose-400/22 bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-50/86">
          {lastError}
        </div>
      ) : null}

      <div className="space-y-4">
        <PermissionCard
          icon={MonitorSmartphone}
          title="Screen Recording"
          description="Required for meeting understanding, IDE context, shared screens, browser visibility, and overlay intelligence."
          detail="If macOS has already been allowed but TeamSync still shows restart required, quit and relaunch the app once."
          status={snapshot.screenRecording}
          isBusy={activePermission === 'screenRecording' && isChecking}
          primaryAction={screenPrimary}
          secondaryAction={
            snapshot.screenRecording === 'denied' || snapshot.screenRecording === 'restart_required'
              ? { label: 'Retry Check', onClick: onRetry, variant: 'secondary' }
              : undefined
          }
        />

        <PermissionCard
          icon={Mic}
          title="Microphone"
          description="Required for realtime transcription, interview assistance, and capturing your side of every meeting."
          detail="If microphone access was denied earlier, reopen System Settings and enable TeamSync under Privacy & Security → Microphone."
          status={snapshot.microphone}
          isBusy={activePermission === 'microphone' && isChecking}
          primaryAction={microphonePrimary}
          secondaryAction={
            snapshot.microphone === 'denied'
              ? { label: 'Retry Check', onClick: onRetry, variant: 'secondary' }
              : undefined
          }
        />

        <PermissionCard
          icon={Accessibility}
          title="Accessibility"
          description="Required for overlay interaction, intelligent controls, and system-aware assistance while TeamSync is running."
          detail="Grant Accessibility in Privacy & Security → Accessibility so TeamSync can stay responsive above other apps."
          status={snapshot.accessibility}
          isBusy={activePermission === 'accessibility' && isChecking}
          primaryAction={accessibilityPrimary}
          secondaryAction={
            snapshot.accessibility === 'denied'
              ? { label: 'Retry Check', onClick: onRetry, variant: 'secondary' }
              : undefined
          }
        />
      </div>

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm font-medium text-white/78 transition-colors duration-200 hover:bg-white/10"
        >
          <RotateCcw className="h-4 w-4" />
          Retry Check
        </button>

        <button
          type="button"
          onClick={onContinue}
          disabled={!allReady}
          className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#08111c] shadow-[0_16px_40px_rgba(255,255,255,0.16)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/92 disabled:cursor-not-allowed disabled:bg-white/16 disabled:text-white/42 disabled:shadow-none"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
