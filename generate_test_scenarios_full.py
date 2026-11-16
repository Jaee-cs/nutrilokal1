import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = openpyxl.Workbook()

# Setup styles
FONT_FAMILY = "Segoe UI"
header_font = Font(name=FONT_FAMILY, size=11, bold=True, color="FFFFFF")
title_font = Font(name=FONT_FAMILY, size=16, bold=True, color="1F4E79")
subtitle_font = Font(name=FONT_FAMILY, size=11, italic=True, color="595959")
section_font = Font(name=FONT_FAMILY, size=12, bold=True, color="1F4E79")
bold_font = Font(name=FONT_FAMILY, size=10, bold=True)
regular_font = Font(name=FONT_FAMILY, size=10)

header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")

thin_border_side = Side(border_style="thin", color="D9D9D9")
thin_border = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=thin_border_side)

# Priority Fills
high_fill = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid") # Soft Orange
med_fill = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid") # Soft Yellow
low_fill = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid") # Soft Green

# Complete Test Cases Array (52 Cases)
test_cases = [
    # AUTH - Autentikasi & Akun
    {
        "id": "TC-AUTH-001",
        "module": "Autentikasi & Akun",
        "submodule": "Login Internal",
        "title": "Login Berhasil dengan Hak Akses Admin",
        "desc": "Admin login dengan username & password valid dan mendapatkan akses ke seluruh menu aplikasi",
        "pre": "Akun Admin terdaftar & aktif (isActive = true)",
        "steps": "1. Akses /login\n2. Masukkan username admin valid\n3. Masukkan password valid\n4. Klik 'Masuk'",
        "data": "Username: admin, Password: [password_valid]",
        "expected": "Login berhasil, token JWT tersimpan, redirect ke /dashboard, menu Admin (Management, Adjustment, Correction) aktif",
        "priority": "High", "type": "Positif"
    },
    {
        "id": "TC-AUTH-002",
        "module": "Autentikasi & Akun",
        "submodule": "Login Internal",
        "title": "Login Berhasil dengan Hak Akses Operator",
        "desc": "Operator login dengan kredensial valid dan mendapatkan akses operasional (menu khusus Admin tersembunyi)",
        "pre": "Akun Operator terdaftar & aktif",
        "steps": "1. Akses /login\n2. Masukkan username operator\n3. Masukkan password valid\n4. Klik 'Masuk'",
        "data": "Username: operator1, Password: [password_valid]",
        "expected": "Login berhasil, redirect ke /dashboard, menu khusus Admin disembunyikan dari sidebar",
        "priority": "High", "type": "Positif"
    },
    {
        "id": "TC-AUTH-003",
        "module": "Autentikasi & Akun",
        "submodule": "Login Internal",
        "title": "Login Gagal - Password Salah",
        "desc": "Sistem menolak autentikasi jika kata sandi salah dan menampilkan pesan error",
        "pre": "Username terdaftar",
        "steps": "1. Akses /login\n2. Masukkan username valid\n3. Masukkan password salah\n4. Klik 'Masuk'",
        "data": "Username: admin, Password: wrongpassword",
        "expected": "Login ditolak (HTTP 401), pesan 'Username atau password salah' muncul di UI",
        "priority": "High", "type": "Negatif"
    },
    {
        "id": "TC-AUTH-004",
        "module": "Autentikasi & Akun",
        "submodule": "Login Internal",
        "title": "Login Gagal - Akun Dinonaktifkan (Disabled)",
        "desc": "Pengguna yang status akunnya nonaktif ditolak saat mencoba masuk",
        "pre": "Akun pengguna memilki isActive = false",
        "steps": "1. Masukkan username akun nonaktif\n2. Masukkan password yang benar\n3. Klik 'Masuk'",
        "data": "Username: operator_disabled, Password: [password_valid]",
        "expected": "Login ditolak (HTTP 403), pesan 'Akun dinonaktifkan. Hubungi Admin.' muncul",
        "priority": "High", "type": "Negatif & Keamanan"
    },
    {
        "id": "TC-AUTH-005",
        "module": "Autentikasi & Akun",
        "submodule": "Manajemen Akun",
        "title": "Wajib Ganti Password Setelah Reset Admin",
        "desc": "User yang kata sandinya di-reset Admin dipaksa menetapkan kata sandi baru saat login pertama",
        "pre": "Admin telah me-reset password user (mustChangePassword = true)",
        "steps": "1. User login dengan password temporer\n2. Sistem mendeteksi flag mustChangePassword\n3. Coba akses menu lain",
        "data": "Password Temp: Temp123456",
        "expected": "Sistem memblokir navigasi operasional dan memunculkan form 'Wajib Ganti Kata Sandi'",
        "priority": "High", "type": "Positif & Keamanan"
    },
    {
        "id": "TC-AUTH-006",
        "module": "Autentikasi & Akun",
        "submodule": "Manajemen Akun",
        "title": "Tambah Akun Operator Baru oleh Admin",
        "desc": "Admin menambahkan akun Operator baru dengan username unik",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka /users\n2. Klik 'Tambah Pengguna'\n3. Isi nama, username unik, password awal, role Operator\n4. Simpan",
        "data": "Nama: Budi, Username: budi_op, Role: OPERATOR",
        "expected": "Akun tersimpan di DB (password di-hash bcrypt), akun baru dapat digunakan untuk login",
        "priority": "Medium", "type": "Positif"
    },
    {
        "id": "TC-AUTH-007",
        "module": "Autentikasi & Akun",
        "submodule": "Manajemen Akun",
        "title": "Nonaktifkan Akun Pengguna Ber-Riwayat (Soft Delete)",
        "desc": "Akun yang pernah mencatat transaksi tidak dihapus dari DB, melainkan dinonaktifkan",
        "pre": "Akun 'budi_op' telah mencatat transaksi",
        "steps": "1. Admin memilih nonaktifkan pada akun 'budi_op'\n2. Periksa DB tabel users & riwayat transaksi",
        "data": "User: budi_op",
        "expected": "Field isActive = false. Riwayat transaksi lama tetap menampilkan nama 'budi_op'",
        "priority": "High", "type": "Integritas Data"
    },
    {
        "id": "TC-AUTH-008",
        "module": "Autentikasi & Akun",
        "submodule": "Profil & Password",
        "title": "Ubah Password Sendiri via Halaman Profil",
        "desc": "Pengguna dapat mengganti kata sandinya sendiri dengan memasukkan password lama",
        "pre": "User login aktif",
        "steps": "1. Akses menu Profil (/profile)\n2. Masukkan password lama, password baru, konfirmasi password\n3. Klik 'Simpan Password'",
        "data": "Old Pass: pass123, New Pass: pass456",
        "expected": "Password berhasil diperbarui. Login berikutnya wajib menggunakan password baru",
        "priority": "Medium", "type": "Positif"
    },
    {
        "id": "TC-AUTH-009",
        "module": "Autentikasi & Akun",
        "submodule": "Sesi & Logout",
        "title": "Logout Sesi & Clearing Token",
        "desc": "Memastikan tombol Keluar menghapus token dari localStorage dan memblokir tombol Back browser",
        "pre": "User dalam keadaan login",
        "steps": "1. Klik tombol 'Keluar / Logout'\n2. Cek localStorage\n3. Klik tombol Back di browser",
        "data": "Aksi: Logout",
        "expected": "Token terhapus dari localStorage, user di-redirect ke /login, tombol Back tidak bisa membuka halaman internal",
        "priority": "High", "type": "Keamanan"
    },

    # MST - Master Data
    {
        "id": "TC-MST-001",
        "module": "Master Data",
        "submodule": "Master Produk",
        "title": "Tambah Master Produk Baru & Upload Foto",
        "desc": "Admin menambahkan master produk baru beserta harga jual, deskripsi, komposisi, dan foto produk",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka /products\n2. Klik 'Tambah Produk'\n3. Isi nama, satuan, harga jual, deskripsi, komposisi, petunjuk simpan\n4. Upload foto (.jpg/.png < 2MB)\n5. Simpan",
        "data": "Nama: Keripik Pisang Original, Satuan: pcs, Harga: 15.000",
        "expected": "Produk tersimpan, photoUrl terisi, produk muncul di daftar master produk aktif",
        "priority": "High", "type": "Positif"
    },
    {
        "id": "TC-MST-002",
        "module": "Master Data",
        "submodule": "Master Produk",
        "title": "Validasi Upload Foto Produk Invalid / Ukuran Over",
        "desc": "Sistem menolak upload foto produk dengan ekstensi selain gambar atau ukuran melebihi batas",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka form produk\n2. Upload file berkas .pdf atau .exe\n3. Klik Simpan",
        "data": "File: dokumen.pdf",
        "expected": "Sistem menampilkan pesan error 'Format berkas tidak didukung. Gunakan JPG/PNG'",
        "priority": "Low", "type": "Validation"
    },
    {
        "id": "TC-MST-003",
        "module": "Master Data",
        "submodule": "Master Bahan Baku",
        "title": "Tambah Master Bahan Baku & Unique Name Key Check",
        "desc": "Nama bahan baku unik di database (case-insensitive & trim spasi)",
        "pre": "Login sebagai Admin",
        "steps": "1. Buat bahan baku 'Pisang Kepok'\n2. Coba buat bahan baku baru dengan nama '  pisang kepok  '",
        "data": "Bahan 1: 'Pisang Kepok', Bahan 2: ' pisang kepok '",
        "expected": "Bahan 1 sukses. Bahan 2 DITOLAK constraint DB / API error 'Nama bahan baku sudah digunakan'",
        "priority": "High", "type": "Negatif & Validation"
    },
    {
        "id": "TC-MST-004",
        "module": "Master Data",
        "submodule": "Master Produk",
        "title": "Hapus Produk Tanpa Riwayat vs Nonaktifkan Produk Ber-Riwayat",
        "desc": "Produk tanpa riwayat boleh dihapus, produk ber-riwayat hanya dapat dinonaktifkan",
        "pre": "Produk A (baru, tanpa riwayat), Produk B (pernah diproduksi/dijual)",
        "steps": "1. Hapus Produk A -> Cek respons\n2. Hapus Produk B -> Cek respons",
        "data": "Produk A (No history), Produk B (Has history)",
        "expected": "Produk A terhapus dari DB. Produk B DITOLAK hapus, hanya opsi Nonaktifkan (isActive = false)",
        "priority": "High", "type": "Integritas Data"
    },
    {
        "id": "TC-MST-005",
        "module": "Master Data",
        "submodule": "Master Produk",
        "title": "Pengaruh Produk Nonaktif terhadap Operasional & Katalog",
        "desc": "Produk nonaktif otomatis tersembunyi dari form produksi, penjualan baru, dan katalog publik",
        "pre": "Produk C di-set isActive = false",
        "steps": "1. Cek dropdown produk di Form Produksi Baru\n2. Cek dropdown produk di Form Penjualan Baru\n3. Cek Halaman Katalog Publik (/catalog)",
        "data": "Status Produk C: Nonaktif",
        "expected": "Produk C tidak muncul pada dropdown produksi, penjualan, maupun katalog publik",
        "priority": "High", "type": "Positif & Logic"
    },
    {
        "id": "TC-MST-006",
        "module": "Master Data",
        "submodule": "Master Produk",
        "title": "Verifikasi Price Snapshot Master Produk pada Transaksi Penjualan",
        "desc": "Mengubah harga jual produk di Master tidak merubah unitPrice pada transaksi penjualan yang sudah terjadi",
        "pre": "TRX-001 tercatat dengan harga Produk A = Rp 15.000",
        "steps": "1. Admin mengubah harga Produk A di Master Produk menjadi Rp 18.000\n2. Buka detail transaksi TRX-001",
        "data": "Old Price: 15.000, New Price: 18.000",
        "expected": "Harga unitPrice pada TRX-001 tetap Rp 15.000 (tidak terpengaruh perubahan master)",
        "priority": "High", "type": "Integritas Data"
    },
    {
        "id": "TC-MST-007",
        "module": "Master Data",
        "submodule": "Resep Produk",
        "title": "Pengaturan Resep Standar Produk",
        "desc": "Admin menentukan takaran resep bahan baku per 1 unit produk",
        "pre": "Master Produk & Bahan Baku aktif",
        "steps": "1. Buka detail resep Produk 'Keripik Pisang'\n2. Tambah bahan: Pisang Kepok (0.5 kg) & Minyak (0.1 liter)\n3. Simpan",
        "data": "Resep: 0.5 kg Pisang + 0.1 L Minyak per 1 pcs",
        "expected": "Resep tersimpan di ProductRecipeItem sebagai acuan kalkulasi estimasi bahan saat produksi",
        "priority": "Medium", "type": "Positif"
    },
    {
        "id": "TC-MST-008",
        "module": "Master Data",
        "submodule": "Pencarian & Filter",
        "title": "Fitur Pencarian & Filter pada Master Data",
        "desc": "Memastikan kata kunci pencarian menyaring daftar produk dan bahan baku secara akurat",
        "pre": "Terdapat 10+ produk di master",
        "steps": "1. Ketik 'Pisang' pada kolom pencarian master produk\n2. Filter berdasarkan status 'Aktif'",
        "data": "Search: 'Pisang'",
        "expected": "Tabel hanya menampilkan produk yang mengandung kata 'Pisang' dan berstatus Aktif",
        "priority": "Low", "type": "UI Filter"
    },

    # MAT - Stok Bahan Baku
    {
        "id": "TC-MAT-001",
        "module": "Stok Bahan Baku",
        "submodule": "Penerimaan Bahan",
        "title": "Catat Penerimaan Bahan Baku Valid",
        "desc": "Pencatatan penerimaan bahan baku menambah stok bahan baku secara otomatis",
        "pre": "Bahan baku 'Pisang Kepok' aktif (Stok awal = 0 kg)",
        "steps": "1. Buka /materials/receipts\n2. Pilih Bahan: Pisang Kepok, Qty: 50 kg, Tanggal: Hari Ini\n3. Simpan",
        "data": "Material: Pisang Kepok, Qty: 50 kg",
        "expected": "Penerimaan tersimpan, Stok Pisang Kepok bertambah menjadi 50 kg, MaterialStockMovement tipe RECEIPT tercatat",
        "priority": "High", "type": "Positif"
    },
    {
        "id": "TC-MAT-002",
        "module": "Stok Bahan Baku",
        "submodule": "Penerimaan Bahan",
        "title": "Validasi Input Jumlah Penerimaan Invalid (Zero / Negative)",
        "desc": "Sistem menolak penerimaan bahan baku dengan jumlah <= 0",
        "pre": "Bahan baku aktif",
        "steps": "1. Input Qty penerimaan = 0 atau -10 kg\n2. Klik Simpan",
        "data": "Qty: 0 / -10",
        "expected": "Form menolak input dan menampilkan pesan 'Jumlah penerimaan harus lebih besar dari 0'",
        "priority": "High", "type": "Negatif & Validation"
    },
    {
        "id": "TC-MAT-003",
        "module": "Stok Bahan Baku",
        "submodule": "Saldo Awal Bahan",
        "title": "Catat Saldo Awal Bahan Baku oleh Admin (Wajib Alasan)",
        "desc": "Admin mencatat saldo awal bahan baku terpisah dari penerimaan biasa dan wajib memuat alasan",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka menu Saldo Awal Bahan Baku\n2. Pilih Bahan: Gula, Qty: 20 kg, Tanggal: 2026-10-01\n3. Coba simpan tanpa Alasan -> Cek error\n4. Isi Alasan: 'Stok Opname Awal' -> Simpan",
        "data": "Material: Gula, Qty: 20 kg, Reason: Stok Opname Awal",
        "expected": "Simpan tanpa alasan DITOLAK. Setelah mengisi alasan, saldo awal tersimpan & stok +20 kg",
        "priority": "High", "type": "Validation & Positif"
    },
    {
        "id": "TC-MAT-004",
        "module": "Stok Bahan Baku",
        "submodule": "Idempotency Control",
        "title": "Pencegahan Double-Submit Penerimaan Bahan Baku (Idempotency Key)",
        "desc": "Request penerimaan bahan dengan Idempotency-Key sama tidak menambah stok dua kali",
        "pre": "Header Idempotency-Key dikirim klien",
        "steps": "1. Kirim request POST penerimaan 10 kg (Key: 'IDEM-001')\n2. Kirim ulang request identik (Key: 'IDEM-001')",
        "data": "Key: IDEM-001, Qty: 10 kg",
        "expected": "Request 1 sukses (+10 kg). Request 2 mengembalikan hasil cache tanpa menambah stok (+0 kg)",
        "priority": "High", "type": "Keamanan & Race Condition"
    },
    {
        "id": "TC-MAT-005",
        "module": "Stok Bahan Baku",
        "submodule": "Bahan Nonaktif",
        "title": "Bahan Baku Nonaktif Tersembunyi dari Form Penerimaan Baru",
        "desc": "Bahan baku yang dinonaktifkan Admin tidak muncul di dropdown pilihan penerimaan bahan",
        "pre": "Bahan Baku 'Tepung' di-set isActive = false",
        "steps": "1. Buka Form Penerimaan Bahan Baku Baru\n2. Periksa daftar pilihan bahan baku",
        "data": "Material: Tepung (Nonaktif)",
        "expected": "Bahan Baku 'Tepung' tidak ada di daftar pilihan dropdown",
        "priority": "Medium", "type": "Positif & Logic"
    },

    # PROD - Produksi & Kode Batch
    {
        "id": "TC-PROD-001",
        "module": "Produksi & Batch",
        "submodule": "Pencatatan Produksi",
        "title": "Pencatatan Produksi Selesai Valid (Transaksi Atomik)",
        "desc": "Pencatatan produksi mengurangi stok bahan baku sesuai pemakaian aktual dan menambah stok batch produk jadi secara atomik",
        "pre": "Stok Pisang = 50 kg, Stok Minyak = 10 L",
        "steps": "1. Buka /productions/new\n2. Pilih Produk: Keripik Pisang Original\n3. Tanggal: 2026-10-16, Yield: 100 pcs\n4. Pemakaian Aktual: Pisang 30 kg, Minyak 5 L\n5. Simpan",
        "data": "Yield: 100 pcs, Usage: Pisang 30kg, Minyak 5L",
        "expected": "Produksi tersimpan, Stok Pisang sisa 20kg, Minyak sisa 5L, Kode Batch 'NL-20261016-001' terbentuk dengan stok 100 pcs",
        "priority": "High", "type": "Positif & Atomik"
    },
    {
        "id": "TC-PROD-002",
        "module": "Produksi & Batch",
        "submodule": "Pencatatan Produksi",
        "title": "Produksi Ditolak - Stok Bahan Baku Tidak Mencukupi",
        "desc": "Sistem menolak pencatatan produksi jika salah satu pemakaian bahan baku melebihi stok yang ada",
        "pre": "Stok Gula = 3 kg",
        "steps": "1. Input pemakaian Gula = 10 kg pada form produksi\n2. Klik Simpan",
        "data": "Pemakaian Gula: 10 kg (Stok: 3 kg)",
        "expected": "Produksi DITOLAK dengan pesan 'Stok bahan baku [Gula] tidak mencukupi'. Tidak ada stok yang berubah.",
        "priority": "High", "type": "Negatif & Boundary"
    },
    {
        "id": "TC-PROD-003",
        "module": "Produksi & Batch",
        "submodule": "Pencatatan Produksi",
        "title": "Validasi Tanggal Produksi Masa Depan Ditolak",
        "desc": "Tanggal produksi sebenarnya tidak boleh diisi tanggal esok / masa depan",
        "pre": "Hari ini: 2026-11-16",
        "steps": "1. Input tanggal produksi: 2026-11-25 (Masa Depan)\n2. Klik Simpan",
        "data": "ProductionDate: 2026-11-25",
        "expected": "Pencatatan ditolak, error 'Tanggal produksi tidak boleh berada di masa depan'",
        "priority": "High", "type": "Negatif & Validation"
    },
    {
        "id": "TC-PROD-004",
        "module": "Produksi & Batch",
        "submodule": "Pencatatan Produksi",
        "title": "Pencatatan Produksi Mundur (Backdated)",
        "desc": "Sistem mendukung pencatatan produksi tanggal lampau dan penomoran urut batch tetap konsisten",
        "pre": "Sudah ada batch NL-20261015-001",
        "steps": "1. Input tanggal produksi mundur: 2026-10-15\n2. Simpan Catatan Produksi",
        "data": "ProductionDate: 2026-10-15",
        "expected": "Produksi tersimpan, kode batch otomatis ter-generate sebagai 'NL-20261015-002'",
        "priority": "Medium", "type": "Positif"
    },
    {
        "id": "TC-PROD-005",
        "module": "Produksi & Batch",
        "submodule": "Stok Awal Batch",
        "title": "Catat Stok Awal Batch Tanpa Tanggal Produksi (NL-OPEN)",
        "desc": "Admin mencatat stok awal produk jadi per batch yang tanggal produksinya tidak diketahui",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka Stok Awal Produk Jadi\n2. Pilih Produk: Keripik Pisang, Qty: 40 pcs, Tanggal Prod: Kosong, Tanggal Catat: 2026-10-20\n3. Simpan",
        "data": "Qty: 40 pcs, productionDate: null",
        "expected": "Batch terbuat dengan kode 'NL-OPEN-20261020-001', productionDate = null, status riwayat terbatas",
        "priority": "Medium", "type": "Positif"
    },
    {
        "id": "TC-PROD-006",
        "module": "Produksi & Batch",
        "submodule": "Koreksi Produksi",
        "title": "Koreksi Catatan Produksi & Pembentukan Alias Batch",
        "desc": "Admin mengedit tanggal produksi lama. Kode batch diperbarui dan kode lama disimpan sebagai alias",
        "pre": "Batch NL-20261016-001 terdaftar",
        "steps": "1. Admin edit catatan produksi: ubah tanggal dari 2026-10-16 menjadi 2026-10-17\n2. Simpan Koreksi",
        "data": "Old Date: 2026-10-16 -> New Date: 2026-10-17",
        "expected": "1. Kode batch utama menjadi NL-20261017-001\n2. NL-20261016-001 tersimpan di BatchAlias\n3. Record ProductionCorrection dibuat",
        "priority": "High", "type": "Positif & Audit Trail"
    },
    {
        "id": "TC-PROD-007",
        "module": "Produksi & Batch",
        "submodule": "Jejak Koreksi",
        "title": "Lihat Riwayat Audit Koreksi Produksi oleh Admin",
        "desc": "Sistem mencatat dan menampilkan riwayat perubahan audit trail koreksi produksi",
        "pre": "Produksi PRD-001 pernah dikoreksi",
        "steps": "1. Buka detail produksi PRD-001 (/productions/PRD-001)\n2. Periksa tab / section 'Riwayat Koreksi'",
        "data": "Production ID: PRD-001",
        "expected": "Menampilkan nama admin pengubah, waktu perubahan, field yang diubah, nilai lama, dan nilai baru",
        "priority": "Medium", "type": "Audit Trail"
    },

    # STK - Stok Produk Jadi & Penyesuaian
    {
        "id": "TC-STK-001",
        "module": "Stok & Penyesuaian",
        "submodule": "Monitoring Stok",
        "title": "Konsistensi Total Stok Produk vs Sum Stok Per Batch",
        "desc": "Total stok produk di master/katalog selalu sama dengan jumlah stok seluruh batch aktif produk tersebut",
        "pre": "Batch 001 (stok 50) dan Batch 002 (stok 30)",
        "steps": "1. Buka menu Stok Produk Jadi (/stock)\n2. Periksa Total Stok Produk A",
        "data": "Batch 001 = 50, Batch 002 = 30",
        "expected": "Total stok Produk A bernilai 80 pcs secara presisi",
        "priority": "High", "type": "Integritas Data"
    },
    {
        "id": "TC-STK-002",
        "module": "Stok & Penyesuaian",
        "submodule": "Penyesuaian Stok",
        "title": "Penyesuaian Stok Positif & Negatif oleh Admin Valid",
        "desc": "Admin melakukan penyesuaian stok opname/rusak dengan menginput jumlah bernilai tanda dan alasan",
        "pre": "Stok Batch NL-20261016-001 = 100 pcs",
        "steps": "1. Kurangi stok batch -5 pcs (Alasan: Kemasan Bocor)\n2. Tambah stok bahan +2 kg (Alasan: Hasil Opname Fisik)",
        "data": "Batch Adjustment: -5, Material Adjustment: +2",
        "expected": "Stok batch menjadi 95 pcs, stok bahan +2 kg. Record StockAdjustment & Movement tercatat",
        "priority": "High", "type": "Positif & Audit Trail"
    },
    {
        "id": "TC-STK-003",
        "module": "Stok & Penyesuaian",
        "submodule": "Penyesuaian Stok",
        "title": "Penyesuaian Stok Penyebab Stok Negatif DITOLAK",
        "desc": "Penyesuaian stok yang membuat stok akhir < 0 ditolak backend",
        "pre": "Stok Batch NL-20261016-001 = 10 pcs",
        "steps": "1. Admin input penyesuaian stok -15 pcs\n2. Klik Simpan",
        "data": "Stok Ada: 10, Adjustment: -15",
        "expected": "Penyesuaian DITOLAK, error 'Penyesuaian dibatalkan: Stok akhir tidak boleh negatif'",
        "priority": "High", "type": "Negatif & Boundary"
    },
    {
        "id": "TC-STK-004",
        "module": "Stok & Penyesuaian",
        "submodule": "Retur Penjualan",
        "title": "Penanganan Retur Barang Jual melalui Penyesuaian Stok Admin",
        "desc": "Admin mencatat retur barang dari konsumen setelah memeriksa kelaikan barang",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka Penyesuaian Stok\n2. Pilih Batch asal, Qty: +2 pcs, Alasan: 'Retur Pelanggan - Barang Layak Jual Tervalidasi'\n3. Simpan",
        "data": "Target: Batch NL-20261016-001, Qty: +2, Reason: Retur Valid",
        "expected": "Stok batch bertambah +2 pcs, alasan retur dan admin pencatat terekam lengkap di ledger",
        "priority": "Medium", "type": "Positif"
    },
    {
        "id": "TC-STK-005",
        "module": "Stok & Penyesuaian",
        "submodule": "Ledger Pergerakan",
        "title": "Periksa Ledger Riwayat Pergerakan Stok Batch (BatchStockMovement)",
        "desc": "Setiap perubahan stok batch tercatat utuh di ledger dan tidak bisa diedit/dihapus",
        "pre": "Batch telah melalui Produksi (+100), Penjualan (-20), dan Adjustment (-5)",
        "steps": "1. Buka detail batch (/stock/batches/:id)\n2. Periksa tabel Riwayat Pergerakan Stok",
        "data": "Batch ID: [batch_id]",
        "expected": "Menampilkan 3 baris ledger: PRODUCTION_YIELD (+100), SALE (-20), ADJUSTMENT (-5) dengan timestamp & user",
        "priority": "High", "type": "Integritas Data"
    },

    # SALE - Penjualan & Pembatalan
    {
        "id": "TC-SALE-001",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pencatatan Penjualan",
        "title": "Transaksi Penjualan Multi-Item & Multi-Batch Valid",
        "desc": "Operator mencatat penjualan dengan memilih alokasi batch secara manual, total dihitung backend",
        "pre": "Batch A (Stok 50), Harga Master = Rp 15.000",
        "steps": "1. Buka /sales/new\n2. Pilih Produk A, Qty: 20 pcs -> Alokasi dari Batch A (20 pcs)\n3. Cek total harga backend (20 x 15.000 = Rp 300.000)\n4. Simpan",
        "data": "Product A: 20 pcs (Batch A: 20 pcs)",
        "expected": "Transaksi tersimpan, Stok Batch A sisa 30 pcs, Total Rp 300.000 masuk omzet",
        "priority": "High", "type": "Positif & Atomik"
    },
    {
        "id": "TC-SALE-002",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pencatatan Penjualan",
        "title": "Penjualan Alokasi Multi-Batch untuk 1 Jenis Produk",
        "desc": "Satu item penjualan dialokasikan ke beberapa batch berbeda (misal butuh 30 pcs: 20 dari Batch A, 10 dari Batch B)",
        "pre": "Batch A (Stok 20 pcs), Batch B (Stok 20 pcs)",
        "steps": "1. Input Penjualan Produk A total 30 pcs\n2. Alokasikan: Batch A = 20 pcs, Batch B = 10 pcs\n3. Simpan Transaksi",
        "data": "Item: Produk A 30 pcs (Batch A: 20, Batch B: 10)",
        "expected": "Transaksi berhasil, Stok Batch A menjadi 0 pcs, Stok Batch B menjadi 10 pcs",
        "priority": "High", "type": "Positif"
    },
    {
        "id": "TC-SALE-003",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pencatatan Penjualan",
        "title": "Penjualan Ditolak - Stok Batch Tidak Mencukupi",
        "desc": "Jika salah satu alokasi batch melebihi stok yang ada, seluruh transaksi ditolak",
        "pre": "Stok Batch A = 10 pcs",
        "steps": "1. Input alokasi penjualan dari Batch A sebesar 15 pcs\n2. Simpan Transaksi",
        "data": "Alokasi Batch A: 15 pcs (Stok: 10 pcs)",
        "expected": "Transaksi DITOLAK total. Tidak ada transaksi parsial dan stok tidak berubah.",
        "priority": "High", "type": "Negatif & Integrity"
    },
    {
        "id": "TC-SALE-004",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pencatatan Penjualan",
        "title": "Penjualan Ditolak - Batch Kedaluwarsa & Tervalidasi",
        "desc": "Batch yang tanggal kedaluwarsanya lewat dan tervalidasi ditolak saat transaksi penjualan",
        "pre": "Batch B expiryDate = 2026-10-01 (Masa Lalu) & expiryValidatedAt != null",
        "steps": "1. Operator pilih Batch B untuk transaksi hari ini (2026-11-16)\n2. Simpan Transaksi",
        "data": "Batch Expired: 2026-10-01 (Validated)",
        "expected": "Transaksi DITOLAK dengan pesan 'Batch [Kode] telah kedaluwarsa dan tidak dapat dijual'",
        "priority": "High", "type": "Negatif & Validation"
    },
    {
        "id": "TC-SALE-005",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pembatalan Penjualan",
        "title": "Pembatalan Transaksi Penjualan oleh Admin (Return Stok)",
        "desc": "Admin membatalkan transaksi penjualan dengan alasan. Stok dikembalikan ke batch asal dan omzet berkurang",
        "pre": "Transaksi TRX-001 aktif (mengurangi Batch A sebesar 20 pcs)",
        "steps": "1. Admin buka detail TRX-001 (/sales/TRX-001)\n2. Klik 'Batalkan Transaksi'\n3. Masukkan Alasan: 'Pelanggan Membatalkan Transaksi'\n4. Konfirmasi Pembatalan",
        "data": "TRX ID: TRX-001, Reason: Cancel Customer",
        "expected": "1. Transaksi status batal (cancelledAt terisi)\n2. Stok Batch A otomatis dikembalikan +20 pcs\n3. Omzet berkurang sejumlah nominal TRX-001",
        "priority": "High", "type": "Positif & Atomik"
    },
    {
        "id": "TC-SALE-006",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pembatalan Penjualan",
        "title": "Pencegahan Pembatalan Ganda (Double Cancellation)",
        "desc": "Transaksi yang sudah dibatalkan tidak dapat dibatalkan kembali (mencegah return stok ganda)",
        "pre": "Transaksi TRX-001 status sudah BATAL",
        "steps": "1. Kirim ulang request pembatalan API untuk TRX-001",
        "data": "TRX ID: TRX-001 (Status: Batal)",
        "expected": "Request DITOLAK dengan error 'Transaksi ini sudah dibatalkan sebelumnya'. Stok tidak berubah.",
        "priority": "High", "type": "Keamanan & Integritas Data"
    },
    {
        "id": "TC-SALE-007",
        "module": "Penjualan & Pembatalan",
        "submodule": "Validation Form",
        "title": "Validasi Transaksi Tanpa Item Produk",
        "desc": "Sistem memblokir penyimpanan transaksi penjualan yang belum memilih produk/item",
        "pre": "Form Penjualan Baru terbuka",
        "steps": "1. Kosongkan daftar item penjualan\n2. Klik Simpan Transaksi",
        "data": "Items: []",
        "expected": "Form menampilkan error 'Minimal harus menambahkan 1 item produk untuk penjualan'",
        "priority": "Medium", "type": "Validation"
    },

    # QR - Katalog & QR Traceability
    {
        "id": "TC-QR-001",
        "module": "Katalog & QR",
        "submodule": "Halaman QR Publik",
        "title": "Akses QR Publik Batch Terbit (Published) Tanpa Login",
        "desc": "Konsumen memindai QR Code untuk melihat detail produk dan traceability batch tanpa akun internal",
        "pre": "Batch NL-20261016-001 status QR: Validated & Published",
        "steps": "1. Buka browser tanpa login ke URL /qr/NL-20261016-001\n2. Periksa informasi produk & batch yang muncul",
        "data": "URL: /qr/NL-20261016-001",
        "expected": "Halaman publik tampil bersih, menampilkan: Nama Produk, Deskripsi, Kode Batch, Tanggal Produksi, Komposisi, Petunjuk Simpan, dan Kedaluwarsa.",
        "priority": "High", "type": "Positif & Public Access"
    },
    {
        "id": "TC-QR-002",
        "module": "Katalog & QR",
        "submodule": "Halaman QR Publik",
        "title": "Handling Batch Belum Divalidasi Kedaluwarsa pada QR Publik",
        "desc": "Jika tanggal kedaluwarsa batch belum divalidasi Admin (expiryValidatedAt = null), field kedaluwarsa disembunyikan",
        "pre": "Batch C expiryValidatedAt = null",
        "steps": "1. Buka URL publik /qr/Batch-C",
        "data": "URL: /qr/Batch-C",
        "expected": "Halaman publik TIDAK MENAMPILKAN baris tanggal kedaluwarsa (disembunyikan, tidak mengarang tanggal)",
        "priority": "High", "type": "Positif & Privacy"
    },
    {
        "id": "TC-QR-003",
        "module": "Katalog & QR",
        "submodule": "Manajemen QR",
        "title": "Siklus Publikasi QR: Validasi -> Terbit -> Penarikan (Withdrawn)",
        "desc": "Admin mengelola publikasi QR. Jika ditarik, QR publik hanya menampilkan pemberitahuan tanpa data internal",
        "pre": "Batch baru dibuat",
        "steps": "1. Admin klik 'Validasi' -> Validated\n2. Admin klik 'Terbitkan' -> Published\n3. Admin klik 'Tarik Informasi' -> Withdrawn\n4. Akses URL publik /qr/:code setelah ditarik",
        "data": "Batch ID: [batch_id]",
        "expected": "Saat ditarik, halaman publik menampilkan notifikasi 'Informasi publik untuk batch ini tidak tersedia / ditarik'. Tidak ada data internal yang bocor.",
        "priority": "High", "type": "Positif & Keamanan"
    },
    {
        "id": "TC-QR-004",
        "module": "Katalog & QR",
        "submodule": "Alias Batch QR",
        "title": "Akses QR Menggunakan Kode Batch Alias Lama",
        "desc": "QR Code pada kemasan lama yang dicetak dengan kode alias tetap mengarah ke data batch terkoreksi",
        "pre": "Kode lama NL-20261016-001 telah menjadi Alias dari NL-20261017-001",
        "steps": "1. Akses URL publik /qr/NL-20261016-001 (Kode Alias)",
        "data": "Code: NL-20261016-001 (Alias)",
        "expected": "Halaman publik sukses menampilkan data batch utama (NL-20261017-001) tanpa error 404.",
        "priority": "Medium", "type": "Positif"
    },
    {
        "id": "TC-QR-005",
        "module": "Katalog & QR",
        "submodule": "Expiry Management",
        "title": "Update & Validasi Tanggal Kedaluwarsa oleh Admin + Audit Log",
        "desc": "Admin mencatat/memperbarui tanggal kedaluwarsa batch. Perubahan dicatat di BatchExpiryChange",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka Manajemen QR / Batch Detail\n2. Set Tanggal Kedaluwarsa: 2027-05-01 & Klik Validasi\n3. Cek tabel BatchExpiryChange",
        "data": "Batch: NL-20261016-001, New Expiry: 2027-05-01",
        "expected": "expiryDate dan expiryValidatedAt ter-update. Entry baru tercatat di BatchExpiryChange dengan previousExpiryDate dan newExpiryDate",
        "priority": "High", "type": "Positif & Audit Trail"
    },
    {
        "id": "TC-QR-006",
        "module": "Katalog & QR",
        "submodule": "Katalog Digital",
        "title": "Pencarian & Filter Produk di Halaman Katalog Publik",
        "desc": "Masyarakat dapat menjelajahi seluruh katalog produk aktif tanpa login",
        "pre": "Akses /catalog tanpa login",
        "steps": "1. Buka /catalog\n2. Gunakan kolom pencarian 'Keripik'\n3. Klik kartu produk untuk melihat detail",
        "data": "URL: /catalog",
        "expected": "Katalog menampilkan produk-produk aktif, pencarian berfungsi responsif, foto produk tampil jernih",
        "priority": "Medium", "type": "Positif & Public Access"
    },

    # DASH - Dashboard & Laporan
    {
        "id": "TC-DASH-001",
        "module": "Dashboard & Laporan",
        "submodule": "Kalkulasi Omzet",
        "title": "Akurasi Total Omzet Dashboard (Eksklusi Transaksi Batal)",
        "desc": "Kartu Total Omzet di Dashboard hanya menghitung transaksi penjualan yang aktif",
        "pre": "TRX 1: Rp 100.000 (Aktif), TRX 2: Rp 50.000 (Batal)",
        "steps": "1. Buka Halaman Dashboard (/dashboard)\n2. Periksa statistik Total Omzet",
        "data": "TRX 1 = 100.000, TRX 2 = 50.000 (Batal)",
        "expected": "Total Omzet bernilai tepat Rp 100.000 (Nominal transaksi batal Rp 50.000 dikeluarkan dari hitungan)",
        "priority": "High", "type": "Positif & Kalkulasi"
    },
    {
        "id": "TC-DASH-002",
        "module": "Dashboard & Laporan",
        "submodule": "Filter Laporan",
        "title": "Filter Laporan Penjualan & Produksi Rentang Tanggal",
        "desc": "User dapat memfilter laporan operasional berdasarkan periode tanggal mulai dan akhir",
        "pre": "Terdapat data transaksi di bulan Oktober & November 2026",
        "steps": "1. Buka menu Laporan (/reports)\n2. Set Filter Tanggal Mulai: 2026-10-01 dan Tanggal Akhir: 2026-10-31\n3. Klik Terapkan Filter",
        "data": "Date Range: 2026-10-01 s/d 2026-10-31",
        "expected": "Tabel dan ringkasan laporan hanya menampilkan data transaksi yang terjadi pada periode Oktober 2026.",
        "priority": "Medium", "type": "Positif"
    },
    {
        "id": "TC-DASH-003",
        "module": "Dashboard & Laporan",
        "submodule": "Alert Stok",
        "title": "Peringatan Stok Rendah (Low Stock Alert) pada Dashboard",
        "desc": "Dashboard menampilkan daftar bahan baku / produk yang stoknya di bawah batas minimum",
        "pre": "Stok Minyak Goreng = 1 L (Stok Kritis)",
        "steps": "1. Buka Dashboard (/dashboard)\n2. Periksa widget 'Peringatan Stok'",
        "data": "Material: Minyak Goreng (1 L)",
        "expected": "Widget Peringatan Stok menampilkan Minyak Goreng dengan indikator warna merah/kuning",
        "priority": "Medium", "type": "Positif & Alert"
    },

    # SEC - Keamanan & RBAC
    {
        "id": "TC-SEC-001",
        "module": "Keamanan & RBAC",
        "submodule": "Authorization",
        "title": "Proteksi Backend Endpoint Admin dari Role Operator",
        "desc": "Backend menolak request ke endpoint Admin jika dikirim oleh Operator",
        "pre": "Login sebagai Operator (Token Operator active)",
        "steps": "1. Kirim HTTP POST ke `/api/stock-adjustments` dengan Token Operator\n2. Kirim HTTP POST ke `/api/users/reset-password` dengan Token Operator",
        "data": "Role: OPERATOR, Admin Endpoints",
        "expected": "Backend merespon HTTP 403 Forbidden dengan pesan 'Akses ditolak. Hak akses Admin diperlukan.'",
        "priority": "High", "type": "Keamanan (Security)"
    },
    {
        "id": "TC-SEC-002",
        "module": "Keamanan & RBAC",
        "submodule": "Authorization",
        "title": "Proteksi API Endpoint Internal dari Akses Unauthenticated",
        "desc": "Endpoint internal tidak dapat diakses tanpa token JWT yang valid",
        "pre": "Tanpa header Authorization Token",
        "steps": "1. Kirim HTTP GET ke `/api/products` tanpa token\n2. Kirim request dengan token expired / invalid",
        "data": "Header Authorization: None / Invalid",
        "expected": "Backend merespon HTTP 401 Unauthorized",
        "priority": "High", "type": "Keamanan (Security)"
    },

    # NFR & UI - Non-Functional & Antarmuka UI
    {
        "id": "TC-UI-001",
        "module": "Tampilan UI & NFR",
        "submodule": "Responsivitas",
        "title": "Pengujian Responsivitas UI pada Layar Mobile / Smartphone",
        "desc": "Seluruh halaman internal dan publik tampil rapi dan nyaman digunakan pada resolusi mobile (width <= 480px)",
        "pre": "Buka aplikasi pada Google Chrome Mobile Emulation (iPhone / Android)",
        "steps": "1. Buka halaman Dashboard, Form Produksi, Form Penjualan, dan QR Publik\n2. Periksa navigasi sidebar/hamburger menu, tabel scrollable, dan form field",
        "data": "Viewport: 375x812 (Mobile)",
        "expected": "UI menyesuaikan secara otomatis, tidak ada elemen terpotong/overlapping, tabel dapat di-scroll horizontal dengan smooth",
        "priority": "Medium", "type": "Responsivitas UI"
    },
    {
        "id": "TC-UI-002",
        "module": "Tampilan UI & NFR",
        "submodule": "Navigation 404",
        "title": "Handling Halaman Tidak Ditemukan (404 Page Not Found)",
        "desc": "Membuka URL yang tidak terdaftar di router menampilkan halaman 404 yang ramah pengguna",
        "pre": "User login atau publik",
        "steps": "1. Ketik URL asal di browser: `/halaman-salah-xyz`\n2. Periksa tampilan layar",
        "data": "URL: /halaman-salah-xyz",
        "expected": "Aplikasi menampilkan Halaman 404 Not Found beserta tombol 'Kembali ke Beranda'",
        "priority": "Low", "type": "UI Error Handling"
    },
    {
        "id": "TC-UI-003",
        "module": "Tampilan UI & NFR",
        "submodule": "Network Error",
        "title": "Handling Error Jaringan / Backend Off (Error Boundary)",
        "desc": "Aplikasi menangani situasi saat server backend offline secara anggun (graceful degradation)",
        "pre": "Server Backend di-stop",
        "steps": "1. Buka halaman aplikasi / lakukan submit form\n2. Periksa pesan yang muncul di layar",
        "data": "Backend Status: Offline",
        "expected": "Aplikasi menampilkan Toast Notification / Alert 'Gagal terhubung ke server. Periksa koneksi internet Anda'",
        "priority": "Medium", "type": "Network Error Handling"
    }
]

