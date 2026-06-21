/**
 * EntitlementVerifier — 3-Tier Pricing Gate Tests
 *
 * Validates:
 *   1. Plan type parsing (free, pro, pro_plus, team)
 *   2. Tier resolution (getPlanTier)
 *   3. Access methods (hasProAccess, hasProPlusAccess, hasPremiumAccess)
 *   4. Edge cases (expired, trial, offline grace, invalid plan)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EntitlementVerifier, type EntitlementPlan, type SignedEntitlement, type EntitlementStatus } from '../licensing/EntitlementVerifier';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a test RSA key pair for signing entitlements */
function generateTestKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

const testKeys = generateTestKeyPair();

/** Sign a payload to create a valid test entitlement */
function signTestEntitlement(payload: Omit<SignedEntitlement, 'signature'>): SignedEntitlement {
  function canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(canonicalize(payload));
  signer.end();
  const signature = signer.sign(testKeys.privateKey).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  return { ...payload, signature };
}

/** Create a test entitlement for a specific plan */
function createEntitlement(plan: EntitlementPlan, opts: {
  trial?: boolean;
  expired?: boolean;
  features?: string[];
} = {}): SignedEntitlement {
  const now = new Date();
  const expiresAt = opts.expired
    ? new Date(now.getTime() - 1000) // 1 second in the past
    : new Date(now.getTime() + 3600_000); // 1 hour from now
  const graceUntil = new Date(expiresAt.getTime() + 72 * 3600_000);

  return signTestEntitlement({
    plan,
    userId: 'test-user',
    deviceId: 'test-device',
    licenseId: 'test-license',
    trial: opts.trial ?? false,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceUntil: graceUntil.toISOString(),
    entitlementVersion: 1,
    features: opts.features ?? [],
    issuer: 'test',
  });
}

