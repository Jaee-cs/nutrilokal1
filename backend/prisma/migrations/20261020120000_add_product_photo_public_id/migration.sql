-- Foto produk di penyimpanan eksternal (Cloudinary).
--
-- Menambah public ID foto agar foto lama dapat dihapus dengan aman saat
-- diganti/dihapus. Kolom nullable sehingga seluruh data lama tetap valid:
-- produk tanpa foto, maupun produk dengan foto lokal (photoPublicId kosong).
ALTER TABLE "products" ADD COLUMN "photoPublicId" TEXT;
