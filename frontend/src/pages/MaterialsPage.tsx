import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useNotify } from '../components/NotificationProvider'
import { DateField } from '../components/DateField'
import { isoToDateDisplay, isoToDateTimeDisplay, todayDateCode } from '../utils/dates'
import {
  canonicalUnit,
  convertQuantityValue,
  formatQty,
  isAutomaticConversion,
  STANDARD_UNIT_CODES,
  UNIT_GROUPS,
  UNIT_KIND_LABELS,
  unitKindOf,
  unitOptionLabel,
  type UnitGroup,
} from '../utils/units'

interface Material {
  id: string
  name: string
  unit: string
  isManual?: boolean
  description?: string | null
  stock?: number
  isActive: boolean
}

interface Receipt {
  id: string
  materialId: string
  quantity: number
  receivedAt: string
  note?: string | null
  recordedBy?: { username: string; name?: string | null }
  createdAt: string
}

type MovementType =
  | 'RECEIPT'
  | 'OPENING_BALANCE'
  | 'PRODUCTION_USAGE'
  | 'ADJUSTMENT'
  | 'UNIT_CONVERSION'

interface Movement {
  id: string
  materialId: string
  type: MovementType
  /** Nilai sebagaimana disimpan di ledger (penyesuaian bernilai tanda). */
  quantity: number
  /** Dampak terhadap stok: positif menambah, negatif mengurangi. */
  delta: number
  occurredAt: string
  recordedAt: string
  recordedBy?: { id: string; username: string; name?: string | null }
  reason?: string | null
  sourceId?: string | null
}

type ModalKey = 'add' | 'receipt' | 'edit' | null
type EditTab = 'stock' | 'unit'

interface AddForm {
  name: string
  unitKind: UnitGroup
  standardUnit: string
  manualUnit: string
  description: string
}

interface UnitForm {
  materialId: string
  unitKind: UnitGroup
  standardUnit: string
  manualUnit: string
  newStock: string
  reason: string
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  RECEIPT: 'Penerimaan',
  OPENING_BALANCE: 'Saldo Awal',
  PRODUCTION_USAGE: 'Pemakaian Produksi',
  ADJUSTMENT: 'Penyesuaian',
  UNIT_CONVERSION: 'Konversi Satuan',
}

const EMPTY_ADD: AddForm = {
  name: '',
  unitKind: 'mass',
  standardUnit: 'kg',
  manualUnit: '',
  description: '',
}
const EMPTY_ADD_OB = { quantity: '', date: '', reason: '' }
const EMPTY_OB = { materialId: '', quantity: '', date: '', reason: '' }
const EMPTY_ADJ = { materialId: '', quantity: '', date: '', reason: '' }
const EMPTY_RECEIPT = { materialId: '', quantity: '', receivedAt: '', note: '' }
const EMPTY_UNIT: UnitForm = {
  materialId: '',
  unitKind: 'mass',
  standardUnit: 'kg',
  manualUnit: '',
  newStock: '',
  reason: '',
}

/** Nilai awal formulir: tanggal aktivitas default hari ini (WIB). */
function todayForms() {
  const today = todayDateCode()
  return {
    addOb: { ...EMPTY_ADD_OB, date: today },
    ob: { ...EMPTY_OB, date: today },
    adj: { ...EMPTY_ADJ, date: today },
    receipt: { ...EMPTY_RECEIPT, receivedAt: today },
  }
}