total_tc_rows = len(test_cases)
start_tc_row = 4
end_tc_row = start_tc_row + total_tc_rows - 1

# ==========================================
# SHEET 1: RINGKASAN & DASHBOARD TESTING
# ==========================================
ws1 = wb.active
ws1.title = "Ringkasan & Dashboard"
ws1.views.sheetView[0].showGridLines = True

# Title block
ws1.merge_cells("A1:G1")
ws1["A1"] = "SKENARIO TESTING & TEST CASES - NUTRILOKAL"
ws1["A1"].font = title_font

ws1.merge_cells("A2:G2")
ws1["A2"] = "Smart Production & Traceability Kit V1.0 | Rencana & Ringkasan Pengujian Sistem"
ws1["A2"].font = subtitle_font

ws1.row_dimensions[1].height = 25
ws1.row_dimensions[2].height = 18

# Summary Cards / Key Metrics Table
ws1["A4"] = "METRIK UTAMA SKENARIO TESTING"
ws1["A4"].font = section_font

metrics_headers = ["Kategori Metrik", "Jumlah Test Case", "Persentase", "Status Pengujian", "Catatan"]
for col_idx, h in enumerate(metrics_headers, 1):
    cell = ws1.cell(row=5, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal="center", vertical="center")

metrics_data = [
    ("Total Skenario / Test Cases", f"=COUNTA('Detail Skenario Testing'!A{start_tc_row}:A{end_tc_row})", "100%", "Siap Diuji (Ready)", "Mencakup seluruh alur bisnis V1.0 & UI/NFR"),
    ("Prioritas High (Kritis)", f"=COUNTIF('Detail Skenario Testing'!J{start_tc_row}:J{end_tc_row}, \"High\")", "=B7/B6", "Prioritas Utama", "Fokus utama pada alur core transaksi & stok"),
    ("Prioritas Medium (Sedang)", f"=COUNTIF('Detail Skenario Testing'!J{start_tc_row}:J{end_tc_row}, \"Medium\")", "=B8/B6", "Prioritas Kedua", "Fokus pada fitur pendukung & UI filter"),
    ("Prioritas Low (Rendah)", f"=COUNTIF('Detail Skenario Testing'!J{start_tc_row}:J{end_tc_row}, \"Low\")", "=B9/B6", "Prioritas Ketiga", "Fokus pada aksesoris UI & error handling"),
    ("Pengujian Keamanan & RBAC", f"=COUNTIF('Detail Skenario Testing'!K{start_tc_row}:K{end_tc_row}, \"*Keamanan*\")", "=B10/B6", "Proteksi Access", "Memastikan backend & role enforcement"),
    ("Pengujian Atomik & Integritas Data", f"=COUNTIF('Detail Skenario Testing'!K{start_tc_row}:K{end_tc_row}, \"*Atomik*\") + COUNTIF('Detail Skenario Testing'!K{start_tc_row}:K{end_tc_row}, \"*Integritas*\")", "=B11/B6", "Korektansi Ledger", "Pencegahan stok negatif & double count")
]

