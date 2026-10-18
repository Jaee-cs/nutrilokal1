/**
 * Helper HTTP kecil untuk route.
 */
import type { Request } from 'express';

/**
 * Mengambil parameter rute tunggal (mis. :id) sebagai string.
 * Pada overload TypeScript Express, params dapat berupa string | string[];
 * rute kita hanya memakai satu nilai per parameter.
 */
export function pathId(req: Request): string {
  const { id } = req.params as { id: string };
  return id;
}
