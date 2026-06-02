import { Router } from 'express';
import os from 'os';
import { LicenseService } from '../services/LicenseService';
import { readString, requireString, routeError } from '../middleware/entitlementAuth';

const router = Router();
const service = new LicenseService();

router.post('/', async (req, res) => {
  try {
    const result = await service.activate({
      licenseKey: requireString(req.body?.licenseKey, 'licenseKey'),
      deviceId: requireString(req.body?.deviceId, 'deviceId'),
      deviceName: readString(req.body?.deviceName),
      platform: readString(req.body?.platform) || os.platform(),
      appVersion: readString(req.body?.appVersion),
    });

    if (!result.success) {
      res.status(result.code === 'invalid_license' ? 401 : 403).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    routeError(res, error);
  }
});

export default router;
