import crypto, { randomUUID } from 'crypto';
import { getTrialsCollection } from '../../db/mongodb';
import type { EntitlementPayload } from '../models/Entitlement';
import type { TrialDocument } from '../models/Trial';
import { EntitlementService } from './EntitlementService';

const DEFAULT_TRIAL_MS = 48 * 60 * 60 * 1000;

export class TrialService {
  constructor(private readonly entitlementService = new EntitlementService()) {}

  async start(params: {
    deviceId: string;
    deviceName?: string;
  }): Promise<
    | { success: true; entitlement: EntitlementPayload }
    | { success: false; error: string; code: string }
  > {
    const deviceId = normalizeRequired(params.deviceId);
    const trials = getTrialsCollection();
    const now = new Date();
    const existing = await trials.findOne({ deviceId });

    if (existing) {
      if (existing.status === 'active' && existing.expiresAt.getTime() > now.getTime()) {
        const entitlement = await this.entitlementService.issueForTrial({ trial: existing });
        return { success: true, entitlement };
      }
      return {
        success: false,
        code: 'trial_unavailable',
        error: 'Trial has already been used on this device.',
      };
    }

    const trial: TrialDocument = {
      trialId: `trial_${randomUUID()}`,
      userId: `trial_user_${hashDeviceId(deviceId).slice(0, 16)}`,
      deviceId,
      deviceName: params.deviceName?.trim().slice(0, 80),
      status: 'active',
      expiresAt: new Date(now.getTime() + DEFAULT_TRIAL_MS),
      entitlementVersion: 1,
      createdAt: now,
      updatedAt: now,
    };

    await trials.insertOne(trial);
    const entitlement = await this.entitlementService.issueForTrial({ trial });
    return { success: true, entitlement };
  }

  async status(params: {
    deviceId: string;
    licenseId?: string;
  }): Promise<
    | { success: true; status: 'active'; entitlement: EntitlementPayload }
    | { success: false; status: 'expired' | 'revoked' | 'not_found'; error: string }
  > {
    const deviceId = normalizeRequired(params.deviceId);
    const query = params.licenseId
      ? { trialId: params.licenseId, deviceId }
      : { deviceId };
    const trial = await getTrialsCollection().findOne(query);

    if (!trial) {
      return { success: false, status: 'not_found', error: 'Trial not found.' };
    }

    if (trial.status === 'revoked') {
      return { success: false, status: 'revoked', error: 'Trial has been revoked.' };
    }

    if (trial.status !== 'active' || trial.expiresAt.getTime() <= Date.now()) {
      await getTrialsCollection().updateOne(
        { trialId: trial.trialId },
        { $set: { status: 'expired', updatedAt: new Date() } }
      );
      return { success: false, status: 'expired', error: 'Trial has expired.' };
    }

    await getTrialsCollection().updateOne(
      { trialId: trial.trialId },
      { $set: { updatedAt: new Date() } }
    );
    const entitlement = await this.entitlementService.issueForTrial({ trial });
    return { success: true, status: 'active', entitlement };
  }
}

function hashDeviceId(deviceId: string): string {
  return crypto.createHash('sha256').update(deviceId).digest('hex');
}

function normalizeRequired(value: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new Error('Required trial field is missing.');
  return trimmed;
}
