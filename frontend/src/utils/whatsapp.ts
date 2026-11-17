/**
 * Tautan pemesanan WhatsApp untuk produk publik.
 *
 * Referensi `info produk/code.html` memakai `wa.me` tanpa nomor, sehingga
 * pengunjung memilih sendiri akun WhatsApp tujuan. Nomor tujuan tidak
 * disimpan di frontend agar tidak menjadi data hardcode.
 */
export function whatsappOrderUrl(productName: string): string {
  const text = `Halo KWT Gogor, saya ingin memesan ${productName}`
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
