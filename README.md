# NutriLokal Smart Production & Traceability Kit V1.0

## 1. Tujuan
NutriLokal adalah aplikasi web untuk membantu KWT Gogor mencatat bahan baku, produksi, stok, penjualan, serta menyediakan informasi produk yang dapat ditelusuri melalui QR Code.

README ini adalah acuan utama fitur dan aturan bisnis. Jangan menambah fitur atau mengubah aturan di dalamnya tanpa persetujuan.

## 2. Ruang lingkup V1.0
1. Dashboard usaha.
2. Master produk.
3. Master bahan baku, penerimaan, dan saldo awal.
4. Pencatatan produksi dan kode batch otomatis.
5. Stok bahan baku dan stok produk jadi per batch.
6. Penjualan dan riwayat transaksi.
7. Katalog digital.
8. QR traceability per batch.
9. Login dan pengelolaan akun internal.

Di luar cakupan secara default: fitur AI, kalkulasi gizi otomatis, klaim kesehatan, toko online/checkout, pembayaran online, notifikasi, dan konversi satuan otomatis.

## 3. Teknologi dan struktur proyek
- **Frontend:** React + Vite.
- **Backend:** Node.js + Express, menggunakan REST API.
- **Database:** PostgreSQL.
- **ORM dan migrasi:** Prisma.
- **Version control:** Git + GitHub.

```text
nutrilokal/
├── README.md
├── frontend/
├── backend/
└── design/
    └── design.zip
```

`design/design.zip` hanya referensi tampilan untuk pengerjaan frontend. Fitur dan aturan bisnis tetap ditentukan oleh README ini. Jika desain berbeda dari README, ikuti README.

## 4. Pengguna dan akses

### Admin
Admin memiliki semua kewenangan Operator, serta dapat:
- Mengelola akun, master produk, master bahan baku, dan informasi katalog publik.
- Melakukan penyesuaian stok.
- Membatalkan transaksi penjualan dengan alasan.
- Memvalidasi, menerbitkan, memperbarui, dan menarik informasi publik QR.
- Mengoreksi catatan produksi.
- Melakukan reset kata sandi pengguna.

### Operator
Operator dapat:
- Mencatat penerimaan bahan baku.
- Mencatat produksi dan pemakaian aktual bahan baku.
- Mencatat penjualan dan memilih batch yang dijual.
- Melihat informasi operasional.

### Aturan akun dan keamanan
- Tidak ada pendaftaran publik. Akun Admin pertama harus disiapkan melalui konfigurasi awal yang aman; jangan membuat kredensial default yang ditanam di kode.
- Admin dapat membuat, menonaktifkan, dan mengaktifkan kembali akun Operator.
- Akun dengan riwayat aktivitas tidak boleh dihapus permanen. Riwayat tetap tersedia.
- Admin dapat memulai reset kata sandi, tetapi tidak dapat melihat kata sandi lama. Pengguna wajib menetapkan kata sandi baru sebelum menggunakan sistem kembali.
- Kata sandi harus disimpan sebagai hash yang aman, bukan teks biasa.
- Hak akses harus diperiksa di backend, bukan hanya dengan menyembunyikan elemen di frontend.

## 5. Aturan bisnis

### 5.1 Master produk dan bahan baku
- Setiap produk memiliki satu satuan dasar. Produksi, stok, dan penjualan memakai satuan yang sama.
- Setiap bahan baku memiliki satu satuan dasar. Penerimaan dan pemakaian memakai satuan yang sama.
- Tidak ada konversi satuan otomatis.
- Produk atau bahan baku yang belum memiliki riwayat operasional dan belum terhubung dengan data lain boleh dihapus.
- Jika produk atau bahan baku sudah memiliki catatan penerimaan, saldo awal, produksi, batch, penjualan, pergerakan stok, atau riwayat publikasi QR yang terkait, master tidak boleh dihapus langsung. Admin hanya dapat menonaktifkannya.
- Penonaktifan master tidak boleh menghapus atau merusak riwayat operasional yang sudah tersimpan.
- Produk nonaktif tidak tersedia untuk produksi atau penjualan baru dan tidak muncul di katalog aktif. QR batch lama tetap dapat menampilkan informasi publik yang sudah diterbitkan, kecuali informasi tersebut ditarik oleh Admin.

