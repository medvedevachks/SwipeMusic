import type { MusicSourceAdapter, SearchResult } from '../MusicSourceAdapter'
import type {
  FetchTracksParams,
  FetchTracksResult,
  MusicSourceCapability,
  MusicSourceKind,
} from '../types'
import type { SourceType } from '../../types/source'
import type { Track } from '../../types/track'
import {
  BrowserHtmlFetcher,
  type HtmlFetcher,
} from '../scraping/HtmlFetcher'

/**
 * Общая инфраструктура HTML/scraper-источников.
 * Конкретные сайты реализуют только parse* / build* — без switch(site).
 */
export abstract class ScraperMusicAdapter implements MusicSourceAdapter {
  readonly type: SourceType = 'scraper'
  readonly kind: MusicSourceKind = 'web'

  abstract readonly id: string
  abstract readonly label: string

  readonly capabilities: readonly MusicSourceCapability[] = ['browse', 'search']
  readonly supportsSearch = true
  readonly supportsStreaming = true
  readonly supportsPagination = false

  protected readonly fetcher: HtmlFetcher

  constructor(fetcher: HtmlFetcher = new BrowserHtmlFetcher()) {
    this.fetcher = fetcher
  }

  async initialize(): Promise<void> {}

  isAvailable(): boolean {
    return false
  }

  async dispose(): Promise<void> {}

  /** Загрузка HTML через подменяемый HtmlFetcher (browser / backend). */
  protected async loadHtml(
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.fetcher.fetchHtml(url, { signal })
  }

  async fetchTracks(_params?: FetchTracksParams): Promise<FetchTracksResult> {
    return { tracks: [], nextCursor: null }
  }

  async search(
    query: string,
    params?: Omit<FetchTracksParams, 'query'>,
  ): Promise<SearchResult> {
    if (!this.supportsSearch) {
      return { tracks: [], nextCursor: null }
    }

    const html = await this.loadHtml(this.buildSearchUrl(query), params?.signal)
    const tracks = this.parseSearch(html, query)
    return { tracks, nextCursor: null }
  }

  async getTrack(trackId: string): Promise<Track | null> {
    const html = await this.loadHtml(this.buildTrackUrl(trackId))
    return this.parseTrack(html, trackId)
  }

  async getStream(track: Track): Promise<string> {
    if (track.previewUrl) {
      return track.previewUrl
    }
    const html = await this.loadHtml(this.buildTrackUrl(track.externalId))
    return this.parseStream(html, track)
  }

  async getCover(track: Track): Promise<string | undefined> {
    if (track.coverUrl) {
      return track.coverUrl
    }
    const html = await this.loadHtml(this.buildTrackUrl(track.externalId))
    return this.parseCover(html, track)
  }

  /** URL страницы поиска — специфика сайта. */
  protected abstract buildSearchUrl(query: string): string

  /** URL страницы трека — специфика сайта. */
  protected abstract buildTrackUrl(trackId: string): string

  /** Разбор HTML поиска — только этот сайт. */
  protected abstract parseSearch(html: string, query: string): Track[]

  /** Разбор HTML страницы трека. */
  protected abstract parseTrack(html: string, trackId: string): Track | null

  /** Извлечение URL потока из HTML. */
  protected abstract parseStream(html: string, track: Track): string

  /** Извлечение обложки из HTML. */
  protected abstract parseCover(
    html: string,
    track: Track,
  ): string | undefined
}
