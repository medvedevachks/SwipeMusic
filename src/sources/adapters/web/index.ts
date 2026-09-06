import { ScraperMusicAdapter } from '../ScraperMusicAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'
import type { Track } from '../../../types/track'
import type { HtmlFetcher } from '../../scraping'

/**
 * Шаблон кастомного сайта.
 * Подключение: registerMusicSource(new MyMusicSiteAdapter())
 */
export class MyMusicSiteAdapter extends ScraperMusicAdapter {
  readonly id: string
  readonly label: string

  constructor(
    options?: { id?: string; label?: string },
    fetcher?: HtmlFetcher,
  ) {
    super(fetcher)
    this.id = options?.id ?? 'my-music-site'
    this.label = options?.label ?? 'My Music Site'
  }

  protected buildSearchUrl(query: string): string {
    return `https://my-music.example/search?q=${encodeURIComponent(query)}`
  }

  protected buildTrackUrl(trackId: string): string {
    return `https://my-music.example/track/${encodeURIComponent(trackId)}`
  }

  protected parseSearch(_html: string, _query: string): Track[] {
    return []
  }

  protected parseTrack(_html: string, _trackId: string): Track | null {
    return null
  }

  protected parseStream(_html: string, _track: Track): string {
    throw new Error(`[${this.id}] parseStream is not implemented`)
  }

  protected parseCover(_html: string, _track: Track): string | undefined {
    return undefined
  }
}

export function createMyMusicSiteAdapter(): MusicSourceAdapter {
  return new MyMusicSiteAdapter()
}

/** @deprecated Используйте MyMusicSiteAdapter / ExampleAdapter. */
export function createCustomWebsiteAdapter(options?: {
  id?: string
  label?: string
}): MusicSourceAdapter {
  return new MyMusicSiteAdapter({
    id: options?.id ?? 'custom-website',
    label: options?.label ?? 'Custom website',
  })
}

/** @deprecated */
export function createWebSourceAdapterStub(options?: {
  id?: string
  label?: string
}): MusicSourceAdapter {
  return new MyMusicSiteAdapter(options)
}
