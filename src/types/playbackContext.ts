/**
 * Источник текущей очереди / воспроизведения.
 * Не дублирует currentTrack — только provenance queue.
 */
export type PlaybackContext =
  | {
      type: 'album'
      id: string
      title: string
      artist?: string
    }
  | {
      type: 'playlist'
      id: string
      title: string
    }
  | {
      type: 'search'
      query: string
    }
  | {
      /**
       * Один трек, явно выбранный из поиска.
       * Очередь — этот трек и позже подготовленное продолжение, не выдача.
       */
      type: 'search-seed'
      query: string
      seedTrackId: string
    }
  | {
      type: 'swipe'
    }
  | {
      type: 'library'
    }
  | {
      type: 'radio'
      id: 'my-wave'
      title: string
      origin: 'recommendations' | 'favorites'
    }
  | {
      type: 'none'
    }

export const NONE_PLAYBACK_CONTEXT: PlaybackContext = { type: 'none' }

export type SearchSeedPlaybackContext = Extract<PlaybackContext, { type: 'search-seed' }>

/** Album, playlist, «Моя волна» и одиночный трек из поиска: главная не подменяет очередь лентой. */
export function isQueueLockedContext(context: PlaybackContext): boolean {
  return (
    context.type === 'album' ||
    context.type === 'playlist' ||
    context.type === 'radio' ||
    context.type === 'search-seed'
  )
}

export function isSearchSeedContext(
  context: PlaybackContext,
): context is SearchSeedPlaybackContext {
  return context.type === 'search-seed'
}

export function parsePlaybackContext(value: unknown): PlaybackContext {
  if (!value || typeof value !== 'object') {
    return NONE_PLAYBACK_CONTEXT
  }
  const record = value as Record<string, unknown>
  const type = record.type
  switch (type) {
    case 'album': {
      if (typeof record.id !== 'string' || typeof record.title !== 'string') {
        return NONE_PLAYBACK_CONTEXT
      }
      return {
        type: 'album',
        id: record.id,
        title: record.title,
        ...(typeof record.artist === 'string' ? { artist: record.artist } : {}),
      }
    }
    case 'playlist': {
      if (typeof record.id !== 'string' || typeof record.title !== 'string') {
        return NONE_PLAYBACK_CONTEXT
      }
      return { type: 'playlist', id: record.id, title: record.title }
    }
    case 'search': {
      if (typeof record.query !== 'string') {
        return NONE_PLAYBACK_CONTEXT
      }
      return { type: 'search', query: record.query }
    }
    case 'search-seed': {
      if (typeof record.query !== 'string' || typeof record.seedTrackId !== 'string' || !record.seedTrackId) {
        return NONE_PLAYBACK_CONTEXT
      }
      return { type: 'search-seed', query: record.query, seedTrackId: record.seedTrackId }
    }
    case 'swipe':
      return { type: 'swipe' }
    case 'library':
      return { type: 'library' }
    case 'radio': {
      if (record.id !== 'my-wave') {
        return NONE_PLAYBACK_CONTEXT
      }
      return {
        type: 'radio',
        id: 'my-wave',
        title: typeof record.title === 'string' && record.title ? record.title : 'Моя волна',
        origin: record.origin === 'favorites' ? 'favorites' : 'recommendations',
      }
    }
    case 'none':
      return NONE_PLAYBACK_CONTEXT
    default:
      return NONE_PLAYBACK_CONTEXT
  }
}
