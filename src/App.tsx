import React, { useState, useEffect, useCallback } from "react" // forcing refresh
import { QueryClient, QueryClientProvider } from "react-query"
import { ToastProvider, ToastViewport } from "./components/ui/toast"
import TeamSyncInterface from "./components/TeamSyncInterface"
import SettingsPopup from "./components/SettingsPopup" // Keeping for legacy/specific window support if needed
import Launcher from "./components/Launcher"
import ModelSelectorWindow from "./components/ModelSelectorWindow"
import SettingsOverlay from "./components/SettingsOverlay"
import StartupSequence from "./components/StartupSequence"
import { AnimatePresence, motion } from "framer-motion"
import UpdateBanner from "./components/UpdateBanner"
import { SupportToaster } from "./components/SupportToaster"
import { TeamSyncQuotaBanner } from "./components/TeamSyncQuotaBanner"
import { FreeTrialBanner } from "./components/trial/FreeTrialBanner"
import { FreeTrialModal } from "./components/trial/FreeTrialModal"
import { TrialPromoToaster } from "./components/trial/TrialPromoToaster"
import { OnboardingFlow } from "./components/onboarding/OnboardingFlow"
import GoogleSignIn from "./components/onboarding/GoogleSignIn"
import { AlertCircle } from "lucide-react"
import { clampOverlayOpacity, OVERLAY_OPACITY_DEFAULT, getDefaultOverlayOpacity } from "./lib/overlayAppearance"
import {
  JDAwarenessToaster,
  ProfileFeatureToaster,
  PremiumPromoToaster,
  RemoteCampaignToaster,
  PremiumUpgradeModal,
  TeamSyncApiPromoToaster,
  MaxUltraUpgradeToaster,
  useAdCampaigns
} from './premium'
import { analytics } from "./lib/analytics/analytics.service"
import { ErrorBoundary } from "./components/ErrorBoundary"
import ModesSettings from "./components/settings/ModesSettings"
import { usePermissionsStore } from "./stores/usePermissionsStore"
import { formatBlockingPermissions, isPermissionStatusOperational } from "./lib/permissions/utils"

const queryClient = new QueryClient()

