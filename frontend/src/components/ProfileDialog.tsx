import { useState } from 'react'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { Modal } from './Modal'
import { ProfileAvatar } from './ProfileAvatar'
import { useNotify } from './NotificationProvider'

const MAX_NAME_LENGTH = 100

function formatDate(value?: string): string {
  if (!value) return 'Tidak tersedia'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Tidak tersedia'
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

interface ProfileDialogProps {
  onClose: () => void
}

/** Modal "Profil Saya": data akun sendiri + ubah nama lengkap saja. */
export function ProfileDialog({ onClose }: ProfileDialogProps) {
  const { user, updateUser } = useAuth()
  const notify = useNotify()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user?.name ?? '')
  const [saving, setSaving] = useState(false)

  if (!user) return null

  const displayName = user.name?.trim() || user.username
  const roleLabel = user.role === 'ADMIN' ? 'Admin' : 'Operator'

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      notify.error('Nama lengkap wajib diisi.')
      return
    }

    setSaving(true)
    try {
      const res = await api.patch('/auth/me', { name: trimmed })
      updateUser(res.data.user)
      setEditing(false)
      notify.success('Profil berhasil diperbarui.')
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal memperbarui profil.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Profil Saya"
      onClose={onClose}
      footer={
        editing ? (
          <>
            <button type="button" className="button ghost" onClick={() => { setName(user.name ?? ''); setEditing(false) }}>
              Batal
            </button>
            <button type="submit" className="button" form="profile-name-form" disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
          </>
        ) : (
          <button type="button" className="button" onClick={onClose}>
            Tutup
          </button>
        )
      }
    >
      <div className="profile-dialog-identity">
        <ProfileAvatar user={user} displayName={displayName} large />
        <div>
          <strong className="profile-dialog-name">{displayName}</strong>
          <span className="profile-dialog-role">{roleLabel}</span>
        </div>
      </div>

      {editing ? (
        <form id="profile-name-form" onSubmit={save} className="profile-dialog-form">
          <div className="field">
            <label htmlFor="profile-name">Nama lengkap</label>
            <input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MAX_NAME_LENGTH}
              autoFocus
              required
              placeholder="Masukkan nama lengkap"
            />
            <p className="text-muted profile-hint">
              Username dan role tidak dapat diubah melalui menu ini.
            </p>
          </div>
        </form>
      ) : (
        <dl className="profile-detail-list">
          <div>
            <dt>Nama lengkap</dt>
            <dd>{user.name?.trim() || <span className="text-muted">Belum diisi</span>}</dd>
          </div>
          <div>
            <dt>Username</dt>
            <dd>{user.username}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{roleLabel}</dd>
          </div>
          <div>
            <dt>Akun dibuat</dt>
            <dd>{formatDate(user.createdAt)}</dd>
          </div>
        </dl>
      )}

      {!editing && (
        <button type="button" className="button ghost profile-edit-button" onClick={() => setEditing(true)}>
          <span className="material-symbols-outlined" aria-hidden="true">edit</span>
          Ubah Nama Lengkap
        </button>
      )}
    </Modal>
  )
}
