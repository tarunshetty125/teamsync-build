import { Router } from 'express';
import { LicenseService } from '../services/LicenseService';
import { requireString, routeError } from '../middleware/entitlementAuth';

const router = Router();
const service = new LicenseService();

router.post('/', async (req, res) => {
  try {
    const result = await service.deactivate({
      deviceId: requireString(req.body?.deviceId, 'deviceId'),
      licenseId: requireString(req.body?.licenseId, 'licenseId'),
    });
    res.json(result);
  } catch (error) {
    routeError(res, error);
  }
});

export default router;
