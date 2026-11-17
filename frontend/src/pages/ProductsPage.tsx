import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import api from '../lib/api'
import { DateField } from '../components/DateField'
import { PhotoField } from '../components/PhotoField'
import { useAuth } from '../hooks/useAuth'
import { useNotify } from '../components/NotificationProvider'
import { isoToDateDisplay, isoToDateTimeDisplay } from '../utils/dates'
import { productPhotoUrl, uploadProductPhoto } from '../utils/product-photo'
import { recipeUnitOptions } from '../utils/units'

interface RecipeMaterial {
  id: string
  name: string
  unit: string
  isActive: boolean
}

interface ProductRecipeItem {
  materialId: string
  material?: RecipeMaterial
  quantityPerUnit: number
  recipeUnit: string
}

interface ProductNutritionComponent {
  name: string
  amount?: number
  unit?: string
  akgPercent?: number
}

interface ProductNutrition {
  servingSizeAmount?: number
  servingSizeUnit?: string
  servingsPerPackage?: number
  components?: ProductNutritionComponent[]
}

interface Product {
  id: string
  name: string
  unit: string
  sellingPrice: number
  description?: string | null
  composition?: string | null
  storageInstructions?: string | null
  photoUrl?: string | null
  stock?: number
  batchCount?: number
  isActive: boolean
  recipe?: ProductRecipeItem[]
  nutrition?: ProductNutrition | null
}

interface MaterialOption {
  id: string
  name: string
  unit: string
  isActive: boolean
}

type MovementType =
  | 'PRODUCTION_YIELD'
  | 'YIELD_CORRECTION'
  | 'OPENING_BALANCE'
  | 'ADJUSTMENT'
  | 'SALE'
  | 'SALE_CANCELLATION'

interface ProductStockMovement {
  id: string
  product: { id: string; name: string; unit: string }
  batch: { id: string; code: string; currentStock: number }
  type: MovementType
  quantity: number
  stockIn: number
  stockOut: number
  balanceAfter: number
  batchBalanceAfter: number
  occurredAt: string
  recordedAt: string
  recordedBy: { id: string; username: string; name?: string | null } | null
  reason?: string | null
  reference?: { kind: string; id: string; label: string } | null
  sourceId?: string | null
  isHistoricalFallback: boolean
}

interface ProductBatchOption {
  id: string
  code: string
  stock: number
}

interface ProductHistorySummary {
  movementCount: number
  totalIn: number
  totalOut: number
  currentStock: number
  reconstructedStock: number
  consistent: boolean
  hasHistoricalFallback: boolean
}

const EMPTY_FORM = {
  name: '',
  unit: '',
  sellingPrice: '',
  description: '',
  composition: '',
  storageInstructions: '',
}

const STANDARD_NUTRITION_COMPONENTS = [
  'Energi Total',
  'Lemak Total',
  'Lemak Jenuh',
  'Protein',
  'Karbohidrat Total',
  'Serat Pangan',
  'Gula Total',
  'Natrium',
]

type NutritionComponentForm = {
  name: string
  amount: string
  unit: string
  akgPercent: string
}

type NutritionForm = {
  servingSizeAmount: string
  servingSizeUnit: string
  servingsPerPackage: string
  components: NutritionComponentForm[]
}

function emptyNutritionForm(): NutritionForm {
  return {
    servingSizeAmount: '',
    servingSizeUnit: '',
    servingsPerPackage: '',
    components: STANDARD_NUTRITION_COMPONENTS.map((name) => ({
      name,
      amount: '',
      unit: '',
      akgPercent: '',
    })),
  }
}

function nutritionToForm(nutrition?: ProductNutrition | null): NutritionForm {
  if (!nutrition) return emptyNutritionForm()
  const existing = (nutrition.components ?? []).map((c) => ({
    name: c.name ?? '',
    amount: c.amount === undefined || c.amount === null ? '' : String(c.amount),
    unit: c.unit ?? '',
    akgPercent: c.akgPercent === undefined || c.akgPercent === null ? '' : String(c.akgPercent),
  }))
  const byLower = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]))
  const ordered: NutritionComponentForm[] = []
  for (const name of STANDARD_NUTRITION_COMPONENTS) {
    const found = byLower.get(name.toLowerCase())
    if (found) {
      ordered.push(found)
      byLower.delete(name.toLowerCase())
    } else {
      ordered.push({ name, amount: '', unit: '', akgPercent: '' })
    }
  }
  for (const item of existing) {
    if (byLower.has(item.name.trim().toLowerCase())) {
      ordered.push(item)
      byLower.delete(item.name.trim().toLowerCase())
    }
  }
  return {
    servingSizeAmount:
      nutrition.servingSizeAmount === undefined || nutrition.servingSizeAmount === null
        ? ''
        : String(nutrition.servingSizeAmount),
    servingSizeUnit: nutrition.servingSizeUnit ?? '',
    servingsPerPackage:
      nutrition.servingsPerPackage === undefined || nutrition.servingsPerPackage === null
        ? ''
        : String(nutrition.servingsPerPackage),
    components: ordered.length > 0 ? ordered : emptyNutritionForm().components,
  }
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  PRODUCTION_YIELD: 'Produksi',
  YIELD_CORRECTION: 'Koreksi Produksi',
  OPENING_BALANCE: 'Saldo Awal',
  ADJUSTMENT: 'Penyesuaian Stok',
  SALE: 'Penjualan',
  SALE_CANCELLATION: 'Pembatalan Penjualan',
}

const MOVEMENT_FILTER_OPTIONS: Array<{ value: MovementType; label: string }> = [
  { value: 'PRODUCTION_YIELD', label: 'Produksi' },
  { value: 'SALE', label: 'Penjualan' },
  { value: 'SALE_CANCELLATION', label: 'Pembatalan Penjualan' },
  { value: 'ADJUSTMENT', label: 'Penyesuaian Stok' },
  { value: 'YIELD_CORRECTION', label: 'Koreksi Produksi' },
  { value: 'OPENING_BALANCE', label: 'Saldo Awal' },
]

const quantityFormatter = new Intl.NumberFormat('id-ID', {
  maximumFractionDigits: 3,
})

