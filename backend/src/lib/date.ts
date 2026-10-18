/**
 * Tanggal bisnis (README 5.3): tanggal produksi tidak boleh berada di masa
 * depan; kode batch mengikuti tanggal produksi, bukan tanggal pencatatan.
 *
 * KWT berlokasi di Indonesia, sehingga semua perbandingan tanggal bisnis
 * memakai zona waktu Asia/Jakarta (WIB, UTC+7) dan tidak bergantung pada
 * zona waktu server.
 */

const WIB = 'Asia/Jakarta';

const wibDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: WIB,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Kode tanggal 'YYYY-MM-DD' hari ini menurut kalender WIB. */
export function todayBusinessDateCode(): string {
  return wibDateFormatter.format(new Date());
}

/**
 * Mengubah nilai tanggal dari klien menjadi tanggal bisnis (tengah malam UTC)
 * sesuai kalender WIB dari instan tersebut. Input 'YYYY-MM-DD' menghasilkan
 * tanggal itu juga.
 */
export function parseBusinessDate(value: string): Date {
  return new Date(`${wibDateFormatter.format(new Date(value))}T00:00:00.000Z`);
}

/** Kode tanggal 'YYYY-MM-DD' dari tanggal bisnis tersimpan. */
export function businessDateCode(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** True bila tanggal bisnis tersebut setelah hari ini (WIB). */
export function isBusinessDateInFuture(date: Date): boolean {
  return businessDateCode(date) > todayBusinessDateCode();
}
