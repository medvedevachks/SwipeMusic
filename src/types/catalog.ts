/**
 * Каталог исполнителей / альбомов (не путать с пользовательскими Catalog в библиотеке).
 */

export type CatalogArtist = {
  id: string
  sourceId: string
  externalId: string
  name: string
  imageUrl?: string | null
}

export type CatalogAlbum = {
  id: string
  sourceId: string
  externalId: string
  title: string
  artistName?: string
  year?: number
  trackCount?: number
  coverUrl?: string | null
}

export type CatalogArtistDetail = CatalogArtist & {
  /** Ограничение источника, если песни нельзя листать как полную дискографию. */
  tracksMode: CatalogTracksMode
  albumsMode: 'paginated' | 'unsupported'
}

export type CatalogTracksMode =
  /** Постраничный список треков артиста с API источника. */
  | 'paginated'
  /** Spotify: треки собираются из альбомов (нет единого /artist/tracks). */
  | 'album-derived'
  | 'unsupported'

export type CatalogAlbumDetail = CatalogAlbum & {
  tracksMode: 'full' | 'paginated' | 'unsupported'
}
