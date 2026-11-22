/**
 * Halaman Arsip NutriLokal — khusus Admin.
 *
 * Menampilkan master data yang dinonaktifkan/arsip (Produk, Bahan Baku, Akun
 * Pengguna) dari endpoint /api/archive. Halaman ini tidak menyimpan salinan:
 * data tetap berada di tabel asal dengan ID yang sama. Halaman ini hanya
 * menyediakan aksi Detail dan Pulihkan; penghapusan permanen tidak tersedia
 * di sini agar arsip dan riwayatnya tidak bisa dihapus dari layar Arsip.
 *
 * Tab "Lainnya" sengaja tidak ada karena tidak ada master lain yang relevan
 * untuk diarsipkan. Transaksi/produksi/penjualan/pergerakan stok adalah
 * catatan historis, bukan objek arsip.
 *
 * Daftar tidak menyediakan filter: semua data arsip tampil langsung diurutkan
 * dari tanggal arsip terbaru ke terlama.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Eye, RotateCcw } from 'lucide-react'
import api from '../lib/api'
import { Modal } from '../components/Modal'
import { useNotify } from '../components/NotificationProvider'
import { isoToDateTimeDisplay } from '../utils/dates'
import { productPhotoUrl } from '../utils/product-photo'

type ArchiveKind = 'products' | 'materials' | 'users'

interface ArchiveMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface ArchiveRecipeItem {
  materialId: string
  quantityPerUnit: number
  recipeUnit: string
  material?: { id: string; name: string; unit: string; isActive: boolean } | null
}

interface ArchiveRow {
  id: string
  name?: string | null
  username?: string
  role?: 'ADMIN' | 'OPERATOR'
  unit?: string
  sellingPrice?: number
  stock?: number
  batchCount?: number
  photoUrl?: string | null
  isManual?: boolean
  recipe?: ArchiveRecipeItem[]
  nutrition?: unknown
  hasActivityHistory?: boolean
  lastLoginAt?: string | null
  isActive: boolean
  archivedAt?: string | null
  archivedById?: string | null
  archivedByName?: string | null
  archiveReason?: string | null
  createdAt?: string
}

interface ArchiveSummary {
  products: number
  materials: number
  users: number
}

const PAGE_SIZE = 20

const KIND_CONFIG: Record<ArchiveKind, { label: string; singular: string }> = {
  products: { label: 'Produk', singular: 'product' },
  materials: { label: 'Bahan Baku', singular: 'material' },
  users: { label: 'Akun Pengguna', singular: 'user' },
}

const ARCHIVE_TABS: Array<{ id: ArchiveKind; label: string }> = [
  { id: 'products', label: 'Produk' },
  { id: 'materials', label: 'Bahan Baku' },
  { id: 'users', label: 'Akun Pengguna' },
]

function formatNumber(value?: number | null): string {
  return Number(value ?? 0).toLocaleString('id-ID')
}

function identityOf(row: ArchiveRow): string {
  return row.username || row.name || row.id
}

function secondaryOf(row: ArchiveRow): string {
  if (row.username) return row.name || row.role || ''
  return row.unit ? `Satuan: ${row.unit}` : ''
}

function archivedDate(row: ArchiveRow): string {
  if (!row.archivedAt) return 'Tidak tercatat (data lama)'
  const display = isoToDateTimeDisplay(row.archivedAt)
  return display ? `${display} WIB` : row.archivedAt
}

function archivedBy(row: ArchiveRow): string {
  return row.archivedByName || row.archivedById || '-'
}

/** Baris ringkas untuk tabel desktop maupun kartu mobile. */
function ArchiveBadges({ row }: { row: ArchiveRow }) {
  return (
    <div className="row-actions archive-badges">
      <span className="badge neutral">Diarsipkan</span>
      {row.username && (
        <span className={`badge ${row.role === 'ADMIN' ? 'neutral' : 'success'}`}>
          {row.role === 'ADMIN' ? 'Admin' : 'Operator'}
        </span>
      )}
    </div>
  )
}

