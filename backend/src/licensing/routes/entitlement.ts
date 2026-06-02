import { Router } from 'express';
import syncRoutes from './sync';

const router = Router();

router.use('/', syncRoutes);

export default router;