### 5.2 Bahan baku
- Stok dihitung sebagai total per jenis bahan baku, bukan per penerimaan.
- Sistem menyimpan riwayat setiap penerimaan dan pemakaian bahan pada produksi, tetapi pemakaian tidak dialokasikan ke penerimaan tertentu.
- Penerimaan yang berhasil menambah stok bahan baku.
- Pemakaian bahan dicatat manual berdasarkan jumlah aktual; sistem tidak menghitung pemakaian otomatis dari resep.
- Produksi ditolak jika stok salah satu bahan tidak mencukupi.
- Admin dapat memasukkan saldo awal bahan baku secara terpisah dari penerimaan biasa. Catatan wajib memuat tanggal, alasan, dan pengguna pencatat serta tidak boleh membuat stok dihitung dua kali.

### 5.3 Produksi dan batch
- Satu catatan produksi berarti produksi telah selesai. Setelah catatan berhasil disimpan, stok bahan baku berkurang sesuai pemakaian dan stok produk jadi batch bertambah sesuai hasil produksi.
- Operator mengisi produk, tanggal produksi sebenarnya, jumlah hasil, dan jumlah aktual setiap bahan yang digunakan.
- Tanggal produksi tidak boleh berada di masa depan. Pencatatan mundur diperbolehkan jika sesuai dengan tanggal produksi sebenarnya.
- Kode batch normal menggunakan format `NL-YYYYMMDD-NNN`, misalnya `NL-20261016-001`. Tanggal pada kode mengikuti tanggal produksi, bukan tanggal pencatatan. Nomor urut dimulai dari `001` untuk tanggal produksi tersebut.
- Backend/database wajib menjamin kode unik, termasuk saat penyimpanan bersamaan atau pencatatan produksi dilakukan belakangan. Tanggal/waktu pencatatan disimpan terpisah.
- Penyimpanan produksi harus atomik: pengurangan stok bahan dan penambahan stok produk jadi berhasil bersama-sama atau tidak diterapkan sama sekali.
- Admin dapat memasukkan stok awal produk jadi per batch. Hanya informasi yang benar-benar diketahui boleh dicatat; informasi yang tidak diketahui tidak boleh dikarang.
- Jika tanggal produksi stok awal tidak diketahui, gunakan kode `NL-OPEN-YYYYMMDD-NNN`. Tanggal pada kode tersebut adalah tanggal pencatatan stok awal, bukan tanggal produksi. Tanggal produksi tetap kosong; batch ditandai memiliki riwayat terbatas dan informasi yang belum divalidasi tidak ditampilkan ke publik.
- Admin boleh mengedit catatan produksi, termasuk tanggal produksi dan jumlah hasil. Backend harus menghitung dampak perubahan pada stok dan data terkait, mempertahankan riwayat penjualan/alokasi batch, dan menolak perubahan yang membuat stok negatif atau menyebabkan hubungan data tidak konsisten.
- Riwayat pergerakan stok tidak boleh diedit atau dihapus langsung. Koreksi catatan produksi harus tetap meninggalkan jejak perubahan/audit.
- Jika tanggal produksi dikoreksi, backend membuat kode batch baru yang unik dan menyimpan kode lama sebagai alias agar QR atau label lama tetap mengarah ke batch yang sama. Riwayat perubahan harus tersimpan.

