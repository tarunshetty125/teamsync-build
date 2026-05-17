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
        <div className="absolute -left-40 top-10 h-[500px] w-[500px] rounded-full bg-indigo-600/10 blur-[120px]" />
        <div className="absolute -right-20 bottom-20 h-[400px] w-[400px] rounded-full bg-violet-700/8 blur-[100px]" />
        <div className="absolute left-1/3 top-1/3 h-[300px] w-[300px] rounded-full bg-cyan-600/6 blur-[80px]" />
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
          className="fixed inset-0 z-[120] flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #0c0c0f 0%, #0d0f14 40%, #0a0c10 100%)' }}
        >
          <AmbientBackground />

          <div className="relative flex flex-col items-center gap-5">
            {/* App icon glass container */}
            <motion.div
              initial={{ scale: 0.6, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
              className="relative"
            >
              {/* Outer ping ring */}
              <span className="absolute inset-0 animate-ping rounded-[28px] bg-indigo-500/10" />
              {/* Glass icon panel */}
              <div
                className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[28px] border border-white/15 border-t-white/25 shadow-[0_8px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[40px]"
                style={{ background: 'rgba(255,255,255,0.07)' }}
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-indigo-500/[0.05]" />
                <img
                  src={appIcon}
                  alt="TeamSync"
                  className="relative h-16 w-16 rounded-2xl object-contain"
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
              <span className="text-[22px] font-semibold tracking-[-0.03em] text-white/90">TeamSync</span>
              <span className="text-[12px] text-white/35 tracking-widest uppercase">Realtime Meeting Intelligence</span>
            </motion.div>

            {/* Loading indicator */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
              className="flex items-center gap-1.5"
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1 w-1 rounded-full bg-white/30"
                  style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </motion.div>
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
          className="fixed inset-0 z-[120] overflow-y-auto"
          style={{ background: 'linear-gradient(135deg, #0c0c0f 0%, #0d0f14 40%, #0a0c10 100%)' }}
        >
          <AmbientBackground />

          <div className="relative mx-auto flex min-h-screen w-full max-w-[1280px] items-center px-4 py-10 sm:px-6 lg:px-8">
            <div className="w-full">
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
              >
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Production onboarding
                  </div>
                  <p className="mt-2 max-w-[52ch] text-[13px] leading-6 text-white/40">
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
                            className={`relative flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold backdrop-blur-xl transition-all duration-300 ${
                              isActive
                                ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.35),inset_0_1px_0_rgba(52,211,153,0.3)]'
                                : isComplete
                                  ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-400'
                                  : 'border-white/12 bg-white/[0.05] text-white/30'
                            }`}
                          >
                            {isComplete ? (
                              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <span>{index + 1}</span>
                            )}
                            {isActive && (
                              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20" />
                            )}
                          </div>
                          <span
                            className={`text-[9px] font-semibold uppercase tracking-widest transition-colors ${
                              isActive ? 'text-emerald-300' : isComplete ? 'text-emerald-500/70' : 'text-white/25'
                            }`}
                          >
                            {step.label}
                          </span>
                        </div>
                        {!isLast && (
                          <div className="mx-2 mb-4 h-px w-8 overflow-hidden rounded-full">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                isComplete ? 'w-full bg-emerald-500/40' : 'w-full bg-white/10'
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