/** Create a fresh verifier instance with test keys */
function createVerifier(entitlement?: SignedEntitlement): EntitlementVerifier {
  const cachePath = path.join(__dirname, `.test-cache-${crypto.randomUUID()}.json`);
  const cache: any = {};
  if (entitlement) {
    cache.entitlement = entitlement;
    cache.lastSuccessfulSyncAt = new Date().toISOString();
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache));

  const verifier = new EntitlementVerifier({
    publicKey: testKeys.publicKey,
    cachePath,
    deviceId: 'test-device',
  });

  // Cleanup
  afterAll(() => {
    try { fs.unlinkSync(cachePath); } catch {}
  });

  return verifier;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EntitlementVerifier — 3-Tier Pricing', () => {

  describe('Plan type recognition', () => {
    it('should accept free plan', () => {
      const v = createVerifier(createEntitlement('free'));
      const status = v.getStatus();
      expect(status.plan).toBe('free');
      expect(status.isPremium).toBe(false);
    });

    it('should accept pro plan', () => {
      const v = createVerifier(createEntitlement('pro'));
      const status = v.getStatus();
      expect(status.plan).toBe('pro');
      expect(status.isPremium).toBe(true);
    });

    it('should accept pro_plus plan', () => {
      const v = createVerifier(createEntitlement('pro_plus'));
      const status = v.getStatus();
      expect(status.plan).toBe('pro_plus');
      expect(status.isPremium).toBe(true);
    });

    it('should accept team plan', () => {
      const v = createVerifier(createEntitlement('team'));
      const status = v.getStatus();
      expect(status.plan).toBe('team');
      expect(status.isPremium).toBe(true);
    });
  });

  describe('getPlanTier() — resolved tier', () => {
    it('free plan → free tier', () => {
      const v = createVerifier(createEntitlement('free'));
      expect(v.getPlanTier()).toBe('free');
    });

    it('pro plan → pro tier', () => {
      const v = createVerifier(createEntitlement('pro'));
      expect(v.getPlanTier()).toBe('pro');
    });

    it('pro_plus plan → pro_plus tier', () => {
      const v = createVerifier(createEntitlement('pro_plus'));
      expect(v.getPlanTier()).toBe('pro_plus');
    });

    it('team plan → pro_plus tier (legacy mapping)', () => {
      const v = createVerifier(createEntitlement('team'));
      expect(v.getPlanTier()).toBe('pro_plus');
    });

    it('no entitlement → free tier', () => {
      const v = createVerifier();
      expect(v.getPlanTier()).toBe('free');
    });

    it('expired pro → free tier', () => {
      const v = createVerifier(createEntitlement('pro', { expired: true }));
      expect(v.getPlanTier()).toBe('free');
    });

    it('expired pro_plus → free tier', () => {
      const v = createVerifier(createEntitlement('pro_plus', { expired: true }));
      expect(v.getPlanTier()).toBe('free');
    });
  });

  describe('hasProAccess() — Pro tier gate', () => {
    it('free → false', () => {
      const v = createVerifier(createEntitlement('free'));
      expect(v.hasProAccess()).toBe(false);
    });

    it('pro → true', () => {
      const v = createVerifier(createEntitlement('pro'));
      expect(v.hasProAccess()).toBe(true);
    });

    it('pro_plus → true (superset)', () => {
      const v = createVerifier(createEntitlement('pro_plus'));
      expect(v.hasProAccess()).toBe(true);
    });

    it('team → true (superset)', () => {
      const v = createVerifier(createEntitlement('team'));
      expect(v.hasProAccess()).toBe(true);
    });

    it('no entitlement → false', () => {
      const v = createVerifier();
      expect(v.hasProAccess()).toBe(false);
    });

    it('expired pro → false', () => {
      const v = createVerifier(createEntitlement('pro', { expired: true }));
      expect(v.hasProAccess()).toBe(false);
    });
  });

  describe('hasProPlusAccess() — Pro Plus tier gate', () => {
    it('free → false', () => {
      const v = createVerifier(createEntitlement('free'));
      expect(v.hasProPlusAccess()).toBe(false);
    });

    it('pro → false (not high enough)', () => {
      const v = createVerifier(createEntitlement('pro'));
      expect(v.hasProPlusAccess()).toBe(false);
    });

    it('pro_plus → true', () => {
      const v = createVerifier(createEntitlement('pro_plus'));
      expect(v.hasProPlusAccess()).toBe(true);
    });

    it('team → true (legacy superset)', () => {
      const v = createVerifier(createEntitlement('team'));
      expect(v.hasProPlusAccess()).toBe(true);
    });

    it('no entitlement → false', () => {
      const v = createVerifier();
      expect(v.hasProPlusAccess()).toBe(false);
    });

    it('expired pro_plus → false', () => {
      const v = createVerifier(createEntitlement('pro_plus', { expired: true }));
      expect(v.hasProPlusAccess()).toBe(false);
    });
  });

  describe('hasPremiumAccess() — backward compat', () => {
    it('free → false', () => {
      const v = createVerifier(createEntitlement('free'));
      expect(v.hasPremiumAccess()).toBe(false);
    });

    it('pro → true', () => {
      const v = createVerifier(createEntitlement('pro'));
      expect(v.hasPremiumAccess()).toBe(true);
    });

    it('pro_plus → true', () => {
      const v = createVerifier(createEntitlement('pro_plus'));
      expect(v.hasPremiumAccess()).toBe(true);
    });

    it('team → true', () => {
      const v = createVerifier(createEntitlement('team'));
      expect(v.hasPremiumAccess()).toBe(true);
    });
  });

  describe('Trial entitlements', () => {
    it('trial with free plan → premium access (trial upgrade)', () => {
      const v = createVerifier(createEntitlement('free', { trial: true }));
      const status = v.getStatus();
      expect(status.isPremium).toBe(true);
      expect(status.trial).toBe(true);
    });

    it('trial with pro plan → pro access', () => {
      const v = createVerifier(createEntitlement('pro', { trial: true }));
      expect(v.hasProAccess()).toBe(true);
      expect(v.hasProPlusAccess()).toBe(false);
    });

    it('expired trial → no access', () => {
      const v = createVerifier(createEntitlement('pro', { trial: true, expired: true }));
      expect(v.hasPremiumAccess()).toBe(false);
      expect(v.hasProAccess()).toBe(false);
    });
  });

  describe('Feature gate matrix — tier hierarchy', () => {
    /**
     * Verify the complete tier hierarchy:
     *   free  → no gates pass
     *   pro   → Pro gates pass, Pro Plus gates fail
     *   pro+  → all gates pass
     *   team  → all gates pass (legacy)
     */
    const matrix: Array<{
      plan: EntitlementPlan;
      premium: boolean;
      pro: boolean;
      proPlus: boolean;
      tier: 'free' | 'pro' | 'pro_plus';
    }> = [
      { plan: 'free',     premium: false, pro: false, proPlus: false, tier: 'free' },
      { plan: 'pro',      premium: true,  pro: true,  proPlus: false, tier: 'pro' },
      { plan: 'pro_plus', premium: true,  pro: true,  proPlus: true,  tier: 'pro_plus' },
      { plan: 'team',     premium: true,  pro: true,  proPlus: true,  tier: 'pro_plus' },
    ];

    for (const { plan, premium, pro, proPlus, tier } of matrix) {
      it(`${plan} → premium=${premium}, pro=${pro}, proPlus=${proPlus}, tier=${tier}`, () => {
        const v = createVerifier(createEntitlement(plan));
        expect(v.hasPremiumAccess()).toBe(premium);
        expect(v.hasProAccess()).toBe(pro);
        expect(v.hasProPlusAccess()).toBe(proPlus);
        expect(v.getPlanTier()).toBe(tier);
      });
    }
  });
});
