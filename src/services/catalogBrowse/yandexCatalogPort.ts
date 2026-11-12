import { YandexMusicApiClient } from '../../sources/adapters/yandex-music/api.ts'
import {
  buildYandexCoverUrl,
  mapYandexTrackToTrack,
} from '../../sources/adapters/yandex-music/mapTrack.ts'
import { getYandexMusicAdapter } from '../../sources/adapters/yandex-music/YandexMusicAdapter.ts'
import type {
  YandexAlbumHit,
  YandexAlbumWithTracks,
  YandexArtistHit,
} from '../../sources/adapters/yandex-music/types.ts'
import type {
  CatalogAlbum,
  CatalogArtist,
  CatalogArtistDetail,
} from '../../types/catalog.ts'
import type { Track } from '../../types/track.ts'
import type { CatalogSourcePort } from './types.ts'

const SOURCE_ID = 'yandex-music'

function mapArtist(hit: YandexArtistHit): CatalogArtist {
  const externalId = String(hit.id)
  const coverUri = hit.cover?.uri ?? hit.ogImage ?? null
  return {
    id: `${SOURCE_ID}:artist:${externalId}`,
    sourceId: SOURCE_ID,
    externalId,
    name: hit.name?.trim() || 'Unknown Artist',
    imageUrl: buildYandexCoverUrl(coverUri, '200x200'),
  }
}

function mapAlbum(hit: YandexAlbumHit): CatalogAlbum {
  const externalId = String(hit.id)
  const artistName =
    hit.artists?.map((item) => item.name).filter(Boolean).join(', ') ||
    undefined
  return {
    id: `${SOURCE_ID}:album:${externalId}`,
    sourceId: SOURCE_ID,
    externalId,
    title: hit.title?.trim() || 'Unknown Album',
    artistName,
    year: hit.year,
    trackCount: hit.trackCount,
    coverUrl: buildYandexCoverUrl(hit.coverUri, '200x200'),
  }
}

function flattenAlbumTracks(album: YandexAlbumWithTracks): Track[] {
  const tracks: Track[] = []
  for (const volume of album.volumes ?? []) {
    if (!volume) {
      continue
    }
    for (const item of volume) {
      if (!item?.id) {
        continue
      }
      tracks.push(mapYandexTrackToTrack(item))
    }
  }
  return tracks
}

function pageNextCursor(input: {
  page: number
  itemsOnPage: number
  total: number
  perPageHint: number
}): string | null {
  if (input.itemsOnPage <= 0) {
    return null
  }
  if (input.total > 0) {
    const fetched = input.page * input.perPageHint + input.itemsOnPage
    return fetched >= input.total ? null : String(input.page + 1)
  }
  // total неизвестен — продолжаем, пока страница не пустая.
  return String(input.page + 1)
}

export function createYandexCatalogPort(
  api: YandexMusicApiClient = new YandexMusicApiClient(),
): CatalogSourcePort {
  const adapter = getYandexMusicAdapter()

  return {
    sourceId: SOURCE_ID,
    sourceName: adapter.label,
    capabilities: {
      artistSearch: true,
      artistTracks: 'paginated',
      artistAlbums: 'paginated',
      albumTracks: 'full',
    },
    isAvailable: () => adapter.isAvailable(),
    async searchArtists(query, input) {
      const page = Number.parseInt(input.cursor ?? '0', 10) || 0
      const result = await api.searchArtists(query, {
        page,
        signal: input.signal,
      })
      const items = result.artists.map(mapArtist)
      return {
        items,
        nextCursor: pageNextCursor({
          page,
          itemsOnPage: items.length,
          total: result.total,
          perPageHint: Math.max(items.length, 1),
        }),
      }
    },
    async getArtist(externalId, signal) {
      try {
        const brief = await api.getArtistBrief(externalId, signal)
        const hit = brief.artist
        if (!hit?.id) {
          return {
            ...mapArtist({ id: externalId, name: externalId }),
            tracksMode: 'paginated',
            albumsMode: 'paginated',
          } satisfies CatalogArtistDetail
        }
        return {
          ...mapArtist(hit),
          tracksMode: 'paginated',
          albumsMode: 'paginated',
        }
      } catch {
        return {
          ...mapArtist({ id: externalId, name: externalId }),
          tracksMode: 'paginated',
          albumsMode: 'paginated',
        }
      }
    },
    async getArtistTracks(externalId, input) {
      const page = Number.parseInt(input.cursor ?? '0', 10) || 0
      const result = await api.getArtistTracksPage(externalId, {
        page,
        signal: input.signal,
      })
      const items = (result.tracks ?? []).map((track) =>
        mapYandexTrackToTrack(track),
      )
      const perPage = result.pager?.perPage ?? Math.max(items.length, 20)
      return {
        items,
        nextCursor: pageNextCursor({
          page,
          itemsOnPage: items.length,
          total: result.pager?.total ?? 0,
          perPageHint: perPage,
        }),
      }
    },
    async getArtistAlbums(externalId, input) {
      const page = Number.parseInt(input.cursor ?? '0', 10) || 0
      const result = await api.getArtistDirectAlbumsPage(externalId, {
        page,
        signal: input.signal,
      })
      const items = (result.albums ?? []).map(mapAlbum)
      const perPage = result.pager?.perPage ?? Math.max(items.length, 20)
      return {
        items,
        nextCursor: pageNextCursor({
          page,
          itemsOnPage: items.length,
          total: result.pager?.total ?? 0,
          perPageHint: perPage,
        }),
      }
    },
    async getAlbum(externalId, signal) {
      const album = await api.getAlbumWithTracks(externalId, signal)
      return {
        ...mapAlbum(album),
        tracksMode: 'full',
      }
    },
    async getAlbumTracks(externalId, input) {
      if (input.cursor) {
        return { items: [], nextCursor: null }
      }
      const album = await api.getAlbumWithTracks(externalId, input.signal)
      return { items: flattenAlbumTracks(album), nextCursor: null }
    },
  }
}
