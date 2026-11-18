import { useState } from 'react'
import api from '../lib/api'
import type { User } from '../hooks/useAuth'
import { useNotify } from './NotificationProvider'
import { PasswordInput } from './PasswordInput'

export const MIN_PASSWORD_LENGTH = 8

interface PasswordChangeFormProps {
  /** Dipanggil setelah backend menerima password baru dan mengembalikan token baru. */
  onSuccess: (data: { token: string; user: User }) => void
  submitLabel?: string
}

/**
 * Form ubah kata sandi yang dipakai baik oleh halaman wajib ganti password
 * maupun oleh menu profil. Validasi dan endpointnya sama persis; yang
 * membedakan hanya tindakan setelah berhasil (pindah halaman atau tutup modal).
 */
export function PasswordChangeForm({ onSuccess, submitLabel = 'Simpan Password Baru' }: PasswordChangeFormProps) {
  const notify = useNotify()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    if (!currentPassword) {
      notify.error('Kata sandi saat ini wajib diisi.')
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      notify.error(`Kata sandi baru minimal ${MIN_PASSWORD_LENGTH} karakter.`)
      return
    }
    if (newPassword !== confirmPassword) {
      notify.error('Konfirmasi kata sandi baru tidak sama.')
      return
    }
    if (newPassword === currentPassword) {
      notify.error('Kata sandi baru harus berbeda dari kata sandi saat ini.')
      return
    }

    setSaving(true)
    try {
      const res = await api.post('/auth/set-password', { currentPassword, newPassword })
      onSuccess({ token: res.data.token, user: res.data.user })
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal memperbarui kata sandi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="password-form">
      <div className="field">
        <label htmlFor="current-password">Password saat ini</label>
        <PasswordInput
          id="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          autoFocus
          required
          visibilityLabel="password saat ini"
        />
      </div>

      <div className="field">
        <label htmlFor="new-password">Password baru</label>
        <PasswordInput
          id="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          visibilityLabel="password baru"
        />
      </div>

      <div className="field">
        <label htmlFor="confirm-password">Konfirmasi password baru</label>
        <PasswordInput
          id="confirm-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          visibilityLabel="konfirmasi password baru"
        />
      </div>

      <div className="password-form-foot">
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Menyimpan...' : submitLabel}
        </button>
      </div>
    </form>
  )
}
