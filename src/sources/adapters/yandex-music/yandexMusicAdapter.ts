import type { MusicSourceAdapter } from '../../MusicSourceAdapter'
import type { ManualSourceEntryInput } from '../../types'
import type { FetchTracksResult } from '../../types'
import { createTrack } from '../../normalizeTrack'
import {
  YANDEX_MUSIC_SOURCE_ID,
  validateYandexMusicPageUrl,
  yandexMusicExternalId,
} from '../../yandex-music/urlPolicy'
import type { SourceTrack, Track } from '../../../types/track'

export function createYandexMusicSourceAdapter(): MusicSourceAdapter {
  return {
    id: YANDEX_MUSIC_SOURCE_ID,
    label: 'Яндекс Музыка',
    kind: 'web',
    capabilities: ['externalOpen'],
    connectionNote:
      'Сохранение ссылок. Аккаунт Яндекс Музыки не подключается: официального API для сторонних приложений нет.',

    isAvailable() {
      return true
    },

    async fetchTracks(): Promise<FetchTracksResult> {
      return { tracks: [], nextCursor: null }
    },

    createManualEntry(input: ManualSourceEntryInput): SourceTrack {
      const title = input.title.trim()
      const artist = input.artist.trim()
      if (!title) {
        throw new Error('Укажите название')
      }
      if (!artist) {
        throw new Error('Укажите исполнителя')
      }

      const parsed = validateYandexMusicPageUrl(input.pageUrl)
      if (!parsed.ok) {
        throw new Error(parsed.error)
      }

      const externalId = yandexMusicExternalId(parsed.href)
      const base = createTrack({
        sourceId: YANDEX_MUSIC_SOURCE_ID,
        externalId,
        title,
        artist,
        pageUrl: parsed.href,
        previewUrl: null,
      })

      return {
        ...base,
        pageUrl: parsed.href,
        availability: 'unknown',
        playback: { embedded: false, externalOpen: true },
        addedAt: new Date().toISOString(),
      }
    },

    canPlay(_track: Track) {
      return false
    },

    openExternal(track: Track) {
      const href = track.pageUrl
      if (!href) {
        return
      }
      const parsed = validateYandexMusicPageUrl(href)
      if (!parsed.ok) {
        return
      }
      window.open(parsed.href, '_blank', 'noopener,noreferrer')
    },
  }
}
