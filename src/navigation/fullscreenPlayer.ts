import type { NavigateFunction, Location } from 'react-router-dom'
import type { PlaybackContext } from '../types/playbackContext.ts'
import type { PlaybackSessionId } from '../services/playbackSession/types.ts'
import { SYS_SWIPES_ID } from '../services/catalogs/systemFolders.ts'

/** Query-параметр overlay полноэкранного плеера. Не конфликтует с маршрутами разделов. */
export const FULLSCREEN_PLAYER_PARAM = 'player'
export const FULLSCREEN_PLAYER_VALUE = 'full'

export type FullscreenPlayerHistoryState = {
  fullscreenPlayerEntry?: boolean
}

export function isFullscreenPlayerSearch(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.get(FULLSCREEN_PLAYER_PARAM) === FULLSCREEN_PLAYER_VALUE
}

export function withFullscreenPlayerSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  params.set(FULLSCREEN_PLAYER_PARAM, FULLSCREEN_PLAYER_VALUE)
  const next = params.toString()
  return next ? `?${next}` : ''
}

export function withoutFullscreenPlayerSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  params.delete(FULLSCREEN_PLAYER_PARAM)
  const next = params.toString()
  return next ? `?${next}` : ''
}

/**
 * Открыть overlay. Повторный вызов при уже открытом плеере не пушит историю.
 */
export function openFullscreenPlayer(
  navigate: NavigateFunction,
  location: Pick<Location, 'pathname' | 'search' | 'hash' | 'state'>,
): void {
  if (isFullscreenPlayerSearch(location.search)) {
    return
  }
  const prevState =
    location.state && typeof location.state === 'object'
      ? (location.state as Record<string, unknown>)
      : {}
  navigate(
    {
      pathname: location.pathname,
      search: withFullscreenPlayerSearch(location.search),
      hash: location.hash,
    },
    {
      state: {
        ...prevState,
        fullscreenPlayerEntry: true,
      } satisfies FullscreenPlayerHistoryState & Record<string, unknown>,
    },
  )
}

/**
 * Закрыть overlay.
 * Если вход был через openFullscreenPlayer — Back (−1).
 * Прямой URL / без маркера — strip query с replace (не выходим из приложения).
 */
export function closeFullscreenPlayer(
  navigate: NavigateFunction,
  location: Pick<Location, 'pathname' | 'search' | 'hash' | 'state'>,
): void {
  if (!isFullscreenPlayerSearch(location.search)) {
    return
  }
  const state = location.state as FullscreenPlayerHistoryState | null
  if (state?.fullscreenPlayerEntry === true) {
    navigate(-1)
    return
  }
  const prevState =
    location.state && typeof location.state === 'object'
      ? { ...(location.state as Record<string, unknown>) }
      : {}
  delete prevState.fullscreenPlayerEntry
  navigate(
    {
      pathname: location.pathname,
      search: withoutFullscreenPlayerSearch(location.search),
      hash: location.hash,
    },
    { replace: true, state: prevState },
  )
}

export type PlayerSessionLabel =
  | 'Свайпы'
  | 'Моя волна'
  | 'Поиск'
  | 'Каталог'
  | 'Альбом'
  | 'Библиотека'
  | '—'

/** Подпись активной музыкальной сессии (не текущего UI-экрана). */
export function resolvePlayerSessionLabel(input: {
  context: PlaybackContext
  activeSessionId?: PlaybackSessionId | null
}): PlayerSessionLabel {
  const id = input.activeSessionId
  if (id === 'swipes') {
    return 'Свайпы'
  }
  if (id === 'wave') {
    return 'Моя волна'
  }
  if (id === 'search') {
    return 'Поиск'
  }
  if (id === 'catalog') {
    return 'Каталог'
  }
  if (id === 'album') {
    return 'Альбом'
  }

  const context = input.context
  switch (context.type) {
    case 'swipe':
      return 'Свайпы'
    case 'radio':
      return 'Моя волна'
    case 'search':
    case 'search-seed':
      return 'Поиск'
    case 'album':
      return 'Альбом'
    case 'playlist':
      return context.id === SYS_SWIPES_ID ? 'Свайпы' : 'Каталог'
    case 'library':
      return 'Библиотека'
    case 'none':
    default:
      return '—'
  }
}
