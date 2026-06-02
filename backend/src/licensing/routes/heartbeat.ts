import { Router } from 'express';
import { LicenseService } from '../services/LicenseService';
import { TrialService } from '../services/TrialService';
import { readString, requireString, routeError } from '../middleware/entitlementAuth';

const router = Router();
const licenseService = new LicenseService();
const trialService = new TrialService();

router.post('/', async (req, res) => {
  try {
    const trial = req.body?.trial === true;
    const deviceId = requireString(req.body?.deviceId, 'deviceId');
    const licenseId = requireString(req.body?.licenseId, 'licenseId');
    const result = trial
      ? await trialService.status({ deviceId, licenseId })
      : await licenseService.sync({
          deviceId,
          licenseId,
          entitlementVersion: Number(readString(req.body?.entitlementVersion) || 0),
        });
    res.status(result.success ? 200 : 403).json(result);
  } catch (error) {
    routeError(res, error);
  }
});

export default router;
