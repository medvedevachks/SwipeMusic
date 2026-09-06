import { ScraperMusicAdapter } from '../ScraperMusicAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'
import type { Track } from '../../../types/track'
import type { HtmlFetcher } from '../../scraping'

/** Пример scraper-адаптера для шаблона подключения нового сайта. */
export class ExampleAdapter extends ScraperMusicAdapter {
  readonly id = 'example-site'
  readonly label = 'Example Site'

  constructor(fetcher?: HtmlFetcher) {
    super(fetcher)
  }

  protected buildSearchUrl(query: string): string {
    return `https://example.invalid/search?q=${encodeURIComponent(query)}`
  }

  protected buildTrackUrl(trackId: string): string {
    return `https://example.invalid/tracks/${encodeURIComponent(trackId)}`
  }

  protected parseSearch(_html: string, _query: string): Track[] {
    return []
  }

  protected parseTrack(_html: string, _trackId: string): Track | null {
    return null
  }

  protected parseStream(_html: string, _track: Track): string {
    throw new Error('[example-site] parseStream is not implemented')
  }

  protected parseCover(_html: string, _track: Track): string | undefined {
    return undefined
  }
}

export function createExampleAdapter(): MusicSourceAdapter {
  return new ExampleAdapter()
}