for row_idx, data in enumerate(metrics_data, 6):
    for col_idx, val in enumerate(data, 1):
        cell = ws1.cell(row=row_idx, column=col_idx, value=val)
        cell.font = regular_font
        cell.border = thin_border
        if col_idx in [2, 3]:
            cell.alignment = Alignment(horizontal="center")
        if col_idx == 3 and str(val).startswith("="):
            cell.number_format = "0.0%"

# Breakdown per Modul Table
ws1["A14"] = "DISTRIBUSI TEST CASES PER MODUL"
ws1["A14"].font = section_font

mod_headers = ["No", "Nama Modul Aplikasi", "Kode", "Jumlah Skenario", "Cakupan Pengujian Kunci"]
for col_idx, h in enumerate(mod_headers, 1):
    cell = ws1.cell(row=15, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal="center", vertical="center")

mod_data = [
    (1, "Autentikasi & Pengelolaan Akun", "AUTH", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Autentikasi*\")", "Login Admin/Op, Password Reset, Profile, Logout, Hak Akses, Soft Delete"),
    (2, "Master Produk & Bahan Baku", "MST", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Master Data*\")", "Master Produk, Master Bahan, Resep, Soft Delete, Price Snapshot, Search"),
    (3, "Stok Bahan Baku & Penerimaan", "MAT", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Stok Bahan Baku*\")", "Penerimaan Bahan, Saldo Awal, Idempotency Double-Click, Bahan Nonaktif"),
    (4, "Produksi & Kode Batch", "PROD", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Produksi*\")", "Transaksi Atomik, Format NL-YYYYMMDD-NNN, Backdate, Koreksi & Alias, Audit Log"),
    (5, "Stok Produk Jadi & Penyesuaian", "STK", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Stok & Penyesuaian*\")", "Opname Admin, Pencegahan Stok Negatif, Retur Barang, Ledger Movement"),
    (6, "Penjualan & Pembatalan Transaksi", "SALE", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Penjualan*\")", "Alokasi Batch, Multi-Batch, Cek Expired, Pembatalan Admin & Return Stok"),
    (7, "Katalog Digital & QR Traceability", "QR", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Katalog*\")", "Public Scan, Status Validated/Published/Withdrawn, Alias, Expiry Validation"),
    (8, "Dashboard & Laporan Usaha", "DASH", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Dashboard*\")", "Akurasi Omzet Non-Batal, Filter Date Range, Alert Stok Rendah"),
    (9, "Keamanan & Akses Kontrol (RBAC)", "SEC", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Keamanan*\")", "Validasi Role Backend 403, Endpoint Protection 401"),
    (10, "Antarmuka UI & Non-Functional", "UI", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Tampilan UI*\")", "Responsivitas Mobile/Tablet, 404 Navigation, Network Error Handling")
]