### 5.4 Stok dan penyesuaian
- Stok produk jadi dicatat per batch. Total stok per produk harus sama dengan jumlah stok seluruh batch produk tersebut.
- Produksi menambah stok batch; penjualan menguranginya sesuai alokasi batch.
- Semua pergerakan stok dicatat otomatis, termasuk penerimaan/pemakaian bahan baku, hasil produksi, penjualan, pembatalan transaksi, dan penyesuaian stok. Setiap pergerakan dikaitkan dengan catatan sumbernya.
- Seluruh operasi stok harus mencegah stok negatif dan perubahan ganda akibat permintaan yang diulang.
- Penyesuaian stok hanya dapat dilakukan Admin melalui fungsi khusus. Admin memasukkan perubahan jumlah: nilai positif untuk menambah stok, nilai negatif untuk mengurangi stok. Catat alasan, waktu, pengguna, dan batch terkait jika berlaku.
- Penyesuaian yang menyebabkan stok bahan baku atau stok suatu batch negatif harus ditolak.
- Retur ditangani melalui penyesuaian stok oleh Admin. Admin mencatat alasan dan batch asal serta memeriksa barang. Barang hanya boleh ditambahkan kembali ke stok jual jika dipastikan masih layak dijual.

### 5.5 Penjualan dan pembatalan
- Satu transaksi boleh berisi beberapa jenis produk.
- Harga jual ditetapkan pada master produk dan digunakan otomatis. Harga satuan yang digunakan disimpan pada transaksi agar perubahan harga produk tidak mengubah transaksi lama.
- Operator memilih batch yang benar-benar diambil untuk setiap item penjualan. Satu item dapat dialokasikan ke beberapa batch.
- Backend memvalidasi stok tiap batch. Jika satu item atau alokasi batch tidak mencukupi, seluruh transaksi ditolak; tidak ada transaksi parsial dan tidak ada stok yang berubah.
- Total transaksi dihitung backend. Hanya transaksi berhasil yang memengaruhi stok dan omzet.
- Transaksi tersimpan tidak boleh diedit atau dihapus langsung. Admin dapat membatalkan transaksi dengan alasan.
- Saat transaksi dibatalkan, stok dikembalikan ke batch asal berdasarkan alokasi transaksi. Riwayat alokasi tetap ada dan pembatalan tidak boleh mengembalikan stok dua kali. Transaksi batal tidak masuk omzet.
- Penjualan yang benar setelah pembatalan harus dicatat sebagai transaksi baru.
- Jika tanggal kedaluwarsa suatu batch tersedia dan telah divalidasi, sistem menolak penjualan dari batch tersebut ketika tanggal kedaluwarsanya sudah lewat. Stoknya tetap tercatat sampai Admin melakukan penyesuaian dengan alasan yang sesuai.

### 5.6 Katalog, kedaluwarsa, dan QR
- Tanggal kedaluwarsa dicatat per batch dan boleh kosong jika belum tersedia atau belum divalidasi.
- Setiap batch memiliki QR unik. Kemasan dari batch yang sama boleh menggunakan QR yang sama.
- QR membuka halaman publik tanpa login internal.
- Informasi yang boleh ditampilkan setelah divalidasi: nama produk, deskripsi, kode batch, tanggal produksi, komposisi bahan, petunjuk penyimpanan, dan tanggal kedaluwarsa jika tersedia serta tervalidasi.
- Admin memeriksa dan menerbitkan informasi publik. Kolom yang belum tersedia atau belum divalidasi disembunyikan.
- Data contoh selama pengembangan harus jelas ditandai sebagai ilustrasi dan tidak boleh dipublikasikan sebagai klaim nyata.
- Jangan mengarang komposisi, tanggal kedaluwarsa, informasi gizi, sertifikasi, keamanan pangan, atau klaim kesehatan.
- Admin dapat memperbarui atau menarik informasi publik. Jika ditarik, QR menampilkan pemberitahuan bahwa informasi publik tidak tersedia dan tidak boleh menampilkan data yang ditarik atau data internal.

