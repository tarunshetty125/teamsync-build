export type LicensePlan = 'free' | 'pro' | 'pro_plus' | 'team';
export type LicenseStatus = 'active' | 'expired' | 'revoked' | 'disabled';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired' | 'failed';

export interface LicenseDocument {
  licenseId: string;
  licenseKeyHash: string;
  userId: string;
  plan: LicensePlan;
  status: LicenseStatus;
  subscriptionStatus: SubscriptionStatus;
  deviceLimit: number;
  expiresAt?: Date;
  revokedAt?: Date;
  entitlementVersion: number;
  createdAt: Date;
  updatedAt: Date;
}
