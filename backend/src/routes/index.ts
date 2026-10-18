/**
 * Semua route API dipasang di sini melalui prefix /api.
 */
import { Router } from 'express';
import { healthRouter } from './health';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
