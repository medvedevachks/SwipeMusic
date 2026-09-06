import { getCollectionEngine } from '../../services/collectionEngine'
import type { Track } from '../../types/track'
import type { LibraryNode, LibraryProvider } from '../../types/libraryProvider'
import { useCollectionStore } from '../../store/collectionStore'

const ROOT_FAVORITES = 'favorites'
const ROOT_RECENT_PLAYED = 'recently-played'
const ROOT_RECENT_ADDED = 'recently-added'
const ROOT_CATEGORIES = 'categories'
const CATEGORY_PREFIX = 'category:'

/**
 * Умные коллекции пользователя — не привязаны к конкретному источнику.
 */
export class SmartLibraryProvider implements LibraryProvider {
  readonly id = 'smart'
  readonly label = 'Collections'
  readonly capabilities = ['tree', 'search', 'refresh'] as const

  async getRoot(): Promise<LibraryNode[]> {
    const tracks = getCollectionEngine().listTracks({ includeHidden: false })
    const favorites = tracks.filter((item) => item.favorite || item.liked)
    const recentPlayed = tracks.filter((item) => item.lastPlayed)
    const categories = useCollectionStore.getState().categories

    return [
      {
        id: ROOT_FAVORITES,
        title: 'Favorites',
        type: 'collection',
        count: favorites.length,
        sourceId: this.id,
      },
      {
        id: ROOT_RECENT_PLAYED,
        title: 'Recently Played',
        type: 'collection',
        count: recentPlayed.length,
        sourceId: this.id,
      },
      {
        id: ROOT_RECENT_ADDED,
        title: 'Recently Added',
        type: 'collection',
        count: tracks.length,
        sourceId: this.id,
      },
      {
        id: ROOT_CATEGORIES,
        title: 'Categories',
        type: 'collection',
        count: categories.length,
        sourceId: this.id,
      },
    ]
  }

  async getChildren(nodeId: string): Promise<LibraryNode[]> {
    if (nodeId !== ROOT_CATEGORIES) {
      return []
    }

    const categories = useCollectionStore.getState().categories
    const tracks = getCollectionEngine().listTracks({ includeHidden: false })

    return categories.map((category) => ({
      id: `${CATEGORY_PREFIX}${category.id}`,
      parentId: ROOT_CATEGORIES,
      title: category.name,
      type: 'category' as const,
      count: tracks.filter((item) => item.categories.includes(category.id))
        .length,
      sourceId: this.id,
    }))
  }

  async getTracks(nodeId: string): Promise<Track[]> {
    const items = getCollectionEngine().listTracks({ includeHidden: false })

    if (nodeId === ROOT_FAVORITES) {
      return items
        .filter((item) => item.favorite || item.liked)
        .map((item) => item.track)
    }

    if (nodeId === ROOT_RECENT_PLAYED) {
      return items
        .filter((item) => item.lastPlayed)
        .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''))
        .map((item) => item.track)
    }

    if (nodeId === ROOT_RECENT_ADDED) {
      return [...items]
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
        .map((item) => item.track)
    }

    if (nodeId.startsWith(CATEGORY_PREFIX)) {
      const categoryId = nodeId.slice(CATEGORY_PREFIX.length)
      return items
        .filter((item) => item.categories.includes(categoryId))
        .map((item) => item.track)
    }

    return []
  }

  async search(query: string): Promise<Track[]> {
    const q = query.trim().toLowerCase()
    if (!q) {
      return []
    }

    return getCollectionEngine()
      .listTracks({ includeHidden: false })
      .filter((item) => {
        const haystack = [
          item.track.title,
          item.track.artist,
          item.track.album ?? '',
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
      .map((item) => item.track)
  }

  async refresh(): Promise<void> {
    // CollectionEngine уже в памяти; no-op.
  }
}
