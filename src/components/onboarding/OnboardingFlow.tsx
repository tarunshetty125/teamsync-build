import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import appIcon from '../icon.png';
import { WelcomeStep } from './WelcomeStep';
import { PermissionsStep } from './PermissionsStep';
import { ReadyStep } from './ReadyStep';
import { usePermissionsStore } from '../../stores/usePermissionsStore';
import { isPermissionStatusOperational } from '../../lib/permissions/utils';

interface OnboardingFlowProps {
  isOpen: boolean;
}

const STEPS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'permissions', label: 'Permissions' },
  { key: 'ready', label: 'Ready' },
] as const;

// Ambient background + grain shared across both screens
function AmbientBackground() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-bg-primary" />
        <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.08),transparent_62%)]" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.14))]" />
      </div>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025] mix-blend-overlay"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27320%27 height=%27320%27 viewBox=%270 0 320 320%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.85%27 numOctaves=%273%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27320%27 height=%27320%27 filter=%27url(%23n)%27 opacity=%270.5%27/%3E%3C/svg%3E")',
        }}
      />
    </>
  );
}

export function OnboardingFlow({ isOpen }: OnboardingFlowProps) {
  const [showSplash, setShowSplash] = useState(true);

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
    const t = setTimeout(() => setShowSplash(false), 2200);
    return () => clearTimeout(t);
  }, [isOpen]);

  if (!isOpen) return null;

  const currentIndex = STEPS.findIndex((step) => step.key === currentStep);

  const handleContinueFromWelcome = () => {
    setCurrentStep(status && isPermissionStatusOperational(status) ? 'ready' : 'permissions');
  };

  const handleLaunch = () => {
    if (status && isPermissionStatusOperational(status)) {
      completeOnboarding();
    }
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
          className="fixed inset-0 z-[120] flex items-center justify-center bg-bg-primary text-text-primary"
        >
          <AmbientBackground />

          <div className="relative flex flex-col items-center gap-5">
            <motion.div
              initial={{ scale: 0.6, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
              className="relative"
            >
              <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated shadow-[0_16px_40px_rgba(0,0,0,0.20)]">
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
              <span className="text-[22px] font-semibold tracking-[-0.03em] text-text-primary">TeamSync</span>
              <span className="text-[12px] uppercase tracking-widest text-text-tertiary">Realtime Meeting Intelligence</span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
              className="h-px w-20 bg-border-subtle"
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
          className="fixed inset-0 z-[120] overflow-y-auto bg-bg-primary text-text-primary"
        >
          <AmbientBackground />

          <div className="relative mx-auto flex min-h-screen w-full max-w-[1120px] items-center px-4 py-10 sm:px-6 lg:px-8">
            <div className="w-full">
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
              >
                <div>
                  <div className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary shadow-sm">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Production onboarding
                  </div>
                  <p className="mt-2 max-w-[52ch] text-[13px] leading-6 text-text-secondary">
                    TeamSync keeps checking system access while this flow is open.
                  </p>
                </div>

                <div className="flex items-center gap-0">
                  {STEPS.map((step, index) => {
                    const isActive = currentIndex === index;
                    const isComplete = currentIndex > index;
                    const isLast = index === STEPS.length - 1;
                    return (
                      <div key={step.key} className="flex items-center">
                        <div className="flex flex-col items-center gap-1">
                          <div
                            className={`relative flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold transition-all duration-300 ${
                              isActive
                                ? 'bg-bg-item-active text-text-primary shadow-sm'
                                : isComplete
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'bg-transparent text-text-tertiary'
                            }`}
                          >
                            {isComplete ? (
                              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <span>{index + 1}</span>
                            )}
                            {isActive ? (
                              <motion.span
                                className="absolute -bottom-1 h-0.5 w-5 rounded-full bg-text-primary"
                                layoutId="onboarding-active-step"
                                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                              />
                            ) : null}
                          </div>
                          <span
                            className={`text-[9px] font-semibold uppercase tracking-widest transition-colors ${
                              isActive ? 'text-text-primary' : isComplete ? 'text-emerald-500' : 'text-text-tertiary'
                            }`}
                          >
                            {step.label}
                          </span>
                        </div>
                        {!isLast && (
                          <div className="mx-2 mb-4 h-px w-8 overflow-hidden rounded-full">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isComplete ? 'w-full bg-emerald-500/40' : 'w-full bg-border-subtle'
                              }`}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </motion.div>

              {currentStep === 'welcome' ? <WelcomeStep onContinue={handleContinueFromWelcome} /> : null}

              {currentStep === 'permissions' ? (
                <PermissionsStep
                  status={status}
                  isChecking={isChecking}
                  activePermission={activePermission}
                  lastError={lastError}
                  onRequest={(permission) => { void requestPermission(permission); }}
                  onOpenSettings={(permission) => { void openSettings(permission); }}
                  onRetry={() => { void refreshPermissions(); }}
                  onContinue={() => setCurrentStep('ready')}
                  onQuit={() => { void window.electronAPI?.quitApp?.(); }}
                />
              ) : null}

              {currentStep === 'ready' ? <ReadyStep onLaunch={handleLaunch} /> : null}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
