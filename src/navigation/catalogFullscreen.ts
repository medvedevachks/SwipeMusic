import { SYS_SWIPES_ID } from '../services/catalogs/systemFolders.ts'
import type { PlaybackSessionId } from '../services/playbackSession/types.ts'
import type { PlaybackContext } from '../types/playbackContext.ts'

/**
 * Активное воспроизведение пользовательского каталога (не sys_swipes inbox).
 * SessionSwitch id «catalog» или playlist-context с id каталога.
 */
export function isUserCatalogPlayback(input: {
  context: PlaybackContext
  activeSessionId?: PlaybackSessionId | null
}): boolean {
  if (input.activeSessionId === 'catalog') {
    return true
  }
  return (
    input.context.type === 'playlist' &&
    Boolean(input.context.id) &&
    input.context.id !== SYS_SWIPES_ID
  )
}

/** Название каталога из PlaybackContext playlist.title. */
export function resolveCatalogPlaybackTitle(
  context: PlaybackContext,
): string | null {
  if (
    context.type === 'playlist' &&
    context.id !== SYS_SWIPES_ID &&
    context.title.trim()
  ) {
    return context.title
  }
  return null
}

/**
 * Открывать fullscreen только после успешного played.
 * Пустой каталог / error / busy — не открываем.
 */
export function shouldOpenFullscreenAfterCatalogPlay(input: {
  status: string
}): boolean {
  return input.status === 'played'
}
