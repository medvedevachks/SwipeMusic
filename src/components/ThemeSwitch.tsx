import { useRef, useState, type PointerEvent } from 'react'
import {
  applyTheme,
  commitTheme,
  resolveTheme,
  THEME_TOKENS,
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

function useAppliedTheme(): [ThemeChoice, (theme: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(() => resolveTheme())

  return [
    theme,
    (next) => {
      commitTheme(next)
      setTheme(next)
    },
  ]
}

function ThemePreview({ theme }: { theme: ThemeChoice }) {
  const tokens = THEME_TOKENS[theme]
  return (
    <div
      data-theme-preview={theme}
      className="overflow-hidden rounded-2xl border p-3"
      style={{ background: tokens.bg, borderColor: tokens.border, color: tokens.fg }}
    >
      <div
        className="rounded-xl border p-3"
        style={{ background: tokens.surface, borderColor: tokens.border }}
      >
        <p className="text-sm font-medium" style={{ color: tokens.fg }}>
          {theme === 'dark' ? 'Ночной режим' : 'Дневной режим'}
        </p>
        <p className="mt-1 text-xs" style={{ color: tokens.muted }}>
          Фон, карточка и акцент
        </p>
        <span
          className="mt-3 inline-flex rounded-lg px-3 py-1.5 text-xs font-semibold"
          style={{ background: tokens.accent, color: tokens.accentFg }}
        >
          Слушать
        </span>
      </div>
    </div>
  )
}

export default function ThemeSwitch() {
  const [theme, setTheme] = useAppliedTheme()
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<SwitchDrag | null>(null)
  const [dragRatio, setDragRatio] = useState<number | null>(null)
  const ratio = dragRatio ?? (theme === 'dark' ? 1 : 0)
  const dragging = dragRatio !== null
  const preview = themeFromRatio(ratio)

  const trackBox = () => trackRef.current?.getBoundingClientRect()

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Указатель уже отпущен или событие синтетическое: жест всё равно читаем по pointerup.
    }
    dragRef.current = beginSwitchDrag(event.pointerId, event.clientX, event.clientY)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const next = moveSwitchDrag(drag, event.clientX, event.clientY)
    dragRef.current = next
    if (!next.dragging) {
      return
    }
    const box = trackBox()
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
    const box = trackBox()
    const chosen = themeForSwitchRelease(
      drag,
      theme,
      box?.left ?? 0,
      box?.width ?? 0,
    )
    dragRef.current = null
    setDragRatio(null)
    setTheme(chosen)
  }

  return (
    <section className="space-y-3" aria-label="Оформление">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold text-[var(--color-fg)]">
          Тема
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Тёмная тема мягче для ночной езды. Бегунок можно нажать или перетащить.
        </p>
      </div>
      <div
        ref={trackRef}
        role="switch"
        tabIndex={0}
        aria-checked={theme === 'dark'}
        aria-label="Тёмная тема"
        data-theme-switch={theme}
        className="relative h-16 w-full max-w-md cursor-pointer rounded-full p-1 shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
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
            setTheme(theme === 'light' ? 'dark' : 'light')
          }
        }}
      >
        <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-lg text-[#14212b]" aria-hidden>
          ☀
        </span>
        <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-lg text-[#f4f7f8]" aria-hidden>
          ☾
        </span>
        <span
          data-switch-thumb
          className="pointer-events-none absolute top-1 flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full bg-white text-lg text-[#14212b] shadow-[0_8px_18px_-8px_rgba(16,22,27,0.65)]"
          style={{
            left: `calc(0.25rem + ${ratio} * (100% - 3.75rem))`,
            transition: dragging ? 'none' : 'left 240ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {preview === 'dark' ? '☾' : '☀'}
        </span>
      </div>
      <ThemePreview theme={preview} />
    </section>
  )
}