function formatQuantity(value: number): string {
  return quantityFormatter.format(value)
}

/** Tanggal bisnis aktivitas pada kalender WIB, ditampilkan DD/MM/YYYY. */
function movementDate(iso: string): string {
  return isoToDateDisplay(iso)
}

function movementRecorder(row: ProductStockMovement): string {
  return row.recordedBy?.name || row.recordedBy?.username || 'Tidak tercatat'
}

interface ProductModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * Modal terpusat untuk form tambah/edit produk. Memakai kelas modal
 * NutriLokal yang sudah ada, mengunci gulir halaman, menjebak fokus, dan
 * mendukung Escape serta klik backdrop.
 */
function ProductModal({ open, title, onClose, children }: ProductModalProps) {
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
    ;(firstField ?? panel)?.focus()

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
    <div className="modal-root product-modal-root">
      <div className="modal-overlay" onClick={onClose} />
      <div
        ref={panelRef}
        className="modal-panel product-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="product-modal-head">
          <h2 className="modal-title" id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button product-modal-close"
            onClick={onClose}
            aria-label="Tutup dialog produk"
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

export function ProductsPage() {
  const { user } = useAuth()
  const notify = useNotify()
  const isAdmin = user?.role === 'ADMIN'

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  // Kegagalan memuat daftar produk tetap tampil di halaman. Pesan hasil
  // tindakan (simpan, ubah status, hapus, unggah foto) memakai dialog.
  const [loadError, setLoadError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  // Foto pada form: `undefined` = tidak diubah, `File` = unggah/ganti,
  // `null` = hapus foto yang tersimpan.
  const [photoFile, setPhotoFile] = useState<File | null | undefined>(undefined)
  const [photoNotice, setPhotoNotice] = useState<string | null>(null)

  // Resep bahan baku (hanya Admin dapat mengubah; disimpan bersama produk).
  type RecipeFormRow = { materialId: string; quantityPerUnit: string; recipeUnit: string }
  const [materials, setMaterials] = useState<MaterialOption[]>([])
  const [recipeRows, setRecipeRows] = useState<RecipeFormRow[]>([])
  const [nutritionForm, setNutritionForm] = useState<NutritionForm>(emptyNutritionForm())
  const [nutritionOpen, setNutritionOpen] = useState(false)

  // Mode edit (hanya Admin): id produk yang sedang diubah + datanya.
  const [editTarget, setEditTarget] = useState<Product | null>(null)

  // Proses hapus berjalan setelah pengguna menyetujui dialog konfirmasi.
  const [deleting, setDeleting] = useState(false)

  // Riwayat pergerakan stok produk (Admin & Operator): seluruh filter
  // dikirim ke backend; tidak ada penyaringan data yang sudah dimuat di UI.
  const [historyProductId, setHistoryProductId] = useState('')
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')
  const [historyType, setHistoryType] = useState('')
  const [historyBatchId, setHistoryBatchId] = useState('')
  const [historyBatches, setHistoryBatches] = useState<ProductBatchOption[]>([])
  const [historyMovements, setHistoryMovements] = useState<ProductStockMovement[]>([])
  const [historySummary, setHistorySummary] = useState<ProductHistorySummary | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  async function fetchProducts(): Promise<boolean> {
    try {
      const res = await api.get('/products')
      setProducts(res.data.data || res.data)
      setLoadError(null)
      return true
    } catch (err: any) {
      setLoadError(err.response?.data?.message || 'Gagal memuat produk')
      return false
    } finally {
      setLoading(false)
    }
  }

  async function fetchMaterials(): Promise<void> {
    try {
      const res = await api.get('/materials')
      setMaterials(res.data.data || res.data || [])
    } catch {
      // Gagal memuat daftar bahan tidak boleh menghalangi pengelolaan produk.
      setMaterials([])
    }
  }

  useEffect(() => {
    fetchProducts()
    fetchMaterials()
  }, [])

  async function loadHistoryBatches(productId: string): Promise<void> {
    if (!productId) {
      setHistoryBatches([])
      return
    }
    try {
      const res = await api.get('/batches', { params: { productId } })
      setHistoryBatches(res.data.data || res.data || [])
    } catch (err: any) {
      setHistoryBatches([])
      setHistoryError(err.response?.data?.message || 'Gagal memuat daftar batch produk')
    }
  }

  async function fetchProductHistory(
    productId = historyProductId,
    overrides: Partial<{ from: string; to: string; type: string; batchId: string }> = {},
  ): Promise<boolean> {
    if (!productId) {
      setHistoryMovements([])
      setHistorySummary(null)
      setHistoryLoaded(false)
      setHistoryError(null)
      return false
    }

    const from = overrides.from ?? historyFrom
    const to = overrides.to ?? historyTo
    const type = overrides.type ?? historyType
    const batchId = overrides.batchId ?? historyBatchId

    if (from && to && from > to) {
      setHistoryError('Tanggal Dari tidak boleh setelah tanggal Sampai.')
      return false
    }

    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const params: Record<string, string> = {}
      if (from) params.from = from
      if (to) params.to = to
      if (type) params.type = type
      if (batchId) params.batchId = batchId

      const res = await api.get(`/products/${productId}/stock-movements`, { params })
      setHistoryMovements(res.data.data || [])
      setHistorySummary(res.data.summary || null)
      setHistoryLoaded(true)
      return true
    } catch (err: any) {
      setHistoryMovements([])
      setHistorySummary(null)
      setHistoryLoaded(false)
      setHistoryError(err.response?.data?.message || 'Gagal memuat riwayat pergerakan stok produk')
      return false
    } finally {
      setHistoryLoading(false)
    }
  }

  /**
   * Memilih produk sekaligus memuat batch dan riwayatnya. Filter tanggal,
   * jenis, dan batch lain baru diterapkan saat tombol Terapkan Filter ditekan.
   */
  async function changeHistoryProduct(productId: string): Promise<void> {
    setHistoryProductId(productId)
    setHistoryBatchId('')
    setHistoryMovements([])
    setHistorySummary(null)
    setHistoryLoaded(false)
    setHistoryError(null)

    if (!productId) {
      setHistoryBatches([])
      return
    }

    await loadHistoryBatches(productId)
    await fetchProductHistory(productId, { batchId: '' })
  }

  async function applyHistoryFilters(e: React.FormEvent) {
    e.preventDefault()
    await fetchProductHistory()
  }

  function resetHistoryFilters() {
    setHistoryProductId('')
    setHistoryFrom('')
    setHistoryTo('')
    setHistoryType('')
    setHistoryBatchId('')
    setHistoryBatches([])
    setHistoryMovements([])
    setHistorySummary(null)
    setHistoryLoading(false)
    setHistoryLoaded(false)
    setHistoryError(null)
  }

  function openForm() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setRecipeRows([])
    setNutritionForm(emptyNutritionForm())
    setNutritionOpen(false)
    setPhotoFile(undefined)
    setPhotoNotice(null)
    setFormOpen(true)
  }

  function openEdit(product: Product) {
    setEditTarget(product)
    setForm({
      name: product.name,
      unit: product.unit,
      sellingPrice: String(product.sellingPrice),
      description: product.description ?? '',
      composition: product.composition ?? '',
      storageInstructions: product.storageInstructions ?? '',
    })
    setRecipeRows(
      (product.recipe ?? []).map((item) => ({
        materialId: item.materialId,
        quantityPerUnit: String(item.quantityPerUnit),
        recipeUnit: item.recipeUnit,
      })),
    )
    setNutritionForm(nutritionToForm(product.nutrition))
    setNutritionOpen(false)
    setPhotoFile(undefined)
    setPhotoNotice(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditTarget(null)
    setRecipeRows([])
    setNutritionForm(emptyNutritionForm())
    setNutritionOpen(false)
    setPhotoFile(undefined)
    setPhotoNotice(null)
  }

  function addRecipeRow() {
    setRecipeRows((rows) => [...rows, { materialId: '', quantityPerUnit: '', recipeUnit: '' }])
  }

  function removeRecipeRow(index: number) {
    setRecipeRows((rows) => rows.filter((_, i) => i !== index))
  }

  function updateRecipeRow(index: number, patch: Partial<RecipeFormRow>) {
    setRecipeRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function nutritionStatus(): { label: string; filled: boolean } {
    const hasServing =
      nutritionForm.servingSizeAmount.trim() !== '' ||
      nutritionForm.servingSizeUnit.trim() !== '' ||
      nutritionForm.servingsPerPackage.trim() !== ''
    const filledComponents = nutritionForm.components.filter(
      (c) =>
        c.amount.trim() !== '' ||
        c.unit.trim() !== '' ||
        c.akgPercent.trim() !== '',
    ).length
    if (!hasServing && filledComponents === 0) {
      return { label: 'Belum diisi', filled: false }
    }
    const parts: string[] = []
    if (filledComponents > 0) parts.push(`${filledComponents} komponen terisi`)
    if (hasServing) parts.push('takaran/sajian terisi')
    return { label: parts.join(' · '), filled: true }
  }

  function addNutritionComponent() {
    setNutritionForm((f) => ({
      ...f,
      components: [...f.components, { name: '', amount: '', unit: '', akgPercent: '' }],
    }))
  }

  function removeNutritionComponent(index: number) {
    setNutritionForm((f) => ({
      ...f,
      components: f.components.filter((_, i) => i !== index),
    }))
  }

  function updateNutritionComponent(index: number, patch: Partial<NutritionComponentForm>) {
    setNutritionForm((f) => ({
      ...f,
      components: f.components.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }))
  }

  function parseOptionalNumberInput(
    raw: string,
    label: string,
    maxDecimals: number,
  ): { value?: number; error?: string } {
    const text = raw.trim()
    if (!text) return {}
    const value = Number(text)
    if (!Number.isFinite(value)) return { error: `${label} harus berupa angka.` }
    if (value < 0) return { error: `${label} tidak boleh kurang dari 0.` }
    if (String(text).includes('e') || String(text).includes('E')) return { error: `${label} tidak valid.` }
    const [, dec] = text.split('.')
    if (dec && dec.length > maxDecimals) {
      return { error: `${label} maksimal ${maxDecimals} angka di belakang koma.` }
    }
    return { value }
  }

  function buildNutritionPayload(): { nutrition: ProductNutrition | null } | { error: string } {
    const servingAmount = parseOptionalNumberInput(
      nutritionForm.servingSizeAmount,
      'Takaran saji',
      3,
    )
    if (servingAmount.error) return { error: servingAmount.error }
    const servingsPerPackage = parseOptionalNumberInput(
      nutritionForm.servingsPerPackage,
      'Jumlah sajian per kemasan',
      3,
    )
    if (servingsPerPackage.error) return { error: servingsPerPackage.error }

    const components: ProductNutritionComponent[] = []
    for (let i = 0; i < nutritionForm.components.length; i++) {
      const row = nutritionForm.components[i]
      const name = row.name.trim()
      const unit = row.unit.trim()
      const amount = parseOptionalNumberInput(row.amount, `Jumlah komponen gizi baris ${i + 1}`, 3)
      if (amount.error) return { error: amount.error }
      const akg = parseOptionalNumberInput(row.akgPercent, `%AKG komponen gizi baris ${i + 1}`, 2)
      if (akg.error) return { error: akg.error }
      const hasAny = !!name || amount.value !== undefined || !!unit || akg.value !== undefined
      if (!hasAny) continue
      if (!name) return { error: `Nama komponen gizi baris ${i + 1} wajib diisi.` }
      const item: ProductNutritionComponent = { name }
      if (amount.value !== undefined) item.amount = amount.value
      if (unit) item.unit = unit
      if (akg.value !== undefined) item.akgPercent = akg.value
      components.push(item)
    }

    const nutrition: ProductNutrition = {}
    if (servingAmount.value !== undefined) nutrition.servingSizeAmount = servingAmount.value
    const servingUnit = nutritionForm.servingSizeUnit.trim()
    if (servingUnit) nutrition.servingSizeUnit = servingUnit
    if (servingsPerPackage.value !== undefined) nutrition.servingsPerPackage = servingsPerPackage.value
    if (components.length > 0) nutrition.components = components

    const hasData =
      nutrition.servingSizeAmount !== undefined ||
      !!nutrition.servingSizeUnit ||
      nutrition.servingsPerPackage !== undefined ||
      (nutrition.components?.length ?? 0) > 0
    return { nutrition: hasData ? nutrition : null }
  }

    function buildRecipePayload(): { recipe: Array<{ materialId: string; quantityPerUnit: number; recipeUnit: string }> } | { error: string } {
    const recipe: Array<{ materialId: string; quantityPerUnit: number; recipeUnit: string }> = []
    const seen = new Set<string>()
    for (let i = 0; i < recipeRows.length; i++) {
      const row = recipeRows[i]
      const filled = row.materialId || row.quantityPerUnit || row.recipeUnit
      if (!filled) continue
      if (!row.materialId || !row.quantityPerUnit || !row.recipeUnit) {
        return { error: `Lengkapi bahan resep baris ${i + 1} (bahan, jumlah, dan satuan).` }
      }
      if (seen.has(row.materialId)) {
        return { error: 'Bahan yang sama tidak boleh dimasukkan berulang dalam satu resep.' }
      }
      seen.add(row.materialId)
      const qty = Number(row.quantityPerUnit)
      if (!Number.isFinite(qty) || qty <= 0) {
        return { error: `Jumlah kebutuhan resep baris ${i + 1} harus lebih besar dari nol.` }
      }
      recipe.push({ materialId: row.materialId, quantityPerUnit: qty, recipeUnit: row.recipeUnit.trim() })
    }
    return { recipe }
  }

  /**
   * Menyelaraskan foto dengan pilihan pengguna: hapus foto lama, unggah foto
   * baru, atau tidak mengubah apa pun. Mengembalikan pesan kegagalan (atau
   * null) — kegagalan unggah tidak menggagalkan data produk yang sudah
   * tersimpan, tetapi selalu dilaporkan.
   */
  async function syncPhoto(productId: string): Promise<string | null> {
    try {
      if (photoFile === null) {
        await api.delete(`/products/${productId}/photo`)
      } else if (photoFile) {
        await uploadProductPhoto(productId, photoFile)
      }
      return null
    } catch (err: any) {
      return err.response?.data?.message || 'Foto gagal disimpan'
    }
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault()
    const recipePayload = buildRecipePayload()
    if ('error' in recipePayload) {
      notify.error(recipePayload.error)
      return
    }
    const nutritionPayload = buildNutritionPayload()
    if ('error' in nutritionPayload) {
      notify.error(nutritionPayload.error)
      return
    }
    setSubmitting(true)
    let created: Product | null = null
    try {
      const res = await api.post('/products', {
        name: form.name,
        unit: form.unit,
        sellingPrice: Number(form.sellingPrice),
        description: form.description || undefined,
        composition: form.composition || undefined,
        storageInstructions: form.storageInstructions || undefined,
        recipe: recipePayload.recipe,
        nutrition: nutritionPayload.nutrition,
      })
      created = res.data.product as Product
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menambah produk')
      setSubmitting(false)
      return
    }

    const photoError = created ? await syncPhoto(created.id) : null
    closeForm()
    const refreshed = await fetchProducts()
    if (refreshed) {
      if (photoError) {
        notify.warning(`Produk berhasil ditambahkan, tetapi foto gagal disimpan: ${photoError}`)
      } else if (photoFile) {
        notify.success('Produk berhasil ditambahkan beserta fotonya.')
      } else {
        notify.success('Produk berhasil ditambahkan')
      }
    }
    setSubmitting(false)
  }

  async function updateProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    const recipePayload = buildRecipePayload()
    if ('error' in recipePayload) {
      notify.error(recipePayload.error)
      return
    }
    const nutritionPayload = buildNutritionPayload()
    if ('error' in nutritionPayload) {
      notify.error(nutritionPayload.error)
      return
    }

    setSubmitting(true)
    try {
      await api.patch(`/products/${editTarget.id}`, {
        name: form.name,
        unit: form.unit,
        sellingPrice: Number(form.sellingPrice),
        description: form.description,
        composition: form.composition,
        storageInstructions: form.storageInstructions,
        recipe: recipePayload.recipe,
        nutrition: nutritionPayload.nutrition,
      })
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menyimpan perubahan produk')
      setSubmitting(false)
      return
    }

    const photoError = await syncPhoto(editTarget.id)
    closeForm()
    const refreshed = await fetchProducts()
    if (refreshed) {
      if (photoError) {
        notify.warning(`Perubahan produk tersimpan, tetapi foto gagal disimpan: ${photoError}`)
      } else {
        notify.success('Perubahan produk berhasil disimpan')
      }
    }
    setSubmitting(false)
  }

  async function toggleActive(id: string, current: boolean) {
    try {
      await api.patch(`/products/${id}`, { isActive: !current })
      const refreshed = await fetchProducts()
      if (refreshed) {
        notify.success(current ? 'Produk dinonaktifkan' : 'Produk diaktifkan kembali')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mengubah status')
    }
  }

  /**
   * Konfirmasi hapus memakai dialog terpusat. Rincian stok dan batch tetap
   * ditampilkan agar Admin memahami dampak tindakan sebelum menyetujuinya.
   */
  async function requestDelete(product: Product) {
    const photo = productPhotoUrl(product.photoUrl)
    const confirmed = await notify.confirm({
      title: 'Hapus Produk',
      message: `Produk "${product.name}" akan dihapus dari daftar produk.`,
      tone: 'danger',
      confirmLabel: 'Ya, Hapus',
      cancelLabel: 'Batal',
      details: (
        <>
          {photo && (
            <img
              src={photo}
              alt={`Foto ${product.name}`}
              style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}
            />
          )}
          <p>
            Stok saat ini: {Number(product.stock ?? 0).toLocaleString('id-ID')} {product.unit} · Batch:{' '}
            {Number(product.batchCount ?? 0).toLocaleString('id-ID')}
          </p>
          <p className="text-muted">
            Produk tanpa riwayat operasional dihapus permanen. Produk yang sudah memiliki riwayat
            akan diarsipkan, dan produk yang stoknya masih tersedia akan ditolak oleh sistem.
          </p>
        </>
      ),
    })
    if (!confirmed) return

    setDeleting(true)
    try {
      // Backend yang menentukan hasil: hapus permanen (tanpa riwayat),
      // arsipkan (punya riwayat), atau tolak (stok masih ada).
      const res = await api.delete(`/products/${product.id}`)
      const refreshed = await fetchProducts()
      if (refreshed) {
        notify.success(res.data?.message || 'Produk berhasil dihapus')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menghapus produk')
    } finally {
      setDeleting(false)
    }
  }

  const activeCount = products.filter(p => p.isActive).length
  const inactiveCount = products.length - activeCount
  const selectedHistoryProduct = products.find(p => p.id === historyProductId)
  const historyUnit =
    selectedHistoryProduct?.unit || historyMovements[0]?.product.unit || ''

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Kelola Produk KWT</h1>
        <p className="page-subtitle">
          Data produk olahan, satuan dasar, dan harga jual mengikuti backend.
        </p>
      </div>

      {loadError && !formOpen && <div className="alert error">{loadError}</div>}

      {/* Ringkasan singkat */}
      <div className="summary-row">
        <div className="summary-item">
          <span className="card-label">Total Produk</span>
          <span className="summary-value">{products.length}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Aktif Diproduksi</span>
          <span className="summary-value">{activeCount}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Diarsipkan</span>
          <span className="summary-value">{inactiveCount}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <h2 className="card-title">Daftar Produk</h2>
        <button className="button" onClick={openForm}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Tambah Produk
        </button>
      </div>

      {/* Grid kartu produk */}
      {loading ? (
        <p className="text-muted">Memuat produk...</p>
      ) : products.length === 0 ? (
        <div className="card">
          <p className="text-muted">Belum ada produk. Klik “Tambah Produk” untuk menambah.</p>
        </div>
      ) : (
        <div className="product-grid">
          {products.map(p => {
            const photo = productPhotoUrl(p.photoUrl)
            return (
              <div key={p.id} className="card product-card">
                {isAdmin && (
                  <button
                    className="icon-button product-edit"
                    onClick={() => openEdit(p)}
                    aria-label={`Edit ${p.name}`}
                    title="Edit produk"
                  >
                    <span className="material-symbols-outlined">edit</span>
                  </button>
                )}

                <div className="product-card-head">
                  <div className="product-info">
                    <h3 className="product-name">{p.name}</h3>
                    <p className="product-unit">Satuan: {p.unit}</p>
                  </div>
                  {p.isActive ? (
                    <span className="badge success">Aktif</span>
                  ) : (
                    <span className="badge neutral">Diarsipkan</span>
                  )}
                </div>

                {photo && (
                  <div className="product-photo">
                    <img src={photo} alt={`Foto ${p.name}`} loading="lazy" />
                  </div>
                )}

                <div className="product-price">
                  <span className="card-label">Harga Jual</span>
                  <span className="price-value">
                    Rp {Number(p.sellingPrice).toLocaleString('id-ID')}
                  </span>
                </div>

                <div className="product-meta">
                  <div className="meta-item">
                    <span className="card-label">Stok Total</span>
                    <span className="meta-value">{Number(p.stock ?? 0).toLocaleString('id-ID')}</span>
                  </div>
                  <div className="meta-item">
                    <span className="card-label">Batch</span>
                    <span className="meta-value">{Number(p.batchCount ?? 0).toLocaleString('id-ID')}</span>
                  </div>
                </div>

                <div className="product-actions">
                  <button
                    className="button secondary"
                    onClick={() => toggleActive(p.id, p.isActive)}
                  >
                    {p.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  {isAdmin && (
                    <button
                      className="button danger-outline"
                      onClick={() => requestDelete(p)}
                      disabled={deleting}
                      aria-label={`Hapus ${p.name}`}
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Riwayat pergerakan stok produk (Admin & Operator) */}
      <section className="card section-card product-history">
        <div className="section-head">
          <div>
            <h2 className="card-title">Riwayat Pergerakan Stok Produk</h2>
            <p className="text-muted product-history-intro">
              Riwayat permanen dari ledger batch. Filter hanya memilih data yang ditampilkan
              dan tidak mengubah stok aktual.
            </p>
          </div>
        </div>

        <form className="product-history-filter" onSubmit={applyHistoryFilters}>
          <div className="field">
            <label htmlFor="history-product">Produk</label>
            <select
              id="history-product"
              value={historyProductId}
              onChange={(e) => void changeHistoryProduct(e.target.value)}
            >
              <option value="">Pilih produk</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.unit})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="history-from">Dari</label>
            <DateField
              id="history-from"
              value={historyFrom}
              max={historyTo || undefined}
              onChange={setHistoryFrom}
            />
          </div>
          <div className="field">
            <label htmlFor="history-to">Sampai</label>
            <DateField
              id="history-to"
              value={historyTo}
              min={historyFrom || undefined}
              onChange={setHistoryTo}
            />
          </div>
          <div className="field">
            <label htmlFor="history-type">Jenis Aktivitas</label>
            <select
              id="history-type"
              value={historyType}
              onChange={(e) => setHistoryType(e.target.value)}
            >
              <option value="">Semua aktivitas</option>
              {MOVEMENT_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="history-batch">Batch</label>
            <select
              id="history-batch"
              value={historyBatchId}
              onChange={(e) => setHistoryBatchId(e.target.value)}
              disabled={!historyProductId || historyBatches.length === 0}
            >
              <option value="">Semua batch</option>
              {historyBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code} · stok {formatQuantity(batch.stock)}
                </option>
              ))}
            </select>
          </div>
          <div className="product-history-filter-actions">
            <button type="button" className="button secondary" onClick={resetHistoryFilters}>
              Reset Filter
            </button>
            <button type="submit" className="button" disabled={!historyProductId || historyLoading}>
              {historyLoading ? 'Memuat...' : 'Terapkan Filter'}
            </button>
          </div>
        </form>

        {historyError && <div className="alert error">{historyError}</div>}

        {historySummary && !historyLoading && !historyError && (
          <div className="product-history-summary" aria-live="polite">
            <div>
              <span className="card-label">Stok Produk Saat Ini</span>
              <strong className="num">
                {formatQuantity(historySummary.currentStock)} {historyUnit}
              </strong>
            </div>
            <div>
              <span className="card-label">Pergerakan Ditampilkan</span>
              <strong className="num">{formatQuantity(historySummary.movementCount)}</strong>
            </div>
            <div>
              <span className="card-label">Total Stok Masuk</span>
              <strong className="num product-history-in">
                +{formatQuantity(historySummary.totalIn)} {historyUnit}
              </strong>
            </div>
            <div>
              <span className="card-label">Total Stok Keluar</span>
              <strong className="num product-history-out">
                −{formatQuantity(historySummary.totalOut)} {historyUnit}
              </strong>
            </div>
          </div>
        )}

        {historySummary?.hasHistoricalFallback && !historyLoading && !historyError && (
          <div className="product-history-fallback-note">
            <span className="material-symbols-outlined" aria-hidden="true">info</span>
            <p>
              Sebagian saldo berasal dari <strong>Saldo Awal (Riwayat Sebelumnya Tidak
              Tersedia)</strong>. Baris tersebut ditandai agar tidak disalahartikan sebagai
              transaksi lama yang tercatat lengkap.
            </p>
          </div>
        )}

        {!historyProductId ? (
          <div className="product-history-empty">
            <span className="material-symbols-outlined" aria-hidden="true">query_stats</span>
            <p><strong>Pilih produk untuk melihat riwayat pergerakan stok.</strong></p>
            <p className="text-muted">
              Setelah produk dipilih, riwayat produksi, penjualan, pembatalan, penyesuaian,
              koreksi, dan saldo awal batch akan ditampilkan.
            </p>
          </div>
        ) : historyLoading ? (
          <p className="text-muted product-history-loading">Memuat riwayat pergerakan stok...</p>
        ) : historyError ? null : historyLoaded && historyMovements.length === 0 ? (
          <div className="product-history-empty">
            <span className="material-symbols-outlined" aria-hidden="true">history_toggle_off</span>
            <p><strong>Riwayat tidak ditemukan untuk filter ini.</strong></p>
            <p className="text-muted">
              Ubah rentang tanggal, jenis aktivitas, atau batch, lalu tekan Terapkan Filter.
            </p>
          </div>
        ) : historyMovements.length > 0 ? (
          <>
            <div className="table-wrapper desktop-table product-history-table">
              <table>
                <thead>
                  <tr>
                    <th>Tanggal Aktivitas</th>
                    <th>Jenis Aktivitas</th>
                    <th>Batch</th>
                    <th>Stok Masuk</th>
                    <th>Stok Keluar</th>
                    <th>Saldo Produk</th>
                    <th>Saldo Batch</th>
                    <th>Keterangan / Referensi</th>
                  </tr>
                </thead>
                <tbody>
                  {historyMovements.map((row) => (
                    <tr key={row.id}>
                      <td className="product-history-date">
                        <span>{movementDate(row.occurredAt)}</span>
                        <span className="product-history-sub">
                          Dicatat {isoToDateTimeDisplay(row.recordedAt)} WIB
                        </span>
                      </td>
                      <td>
                        <span
                          className={`movement-type ${
                            row.stockIn > 0 ? 'in' : row.stockOut > 0 ? 'out' : 'neutral'
                          }`}
                        >
                          {MOVEMENT_LABELS[row.type] || row.type}
                        </span>
                        {row.isHistoricalFallback && (
                          <span className="badge warning product-history-fallback-badge">
                            Riwayat historis
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="product-history-batch-code" title={`ID batch: ${row.batch.id}`}>
                          {row.batch.code}
                        </span>
                      </td>
                      <td className="num">
                        {row.stockIn > 0 ? (
                          <span className="product-history-in">
                            +{formatQuantity(row.stockIn)}{' '}
                            <span className="product-history-unit">{row.product.unit}</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        {row.stockOut > 0 ? (
                          <span className="product-history-out">
                            −{formatQuantity(row.stockOut)}{' '}
                            <span className="product-history-unit">{row.product.unit}</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        <strong>{formatQuantity(row.balanceAfter)}</strong>{' '}
                        <span className="product-history-unit">{row.product.unit}</span>
                      </td>
                      <td className="num">
                        <strong>{formatQuantity(row.batchBalanceAfter)}</strong>{' '}
                        <span className="product-history-unit">{row.product.unit}</span>
                      </td>
                      <td className="product-history-notes">
                        <div>{row.reason || '—'}</div>
                        {row.reference && (
                          <div className="product-history-reference">{row.reference.label}</div>
                        )}
                        <div className="product-history-sub">
                          Dicatat oleh {movementRecorder(row)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: kartu agar tidak memerlukan scroll horizontal. */}
            <div className="mobile-list">
              {historyMovements.map((row) => (
                <article
                  className={`history-item product-history-card ${
                    row.isHistoricalFallback ? 'historical' : ''
                  }`}
                  key={row.id}
                >
                  <div className="history-item-top">
                    <span
                      className={`movement-type ${
                        row.stockIn > 0 ? 'in' : row.stockOut > 0 ? 'out' : 'neutral'
                      }`}
                    >
                      {MOVEMENT_LABELS[row.type] || row.type}
                    </span>
                    <span className="history-item-date">{movementDate(row.occurredAt)}</span>
                  </div>
                  <div className="product-history-card-batch">
                    <span className="card-label">Batch</span>
                    <strong>{row.batch.code}</strong>
                  </div>
                  {row.isHistoricalFallback && (
                    <span className="badge warning">Riwayat historis</span>
                  )}
                  <div className="product-history-mobile-grid">
                    <div>
                      <span className="card-label">Stok Masuk</span>
                      <strong className={`num ${row.stockIn > 0 ? 'product-history-in' : 'text-muted'}`}>
                        {row.stockIn > 0
                          ? `+${formatQuantity(row.stockIn)} ${row.product.unit}`
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span className="card-label">Stok Keluar</span>
                      <strong className={`num ${row.stockOut > 0 ? 'product-history-out' : 'text-muted'}`}>
                        {row.stockOut > 0
                          ? `−${formatQuantity(row.stockOut)} ${row.product.unit}`
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span className="card-label">Saldo Produk</span>
                      <strong className="num">
                        {formatQuantity(row.balanceAfter)} {row.product.unit}
                      </strong>
                    </div>
                    <div>
                      <span className="card-label">Saldo Batch</span>
                      <strong className="num">
                        {formatQuantity(row.batchBalanceAfter)} {row.product.unit}
                      </strong>
                    </div>
                  </div>
                  <div className="history-item-note">
                    {row.reason || 'Tanpa keterangan'}
                    {row.reference ? ` · ${row.reference.label}` : ''}
                  </div>
                  <div className="history-item-note">
                    Dicatat oleh {movementRecorder(row)} · {isoToDateTimeDisplay(row.recordedAt)} WIB
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>

      {/* Modal tambah/edit produk (Admin) */}
      <ProductModal
        open={formOpen}
        title={editTarget ? 'Edit Produk' : 'Tambah Produk'}
        onClose={closeForm}
      >
        <form onSubmit={editTarget ? updateProduct : createProduct} className="product-modal-form">
          <div className="product-modal-body">
            <div className="field">
              <label htmlFor="p-name">Nama Produk</label>
              <input
                id="p-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Contoh: Keripik Singkong Balado"
                required
              />
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="p-unit">Satuan Dasar</label>
                <input
                  id="p-unit"
                  value={form.unit}
                  onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="Contoh: pcs"
                  required
                />
                {editTarget && (
                  <span className="text-muted">
                    Satuan tidak dapat diubah bila produk sudah memiliki riwayat operasional.
                  </span>
                )}
              </div>
              <div className="field">
                <label htmlFor="p-price">Harga Jual (Rp)</label>
                <input
                  id="p-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.sellingPrice}
                  onChange={e => setForm(f => ({ ...f, sellingPrice: e.target.value }))}
                  required
                />
              </div>
            </div>

            <PhotoField
              currentUrl={editTarget?.photoUrl ?? null}
              file={photoFile}
              onChange={setPhotoFile}
              savedMessage={photoNotice}
            />

            <div className="field">
              <label htmlFor="p-desc">Deskripsi (opsional)</label>
              <textarea
                id="p-desc"
                rows={2}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="p-comp">Komposisi (opsional)</label>
              <textarea
                id="p-comp"
                rows={2}
                value={form.composition}
                onChange={e => setForm(f => ({ ...f, composition: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="p-storage">Petunjuk Penyimpanan (opsional)</label>
              <textarea
                id="p-storage"
                rows={2}
                value={form.storageInstructions}
                onChange={e => setForm(f => ({ ...f, storageInstructions: e.target.value }))}
              />
            </div>

            <div className="field product-nutrition-field">
              <div className={`product-nutrition-accordion${nutritionOpen ? ' is-open' : ''}`}>
                <button
                  type="button"
                  id="nutrition-toggle"
                  className="product-nutrition-toggle"
                  onClick={() => setNutritionOpen((v) => !v)}
                  aria-expanded={nutritionOpen}
                  aria-controls="nutrition-panel"
                >
                  <span className="product-nutrition-toggle-main">
                    <span className="product-nutrition-toggle-title">Informasi Nilai Gizi</span>
                    <span className="badge neutral product-nutrition-optional">Opsional</span>
                    <span
                      className={`product-nutrition-status${nutritionStatus().filled ? ' is-filled' : ''}`}
                    >
                      {nutritionStatus().label}
                    </span>
                  </span>
                  <span className="material-symbols-outlined product-nutrition-chevron" aria-hidden="true">
                    {nutritionOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                {nutritionOpen && (
                  <div
                    id="nutrition-panel"
                    className="product-nutrition-panel"
                    role="region"
                    aria-labelledby="nutrition-toggle"
                  >
                    <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                      Isi hanya data yang sudah diketahui. Kolom kosong tidak dianggap nol dan tidak
                      dihitung otomatis. {isAdmin ? '' : 'Hanya Admin yang dapat mengubah nilai gizi.'}
                    </p>

                    <div className="form-row product-nutrition-serving">
                      <div className="field">
                        <label htmlFor="nutrition-serving-amount">Takaran Saji</label>
                        <div className="product-nutrition-inline">
                          <input
                            id="nutrition-serving-amount"
                            type="number"
                            step="0.001"
                            min="0"
                            value={nutritionForm.servingSizeAmount}
                            onChange={(e) =>
                              setNutritionForm((f) => ({ ...f, servingSizeAmount: e.target.value }))
                            }
                            placeholder="Jumlah"
                            disabled={!isAdmin}
                          />
                          <input
                            id="nutrition-serving-unit"
                            value={nutritionForm.servingSizeUnit}
                            onChange={(e) =>
                              setNutritionForm((f) => ({ ...f, servingSizeUnit: e.target.value }))
                            }
                            placeholder="Satuan (g, ml, sajian)"
                            disabled={!isAdmin}
                            aria-label="Satuan takaran saji"
                          />
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor="nutrition-servings-per-package">Jumlah Sajian per Kemasan</label>
                        <input
                          id="nutrition-servings-per-package"
                          type="number"
                          step="0.001"
                          min="0"
                          value={nutritionForm.servingsPerPackage}
                          onChange={(e) =>
                            setNutritionForm((f) => ({ ...f, servingsPerPackage: e.target.value }))
                          }
                          placeholder="Contoh: 4"
                          disabled={!isAdmin}
                        />
                      </div>
                    </div>

                    <div className="product-nutrition-components">
                      <div className="product-nutrition-components-head">
                        <span className="card-label">Kandungan Gizi</span>
                        <span className="card-label">%AKG (opsional)</span>
                      </div>
                      {nutritionForm.components.length === 0 ? (
                        <p className="text-muted">Belum ada komponen gizi.</p>
                      ) : (
                        <div className="stack-form product-nutrition-list">
                          {nutritionForm.components.map((row, idx) => (
                            <div key={`${idx}-${row.name}`} className="product-nutrition-row">
                              <div className="field">
                                <label htmlFor={`nutrition-name-${idx}`}>Nama Komponen</label>
                                <input
                                  id={`nutrition-name-${idx}`}
                                  value={row.name}
                                  onChange={(e) => updateNutritionComponent(idx, { name: e.target.value })}
                                  placeholder="Contoh: Vitamin C"
                                  disabled={!isAdmin}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`nutrition-amount-${idx}`}>Jumlah</label>
                                <input
                                  id={`nutrition-amount-${idx}`}
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  value={row.amount}
                                  onChange={(e) => updateNutritionComponent(idx, { amount: e.target.value })}
                                  placeholder="—"
                                  disabled={!isAdmin}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`nutrition-unit-${idx}`}>Satuan</label>
                                <input
                                  id={`nutrition-unit-${idx}`}
                                  value={row.unit}
                                  onChange={(e) => updateNutritionComponent(idx, { unit: e.target.value })}
                                  placeholder="g, mg, kkal"
                                  disabled={!isAdmin}
                                />
                              </div>
                              <div className="field">
                                <label htmlFor={`nutrition-akg-${idx}`}>%AKG</label>
                                <input
                                  id={`nutrition-akg-${idx}`}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={row.akgPercent}
                                  onChange={(e) => updateNutritionComponent(idx, { akgPercent: e.target.value })}
                                  placeholder="—"
                                  disabled={!isAdmin}
                                />
                              </div>
                              {isAdmin && (
                                <div className="form-actions product-nutrition-remove">
                                  <button
                                    type="button"
                                    className="button secondary production-usage-remove"
                                    onClick={() => removeNutritionComponent(idx)}
                                    aria-label={`Hapus komponen gizi ${idx + 1}`}
                                    title="Hapus komponen"
                                  >
                                    Hapus
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {isAdmin && (
                        <div className="form-actions" style={{ marginTop: 0 }}>
                          <button type="button" className="button secondary" onClick={addNutritionComponent}>
                            Tambah Komponen
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="field">
              <label>Resep Bahan Baku</label>
              <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                Kebutuhan bahan untuk menghasilkan 1 {form.unit || 'satuan'} produk. Kosongkan jika
                produk belum memiliki resep standar.
              </p>
              {!isAdmin ? (
                recipeRows.length === 0 ? (
                  <p className="text-muted">Belum ada resep.</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    {recipeRows.map((row, idx) => {
                      const mat = materials.find((m) => m.id === row.materialId)
                      return (
                        <li key={idx}>
                          {(mat?.name || 'Bahan')} — {row.quantityPerUnit} {row.recipeUnit}
                        </li>
                      )
                    })}
                  </ul>
                )
              ) : (
                <div className="stack-form" style={{ gap: '0.75rem' }}>
                  {recipeRows.length === 0 && (
                    <p className="text-muted">Belum ada bahan resep. Tambahkan bahan jika diperlukan.</p>
                  )}
                  {recipeRows.map((row, idx) => {
                    const selectedMaterial = materials.find((m) => m.id === row.materialId)
                    const unitOptions = selectedMaterial
                      ? recipeUnitOptions(selectedMaterial.unit, row.recipeUnit)
                      : row.recipeUnit
                        ? [row.recipeUnit]
                        : []
                    return (
                      <div key={idx} className="form-row" style={{ alignItems: 'flex-end' }}>
                        <div className="field" style={{ flex: 2, minWidth: 140 }}>
                          <label htmlFor={`recipe-material-${idx}`}>Bahan Baku</label>
                          <select
                            id={`recipe-material-${idx}`}
                            value={row.materialId}
                            onChange={(e) => {
                              const materialId = e.target.value
                              const mat = materials.find((m) => m.id === materialId)
                              const compatible = mat ? recipeUnitOptions(mat.unit, row.recipeUnit) : []
                              updateRecipeRow(idx, {
                                materialId,
                                recipeUnit:
                                  row.recipeUnit && compatible.includes(row.recipeUnit)
                                    ? row.recipeUnit
                                    : compatible[0] || mat?.unit || row.recipeUnit,
                              })
                            }}
                          >
                            <option value="">Pilih bahan</option>
                            {materials
                              .filter((m) => m.isActive || m.id === row.materialId)
                              .filter((m) => !recipeRows.some((r, i) => i !== idx && r.materialId === m.id))
                              .map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name} ({m.unit}){!m.isActive ? ' — nonaktif' : ''}
                                </option>
                              ))}
                          </select>
                        </div>
                        <div className="field" style={{ flex: 1, minWidth: 100 }}>
                          <label htmlFor={`recipe-qty-${idx}`}>Jumlah</label>
                          <input
                            id={`recipe-qty-${idx}`}
                            type="number"
                            step="0.001"
                            min="0"
                            value={row.quantityPerUnit}
                            onChange={(e) => updateRecipeRow(idx, { quantityPerUnit: e.target.value })}
                            disabled={!row.materialId}
                          />
                        </div>
                        <div className="field" style={{ flex: 1, minWidth: 100 }}>
                          <label htmlFor={`recipe-unit-${idx}`}>Satuan Resep</label>
                          {unitOptions.length > 1 ? (
                            <select
                              id={`recipe-unit-${idx}`}
                              value={row.recipeUnit}
                              onChange={(e) => updateRecipeRow(idx, { recipeUnit: e.target.value })}
                              disabled={!row.materialId}
                            >
                              <option value="">Pilih satuan</option>
                              {unitOptions.map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={`recipe-unit-${idx}`}
                              value={row.recipeUnit || selectedMaterial?.unit || ''}
                              onChange={(e) => updateRecipeRow(idx, { recipeUnit: e.target.value })}
                              disabled={!row.materialId}
                            />
                          )}
                        </div>
                        <div className="form-actions" style={{ margin: 0 }}>
                          <button
                            type="button"
                            className="button secondary production-usage-remove"
                            onClick={() => removeRecipeRow(idx)}
                            aria-label={`Hapus bahan resep ${idx + 1}`}
                            title="Hapus bahan resep"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  <div className="form-actions" style={{ marginTop: 0 }}>
                    <button type="button" className="button secondary" onClick={addRecipeRow}>
                      Tambah Bahan
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="modal-actions product-modal-actions">
            <button type="button" className="button secondary" onClick={closeForm}>
              Batal
            </button>
            <button className="button" disabled={submitting}>
              {submitting
                ? 'Menyimpan...'
                : editTarget
                  ? 'Simpan Perubahan'
                  : 'Simpan Produk'}
            </button>
          </div>
        </form>
      </ProductModal>

    </div>
  )
}
