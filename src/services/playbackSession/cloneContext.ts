import type { PlaybackContext } from '../../types/playbackContext.ts'

/**
 * Глубокая копия PlaybackContext с exhaustive switch (R4).
 * Новый вариант union без ветки → ошибка компиляции.
 */
export function clonePlaybackContext(context: PlaybackContext): PlaybackContext {
  switch (context.type) {
    case 'search-seed':
      return {
        type: 'search-seed',
        query: context.query,
        seedTrackId: context.seedTrackId,
        ...(context.hardExcludeHits
          ? {
              hardExcludeHits: context.hardExcludeHits.map((hit) => ({ ...hit })),
            }
          : {}),
      }
    case 'album':
      return {
        type: 'album',
        id: context.id,
        title: context.title,
        ...(context.artist !== undefined ? { artist: context.artist } : {}),
      }
    case 'playlist':
      return { type: 'playlist', id: context.id, title: context.title }
    case 'search':
      return { type: 'search', query: context.query }
    case 'radio':
      return {
        type: 'radio',
        id: context.id,
        title: context.title,
        origin: context.origin,
      }
    case 'library':
      return { type: 'library' }
    case 'swipe':
      return { type: 'swipe' }
    case 'none':
      return { type: 'none' }
    default: {
      const _exhaustive: never = context
      throw new Error(
        `Unsupported PlaybackContext: ${JSON.stringify(_exhaustive)}`,
      )
    }
  }
}
