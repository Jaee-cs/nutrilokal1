# Catatan Deploy & Debugging — Hostinger

## 1. Alamat produksi

| Fungsi | Alamat |
|---|---|
| Frontend | `https://nutrilokal.simantingsalam.com` |
| Backend API | `https://apinutrilokal.simantingsalam.com/api` |
| Health check | `https://apinutrilokal.simantingsalam.com/api/health` |
| Database | Neon `nutrilokal-hostinger` (eksternal) |

Akun Hostinger: `u728924271`, SSH port `65002`.
Password SSH dan koneksi database **jangan pernah ditulis di file ini atau di chat**.

## 2. Soal Git

`git commit` dan `git push` **tetap bisa dan sudah dipakai** (commit `423cec8`, `2584bbb`, `0278b26` sudah di `origin/main`).

Yang tidak bisa hanyalah **Hostinger import otomatis dari GitHub**, karena repo hanya akses undangan. Jadi:

- **Git** = histori kode / cadangan sumber.
- **Upload zip manual** = yang benar-benar berjalan di server.

Keduanya tetap dilakukan setiap kali ada perubahan.

## 3. Alur debugging / update

1. **Reproduksi**: buka halaman yang error, tekan `F12` → tab **Console** dan **Network**. Catat pesan error, URL request, dan kode status (400/401/403/404/500).
2. **Cek backend masih hidup**:
   ```bash
   curl -i https://apinutrilokal.simantingsalam.com/api/health
   ```
   Harus `200` dan `"database":"up"`.
3. **Baca log backend** lewat SSH:
   ```bash
   ssh -p 65002 u728924271@153.92.9.89
   tail -f ~/domains/apinutrilokal.simantingsalam.com/hbuilds/versions/*/nodejs/console.log
   ```
   Log error ada di `stderr.log` pada folder versi yang sama.
4. **Perbaiki di lokal**, lalu uji dulu:
   ```bash
   cd backend && npm run dev
   cd frontend && npm run dev
   ```
5. **Simpan ke Git**:
   ```bash
   git add <file yang diubah>
   git commit -m "fix: ..."
   git push origin main
   ```
6. **Deploy ke server** (lihat bagian 4).
7. **Restart Web App** di hPanel, lalu ulangi langkah 2 dan uji lagi di browser.

Kalau error membingungkan, tempel di chat: pesan Console/Network + baris log terakhir. Saya bisa lanjut baca log lewat SSH.

## 4. Cara deploy ulang

### Backend

```bash
./scripts/package-backend.sh
```

Skrip ini menjalankan `npm run build` (yang mencakup `prisma generate && tsc && prisma migrate deploy`), lalu menghasilkan:

```
nutrilokal-backend-hostinger-v2.zip
```

Pastikan `backend/.env` lokal berisi `DATABASE_URL` sebelum menjalankan skrip.

Upload zip itu lewat hPanel → Web App `apinutrilokal` → **Upload new source / Redeploy**, lalu klik **Restart**.

### Frontend

```bash
cd frontend
VITE_API_BASE_URL="https://apinutrilokal.simantingsalam.com/api" npm run build
```

Upload **isi folder `dist/`** (bukan folder `dist`-nya) ke:

```
/home/u728924271/domains/simantingsalam.com/public_html/nutrilokal
```

Pertahankan `.htaccess` SPA fallback di folder itu, supaya `/products`, `/login`, dll. tidak 404 saat di-refresh.

## 5. Lokasi penting di server

| Keterangan | Path |
|---|---|
| Env runtime backend | `~/domains/apinutrilokal.simantingsalam.com/hbuilds/config/.env` |
| Source terakhir | `~/domains/apinutrilokal.simantingsalam.com/hbuilds/last-source/` |
| Aplikasi berjalan | `~/domains/apinutrilokal.simantingsalam.com/hbuilds/current/nodejs/` |
| Log | `~/domains/apinutrilokal.simantingsalam.com/hbuilds/versions/*/nodejs/` |
| Document root frontend | `~/domains/simantingsalam.com/public_html/nutrilokal/` |

Env runtime sebaiknya diubah lewat **hPanel → Environment Variables**, bukan dengan menambah baris acak langsung ke file—Hostinger hanya meneruskan variabel yang terdaftar di panel ke proses Node.

## 6. Masalah umum

| Gejala | Kemungkinan | Cara |
|---|---|---|
| `503` | Build gagal / aplikasi crash | Lihat `deploy.log` dan `stderr.log`, lalu restart |
| `401` di endpoint data | Token belum dikirim / login belum | Normal untuk API tanpa token; coba login dulu |
| `500` + pesan `DATABASE_URL belum diatur` | Env belum terbaca | Isi ulang env di hPanel, restart |
| Halaman React 404 saat refresh | `.htaccess` hilang | Pasang lagi SPA fallback (bagian 4) |
| Data tidak tersimpan setelah redeploy frontend | Salah upload folder | Upload isi `dist/`, bukan folder `dist/`-nya |
| Upload foto hilang setelah redeploy backend | Penyimpanan lokal ikut tertimpa | Cloudinary belum diisi; rencanakan pindah ke Cloudinary |

## 7. Rollback

Hostinger menyimpan versi deploy di `hbuilds/versions/`. Zip yang terakhir dipakai juga tersimpan lokal sebagai `nutrilokal-backend-hostinger-v2.zip`. Jangan hapus file zip lama sebelum deploy baru terbukti stabil.

## 8. Akun Admin

Akun pertama sudah dibuat (`admin`, role `ADMIN`) dan login produksi sudah terverifikasi. Karena **tidak ada pendaftaran publik**, akun Operator dibuat oleh Admin lewat menu Users.

Bootstrap Admin tidak lagi diperlukan. Kredensial sementara (`ADMIN_*`) sudah dihapus dari env server, dan file `.env.production` lokal/server sudah dihapus.
