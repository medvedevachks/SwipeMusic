import { md5Hex } from './md5.ts'
import { pushYandexDevLog } from './devLog.ts'
import { yandexMusicRequestHeaders } from './requestHeaders.ts'
import type {
  YandexAccountStatus,
  YandexDownloadInfo,
  YandexPlaylistShort,
  YandexSearchResponse,
  YandexTrack,
} from './types.ts'

const API_BASE = '/api/yandex-music'
const STREAM_URL_TTL_MS = 45_000
const streamUrlCache = new Map<string, { url: string; at: number }>()

function readStreamCache(trackId: string): string | null {
  const hit = streamUrlCache.get(trackId)
  if (!hit) {
    return null
  }
  if (Date.now() - hit.at > STREAM_URL_TTL_MS) {
    streamUrlCache.delete(trackId)
    return null
  }
  return hit.url
}

function storeStreamCache(trackId: string, url: string): void {
  streamUrlCache.set(trackId, { url, at: Date.now() })
}

export class YandexApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code = 'UPSTREAM') {
    super(message)
    this.name = 'YandexApiError'
    this.status = status
    this.code = code
  }
}

type ApiEnvelope<T> = {
  invocationInfo?: unknown
  result?: T
  error?: { name?: string; message?: string }
}

export class YandexMusicApiClient {

  async getAccountStatus(signal?: AbortSignal): Promise<YandexAccountStatus> {
    return this.getJson<YandexAccountStatus>('/account/status', signal)
  }

  async searchTracks(
    query: string,
    options?: { page?: number; pageSize?: number; signal?: AbortSignal },
  ): Promise<{ tracks: YandexTrack[]; total: number }> {
    const params = new URLSearchParams({
      text: query,
      type: 'track',
      page: String(options?.page ?? 0),
      nocorrect: 'false',
    })
    pushYandexDevLog({
      stage: 'request',
      message: 'GET /search',
      detail: `q=${query}`,
    })
    const result = await this.getJson<YandexSearchResponse>(
      `/search?${params.toString()}`,
      options?.signal,
      { logHttp: true },
    )
    const tracks = result.tracks?.results ?? []
    return {
      tracks,
      total: result.tracks?.total ?? tracks.length,
    }
  }

  async getLikedTracks(
    userId: number | string,
    signal?: AbortSignal,
  ): Promise<YandexTrack[]> {
    pushYandexDevLog({
      stage: 'library',
      message: 'GET likes/tracks',
      detail: `uid=${userId}`,
    })
    const result = await this.getJson<{
      library?: { tracks?: Array<{ id: string | number; albumId?: string }> }
    }>(`/users/${userId}/likes/tracks`, signal)

    const refs = result.library?.tracks ?? []
    if (refs.length === 0) {
      return []
    }
    const ids = refs.map((item) =>
      item.albumId != null && String(item.albumId).length > 0
        ? `${item.id}:${item.albumId}`
        : String(item.id),
    )
    return this.getTracksByIds(ids, signal)
  }

  async getTracksByIds(
    ids: string | string[],
    signal?: AbortSignal,
  ): Promise<YandexTrack[]> {
    const list = (Array.isArray(ids) ? ids : ids.split(','))
      .map((item) => item.trim())
      .filter(Boolean)
    if (list.length === 0) {
      return []
    }

    const chunkSize = 50
    const tracks: YandexTrack[] = []
    for (let offset = 0; offset < list.length; offset += chunkSize) {
      const chunk = list.slice(offset, offset + chunkSize)
      const params = new URLSearchParams({
        'track-ids': chunk.join(','),
        'with-positions': 'true',
      })
      const result = await this.getJson<YandexTrack[]>(
        `/tracks?${params.toString()}`,
        signal,
      )
      if (Array.isArray(result)) {
        tracks.push(...result)
      }
    }
    return tracks
  }

  async getPlaylists(
    userId: number | string,
    signal?: AbortSignal,
  ): Promise<YandexPlaylistShort[]> {
    const result = await this.getJson<YandexPlaylistShort[]>(
      `/users/${userId}/playlists/list`,
      signal,
    )
    return Array.isArray(result) ? result : []
  }

