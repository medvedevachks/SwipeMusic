import type { MusicSourceAdapter } from '../../MusicSourceAdapter'
import type { ManualSourceEntryInput } from '../../types'
import type { FetchTracksResult } from '../../types'
import { createTrack } from '../../normalizeTrack'
import { ZAYCEV_SOURCE_ID, validateZaycevPageUrl, zaycevExternalId } from '../../zaycev/urlPolicy'
import type { SourceTrack, Track } from '../../../types/track'

export function createZaycevMusicSourceAdapter(): MusicSourceAdapter {
  return {
    id: ZAYCEV_SOURCE_ID,
    label: 'Zaycev.net',
    kind: 'web',
    capabilities: ['externalOpen'],
    connectionNote:
      'Сохранение ссылок. Аккаунт Zaycev.net не подключается, поиск и встроенное воспроизведение недоступны.',

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

      const parsed = validateZaycevPageUrl(input.pageUrl)
      if (!parsed.ok) {
        throw new Error(parsed.error)
      }

      const externalId = zaycevExternalId(parsed.href)
      const base = createTrack({
        sourceId: ZAYCEV_SOURCE_ID,
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
      const parsed = validateZaycevPageUrl(href)
      if (!parsed.ok) {
        return
      }
      window.open(parsed.href, '_blank', 'noopener,noreferrer')
    },
  }
}