export function ArchivePage() {
  const notify = useNotify()

  const [activeTab, setActiveTab] = useState<ArchiveKind>('products')
  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)

  const [rows, setRows] = useState<ArchiveRow[]>([])
  const [meta, setMeta] = useState<ArchiveMeta>({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [summary, setSummary] = useState<ArchiveSummary | null>(null)
  const [detail, setDetail] = useState<ArchiveRow | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api
      .get('/archive/summary')
      .then((res) => {
        if (active) setSummary(res.data?.data ?? null)
      })
      .catch(() => {
        // Ringkasan opsional: kegagalannya tidak menghalangi daftar arsip.
      })
    return () => {
      active = false
    }
  }, [reloadToken])

  useEffect(() => {
    let active = true
    setLoading(true)
    // Tanpa filter: backend mengurutkan archivedAt terbaru ke terlama.
    const params: Record<string, string | number> = { page, pageSize: PAGE_SIZE }

    api
      .get(`/archive/${activeTab}`, { params })
      .then((res) => {
        if (!active) return
        setRows(res.data?.data ?? [])
        setMeta(
          res.data?.meta ?? {
            page,
            pageSize: PAGE_SIZE,
            total: 0,
            totalPages: 1,
          }
        )
        setLoadError(null)
      })
      .catch((err: any) => {
        if (!active) return
        setLoadError(err.response?.data?.message || 'Gagal memuat data arsip.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [activeTab, page, reloadToken])

  function switchTab(tab: ArchiveKind) {
    if (tab === activeTab) return
    setActiveTab(tab)
    setPage(1)
    setLoadError(null)
    setDetail(null)
  }

  async function openDetail(row: ArchiveRow) {
    setDetailLoading(true)
    try {
      const res = await api.get(`/archive/${activeTab}/${row.id}`)
      const key = KIND_CONFIG[activeTab].singular
      setDetail((res.data?.[key] as ArchiveRow) ?? row)
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal memuat detail arsip.')
    } finally {
      setDetailLoading(false)
    }
  }

  async function requestRestore(row: ArchiveRow) {
    const label = identityOf(row)
    const confirmed = await notify.confirm({
      title: 'Pulihkan Data',
      message:
        `Pulihkan "${label}" ke daftar operasional? Data yang sama akan aktif kembali ` +
        'dengan ID dan riwayat yang tidak berubah.',
      tone: 'warning',
      confirmLabel: 'Ya, Pulihkan',
      cancelLabel: 'Batal',
      details: (
        <div className="archive-restore-details">
          <p>
            ID, relasi, dan seluruh riwayat tetap dipakai. Sistem akan membatalkan pemulihan
            bila nama/username bentrok dengan data aktif lain.
          </p>
          <div className="account-delete-row">
            <span>Tanggal diarsipkan</span>
            <strong>{archivedDate(row)}</strong>
          </div>
          <div className="account-delete-row">
            <span>Oleh Admin</span>
            <strong>{archivedBy(row)}</strong>
          </div>
          {row.archiveReason && (
            <div className="account-delete-row">
              <span>Alasan</span>
              <strong>{row.archiveReason}</strong>
            </div>
          )}
        </div>
      ),
    })
    if (!confirmed) return

    setRestoringId(row.id)
    try {
      const res = await api.post(`/archive/${activeTab}/${row.id}/restore`)
      setDetail(null)
      setReloadToken((value) => value + 1)
      if (rows.length === 1 && page > 1) setPage((value) => value - 1)
      notify.success(res.data?.message || 'Data berhasil dipulihkan.')
      if (res.data?.warning) {
        notify.warning(res.data.warning, 'Catatan Pemulihan')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal memulihkan data.')
    } finally {
      setRestoringId(null)
    }
  }

  const startItem = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1
  const endItem = Math.min(meta.page * meta.pageSize, meta.total)

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Arsip</h1>
        <p className="page-subtitle">
          Kelola dan pulihkan data yang sudah tidak digunakan.
        </p>
      </div>

      <div className="summary-row">
        <div className="summary-item">
          <span className="card-label">Produk</span>
          <span className="summary-value">{summary?.products ?? '-'}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Bahan Baku</span>
          <span className="summary-value">{summary?.materials ?? '-'}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Akun</span>
          <span className="summary-value">{summary?.users ?? '-'}</span>
        </div>
      </div>

      <div className="reports-tabs" role="tablist" aria-label="Jenis arsip">
        {ARCHIVE_TABS.map((tab) => {
          const count =
            tab.id === 'products'
              ? summary?.products
              : tab.id === 'materials'
                ? summary?.materials
                : summary?.users
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`reports-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => switchTab(tab.id)}
            >
              {tab.label}
              {count !== undefined && count !== null ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      <section className="card section-card">
        {loadError && <div className="alert error">{loadError}</div>}

        <div className="section-head">
          <h2 className="card-title">Daftar {KIND_CONFIG[activeTab].label} Diarsipkan</h2>
          <span className="text-muted">
            {loading ? 'Memuat...' : `${meta.total} data · terbaru ke terlama`}
          </span>
        </div>

        <div className="desktop-table">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Identitas</th>
                  <th>Tanggal Arsip</th>
                  <th>Diarsipkan Oleh</th>
                  <th>Alasan</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5}>Memuat...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="text-muted">Tidak ada data arsip.</td></tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="cell-primary">{identityOf(row)}</div>
                        {secondaryOf(row) && (
                          <div className="cell-secondary">{secondaryOf(row)}</div>
                        )}
                        <div className="archive-id">ID: {row.id}</div>
                      </td>
                      <td>{archivedDate(row)}</td>
                      <td>{archivedBy(row)}</td>
                      <td className="text-muted">{row.archiveReason || '-'}</td>
                      <td>
                        <div className="row-actions archive-actions">
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => void openDetail(row)}
                            disabled={detailLoading}
                          >
                            <Eye size={15} aria-hidden="true" /> Detail
                          </button>
                          <button
                            type="button"
                            className="button"
                            onClick={() => void requestRestore(row)}
                            disabled={restoringId === row.id}
                          >
                            <RotateCcw size={15} aria-hidden="true" />
                            {restoringId === row.id ? 'Memulihkan...' : 'Pulihkan'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mobile-list">
          {loading ? (
            <p className="text-muted">Memuat...</p>
          ) : rows.length === 0 ? (
            <p className="text-muted">Tidak ada data arsip.</p>
          ) : (
            rows.map((row) => (
              <article className="archive-card" key={row.id}>
                <div className="archive-card-head">
                  <div>
                    <div className="cell-primary">{identityOf(row)}</div>
                    {secondaryOf(row) && (
                      <div className="cell-secondary">{secondaryOf(row)}</div>
                    )}
                  </div>
                  <ArchiveBadges row={row} />
                </div>
                <div className="archive-card-meta">
                  <div className="user-card-row">
                    <span className="user-card-label">Tanggal arsip</span>
                    <span className="user-card-value">{archivedDate(row)}</span>
                  </div>
                  <div className="user-card-row">
                    <span className="user-card-label">Oleh Admin</span>
                    <span className="user-card-value">{archivedBy(row)}</span>
                  </div>
                  {row.archiveReason && (
                    <div className="user-card-row">
                      <span className="user-card-label">Alasan</span>
                      <span className="user-card-value">{row.archiveReason}</span>
                    </div>
                  )}
                </div>
                <div className="row-actions archive-actions archive-card-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void openDetail(row)}
                    disabled={detailLoading}
                  >
                    <Eye size={15} aria-hidden="true" /> Detail
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => void requestRestore(row)}
                    disabled={restoringId === row.id}
                  >
                    <RotateCcw size={15} aria-hidden="true" /> Pulihkan
                  </button>
                </div>
              </article>
            ))
          )}
        </div>

        <div className="archive-pagination">
          <span className="text-muted">
            {meta.total === 0 ? 'Tidak ada data' : `Menampilkan ${startItem}–${endItem} dari ${meta.total}`}
          </span>
          <div className="row-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1 || loading}
              aria-label="Halaman sebelumnya"
            >
              <ChevronLeft size={16} aria-hidden="true" /> Sebelumnya
            </button>
            <span className="archive-page-label">
              Halaman {meta.page} dari {meta.totalPages}
            </span>
            <button
              type="button"
              className="button secondary"
              onClick={() => setPage((value) => Math.min(meta.totalPages, value + 1))}
              disabled={page >= meta.totalPages || loading}
              aria-label="Halaman berikutnya"
            >
              Berikutnya <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <p className="archive-footnote text-muted">
        Data arsip tidak muncul pada daftar operasional aktif. Riwayat produksi, penjualan,
        transaksi, dan pergerakan stok tidak diubah. Penghapusan permanen tidak tersedia di
        halaman ini; gunakan Arsipkan pada daftar aktif bila data masih diperlukan.
      </p>

      {detail && (
        <Modal
          title={`Detail ${KIND_CONFIG[activeTab].label}: ${identityOf(detail)}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button type="button" className="button secondary" onClick={() => setDetail(null)}>
                Tutup
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void requestRestore(detail)}
                disabled={restoringId === detail.id}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {restoringId === detail.id ? 'Memulihkan...' : 'Pulihkan'}
              </button>
            </>
          }
        >
          <ArchiveDetailContent kind={activeTab} row={detail} />
        </Modal>
      )}
    </div>
  )
}

/** Isi dialog detail, disesuaikan dengan jenis master yang diarsipkan. */
function ArchiveDetailContent({ kind, row }: { kind: ArchiveKind; row: ArchiveRow }) {
  const photo = productPhotoUrl(row.photoUrl)
  const sections: ReactNode[] = [
    <div className="detail-grid" key="meta">
      <div><span className="card-label">ID</span><span className="detail-value">{row.id}</span></div>
      <div><span className="card-label">Status</span><span className="detail-value">Diarsipkan</span></div>
      <div><span className="card-label">Tanggal arsip</span><span className="detail-value">{archivedDate(row)}</span></div>
      <div><span className="card-label">Diarsipkan oleh</span><span className="detail-value">{archivedBy(row)}</span></div>
      <div><span className="card-label">Alasan</span><span className="detail-value">{row.archiveReason || '-'}</span></div>
    </div>,
  ]

  if (kind === 'products') {
    sections.push(
      <div className="detail-grid" key="product">
        <div><span className="card-label">Nama produk</span><span className="detail-value">{row.name || '-'}</span></div>
        <div><span className="card-label">Satuan</span><span className="detail-value">{row.unit || '-'}</span></div>
        <div><span className="card-label">Harga jual</span><span className="detail-value">{formatNumber(row.sellingPrice)}</span></div>
        <div><span className="card-label">Stok tersimpan</span><span className="detail-value">{formatNumber(row.stock)} {row.unit || ''}</span></div>
        <div><span className="card-label">Jumlah batch</span><span className="detail-value">{formatNumber(row.batchCount)}</span></div>
      </div>
    )
    if (photo) {
      sections.push(
        <img
          key="photo"
          src={photo}
          alt={`Foto ${row.name || 'produk'}`}
          className="archive-detail-photo"
        />
      )
    }
    sections.push(
      <div key="recipe">
        <h3 className="sub-heading">Resep tersimpan</h3>
        {row.recipe && row.recipe.length > 0 ? (
          <ul className="archive-detail-list">
            {row.recipe.map((item) => (
              <li key={item.materialId}>
                {item.material?.name || item.materialId} — {formatNumber(item.quantityPerUnit)} {item.recipeUnit}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Tidak ada resep.</p>
        )}
      </div>
    )
    type ArchiveNutritionInfo = {
      servingSizeAmount?: number
      servingSizeUnit?: string
      servingsPerPackage?: number
      components?: unknown[]
      sections?: ArchiveNutritionInfo[]
    }
    const nutrition = row.nutrition as ArchiveNutritionInfo | null | undefined
    const nutritionFilled =
      nutrition?.servingSizeAmount !== undefined ||
      !!nutrition?.servingSizeUnit ||
      nutrition?.servingsPerPackage !== undefined ||
      (nutrition?.components?.length ?? 0) > 0 ||
      (nutrition?.sections ?? []).some(
        (section) =>
          section.servingSizeAmount !== undefined ||
          !!section.servingSizeUnit ||
          section.servingsPerPackage !== undefined ||
          (section.components?.length ?? 0) > 0,
      )
    sections.push(
      <p className="text-muted" key="nutrition">
        Informasi gizi: {nutritionFilled ? 'tersimpan utuh' : 'tidak diisi'}.
        QR/URL produk memakai ID yang sama dan tidak diubah saat pengarsipan.
      </p>
    )
  }

  if (kind === 'materials') {
    sections.push(
      <div className="detail-grid" key="material">
        <div><span className="card-label">Nama bahan</span><span className="detail-value">{row.name || '-'}</span></div>
        <div><span className="card-label">Satuan</span><span className="detail-value">{row.unit || '-'}</span></div>
        <div><span className="card-label">Saldo stok</span><span className="detail-value">{formatNumber(row.stock)} {row.unit || ''}</span></div>
        <div><span className="card-label">Jenis satuan</span><span className="detail-value">{row.isManual ? 'Manual' : 'Standar'}</span></div>
      </div>
    )
    sections.push(
      <p className="text-muted" key="material-note">
        Saldo penerimaan, pemakaian, penyesuaian, dan pergerakan stok tidak dihapus atau diubah.
      </p>
    )
  }

  if (kind === 'users') {
    sections.push(
      <div className="detail-grid" key="user">
        <div><span className="card-label">Username</span><span className="detail-value">{row.username || '-'}</span></div>
        <div><span className="card-label">Nama</span><span className="detail-value">{row.name || '-'}</span></div>
        <div><span className="card-label">Role</span><span className="detail-value">{row.role === 'ADMIN' ? 'Admin' : 'Operator'}</span></div>
        <div><span className="card-label">Riwayat aktivitas</span><span className="detail-value">{row.hasActivityHistory ? 'Tersimpan' : 'Tidak ada'}</span></div>
        <div><span className="card-label">Terakhir login</span><span className="detail-value">
          {row.lastLoginAt ? `${isoToDateTimeDisplay(row.lastLoginAt)} WIB` : '-'}
        </span></div>
      </div>
    )
    sections.push(
      <p className="text-muted" key="user-note">
        Sesi akun ini dicabut saat diarsipkan. Identitas dan riwayat aktivitas tetap tersimpan.
      </p>
    )
  }

  return <div className="archive-detail">{sections}</div>
}
