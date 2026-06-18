import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, Mic, MousePointer2, Check, Settings, AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePermissionsStore } from '../../../stores/usePermissionsStore';
import type { PermissionKind, PermissionState } from '../../../lib/permissions/types';
import { isPermissionStatusOperational } from '../../../lib/permissions/utils';
import {
  stepModalVariants,
  stepItemVariants,
  modalFrameStyle,
  ModalFrameBorder,
} from './animations';

const PERMISSION_ROWS: Array<{
  key: PermissionKind;
  label: string;
  description: string;
  icon: typeof Monitor;
  iconBg: string;
  iconColor: string;
}> = [
  {
    key: 'screenRecording',
    label: 'Screen Recording',
    description: 'Required to capture meeting content',
    icon: Monitor,
    iconBg: 'bg-[#ff453a]/16',
    iconColor: 'text-[#ff453a]',
  },
  {
    key: 'microphone',
    label: 'Microphone',
    description: 'Required for speech transcription',
    icon: Mic,
    iconBg: 'bg-[#3a8aff]/16',
    iconColor: 'text-[#3a8aff]',
  },
  {
    key: 'accessibility',
    label: 'Accessibility',
    description: 'Required for overlay assistance',
    icon: MousePointer2,
    iconBg: 'bg-[#bf5af2]/16',
    iconColor: 'text-[#bf5af2]',
  },
];

function getPermissionStatusInfo(state: PermissionState | undefined) {
  switch (state) {
    case 'granted':
      return { label: 'Granted', color: 'text-emerald-400', isGranted: true };
    case 'denied':
    case 'restart_required':
      return { label: 'Re-enable in Settings', color: 'text-[#ff453a]', isGranted: false };
    case 'not_requested':
    default:
      return { label: 'Required', color: 'text-white/40', isGranted: false };
  }
}

export type PermissionsStepProps = {
  isAdvancing: boolean;
  onContinue: () => void;
};

