import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import api from '../lib/api'
import { productPublicPath } from '../utils/public-product'

/**
 * Kompatibilitas untuk QR batch yang sudah dicetak sebelum sistem disederhanakan.
 *
 * Halaman ini BUKAN fitur pelacakan terpisah: ia tidak menampilkan data batch,
 * tidak punya input kode, dan tidak membuat QR baru. Tugasnya hanya menerima
 * `/qr/:code`, meminta backend menerjemahkan kode batch/alias lama menjadi ID
 * produk, lalu mengalihkan ke halaman publik produk yang permanen.
 */
export function LegacyQrRedirectPage() {
  const { code } = useParams()
  const [productId, setProductId] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setProductId(null)
    setFailed(false)

    if (!code) {
      setFailed(true)
      return
    }

    api
      .get(`/public/qr/${encodeURIComponent(code)}/product`)
      .then((res) => {
        if (!active) return
        const id = res.data?.productId
        if (typeof id === 'string' && id) {
          setProductId(id)
        } else {
          setFailed(true)
        }
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
    }
  }, [code])

  if (productId) {
    return <Navigate to={productPublicPath(productId)} replace />
  }

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Membuka Informasi Produk</h1>
        <p className="page-subtitle">
          {failed
            ? 'QR lama ini tidak ditemukan. Silakan buka katalog untuk memilih produk.'
            : 'Menyesuaikan QR lama dengan halaman produk NutriLokal...'}
        </p>
      </div>
      {failed && (
        <Link to="/catalog" className="button">
          Lihat Katalog
        </Link>
      )}
    </div>
  )
}
