import { Router } from 'express';
import { TrialService } from '../services/TrialService';
import { readString, requireString, routeError } from '../middleware/entitlementAuth';

const router = Router();
const service = new TrialService();

router.get('/', async (req, res) => {
  try {
    const source = { ...req.query, ...(req.body || {}) };
    const result = await service.status({
      deviceId: requireString(source.deviceId, 'deviceId'),
      licenseId: readString(source.licenseId),
    });
    res.status(result.success ? 200 : 403).json(result);
  } catch (error) {
    routeError(res, error);
  }
});

export default router;
