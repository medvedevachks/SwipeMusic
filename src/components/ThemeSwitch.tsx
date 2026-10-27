import { useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import {
  applyTheme,
  commitTheme,
  getTheme,
  subscribeTheme,
  type ThemeChoice,
} from '../theme/theme.ts'
import {
  beginSwitchDrag,
  moveSwitchDrag,
  ratioFromClientX,
  themeForSwitchRelease,
  themeFromRatio,
  type SwitchDrag,
} from '../theme/switchGesture.ts'

function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribeTheme, getTheme, getTheme)
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      <path d="M12 3.5v1.8M12 18.7v1.8M4.8 4.8l1.3 1.3M17.9 17.9l1.3 1.3M3.5 12h1.8M18.7 12h1.8M4.8 19.2l1.3-1.3M17.9 6.1l1.3-1.3" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M15.2 3.4a8.2 8.2 0 1 0 5.4 12.6A7 7 0 0 1 15.2 3.4z" />
    </svg>
  )
}

export function ThemeSwitchControl() {
  const theme = useThemeChoice()
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<SwitchDrag | null>(null)
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const ratio = dragRatio ?? (theme === 'dark' ? 1 : 0)
  const dragging = dragRatio !== null
  const preview = themeFromRatio(ratio)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Синтетическое событие не держит pointer id, жест читается по pointerup.
    }
    dragRef.current = beginSwitchDrag(event.pointerId, event.clientX, event.clientY)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    event.stopPropagation()
    const next = moveSwitchDrag(drag, event.clientX, event.clientY)
    dragRef.current = next
    if (!next.dragging) {
      return
    }
    const box = trackRef.current?.getBoundingClientRect()
    if (!box) {
      return
    }
    const nextRatio = ratioFromClientX(event.clientX, box.left, box.width)
    setDragRatio(nextRatio)
    applyTheme(themeFromRatio(nextRatio))
  }

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    event.stopPropagation()
    const box = trackRef.current?.getBoundingClientRect()
    const chosen = themeForSwitchRelease(drag, theme, box?.left ?? 0, box?.width ?? 0)
    dragRef.current = null
    setDragRatio(null)
    commitTheme(chosen)
  }

  return (
    <div
      ref={trackRef}
      role="switch"
      tabIndex={0}
      aria-checked={theme === 'dark'}
      aria-label="Тёмная тема"
      data-theme-switch={theme}
      className="relative h-11 w-[88px] shrink-0 cursor-pointer rounded-full p-1 shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      style={{
        background: 'linear-gradient(90deg, #d5e0e6 0%, #24303a 100%)',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          commitTheme(theme === 'light' ? 'dark' : 'light')
        }
      }}
    >
      <span
        data-switch-thumb
        className="pointer-events-none absolute top-1 flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#14212b] shadow-[0_6px_14px_-8px_rgba(16,22,27,0.7)]"
        style={{
          left: `calc(0.25rem + ${ratio} * (100% - 2.75rem))`,
          transition: dragging ? 'none' : 'left 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {preview === 'dark' ? <MoonIcon /> : <SunIcon />}
      </span>
    </div>
  )
}

export default function ThemeSwitch() {
  return (
    <section aria-label="Оформление">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">Тема</h2>
        <ThemeSwitchControl />
      </div>
    </section>
  )
}
