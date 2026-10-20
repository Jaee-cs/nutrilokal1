# Deploy NutriLokal untuk Testing (Neon + Render)

Panduan ini menyiapkan versi **testing** NutriLokal agar dapat diakses dosen
dan teman lewat internet, memakai:

- **Neon** — database PostgreSQL gratis (terpisah dari data dev lokal).
- **Render** — hosting backend (Web Service) + frontend (Static Site).

Semua langkah dilakukan lewat browser. Tidak ada perintah yang harus dijalankan
di komputer Anda selain meng-commit & push perubahan.

> Ringkasan arsitektur:
> ```
> Pengunjung → Frontend (Render Static Site)  →  Backend (Render Web Service)  →  Neon Postgres
>              https://nutrilokal-frontend.onrender.com   https://nutrilokal-backend.onrender.com
> ```

---

## 0. Prasyarat

1. Akun **GitHub** dengan repositori proyek ini (sudah ada).
2. Akun **Render** (daftar gratis dengan akun GitHub).
3. Akun **Neon** (daftar gratis dengan akun GitHub/Google).
4. Perubahan kode terbaru (CORS + `render.yaml`) sudah di-push ke GitHub.

Push dilakukan dari komputer Anda:

```bash
cd "/Users/jay/nutrilokal pribadi"
git push origin <nama-branch-anda>
```

---

## 1. Siapkan database di Neon

1. Buka <https://console.neon.tech> lalu **Sign up / Sign in**.
2. Klik **Create project**.
   - **Name**: `nutrilokal-testing`
   - **Postgres version**: bawaan (16) — boleh dibiarkan.
   - **Region**: pilih **Singapore** (paling dekat ke Indonesia) atau wilayah
     terdekat.
3. Setelah proyek dibuat, buka halaman **Connection string / Dashboard**.
4. Pilih **Connection string** dengan format **Prisma** atau **Node.js**.
   Salin nilainya. Bentuknya kira-kira:
   ```
   postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/nutrilokal_testing?sslmode=require
   ```
   - Pastikan ada `?sslmode=require` (Neon mewajibkan SSL).
   - Simpan string ini sebagai **DATABASE_URL** untuk langkah Render.
5. **Jangan** pakai database dev lokal Anda — Neon ini khusus testing, jadi
   data asli "Keripik Singkong" & "Singkong" tetap aman.

> Catatan: Neon free tier bisa "auto-suspend" saat tidak dipakai; request
> pertama setelah lama idle akan sedikit lambat (bangun koneksi). Ini normal.

---

## 2. Deploy backend di Render

1. Buka <https://dashboard.render.com> → **New +** → **Web Service**.
2. Hubungkan repositori GitHub proyek ini.
3. Isi konfigurasi:

   | Kolom | Nilai |
   |---|---|
   | **Name** | `nutrilokal-backend` |
   | **Region** | Singapore (samakan dengan Neon bila bisa) |
   | **Branch** | branch yang Anda push |
   | **Root Directory** | `backend` |
   | **Runtime** | Node |
   | **Build Command** | `npm ci && npx prisma generate && npm run build` |
   | **Start Command** | `npx prisma migrate deploy && node dist/server.js` |
   | **Instance Type** | Free (atau Starter berbayar bila ingin Disk, lihat §4) |

   > Bila memakai **Blueprint** (`render.yaml`), Render dapat mengisi otomatis.
   > Pilih **New + → Blueprint** lalu arahkan ke repositori; konfigurasi terisi.

4. Tambahkan **Environment Variables** (klik *Advanced* → *Add Environment
   Variable*):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | connection string Neon dari langkah 1 |
   | `JWT_SECRET` | hasil `openssl rand -hex 32` (buat nilai acak baru) |
   | `FRONTEND_ORIGIN` | sementara isi `http://localhost:5173` — **akan diperbarui di §3.5** |
   | `NODE_VERSION` | `20` |

   Buat `JWT_SECRET` acak di komputer Anda:
   ```bash
   openssl rand -hex 32
   ```

5. Klik **Create Web Service**. Tunggu build & deploy selesai.
6. Setelah live, buka:
   ```
   https://nutrilokal-backend.onrender.com/api/health
   ```
   Harus muncul `{"status":"ok",...,"database":"up"}`. Bila `database` bukan
   `up`, periksa `DATABASE_URL` (pastikan ada `?sslmode=require`).

---

## 3. Deploy frontend di Render

1. **New +** → **Static Site**.
2. Hubungkan repositori yang sama.
3. Isi konfigurasi:

   | Kolom | Nilai |
   |---|---|
   | **Name** | `nutrilokal-frontend` |
   | **Branch** | branch yang Anda push |
   | **Root Directory** | `frontend` |
   | **Build Command** | `npm ci && npm run build` |
   | **Publish Directory** | `dist` |

4. Tambahkan **Environment Variable**:

   | Key | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `https://nutrilokal-backend.onrender.com/api` |

   > Ganti dengan URL backend Anda yang sebenarnya (dari §2.6), diakhiri `/api`.

