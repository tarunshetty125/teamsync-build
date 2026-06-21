import { randomUUID } from 'crypto';
import { getBackendConfig } from '../../config/env';
import { getEntitlementsCollection } from '../../db/mongodb';
import type { LicenseDocument, LicensePlan } from '../models/License';
import type { TrialDocument } from '../models/Trial';
import type { EntitlementPayload } from '../models/Entitlement';
import { SignatureService } from './SignatureService';

const PLAN_FEATURES: Record<LicensePlan, string[]> = {
  free: [],
  pro: [
    'profile_intelligence',
    'job_description_intelligence',
    'custom_modes',
    'premium_intelligence',
    'screen_scan',
    'negotiation_coach',
    'pro_overlay',
    'code_cli',
    'post_call_workflow',
    'unlimited_history',
  ],
  pro_plus: [
    'profile_intelligence',
    'job_description_intelligence',
    'custom_modes',
    'premium_intelligence',
    'screen_scan',
    'system_design',
    'negotiation_coach',
    'pro_overlay',
    'code_cli',
    'post_call_workflow',
    'unlimited_history',
    'company_research',
    'advanced_stealth',
    'screen_capture_protection',
    'phone_mirror',
    'api_access',
    'priority_routing',
    'cross_session_search',
  ],
  team: [
    'profile_intelligence',
    'job_description_intelligence',
    'company_research',
    'custom_modes',
    'premium_intelligence',
    'screen_scan',
    'system_design',
    'negotiation_coach',
    'pro_overlay',
    'code_cli',
    'post_call_workflow',
    'unlimited_history',
    'advanced_stealth',
    'screen_capture_protection',
    'phone_mirror',
    'api_access',
    'priority_routing',
    'cross_session_search',
    'team_management',
  ],
};

export class EntitlementService {
  constructor(
    private readonly signatureService = new SignatureService(),
    private readonly config = getBackendConfig()
  ) {}

  async issueForLicense(params: {
    license: LicenseDocument;
    deviceId: string;
    expiresAt?: Date;
  }): Promise<EntitlementPayload> {
    const entitlement = this.buildPayload({
      plan: params.license.plan,
      userId: params.license.userId,
      deviceId: params.deviceId,
      licenseId: params.license.licenseId,
      trial: false,
      entitlementVersion: params.license.entitlementVersion,
      expiresAt: params.expiresAt ?? this.defaultExpiresAt(),
    });

    await this.persist(entitlement);
    return entitlement;
  }

  async issueForTrial(params: {
    trial: TrialDocument;
  }): Promise<EntitlementPayload> {
    const entitlement = this.buildPayload({
      plan: 'pro',
      userId: params.trial.userId,
      deviceId: params.trial.deviceId,
      licenseId: params.trial.trialId,
      trial: true,
      entitlementVersion: params.trial.entitlementVersion,
      expiresAt: params.trial.expiresAt,
    });

    await this.persist(entitlement);
    return entitlement;
  }

  private buildPayload(params: {
    plan: LicensePlan;
    userId: string;
    deviceId: string;
    licenseId: string;
    trial: boolean;
    entitlementVersion: number;
    expiresAt: Date;
  }): EntitlementPayload {
    const now = new Date();
    const expiresAt = params.expiresAt;
    const graceUntil = new Date(now.getTime() + this.config.licenseOfflineGraceMs);

    return this.signatureService.attachSignature({
      plan: params.plan,
      userId: params.userId || randomUUID(),
      deviceId: params.deviceId,
      licenseId: params.licenseId,
      trial: params.trial,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      graceUntil: graceUntil.toISOString(),
      entitlementVersion: params.entitlementVersion,
      features: PLAN_FEATURES[params.plan] ?? [],
      issuer: this.config.licenseIssuer,
    });
  }

  private defaultExpiresAt(): Date {
    return new Date(Date.now() + this.config.licenseEntitlementTtlMs);
  }

  private async persist(entitlement: EntitlementPayload): Promise<void> {
    await getEntitlementsCollection().insertOne({
      licenseId: entitlement.licenseId,
      version: entitlement.entitlementVersion,
      issuedAt: new Date(entitlement.issuedAt),
      expiresAt: new Date(entitlement.expiresAt),
      graceUntil: new Date(entitlement.graceUntil),
      deviceId: entitlement.deviceId,
      trial: entitlement.trial,
      createdAt: new Date(),
    });
  }
}
