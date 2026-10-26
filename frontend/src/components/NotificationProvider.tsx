import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Notifikasi terpusat NutriLokal.
 *
 * Semua pesan hasil tindakan (berhasil, gagal, peringatan) dan konfirmasi
 * tindakan data ditampilkan lewat satu dialog yang sama: berada di tengah
 * layar, memakai backdrop gelap, tidak menutup sendiri, dan hanya ditutup
 * lewat tombol atau tombol Escape. Satu dialog tampil pada satu waktu;
 * notifikasi lain antre agar tidak saling menimpa.
 */

export type NoticeTone = 'error' | 'success' | 'warning' | 'info'
type DialogTone = NoticeTone | 'danger'

interface BaseOptions {
  /** Judul dialog; bila kosong memakai judul bawaan sesuai jenis. */
  title?: string
  message: string
}

export interface ConfirmOptions extends BaseOptions {
  /** Label tombol utama, mis. "Ya, Hapus" atau "Konfirmasi". */
  confirmLabel?: string
  /** Label tombol batal, bawaan "Batal". */
  cancelLabel?: string
  tone?: DialogTone
  /** Konten tambahan (rincian data) yang ditampilkan di bawah pesan. */
  details?: ReactNode
}

interface DialogState {
  id: number
  mode: 'info' | 'confirm'
  tone: DialogTone
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  details?: ReactNode
  resolve?: (ok: boolean) => void
}

