import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Modal } from './Modal'
import { PasswordChangeForm } from './PasswordChangeForm'
import { ProfileAvatar } from './ProfileAvatar'
import { ProfileDialog } from './ProfileDialog'
import { useNotify } from './NotificationProvider'

type ActiveDialog = 'profile' | 'password' | null

/** Menu profil di kanan atas header: identitas, profil, password, dan keluar. */
export function UserMenu() {
  const { user, login, logout } = useAuth()
  const notify = useNotify()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Saat wajib ganti kata sandi, navigasi operasional sengaja disembunyikan.
  // Alur paksa tetap memakai halaman /change-password, bukan menu ini.
  if (!user || user.mustChangePassword) return null

  const displayName = user.name?.trim() || user.username || 'Pengguna'
  const roleLabel = user.role === 'ADMIN' ? 'Admin' : 'Operator'

  function openDialog(dialog: Exclude<ActiveDialog, null>) {
    setOpen(false)
    setActiveDialog(dialog)
  }

  async function handleLogout() {
    setOpen(false)
    const confirmed = await notify.confirm({
      title: 'Konfirmasi keluar',
      message: `Yakin ingin keluar, ${displayName}?`,
      confirmLabel: 'Ya, Keluar',
      cancelLabel: 'Batal',
      tone: 'danger',
    })
    if (!confirmed) return

    logout()
    navigate('/login')
  }

  return (
    <div className="header-right" ref={containerRef}>
      <button
        type="button"
        className="profile-trigger"
        aria-label={`Menu profil ${displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ProfileAvatar user={user} displayName={displayName} />
        <span className="material-symbols-outlined profile-trigger-caret" aria-hidden="true">
          expand_more
        </span>
      </button>

      {open && (
        <div className="user-dropdown" role="menu" aria-label="Menu profil">
          <div className="user-dropdown-head">
            <ProfileAvatar user={user} displayName={displayName} large />
            <div className="user-dropdown-identity">
              <strong className="user-dropdown-name">{displayName}</strong>
              <span className="user-dropdown-role">{roleLabel}</span>
            </div>
          </div>

          <div className="user-dropdown-actions">
            <button type="button" role="menuitem" onClick={() => openDialog('profile')}>
              <span className="material-symbols-outlined" aria-hidden="true">person</span>
              Profil Saya
            </button>
            <button type="button" role="menuitem" onClick={() => openDialog('password')}>
              <span className="material-symbols-outlined" aria-hidden="true">lock_reset</span>
              Ubah Password
            </button>
            <button type="button" role="menuitem" className="user-dropdown-logout" onClick={handleLogout}>
              <span className="material-symbols-outlined" aria-hidden="true">logout</span>
              Keluar
            </button>
          </div>
        </div>
      )}

      {activeDialog === 'profile' && <ProfileDialog onClose={() => setActiveDialog(null)} />}

      {activeDialog === 'password' && (
        <Modal
          title="Ubah Password"
          onClose={() => setActiveDialog(null)}
          className="password-modal"
        >
          <p className="text-muted profile-dialog-intro">
            Gunakan minimal 8 karakter. Setelah berhasil, sesi Anda tetap aktif dengan kata sandi baru.
          </p>
          <PasswordChangeForm
            onSuccess={({ token, user: updated }) => {
              // Backend mencabut token lama setelah hash kata sandi berubah.
              login(token, updated)
              setActiveDialog(null)
              notify.success('Kata sandi berhasil diperbarui.')
            }}
          />
        </Modal>
      )}
    </div>
  )
}
