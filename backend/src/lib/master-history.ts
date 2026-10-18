/**
 * Penjaga aturan README 5.1: produk atau bahan baku yang sudah memiliki
 * riwayat operasional tidak boleh dihapus langsung — Admin hanya dapat
 * menonaktifkannya. Penonaktifan tidak menghapus atau merusak riwayat.
 *
 * Pada tahap B3 belum ada tabel bisnis yang mereferensikan master.
 * Tugas berikutnya (B4+) WAJIB mendaftarkan pemeriksaan relasi mereka
 * melalui registerOperationalHistoryChecker, misalnya:
 *
 *   registerOperationalHistoryChecker(async (kind, id) => {
 *     if (kind !== 'material') return false;
 *     return (await prisma.materialReceipt.count({ where: { materialId: id } })) > 0;
 *   });
 */

export type MasterKind = 'product' | 'material';

export type OperationalHistoryChecker = (kind: MasterKind, id: string) => Promise<boolean>;

const checkers: OperationalHistoryChecker[] = [];

/**
 * Mendaftarkan pemeriksa riwayat operasional.
 * Mengembalikan fungsi untuk melepas pendaftaran (dipakai pengujian).
 */
export function registerOperationalHistoryChecker(checker: OperationalHistoryChecker): () => void {
  checkers.push(checker);
  return () => {
    const index = checkers.indexOf(checker);
    if (index >= 0) {
      checkers.splice(index, 1);
    }
  };
}

export async function hasOperationalHistory(kind: MasterKind, id: string): Promise<boolean> {
  for (const checker of checkers) {
    if (await checker(kind, id)) {
      return true;
    }
  }
  return false;
}
