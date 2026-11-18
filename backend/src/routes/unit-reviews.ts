/**
 * Penanda data satuan lama yang tidak bisa dipetakan secara pasti (hanya Admin).
 *
 * Baris dibuat oleh migrasi standardisasi satuan. Endpoint ini tidak mengubah
 * stok, transaksi, maupun catatan produksi historis — hanya menandai bahwa
 * data sudah diperiksa dan menyimpan catatan Admin.
 */
import { Router } from 'express';
import { pathId } from '../lib/http';
import { prisma } from '../lib/prisma';
import { authenticate, requireAdmin } from '../middleware/auth';

export const unitReviewsRouter = Router();

unitReviewsRouter.use(authenticate, requireAdmin);

unitReviewsRouter.get('/', async (_req, res) => {
  const data = await prisma.unitReview.findMany({
    orderBy: [{ reviewedAt: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ data });
});

unitReviewsRouter.patch('/:id/review', async (req, res) => {
  const review = await prisma.unitReview.findUnique({ where: { id: pathId(req) } });
  if (!review) {
    res.status(404).json({ message: 'Penanda data satuan tidak ditemukan.' });
    return;
  }

  const { note } = req.body ?? {};
  if (note !== undefined && note !== null) {
    if (typeof note !== 'string' || note.trim().length > 500) {
      res.status(400).json({ message: 'Catatan pemeriksaan maksimal 500 karakter.' });
      return;
    }
  }

  const updated = await prisma.unitReview.update({
    where: { id: review.id },
    data: {
      reviewedAt: new Date(),
      reviewedById: req.user!.id,
      note: typeof note === 'string' && note.trim() !== '' ? note.trim() : null,
    },
  });

  res.json({ review: updated });
});
