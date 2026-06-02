import { Router } from 'express';
import { LicenseService } from '../services/LicenseService';
import { TrialService } from '../services/TrialService';
import { readString, requireString, routeError } from '../middleware/entitlementAuth';

const router = Router();
const licenseService = new LicenseService();
const trialService = new TrialService();

router.get('/', async (req, res) => {
  try {
    const source = { ...req.query, ...(req.body || {}) };
    const deviceId = requireString(source.deviceId, 'deviceId');
    const licenseId = requireString(source.licenseId, 'licenseId');
    const trial = readString(source.trial) === 'true';

    const result = trial
      ? await trialService.status({ deviceId, licenseId })
      : await licenseService.sync({
          deviceId,
          licenseId,
          entitlementVersion: Number(readString(source.entitlementVersion) || 0),
        });

    res.status(result.success ? 200 : 403).json(result);
  } catch (error) {
    routeError(res, error);
  }
});

export default router;
