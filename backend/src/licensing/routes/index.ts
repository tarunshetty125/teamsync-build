import { Router } from 'express';
import activateRoutes from './activate';
import deactivateRoutes from './deactivate';
import entitlementRoutes from './entitlement';
import heartbeatRoutes from './heartbeat';
import syncRoutes from './sync';
import trialStartRoutes from './trialStart';
import trialStatusRoutes from './trialStatus';

const router = Router();

router.use('/activate', activateRoutes);
router.use('/sync', syncRoutes);
router.use('/deactivate', deactivateRoutes);
router.use('/entitlement', entitlementRoutes);
router.use('/trial/start', trialStartRoutes);
router.use('/trial/status', trialStatusRoutes);
router.use('/heartbeat', heartbeatRoutes);

export default router;
