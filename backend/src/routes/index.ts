/**
 * Semua route API dipasang di sini melalui prefix /api.
 */
import { Router } from 'express';
import { authRouter } from './auth';
import { healthRouter } from './health';
import { materialsRouter } from './materials';
import { productsRouter } from './products';
import { productionsRouter } from './productions';
import { usersRouter } from './users';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/materials', materialsRouter);
apiRouter.use('/productions', productionsRouter);
