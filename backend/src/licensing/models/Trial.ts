export type TrialStatus = 'active' | 'expired' | 'converted' | 'revoked';

export interface TrialDocument {
  trialId: string;
  userId: string;
  deviceId: string;
  deviceName?: string;
  status: TrialStatus;
  expiresAt: Date;
  entitlementVersion: number;
  createdAt: Date;
  updatedAt: Date;
  convertedTo?: string;
}
