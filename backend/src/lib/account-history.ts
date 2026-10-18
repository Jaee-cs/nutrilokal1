/**
 * Memeriksa apakah akun memiliki riwayat aktivitas operasional.
 *
 * Sesuai README, akun dengan riwayat aktivitas tidak boleh dihapus
 * permanen — riwayat harus tetap tersedia.
 *
 * Pada tahap B2 belum ada tabel bisnis yang mereferensikan pengguna.
 * Tugas berikutnya (B3+) WAJIB memperluas fungsi ini saat menambahkan
 * tabel penerimaan bahan, saldo awal, produksi, penyesuaian stok,
 * penjualan, pembatalan, koreksi, dan publikasi QR.
 */
export async function userHasActivityHistory(userId: string): Promise<boolean> {
  void userId; // Belum ada tabel bisnis pada tahap B2.
  return false;
}