export interface NotificationApi {
  error: (message: string, title?: string) => void
  success: (message: string, title?: string) => void
  warning: (message: string, title?: string) => void
  info: (message: string, title?: string) => void
  /**
   * Dialog konfirmasi. Promise selesai `true` hanya bila pengguna menekan
   * tombol konfirmasi; Batal, Escape, atau klik backdrop menghasilkan `false`.
   */
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const NotificationContext = createContext<NotificationApi | null>(null)

const DEFAULT_TITLE: Record<NoticeTone, string> = {
  error: 'Terjadi Kesalahan',
  success: 'Berhasil',
  warning: 'Perhatian',
  info: 'Informasi',
}

const TONE_ICON: Record<DialogTone, string> = {
  error: 'error',
  success: 'check_circle',
  warning: 'warning',
  info: 'info',
  danger: 'delete',
}

let sequence = 0

function nextId(): number {
  sequence += 1
  return sequence
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const dialogRef = useRef<DialogState | null>(null)
  const queueRef = useRef<DialogState[]>([])
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const present = useCallback((next: DialogState) => {
    dialogRef.current = next
    setDialog(next)
  }, [])

  const close = useCallback((result: boolean) => {
    const active = dialogRef.current
    if (!active) return
    dialogRef.current = null
    active.resolve?.(result)
    const next = queueRef.current.shift() ?? null
    dialogRef.current = next
    setDialog(next)
    // Setelah antrean habis, kembalikan fokus ke elemen pemicu (mis. tombol
    // Hapus) supaya navigasi keyboard tetap berada di konteks pengguna.
    if (!next) {
      const trigger = returnFocusRef.current
      returnFocusRef.current = null
      trigger?.focus?.()
    }
  }, [])

  /**
   * Menampilkan dialog, atau mengantrekannya bila masih ada dialog aktif.
   * Pesan informasi yang identik dengan yang sedang tampil/antre diabaikan
   * agar satu kejadian tidak membuka dialog berulang kali.
   */
  const enqueue = useCallback(
    (next: DialogState): boolean => {
      if (!dialogRef.current) {
        const active = document.activeElement
        returnFocusRef.current = active instanceof HTMLElement ? active : null
        present(next)
        return true
      }
      const duplicate =
        (dialogRef.current.mode === next.mode && dialogRef.current.message === next.message) ||
        queueRef.current.some((item) => item.mode === next.mode && item.message === next.message)
      if (duplicate) return false
      queueRef.current.push(next)
      return true
    },
    [present],
  )

  const pushInfo = useCallback(
    (tone: NoticeTone, message: string, title?: string) => {
      enqueue({
        id: nextId(),
        mode: 'info',
        tone,
        title: title ?? DEFAULT_TITLE[tone],
        message,
        confirmLabel: 'OK',
        cancelLabel: 'Batal',
      })
    },
    [enqueue],
  )

  const confirm = useCallback(
    (options: ConfirmOptions) => {
      return new Promise<boolean>((resolve) => {
        // Klik ganda pada satu tombol tidak boleh membuka dua konfirmasi:
        // permintaan kedua diabaikan dan dianggap tidak disetujui.
        if (
          dialogRef.current?.mode === 'confirm' ||
          queueRef.current.some((item) => item.mode === 'confirm')
        ) {
          resolve(false)
          return
        }
        enqueue({
          id: nextId(),
          mode: 'confirm',
          tone: options.tone ?? 'warning',
          title: options.title ?? 'Konfirmasi',
          message: options.message,
          confirmLabel: options.confirmLabel ?? 'Konfirmasi',
          cancelLabel: options.cancelLabel ?? 'Batal',
          details: options.details,
          resolve,
        })
      })
    },
    [enqueue],
  )

  const api = useMemo<NotificationApi>(
    () => ({
      error: (message, title) => pushInfo('error', message, title),
      success: (message, title) => pushInfo('success', message, title),
      warning: (message, title) => pushInfo('warning', message, title),
      info: (message, title) => pushInfo('info', message, title),
      confirm,
    }),
    [confirm, pushInfo],
  )

  // Fokus, Escape, jebakan Tab, dan kunci gulir halaman selama dialog terbuka.
  useEffect(() => {
    if (!dialog) return
    const panel = panelRef.current

    // Untuk konfirmasi berisiko, fokus awal ke Batal agar Enter tidak
    // langsung menjalankan tindakan yang merusak.
    const initial =
      dialog.mode === 'confirm' && dialog.tone === 'danger'
        ? cancelRef.current ?? primaryRef.current
        : primaryRef.current
    initial?.focus()

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
        // Menutup dialog tidak pernah menjalankan tindakan konfirmasi.
        event.preventDefault()
        close(false)
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
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [dialog, close])

  return (
    <NotificationContext.Provider value={api}>
      {children}
      {dialog &&
        createPortal(
          <div className="notification-root">
            <div className="notification-backdrop" onClick={() => close(false)} />
            <div
              ref={panelRef}
              className={`notification-panel tone-${dialog.tone}`}
              role={dialog.mode === 'confirm' || dialog.tone === 'error' ? 'alertdialog' : 'dialog'}
              aria-modal="true"
              aria-labelledby="notification-title"
              aria-describedby="notification-message"
              tabIndex={-1}
            >
              <span className={`notification-icon ${dialog.tone}`} aria-hidden="true">
                <span className="material-symbols-outlined">{TONE_ICON[dialog.tone]}</span>
              </span>
              <h2 className="notification-title" id="notification-title">
                {dialog.title}
              </h2>
              <p className="notification-message" id="notification-message">
                {dialog.message}
              </p>
              {dialog.details && <div className="notification-details">{dialog.details}</div>}
              <div className="notification-actions">
                {dialog.mode === 'confirm' && (
                  <button
                    ref={cancelRef}
                    type="button"
                    className="button secondary"
                    onClick={() => close(false)}
                  >
                    {dialog.cancelLabel}
                  </button>
                )}
                <button
                  ref={primaryRef}
                  type="button"
                  className={`button${dialog.tone === 'danger' ? ' danger' : ''}`}
                  onClick={() => close(true)}
                >
                  {dialog.confirmLabel}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </NotificationContext.Provider>
  )
}

/** Akses notifikasi terpusat. Wajib dipakai di dalam NotificationProvider. */
export function useNotify(): NotificationApi {
  const api = useContext(NotificationContext)
  if (!api) {
    throw new Error('useNotify harus dipakai di dalam NotificationProvider')
  }
  return api
}
