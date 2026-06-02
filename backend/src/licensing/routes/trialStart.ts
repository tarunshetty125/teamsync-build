import { Router } from 'express';
import { TrialService } from '../services/TrialService';
import { readString, requireString, routeError } from '../middleware/entitlementAuth';

const router = Router();
const service = new TrialService();

router.post('/', async (req, res) => {
  try {
    const result = await service.start({
      deviceId: requireString(req.body?.deviceId, 'deviceId'),
      deviceName: readString(req.body?.deviceName),
    });
    res.status(result.success ? 200 : 403).json(result);
  } catch (error) {
    routeError(res, error);
  }
});

export default router;
