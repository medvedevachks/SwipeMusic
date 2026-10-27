import type { ThemeChoice } from './theme.ts'

export const SWITCH_CLICK_SLOP = 8

export function themeFromRatio(ratio: number): ThemeChoice {
  return ratio >= 0.5 ? 'dark' : 'light'
}

export function ratioFromClientX(clientX: number, left: number, width: number): number {
  if (width <= 0) {
    return 0
  }
  return Math.min(1, Math.max(0, (clientX - left) / width))
}

export type SwitchDrag = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  dragging: boolean
}

export function beginSwitchDrag(pointerId: number, x: number, y: number): SwitchDrag {
  return { pointerId, startX: x, startY: y, lastX: x, dragging: false }
}

export function moveSwitchDrag(drag: SwitchDrag, x: number, y: number): SwitchDrag {
  const dragging =
    drag.dragging || Math.hypot(x - drag.startX, y - drag.startY) >= SWITCH_CLICK_SLOP
  return { ...drag, lastX: x, dragging }
}

export function themeForSwitchRelease(
  drag: SwitchDrag,
  current: ThemeChoice,
  left: number,
  width: number,
): ThemeChoice {
  if (!drag.dragging) {
    return current === 'light' ? 'dark' : 'light'
  }
  return themeFromRatio(ratioFromClientX(drag.lastX, left, width))
}

export function oppositeTheme(theme: ThemeChoice): ThemeChoice {
  return theme === 'light' ? 'dark' : 'light'
}
