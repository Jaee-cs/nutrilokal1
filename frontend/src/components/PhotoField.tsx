import { useEffect, useRef, useState } from 'react'
import { productPhotoUrl, validatePhotoFile } from '../utils/product-photo'

interface PhotoFieldProps {
  /** Foto produk yang tersimpan di server (mode edit), bila ada. */
  currentUrl?: string | null
  /** File yang dipilih pengguna; `null` berarti dihapus, `undefined` tidak diubah. */
  file: File | null | undefined
  onChange: (file: File | null | undefined) => void
  /** Terisi setelah backend benar-benar menyimpan foto (mode edit). */
  savedMessage?: string | null
}

/**
 * Kolom unggah foto produk: pratinjau sebelum disimpan, validasi tipe & ukuran,
 * serta tombol hapus foto. Dipakai form tambah dan form edit produk sehingga
 * perilakunya konsisten (README 5.6: foto hanya ditampilkan bila tersimpan).
 */
export function PhotoField({ currentUrl, file, onChange, savedMessage }: PhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  // Object URL untuk berkas yang baru dipilih, dibersihkan saat berubah.
  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const savedUrl = productPhotoUrl(currentUrl)
  const removed = file === null
  const shownUrl = preview ?? (removed ? null : savedUrl)

  function pick(selected?: File) {
    setError(null)
    if (!selected) {
      onChange(undefined)
      return
    }
    const problem = validatePhotoFile(selected)
    if (problem) {
      setError(problem)
      // Jangan simpan berkas yang tidak valid.
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    onChange(selected)
  }

  function clear() {
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
    // Berkas baru yang belum diunggah cukup dibatalkan; foto yang sudah
    // tersimpan di server ditandai untuk dihapus.
    onChange(preview ? undefined : null)
  }

  const status = error
    ? { text: error, cls: 'error' }
    : file
      ? { text: 'Foto baru siap disimpan bersama produk.', cls: 'success' }
      : removed
        ? { text: 'Foto akan dihapus saat disimpan.', cls: 'warning' }
        : savedUrl
          ? { text: savedMessage ?? 'Foto tersimpan pada produk.', cls: 'success' }
          : { text: 'Belum ada foto. Foto bersifat opsional.', cls: 'neutral' }

  return (
    <div className="field photo-field">
      <label htmlFor="p-photo">Foto Produk (opsional)</label>
      <div className="photo-field-body">
        <div className="photo-preview" aria-live="polite">
          {shownUrl ? (
            <img src={shownUrl} alt="Pratinjau foto produk" />
          ) : (
            <span className="material-symbols-outlined photo-placeholder-icon">image</span>
          )}
        </div>
        <div className="photo-field-actions">
          <input
            id="p-photo"
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={e => pick(e.target.files?.[0])}
          />
          <span className={`badge ${status.cls}`}>{status.text}</span>
          {(shownUrl || file !== undefined) && (
            <button type="button" className="button secondary" onClick={clear} aria-label="Hapus foto">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
              Hapus Foto
            </button>
          )}
          <span className="text-muted photo-hint">JPG, PNG, atau WEBP · maksimal 5 MB.</span>
        </div>
      </div>
    </div>
  )
}