export function PermissionsStep({ isAdvancing, onContinue }: PermissionsStepProps) {
  const status = usePermissionsStore((s) => s.status);
  const isChecking = usePermissionsStore((s) => s.isChecking);
  const activePermission = usePermissionsStore((s) => s.activePermission);
  const requestPermission = usePermissionsStore((s) => s.requestPermission);
  const openSettings = usePermissionsStore((s) => s.openSettings);
  const refreshPermissions = usePermissionsStore((s) => s.refreshPermissions);

  const [showModal, setShowModal] = useState(false);

  // Natively-style: show modal after 1.8s delay
  useEffect(() => {
    const timer = setTimeout(() => setShowModal(true), 1800);
    return () => clearTimeout(timer);
  }, []);

  // Auto-refresh permissions periodically
  useEffect(() => {
    const interval = setInterval(() => {
      void refreshPermissions();
    }, 3000);
    return () => clearInterval(interval);
  }, [refreshPermissions]);

  const allGranted = status ? isPermissionStatusOperational(status) : false;

  const handlePermissionAction = (permission: PermissionKind) => {
    const state = status?.[permission];
    if (state === 'denied' || state === 'restart_required') {
      void openSettings(permission);
    } else {
      void requestPermission(permission);
    }
  };

  return (
    <motion.section
      key="onboarding-v3-permissions"
      variants={stepModalVariants}
      initial="hidden"
      animate={isAdvancing ? 'advanceExit' : 'visible'}
      exit="exit"
      data-testid="onboarding-v3-permissions"
      className={`relative w-[calc(100vw-32px)] max-w-[540px] transform-gpu overflow-hidden rounded-[15px] bg-[#0b0d12]/[0.70] shadow-[0_26px_90px_rgba(0,0,0,0.50),inset_0_1px_0_rgba(255,255,255,0.065)] backdrop-blur-[34px] will-change-transform ${
        isAdvancing ? 'pointer-events-none' : ''
      }`}
      style={modalFrameStyle}
    >
      <ModalFrameBorder />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_93%,rgba(109,55,28,0.13),transparent_43%),radial-gradient(circle_at_70%_94%,rgba(91,45,18,0.11),transparent_46%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] bg-gradient-to-b from-transparent to-[#08090d] opacity-70" />

      {/* Dark prelude — shows for 1.8s before modal slides up */}
      <AnimatePresence>
        {!showModal && (
          <motion.div
            key="prelude"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-h-[380px] flex-col items-center justify-center px-[36px] py-[44px]"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', duration: 0.8, bounce: 0.2 }}
              className="mb-6 flex h-16 w-16 items-center justify-center rounded-[20px] border border-white/10 bg-white/[0.05]"
            >
              <Settings className="h-7 w-7 text-white/60" strokeWidth={1.5} />
            </motion.div>
            <motion.p
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="text-[15px] font-semibold text-white/52"
            >
              Setting up permissions…
            </motion.p>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
              className="mt-4"
            >
              <Loader2 className="h-5 w-5 animate-spin text-white/30" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Permission modal — slides up after delay */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            key="modal"
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              type: 'spring',
              duration: 0.82,
              bounce: 0.12,
            }}
            className="px-[36px] pb-[28px] pt-[44px]"
          >
            {/* Header */}
            <motion.div
              variants={stepItemVariants}
              initial="hidden"
              animate="visible"
            >
              <div className="mb-[6px] flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/36">
                <Settings className="h-3.5 w-3.5" strokeWidth={2} />
                Permissions
              </div>
              <h2 className="text-[34px] font-semibold leading-[1.06] text-white/88 drop-shadow-[0_0_10px_rgba(255,255,255,0.20)]">
                Let's get you set up
              </h2>
              <p className="mt-[10px] text-[13px] font-semibold leading-[1.48] text-white/52">
                TeamSync needs a few permissions to capture meetings and transcribe speech.
              </p>
            </motion.div>

            {/* Permission Rows */}
            <motion.div
              className="mt-[24px] space-y-[8px]"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: {
                  transition: { delayChildren: 0.15, staggerChildren: 0.08 },
                },
              }}
            >
              {PERMISSION_ROWS.map((permission) => {
                const state = status?.[permission.key];
                const info = getPermissionStatusInfo(state);
                const isActive = activePermission === permission.key;
                const Icon = permission.icon;

                return (
                  <motion.div
                    key={permission.key}
                    variants={stepItemVariants}
                    className="group relative overflow-hidden rounded-[12px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px]"
                  >
                    <div className="flex items-center gap-3.5 p-[14px]">
                      {/* Icon */}
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${permission.iconBg}`}>
                        <Icon className={`h-4.5 w-4.5 ${permission.iconColor}`} strokeWidth={1.8} />
                      </div>

                      {/* Label + Status */}
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-semibold text-white/84">
                          {permission.label}
                        </div>
                        <div className={`mt-0.5 text-[11px] font-medium ${info.color}`}>
                          {info.label}
                        </div>
                      </div>

                      {/* Toggle / Check */}
                      <button
                        type="button"
                        onClick={() => handlePermissionAction(permission.key)}
                        disabled={info.isGranted || isActive || isAdvancing}
                        className="relative"
                      >
                        {info.isGranted ? (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20"
                          >
                            <Check className="h-4 w-4 text-emerald-400" strokeWidth={2.5} />
                          </motion.div>
                        ) : isActive ? (
                          <div className="flex h-8 w-8 items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-white/40" />
                          </div>
                        ) : (
                          <motion.div
                            whileHover={{ scale: 1.08 }}
                            whileTap={{ scale: 0.92 }}
                            className="flex h-[30px] w-[52px] items-center rounded-full border border-white/10 bg-white/[0.06] px-[3px] transition-colors hover:border-white/20"
                          >
                            <div className="h-[24px] w-[24px] rounded-full bg-white/30 shadow-sm" />
                          </motion.div>
                        )}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>

            {/* Warning if not all granted */}
            <AnimatePresence>
              {!allGranted && showModal && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-[12px] flex items-start gap-2 rounded-[10px] border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/70" strokeWidth={2} />
                  <p className="text-[11px] font-medium leading-[1.5] text-amber-200/60">
                    Some features may be limited without all permissions. You can enable them later in Settings.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Open Settings Button */}
            <motion.div
              variants={stepItemVariants}
              initial="hidden"
              animate="visible"
              className="mt-[20px]"
            >
              <motion.button
                type="button"
                whileHover={{ y: -1, scale: 1.006 }}
                whileTap={{ scale: 0.986 }}
                onClick={() => void openSettings('screenRecording')}
                disabled={isAdvancing}
                className="group relative inline-flex h-[42px] w-full items-center justify-center gap-2 overflow-hidden rounded-full border border-[#3b82f6]/40 bg-gradient-to-b from-[#3b82f6]/24 to-[#2563eb]/16 px-5 text-[13px] font-semibold text-white/88 shadow-[0_12px_32px_rgba(59,130,246,0.12)] transition-all duration-300 hover:border-[#3b82f6]/60 hover:shadow-[0_12px_40px_rgba(59,130,246,0.20)]"
              >
                <Settings className="h-4 w-4 text-white/70" strokeWidth={1.8} />
                Open Settings
              </motion.button>
            </motion.div>

            {/* Continue Button */}
            <motion.div
              variants={stepItemVariants}
              initial="hidden"
              animate="visible"
              className="mt-[10px]"
            >
              <motion.button
                type="button"
                whileHover={!isAdvancing ? { y: -1, scale: 1.006 } : undefined}
                whileTap={!isAdvancing ? { scale: 0.986 } : undefined}
                onClick={onContinue}
                disabled={isAdvancing}
                className={`group relative inline-flex h-[42px] w-full items-center justify-center gap-2 overflow-hidden rounded-full border px-5 text-[13px] font-semibold shadow-[0_12px_32px_rgba(255,255,255,0.08)] transition-all duration-300 ${
                  allGranted
                    ? 'border-white/[0.16] bg-white/[0.94] text-[#050506] hover:bg-white'
                    : 'border-white/[0.10] bg-white/[0.08] text-white/60 hover:bg-white/[0.12]'
                }`}
              >
                <span className={`pointer-events-none absolute inset-x-4 top-0 h-px ${allGranted ? 'bg-white/70' : 'bg-white/10'}`} />
                {allGranted ? 'Continue' : 'Continue anyway'}
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
