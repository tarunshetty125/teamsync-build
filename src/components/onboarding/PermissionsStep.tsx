import { motion } from 'framer-motion';
import { Eye, AudioLines, Sparkles, Layers } from 'lucide-react';
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
    <div className="flex flex-col gap-4">
      {snapshot.restartRequired ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col gap-4 overflow-hidden rounded-xl border border-sky-500/20 bg-sky-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <div className="text-[13px] font-medium text-sky-300">Please restart TeamSync to finish enabling screen access.</div>
            <p className="mt-1 text-[12px] leading-relaxed text-sky-400/60">
              macOS has registered Screen Recording, but the app needs a fresh launch.
            </p>
          </div>
          <button
            type="button"
            onClick={onQuit}
            className="rounded-md border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-[13px] font-medium text-sky-300 transition-all hover:bg-sky-400/20 active:scale-[0.98]"
          >
            Quit TeamSync
          </button>
        </motion.div>
      ) : null}

      {lastError ? (
        <div className="overflow-hidden rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-300">
          {lastError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.1fr]">
        <div className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated p-6 shadow-[0_16px_40px_rgba(0,0,0,0.12)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-input px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest text-text-secondary">
              <Layers className="h-3 w-3" />
              TeamSync Realtime Intelligence
            </div>

            <h2 className="mt-4 text-[22px] font-medium leading-[1.15] tracking-[-0.03em] text-text-primary">
              TeamSync needs permissions to power realtime meeting intelligence.
            </h2>

            <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
              Grant these once so TeamSync can capture meetings, understand shared screens, and keep the overlay live.
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {['meeting capture', 'overlay intelligence', 'context-aware'].map((pill) => (
                <span
                  key={pill}
                  className="rounded-md border border-border-subtle bg-bg-input px-2.5 py-1 text-[11px] text-text-secondary"
                >
                  {pill}
                </span>
              ))}
            </div>
          </div>

          <div className="relative mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={onContinue}
              disabled={!allReady}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-text-primary px-4 text-[13px] font-semibold text-bg-primary shadow-sm transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-bg-input disabled:text-text-tertiary disabled:shadow-none"
            >
              Continue setup
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="text-[12px] font-medium text-text-secondary transition-colors hover:text-text-primary"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
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
      </div>
    </div>
  );
}
