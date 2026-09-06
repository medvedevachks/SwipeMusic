import type { LibraryNode, LibraryProvider } from '../../types/libraryProvider'
import type { Track } from '../../types/track'

type StubOptions = {
  id: string
  label: string
  roots?: Array<{ id: string; title: string; type?: LibraryNode['type'] }>
}

/**
 * Заготовка LibraryProvider для ещё не подключённых сервисов.
 * Дерево видно в UI; треки пустые до реальной реализации.
 */
export function createStubLibraryProvider(
  options: StubOptions,
): LibraryProvider {
  const roots = options.roots ?? [
    { id: 'playlists', title: 'Playlists', type: 'playlist' as const },
    { id: 'albums', title: 'Albums', type: 'album' as const },
    { id: 'artists', title: 'Artists', type: 'artist' as const },
  ]

  return {
    id: options.id,
    label: options.label,
    capabilities: ['tree', 'search', 'refresh'],

    async getRoot() {
      return roots.map((root) => ({
        id: root.id,
        title: root.title,
        type: root.type ?? 'collection',
        count: 0,
        sourceId: options.id,
      }))
    },

    async getChildren() {
      return []
    },

    async getTracks(): Promise<Track[]> {
      return []
    },

    async search(): Promise<Track[]> {
      return []
    },

    async refresh() {},
  }
}
