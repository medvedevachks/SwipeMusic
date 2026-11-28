import type { Track } from '../types/track.ts'

/**
 * Композиция для лайка/каталога в FullscreenPlayer.
 * pendingTrack не является «уже играющей» — действия только к currentTrack.
 */
export function resolveFullscreenActionTrack(input: {
  currentTrack: Track | null | undefined
  pendingTrack: Track | null | undefined
}): Track | null {
  if (input.pendingTrack) {
    return null
  }
  return input.currentTrack ?? null
}

/**
 * Like в Fullscreen.
 * По умолчанию UI блокирует уже liked (повторный commit идемпотентен).
 * allowInboxEnsure: FAV-02 — разрешить like→sys_swipes для уже лайкнутого,
 * но ещё не разобранного (нет user-catalog / нет inbox).
 */
export function canFullscreenLike(input: {
  actionTrack: Track | null
  liked: boolean
  likeBusy: boolean
  allowInboxEnsure?: boolean
}): boolean {
  if (!input.actionTrack || input.likeBusy) {
    return false
  }
  if (!input.liked) {
    return true
  }
  return input.allowInboxEnsure === true
}

/**
 * Каталог пинится на открытии sheet.
 * Смена currentTrack → закрыть sheet (не применять выбор к другой композиции).
 */
export function shouldDismissCatalogOnTrackChange(input: {
  catalogOpen: boolean
  pinnedTrackId: string | null | undefined
  currentTrackId: string | null | undefined
}): boolean {
  if (!input.catalogOpen || !input.pinnedTrackId) {
    return false
  }
  if (!input.currentTrackId) {
    return true
  }
  return input.pinnedTrackId !== input.currentTrackId
}

export function resolveCatalogCommitTrack(input: {
  pinnedTrack: Track | null
  currentTrack: Track | null | undefined
}): Track | null {
  if (!input.pinnedTrack) {
    return null
  }
  // Commit только если pinned всё ещё текущий audible (или ещё не сменился).
  if (input.currentTrack && input.currentTrack.id !== input.pinnedTrack.id) {
    return null
  }
  return input.pinnedTrack
}
