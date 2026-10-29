export const PLAY_CONTROL = {
  size: 96,
  minTarget: 44,
} as const

export const PAGE_PADDING = 32
/** Боковая колонка подсказки (2.75rem) в .swipe-deck grid. */
export const DECK_GUTTER = 44
export const FRAME_MAX = 42 * 16
export const DECK_MAX = 28 * 16

export const CHECK_VIEWPORTS = [
  { name: 'phone-360', width: 360, height: 800 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'car-1024', width: 1024, height: 600 },
  { name: 'car-1280', width: 1280, height: 720 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
] as const

export function playControlFrame(cover: { width: number; height: number }) {
  const { size } = PLAY_CONTROL
  const left = (cover.width - size) / 2
  const top = (cover.height - size) / 2
  return {
    left,
    top,
    width: size,
    height: size,
    fits: left >= 0 && top >= 0,
    centered: left * 2 + size === cover.width && top * 2 + size === cover.height,
    targetOk: size >= PLAY_CONTROL.minTarget,
  }
}

/** Ширина самой карточки внутри боковых подсказок. */
export function stageInnerWidth(viewportWidth: number): number {
  const frame = Math.min(Math.max(0, viewportWidth - PAGE_PADDING), FRAME_MAX)
  const deck = Math.min(frame, DECK_MAX)
  return deck - DECK_GUTTER * 2
}

/** Низ прокручиваемой колонки совпадает с верхом дока, а не уходит под него. */
export function mainEndsAboveDock(
  viewportHeight: number,
  dockHeight: number,
  contentBottom: number,
): boolean {
  return contentBottom <= viewportHeight - dockHeight + 0.5
}
