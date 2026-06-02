import crypto from 'crypto';
import { getLicensesCollection } from '../../db/mongodb';
import type { EntitlementPayload, LicenseSyncState } from '../models/Entitlement';
import type { LicenseDocument } from '../models/License';
import { DeviceLimitError, DeviceRevokedError, DeviceService } from './DeviceService';
import { EntitlementService } from './EntitlementService';

export type LicenseActivationResult =
  | { success: true; entitlement: EntitlementPayload }
  | { success: false; error: string; code: string; status?: LicenseSyncState };

export type LicenseSyncResult =
  | { success: true; status: 'active'; entitlement: EntitlementPayload }
  | { success: false; status: Exclude<LicenseSyncState, 'active'>; error: string };

export class LicenseService {
  constructor(
    private readonly entitlementService = new EntitlementService(),
    private readonly deviceService = new DeviceService()
  ) {}

  async activate(params: {
    licenseKey: string;
    deviceId: string;
    deviceName?: string;
    platform?: string;
    appVersion?: string;
  }): Promise<LicenseActivationResult> {
    const licenseKey = normalizeRequired(params.licenseKey);
    const deviceId = normalizeRequired(params.deviceId);
    const license = await this.findLicenseByKey(licenseKey);

    if (!license) {
      return { success: false, code: 'invalid_license', error: 'Invalid license key.' };
    }

    const status = this.evaluateLicenseStatus(license);
    if (status !== 'active') {
      return {
        success: false,
        code: status,
        status,
        error: licenseStatusError(status),
      };
    }

    try {
      await this.deviceService.registerOrTouchDevice({
        license,
        deviceId,
        deviceName: params.deviceName,
        platform: params.platform,
        appVersion: params.appVersion,
      });
    } catch (error) {
      if (error instanceof DeviceLimitError) {
        return { success: false, code: 'device_limit_exceeded', error: error.message };
      }
      if (error instanceof DeviceRevokedError) {
        return { success: false, code: 'device_removed', status: 'device_removed', error: error.message };
      }
      throw error;
    }

    const entitlement = await this.entitlementService.issueForLicense({
      license,
      deviceId,
    });

    return { success: true, entitlement };
  }

  async sync(params: {
    deviceId: string;
    licenseId: string;
    entitlementVersion?: number;
  }): Promise<LicenseSyncResult> {
    const deviceId = normalizeRequired(params.deviceId);
    const licenseId = normalizeRequired(params.licenseId);
    const license = await getLicensesCollection().findOne({ licenseId });

    if (!license) {
      return { success: false, status: 'not_found', error: 'License not found.' };
    }

    const status = this.evaluateLicenseStatus(license);
    if (status !== 'active') {
      return { success: false, status, error: licenseStatusError(status) };
    }

    const device = await this.deviceService.getActiveDevice(license.licenseId, deviceId);
    if (!device) {
      return { success: false, status: 'device_removed', error: 'Device has been removed from this license.' };
    }

    await this.deviceService.touch(license.licenseId, deviceId);
    const entitlement = await this.entitlementService.issueForLicense({
      license,
      deviceId,
    });

    return { success: true, status: 'active', entitlement };
  }

  async deactivate(params: {
    deviceId: string;
    licenseId: string;
  }): Promise<{ success: true }> {
    await this.deviceService.markRemoved(
      normalizeRequired(params.licenseId),
      normalizeRequired(params.deviceId)
    );
    return { success: true };
  }

  async markProviderStatus(params: {
    provider: 'dodo' | 'gumroad' | 'stripe';
    providerSubscriptionId?: string;
    licenseId?: string;
    status: string;
    revoked?: boolean;
  }): Promise<void> {
    const query = params.licenseId
      ? { licenseId: params.licenseId }
      : params.providerSubscriptionId
        ? { provider: params.provider, providerSubscriptionId: params.providerSubscriptionId }
        : null;
    if (!query) return;

    const now = new Date();
    const update: Partial<LicenseDocument> = {
      subscriptionStatus: normalizeSubscriptionStatus(params.status),
      updatedAt: now,
    } as Partial<LicenseDocument>;

    if (params.revoked) {
      update.status = 'revoked';
      update.revokedAt = now;
    }

    await getLicensesCollection().updateOne(query, {
      $set: update,
      $inc: { entitlementVersion: 1 },
    });
  }

  private async findLicenseByKey(licenseKey: string): Promise<LicenseDocument | null> {
    return getLicensesCollection().findOne({
      licenseKeyHash: hashLicenseKey(licenseKey),
    });
  }

  private evaluateLicenseStatus(license: LicenseDocument): LicenseSyncState {
    if (license.revokedAt || license.status === 'revoked' || license.status === 'disabled') {
      return 'revoked';
    }
    if (license.status === 'expired') {
      return 'expired';
    }
    if (license.expiresAt && license.expiresAt.getTime() <= Date.now()) {
      return 'expired';
    }
    if (!['active', 'trialing'].includes(license.subscriptionStatus)) {
      return 'subscription_failed';
    }
    if (license.status !== 'active') {
      return 'revoked';
    }
    return 'active';
  }
}

export function hashLicenseKey(licenseKey: string): string {
  return crypto
    .createHash('sha256')
    .update(licenseKey.trim())
    .digest('hex');
}

function normalizeRequired(value: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new Error('Required licensing field is missing.');
  return trimmed;
}

function licenseStatusError(status: LicenseSyncState): string {
  switch (status) {
    case 'expired':
      return 'License has expired.';
    case 'device_removed':
      return 'This device is not active for the license.';
    case 'subscription_failed':
      return 'Subscription is not active.';
    case 'revoked':
      return 'License has been revoked.';
    default:
      return 'License is not active.';
  }
}

function normalizeSubscriptionStatus(status: string): LicenseDocument['subscriptionStatus'] {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'active' || normalized === 'trialing') return normalized;
  if (normalized === 'past_due') return 'past_due';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'canceled';
  if (normalized === 'expired') return 'expired';
  return 'failed';
}
