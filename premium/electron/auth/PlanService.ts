import { EntitlementVerifier } from '../../../electron/licensing/EntitlementVerifier';

export type UserPlanState = {
  plan: string;
  isActive: boolean;
  provider?: string;
  isPremium: boolean;
};

export function isProUser(user: any): boolean {
  const normalizedPlan = typeof user?.plan === 'string' ? user.plan.trim().toLowerCase() : '';
  if (!user?.isActive) {
    return false;
  }

  if (user?.isPremium === true) {
    return true;
  }

  return normalizedPlan.length > 0 && normalizedPlan !== 'free';
}

export function getCurrentUserPlan(): UserPlanState {
  const details = EntitlementVerifier.getInstance().getStatus();
  const normalizedPlan = details.isPremium ? details.plan : 'free';

  return {
    plan: normalizedPlan,
    isActive: details.isPremium,
    provider: details.provider,
    isPremium: details.isPremium,
  };
}

export function hasActiveProPlan(): boolean {
  return isProUser(getCurrentUserPlan());
}