for row_idx, data in enumerate(mod_data, 16):
    for col_idx, val in enumerate(data, 1):
        cell = ws1.cell(row=row_idx, column=col_idx, value=val)
        cell.font = regular_font
        cell.border = thin_border
        if col_idx in [1, 3, 4]:
            cell.alignment = Alignment(horizontal="center")


# ==========================================
# SHEET 2: DETAIL SKENARIO TESTING
# ==========================================
ws2 = wb.create_sheet(title="Detail Skenario Testing")
ws2.views.sheetView[0].showGridLines = True

# Title block
ws2.merge_cells("A1:M1")
ws2["A1"] = "MATRIKS SKENARIO TESTING & TEST CASES DETAIL"
ws2["A1"].font = title_font

ws2.row_dimensions[1].height = 25
ws2.row_dimensions[3].height = 24

headers_tc = [
    "ID Test Case", "Modul Utama", "Sub-Modul", "Judul Skenario Testing",
    "Deskripsi Skenario / Tujuan", "Pra-kondisi (Pre-conditions)",
    "Langkah-langkah Pengujian (Test Steps)", "Data Uji (Test Data)",
    "Ekspektasi Hasil (Expected Result)", "Prioritas", "Jenis Pengujian",
    "Hasil Aktual (Actual Result)", "Status"
]

