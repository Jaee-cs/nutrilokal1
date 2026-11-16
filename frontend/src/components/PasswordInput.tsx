import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import './PasswordInput.css'

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Nama field untuk label aksesibel tombol mata, mis. "kata sandi baru". */
  visibilityLabel?: string
}

/**
 * Input kata sandi dengan tombol tampil/sembunyikan.
 *
 * Nilai input tidak pernah diubah oleh tombol; hanya atribut `type` yang
 * berganti antara `password` dan `text`. Setiap instance menyimpan status
 * visibilitasnya sendiri sehingga input konfirmasi tidak ikut terpengaruh.
 */
export function PasswordInput({ visibilityLabel = 'kata sandi', ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const toggleLabel = `${visible ? 'Sembunyikan' : 'Tampilkan'} ${visibilityLabel}`

  return (
    <div className="password-input">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-input-toggle"
        onClick={() => setVisible((value) => !value)}
        aria-label={toggleLabel}
        aria-controls={props.id}
        aria-pressed={visible}
        title={toggleLabel}
      >
        {visible ? (
          <EyeOff size={18} aria-hidden="true" />
        ) : (
          <Eye size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
