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
          className="flex flex-col gap-4 overflow-hidden rounded-[18px] border border-sky-400/20 border-t-sky-400/30 p-4 shadow-[inset_0_1px_0_rgba(125,211,252,0.15)] backdrop-blur-[40px] sm:flex-row sm:items-center sm:justify-between"
          style={{ background: 'rgba(56,189,248,0.07)' }}
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
            className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-[13px] font-medium text-sky-300 backdrop-blur-md transition-all hover:bg-sky-400/20"
          >
            Quit TeamSync
          </button>
        </motion.div>
      ) : null}

      {lastError ? (
        <div
          className="overflow-hidden rounded-[18px] border border-rose-400/20 border-t-rose-400/30 px-4 py-3 text-[13px] text-rose-300 shadow-[inset_0_1px_0_rgba(251,113,133,0.15)] backdrop-blur-[40px]"
          style={{ background: 'rgba(244,63,94,0.07)' }}
        >
          {lastError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.1fr]">
        {/* Left Panel — Tahoe glass */}
        <div
          className="relative flex flex-col justify-between overflow-hidden rounded-[24px] border border-white/15 border-t-white/25 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-[50px] backdrop-saturate-[180%]"
          style={{ background: 'rgba(255,255,255,0.055)' }}
        >
          <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-gradient-to-br from-white/[0.07] via-transparent to-white/[0.02]" />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-md">
              <Layers className="h-3 w-3" />
              TeamSync Realtime Intelligence
            </div>

            <h2 className="mt-4 text-[22px] font-medium leading-[1.15] tracking-[-0.03em] text-white">
              TeamSync needs permissions to power realtime meeting intelligence.
            </h2>

            <p className="mt-3 text-[13px] leading-relaxed text-white/55">
              Grant these once so TeamSync can capture meetings, understand shared screens, and keep the overlay live.
            </p>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {['meeting capture', 'overlay intelligence', 'context-aware'].map(pill => (
                <span
                  key={pill}
                  className="rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-[11px] text-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-sm"
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
              className="inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl border border-emerald-400/30 bg-emerald-500/[0.15] px-5 py-2.5 text-[13px] font-semibold text-emerald-200 shadow-[0_0_20px_rgba(52,211,153,0.12),inset_0_1px_0_rgba(52,211,153,0.2)] backdrop-blur-xl transition-all active:scale-[0.97] hover:bg-emerald-500/25 hover:border-emerald-400/50 hover:shadow-[0_0_28px_rgba(52,211,153,0.2)] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/30 disabled:shadow-none"
            >
              Continue setup
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="text-[12px] font-medium text-white/35 transition-colors hover:text-white/65"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Right Panel */}
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
            detail="Reopen System Settings and enable TeamSync under Privacy & Security → Microphone."
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
            detail="Grant Accessibility in Privacy & Security → Accessibility so TeamSync stays responsive."
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
