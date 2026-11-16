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
sub_header_fill = PatternFill(start_color="2F5597", end_color="2F5597", fill_type="solid")

thin_border_side = Side(border_style="thin", color="D9D9D9")
thin_border = Border(left=thin_border_side, right=thin_border_side, top=thin_border_side, bottom=thin_border_side)

# Fills for priority
high_fill = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid") # Soft Red/Orange
med_fill = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid") # Soft Yellow
low_fill = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid") # Soft Green

# Test cases data
test_cases = [
    # AUTH - Autentikasi & Manajemen Akun
    {
        "id": "TC-AUTH-001",
        "module": "Autentikasi & Akun",
        "submodule": "Login Internal",
        "title": "Login Berhasil dengan Hak Akses Admin",
        "desc": "Memastikan Admin dapat login dengan username & password valid dan diarahkan ke Dashboard dengan menu Admin lengkap",
        "pre": "Akun Admin terdaftar di database dan berstatus aktif (isActive = true)",
        "steps": "1. Buka halaman login (/login)\n2. Masukkan username Admin valid\n3. Masukkan password valid\n4. Klik tombol 'Masuk'",
        "data": "Username: admin, Password: [password_valid]",
        "expected": "Login berhasil, JWT token disimpan di localStorage, aplikasi redirect ke Dashboard (/dashboard), menu Admin muncul",
        "priority": "High",
        "type": "Positif"
    },
    {
        "id": "TC-AUTH-002",
        "module": "Autentikasi & Akun",
        "submodule": "Login Internal",
        "title": "Login Berhasil dengan Hak Akses Operator",
        "desc": "Memastikan Operator dapat login dan mendapatkan akses terbatas (menu spesifik Admin disembunyikan)",
        "pre": "Akun Operator terdaftar di database dan berstatus aktif (isActive = true)",
        "steps": "1. Buka halaman login (/login)\n2. Masukkan username Operator valid\n3. Masukkan password valid\n4. Klik tombol 'Masuk'",
        "data": "Username: operator1, Password: [password_valid]",
        "expected": "Login berhasil, redirect ke Dashboard, menu Khusus Admin (Penyesuaian Stok, Kelola Pengguna, Koreksi Produksi) tidak tampil",
        "priority": "High",
        "type": "Positif"
    },
    {
        "id": "TC-AUTH-003",
        "module": "Autentikasi & Akun",
        "submodule": "Login Internal",
        "title": "Login Gagal - Password Salah",
        "desc": "Memastikan sistem menolak autentikasi jika kata sandi tidak cocok dan menampilkan pesan error",
        "pre": "Username terdaftar",
        "steps": "1. Buka halaman login (/login)\n2. Masukkan username valid\n3. Masukkan password yang salah\n4. Klik tombol 'Masuk'",
        "data": "Username: admin, Password: wrongpassword123",
        "expected": "Login gagal, respons HTTP 401, pesan error 'Username atau password salah' ditampilkan di UI",
        "priority": "High",
        "type": "Negatif"
    },
    {
        "id": "TC-AUTH-004",
        "module": "Autentikasi & Akun",
        "submodule": "Login Internal",
        "title": "Login Gagal - Akun Dinonaktifkan (Disabled)",
        "desc": "Memastikan pengguna yang status akunnya nonaktif tidak dapat masuk ke sistem",
        "pre": "Akun pengguna memiliki isActive = false di database",
        "steps": "1. Masukkan username pengguna nonaktif\n2. Masukkan password yang benar\n3. Klik 'Masuk'",
        "data": "Username: operator_nonaktif, Password: [password_valid]",
        "expected": "Login ditolak, respons HTTP 403, pesan 'Akun dinonaktifkan. Hubungi Admin.' muncul",
        "priority": "High",
        "type": "Negatif & Keamanan"
    },
    {
        "id": "TC-AUTH-005",
        "module": "Autentikasi & Akun",
        "submodule": "Manajemen Akun",
        "title": "Wajib Ganti Password Setelah Reset Admin",
        "desc": "Pengguna yang kata sandinya di-reset oleh Admin dipaksa mengganti kata sandi baru saat login pertama",
        "pre": "Admin telah melakukan reset password user (mustChangePassword = true)",
        "steps": "1. User login dengan password temporer dari Admin\n2. Sistem mendeteksi mustChangePassword = true\n3. Coba navigasi ke menu lain tanpa mengganti password",
        "data": "Password Temporer: Temp123456",
        "expected": "Sistem memblokir navigasi dan menampilkan modal/form 'Wajib Ganti Kata Sandi' sebelum bisa menggunakan aplikasi",
        "priority": "High",
        "type": "Positif & Keamanan"
    },
    {
        "id": "TC-AUTH-006",
        "module": "Autentikasi & Akun",
        "submodule": "Manajemen Akun",
        "title": "Tambah Akun Operator Baru oleh Admin",
        "desc": "Memastikan Admin dapat membuat akun Operator baru dengan username unik",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka menu Pengelolaan Pengguna (/users)\n2. Klik 'Tambah Pengguna'\n3. Isi nama, username unik, password awal, role Operator\n4. Klik 'Simpan'",
        "data": "Nama: Siti, Username: siti_operator, Role: OPERATOR",
        "expected": "Akun berhasil dibuat, password di-hash dengan bcrypt di DB, akun baru dapat digunakan untuk login",
        "priority": "Medium",
        "type": "Positif"
    },
    {
        "id": "TC-AUTH-007",
        "module": "Autentikasi & Akun",
        "submodule": "Manajemen Akun",
        "title": "Mencegah Hapus Permanen Akun Ber-Riwayat (Soft Delete / Disable)",
        "desc": "Memastikan akun yang memiliki riwayat aktivitas tidak dihapus permanen, melainkan dinonaktifkan",
        "pre": "Akun Operator 'budi_op' telah mencatat penerimaan/produksi",
        "steps": "1. Admin memilih aksi nonaktifkan pada akun 'budi_op'\n2. Cek database tabel users dan riwayat pencatatan lama",
        "data": "User: budi_op (ID: user_123)",
        "expected": "Field isActive berubah menjadi false. Riwayat transaksi lama tetap menampilkan nama 'budi_op' sebagai pencatat",
        "priority": "High",
        "type": "Integritas Data"
    },

    # MST - Master Data
    {
        "id": "TC-MST-001",
        "module": "Master Data",
        "submodule": "Master Produk",
        "title": "Tambah Master Produk Baru & Upload Foto",
        "desc": "Memastikan Admin dapat menambahkan master produk baru beserta satuan dasar, harga jual, dan foto",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka Master Produk (/products)\n2. Klik 'Tambah Produk'\n3. Isi Nama: Keripik Pisang Original, Satuan: pcs, Harga: 15.000, Deskripsi, Komposisi, Petunjuk Simpan\n4. Upload foto produk (.png/.jpg)\n5. Klik Simpan",
        "data": "Nama: Keripik Pisang Original, Satuan: pcs, SellingPrice: 15000",
        "expected": "Produk berhasil tersimpan, photoUrl dan photoPublicId terisi (Cloudinary/local), produk tampil di daftar produk aktif",
        "priority": "High",
        "type": "Positif"
    },
    {
        "id": "TC-MST-002",
        "module": "Master Data",
        "submodule": "Master Bahan Baku",
        "title": "Tambah Master Bahan Baku & Unique Name Key Check",
        "desc": "Memastikan nama bahan baku bersifat unik di database (case-insensitive & trim space)",
        "pre": "Login sebagai Admin",
        "steps": "1. Buat bahan baku 'Pisang Kepok' (satuan: kg)\n2. Buat bahan baku baru dengan nama '  pisang kepok  '",
        "data": "Bahan 1: 'Pisang Kepok', Bahan 2: '  pisang kepok  '",
        "expected": "Bahan 1 berhasil dibuat (nameKey='pisangkepok'). Bahan 2 DITOLAK constraint database / API error 'Nama bahan baku sudah ada'",
        "priority": "High",
        "type": "Negatif & Validation"
    },
    {
        "id": "TC-MST-003",
        "module": "Master Data",
        "submodule": "Master Produk",
        "title": "Hapus Produk Tanpa Riwayat vs Nonaktifkan Produk Ber-Riwayat",
        "desc": "Produk tanpa riwayat boleh dihapus permanen, produk ber-riwayat hanya bisa dinonaktifkan",
        "pre": "Produk A (baru dibuat, belum ada batch/produksi) & Produk B (sudah pernah dijual/diproduksi)",
        "steps": "1. Coba hapus Produk A -> Cek respons\n2. Coba hapus Produk B -> Cek respons",
        "data": "Produk A (No history), Produk B (Has history)",
        "expected": "Produk A berhasil dihapus dari DB. Produk B DITOLAK untuk dihapus, UI hanya menyediakan opsi Nonaktifkan (isActive = false)",
        "priority": "High",
        "type": "Integritas Data"
    },
    {
        "id": "TC-MST-004",
        "module": "Master Data",
        "submodule": "Resep Produk",
        "title": "Pengaturan Resep Standar Produk",
        "desc": "Admin menentukan bahan baku pendukung dan takaran standar per 1 unit produk",
        "pre": "Master Produk dan Master Bahan Baku sudah tersedia",
        "steps": "1. Buka detail Produk 'Keripik Pisang Original'\n2. Tambahkan komponen resep: Pisang Kepok (0.5 kg) & Minyak Goreng (0.1 liter)\n3. Simpan Resep",
        "data": "Komposisi Resep: 0.5 kg Pisang + 0.1 L Minyak per 1 pcs",
        "expected": "Resep tersimpan di ProductRecipeItem, menjadi acuan perkiraan pemakaian bahan pada form produksi",
        "priority": "Medium",
        "type": "Positif"
    },

    # MAT - Bahan Baku & Penerimaan
    {
        "id": "TC-MAT-001",
        "module": "Stok Bahan Baku",
        "submodule": "Penerimaan Bahan",
        "title": "Catat Penerimaan Bahan Baku Valid",
        "desc": "Pencatatan penerimaan bahan baku dari supplier menambah total stok bahan baku secara otomatis",
        "pre": "Master bahan baku 'Pisang Kepok' aktif (Stok awal = 0 kg)",
        "steps": "1. Buka menu Penerimaan Bahan Baku (/materials/receipts)\n2. Pilih Bahan Baku: Pisang Kepok, Quantity: 50 kg, Tanggal Penerimaan: Hari Ini\n3. Simpan",
        "data": "Material: Pisang Kepok, Quantity: 50, ReceivedAt: Today",
        "expected": "Data penerimaan tersimpan, MaterialStock untuk Pisang Kepok bertambah menjadi 50 kg, MaterialStockMovement tipe RECEIPT tercatat",
        "priority": "High",
        "type": "Positif"
    },
    {
        "id": "TC-MAT-002",
        "module": "Stok Bahan Baku",
        "submodule": "Saldo Awal Bahan",
        "title": "Catat Saldo Awal Bahan Baku oleh Admin (Wajib Alasan)",
        "desc": "Admin mencatat saldo awal bahan baku terpisah dari penerimaan biasa dan wajib menyertakan alasan",
        "pre": "Login sebagai Admin",
        "steps": "1. Buka menu Saldo Awal Bahan Baku\n2. Input Bahan Baku: Gula Pasir, Qty: 25 kg, Tanggal: 2026-10-01\n3. Coba simpan tanpa mengisi Alasan -> Cek error\n4. Isi Alasan: 'Stok Opname Awal Usaha' -> Simpan",
        "data": "Material: Gula Pasir, Qty: 25 kg, Reason: Stok Opname Awal",
        "expected": "Simpan tanpa alasan DITOLAK. Setelah mengisi alasan, saldo awal tersimpan, stok bertambah +25 kg (Tipe: OPENING_BALANCE)",
        "priority": "High",
        "type": "Validation & Positif"
    },
    {
        "id": "TC-MAT-003",
        "module": "Stok Bahan Baku",
        "submodule": "Idempotency Control",
        "title": "Verifikasi Idempotency (Pencegahan Double Submission)",
        "desc": "Memastikan request penerimaan bahan baku dengan Idempotency-Key sama tidak menambah stok dua kali",
        "pre": "Klien mengirim header Idempotency-Key",
        "steps": "1. Kirim request POST penerimaan bahan baku 10 kg dengan Idempotency-Key 'IDEM-999'\n2. Kirim ulang request identik dengan Idempotency-Key 'IDEM-999'",
        "data": "Idempotency Key: IDEM-999, Qty: 10 kg",
        "expected": "Request 1 berhasil (+10 kg stok). Request 2 mengembalikan hasil dari cache tanpa menambah stok lagi (+0 kg)",
        "priority": "High",
        "type": "Keamanan & Race Condition"
    },

    # PROD - Produksi & Kode Batch
    {
        "id": "TC-PROD-001",
        "module": "Produksi & Batch",
        "submodule": "Pencatatan Produksi",
        "title": "Pencatatan Produksi Selesai Valid (Transaksi Database Atomik)",
        "desc": "Mencatat produksi selesai, mengurangi stok bahan baku sesuai pemakaian aktual, dan menambah stok batch produk jadi",
        "pre": "Stok Pisang Kepok = 50 kg, Stok Minyak = 10 L",
        "steps": "1. Buka Form Produksi Baru (/productions/new)\n2. Pilih Produk: Keripik Pisang Original\n3. Input Tanggal Produksi: 2026-10-16, Hasil Yield: 100 pcs\n4. Pemakaian Aktual: Pisang Kepok = 30 kg, Minyak = 5 L\n5. Simpan Produksi",
        "data": "Yield: 100 pcs, Pemakaian: Pisang 30 kg, Minyak 5 L",
        "expected": "1. Catatan produksi tersimpan\n2. Stok Pisang berkurang 30 kg (sisa 20 kg), Minyak berkurang 5 L (sisa 5 L)\n3. Batch dibuat dengan kode 'NL-20261016-001' & stok batch = 100 pcs",
        "priority": "High",
        "type": "Positif & Atomik"
    },
    {
        "id": "TC-PROD-002",
        "module": "Produksi & Batch",
        "submodule": "Pencatatan Produksi",
        "title": "Produksi Ditolak - Stok Bahan Baku Tidak Mencukupi",
        "desc": "Memastikan sistem menolak produksi jika pemakaian bahan baku melebihi stok bahan baku yang tersedia",
        "pre": "Stok Gula Pasir = 3 kg",
        "steps": "1. Input produksi dengan pemakaian Gula Pasir = 10 kg\n2. Klik Simpan Produksi",
        "data": "Pemakaian Gula: 10 kg (Stok tersedia: 3 kg)",
        "expected": "Produksi DITOLAK dengan pesan 'Stok bahan baku [Gula Pasir] tidak mencukupi'. Tidak ada stok bahan atau batch yang berubah.",
        "priority": "High",
        "type": "Negatif & Boundary"
    },
    {
        "id": "TC-PROD-003",
        "module": "Produksi & Batch",
        "submodule": "Pencatatan Produksi",
        "title": "Validasi Tanggal Produksi Masa Depan Ditolak",
        "desc": "Memastikan tanggal produksi sebenarnya tidak boleh diisi tanggal di masa depan",
        "pre": "Tanggal hari ini: 2026-11-16",
        "steps": "1. Input tanggal produksi: 2026-11-25 (Masa Depan)\n2. Klik Simpan Produksi",
        "data": "ProductionDate: 2026-11-25",
        "expected": "Pencatatan ditolak, error validation 'Tanggal produksi tidak boleh berada di masa depan'",
        "priority": "High",
        "type": "Negatif & Validation"
    },
    {
        "id": "TC-PROD-004",
        "module": "Produksi & Batch",
        "submodule": "Pencatatan Produksi",
        "title": "Pencatatan Produksi Mundur (Backdated)",
        "desc": "Memastikan sistem mendukung pencatatan produksi tanggal lampau dan penomoran urut batch tetap konsisten",
        "pre": "Sudah ada batch NL-20261015-001",
        "steps": "1. Input tanggal produksi mundur: 2026-10-15\n2. Simpan Catatan Produksi",
        "data": "ProductionDate: 2026-10-15",
        "expected": "Produksi tersimpan, kode batch otomatis mendapatkan nomor urut berikutnya 'NL-20261015-002'",
        "priority": "Medium",
        "type": "Positif"
    },
    {
        "id": "TC-PROD-005",
        "module": "Produksi & Batch",
        "submodule": "Stok Awal Batch",
        "title": "Catat Stok Awal Batch Tanpa Tanggal Produksi (NL-OPEN)",
        "desc": "Admin mencatat stok awal produk jadi per batch yang tanggal produksinya tidak diketahui",
        "pre": "Login sebagai Admin",
        "steps": "1. Masuk menu Stok Awal Produk Jadi\n2. Pilih Produk: Keripik Pisang, Qty: 40 pcs, Tanggal Produksi: Kosong, Tanggal Pencatatan: 2026-10-20\n3. Simpan",
        "data": "Qty: 40 pcs, productionDate: null",
        "expected": "Batch terbuat dengan kode 'NL-OPEN-20261020-001', productionDate = null, status riwayat terbatas",
        "priority": "Medium",
        "type": "Positif"
    },
    {
        "id": "TC-PROD-006",
        "module": "Produksi & Batch",
        "submodule": "Koreksi Produksi",
        "title": "Koreksi Catatan Produksi & Pembentukan Alias Batch",
        "desc": "Admin mengedit tanggal produksi pada catatan produksi lama. Sistem memperbarui kode batch dan membuat alias batch lama",
        "pre": "Batch NL-20261016-001 terdaftar",
        "steps": "1. Admin edit catatan produksi: ubah tanggal dari 2026-10-16 menjadi 2026-10-17\n2. Simpan Koreksi",
        "data": "Old Date: 2026-10-16 -> New Date: 2026-10-17",
        "expected": "1. Kode batch utama diperbarui menjadi NL-20261017-001\n2. Kode lama NL-20261016-001 masuk ke BatchAlias\n3. Record ProductionCorrection dibuat",
        "priority": "High",
        "type": "Positif & Audit Trail"
    },

    # STK - Stok Produk Jadi & Penyesuaian
    {
        "id": "TC-STK-001",
        "module": "Stok & Penyesuaian",
        "submodule": "Monitoring Stok",
        "title": "Konsistensi Total Stok Produk vs Sum Stok Per Batch",
        "desc": "Memastikan total stok produk pada katalog/master selalu presisi sama dengan jumlah stok seluruh batch produk tersebut",
        "pre": "Batch 001 (stok 50) dan Batch 002 (stok 30)",
        "steps": "1. Buka menu Stok Produk Jadi (/stock)\n2. Periksa Total Stok Produk A",
        "data": "Batch 001 = 50, Batch 002 = 30",
        "expected": "Total stok Produk A bernilai 80 pcs secara persis",
        "priority": "High",
        "type": "Integritas Data"
    },
    {
        "id": "TC-STK-002",
        "module": "Stok & Penyesuaian",
        "submodule": "Penyesuaian Stok",
        "title": "Penyesuaian Stok Positif & Negatif oleh Admin Valid",
        "desc": "Admin melakukan penyesuaian stok (opname/barang rusak) dengan menginput nilai bertanda (+/-) dan alasan",
        "pre": "Stok Batch NL-20261016-001 = 100 pcs",
        "steps": "1. Admin kurangi stok batch -5 pcs (Alasan: Kemasan Bocor saat Penyimpanan)\n2. Admin tambah stok bahan baku +2 kg (Alasan: Hasil Stock Opname Fisik)",
        "data": "Batch Adjustment: -5, Material Adjustment: +2",
        "expected": "Stok batch menjadi 95 pcs, stok bahan bertambah +2 kg. Record StockAdjustment & Movement tercatat lengkap dengan admin pencatat",
        "priority": "High",
        "type": "Positif & Audit Trail"
    },
    {
        "id": "TC-STK-003",
        "module": "Stok & Penyesuaian",
        "submodule": "Penyesuaian Stok",
        "title": "Penyesuaian Stok Penyebab Stok Negatif DITOLAK",
        "desc": "Memastikan penyesuaian stok yang mengakibatkan stok akhir < 0 ditolak oleh backend",
        "pre": "Stok Batch NL-20261016-001 = 10 pcs",
        "steps": "1. Admin input penyesuaian stok sebesar -15 pcs\n2. Klik Simpan Penyesuaian",
        "data": "Stok Ada: 10, Adjustment: -15",
        "expected": "Penyesuaian DITOLAK dengan error 'Penyesuaian dibatalkan: Stok akhir tidak boleh negatif'",
        "priority": "High",
        "type": "Negatif & Boundary"
    },

    # SALE - Penjualan & Pembatalan
    {
        "id": "TC-SALE-001",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pencatatan Penjualan",
        "title": "Transaksi Penjualan Multi-Item & Multi-Batch Valid",
        "desc": "Operator mencatat penjualan dengan memilih alokasi batch secara manual, harga otomatis dihitung backend dari master produk",
        "pre": "Batch A (Stok 50), Harga Master = Rp 15.000",
        "steps": "1. Buka Form Penjualan (/sales/new)\n2. Pilih Produk A, Qty: 20 pcs -> Alokasikan dari Batch A (20 pcs)\n3. Cek total harga dihitung backend (20 x Rp 15.000 = Rp 300.000)\n4. Simpan Transaksi",
        "data": "Product A: 20 pcs (Batch A: 20 pcs)",
        "expected": "Transaksi tersimpan, Stok Batch A berkurang dari 50 menjadi 30 pcs, Total Rp 300.000 tercatat dalam omzet",
        "priority": "High",
        "type": "Positif & Atomik"
    },
    {
        "id": "TC-SALE-002",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pencatatan Penjualan",
        "title": "Penjualan Ditolak - Stok Batch Tidak Mencukupi",
        "desc": "Memastikan jika salah satu alokasi batch melebihi stok yang ada, seluruh transaksi ditolak",
        "pre": "Stok Batch A = 10 pcs",
        "steps": "1. Input alokasi penjualan dari Batch A sebesar 15 pcs\n2. Simpan Transaksi",
        "data": "Alokasi Batch A: 15 pcs (Stok: 10 pcs)",
        "expected": "Transaksi DITOLAK total. Tidak ada transaksi parsial dan stok tidak berubah.",
        "priority": "High",
        "type": "Negatif & Integrity"
    },
    {
        "id": "TC-SALE-003",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pencatatan Penjualan",
        "title": "Penjualan Ditolak - Batch Kedaluwarsa & Tervalidasi",
        "desc": "Memastikan batch yang tanggal kedaluwarsanya sudah lewat dan tervalidasi ditolak saat transaksi penjualan",
        "pre": "Batch B expiryDate = 2026-10-01 (Masa Lalu) & expiryValidatedAt != null",
        "steps": "1. Operator pilih Batch B untuk transaksi penjualan hari ini (2026-11-16)\n2. Simpan Transaksi",
        "data": "Batch Expired: 2026-10-01 (Validated)",
        "expected": "Transaksi DITOLAK dengan pesan 'Batch [Kode] telah kedaluwarsa dan tidak dapat dijual'",
        "priority": "High",
        "type": "Negatif & Validation"
    },
    {
        "id": "TC-SALE-004",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pembatalan Penjualan",
        "title": "Pembatalan Transaksi Penjualan oleh Admin (Return Stok)",
        "desc": "Admin membatalkan transaksi penjualan dengan alasan. Stok dikembalikan ke batch asal dan omzet berkurang",
        "pre": "Transaksi TRX-001 aktif (mengurangi Batch A sebesar 20 pcs)",
        "steps": "1. Admin buka detail TRX-001 (/sales/TRX-001)\n2. Klik 'Batalkan Transaksi'\n3. Masukkan Alasan: 'Pelanggan Membatalkan Transaksi'\n4. Konfirmasi Pembatalan",
        "data": "TRX ID: TRX-001, Reason: Cancel Customer",
        "expected": "1. Transaksi ditandai batal (cancelledAt & cancelledById terisi)\n2. Stok Batch A otomatis dikembalikan +20 pcs\n3. Omzet laporan berkurang sejumlah nominal TRX-001",
        "priority": "High",
        "type": "Positif & Atomik"
    },
    {
        "id": "TC-SALE-005",
        "module": "Penjualan & Pembatalan",
        "submodule": "Pembatalan Penjualan",
        "title": "Pencegahan Pembatalan Ganda (Double Cancellation)",
        "desc": "Memastikan transaksi yang sudah dibatalkan tidak dapat dibatalkan kembali (mencegah pengembalian stok ganda)",
        "pre": "Transaksi TRX-001 status sudah BATAL",
        "steps": "1. Kirim ulang request pembatalan API untuk TRX-001",
        "data": "TRX ID: TRX-001 (Status: Batal)",
        "expected": "Request DITOLAK dengan error 'Transaksi ini sudah dibatalkan sebelumnya'. Stok tidak berubah.",
        "priority": "High",
        "type": "Keamanan & Integritas Data"
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
        "priority": "High",
        "type": "Positif & Public Access"
    },
    {
        "id": "TC-QR-002",
        "module": "Katalog & QR",
        "submodule": "Manajemen QR",
        "title": "Siklus Publikasi QR: Validasi -> Terbit -> Penarikan (Withdrawn)",
        "desc": "Admin mengelola publikasi QR. Jika ditarik, QR publik hanya menampilkan pemberitahuan tanpa data internal",
        "pre": "Batch baru dibuat",
        "steps": "1. Admin klik 'Validasi' -> Status Validated\n2. Admin klik 'Terbitkan' -> Status Published\n3. Admin klik 'Tarik Informasi' -> Status Withdrawn\n4. Akses URL publik /qr/:code setelah ditarik",
        "data": "Batch ID: [batch_id]",
        "expected": "Saat ditarik, halaman publik menampilkan notifikasi 'Informasi publik untuk batch ini tidak tersedia / ditarik'. Tidak ada data internal yang bocor.",
        "priority": "High",
        "type": "Positif & Keamanan"
    },
    {
        "id": "TC-QR-003",
        "module": "Katalog & QR",
        "submodule": "Alias Batch QR",
        "title": "Akses QR Menggunakan Kode Batch Alias Lama",
        "desc": "Memastikan QR Code pada kemasan lama yang dicetak dengan kode alias tetap mengarah ke data batch terkoreksi",
        "pre": "Kode lama NL-20261016-001 telah menjadi Alias dari NL-20261017-001",
        "steps": "1. Akses URL publik /qr/NL-20261016-001 (Kode Alias)",
        "data": "Code: NL-20261016-001 (Alias)",
        "expected": "Halaman publik sukses menampilkan data batch utama (NL-20261017-001) tanpa error 404.",
        "priority": "Medium",
        "type": "Positif"
    },

    # DASH - Dashboard & Laporan
    {
        "id": "TC-DASH-001",
        "module": "Dashboard & Laporan",
        "submodule": "Kalkulasi Omzet",
        "title": "Akurasi Total Omzet Dashboard (Eksklusi Transaksi Batal)",
        "desc": "Memastikan kartu Total Omzet di Dashboard hanya menghitung transaksi penjualan yang aktif",
        "pre": "Transaksi 1: Rp 100.000 (Aktif), Transaksi 2: Rp 50.000 (Batal)",
        "steps": "1. Buka Halaman Dashboard (/dashboard)\n2. Periksa statistik Total Omzet",
        "data": "TRX 1 = 100.000, TRX 2 = 50.000 (Batal)",
        "expected": "Total Omzet bernilai tepat Rp 100.000 (Nominal transaksi batal Rp 50.000 dikeluarkan dari hitungan)",
        "priority": "High",
        "type": "Positif & Kalkulasi"
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
        "priority": "Medium",
        "type": "Positif"
    },

    # SEC - Keamanan & Hak Akses (RBAC)
    {
        "id": "TC-SEC-001",
        "module": "Keamanan & RBAC",
        "submodule": "Akses Kontrol (Authorization)",
        "title": "Proteksi Backend Endpoint Admin dari Role Operator",
        "desc": "Memastikan backend menolak request ke endpoint Admin (misal Penyesuaian Stok/Reset User) jika dikirim oleh Operator",
        "pre": "Login sebagai Operator (JWT Token Operator active)",
        "steps": "1. Kirim request HTTP POST ke `/api/stock-adjustments` dengan Header Token Operator\n2. Kirim request HTTP POST ke `/api/users/reset-password` dengan Header Token Operator",
        "data": "Role: OPERATOR, Admin-only Endpoints",
        "expected": "Backend merespon HTTP 403 Forbidden dengan pesan 'Akses ditolak. Hak akses Admin diperlukan.'",
        "priority": "High",
        "type": "Keamanan (Security)"
    },
    {
        "id": "TC-SEC-002",
        "module": "Keamanan & RBAC",
        "submodule": "Akses Kontrol (Authorization)",
        "title": "Proteksi API Endpoint Internal dari Akses Unauthenticated",
        "desc": "Memastikan endpoint internal tidak dapat diakses tanpa token JWT yang valid",
        "pre": "Tanpa header Authorization Token",
        "steps": "1. Kirim request HTTP GET ke `/api/products` tanpa token\n2. Kirim request dengan token expired / invalid",
        "data": "Header Authorization: None / Invalid",
        "expected": "Backend merespon HTTP 401 Unauthorized",
        "priority": "High",
        "type": "Keamanan (Security)"
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
    ("Total Skenario / Test Cases", f"=COUNTA('Detail Skenario Testing'!A{start_tc_row}:A{end_tc_row})", "100%", "Siap Diuji (Ready)", "Mencakup seluruh alur bisnis V1.0"),
    ("Prioritas High (Kritis)", f"=COUNTIF('Detail Skenario Testing'!J{start_tc_row}:J{end_tc_row}, \"High\")", f"=B7/B6", "Prioritas Utama", "Fokus utama pada alur core transaksi & stok"),
    ("Prioritas Medium (Sedang)", f"=COUNTIF('Detail Skenario Testing'!J{start_tc_row}:J{end_tc_row}, \"Medium\")", f"=B8/B6", "Prioritas Kedua", "Fokus pada fitur pendukung & filter"),
    ("Prioritas Low (Rendah)", f"=COUNTIF('Detail Skenario Testing'!J{start_tc_row}:J{end_tc_row}, \"Low\")", f"=B9/B6", "Prioritas Ketiga", "Fokus pada aksesoris UI & opsional"),
    ("Pengujian Keamanan & RBAC", f"=COUNTIF('Detail Skenario Testing'!K{start_tc_row}:K{end_tc_row}, \"*Keamanan*\")", f"=B10/B6", "Proteksi Access", "Memastikan backend & role enforcement"),
    ("Pengujian Atomik & Integritas Data", f"=COUNTIF('Detail Skenario Testing'!K{start_tc_row}:K{end_tc_row}, \"*Atomik*\") + COUNTIF('Detail Skenario Testing'!K{start_tc_row}:K{end_tc_row}, \"*Integritas*\")", f"=B11/B6", "Korektansi Ledger", "Pencegahan stok negatif & double count")
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
    (1, "Autentikasi & Pengelolaan Akun", "AUTH", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Autentikasi*\")", "Login Admin/Op, Password Reset, Hak Akses, Akun Nonaktif"),
    (2, "Master Produk & Bahan Baku", "MST", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Master Data*\")", "Master Produk, Master Bahan, Resep, Soft Delete / Nonaktif"),
    (3, "Stok Bahan Baku & Penerimaan", "MAT", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Stok Bahan Baku*\")", "Penerimaan Bahan, Saldo Awal, Idempotency Double-Click"),
    (4, "Produksi & Kode Batch", "PROD", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Produksi*\")", "Transaksi Atomik, Format NL-YYYYMMDD-NNN, Backdate, Koreksi & Alias"),
    (5, "Stok Produk Jadi & Penyesuaian", "STK", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Stok & Penyesuaian*\")", "Opname Admin, Pencegahan Stok Negatif, Retur Barang"),
    (6, "Penjualan & Pembatalan Transaksi", "SALE", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Penjualan*\")", "Alokasi Batch, Cek Expired, Pembatalan Admin & Return Stok"),
    (7, "Katalog Digital & QR Traceability", "QR", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Katalog*\")", "Public Scan, Status Validated/Published/Withdrawn, Support Alias"),
    (8, "Dashboard & Laporan Usaha", "DASH", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Dashboard*\")", "Akurasi Omzet Non-Batal, Filter Date Range Laporan"),
    (9, "Keamanan & Akses Kontrol (RBAC)", "SEC", f"=COUNTIF('Detail Skenario Testing'!B{start_tc_row}:B{end_tc_row}, \"*Keamanan*\")", "Validasi Role Backend 403, Endpoint Protection 401, Sanitisasi")
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
    (3, "Kelola Master Produk & Bahan Baku (CRUD)", "Ya (Akses Penuh)", "Tidak (Hanya Lihat)", "Tidak (401 Unauthorized)"),
    (4, "Catat Penerimaan Bahan Baku", "Ya", "Ya", "Tidak (401 Unauthorized)"),
    (5, "Catat Saldo Awal Bahan Baku & Stok Awal Batch", "Ya (Wajib Alasan)", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (6, "Catat Produksi & Input Pemakaian Bahan", "Ya", "Ya", "Tidak (401 Unauthorized)"),
    (7, "Koreksi Catatan Produksi & Edit Batch Date", "Ya (Audit Trail)", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (8, "Penyesuaian Stok (Stock Adjustment / Opname)", "Ya (Positif/Negatif)", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (9, "Catat Penjualan & Alokasi Batch", "Ya", "Ya", "Tidak (401 Unauthorized)"),
    (10, "Pembatalan Transaksi Penjualan", "Ya (Wajib Alasan)", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (11, "Kelola & Terbitkan QR Traceability (Publish/Withdraw)", "Ya", "Tidak (403 Forbidden)", "Tidak (401 Unauthorized)"),
    (12, "Lihat Dashboard Usaha & Laporan", "Ya", "Ya", "Tidak (401 Unauthorized)"),
    (13, "Akses Halaman Katalog Publik (/catalog)", "Ya", "Ya", "Ya (Publik)"),
    (14, "Scan QR Traceability Batch (/qr/:code)", "Ya", "Ya", "Ya (Publik - Hanya Data Terbit)")
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
print(f"File excel berhasil dikomputasi dan diperbarui: {file_name}")
