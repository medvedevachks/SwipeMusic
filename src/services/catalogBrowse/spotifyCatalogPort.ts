import { mapSpotifyTrackToTrack } from '../../sources/adapters/spotify/mapTrack.ts'
import { getSpotifyAdapter } from '../../sources/adapters/spotify/SpotifyAdapter.ts'
import type {
  SpotifyAlbum,
  SpotifyArtist,
  SpotifySimplifiedTrack,
} from '../../sources/adapters/spotify/types.ts'
import type {
  CatalogAlbum,
  CatalogArtist,
  CatalogArtistDetail,
} from '../../types/catalog.ts'
import type { Track } from '../../types/track.ts'
import type { CatalogSourcePort } from './types.ts'

const SOURCE_ID = 'spotify'

type AlbumDerivedCursor = {
  albumOffset: number
  albumId: string | null
  trackOffset: number
}

function mapArtist(hit: SpotifyArtist): CatalogArtist {
  return {
    id: `${SOURCE_ID}:artist:${hit.id}`,
    sourceId: SOURCE_ID,
    externalId: hit.id,
    name: hit.name?.trim() || 'Unknown Artist',
    imageUrl: hit.images?.[0]?.url ?? null,
  }
}

function mapAlbum(hit: SpotifyAlbum): CatalogAlbum {
  const year = hit.release_date
    ? Number.parseInt(hit.release_date.slice(0, 4), 10)
    : undefined
  return {
    id: `${SOURCE_ID}:album:${hit.id}`,
    sourceId: SOURCE_ID,
    externalId: hit.id,
    title: hit.name?.trim() || 'Unknown Album',
    artistName:
      hit.artists?.map((item) => item.name).filter(Boolean).join(', ') ||
      undefined,
    year: Number.isFinite(year) ? year : undefined,
    trackCount: hit.total_tracks,
    coverUrl: hit.images?.[0]?.url ?? null,
  }
}

function mapSimplifiedTrack(
  track: SpotifySimplifiedTrack,
  album: SpotifyAlbum,
): Track {
  return mapSpotifyTrackToTrack({
    id: track.id,
    name: track.name,
    duration_ms: track.duration_ms,
    preview_url: track.preview_url,
    artists: track.artists,
    album: {
      id: album.id,
      name: album.name,
      images: album.images,
      release_date: album.release_date,
    },
    external_ids: track.external_ids,
    explicit: track.explicit,
  })
}

function parseAlbumDerivedCursor(cursor: string | null): AlbumDerivedCursor {
  if (!cursor) {
    return { albumOffset: 0, albumId: null, trackOffset: 0 }
  }
  try {
    const parsed = JSON.parse(cursor) as AlbumDerivedCursor
    return {
      albumOffset: parsed.albumOffset ?? 0,
      albumId: parsed.albumId ?? null,
      trackOffset: parsed.trackOffset ?? 0,
    }
  } catch {
    return { albumOffset: 0, albumId: null, trackOffset: 0 }
  }
}

function encodeAlbumDerivedCursor(cursor: AlbumDerivedCursor): string {
  return JSON.stringify(cursor)
}

/**
 * Spotify: нет единого paginated /artists/{id}/tracks.
 * Песни артиста собираем из альбомов (реальные album tracks API).
 */
export function createSpotifyCatalogPort(): CatalogSourcePort {
  const adapter = getSpotifyAdapter()
  const api = adapter.getApiClient()

  return {
    sourceId: SOURCE_ID,
    sourceName: adapter.label,
    capabilities: {
      artistSearch: true,
      artistTracks: 'album-derived',
      artistAlbums: 'paginated',
      albumTracks: 'paginated',
    },
    isAvailable: () => adapter.isAvailable(),
    async searchArtists(query, input) {
      const offset = Number.parseInt(input.cursor ?? '0', 10) || 0
      const page = await api.searchArtists(query, {
        limit: 20,
        offset,
        signal: input.signal,
      })
      const items = (page.items ?? []).map(mapArtist)
      const nextOffset = offset + items.length
      const nextCursor =
        page.next && nextOffset < (page.total ?? nextOffset)
          ? String(nextOffset)
          : null
      return { items, nextCursor }
    },
    async getArtist(externalId, signal) {
      const hit = await api.getArtist(externalId, signal)
      return {
        ...mapArtist(hit),
        tracksMode: 'album-derived',
        albumsMode: 'paginated',
      } satisfies CatalogArtistDetail
    },
    async getArtistTracks(externalId, input) {
      // Одна «страница» = треки одного альбома (или продолжение альбома).
      const cursor = parseAlbumDerivedCursor(input.cursor)
      let albumOffset = cursor.albumOffset
      let albumId = cursor.albumId
      let trackOffset = cursor.trackOffset

      if (!albumId) {
        const albums = await api.getArtistAlbums(externalId, {
          limit: 1,
          offset: albumOffset,
          signal: input.signal,
        })
        const first = albums.items?.[0]
        if (!first) {
          return { items: [], nextCursor: null }
        }
        albumId = first.id
        trackOffset = 0
      }

      const album = await api.getAlbum(albumId, input.signal)
      const tracksPage = await api.getAlbumTracks(albumId, {
        limit: 50,
        offset: trackOffset,
        signal: input.signal,
      })
      const items = (tracksPage.items ?? [])
        .filter((item): item is SpotifySimplifiedTrack => Boolean(item?.id))
        .map((item) => mapSimplifiedTrack(item, album))

      const nextTrackOffset = trackOffset + (tracksPage.items?.length ?? 0)
      if (tracksPage.next) {
        return {
          items,
          nextCursor: encodeAlbumDerivedCursor({
            albumOffset,
            albumId,
            trackOffset: nextTrackOffset,
          }),
        }
      }

      const nextAlbumOffset = albumOffset + 1
      const moreAlbums = await api.getArtistAlbums(externalId, {
        limit: 1,
        offset: nextAlbumOffset,
        signal: input.signal,
      })
      if (!moreAlbums.items?.[0]) {
        return { items, nextCursor: null }
      }
      return {
        items,
        nextCursor: encodeAlbumDerivedCursor({
          albumOffset: nextAlbumOffset,
          albumId: null,
          trackOffset: 0,
        }),
      }
    },
    async getArtistAlbums(externalId, input) {
      const offset = Number.parseInt(input.cursor ?? '0', 10) || 0
      const page = await api.getArtistAlbums(externalId, {
        limit: 20,
        offset,
        signal: input.signal,
      })
      const items = (page.items ?? []).map(mapAlbum)
      const nextOffset = offset + items.length
      const nextCursor =
        page.next && nextOffset < (page.total ?? nextOffset)
          ? String(nextOffset)
          : null
      return { items, nextCursor }
    },
    async getAlbum(externalId, signal) {
      const album = await api.getAlbum(externalId, signal)
      return {
        ...mapAlbum(album),
        tracksMode: 'paginated',
      }
    },
    async getAlbumTracks(externalId, input) {
      const offset = Number.parseInt(input.cursor ?? '0', 10) || 0
      const album = await api.getAlbum(externalId, input.signal)
      const page = await api.getAlbumTracks(externalId, {
        limit: 50,
        offset,
        signal: input.signal,
      })
      const items = (page.items ?? [])
        .filter((item): item is SpotifySimplifiedTrack => Boolean(item?.id))
        .map((item) => mapSimplifiedTrack(item, album))
      const nextOffset = offset + items.length
      const nextCursor =
        page.next && nextOffset < (page.total ?? nextOffset)
          ? String(nextOffset)
          : null
      return { items, nextCursor }
    },
  }
}
