import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  compareDateCodes,
  dateCodeFromParts,
  dateCodeParts,
  dateCodeToDisplay,
  formatDateInputDigits,
  isDateCode,
  parseDateInput,
  todayDateCode,
} from '../utils/dates'
import './DateField.css'

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
const MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
]

export interface DateFieldProps {
  id: string
  /** Kode tanggal `YYYY-MM-DD`; string kosong berarti belum diisi. */
  value: string
  onChange: (value: string) => void
  /** Batas bawah/atas dalam kode `YYYY-MM-DD`. */
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  name?: string
  autoFocus?: boolean
  'aria-describedby'?: string
}

interface ViewMonth {
  year: number
  month: number
}

function monthFromCode(code: string): ViewMonth | null {
  const parts = dateCodeParts(code)
  return parts ? { year: parts.year, month: parts.month } : null
}

function shiftMonth(view: ViewMonth, offset: number): ViewMonth {
  const date = new Date(Date.UTC(view.year, view.month - 1 + offset, 1))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }
}

function daysInMonth(view: ViewMonth): number {
  return new Date(Date.UTC(view.year, view.month, 0)).getUTCDate()
}

/** Indeks hari pertama bulan ini dengan Senin sebagai kolom pertama. */
function firstWeekdayIndex(view: ViewMonth): number {
  const sundayFirst = new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay()
  return (sundayFirst + 6) % 7
}

/**
 * Input tanggal bersama NutriLokal.
 *
 * Nilai yang dikirim/diterima selalu kode `YYYY-MM-DD`, sedangkan yang terlihat
 * oleh pengguna adalah `DD/MM/YYYY`. Pengguna dapat mengetik angka (garis miring
 * ditambahkan otomatis) atau memilih dari kalender. Tanggal diperlakukan sebagai
 * tanggal kalender murni sehingga tidak bergeser akibat zona waktu.
 */
