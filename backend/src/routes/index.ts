/**
 * Semua route API dipasang di sini melalui prefix /api.
 */
import { Router } from 'express';
import { authRouter } from './auth';
import { healthRouter } from './health';
import { usersRouter } from './users';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
