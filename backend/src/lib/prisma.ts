/**
 * Klien Prisma tunggal untuk seluruh aplikasi.
 * Membuat hanya satu instance PrismaClient agar koneksi database
 * tidak terbuka berulang-ulang.
 */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
