import type {
  CatalogAlbum,
  CatalogAlbumDetail,
  CatalogArtist,
  CatalogArtistDetail,
} from '../../types/catalog.ts'
import type { Track } from '../../types/track.ts'
import type { CatalogPage, CatalogSourcePort } from './types.ts'

async function createDefaultPorts(): Promise<CatalogSourcePort[]> {
  const [{ createYandexCatalogPort }, { createSpotifyCatalogPort }] =
    await Promise.all([
      import('./yandexCatalogPort.ts'),
      import('./spotifyCatalogPort.ts'),
    ])
  return [createYandexCatalogPort(), createSpotifyCatalogPort()]
}

/**
 * Каталог исполнителей/альбомов поверх реальных API источников.
 * Не подменяет дискографию поисковыми hit'ами треков.
 */
export class CatalogBrowseService {
  private ports: CatalogSourcePort[] | null
  private readonly injectedPorts: CatalogSourcePort[] | null

  constructor(ports?: CatalogSourcePort[]) {
    this.injectedPorts = ports ?? null
    this.ports = ports ?? null
  }

  private async ensurePorts(): Promise<CatalogSourcePort[]> {
    if (this.ports) {
      return this.ports
    }
    this.ports = await createDefaultPorts()
    return this.ports
  }

  private async ensureSources(): Promise<void> {
    if (this.injectedPorts) {
      return
    }
    const { bootstrapMusicSources } = await import('../../sources/index.ts')
    bootstrapMusicSources()
  }

  private async resolvePort(sourceId: string): Promise<CatalogSourcePort | null> {
    await this.ensureSources()
    const ports = await this.ensurePorts()
    const port = ports.find((item) => item.sourceId === sourceId)
    if (!port) {
      return null
    }
    try {
      if (!(await port.isAvailable())) {
        return null
      }
    } catch {
      return null
    }
    return port
  }

  private async listAvailablePorts(): Promise<CatalogSourcePort[]> {
    await this.ensureSources()
    const ports = await this.ensurePorts()
    let enabled: Set<string> | null = null
    if (!this.injectedPorts) {
      const { sourceManager } = await import('../../sources/index.ts')
      const { isDemoSourceId } = await import('../../sources/demoSource.ts')
      enabled = new Set(
        sourceManager
          .listEnabledSources()
          .filter((source) => !isDemoSourceId(source.id))
          .map((source) => source.id),
      )
    }
    const out: CatalogSourcePort[] = []
    for (const port of ports) {
      if (enabled && !enabled.has(port.sourceId)) {
        continue
      }
      if (!port.capabilities.artistSearch) {
        continue
      }
      try {
        if (await port.isAvailable()) {
          out.push(port)
        }
      } catch {
        // источник недоступен — пропускаем
      }
    }
    return out
  }

  async searchArtists(
    query: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    artists: CatalogArtist[]
    warnings: string[]
  }> {
    const normalized = query.trim()
    if (!normalized) {
      return { artists: [], warnings: [] }
    }
    const ports = await this.listAvailablePorts()
    const warnings: string[] = []
    const ranked: CatalogArtist[] = []

    await Promise.all(
      ports.map(async (port) => {
        try {
          const page = await port.searchArtists(normalized, {
            cursor: null,
            signal: options?.signal,
          })
          ranked.push(...page.items)
        } catch (error) {
          warnings.push(
            `${port.sourceName}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }),
    )

    // Стабильный порядок: по имени, затем sourceId.
    ranked.sort((a, b) => {
      const byName = a.name.localeCompare(b.name, 'ru')
      if (byName !== 0) {
        return byName
      }
      return a.sourceId.localeCompare(b.sourceId)
    })

    return { artists: ranked, warnings }
  }

  async getArtist(
    sourceId: string,
    externalId: string,
    signal?: AbortSignal,
  ): Promise<CatalogArtistDetail | null> {
    const port = await this.resolvePort(sourceId)
    if (!port) {
      return null
    }
    return port.getArtist(externalId, signal)
  }

  async getArtistTracks(
    sourceId: string,
    externalId: string,
    input: { cursor: string | null; signal?: AbortSignal },
  ): Promise<CatalogPage<Track> & { mode: CatalogArtistDetail['tracksMode'] }> {
    const port = await this.resolvePort(sourceId)
    if (!port) {
      return { items: [], nextCursor: null, mode: 'unsupported' }
    }
    const page = await port.getArtistTracks(externalId, input)
    return { ...page, mode: port.capabilities.artistTracks }
  }

  async getArtistAlbums(
    sourceId: string,
    externalId: string,
    input: { cursor: string | null; signal?: AbortSignal },
  ): Promise<CatalogPage<CatalogAlbum>> {
    const port = await this.resolvePort(sourceId)
    if (!port) {
      return { items: [], nextCursor: null }
    }
    if (port.capabilities.artistAlbums === 'unsupported') {
      return { items: [], nextCursor: null }
    }
    return port.getArtistAlbums(externalId, input)
  }

  async getAlbum(
    sourceId: string,
    externalId: string,
    signal?: AbortSignal,
  ): Promise<CatalogAlbumDetail | null> {
    const port = await this.resolvePort(sourceId)
    if (!port) {
      return null
    }
    return port.getAlbum(externalId, signal)
  }

  async getAlbumTracks(
    sourceId: string,
    externalId: string,
    input: { cursor: string | null; signal?: AbortSignal },
  ): Promise<CatalogPage<Track>> {
    const port = await this.resolvePort(sourceId)
    if (!port) {
      return { items: [], nextCursor: null }
    }
    return port.getAlbumTracks(externalId, input)
  }
}

let singleton: CatalogBrowseService | null = null

export function getCatalogBrowseService(): CatalogBrowseService {
  if (!singleton) {
    singleton = new CatalogBrowseService()
  }
  return singleton
}

export function createCatalogBrowseServiceForTests(
  ports: CatalogSourcePort[],
): CatalogBrowseService {
  return new CatalogBrowseService(ports)
}