for col_idx, h in enumerate(headers_tc, 1):
    cell = ws2.cell(row=3, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

for row_idx, tc in enumerate(test_cases, start_tc_row):
    ws2.cell(row=row_idx, column=1, value=tc["id"]).alignment = Alignment(horizontal="center", vertical="top")
    ws2.cell(row=row_idx, column=2, value=tc["module"]).alignment = Alignment(vertical="top")
    ws2.cell(row=row_idx, column=3, value=tc["submodule"]).alignment = Alignment(vertical="top")
    ws2.cell(row=row_idx, column=4, value=tc["title"]).alignment = Alignment(vertical="top")
    ws2.cell(row=row_idx, column=5, value=tc["desc"]).alignment = Alignment(vertical="top", wrap_text=True)
    ws2.cell(row=row_idx, column=6, value=tc["pre"]).alignment = Alignment(vertical="top", wrap_text=True)
    ws2.cell(row=row_idx, column=7, value=tc["steps"]).alignment = Alignment(vertical="top", wrap_text=True)
    ws2.cell(row=row_idx, column=8, value=tc["data"]).alignment = Alignment(vertical="top", wrap_text=True)
    ws2.cell(row=row_idx, column=9, value=tc["expected"]).alignment = Alignment(vertical="top", wrap_text=True)
    
    # Priority Cell
    p_cell = ws2.cell(row=row_idx, column=10, value=tc["priority"])
    p_cell.alignment = Alignment(horizontal="center", vertical="top")
    if tc["priority"] == "High":
        p_cell.fill = high_fill
    elif tc["priority"] == "Medium":
        p_cell.fill = med_fill
    else:
        p_cell.fill = low_fill

    ws2.cell(row=row_idx, column=11, value=tc["type"]).alignment = Alignment(horizontal="center", vertical="top")
    ws2.cell(row=row_idx, column=12, value="").alignment = Alignment(vertical="top") # Blank for Actual Result
    
    s_cell = ws2.cell(row=row_idx, column=13, value="Belum Diuji") # Default Status
    s_cell.alignment = Alignment(horizontal="center", vertical="top")
    
    for c in range(1, 14):
        ws2.cell(row=row_idx, column=c).font = regular_font
        ws2.cell(row=row_idx, column=c).border = thin_border

    ws2.row_dimensions[row_idx].height = 70


# ==========================================
# SHEET 3: MATRIKS HAK AKSES (RBAC)
# ==========================================
ws3 = wb.create_sheet(title="Matriks Hak Akses (RBAC)")
ws3.views.sheetView[0].showGridLines = True

ws3.merge_cells("A1:E1")
ws3["A1"] = "MATRIKS HAK AKSES PENGGUNA (ROLE-BASED ACCESS CONTROL)"
ws3["A1"].font = title_font

ws3["A2"] = "Verifikasi Akses Fitur Aplikasi Berdasarkan Peran Pengguna"
ws3["A2"].font = subtitle_font

rbac_headers = ["No", "Fitur / Endpoint", "Role Admin", "Role Operator", "Pengunjung Publik (Tanpa Login)"]
for col_idx, h in enumerate(rbac_headers, 1):
    cell = ws3.cell(row=4, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = Alignment(horizontal="center", vertical="center")

rbac_rules = [
    (1, "Login Aplikasi Internal (/login)", "Ya", "Ya", "Ya (Akses Form Login)"),
    (2, "Manajemen Akun User (Buat, Reset, Nonaktifkan)", "Ya (Akses Penuh)", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (3, "Ganti Password Profil Sendiri (/profile)", "Ya", "Ya", "Tidak (401 Unauthorized)"),
    (4, "Kelola Master Produk & Bahan Baku (CRUD)", "Ya (Akses Penuh)", "Tidak (Hanya Lihat)", "Tidak (401 Unauthorized)"),
    (5, "Catat Penerimaan Bahan Baku", "Ya", "Ya", "Tidak (401 Unauthorized)"),
    (6, "Catat Saldo Awal Bahan Baku & Stok Awal Batch", "Ya (Wajib Alasan)", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (7, "Catat Produksi & Input Pemakaian Bahan", "Ya", "Ya", "Tidak (401 Unauthorized)"),
    (8, "Koreksi Catatan Produksi & Edit Batch Date", "Ya (Audit Trail)", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (9, "Penyesuaian Stok (Stock Adjustment / Opname)", "Ya (Positif/Negatif)", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (10, "Catat Penjualan & Alokasi Batch", "Ya", "Ya", "Tidak (401 Unauthorized)"),
    (11, "Pembatalan Transaksi Penjualan", "Ya (Wajib Alasan)", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (12, "Kelola & Terbitkan QR Traceability (Publish/Withdraw)", "Ya", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (13, "Lihat Dashboard Usaha & Laporan", "Ya", "Ya", "Tidak (401 Unauthorized)"),
    (14, "Akses Halaman Katalog Publik (/catalog)", "Ya", "Ya", "Ya (Publik)"),
    (15, "Scan QR Traceability Batch (/qr/:code)", "Ya", "Ya", "Ya (Publik - Hanya Data Terbit)")
]

for row_idx, data in enumerate(rbac_rules, 5):
    for col_idx, val in enumerate(data, 1):
        cell = ws3.cell(row=row_idx, column=col_idx, value=val)
        cell.font = regular_font
        cell.border = thin_border
        if col_idx in [1, 3, 4, 5]:
            cell.alignment = Alignment(horizontal="center")


# Auto-adjust column widths for all sheets
for ws in [ws1, ws2, ws3]:
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            val_str = str(cell.value or '')
            lines = val_str.split('\n')
            for l in lines:
                if len(l) > max_len:
                    max_len = len(l)
        if ws == ws2:
            widths = {
                'A': 16, 'B': 22, 'C': 22, 'D': 35,
                'E': 38, 'F': 32, 'G': 38, 'H': 32,
                'I': 38, 'J': 14, 'K': 22, 'L': 25, 'M': 15
            }
            ws.column_dimensions[col_letter].width = widths.get(col_letter, 20)
        elif ws == ws1:
            widths = {'A': 6, 'B': 38, 'C': 16, 'D': 22, 'E': 48}
            ws.column_dimensions[col_letter].width = widths.get(col_letter, 20)
        elif ws == ws3:
            widths = {'A': 6, 'B': 48, 'C': 25, 'D': 25, 'E': 32}
            ws.column_dimensions[col_letter].width = widths.get(col_letter, 20)

file_name = "Skenario_Testing_NutriLokal.xlsx"
wb.save(file_name)
print(f"File excel berhasil dikomputasi dan diperbarui dengan total {len(test_cases)} skenario testing: {file_name}")