export function DateField({
  id,
  value,
  onChange,
  min,
  max,
  required = false,
  disabled = false,
  placeholder = 'DD/MM/YYYY',
  name,
  autoFocus = false,
  'aria-describedby': ariaDescribedBy,
}: DateFieldProps) {
  const [text, setText] = useState(() => dateCodeToDisplay(value))
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<ViewMonth>(() => monthFromCode(value) ?? monthFromCode(todayDateCode())!)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({})
  const [invalid, setInvalid] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const internalChange = useRef(false)
  const calendarId = useId()

  // Sinkronkan teks saat nilai diubah dari luar (mis. reset formulir),
  // tetapi jangan menimpa ketikan yang sedang berlangsung.
  useEffect(() => {
    if (internalChange.current) {
      internalChange.current = false
      return
    }
    setText(dateCodeToDisplay(value))
  }, [value])

  function emit(next: string) {
    if (next === value) return
    internalChange.current = true
    onChange(next)
  }

  function outOfRange(code: string): boolean {
    if (min && compareDateCodes(code, min) < 0) return true
    if (max && compareDateCodes(code, max) > 0) return true
    return false
  }

  // Pesan validasi bawaan agar formulir tidak bisa dikirim dengan tanggal
  // setengah jadi. Batas min/max tetap menjadi aturan bisnis pemanggil:
  // DateField tidak membuang nilai yang di luar rentang, hanya menandainya
  // di kalender, supaya pesan validasi fitur tetap muncul.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    if (text.trim() === '') {
      input.setCustomValidity('')
      return
    }
    const parsed = parseDateInput(text)
    input.setCustomValidity(
      parsed ? '' : 'Tanggal tidak valid. Gunakan format DD/MM/YYYY.',
    )
  }, [text])

  function handleTextChange(raw: string) {
    setInvalid(false)

    // Nilai ISO (tempel atau otomatisasi) diterima apa adanya.
    const trimmed = raw.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      if (isDateCode(trimmed)) {
        setText(dateCodeToDisplay(trimmed))
        emit(trimmed)
        return
      }
      setText(trimmed)
      emit('')
      return
    }

    const formatted = formatDateInputDigits(raw)
    setText(formatted)
    if (formatted === '') {
      emit('')
      return
    }

    const parsed = parseDateInput(formatted)
    if (!parsed) {
      emit('')
      return
    }
    emit(parsed)
  }

  function handleBlur() {
    const trimmed = text.trim()
    if (trimmed === '') {
      setInvalid(false)
      return
    }
    const parsed = parseDateInput(trimmed)
    if (!parsed) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setText(dateCodeToDisplay(parsed))
  }

  function updatePosition() {
    const input = inputRef.current
    if (!input || typeof window === 'undefined') return
    const rect = input.getBoundingClientRect()
    const width = Math.min(320, window.innerWidth - 16)
    let left = rect.left
    if (left + width > window.innerWidth - 8) {
      left = window.innerWidth - width - 8
    }
    left = Math.max(8, left)

    const estimatedHeight = 380
    let top = rect.bottom + 6
    if (top + estimatedHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - estimatedHeight - 6)
    }

    setPopoverStyle({ position: 'fixed', top, left, width, zIndex: 1200 })
  }

  function openCalendar() {
    if (disabled) return
    setView(monthFromCode(value) ?? monthFromCode(todayDateCode())!)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    updatePosition()

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (popoverRef.current?.contains(target) || wrapperRef.current?.contains(target)) return
      setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // Hentikan di fase capture agar Escape hanya menutup kalender,
        // bukan dialog induk yang sedang terbuka.
        event.stopPropagation()
        event.preventDefault()
        setOpen(false)
        inputRef.current?.focus()
      }
    }
    function handleReposition() {
      updatePosition()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function selectDate(code: string) {
    setText(dateCodeToDisplay(code))
    setInvalid(false)
    emit(code)
    setOpen(false)
    inputRef.current?.focus()
  }

  const todayCode = todayDateCode()
  const selectedParts = dateCodeParts(value)
  const todayParts = dateCodeParts(todayCode)

  const cells: Array<number | null> = []
  const leading = firstWeekdayIndex(view)
  for (let i = 0; i < leading; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth(view); day += 1) cells.push(day)

  const calendar = open
    ? createPortal(
        <div
          ref={popoverRef}
          className="date-field-popover"
          style={popoverStyle}
          role="dialog"
          aria-label="Pilih tanggal"
          aria-controls={calendarId}
        >
          <div className="date-field-cal-head">
            <button
              type="button"
              className="date-field-nav"
              onClick={() => setView((current) => shiftMonth(current, -1))}
              aria-label="Bulan sebelumnya"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <span className="date-field-month" aria-live="polite">
              {MONTHS[view.month - 1]} {view.year}
            </span>
            <button
              type="button"
              className="date-field-nav"
              onClick={() => setView((current) => shiftMonth(current, 1))}
              aria-label="Bulan berikutnya"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="date-field-grid" id={calendarId}>
            {WEEKDAYS.map((day) => (
              <span key={day} className="date-field-weekday" aria-hidden="true">
                {day}
              </span>
            ))}
            {cells.map((day, index) => {
              if (day === null) {
                return <span key={`empty-${index}`} className="date-field-empty" />
              }
              const code = dateCodeFromParts(view.year, view.month, day)
              const disabledDay = outOfRange(code)
              const isSelected =
                !!selectedParts &&
                selectedParts.year === view.year &&
                selectedParts.month === view.month &&
                selectedParts.day === day
              const isToday =
                !!todayParts &&
                todayParts.year === view.year &&
                todayParts.month === view.month &&
                todayParts.day === day
              return (
                <button
                  key={code}
                  type="button"
                  className={[
                    'date-field-day',
                    isSelected ? 'selected' : '',
                    isToday ? 'today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => selectDate(code)}
                  disabled={disabledDay}
                  aria-pressed={isSelected}
                  aria-label={dateCodeToDisplay(code)}
                >
                  {day}
                </button>
              )
            })}
          </div>

          <div className="date-field-cal-foot">
            <button
              type="button"
              className="date-field-link"
              onClick={() => {
                if (!outOfRange(todayCode)) selectDate(todayCode)
              }}
              disabled={outOfRange(todayCode)}
            >
              Hari ini
            </button>
            {!required && (
              <button
                type="button"
                className="date-field-link"
                onClick={() => {
                  setText('')
                  setInvalid(false)
                  emit('')
                  setOpen(false)
                  inputRef.current?.focus()
                }}
              >
                Hapus
              </button>
            )}
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div className="date-field" ref={wrapperRef}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={invalid ? 'date-field-input invalid' : 'date-field-input'}
        value={text}
        onChange={(event) => handleTextChange(event.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={10}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        min={min}
        max={max}
        aria-invalid={invalid || undefined}
        aria-describedby={ariaDescribedBy}
      />
      <button
        type="button"
        className="date-field-trigger"
        onClick={() => (open ? setOpen(false) : openCalendar())}
        disabled={disabled}
        aria-label="Buka kalender"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays size={18} aria-hidden="true" />
      </button>
      {calendar}
    </div>
  )
}