/** Angka bertanda untuk menampilkan perubahan stok. */
function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('id-ID')}`
}

/**
 * Saldo berjalan per pergerakan, dihitung MUNDUR dari stok terkini:
 * baris terbaru (paling atas) memakai stok saat ini sebagai saldo setelahnya.
 */
function buildMovementRows(rows: Movement[], currentStock?: number) {
  let running = currentStock
  return rows.map((movement) => {
    const balance = running
    if (running !== undefined) {
      running = running - movement.delta
    }
    return { movement, balance }
  })
}

/** Pesan seragam saat nama bahan baku sudah dipakai bahan lain. */
const DUPLICATE_NAME_MESSAGE = 'Nama bahan baku sudah terdaftar. Gunakan nama yang berbeda.'

/**
 * Kunci pembanding nama bahan baku: tanpa spasi di awal/akhir dan tanpa
 * membedakan huruf besar/kecil. Hanya kecocokan penuh yang dianggap
 * duplikat — "Singkong" berbeda dari "Singkong Kuning".
 */
function materialNameKey(name: string): string {
  return name.trim().toLowerCase()
}

interface MaterialModalProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}

/**
 * Modal terpusat untuk form bahan baku. Memakai kelas modal NutriLokal yang
 * sudah ada, mengunci gulir halaman, menjebak fokus, dan mendukung Escape.
 */
function MaterialModal({ open, title, description, onClose, children }: MaterialModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    const firstField = panel?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    )
    const firstFocusable = panel?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    ;(firstField ?? firstFocusable ?? panel)?.focus()

    function focusables(): HTMLElement[] {
      if (!panel) return []
      return Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel) return

      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && panel.contains(active)

      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="modal-root material-modal-root">
      <div className="modal-overlay" onClick={onClose} />
      <div
        ref={panelRef}
        className="modal-panel material-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="material-modal-head">
          <div className="material-modal-heading">
            <h2 className="modal-title" id={titleId}>{title}</h2>
            {description && <p className="material-modal-subtitle">{description}</p>}
          </div>
          <button
            type="button"
            className="icon-button material-modal-close"
            onClick={onClose}
            aria-label="Tutup dialog"
            title="Tutup"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Halaman "Bahan Baku". Tambah bahan, penerimaan, dan penyesuaian stok
 * dibuka sebagai modal terpusat; daftar, riwayat pergerakan, dan riwayat
 * penerimaan tetap tampil di halaman. Semua aturan berasal dari backend.
 */
export function MaterialsPage() {
  const { user } = useAuth()
  const notify = useNotify()
  const isAdmin = user?.role === 'ADMIN'
  const canReceive = isAdmin || user?.role === 'OPERATOR'

  const [activeModal, setActiveModal] = useState<ModalKey>(null)
  const [editTab, setEditTab] = useState<EditTab>('stock')
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  // Kegagalan memuat daftar tetap tampil di halaman (keadaan halaman, bukan
  // hasil tindakan). Pesan hasil tindakan memakai dialog terpusat.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Jumlah bahan arsip dari endpoint Arsip; daftar operasional hanya aktif.
  const [archivedCount, setArchivedCount] = useState(0)

  async function fetchArchivedCount(): Promise<void> {
    try {
      const res = await api.get('/archive/summary')
      setArchivedCount(Number(res.data?.data?.materials ?? 0))
    } catch {
      // Ringkasan opsional; biarkan angka terakhir tetap tampil.
    }
  }

  // Tambah bahan baku (+ saldo awal opsional dalam satu alur, Admin)
  const [addForm, setAddForm] = useState(EMPTY_ADD)
  const [obEnabled, setObEnabled] = useState(false)
  const [addObForm, setAddObForm] = useState(EMPTY_ADD_OB)
  const [submittingAdd, setSubmittingAdd] = useState(false)

  // Penyesuaian satuan utama bahan yang sudah dipakai (Admin)
  const [unitForm, setUnitForm] = useState<UnitForm>(EMPTY_UNIT)
  const [submittingUnit, setSubmittingUnit] = useState(false)

  // Saldo awal bahan yang sudah ada (Admin)
  const [obForm, setObForm] = useState(EMPTY_OB)
  const [submittingOb, setSubmittingOb] = useState(false)

  // Riwayat pergerakan stok (Admin & Operator)
  const [movements, setMovements] = useState<Movement[]>([])
  const [movementMaterialId, setMovementMaterialId] = useState('')
  const [loadingMovements, setLoadingMovements] = useState(false)

  // Penyesuaian stok (Admin)
  const [adjForm, setAdjForm] = useState(EMPTY_ADJ)
  const [submittingAdj, setSubmittingAdj] = useState(false)

  // Penerimaan bahan baku (Admin & Operator)
  const [receiptForm, setReceiptForm] = useState(EMPTY_RECEIPT)
  const [submittingReceipt, setSubmittingReceipt] = useState(false)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [receiptMaterialId, setReceiptMaterialId] = useState('')
  const [loadingReceipts, setLoadingReceipts] = useState(false)

  async function fetchMaterials(): Promise<boolean> {
    try {
      setLoading(true)
      const res = await api.get('/materials')
      setMaterials(res.data.data || res.data)
      setLoadError(null)
      return true
    } catch (err: any) {
      setLoadError(err.response?.data?.message || 'Gagal memuat bahan baku')
      return false
    } finally {
      setLoading(false)
    }
  }

  async function loadMovements(materialId: string): Promise<boolean> {
    if (!materialId) {
      setMovements([])
      return true
    }
    setLoadingMovements(true)
    try {
      const res = await api.get(`/materials/${materialId}/movements`)
      setMovements(res.data.data || res.data || [])
      return true
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal memuat riwayat pergerakan stok')
      setMovements([])
      return false
    } finally {
      setLoadingMovements(false)
    }
  }

  async function loadReceipts(materialId: string): Promise<boolean> {
    if (!materialId) {
      setReceipts([])
      return true
    }
    setLoadingReceipts(true)
    try {
      const res = await api.get(`/materials/${materialId}/receipts`)
      setReceipts(res.data.data || res.data || [])
      return true
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal memuat riwayat penerimaan')
      setReceipts([])
      return false
    } finally {
      setLoadingReceipts(false)
    }
  }

  useEffect(() => {
    fetchMaterials()
    void fetchArchivedCount()
  }, [])

  function openAddModal() {
    const forms = todayForms()
    setAddForm(EMPTY_ADD)
    setAddObForm(forms.addOb)
    setObForm(forms.ob)
    setObEnabled(false)
    setActiveModal('add')
  }

  function openReceiptModal(material: Material) {
    setReceiptForm({ ...todayForms().receipt, materialId: material.id })
    setActiveModal('receipt')
  }

  function unitChangeTarget(): string {
    return unitForm.unitKind === 'manual' ? unitForm.manualUnit.trim() : unitForm.standardUnit
  }

  function unitChangeIsAutomatic(material?: Material): boolean {
    const target = unitChangeTarget()
    return !!material && !!target && isAutomaticConversion(material.unit, target)
  }

  /** Pensil membuka satu modal dengan dua tab: stok dan satuan. */
  function openEditModal(material: Material, tab: EditTab) {
    setAdjForm({ ...todayForms().adj, materialId: material.id })
    const kind = unitKindOf(material.unit)
    setUnitForm({
      materialId: material.id,
      unitKind: kind,
      standardUnit: kind === 'manual' ? 'kg' : canonicalUnit(material.unit) ?? 'kg',
      manualUnit: kind === 'manual' ? material.unit : '',
      newStock: '',
      reason: '',
    })
    setEditTab(tab)
    setActiveModal('edit')
  }

  async function submitUnitChange(e: React.FormEvent) {
    e.preventDefault()
    const material = materials.find((m) => m.id === unitForm.materialId)
    if (!material) {
      notify.error('Bahan baku tidak ditemukan.')
      return
    }
    const target = unitChangeTarget()
    if (!target) {
      notify.error(
        unitForm.unitKind === 'manual'
          ? 'Nama satuan Manual wajib diisi.'
          : 'Pilih satuan tujuan terlebih dahulu.'
      )
      return
    }
    if (unitForm.unitKind === 'manual' && STANDARD_UNIT_CODES.includes(target)) {
      notify.error('Satuan Manual tidak boleh memakai kode Berat/Volume baku. Ketik nama satuan sendiri.')
      return
    }

    const automatic = unitChangeIsAutomatic(material)
    const payload: Record<string, unknown> = { newUnit: target, unitKind: unitForm.unitKind }
    let confirmationMessage: string

    if (automatic) {
      confirmationMessage =
        `Satuan ${material.name} akan diubah dari ${material.unit} ke ${target}. ` +
        'Stok akan dikonversi otomatis dalam kelompok yang sama dan perubahannya dicatat.'
    } else {
      const stock = Number(unitForm.newStock)
      if (!Number.isFinite(stock) || stock < 0) {
        notify.error('Stok eksplisit pada satuan tujuan wajib diisi dan tidak boleh negatif.')
        return
      }
      if (!unitForm.reason.trim()) {
        notify.error('Alasan penyesuaian stok wajib diisi untuk perubahan satuan ini.')
        return
      }
      payload.adjustment = { quantity: stock, reason: unitForm.reason.trim() }
      confirmationMessage =
        `Satuan ${material.name} akan diubah dari ${material.unit} ke ${target} tanpa konversi otomatis. ` +
        `Stok akan ditetapkan menjadi ${formatQty(stock)} ${target} dan dicatat sebagai penyesuaian.`
    }

    const confirmed = await notify.confirm({
      title: 'Konfirmasi Perubahan Satuan',
      message: confirmationMessage,
      tone: 'warning',
      confirmLabel: 'Ya, Terapkan',
    })
    if (!confirmed) return

    setSubmittingUnit(true)
    try {
      const res = await api.post(`/materials/${material.id}/unit-change`, payload)
      await fetchMaterials()
      notify.success(
        automatic
          ? `Satuan ${material.name} berhasil dikonversi ke ${target}. ` +
              `Stok menjadi ${formatQty(Number(res.data.currentStock))} ${target} dan perubahannya tercatat.`
          : `Satuan ${material.name} berhasil diubah ke ${target}. ` +
              `Stok ditetapkan menjadi ${formatQty(Number(res.data.currentStock))} ${target} tanpa konversi dan tercatat.`
      )
      setActiveModal(null)
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mengubah satuan bahan baku')
    } finally {
      setSubmittingUnit(false)
    }
  }

  function closeModal() {
    setActiveModal(null)
  }

  /**
   * Tambah bahan baku; saldo awal (opsional) dicatat SEKALI dalam alur yang
   * sama setelah bahan berhasil dibuat. Bila saldo awal gagal, bahan tetap
   * ada dan pengguna diberi tahu supaya tidak mengulang pembuatan bahan.
   */
  async function createMaterial(e: React.FormEvent) {
    e.preventDefault()

    if (!addForm.name.trim()) {
      notify.error('Nama bahan wajib diisi.')
      return
    }
    // Backend tetap memeriksa ulang; ini hanya umpan balik cepat di form.
    // Bahan nonaktif ikut diperiksa karena namanya tetap terdaftar.
    const nameKey = materialNameKey(addForm.name)
    if (materials.some(m => materialNameKey(m.name) === nameKey)) {
      notify.error(DUPLICATE_NAME_MESSAGE)
      return
    }
    const unit =
      addForm.unitKind === 'manual' ? addForm.manualUnit.trim() : addForm.standardUnit.trim()
    if (!unit) {
      notify.error('Satuan bahan wajib diisi.')
      return
    }
    if (addForm.unitKind === 'manual' && STANDARD_UNIT_CODES.includes(unit)) {
      notify.error('Satuan Manual tidak boleh memakai kode Berat/Volume baku. Ketik nama satuan sendiri.')
      return
    }
    if (obEnabled) {
      const obQuantity = Number(addObForm.quantity)
      if (!Number.isFinite(obQuantity) || obQuantity <= 0) {
        notify.error('Jumlah saldo awal harus lebih besar dari nol.')
        return
      }
      if (!addObForm.date) {
        notify.error('Tanggal saldo awal wajib diisi.')
        return
      }
      if (!addObForm.reason.trim()) {
        notify.error('Alasan saldo awal wajib diisi.')
        return
      }
    }

    setSubmittingAdd(true)
    try {
      const created = await api.post('/materials', {
        name: addForm.name,
        unit,
        unitKind: addForm.unitKind,
        description: addForm.description || undefined,
      })
      const newMaterial: Material = created.data.material

      let openingBalanceError: string | null = null
      if (obEnabled) {
        try {
          await api.post(`/materials/${newMaterial.id}/opening-balances`, {
            quantity: Number(addObForm.quantity),
            date: addObForm.date,
            reason: addObForm.reason.trim(),
          })
        } catch (err: any) {
          openingBalanceError = err.response?.data?.message || 'Gagal mencatat saldo awal'
        }
      }

      // Segarkan daftar dulu, baru tampilkan pesan.
      const refreshed = await fetchMaterials()
      if (refreshed) {
        if (openingBalanceError) {
          notify.warning(
            `Bahan baku "${newMaterial.name}" berhasil ditambahkan, tetapi saldo awal gagal dicatat: ${openingBalanceError}`
          )
        } else if (obEnabled) {
          notify.success(
            `Bahan baku "${newMaterial.name}" berhasil ditambahkan beserta saldo awal ${Number(addObForm.quantity).toLocaleString('id-ID')} ${newMaterial.unit}`
          )
        } else {
          notify.success(`Bahan baku "${newMaterial.name}" berhasil ditambahkan`)
        }
      }

      // Kosongkan formulir, termasuk centang saldo awal, agar tidak tercatat dua kali.
      setAddForm(EMPTY_ADD)
      setAddObForm({ ...EMPTY_ADD_OB, date: todayDateCode() })
      setObEnabled(false)
      setActiveModal(null)
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menambah bahan baku')
    } finally {
      setSubmittingAdd(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    try {
      await api.patch(`/materials/${id}`, { isActive: !current })
      const refreshed = await fetchMaterials()
      if (refreshed) {
        notify.success(current ? 'Bahan baku dinonaktifkan' : 'Bahan baku diaktifkan kembali')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mengubah status')
    }
  }

  /**
   * Konfirmasi arsip memakai dialog terpusat. Tindakan baru dijalankan
   * setelah pengguna menekan "Ya, Arsipkan"; Batal/Escape tidak mengubah apa pun.
   */
  async function requestDelete(m: Material) {
    const stock = Number(m.stock ?? 0)
    const confirmed = await notify.confirm({
      title: 'Arsipkan Bahan Baku',
      message:
        `Bahan baku "${m.name}" (${m.unit}) akan diarsipkan dan tidak muncul ` +
        'pada daftar/pilihan operasional baru.',
      tone: 'warning',
      confirmLabel: 'Ya, Arsipkan',
      cancelLabel: 'Batal',
      details: (
        <div>
          {stock > 0 && (
            <div className="alert warning">
              Saldo stok saat ini: {stock.toLocaleString('id-ID')} {m.unit}. Saldo tidak dikurangi
              atau dikosongkan saat pengarsipan.
            </div>
          )}
          <p className="text-muted">
            Tidak ada penghapusan permanen. Penerimaan, saldo awal, pemakaian produksi,
            penyesuaian, dan pergerakan stok tetap tersimpan. Data dapat dipulihkan dengan
            ID yang sama lewat menu Arsip.
          </p>
        </div>
      ),
    })
    if (!confirmed) return

    setDeletingId(m.id)
    try {
      const res = await api.delete(`/materials/${m.id}`)
      const message = res.data?.message || `Bahan baku "${m.name}" berhasil diarsipkan.`
      setMaterials(prev => prev.filter(item => item.id !== m.id))
      await fetchArchivedCount()
      notify.success(message)
      if (res.data?.warning) notify.warning(res.data.warning, 'Catatan Saldo')
      if (movementMaterialId === m.id) {
        setMovementMaterialId('')
        setMovements([])
      }
      if (receiptMaterialId === m.id) {
        setReceiptMaterialId('')
        setReceipts([])
      }
      if (adjForm.materialId === m.id) {
        setAdjForm({ ...EMPTY_ADJ, date: todayDateCode() })
      }
      if (receiptForm.materialId === m.id) {
        setReceiptForm({ ...EMPTY_RECEIPT, receivedAt: todayDateCode() })
      }
      if (obForm.materialId === m.id) {
        setObForm({ ...EMPTY_OB, date: todayDateCode() })
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mengarsipkan bahan baku')
    } finally {
      setDeletingId(null)
    }
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault()

    const targetId = adjForm.materialId
    const quantity = Number(adjForm.quantity)
    const reason = adjForm.reason.trim()
    const date = adjForm.date

    if (!targetId) {
      notify.error('Pilih bahan baku yang akan disesuaikan.')
      return
    }
    if (!Number.isFinite(quantity) || quantity === 0) {
      notify.error('Jumlah penyesuaian tidak boleh nol.')
      return
    }
    if (!date) {
      notify.error('Tanggal penyesuaian wajib diisi.')
      return
    }
    if (!reason) {
      notify.error('Alasan penyesuaian wajib diisi.')
      return
    }

    setSubmittingAdj(true)
    try {
      await api.post('/stock-adjustments', {
        targetType: 'MATERIAL',
        targetId,
        quantity,
        date,
        reason,
      })
      setAdjForm({ ...EMPTY_ADJ, date: todayDateCode() })

      // Muat ulang DULU (stok + riwayat), lalu tampilkan pesan sukses agar
      // pesan tidak langsung terhapus oleh pemuatan ulang.
      const stockRefreshed = await fetchMaterials()
      let historyRefreshed = true
      if (!movementMaterialId || movementMaterialId === targetId) {
        setMovementMaterialId(targetId)
        historyRefreshed = await loadMovements(targetId)
      }
      if (stockRefreshed && historyRefreshed) {
        notify.success('Penyesuaian stok berhasil dicatat')
      }
      setActiveModal(null)
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mencatat penyesuaian stok')
    } finally {
      setSubmittingAdj(false)
    }
  }

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault()

    const targetId = receiptForm.materialId
    const quantity = Number(receiptForm.quantity)
    if (!targetId) {
      notify.error('Pilih bahan baku yang diterima.')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      notify.error('Jumlah penerimaan harus lebih besar dari nol.')
      return
    }

    setSubmittingReceipt(true)
    try {
      await api.post(`/materials/${targetId}/receipts`, {
        quantity,
        receivedAt: receiptForm.receivedAt || undefined,
        note: receiptForm.note || undefined,
      })
      setReceiptForm({ ...EMPTY_RECEIPT, receivedAt: todayDateCode() })

      // Segarkan stok dan riwayat penerimaan, baru tampilkan pesan sukses.
      const stockRefreshed = await fetchMaterials()
      const historyTarget = receiptMaterialId || targetId
      setReceiptMaterialId(historyTarget)
      const historyRefreshed = await loadReceipts(historyTarget)
      if (stockRefreshed && historyRefreshed) {
        notify.success('Penerimaan bahan baku berhasil dicatat')
      }
      setActiveModal(null)
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mencatat penerimaan')
    } finally {
      setSubmittingReceipt(false)
    }
  }

  async function submitOpeningBalance(e: React.FormEvent) {
    e.preventDefault()

    const materialId = obForm.materialId
    const quantity = Number(obForm.quantity)
    const date = obForm.date
    const reason = obForm.reason.trim()

    if (!materialId) {
      notify.error('Pilih bahan baku untuk saldo awal.')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      notify.error('Jumlah saldo awal harus lebih besar dari nol.')
      return
    }
    if (!date) {
      notify.error('Tanggal saldo awal wajib diisi.')
      return
    }
    if (!reason) {
      notify.error('Alasan saldo awal wajib diisi.')
      return
    }

    setSubmittingOb(true)
    try {
      await api.post(`/materials/${materialId}/opening-balances`, { quantity, date, reason })
      setObForm({ ...EMPTY_OB, date: todayDateCode() })

      // Saldo awal menambah stok DAN membuat pergerakan baru — segarkan
      // keduanya dulu, baru tampilkan pesan sukses.
      const stockRefreshed = await fetchMaterials()
      let historyRefreshed = true
      if (!movementMaterialId || movementMaterialId === materialId) {
        setMovementMaterialId(materialId)
        historyRefreshed = await loadMovements(materialId)
      }
      if (stockRefreshed && historyRefreshed) {
        notify.success('Saldo awal bahan baku berhasil dicatat')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mencatat saldo awal')
    } finally {
      setSubmittingOb(false)
    }
  }

  const activeCount = materials.filter((m) => m.isActive).length
  const inactiveCount = archivedCount

  const activeMaterials = materials.filter((m) => m.isActive)
  const movementMaterial = materials.find((m) => m.id === movementMaterialId)
  const movementRows = buildMovementRows(movements, movementMaterial?.stock)
  const movementUnit = movementMaterial?.unit || ''
  const adjMaterial = materials.find((m) => m.id === adjForm.materialId)
  const unitMaterial = materials.find((m) => m.id === unitForm.materialId)
  const unitTarget = unitChangeTarget()
  const unitAutomatic = unitChangeIsAutomatic(unitMaterial)
  const unitPreview = unitAutomatic
    ? convertQuantityValue(Number(unitMaterial?.stock ?? 0), unitMaterial!.unit, unitTarget)
    : null

  /**
   * Sekumpulan aksi yang sama dipakai tabel desktop dan kartu mobile.
   * Urutan DOM menentukan grid 2 kolom × 2 baris:
   *   Tambah Stok | Pensil
   *   Aktifkan/Nonaktifkan | Tempat Sampah
   */
  function renderMaterialActions(m: Material) {
    return (
      <div className="material-action-grid">
        {canReceive && (
          <button
            type="button"
            className="button material-stock-button"
            onClick={() => openReceiptModal(m)}
            disabled={!m.isActive}
            title={m.isActive ? `Tambah stok ${m.name}` : 'Bahan nonaktif tidak dapat menerima stok'}
          >
            <Plus size={16} aria-hidden="true" />
            Tambah Stok
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            className="icon-button material-action-icon"
            onClick={() => openEditModal(m, 'stock')}
            aria-label={`Penyesuaian bahan baku ${m.name}`}
            title="Penyesuaian stok dan satuan"
          >
            <Pencil size={16} aria-hidden="true" />
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            className="button material-toggle-button"
            onClick={() => toggleActive(m.id, m.isActive)}
            title={m.isActive ? 'Nonaktifkan bahan' : 'Aktifkan kembali bahan'}
          >
            {m.isActive ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            className="icon-button material-action-icon material-action-danger"
            onClick={() => requestDelete(m)}
            disabled={deletingId === m.id}
            aria-label={`Arsipkan bahan baku ${m.name}`}
            title="Arsipkan bahan baku"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="container materials-page">
      <div className="page-head">
        <h1 className="page-title">Bahan Baku</h1>
        <p className="page-subtitle">
          Kelola bahan baku, stok, penerimaan, dan riwayat pergerakan stok.
        </p>
      </div>

      {loadError && <div className="alert error">{loadError}</div>}

      {/* Ringkasan stok */}
      <div className="summary-row">
        <div className="summary-item">
          <span className="card-label">Total Bahan</span>
          <span className="summary-value">{materials.length}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Bahan Aktif</span>
          <span className="summary-value">{activeCount}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Diarsipkan</span>
          <span className="summary-value">{inactiveCount}</span>
        </div>
      </div>

      <section className="card section-card">
        <div className="toolbar">
          <h2 className="card-title">Daftar Bahan Baku</h2>
          {isAdmin && (
            <button type="button" className="button" onClick={openAddModal}>
              <Plus size={18} aria-hidden="true" />
              Tambah Bahan
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-muted">Memuat bahan baku...</p>
        ) : materials.length === 0 ? (
          <p className="text-muted">
            Belum ada bahan baku.
            {isAdmin ? ' Gunakan tombol “Tambah Bahan” untuk menambah.' : ' Hubungi Admin untuk menambah bahan.'}
          </p>
        ) : (
              <>
                {/* Desktop: tabel */}
                <div className="table-wrapper desktop-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Nama Bahan</th>
                        <th>Satuan</th>
                        <th>Stok Aktual</th>
                        <th>Status</th>
                        {(isAdmin || canReceive) && <th>Aksi</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <div className="cell-primary">{m.name}</div>
                            {m.description && <div className="cell-secondary">{m.description}</div>}
                          </td>
                          <td>{m.unit}</td>
                          <td className="num">
                            <strong>{Number(m.stock ?? 0).toLocaleString('id-ID')}</strong>
                          </td>
                          <td>
                            {m.isActive ? (
                              <span className="badge success">Aktif</span>
                            ) : (
                              <span className="badge neutral">Nonaktif</span>
                            )}
                          </td>
                          {(isAdmin || canReceive) && (
                            <td>
                              <div className="material-row-actions">{renderMaterialActions(m)}</div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: kartu bahan baku */}
                <div className="mobile-list">
                  {materials.map((m) => (
                    <article className="material-item" key={m.id}>
                      <div className="material-item-main">
                        <div className="material-item-name">{m.name}</div>
                        {m.description && <div className="material-item-desc">{m.description}</div>}
                        <div className="material-item-meta">
                          <span className="material-item-stock">
                            <strong>{Number(m.stock ?? 0).toLocaleString('id-ID')}</strong>
                            <span className="unit">{m.unit}</span>
                          </span>
                          {m.isActive ? (
                            <span className="badge success">Aktif</span>
                          ) : (
                            <span className="badge neutral">Nonaktif</span>
                          )}
                        </div>
                      </div>
                      {(isAdmin || canReceive) && (
                        <div className="material-item-side">{renderMaterialActions(m)}</div>
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Riwayat pergerakan stok (Admin & Operator) */}
          <section className="card section-card">
            <div className="section-head">
              <h2 className="card-title">Riwayat Pergerakan Stok</h2>
              <div className="field filter-field">
                <label htmlFor="movement-material">Bahan baku</label>
                <select
                  id="movement-material"
                  value={movementMaterialId}
                  onChange={(e) => {
                    const value = e.target.value
                    setMovementMaterialId(value)
                    loadMovements(value)
                  }}
                >
                  <option value="">Pilih bahan baku</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-muted">
              Riwayat hanya dapat dilihat — tidak dapat diedit atau dihapus. Kejadian terbaru
              berada paling atas; saldo dihitung mundur dari stok terkini.
            </p>
            <div className="table-wrapper desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>Tanggal Aktivitas</th>
                    <th>Jenis</th>
                    <th>Perubahan</th>
                    <th>Saldo</th>
                    <th>Alasan</th>
                    <th>Dicatat oleh</th>
                    <th>Waktu Pencatatan</th>
                  </tr>
                </thead>
                <tbody>
                  {!movementMaterialId ? (
                    <tr><td colSpan={7} className="text-muted">Pilih bahan baku untuk melihat riwayat pergerakan stok</td></tr>
                  ) : loadingMovements ? (
                    <tr><td colSpan={7}>Memuat riwayat...</td></tr>
                  ) : movementRows.length === 0 ? (
                    <tr><td colSpan={7} className="text-muted">Belum ada pergerakan stok</td></tr>
                  ) : (
                    movementRows.map(({ movement, balance }) => (
                      <tr key={movement.id}>
                        <td>{isoToDateDisplay(movement.occurredAt)}</td>
                        <td>{MOVEMENT_LABELS[movement.type] || movement.type}</td>
                        <td className="num">
                          <strong>{signed(movement.delta)}</strong>{' '}
                          <span className="text-muted">{movementUnit}</span>
                        </td>
                        <td className="num">
                          {balance !== undefined ? balance.toLocaleString('id-ID') : '-'}{' '}
                          <span className="text-muted">{movementUnit}</span>
                        </td>
                        <td className="text-muted">{movement.reason || '-'}</td>
                        <td>{movement.recordedBy?.username || '-'}</td>
                        <td className="text-muted">{isoToDateTimeDisplay(movement.recordedAt)} WIB</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile: kartu riwayat pergerakan */}
            <div className="mobile-list">
              {!movementMaterialId ? (
                <p className="text-muted">Pilih bahan baku untuk melihat riwayat pergerakan stok</p>
              ) : loadingMovements ? (
                <p className="text-muted">Memuat riwayat...</p>
              ) : movementRows.length === 0 ? (
                <p className="text-muted">Belum ada pergerakan stok</p>
              ) : (
                movementRows.map(({ movement, balance }) => (
                  <article className="history-item history-item-split" key={movement.id}>
                    <div className="history-item-main">
                      <div className="history-item-type">{MOVEMENT_LABELS[movement.type] || movement.type}</div>
                      <div className="history-item-date">{isoToDateDisplay(movement.occurredAt)}</div>
                      {movement.reason && <div className="history-item-note">{movement.reason}</div>}
                      <div className="history-item-note">
                        Dicatat oleh: {movement.recordedBy?.username || '-'} · {isoToDateTimeDisplay(movement.recordedAt)} WIB
                      </div>
                    </div>
                    {/* Kanan: jumlah perubahan (numerik utama) + saldo setelahnya */}
                    <div className="history-item-amount">
                      <span className={`history-item-delta ${movement.delta >= 0 ? 'plus' : 'minus'}`}>
                        <strong>{signed(movement.delta)}</strong>
                        <span className="unit">{movementUnit}</span>
                      </span>
                      <span className="history-item-balance">
                        Saldo: {balance !== undefined ? balance.toLocaleString('id-ID') : '-'} {movementUnit}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

      {/* ---------------------------------------------------------------- */}
      {/* Riwayat penerimaan (Admin & Operator) */}
      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Riwayat Penerimaan</h2>
          <div className="field filter-field">
            <label htmlFor="receipt-material">Bahan baku</label>
            <select
              id="receipt-material"
              value={receiptMaterialId}
              onChange={(e) => { setReceiptMaterialId(e.target.value); loadReceipts(e.target.value) }}
            >
              <option value="">Pilih bahan baku</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-wrapper desktop-table">
          <table>
            <thead>
              <tr>
                <th>Bahan</th>
                <th>Jumlah</th>
                <th>Tanggal Penerimaan</th>
                <th>Dicatat oleh</th>
                <th>Waktu Pencatatan</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {!receiptMaterialId ? (
                <tr><td colSpan={6} className="text-muted">Pilih bahan baku untuk melihat riwayat penerimaan</td></tr>
              ) : loadingReceipts ? (
                <tr><td colSpan={6}>Memuat riwayat...</td></tr>
              ) : receipts.length === 0 ? (
                <tr><td colSpan={6} className="text-muted">Belum ada riwayat penerimaan</td></tr>
              ) : (
                receipts.slice(0, 20).map(r => (
                  <tr key={r.id}>
                    <td>{materials.find(m => m.id === r.materialId)?.name || r.materialId}</td>
                    <td className="num">
                      {Number(r.quantity).toLocaleString('id-ID')}{' '}
                      <span className="text-muted">{materials.find(m => m.id === r.materialId)?.unit || ''}</span>
                    </td>
                    <td>{isoToDateDisplay(r.receivedAt || r.createdAt)}</td>
                    <td>{r.recordedBy?.username || '-'}</td>
                    <td className="text-muted">{isoToDateTimeDisplay(r.createdAt)} WIB</td>
                    <td className="text-muted">{r.note || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: kartu riwayat penerimaan */}
        <div className="mobile-list">
          {!receiptMaterialId ? (
            <p className="text-muted">Pilih bahan baku untuk melihat riwayat penerimaan</p>
          ) : loadingReceipts ? (
            <p className="text-muted">Memuat riwayat...</p>
          ) : receipts.length === 0 ? (
            <p className="text-muted">Belum ada riwayat penerimaan</p>
          ) : (
            receipts.slice(0, 20).map(r => (
              <article className="history-item" key={r.id}>
                <div className="history-item-top">
                  <span className="history-item-date">
                    {isoToDateDisplay(r.receivedAt || r.createdAt)}
                  </span>
                  <span className="history-item-type">
                    {materials.find(m => m.id === r.materialId)?.name || r.materialId}
                  </span>
                </div>
                <div className="history-item-delta plus">
                  <strong>+{Number(r.quantity).toLocaleString('id-ID')}</strong>
                  <span className="unit">{materials.find(m => m.id === r.materialId)?.unit || ''}</span>
                </div>
                <div className="history-item-foot">
                  <span className="by">Dicatat oleh: {r.recordedBy?.username || '-'} · {isoToDateTimeDisplay(r.createdAt)} WIB</span>
                  {r.note && <span className="by">{r.note}</span>}
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {/* Modal tambah bahan (+ saldo awal opsional) — Admin */}
      <MaterialModal
        open={activeModal === 'add' && isAdmin}
        title="Tambah Bahan Baku"
        description="Isi data bahan baru. Saldo awal bersifat opsional dan hanya dicatat bila jumlah awalnya diketahui."
        onClose={closeModal}
      >
        <div className="material-modal-body">
          <form onSubmit={createMaterial} className="material-modal-form">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="m-name">Nama Bahan</label>
                <input
                  id="m-name"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Contoh: Sapi Segar"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="m-unit-kind">Jenis Satuan</label>
                <select
                  id="m-unit-kind"
                  value={addForm.unitKind}
                  onChange={e => {
                    const kind = e.target.value as UnitGroup
                    setAddForm((f) => ({
                      ...f,
                      unitKind: kind,
                      standardUnit: UNIT_GROUPS.find((g) => g.group === kind)?.units[0] ?? 'kg',
                    }))
                  }}
                  required
                >
                  {(['mass', 'volume', 'manual'] as UnitGroup[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {UNIT_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="m-unit">Satuan Stok Utama</label>
                {addForm.unitKind === 'manual' ? (
                  <input
                    id="m-unit"
                    value={addForm.manualUnit}
                    onChange={e => setAddForm(f => ({ ...f, manualUnit: e.target.value }))}
                    placeholder="Contoh: bungkus, botol, ikat"
                    maxLength={30}
                    required
                  />
                ) : (
                  <select
                    id="m-unit"
                    value={addForm.standardUnit}
                    onChange={e => setAddForm(f => ({ ...f, standardUnit: e.target.value }))}
                    required
                  >
                    {UNIT_GROUPS
                      .filter((group) => group.group === addForm.unitKind)
                      .map((group) => (
                        <optgroup key={group.group} label={group.label}>
                          {group.units.map(code => (
                            <option key={code} value={code}>
                              {unitOptionLabel(code)}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                  </select>
                )}
                <small>
                  {addForm.unitKind === 'manual'
                    ? 'Ketik nama satuan sendiri. Satuan Manual tidak dikonversi otomatis dan tidak dipakai resep.'
                    : 'Satuan ini menjadi acuan seluruh stok dan perhitungan resep.'}
                </small>
              </div>
            </div>
            <div className="field">
              <label htmlFor="m-desc">Deskripsi (opsional)</label>
              <textarea
                id="m-desc"
                rows={2}
                value={addForm.description}
                onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="optional-block">
              <div className="checkbox-row">
                <input
                  id="ob-enable"
                  type="checkbox"
                  checked={obEnabled}
                  onChange={e => {
                    setObEnabled(e.target.checked)
                    if (!e.target.checked) {
                      setAddObForm({ ...EMPTY_ADD_OB, date: todayDateCode() })
                    } else if (!addObForm.date) {
                      setAddObForm(f => ({ ...f, date: todayDateCode() }))
                    }
                  }}
                />
                <label htmlFor="ob-enable">Catat saldo awal sekaligus (opsional)</label>
              </div>
              {obEnabled ? (
                <div className="form-row" style={{ marginTop: '1rem' }}>
                  <div className="field">
                    <label htmlFor="ob-qty-new">Jumlah Saldo Awal</label>
                    <input
                      id="ob-qty-new"
                      type="number"
                      step="0.001"
                      min="0"
                      value={addObForm.quantity}
                      onChange={e => setAddObForm(f => ({ ...f, quantity: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ob-date-new">Tanggal Saldo Awal</label>
                    <DateField
                      id="ob-date-new"
                      value={addObForm.date}
                      onChange={(date) => setAddObForm(f => ({ ...f, date }))}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ob-reason-new">Alasan</label>
                    <input
                      id="ob-reason-new"
                      value={addObForm.reason}
                      onChange={e => setAddObForm(f => ({ ...f, reason: e.target.value }))}
                      required
                    />
                  </div>
                </div>
              ) : (
                <p className="text-muted optional-hint">
                  Tanpa saldo awal, bahan tetap dibuat dengan stok 0 dan dapat menerima
                  penerimaan atau saldo awal susulan.
                </p>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={closeModal}>
                Batal
              </button>
              <button className="button" disabled={submittingAdd}>
                {submittingAdd
                  ? 'Menyimpan...'
                  : obEnabled ? 'Simpan Bahan + Saldo Awal' : 'Simpan Bahan'}
              </button>
            </div>
          </form>

          <details className="material-ob-details">
            <summary>Catat saldo awal bahan yang sudah ada</summary>
            <p className="text-muted">
              Untuk bahan yang sudah terdaftar tetapi saldo awalnya belum tercatat. Bahan baru
              cukup dicatat lewat formulir di atas — jangan mencatat saldo awal dua kali untuk
              bahan yang sama. Tanggal, alasan, dan pengguna pencatat tersimpan pada riwayat
              pergerakan.
            </p>
            <form onSubmit={submitOpeningBalance} className="material-modal-form">
              <div className="form-row">
                <div className="field">
                  <label htmlFor="ob-material">Bahan Baku</label>
                  <select
                    id="ob-material"
                    value={obForm.materialId}
                    onChange={e => setObForm(f => ({ ...f, materialId: e.target.value }))}
                    required
                  >
                    <option value="">Pilih bahan baku</option>
                    {activeMaterials.map(m => (
                      <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ob-qty">Jumlah</label>
                  <input
                    id="ob-qty"
                    type="number"
                    step="0.001"
                    min="0"
                    value={obForm.quantity}
                    onChange={e => setObForm(f => ({ ...f, quantity: e.target.value }))}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="ob-date">Tanggal Saldo Awal</label>
                  <DateField
                    id="ob-date"
                    value={obForm.date}
                    onChange={(date) => setObForm(f => ({ ...f, date }))}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="ob-reason">Alasan</label>
                  <input
                    id="ob-reason"
                    value={obForm.reason}
                    onChange={e => setObForm(f => ({ ...f, reason: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="button secondary" onClick={closeModal}>
                  Tutup
                </button>
                <button className="button" disabled={submittingOb}>
                  {submittingOb ? 'Menyimpan...' : 'Catat Saldo Awal'}
                </button>
              </div>
            </form>
          </details>
        </div>
      </MaterialModal>

      {/* Modal penerimaan stok (Admin & Operator) */}
      <MaterialModal
        open={activeModal === 'receipt'}
        title="Tambah Stok Bahan Baku"
        description="Penerimaan menambah stok bahan dan tercatat pada riwayat pergerakan stok."
        onClose={closeModal}
      >
        <div className="material-modal-body">
          <form onSubmit={submitReceipt} className="material-modal-form">
            <div className="field">
              <label htmlFor="rs-material">Bahan Baku</label>
              <select
                id="rs-material"
                value={receiptForm.materialId}
                onChange={e => setReceiptForm(f => ({ ...f, materialId: e.target.value }))}
                required
              >
                <option value="">Pilih bahan baku</option>
                {activeMaterials.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                ))}
              </select>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="rs-qty">Jumlah</label>
                <input
                  id="rs-qty"
                  type="number"
                  step="0.001"
                  min="0"
                  value={receiptForm.quantity}
                  onChange={e => setReceiptForm(f => ({ ...f, quantity: e.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="rs-date">Tanggal Penerimaan (opsional)</label>
                <DateField
                  id="rs-date"
                  value={receiptForm.receivedAt}
                  onChange={(receivedAt) => setReceiptForm(f => ({ ...f, receivedAt }))}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="rs-note">Catatan (opsional)</label>
              <input
                id="rs-note"
                value={receiptForm.note}
                onChange={e => setReceiptForm(f => ({ ...f, note: e.target.value }))}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={closeModal}>
                Batal
              </button>
              <button className="button" disabled={submittingReceipt}>
                {submittingReceipt ? 'Menyimpan...' : 'Catat Penerimaan'}
              </button>
            </div>
          </form>
        </div>
      </MaterialModal>

      {/* Satu modal bertab untuk pensil: Penyesuaian Stok & Penyesuaian Satuan */}
      <MaterialModal
        open={activeModal === 'edit' && isAdmin}
        title="Penyesuaian Bahan Baku"
        description="Stok dan satuan utama diubah dengan pencatatan yang jelas. Pilih tab yang dibutuhkan."
        onClose={closeModal}
      >
        <div className="material-modal-body">
          <div className="tab-nav" role="tablist" aria-label="Jenis penyesuaian bahan baku">
            <button
              type="button"
              role="tab"
              id="edit-tab-stock"
              aria-controls="edit-panel-stock"
              aria-selected={editTab === 'stock'}
              className={`tab-btn ${editTab === 'stock' ? 'active' : ''}`}
              onClick={() => setEditTab('stock')}
            >
              Penyesuaian Stok
            </button>
            <button
              type="button"
              role="tab"
              id="edit-tab-unit"
              aria-controls="edit-panel-unit"
              aria-selected={editTab === 'unit'}
              className={`tab-btn ${editTab === 'unit' ? 'active' : ''}`}
              onClick={() => setEditTab('unit')}
            >
              Penyesuaian Satuan
            </button>
          </div>

          {editTab === 'stock' ? (
            <div
              className="tab-panel"
              role="tabpanel"
              id="edit-panel-stock"
              aria-labelledby="edit-tab-stock"
            >
              <form onSubmit={submitAdjustment} className="material-modal-form">
                <div className="field">
                  <label htmlFor="adj-material">Bahan Baku</label>
                  <select
                    id="adj-material"
                    value={adjForm.materialId}
                    onChange={e => setAdjForm(f => ({ ...f, materialId: e.target.value }))}
                    required
                  >
                    <option value="">Pilih bahan baku</option>
                    {materials.map(m => (
                      <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                    ))}
                  </select>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="adj-quantity">Jumlah (bertanda)</label>
                    <input
                      id="adj-quantity"
                      type="number"
                      step="0.001"
                      value={adjForm.quantity}
                      onChange={e => setAdjForm(f => ({ ...f, quantity: e.target.value }))}
                      placeholder="cth. -2.5"
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="adj-date">Tanggal Penyesuaian</label>
                    <DateField
                      id="adj-date"
                      value={adjForm.date}
                      onChange={(date) => setAdjForm(f => ({ ...f, date }))}
                      required
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="adj-reason">Alasan</label>
                  <input
                    id="adj-reason"
                    value={adjForm.reason}
                    onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))}
                    required
                  />
                </div>
                {adjMaterial && (
                  <p className="text-muted optional-hint">
                    Stok {adjMaterial.name} saat ini: {Number(adjMaterial.stock ?? 0).toLocaleString('id-ID')} {adjMaterial.unit}
                    {' '}— hasil penyesuaian tidak boleh membuat stok menjadi negatif.
                  </p>
                )}
                <div className="modal-actions">
                  <button type="button" className="button secondary" onClick={closeModal}>
                    Batal
                  </button>
                  <button className="button" disabled={submittingAdj}>
                    {submittingAdj ? 'Menyimpan...' : 'Catat Penyesuaian'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div
              className="tab-panel"
              role="tabpanel"
              id="edit-panel-unit"
              aria-labelledby="edit-tab-unit"
            >
              <form onSubmit={submitUnitChange} className="material-modal-form">
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="unit-current-material">Bahan Baku</label>
                    <input
                      id="unit-current-material"
                      value={unitMaterial?.name || ''}
                      readOnly
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="unit-current">Satuan Saat Ini</label>
                    <input id="unit-current" value={unitMaterial?.unit || ''} readOnly />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="unit-kind">Jenis Satuan Tujuan</label>
                  <select
                    id="unit-kind"
                    value={unitForm.unitKind}
                    onChange={e => {
                      const kind = e.target.value as UnitGroup
                      setUnitForm(f => ({
                        ...f,
                        unitKind: kind,
                        standardUnit:
                          kind === 'mass' ? 'g' : kind === 'volume' ? 'L' : f.standardUnit,
                      }))
                    }}
                    required
                  >
                    {(['mass', 'volume', 'manual'] as UnitGroup[]).map(kind => (
                      <option key={kind} value={kind}>{UNIT_KIND_LABELS[kind]}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="unit-change-new">Satuan Tujuan</label>
                  {unitForm.unitKind === 'manual' ? (
                    <input
                      id="unit-change-new"
                      value={unitForm.manualUnit}
                      onChange={e => setUnitForm(f => ({ ...f, manualUnit: e.target.value }))}
                      placeholder="Contoh: bungkus, botol, ikat"
                      maxLength={30}
                      required
                    />
                  ) : (
                    <select
                      id="unit-change-new"
                      value={unitForm.standardUnit}
                      onChange={e => setUnitForm(f => ({ ...f, standardUnit: e.target.value }))}
                      required
                    >
                      {UNIT_GROUPS
                        .filter(group => group.group === unitForm.unitKind)
                        .map(group => (
                          <optgroup key={group.group} label={group.label}>
                            {group.units.map(code => (
                              <option key={code} value={code}>{unitOptionLabel(code)}</option>
                            ))}
                          </optgroup>
                        ))}
                    </select>
                  )}
                  <small>Konversi otomatis hanya Berat↔Berat atau Volume↔Volume.</small>
                </div>
                {unitMaterial && unitTarget && (
                  <div className="optional-block">
                    {unitAutomatic ? (
                      <p>
                        Pratinjau konversi: {formatQty(Number(unitMaterial.stock ?? 0))} {unitMaterial.unit}
                        {' → '}
                        {unitPreview === null
                          ? 'satuan tidak kompatibel'
                          : `${formatQty(unitPreview)} ${unitTarget}`}
                      </p>
                    ) : (
                      <p>
                        Tanpa konversi otomatis: stok lama {formatQty(Number(unitMaterial.stock ?? 0))}{' '}
                        {unitMaterial.unit} tidak diubah oleh sistem. Tentukan stok aktual di satuan baru.
                      </p>
                    )}
                  </div>
                )}
                {!unitAutomatic && (
                  <>
                    <div className="field">
                      <label htmlFor="unit-new-stock">Stok Aktual di Satuan Baru</label>
                      <input
                        id="unit-new-stock"
                        type="number"
                        min="0"
                        step="0.001"
                        value={unitForm.newStock}
                        onChange={e => setUnitForm(f => ({ ...f, newStock: e.target.value }))}
                        placeholder="0"
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="unit-change-reason">Alasan Penyesuaian</label>
                      <input
                        id="unit-change-reason"
                        value={unitForm.reason}
                        onChange={e => setUnitForm(f => ({ ...f, reason: e.target.value }))}
                        placeholder="Contoh: Hasil stok opname"
                        required
                      />
                    </div>
                  </>
                )}
                <div className="modal-actions">
                  <button type="button" className="button secondary" onClick={closeModal}>
                    Batal
                  </button>
                  <button className="button" disabled={submittingUnit}>
                    {submittingUnit
                      ? 'Menyimpan...'
                      : unitAutomatic
                        ? 'Terapkan Konversi'
                        : 'Terapkan Penyesuaian'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </MaterialModal>

    </div>
  )
}
