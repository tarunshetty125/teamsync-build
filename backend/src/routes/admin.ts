import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getLicensesCollection, getDevicesCollection, getEntitlementsCollection, getTrialsCollection } from '../db/mongodb';
import { hashLicenseKey } from '../licensing/services/LicenseService';
import type { LicensePlan, LicenseStatus } from '../licensing/models/License';

const router = Router();

// ── Simple bearer-token auth for admin routes ─────────────────────────
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me-in-production';

// ── Rate limiter: max 5 failed attempts per IP per 15 min ─────────────
const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function requireAdmin(req: Request, res: Response, next: Function) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  // Check rate limit
  const entry = failedAttempts.get(ip);
  if (entry && entry.count >= RATE_LIMIT_MAX && now < entry.resetAt) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${ADMIN_SECRET}`) {
    // Track failed attempt
    if (!entry || now >= entry.resetAt) {
      failedAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    } else {
      entry.count++;
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Clear on success
  failedAttempts.delete(ip);
  next();
}

// ── List all licenses ─────────────────────────────────────────────────
router.get('/licenses', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const licenses = await getLicensesCollection()
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    // Enrich each license with device count
    const enriched = await Promise.all(
      licenses.map(async (lic) => {
        const deviceCount = await getDevicesCollection().countDocuments({
          licenseId: lic.licenseId,
          status: 'active',
        });
        return { ...lic, activeDevices: deviceCount };
      })
    );

    res.json({ success: true, licenses: enriched });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Get single license details ────────────────────────────────────────
router.get('/licenses/:licenseId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const license = await getLicensesCollection().findOne({ licenseId: req.params.licenseId });
    if (!license) return res.status(404).json({ error: 'License not found' });

    const devices = await getDevicesCollection()
      .find({ licenseId: license.licenseId })
      .sort({ lastSeenAt: -1 })
      .toArray();

    const entitlements = await getEntitlementsCollection()
      .find({ licenseId: license.licenseId })
      .sort({ issuedAt: -1 })
      .limit(10)
      .toArray();

    res.json({ success: true, license, devices, entitlements });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Create a new license (auto-generates key) ─────────────────────────
router.post('/licenses', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { plan = 'pro', userId, deviceLimit = 3, notes } = req.body as {
      plan?: LicensePlan;
      userId?: string;
      deviceLimit?: number;
      notes?: string;
    };

    if (!['free', 'pro', 'pro_plus', 'team'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be free, pro, pro_plus, or team.' });
    }

    // Generate a readable license key
    const rawKey = generateLicenseKey();
    const keyHash = hashLicenseKey(rawKey);
    const licenseId = `lic_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();

    await getLicensesCollection().insertOne({
      licenseId,
      licenseKeyHash: keyHash,
      userId: userId || `user_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
      plan: plan as LicensePlan,
      status: 'active' as LicenseStatus,
      subscriptionStatus: 'active',
      deviceLimit,
      entitlementVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    res.json({
      success: true,
      license: {
        licenseId,
        plan,
        rawKey, // ← Only shown once at creation!
        deviceLimit,
        createdAt: now.toISOString(),
      },
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Duplicate license key. Try again.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ── Update a license ──────────────────────────────────────────────────
router.patch('/licenses/:licenseId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { plan, status, deviceLimit } = req.body as {
      plan?: LicensePlan;
      status?: LicenseStatus;
      deviceLimit?: number;
    };

    const update: any = { updatedAt: new Date() };
    if (plan) {
      if (!['free', 'pro', 'pro_plus', 'team'].includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan.' });
      }
      update.plan = plan;
    }
    if (status) {
      if (!['active', 'expired', 'revoked', 'disabled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
      }
      update.status = status;
      if (status === 'revoked') update.revokedAt = new Date();
    }
    if (typeof deviceLimit === 'number') update.deviceLimit = deviceLimit;

    const result = await getLicensesCollection().updateOne(
      { licenseId: req.params.licenseId },
      { $set: update, $inc: { entitlementVersion: 1 } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: 'License not found' });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Delete a license ──────────────────────────────────────────────────
router.delete('/licenses/:licenseId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { licenseId } = req.params;
    const result = await getLicensesCollection().deleteOne({ licenseId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'License not found' });

    // Clean up associated devices and entitlements
    await getDevicesCollection().deleteMany({ licenseId });
    await getEntitlementsCollection().deleteMany({ licenseId });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Revoke a device ───────────────────────────────────────────────────
router.delete('/licenses/:licenseId/devices/:deviceId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await getDevicesCollection().updateOne(
      { licenseId: req.params.licenseId, deviceId: req.params.deviceId },
      { $set: { status: 'removed', removedAt: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Device not found' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Dashboard stats ───────────────────────────────────────────────────
router.get('/stats', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [totalLicenses, activeLicenses, totalDevices, activeDevices, totalTrials] =
      await Promise.all([
        getLicensesCollection().countDocuments({}),
        getLicensesCollection().countDocuments({ status: 'active' }),
        getDevicesCollection().countDocuments({}),
        getDevicesCollection().countDocuments({ status: 'active' }),
        getTrialsCollection().countDocuments({}),
      ]);

    // Plan breakdown
    const planBreakdown = await getLicensesCollection()
      .aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$plan', count: { $sum: 1 } } },
      ])
      .toArray();

    res.json({
      success: true,
      stats: {
        totalLicenses,
        activeLicenses,
        totalDevices,
        activeDevices,
        totalTrials,
        planBreakdown: planBreakdown.reduce((acc, item) => {
          acc[item._id as string] = item.count;
          return acc;
        }, {} as Record<string, number>),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Key generator ─────────────────────────────────────────────────────
function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars (0/O, 1/I/L)
  const segments = 4;
  const segmentLength = 5;
  const parts: string[] = [];

  for (let s = 0; s < segments; s++) {
    let segment = '';
    for (let i = 0; i < segmentLength; i++) {
      segment += chars[crypto.randomInt(chars.length)];
    }
    parts.push(segment);
  }

  return parts.join('-');
}

export default router;
