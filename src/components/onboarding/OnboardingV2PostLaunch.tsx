import { useEffect, useState } from 'react';
import { FirstSuccessPrompt } from './FirstSuccessPrompt';
import { GuidedProductTour } from './GuidedProductTour';
import {
  normalizeOnboardingEmail,
  type FirstSuccessActionId,
  type GoogleAuthUserWithOnboardingV2,
  type OnboardingV2State,
} from './onboardingV2Types';

type OnboardingV2PostLaunchProps = {
  isEnabled: boolean;
  user: GoogleAuthUserWithOnboardingV2 | null;
  onOpenSettings: (tab?: string) => void;
  onCloseSettings: () => void;
  onStartMeeting: () => Promise<boolean> | boolean | void;
  onAuthUserChange: (user: GoogleAuthUserWithOnboardingV2) => void;
};

const DEFAULT_STATE: OnboardingV2State = {
  tourComplete: false,
  firstSuccess: {
    completed: false,
    action: null,
    completedAt: null,
  },
};

function mergeState(state?: OnboardingV2State | null): OnboardingV2State {
  if (!state) return DEFAULT_STATE;
  return {
    tourComplete: state.tourComplete === true,
    firstSuccess: {
      completed: state.firstSuccess?.completed === true,
      action: state.firstSuccess?.action ?? null,
      completedAt: state.firstSuccess?.completedAt ?? null,
    },
  };
}

export function OnboardingV2PostLaunch({
  isEnabled,
  user,
  onOpenSettings,
  onCloseSettings,
  onStartMeeting,
  onAuthUserChange,
}: OnboardingV2PostLaunchProps) {
  const [state, setState] = useState<OnboardingV2State | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const email = user?.email ? normalizeOnboardingEmail(user.email) : '';

  useEffect(() => {
    if (!isEnabled || !email) {
      setState(null);
      setIsLoaded(false);
      return;
    }

    let cancelled = false;
    setIsLoaded(false);
    window.electronAPI?.onboardingV2GetState?.(email)
      .then((result) => {
        if (cancelled) return;
        setState(mergeState(result?.state));
      })
      .catch(() => {
        if (cancelled) return;
        setState(DEFAULT_STATE);
      })
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [email, isEnabled]);

  const updateState = async (patch: Partial<OnboardingV2State>) => {
    if (!email) return;
    const result = await window.electronAPI?.onboardingV2UpdateState?.(email, patch);
    if (result?.success && result.state) {
      setState(mergeState(result.state));
    } else {
      setState((current) => mergeState({
        ...(current ?? DEFAULT_STATE),
        ...patch,
        firstSuccess: {
          ...(current ?? DEFAULT_STATE).firstSuccess,
          ...(patch.firstSuccess ?? {}),
        },
      }));
    }
  };

  const markTourComplete = () => {
    void updateState({ tourComplete: true });
  };

  const markFirstSuccessComplete = (action: FirstSuccessActionId | null) => {
    void updateState({
      firstSuccess: {
        completed: true,
        action,
        completedAt: new Date().toISOString(),
      },
    });
  };

  if (!isEnabled || !isLoaded || !state || !user) return null;

  const shouldShowTour = !state.tourComplete;
  const shouldShowFirstSuccess = state.tourComplete && !state.firstSuccess.completed;

  return (
    <>
      <GuidedProductTour
        isOpen={shouldShowTour}
        onOpenSettings={onOpenSettings}
        onCloseSettings={onCloseSettings}
        onComplete={markTourComplete}
        onSkip={markTourComplete}
      />
      <FirstSuccessPrompt
        isOpen={shouldShowFirstSuccess}
        user={user}
        persona={user.onboardingV1?.persona}
        onStartMeeting={onStartMeeting}
        onAuthUserChange={onAuthUserChange}
        onComplete={markFirstSuccessComplete}
        onSkip={() => markFirstSuccessComplete(null)}
      />
    </>
  );
}
