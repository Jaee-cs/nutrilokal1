/**
 * Semua route API dipasang di sini melalui prefix /api.
 */
import { Router } from 'express';
import { authRouter } from './auth';
import { batchesRouter } from './batches';
import { healthRouter } from './health';
import { materialsRouter } from './materials';
import { productsRouter } from './products';
import { productionsRouter } from './productions';
import { publicRouter } from './public';
import { salesRouter } from './sales';
import { stockAdjustmentsRouter } from './stock-adjustments';
import { usersRouter } from './users';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/materials', materialsRouter);
apiRouter.use('/productions', productionsRouter);
apiRouter.use('/batches', batchesRouter);
apiRouter.use('/stock-adjustments', stockAdjustmentsRouter);
apiRouter.use('/sales', salesRouter);
// Endpoint publik tanpa login (katalog & QR traceability, README 5.6).
apiRouter.use('/public', publicRouter);
