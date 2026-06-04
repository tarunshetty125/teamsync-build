import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import appIcon from '../icon.png';
import { WelcomeStep } from './WelcomeStep';
import { PermissionsStep } from './PermissionsStep';
import { ReadyStep } from './ReadyStep';
import { usePermissionsStore } from '../../stores/usePermissionsStore';
import { isPermissionStatusOperational } from '../../lib/permissions/utils';

interface OnboardingFlowProps {
  isOpen: boolean;
  skipSplash?: boolean;
  startAtPermissions?: boolean;
  completeAfterPermissions?: boolean;
  onPermissionsComplete?: () => void;
  onLaunchComplete?: () => void;
}

// Reference-style dark startup backdrop shared by splash and permissions.
function AmbientBackground() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#050505]">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(27,24,38,0.68)_0%,rgba(9,9,11,0.86)_42%,rgba(5,5,5,0.98)_100%)]" />
        <div className="absolute -left-40 -top-48 h-[430px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(86,68,130,0.30)_0%,rgba(49,38,79,0.17)_42%,transparent_70%)] blur-[100px]" />
        <div className="absolute -right-36 -top-40 h-[360px] w-[430px] rounded-full bg-[radial-gradient(circle,rgba(151,101,55,0.22)_0%,rgba(67,42,27,0.12)_45%,transparent_72%)] blur-[96px]" />
        <div className="absolute -bottom-44 left-[8%] h-[420px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(99,51,122,0.18)_0%,rgba(35,21,46,0.12)_43%,transparent_72%)] blur-[110px]" />
        <div className="absolute -bottom-48 right-[2%] h-[420px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(42,129,111,0.16)_0%,rgba(18,58,51,0.10)_45%,transparent_72%)] blur-[112px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.18)_58%,rgba(0,0,0,0.48)_100%)]" />
      </div>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27320%27 height=%27320%27 viewBox=%270 0 320 320%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.85%27 numOctaves=%273%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27320%27 height=%27320%27 filter=%27url(%23n)%27 opacity=%270.5%27/%3E%3C/svg%3E")',
        }}
      />
    </>
  );
}

export function OnboardingFlow({
  isOpen,
  skipSplash = false,
  startAtPermissions = false,
  completeAfterPermissions = false,
  onPermissionsComplete,
  onLaunchComplete,
}: OnboardingFlowProps) {
  const [showSplash, setShowSplash] = useState(() => !skipSplash);

  const currentStep = usePermissionsStore((state) => state.currentStep);
  const status = usePermissionsStore((state) => state.status);
  const isChecking = usePermissionsStore((state) => state.isChecking);
  const lastError = usePermissionsStore((state) => state.lastError);
  const activePermission = usePermissionsStore((state) => state.activePermission);
  const requestPermission = usePermissionsStore((state) => state.requestPermission);
  const refreshPermissions = usePermissionsStore((state) => state.refreshPermissions);
  const openSettings = usePermissionsStore((state) => state.openSettings);
  const setCurrentStep = usePermissionsStore((state) => state.setCurrentStep);
  const completeOnboarding = usePermissionsStore((state) => state.completeOnboarding);

  useEffect(() => {
    if (!isOpen) return;
    if (skipSplash) {
      setShowSplash(false);
      return;
    }
    setShowSplash(true);
    const t = setTimeout(() => setShowSplash(false), 2200);
    return () => clearTimeout(t);
  }, [isOpen, skipSplash]);

  useEffect(() => {
    if (!isOpen || !startAtPermissions || currentStep !== 'welcome') return;
    setCurrentStep('permissions');
  }, [currentStep, isOpen, setCurrentStep, startAtPermissions]);

  if (!isOpen) return null;

  const displayStep =
    (startAtPermissions && currentStep === 'welcome') ||
    (completeAfterPermissions && currentStep === 'ready')
      ? 'permissions'
      : currentStep;

  const handleContinueFromWelcome = () => {
    setCurrentStep(status && isPermissionStatusOperational(status) ? 'ready' : 'permissions');
  };

  const handleLaunch = () => {
    if (status && isPermissionStatusOperational(status)) {
      completeOnboarding();
      onLaunchComplete?.();
    }
  };

  const handleContinueFromPermissions = () => {
    if (completeAfterPermissions) {
      if (status && isPermissionStatusOperational(status)) {
        completeOnboarding();
        onPermissionsComplete?.();
      }
      return;
    }

    setCurrentStep('ready');
  };

  return (
    <AnimatePresence mode="wait">
      {showSplash ? (
        /* ── Icon splash screen ── */
        <motion.div
          key="splash"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.06, filter: 'blur(8px)' }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[#050505] text-white"
        >
          <AmbientBackground />

          <div className="relative flex flex-col items-center gap-5">
            <motion.div
              initial={{ scale: 0.6, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
              className="relative"
            >
              <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[18px] border border-white/10 bg-[#020202]/[0.92] shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-[24px]">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
                <img
                  src={appIcon}
                  alt="TeamSync"
                  className="relative h-16 w-16 rounded-lg object-contain"
                />
              </div>
            </motion.div>

            {/* Wordmark + tagline */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center gap-1.5"
            >
              <span className="text-[22px] font-semibold tracking-[-0.03em] text-white/[0.88] drop-shadow-[0_0_10px_rgba(255,255,255,0.20)]">TeamSync</span>
              <span className="text-[12px] uppercase tracking-widest text-white/[0.42]">Realtime Meeting Intelligence</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
              className="h-px w-20 bg-white/10"
            />
          </div>
        </motion.div>
      ) : (
        /* ── Main onboarding flow ── */
        <motion.div
          key="teamsync-onboarding"
          initial={{ opacity: 0, scale: 0.97, filter: 'blur(6px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[120] overflow-y-auto bg-[#050505] text-white"
        >
          <AmbientBackground />

          <div className="relative mx-auto flex min-h-screen w-full max-w-[444px] items-center px-4 py-10 sm:px-0">
            <div className="w-full">
              {displayStep === 'welcome' ? <WelcomeStep onContinue={handleContinueFromWelcome} /> : null}

              {displayStep === 'permissions' ? (
                <PermissionsStep
                  status={status}
                  isChecking={isChecking}
                  activePermission={activePermission}
                  lastError={lastError}
                  onRequest={(permission) => { void requestPermission(permission); }}
                  onOpenSettings={(permission) => { void openSettings(permission); }}
                  onRetry={() => { void refreshPermissions(); }}
                  onContinue={handleContinueFromPermissions}
                  onQuit={() => { void window.electronAPI?.quitApp?.(); }}
                />
              ) : null}

              {displayStep === 'ready' ? <ReadyStep onLaunch={handleLaunch} /> : null}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
