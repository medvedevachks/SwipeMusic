import type {
  CatalogAlbum,
  CatalogAlbumDetail,
  CatalogArtist,
  CatalogArtistDetail,
  CatalogTracksMode,
} from '../../types/catalog.ts'
import type { Track } from '../../types/track.ts'

export type CatalogPage<T> = {
  items: T[]
  nextCursor: string | null
}

export type CatalogSourceCapabilities = {
  artistSearch: boolean
  artistTracks: CatalogTracksMode
  artistAlbums: 'paginated' | 'unsupported'
  albumTracks: 'full' | 'paginated' | 'unsupported'
}

export type CatalogSourcePort = {
  readonly sourceId: string
  readonly sourceName: string
  readonly capabilities: CatalogSourceCapabilities
  isAvailable(): boolean | Promise<boolean>
  searchArtists(
    query: string,
    input: { cursor: string | null; signal?: AbortSignal },
  ): Promise<CatalogPage<CatalogArtist>>
  getArtist(
    externalId: string,
    signal?: AbortSignal,
  ): Promise<CatalogArtistDetail | null>
  getArtistTracks(
    externalId: string,
    input: { cursor: string | null; signal?: AbortSignal },
  ): Promise<CatalogPage<Track>>
  getArtistAlbums(
    externalId: string,
    input: { cursor: string | null; signal?: AbortSignal },
  ): Promise<CatalogPage<CatalogAlbum>>
  getAlbum(
    externalId: string,
    signal?: AbortSignal,
  ): Promise<CatalogAlbumDetail | null>
  getAlbumTracks(
    externalId: string,
    input: { cursor: string | null; signal?: AbortSignal },
  ): Promise<CatalogPage<Track>>
}
