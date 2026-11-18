import { useState } from 'react'
import type { User } from '../hooks/useAuth'

/** Inisial maksimal dua kata dari nama tampilan (atau username). */
export function profileInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? '')
    .join('')
}

interface ProfileAvatarProps {
  user: User
  displayName: string
  large?: boolean
}

/**
 * Avatar profil: memakai foto bila tersedia di data pengguna, jika tidak
 * (atau gambar gagal dimuat) menampilkan inisial di dalam lingkaran hijau.
 */
export function ProfileAvatar({ user, displayName, large = false }: ProfileAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const className = `profile-avatar${large ? ' profile-avatar-large' : ''}`

  if (user.photoUrl && !imageFailed) {
    return (
      <img
        className={className}
        src={user.photoUrl}
        alt={`Foto profil ${displayName}`}
        onError={() => setImageFailed(true)}
      />
    )
  }

  return (
    <span className={className} aria-label={`Avatar ${displayName}`} role="img">
      {profileInitials(displayName)}
    </span>
  )
}
