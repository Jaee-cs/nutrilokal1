-- Foto produk (README 5.6): path publik berkas foto yang disimpan di
-- penyimpanan lokal backend. Kolom nullable sehingga data lama tetap valid
-- (produk tanpa foto tetap dapat dipakai seperti sebelumnya).
ALTER TABLE "products" ADD COLUMN "photoUrl" TEXT;
