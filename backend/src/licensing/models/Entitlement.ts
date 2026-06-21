import type { LicensePlan } from './License';

export interface EntitlementPayload {
  plan: LicensePlan;
  userId: string;
  deviceId: string;
  licenseId: string;
  trial: boolean;
  issuedAt: string;
  expiresAt: string;
  graceUntil: string;
  entitlementVersion: number;
  features: string[];
  issuer: string;
  /** Server-authoritative timestamp — signed inside payload to prevent clock manipulation */
  serverTime: string;
  signature: string;
}

export interface EntitlementDocument {
  licenseId: string;
  version: number;
  issuedAt: Date;
  expiresAt: Date;
  graceUntil: Date;
  deviceId: string;
  trial: boolean;
  createdAt: Date;
}

export type LicenseSyncState =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'device_removed'
  | 'subscription_failed'
  | 'not_found';
