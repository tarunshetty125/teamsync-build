import { AnimatePresence, motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
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

export function OnboardingFlow({ isOpen }: OnboardingFlowProps) {
  const {
    currentStep,
    status,
    isChecking,
    lastError,
    activePermission,
    requestPermission,
    refreshPermissions,
    openSettings,
    setCurrentStep,
    completeOnboarding,
  } = usePermissionsStore((state) => ({
    currentStep: state.currentStep,
    status: state.status,
    isChecking: state.isChecking,
    lastError: state.lastError,
    activePermission: state.activePermission,
    requestPermission: state.requestPermission,
    refreshPermissions: state.refreshPermissions,
    openSettings: state.openSettings,
    setCurrentStep: state.setCurrentStep,
    completeOnboarding: state.completeOnboarding,
  }));

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
    <AnimatePresence>
      <motion.div
        key="teamsync-onboarding"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] overflow-y-auto bg-[radial-gradient(circle_at_top,#17304b_0%,#08111c_28%,#04070d_100%)]"
      >
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:24px_24px]" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-screen"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27320%27 height=%27320%27 viewBox=%270 0 320 320%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.85%27 numOctaves=%273%27 stitchTiles=%27stitch%27/%3E%3C/filter%3E%3Crect width=%27320%27 height=%27320%27 filter=%27url(%23n)%27 opacity=%270.5%27/%3E%3C/svg%3E")',
          }}
        />

        <div className="relative mx-auto flex min-h-screen w-full max-w-[1280px] items-center px-4 py-10 sm:px-6 lg:px-8">
          <div className="w-full">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Production onboarding
                </div>
                <p className="mt-3 max-w-[52ch] text-sm leading-6 text-white/52">
                  TeamSync keeps checking system access while this flow is open, so the UI updates as soon as macOS permissions change.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {STEPS.map((step, index) => {
                  const isActive = currentIndex === index;
                  const isComplete = currentIndex > index;

                  return (
                    <div
                      key={step.key}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                        isActive
                          ? 'border-white/18 bg-white text-[#08111c]'
                          : isComplete
                            ? 'border-emerald-300/25 bg-emerald-300/12 text-emerald-100'
                            : 'border-white/10 bg-white/6 text-white/45'
                      }`}
                    >
                      {index + 1}. {step.label}
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
                onRequest={(permission) => {
                  void requestPermission(permission);
                }}
                onOpenSettings={(permission) => {
                  void openSettings(permission);
                }}
                onRetry={() => {
                  void refreshPermissions();
                }}
                onContinue={() => setCurrentStep('ready')}
                onQuit={() => {
                  void window.electronAPI?.quitApp?.();
                }}
              />
            ) : null}

            {currentStep === 'ready' ? <ReadyStep onLaunch={handleLaunch} /> : null}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
