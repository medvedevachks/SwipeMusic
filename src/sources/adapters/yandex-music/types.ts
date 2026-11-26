export type YandexAuthSession = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
}

export type YandexDeviceCode = {
  deviceCode: string
  userCode: string
  verificationUrl: string
  intervalSec: number
  expiresIn: number
}

export type YandexAccountStatus = {
  account?: {
    uid?: number
    login?: string
    displayName?: string
  }
  plus?: {
    hasPlus?: boolean
  }
}

export type YandexArtist = {
  id?: number | string
  name?: string
}

export type YandexAlbum = {
  id?: number | string
  title?: string
  year?: number
  coverUri?: string
}

export type YandexTrack = {
  id: number | string
  title?: string
  artists?: YandexArtist[]
  albums?: YandexAlbum[]
  durationMs?: number
  coverUri?: string
  available?: boolean
  availableForPremiumUsers?: boolean
  availableFullWithoutPermission?: boolean
  previewUrl?: string | null
}

export type YandexSearchResponse = {
  tracks?: {
    results?: YandexTrack[]
    total?: number
  }
  artists?: {
    results?: YandexArtistHit[]
    total?: number
  }
}

export type YandexArtistHit = {
  id: number | string
  name?: string
  cover?: { uri?: string }
  ogImage?: string
}

export type YandexArtistBrief = {
  artist?: YandexArtistHit
  counts?: { tracks?: number; directAlbums?: number }
}

export type YandexPager = {
  page?: number
  perPage?: number
  total?: number
}

export type YandexArtistTracksPage = {
  tracks?: YandexTrack[]
  pager?: YandexPager
}

export type YandexArtistAlbumsPage = {
  albums?: YandexAlbumHit[]
  pager?: YandexPager
}

export type YandexAlbumHit = {
  id: number | string
  title?: string
  year?: number
  trackCount?: number
  coverUri?: string
  artists?: YandexArtist[]
}

export type YandexAlbumWithTracks = YandexAlbumHit & {
  volumes?: Array<Array<YandexTrack | null> | null>
}

export type YandexDownloadInfo = {
  codec?: string
  bitrateInKbps?: number
  gain?: boolean
  preview?: boolean
  downloadInfoUrl: string
  direct?: boolean
}

export type YandexPlaylistShort = {
  kind: number
  title: string
  trackCount?: number
  uid?: number
}

export type YandexSyncMeta = {
  lastSyncedAt: string | null
  trackCount: number
  playlistCount: number
  displayName: string | null
  uid: number | null
  hasPlus: boolean
}