const App: React.FC = () => {
  const isSettingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';
  const isLauncherWindow = new URLSearchParams(window.location.search).get('window') === 'launcher';
  const isOverlayWindow = new URLSearchParams(window.location.search).get('window') === 'overlay';
  const isModelSelectorWindow = new URLSearchParams(window.location.search).get('window') === 'model-selector';
  const isCropperWindow = new URLSearchParams(window.location.search).get('window') === 'cropper';

  // Default to launcher if not specified (dev mode safety)
  const isDefault = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !isCropperWindow;

  if (isCropperWindow) {
    const Cropper = React.lazy(() => import('./components/Cropper'));
    return (
      <React.Suspense fallback={<div className="w-screen h-screen bg-transparent" />}>
        <Cropper />
      </React.Suspense>
    );
  }

  // Initialize Analytics
  useEffect(() => {
    // Only init if we are in a main window context to avoid duplicate events from helper windows
    // Actually, we probably want to track app open from the main entry point.
    // Let's protect initialization to ensure single run per window.
    // The service handles single-init, but let's be thoughtful about WHICH window tracks "App Open".
    // Launcher is the main entry. Overlay is the "Assistant".

    analytics.initAnalytics();

    if (isLauncherWindow || isDefault) {
      analytics.trackAppOpen();
    }

    if (isOverlayWindow) {
      analytics.trackAssistantStart();
    }

    // Cleanup / Session End
    const handleUnload = () => {
      if (isOverlayWindow) {
        analytics.trackAssistantStop();
      }
      if (isLauncherWindow || isDefault) {
        analytics.trackAppClose();
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [isLauncherWindow, isOverlayWindow, isDefault]);

  // State
  const [showStartup, setShowStartup] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return !!localStorage.getItem('teamsync_auth_token');
  });
  const [authUser, setAuthUser] = useState<{ name: string; email: string; picture?: string } | null>(() => {
    const stored = localStorage.getItem('teamsync_auth_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('general');
  const [isModesOpen, setIsModesOpen] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [isPremiumActive, setIsPremiumActive] = useState(false);
  const [hasLoadedLicense, setHasLoadedLicense] = useState(false);
  const [hasCompletedBootstrap, setHasCompletedBootstrap] = useState(false);
  const [planDetails, setPlanDetails] = useState<{ isPremium: boolean; plan?: string; provider?: string }>({ isPremium: false });

  // Overlay opacity — only meaningful when isOverlayWindow, but stored centrally
  // so it can be initialized once from localStorage and updated via IPC.
  const [overlayOpacity, setOverlayOpacity] = useState<number>(() => {
    const stored = localStorage.getItem('teamsync_overlay_opacity');
    const parsed = stored ? parseFloat(stored) : NaN;
    // Treat missing value or the old default (0.65) as "not user-set"
    const isUserSet = Number.isFinite(parsed) && parsed !== OVERLAY_OPACITY_DEFAULT;
    return isUserSet ? clampOverlayOpacity(parsed) : getDefaultOverlayOpacity();
  });

  // Profile state for ad targeting
  const [hasProfile, setHasProfile] = useState(false);
  const [isLauncherMainView, setIsLauncherMainView] = useState(true);

  // Initialize Ads Campaign Manager
  const [appStartTime] = useState<number>(Date.now());
  const [lastMeetingEndTime, setLastMeetingEndTime] = useState<number | null>(null);
  const [isProcessingMeeting, setIsProcessingMeeting] = useState<boolean>(false);

  // Ollama Auto-Pull State
  const [ollamaPullStatus, setOllamaPullStatus] = useState<'idle' | 'downloading' | 'complete' | 'failed'>('idle');
  const [ollamaPullPercent, setOllamaPullPercent] = useState<number>(0);
  const [ollamaPullMessage, setOllamaPullMessage] = useState<string>('');

  // Re-index State
  const [incompatibleWarning, setIncompatibleWarning] = useState<{ count: number; oldProvider: string; newProvider: string } | null>(null);

  // API check
  const [hasTeamSyncApi, setHasTeamSyncApi] = useState<boolean>(false);

  // ── Onboarding / promo toasters ───────────────────────────
  const [showTrialPromo, setShowTrialPromo] = useState(false);
  const [hasPresentedLauncherWindow, setHasPresentedLauncherWindow] = useState(false);

  // ── Free Trial global state ────────────────────────────────
  const [activeTrial, setActiveTrial] = useState<{
    expiresAt: string;
    usage: { ai: number; stt_seconds: number; search: number };
  } | null>(null);
  const [showTrialExpiredModal, setShowTrialExpiredModal] = useState(false);
  const bootstrapUiReady = hasLoadedLicense && hasCompletedBootstrap;

  const syncStartupState = useCallback(async () => {
    const reader = window.electronAPI?.forceResync ?? window.electronAPI?.getStartupState;
    if (!reader) return;
    try {
      const state = await reader();
      setPlanDetails(state?.license ?? { isPremium: false });
      setIsPremiumActive(state?.license?.isPremium ?? false);
      setHasLoadedLicense(true);
      setHasCompletedBootstrap(!!state?.bootstrapComplete);
      setHasProfile(state?.knowledge?.hasResume ?? false);
    } catch {
      setHasLoadedLicense(true);
      setHasCompletedBootstrap(true);
    }
  }, []);

  const permissionsStatus = usePermissionsStore((state) => state.status);
  const permissionsInitialized = usePermissionsStore((state) => state.hasInitialized);
  const onboardingCompleted = usePermissionsStore((state) => state.onboardingCompleted);
  const initializePermissions = usePermissionsStore((state) => state.initialize);
  const refreshPermissions = usePermissionsStore((state) => state.refreshPermissions);
  const setPermissionsStep = usePermissionsStore((state) => state.setCurrentStep);
  const setPermissionsError = usePermissionsStore((state) => state.setLastError);

  const isPermissionsReady = isPermissionStatusOperational(permissionsStatus);
  const shouldShowOnboarding =
    (isLauncherWindow || isDefault) &&
    permissionsInitialized &&
    (!onboardingCompleted || !isPermissionsReady);
  const shouldHoldLauncherBoot = (isLauncherWindow || isDefault) && !permissionsInitialized;
  const shouldRenderStartup = showStartup && !shouldShowOnboarding;
  const isAppReady = !isSettingsWindow && !isOverlayWindow && !isModelSelectorWindow && !shouldRenderStartup && !isSettingsOpen && isLauncherMainView && !shouldShowOnboarding;
  const { activeAd, dismissAd, previewAd } = useAdCampaigns(
    planDetails,
    hasProfile,
    isAppReady,
    appStartTime,
    lastMeetingEndTime,
    isProcessingMeeting,
    hasTeamSyncApi
  );

  // Preview shortcuts — Ctrl/Cmd+Shift+1-5 force-show any ad card.
  // Uses e.code so Shift doesn't remap the digit to a symbol ('!' etc.).
  useEffect(() => {
    const CODE_MAP: Record<string, string> = {
      'Digit1': 'max_ultra_upgrade',
      'Digit2': 'promo',
      'Digit3': 'teamsync_api',
      'Digit4': 'profile',
      'Digit5': 'jd',
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      const ad = CODE_MAP[e.code];
      if (!ad) return;
      e.preventDefault();
      previewAd(ad as any);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [previewAd]);

  useEffect(() => {
    // Clean up old local storage
    localStorage.removeItem('useLegacyAudioBackend');

    void syncStartupState();

    // Also check for TeamSync API key
    window.electronAPI?.getStoredCredentials?.()
      .then((creds) => setHasTeamSyncApi(!!creds?.hasTeamSyncKey))
      .catch(() => { });

    // ── Trial: check stored token and start polling if active ──
    let trialPollId: ReturnType<typeof setInterval> | null = null;
    let profileWiped = false; // guard: only wipe once per session
    const checkTrial = async () => {
      try {
        const res = await window.electronAPI?.getTrialStatus?.();
        if (!res?.ok) return;
        if (res.expired) {
          setActiveTrial(null);
          // Auto-wipe profile data the first time expiry is detected so that
          // resume/JD data doesn't linger in SQLite beyond the trial window.
          if (!profileWiped) {
            profileWiped = true;
            window.electronAPI?.wipeTrialProfileData?.().catch(() => { });
          }
          setShowTrialExpiredModal(true);
          if (trialPollId) { clearInterval(trialPollId); trialPollId = null; }
        } else {
          setActiveTrial({
            expiresAt: res.expires_at ?? '',
            usage: res.usage ?? { ai: 0, stt_seconds: 0, search: 0 },
          });
        }
      } catch { /* ignore — non-critical */ }
    };
    window.electronAPI?.getLocalTrial?.().then((local: any) => {
      if (!local?.hasToken) return;
      if (local.expired) {
        // Already expired at launch — wipe immediately then show modal after a brief delay
        if (!profileWiped) {
          profileWiped = true;
          window.electronAPI?.wipeTrialProfileData?.().catch(() => { });
        }
        setTimeout(() => setShowTrialExpiredModal(true), 10_000);
        return;
      }
      checkTrial();
      trialPollId = setInterval(checkTrial, 30_000);
    }).catch(() => { });

    // Listen for trial-ended event (emitted by trial:end-byok IPC)
    const removeTrialListener = window.electronAPI?.onTrialEnded?.(() => {
      setActiveTrial(null);
      setShowTrialExpiredModal(false);
    });

    // ── Permissions onboarding + promo gating ───────────────
    if (isLauncherWindow || isDefault) {
      void initializePermissions();
      if (usePermissionsStore.getState().onboardingCompleted) {
        setShowTrialPromo(true);
      }
    }

    // Listen for open-settings-tab events from other windows (e.g. overlay Modes button)
    const removeOpenSettingsTab = window.electronAPI?.onOpenSettingsTab?.((tab: string) => {
      setSettingsInitialTab(tab);
      setIsSettingsOpen(true);
    });

    const removePermissionRemediation = window.electronAPI?.onPermissionRemediationRequired?.(({ message }) => {
      setPermissionsStep('permissions');
      setPermissionsError(message);
      void refreshPermissions();
    });

    // Listen for meeting processing completion to trigger post-meeting ads
    const removeMeetingsListener = window.electronAPI?.onMeetingsUpdated?.(() => {
      console.log("[App.tsx] Meetings updated (processing finished), starting ad delay timer");
      setIsProcessingMeeting(false);
      setLastMeetingEndTime(Date.now());
    });

    // Listen for Ollama Auto-Pull Progress
    let removeProgress: (() => void) | undefined;
    let removeComplete: (() => void) | undefined;
    if (window.electronAPI?.onOllamaPullProgress && window.electronAPI?.onOllamaPullComplete) {
      removeProgress = window.electronAPI.onOllamaPullProgress((data) => {
        setOllamaPullStatus('downloading');
        setOllamaPullPercent(data.percent || 0);
        setOllamaPullMessage(data.status || 'Downloading...');
      });

      removeComplete = window.electronAPI.onOllamaPullComplete(() => {
        setOllamaPullStatus('complete');
        setOllamaPullMessage('Local AI memory ready');
        setOllamaPullPercent(100);
        setTimeout(() => setOllamaPullStatus('idle'), 3000);
      });
    }

    let removeWarning: (() => void) | undefined;
    if (window.electronAPI?.onIncompatibleProviderWarning) {
      removeWarning = window.electronAPI.onIncompatibleProviderWarning((data) => {
        setIncompatibleWarning(data);
      });
    }

    // Listen for real-time license status changes (activation, revocation, deactivation)
    const removeLicenseRestored = window.electronAPI?.onLicenseRestored?.(() => {
      void syncStartupState();
    });

    const removeLicenseListener = window.electronAPI?.onLicenseStatusChanged?.((data) => {
      setIsPremiumActive(data.isPremium);
      setPlanDetails(prev => ({ ...prev, isPremium: data.isPremium, ...(data.plan ? { plan: data.plan } : {}) }));
      setHasLoadedLicense(true);
      void syncStartupState();
    });

    const removeKnowledgeReady = window.electronAPI?.onKnowledgeEngineReady?.(() => {
      void syncStartupState();
    });

    return () => {
      if (removeMeetingsListener) removeMeetingsListener();
      if (removeProgress) removeProgress();
      if (removeComplete) removeComplete();
      if (removeWarning) removeWarning();
      if (removeLicenseRestored) removeLicenseRestored();
      if (removeLicenseListener) removeLicenseListener();
      if (removeKnowledgeReady) removeKnowledgeReady();
      if (trialPollId) clearInterval(trialPollId);
      if (removeTrialListener) removeTrialListener();
      if (removeOpenSettingsTab) removeOpenSettingsTab();
      if (removePermissionRemediation) removePermissionRemediation();
    }
  }, [initializePermissions, isDefault, isLauncherWindow, refreshPermissions, setPermissionsError, setPermissionsStep, syncStartupState]);

  useEffect(() => {
    if (!shouldShowOnboarding || !showStartup) return;
    setShowStartup(false);
  }, [shouldShowOnboarding, showStartup]);

  useEffect(() => {
    if (!(isLauncherWindow || isDefault)) return;
    if (!permissionsInitialized || hasPresentedLauncherWindow) return;

    window.electronAPI?.showWindow?.()
      .catch((error) => {
        console.error('Failed to present launcher window after permissions bootstrap:', error);
      });
    setHasPresentedLauncherWindow(true);
  }, [hasPresentedLauncherWindow, isDefault, isLauncherWindow, permissionsInitialized]);

  // Listen for overlay opacity changes — scoped to overlay window only
  useEffect(() => {
    if (!isOverlayWindow) return;
    const removeOpacityListener = window.electronAPI?.onOverlayOpacityChanged?.((opacity) => {
      setOverlayOpacity(opacity);
    });
    return () => {
      if (removeOpacityListener) removeOpacityListener();
    };
  }, [isOverlayWindow]);

  // When the theme switches and no user preference is stored, reset to theme-aware default
  useEffect(() => {
    if (!isOverlayWindow || !window.electronAPI?.onThemeChanged) return;
    return window.electronAPI.onThemeChanged(() => {
      const stored = localStorage.getItem('teamsync_overlay_opacity');
      if (!stored) {
        setOverlayOpacity(getDefaultOverlayOpacity());
      }
    });
  }, [isOverlayWindow]);


  // Handlers
  const handleReindex = async () => {
    if (window.electronAPI?.reindexIncompatibleMeetings) {
      setIncompatibleWarning(null);
      await window.electronAPI.reindexIncompatibleMeetings();
    }
  };

  const handleStartMeeting = async (metadata?: any) => {
    try {
      await refreshPermissions();
      const latestPermissions = usePermissionsStore.getState().status;
      if (!isPermissionStatusOperational(latestPermissions)) {
        const message = latestPermissions?.restartRequired
          ? 'Please restart TeamSync to finish enabling screen access before starting a meeting.'
          : `TeamSync needs ${formatBlockingPermissions(latestPermissions)} access before it can start a meeting.`;
        setPermissionsStep('permissions');
        setPermissionsError(message);
        return false;
      }

      localStorage.setItem('teamsync_last_meeting_start', Date.now().toString());
      const inputDeviceId = metadata?.audio?.inputDeviceId ?? localStorage.getItem('preferredInputDeviceId');
      let outputDeviceId = metadata?.audio?.outputDeviceId ?? localStorage.getItem('preferredOutputDeviceId');
      const useExperimentalSck = localStorage.getItem('useExperimentalSckBackend') === 'true';

      // Override output device ID to force SCK if experimental mode is enabled
      // Default to CoreAudio unless experimental is enabled
      if (useExperimentalSck) {
        console.log("[App] Using ScreenCaptureKit backend (Experimental).");
        outputDeviceId = "sck";
      } else {
        console.log("[App] Using CoreAudio backend (Default).");
      }

      const result = await window.electronAPI.startMeeting({
        ...(metadata ?? {}),
        audio: { ...(metadata?.audio ?? {}), inputDeviceId, outputDeviceId }
      });
      if (result.success) {
        setPermissionsError(null);
        analytics.trackMeetingStarted();
        // Switch to Overlay Mode via IPC
        // The main process handles window switching, but we can reinforce it or just trust main.
        // Actually, main process startMeeting triggers nothing UI-wise unless we tell it to switch window
        // But we configured main.ts to not auto-switch?
        // Let's explicitly request mode change.
        await window.electronAPI.setWindowMode('overlay');
        return true;
      } else {
        console.error("Failed to start meeting:", result.error);
        await refreshPermissions();
        const refreshedPermissions = usePermissionsStore.getState().status;
        if (!isPermissionStatusOperational(refreshedPermissions)) {
          setPermissionsStep('permissions');
          setPermissionsError(result.error || 'Permissions are still blocking TeamSync.');
        }
      }
    } catch (err) {
      console.error("Failed to start meeting:", err);
    }
    return false;
  };

  const handleEndMeeting = async () => {
    console.log("[App.tsx] handleEndMeeting triggered");
    analytics.trackMeetingEnded();
    setIsProcessingMeeting(true);
    try {
      await window.electronAPI.endMeeting();
      console.log("[App.tsx] endMeeting IPC completed");

      const startStr = localStorage.getItem('teamsync_last_meeting_start');
      if (startStr) {
        const duration = Date.now() - parseInt(startStr, 10);
        const threshold = import.meta.env.DEV ? 10000 : 180000;
        if (duration >= threshold) {
          localStorage.setItem('teamsync_show_profile_toaster', 'true');
        }
        localStorage.removeItem('teamsync_last_meeting_start');
      }

      // Switch back to Native Launcher Mode
      // (Ad delay tracking moved to onMeetingsUpdated listener so ads wait for note generation to finish)
      await window.electronAPI.setWindowMode('launcher');
    } catch (err) {
      console.error("Failed to end meeting:", err);
      window.electronAPI.setWindowMode('launcher');
    }
  };

  // Render Logic
  if (isSettingsWindow) {
    return (
      <ErrorBoundary context="SettingsPopup">
        <div className="h-full min-h-0 w-full">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <SettingsPopup />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  if (isModelSelectorWindow) {
    return (
      <ErrorBoundary context="ModelSelector">
        <div className="h-full min-h-0 w-full overflow-hidden">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <ModelSelectorWindow />
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- OVERLAY WINDOW (Meeting Interface) ---
  if (isOverlayWindow) {
    return (
      <ErrorBoundary context="Overlay">
        <div className="w-full relative bg-transparent">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <div
                style={{
                  ['--overlay-opacity' as '--overlay-opacity']: String(overlayOpacity),
                  transition: 'background-color 75ms ease, border-color 75ms ease, box-shadow 75ms ease'
                } as React.CSSProperties}
              >
                <TeamSyncInterface
                  onEndMeeting={handleEndMeeting}
                  overlayOpacity={overlayOpacity}
                  hasProContextAccess={isPremiumActive || !!activeTrial}
                />
              </div>
              <ToastViewport />
            </ToastProvider>
          </QueryClientProvider>
        </div>
      </ErrorBoundary>
    );
  }

  // --- LAUNCHER WINDOW (Default) ---
  // Renders if window=launcher OR no param
  return (
    <ErrorBoundary context="Launcher">
      <div className="h-full min-h-0 w-full relative bg-[#000000]">
        <AnimatePresence>
          {shouldHoldLauncherBoot ? (
            <motion.div
              key="permissions-bootstrap"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              className="flex h-full w-full items-center justify-center bg-[#04070d]"
            >
              <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/66">
                <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-white/70" />
                Preparing TeamSync
              </div>
            </motion.div>
          ) : shouldRenderStartup ? (
            <motion.div
              key="startup"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.1, pointerEvents: "none", transition: { duration: 0.6, ease: "easeInOut" } }}
            >
              <StartupSequence isReady={bootstrapUiReady} onComplete={() => setShowStartup(false)} />
            </motion.div>
          ) : shouldShowOnboarding ? null : !isAuthenticated ? (
            <motion.div
              key="auth"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.05, transition: { duration: 0.5, ease: "easeInOut" } }}
            >
              <GoogleSignIn
                onSignInComplete={(userData) => {
                  localStorage.setItem('teamsync_auth_token', userData.token);
                  localStorage.setItem('teamsync_auth_user', JSON.stringify({
                    name: userData.name,
                    email: userData.email,
                    picture: userData.picture,
                  }));
                  setAuthUser({ name: userData.name, email: userData.email, picture: userData.picture });
                  setIsAuthenticated(true);
                }}
              />
            </motion.div>
          ) : (
            <motion.div
              key="main"
              className="h-full w-full"
              initial={{ opacity: 0, scale: 0.98, y: 15 }} // "Linear" style entry: slightly down and scaled down
              animate={{ opacity: 1, scale: 1, y: 0 }}      // Slide up and snap to place
              transition={{
                duration: 0.8,
                ease: [0.19, 1, 0.22, 1], // Expo-out: snappy start, smooth landing
                delay: 0.1
              }}
            >
              <QueryClientProvider client={queryClient}>
                <ToastProvider>
                  <div id="launcher-container" className="h-full w-full relative">
                    <Launcher
                      onStartMeeting={handleStartMeeting}
                      onOpenSettings={(tab = 'general') => {
                        setSettingsInitialTab(tab);
                        setIsSettingsOpen(true);
                      }}
                      onOpenModes={() => setIsModesOpen(true)}
                      onPageChange={setIsLauncherMainView}
                      ollamaPullStatus={ollamaPullStatus}
                      ollamaPullPercent={ollamaPullPercent}
                      ollamaPullMessage={ollamaPullMessage}
                    />
                  </div>
                  <SettingsOverlay
                    isOpen={isSettingsOpen}
                    onClose={() => {
                      setIsSettingsOpen(false);
                    }}
                    initialTab={settingsInitialTab}
                    isTrialActive={!!activeTrial}
                  />
                  <AnimatePresence>
                    {isModesOpen && (
                      <motion.div
                        key="modes-panel"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                        onClick={(e) => { if (e.target === e.currentTarget) setIsModesOpen(false); }}
                      >
                        <motion.div
                          initial={{ opacity: 0, scale: 0.97, y: 8 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.97, y: 8 }}
                          transition={{ duration: 0.18, ease: [0.19, 1, 0.22, 1] }}
                          className="h-[66vh] w-[70vw] max-h-[720px] max-w-[980px] overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0c0e14] shadow-2xl"
                        >
                          <ModesSettings onClose={() => setIsModesOpen(false)} isPremium={isPremiumActive} isLoaded={hasLoadedLicense} isTrialActive={!!activeTrial} onOpenTeamSyncAPI={() => { setIsModesOpen(false); setSettingsInitialTab('profile'); setIsSettingsOpen(true); }} />
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <ToastViewport />
                </ToastProvider>
              </QueryClientProvider>
            </motion.div>
          )}
        </AnimatePresence>


        <AnimatePresence>
          {incompatibleWarning && isDefault && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed bottom-6 right-6 z-50 pointer-events-auto"
            >
              <div className="bg-[#1A1A1A] border border-[#ff3333]/30 shadow-2xl rounded-2xl p-5 max-w-[340px] flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-[#ff3333] shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-[#E0E0E0] font-medium text-sm">Provider Changed</h3>
                    <p className="text-[#A0A0A0] text-xs mt-1 leading-relaxed">
                      ⚠ {incompatibleWarning.count} meetings used your previous AI provider ({incompatibleWarning.oldProvider}) and won't appear in search results under {incompatibleWarning.newProvider}.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-1 justify-end">
                  <button
                    onClick={() => setIncompatibleWarning(null)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#A0A0A0] hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={handleReindex}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#ff3333]/10 text-[#ff3333] hover:bg-[#ff3333]/20 transition-colors"
                  >
                    Re-index automatically
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <UpdateBanner />
        <SupportToaster />
        <TeamSyncQuotaBanner />



        {/* Free trial countdown banner — only in launcher window while trial is active */}
        {(isLauncherWindow || isDefault) && activeTrial && !shouldShowOnboarding && (
          <FreeTrialBanner
            expiresAt={activeTrial.expiresAt}
            usage={activeTrial.usage}
            onUpgrade={() => {
              setSettingsInitialTab('api');
              setIsSettingsOpen(true);
            }}
          />
        )}

        {/* Trial promo toaster — 5s after restart (self-gates via localStorage + conditions) */}
        {!shouldShowOnboarding && <TrialPromoToaster
          isOpen={showTrialPromo}
          hasTeamSyncKey={hasTeamSyncApi}
          hasTrialToken={!!activeTrial}
          onDismiss={() => setShowTrialPromo(false)}
          onStartTrial={async () => {
            const res = await window.electronAPI?.startTrial?.();
            if (!res?.ok) throw new Error(res?.error || 'Could not start trial');
            if (res.expires_at) {
              setActiveTrial({ expiresAt: res.expires_at, usage: res.usage ?? { ai: 0, stt_seconds: 0, search: 0 } });
            }
            setShowTrialPromo(false);
          }}
          onManualSetup={() => {
            setShowTrialPromo(false);
            setSettingsInitialTab('api');
            setIsSettingsOpen(true);
          }}
        />}

        {/* Post-trial upgrade modal — shown when trial expires */}
        {(isLauncherWindow || isDefault) && showTrialExpiredModal && !shouldShowOnboarding && (
          <FreeTrialModal
            usage={activeTrial?.usage ?? { ai: 0, stt_seconds: 0, search: 0 }}
            onByok={async () => {
              await window.electronAPI?.endTrialByok?.();
            }}
            onStandard={async () => {
              // Wipe resume + JD (orchestrator caches + SQLite) before checkout opens
              await window.electronAPI?.wipeTrialProfileData?.().catch(() => { });
              // Revert active mode to none — Standard plan has no modes access
              await window.electronAPI?.modesSetActive?.(null).catch(() => { });
            }}
            onDone={() => {
              setShowTrialExpiredModal(false);
              setActiveTrial(null);
            }}
          />
        )}
        {/* Ad toasters — render whenever activeAd is set (isLauncherMainView guard bypassed
          when triggered via preview shortcut so the card always surfaces) */}
        {(isLauncherMainView || !!activeAd) && !isSettingsOpen && !shouldShowOnboarding && (
          <TeamSyncApiPromoToaster
            isOpen={activeAd === 'teamsync_api'}
            onDismiss={() => dismissAd('teamsync_api')}
            onOpenSettings={(tab: string) => {
              setSettingsInitialTab(tab);
              setIsSettingsOpen(true);
            }}
          />
        )}
        {(isLauncherMainView || !!activeAd) && !shouldShowOnboarding && (
          <>
            <ProfileFeatureToaster
              isOpen={activeAd === 'profile'}
              onDismiss={dismissAd}
              onSetupProfile={() => {
                setSettingsInitialTab('profile');
                setIsSettingsOpen(true);
              }}
            />
            <JDAwarenessToaster
              isOpen={activeAd === 'jd'}
              onDismiss={dismissAd}
              onSetupJD={() => {
                setSettingsInitialTab('profile');
                setIsSettingsOpen(true);
              }}
            />
            <PremiumPromoToaster
              isOpen={activeAd === 'promo'}
              onDismiss={dismissAd}
              onUpgrade={() => {
                setShowPremiumModal(true);
              }}
            />
            <MaxUltraUpgradeToaster
              isOpen={activeAd === 'max_ultra_upgrade'}
              onDismiss={dismissAd}
              onUpgrade={() => {
                setShowPremiumModal(true);
              }}
            />

            {/* Remote Campaigns Render Logic */}
            <RemoteCampaignToaster
              isOpen={typeof activeAd === 'object' && activeAd !== null}
              campaign={typeof activeAd === 'object' && activeAd !== null ? activeAd : undefined as any}
              onDismiss={dismissAd}
            />
          </>
        )}

        <PremiumUpgradeModal
          isOpen={showPremiumModal}
          onClose={() => setShowPremiumModal(false)}
          isPremium={isPremiumActive}
          onActivated={() => {
            setIsPremiumActive(true);
            // Refresh full plan details after activation so ad targeting reflects the new plan
            window.electronAPI?.licenseGetDetails?.()
              .then(d => setPlanDetails(d ?? { isPremium: true }))
              .catch(() => setPlanDetails({ isPremium: true }));
            setShowPremiumModal(false);
            // If user activated during post-trial modal, close it — they have a plan now
            setShowTrialExpiredModal(false);
            setActiveTrial(null);
            // After activation, open settings to Profile Intelligence
            setTimeout(() => {
              setSettingsInitialTab('profile');
              setIsSettingsOpen(true);
            }, 300);
          }}
          onDeactivated={() => { setIsPremiumActive(false); setPlanDetails({ isPremium: false }); }}
        />
        <OnboardingFlow isOpen={shouldShowOnboarding} />
      </div>
    </ErrorBoundary>
  )
}

export default App
