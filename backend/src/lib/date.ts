/**
 * Tanggal bisnis (README 5.3): tanggal produksi tidak boleh berada di masa
 * depan; kode batch mengikuti tanggal produksi, bukan tanggal pencatatan.
 *
 * KWT berlokasi di Indonesia, sehingga semua perbandingan tanggal bisnis
 * memakai zona waktu Asia/Jakarta (WIB, UTC+7) dan tidak bergantung pada
 * zona waktu server. Filter laporan (B9) memakai hari bisnis WIB yang sama
 * untuk timestamp pencatatan maupun tanggal bisnis tersimpan.
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

/** Kode tanggal bisnis ('YYYY-MM-DD', kalender WIB) dari suatu instan. */
export function instantBusinessDateCode(date: Date): string {
  return wibDateFormatter.format(date);
}

/** Kode tanggal bisnis berikutnya (kalender WIB). */
export function nextBusinessDateCode(code: string): string {
  const [year, month, day] = code.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Rentang instan [awal hari `fromCode` WIB, awal hari SETELAH `toCode` WIB)
 * untuk filter laporan. Kedua tanggal bisnis tersimpan (tengah malam UTC
 * penanda tanggal) dan timestamp pencatatan jatuh di rentang ini sesuai
 * hari bisnis WIB-nya.
 */
export function businessDayRange(fromCode: string, toCode: string): { gte: Date; lt: Date } {
  return {
    gte: new Date(`${fromCode}T00:00:00+07:00`),
    lt: new Date(`${nextBusinessDateCode(toCode)}T00:00:00+07:00`),
  };
}

/** True bila tanggal bisnis tersebut setelah hari ini (WIB). */
export function isBusinessDateInFuture(date: Date): boolean {
  return businessDateCode(date) > todayBusinessDateCode();
}