  async getPlaylistTracks(
    userId: number | string,
    kind: number,
    signal?: AbortSignal,
  ): Promise<YandexTrack[]> {
    const result = await this.getJson<{
      tracks?: Array<{ track?: YandexTrack | null }>
    }>(`/users/${userId}/playlists/${kind}`, signal)
    return (result.tracks ?? [])
      .map((item) => item.track)
      .filter((track): track is YandexTrack => Boolean(track?.id))
  }

  async getDownloadInfo(
    trackId: string,
    signal?: AbortSignal,
  ): Promise<YandexDownloadInfo[]> {
    const result = await this.getJson<YandexDownloadInfo[]>(
      `/tracks/${encodeURIComponent(trackId)}/download-info`,
      signal,
    )
    return Array.isArray(result) ? result : []
  }

  async resolveDirectStreamUrl(
    trackId: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const cached = readStreamCache(trackId)
    if (cached) {
      return cached
    }
    const infos = await this.getDownloadInfo(trackId, signal)
    const preferred =
      infos
        .filter((item) => !item.preview && item.downloadInfoUrl)
        .sort(
          (a, b) => (b.bitrateInKbps ?? 0) - (a.bitrateInKbps ?? 0),
        )[0] ?? infos.find((item) => item.downloadInfoUrl)

    if (!preferred?.downloadInfoUrl) {
      return null
    }

    let metaUrl = preferred.downloadInfoUrl
    try {
      const parsed = new URL(preferred.downloadInfoUrl)
      if (parsed.protocol === 'https:') {
        metaUrl = `/api/yandex-fetch?url=${encodeURIComponent(preferred.downloadInfoUrl)}`
      }
    } catch {
      // keep absolute URL
    }

    const metaResponse = await fetch(metaUrl, { signal })
    if (!metaResponse.ok) {
      pushYandexDevLog({
        stage: 'error',
        message: 'download-info meta failed',
        detail: `HTTP ${metaResponse.status}; track=${trackId}`,
      })
      return null
    }

    const xml = await metaResponse.text()
    const host = xmlMatch(xml, 'host')
    const path = xmlMatch(xml, 'path')
    const ts = xmlMatch(xml, 'ts')
    const s = xmlMatch(xml, 's')
    if (!host || !path || !ts) {
      return null
    }

    const sign =
      s ||
      md5Hex(`XGRlBW9FXlekgbPrRHuSiA${path.slice(1)}${ts}`)
    const streamUrl = `https://${host}/get-mp3/${sign}/${ts}${path}`
    storeStreamCache(trackId, streamUrl)
    return streamUrl
  }

  private async getJson<T>(
    path: string,
    signal?: AbortSignal,
    options?: { logHttp?: boolean },
  ): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: yandexMusicRequestHeaders(),
      credentials: 'include',
      signal,
    })

    if (options?.logHttp) {
      pushYandexDevLog({
        stage: 'http',
        message: `HTTP ${response.status}`,
        detail: path.split('?')[0],
      })
    }

    const text = await response.text()
    if (!response.ok) {
      const hint =
        response.status === 431
          ? ' (Request Header Fields Too Large — обычно Cookie через proxy; перезапустите dev-сервер)'
          : ''
      const code = readErrorCode(text)
      pushYandexDevLog({
        stage: 'error',
        message: 'Yandex Music API error',
        detail: `HTTP ${response.status}${hint}`,
      })
      throw new YandexApiError(
        `Yandex Music API ${response.status}${hint}`,
        response.status,
        code,
      )
    }

    const parsed = JSON.parse(text) as ApiEnvelope<T> | T
    if (
      parsed &&
      typeof parsed === 'object' &&
      'result' in parsed &&
      (parsed as ApiEnvelope<T>).result !== undefined
    ) {
      const envelope = parsed as ApiEnvelope<T>
      if (envelope.error) {
        throw new YandexApiError(
          envelope.error.message ?? envelope.error.name ?? 'Yandex API error',
          response.status,
        )
      }
      return envelope.result as T
    }
    return parsed as T
  }
}

function readErrorCode(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (
      typeof parsed.error === 'string' &&
      parsed.error.length > 0 &&
      parsed.error.length < 64 &&
      !parsed.error.includes(' ')
    ) {
      return parsed.error
    }
  } catch {
    return 'UPSTREAM'
  }
  return 'UPSTREAM'
}

function xmlMatch(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i'))
  return match?.[1] ?? null
}