5. **SPA fallback** (agar `/`, `/catalog`, `/qr/:code`, `/login` tidak 404):
   - Bila memakai Blueprint `render.yaml`, ini sudah otomatis.
   - Bila membuat manual: buka **Redirects/Rewrites** pada Static Site, tambah:
     | Source | Destination | Action |
     |---|---|---|
     | `/*` | `/index.html` | Rewrite |
6. Klik **Create Static Site**. Tunggu selesai.
7. Salin URL frontend, mis. `https://nutrilokal-frontend.onrender.com`.

### 3.5. Izinkan CORS dari frontend

Kembali ke **backend** di Render → **Environment** → ubah `FRONTEND_ORIGIN`
menjadi URL frontend dari §3.7:

```
FRONTEND_ORIGIN=https://nutrilokal-frontend.onrender.com
```

Simpan (Render akan redeploy backend otomatis). Tanpa langkah ini, browser akan
memblokir request API (login akan gagal).

---

## 4. Penyimpanan foto produk (opsional, butuh paket berbayar)

Render **free service** memakai filesystem sementara: foto yang diunggah akan
**hilang** setiap redeploy/restart. Untuk demo fungsionalitas ini tetap terlihat
bekerja, tetapi tidak tahan lama.

Agar foto **permanen**, pakai **Persistent Disk** (memerlukan instance
**berbayar**, mis. Starter):

1. Backend Render → **Disk** → **Add Disk**.
   - **Name**: `nutrilokal-uploads`
   - **Mount Path**: `/var/data`
   - **Size**: 1 GB
2. Backend → **Environment** → tambah:
   | Key | Value |
   |---|---|
   | `UPLOADS_DIR` | `/var/data/uploads` |
3. Simpan → Render redeploy. Foto kini tersimpan di disk persisten.

> Bila memakai `render.yaml` lewat Blueprint, blok `disk:` sudah disertakan.
> Bila memakai paket gratis, **hapus** blok `disk:` dan env `UPLOADS_DIR`.

---

## 5. Buat akun Admin pertama

Database Neon masih kosong, jadi akun Admin dibuat lewat shell Render
(**tidak ada pendaftaran publik**):

1. Backend Render → **Shell** (tab di atas).
2. Jalankan (ganti nilainya):
   ```bash
   ADMIN_USERNAME=admin ADMIN_PASSWORD='KataSandiKuat123' ADMIN_NAME='Admin KWT Gogor' \
     node -e "require('./dist/scripts/create-admin.js')"
   ```
   Skrip menolak bila sudah ada Admin — aman diulang.

3. (Opsional) Tambah data contoh agar tester punya bahan uji: login sebagai
   Admin di aplikasi, lalu buat Produk, Bahan Baku, Produksi/batch, dan
   terbitkan QR lewat menu yang ada. Aplikasi akan mengisi sendiri sesuai
   aturan bisnis.

---

## 6. Verifikasi setelah deploy

Buka URL frontend (`https://nutrilokal-frontend.onrender.com`) dan periksa:

- [ ] Halaman **landing** tampil di `/`.
- [ ] Tombol **Lihat Katalog** membuka `/catalog` **tanpa login**.
- [ ] Tombol **Login** membuka halaman login; login Admin berhasil → dashboard.
- [ ] Menu Produk/Bahan/Produksi/Penjualan/Laporan dapat dibuka.
- [ ] Unggah foto produk lalu muat ulang: foto tetap tampil (bila Disk aktif).
- [ ] Buka halaman QR publik `/qr/<kode>` **tanpa login**.
- [ ] DevTools (F12) → Console: tidak ada error CORS.

Bila ada error CORS: pastikan `FRONTEND_ORIGIN` di backend **persis** sama
dengan URL frontend (tanpa garis miring di akhir).

---

## 7. Kendala yang perlu diketahui tester

- **Free service tidur** setelah ~15 menit tanpa aktivitas; request pertama bisa
  lambat (belum "bangun"). Sarankan tester membuka sekali dulu sebelum menilai.
- **Foto hilang saat redeploy** kecuali Persistent Disk aktif (§4).
- **Database bisa direset**: bila ingin mulai bersih saat pengujian, buat branch
  baru di Neon atau hapus project Neon lalu buat ulang.
- Ini **lingkungan testing**, bukan produksi: jangan masukkan data pribadi
  sensitif.

---

## 8. Ringkasan variabel lingkungan

**Backend (Render Web Service):**
| Key | Contoh / keterangan |
|---|---|
| `DATABASE_URL` | dari Neon, wajib `?sslmode=require` |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `FRONTEND_ORIGIN` | URL frontend Render, boleh dipisah koma untuk lebih dari satu |
| `UPLOADS_DIR` | `/var/data/uploads` (bila Disk aktif) |
| `NODE_VERSION` | `20` |

**Frontend (Render Static Site):**
| Key | Contoh |
|---|---|
| `VITE_API_BASE_URL` | `https://nutrilokal-backend.onrender.com/api` |
