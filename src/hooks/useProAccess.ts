import React from 'react';

type PlanState = {
  plan: string;
  isActive: boolean;
  isPremium: boolean;
  provider?: string;
};

const FREE_PLAN: PlanState = {
  plan: 'free',
  isActive: false,
  isPremium: false,
};

export function useProAccess() {
  const [planState, setPlanState] = React.useState<PlanState>(FREE_PLAN);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;

    const syncPlan = async () => {
      try {
        const nextPlan = await window.electronAPI.getUserPlan();
        if (!mounted) return;
        setPlanState(nextPlan ?? FREE_PLAN);
      } catch {
        if (!mounted) return;
        setPlanState(FREE_PLAN);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void syncPlan();

    const handlePlanSignal = () => {
      void syncPlan();
    };

    const removeLicenseRestored = window.electronAPI?.onLicenseRestored?.(handlePlanSignal);
    const removeLicenseStatusChanged = window.electronAPI?.onLicenseStatusChanged?.(handlePlanSignal);
    const removeLicenseState = window.electronAPI?.onLicenseState?.(handlePlanSignal);

    return () => {
      mounted = false;
      removeLicenseRestored?.();
      removeLicenseStatusChanged?.();
      removeLicenseState?.();
    };
  }, []);

  return {
    ...planState,
    isPro: planState.plan === 'pro' && planState.isActive,
    isLoading,
  };
}
