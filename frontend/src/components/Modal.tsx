import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * Pembungkus dialog sederhana yang memakai kelas modal NutriLokal yang sudah ada.
 * Menutup lewat tombol silang, klik di luar panel, atau tombol Escape.
 */
export function Modal({ title, onClose, children, footer, className = '' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.querySelector<HTMLElement>('input, button, select, textarea')?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div className="modal-root">
      <div className="modal-overlay" onClick={onClose} aria-hidden="true" />
      <div
        className={`modal-panel profile-modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <div className="profile-modal-head">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Tutup">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div className="profile-modal-body">{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