## 6. Persyaratan integritas dan pengujian
- Validasi aturan bisnis dan penghitungan stok dilakukan di backend.
- Produksi, penjualan, pembatalan, dan penyesuaian stok harus memakai transaksi database ketika mengubah beberapa catatan terkait.
- Kode batch dan identitas penting harus memiliki constraint unik di database.
- Tidak boleh ada stok negatif, perubahan stok ganda, pembaruan data parsial, atau hilangnya riwayat historis.
- Endpoint publik hanya boleh mengirim informasi yang telah disetujui untuk publik.
- Dashboard dan laporan harus menggunakan data database aktual, bukan angka demo yang ditanam permanen.
- Uji alur berhasil dan gagal, stok tidak cukup, batch tidak valid, pembatalan berulang, serta permintaan bersamaan untuk pembuatan kode batch.

## 7. Aturan kerja AI Agent
1. Ikuti README ini sebagai acuan fitur dan aturan bisnis. Jangan menambah fitur, field bisnis, peran, atau aturan yang tidak tercantum.
2. Kerjakan satu tugas terukur pada satu waktu. Jangan melanjutkan ke tugas lain tanpa instruksi.
3. Jika detail penting belum ditetapkan, pilih perilaku yang aman dan sederhana, nyatakan sebagai asumsi, dan jangan mengubah ruang lingkup secara diam-diam.
4. Selesaikan backend terlebih dahulu—skema database, API, autentikasi, aturan bisnis, dan pengujian inti—sebelum mulai mengimplementasikan frontend.
5. `design/design.zip` merupakan referensi visual untuk implementasi frontend. Tidak semua halaman tersedia dalam desain tersebut. Untuk halaman yang tersedia, ikuti desain sebagai acuan visual. Untuk halaman yang belum tersedia, rancang tampilan dengan mengikuti pola visual, warna, tipografi, komponen, navigasi, jarak, dan gaya layout dari desain yang tersedia agar seluruh aplikasi tetap konsisten. Jangan menjadikan elemen desain sebagai dasar untuk menambah fitur atau mengubah aturan bisnis dalam README. **Seluruh halaman wajib responsif dan nyaman digunakan pada desktop, tablet, maupun mobile**, termasuk navigasi, tabel, formulir, dashboard, dan katalog publik.
6. Sebelum mengubah kode, periksa struktur proyek dan file terkait. Hindari refactor luas yang tidak diperlukan.
7. Jangan menyatakan pekerjaan selesai tanpa menjalankan pengujian yang relevan. Laporkan pengujian yang benar-benar dijalankan beserta hasilnya.
8. Jangan menyimpan rahasia atau kredensial di source code. Gunakan konfigurasi environment dan sediakan `.env.example` tanpa nilai rahasia.
9. Pada akhir tugas, laporkan secara singkat perubahan, pengujian dan hasilnya, serta kendala atau asumsi yang tersisa.


## 8. Development Roadmap

### Backend
- [ ] B1. Fondasi backend, database, dan health check.
- [ ] B2. Autentikasi, akun pengguna, dan hak akses.
- [ ] B3. Master produk dan bahan baku.
- [ ] B4. Penerimaan bahan baku dan saldo awal.
- [ ] B5. Produksi, kode batch, dan koreksi produksi.
- [ ] B6. Stok produk per batch dan penyesuaian stok.
- [ ] B7. Penjualan, alokasi batch, dan pembatalan transaksi.
- [ ] B8. Katalog publik dan QR traceability.
- [ ] B9. Dashboard dan laporan.
- [ ] B10. Pengujian integrasi dan pemeriksaan keamanan.

### Frontend
- [ ] F1. Fondasi frontend dan sistem desain.
- [ ] F2. Login dan manajemen pengguna.
- [ ] F3. Halaman master data.
- [ ] F4. Halaman bahan baku dan produksi.
- [ ] F5. Halaman stok dan penyesuaian stok.
- [ ] F6. Halaman penjualan dan riwayat transaksi.
- [ ] F7. Katalog dan halaman QR publik.
- [ ] F8. Dashboard dan integrasi seluruh API.
- [ ] F9. Pengujian alur aplikasi secara menyeluruh.

## 9. Current Focus
B1 — Fondasi backend, database, dan health check.
