import type { MusicSourceAdapter } from '../../sources/MusicSourceAdapter'
import type { Track } from '../../types/track'
import type { LibraryNode, LibraryProvider } from '../../types/libraryProvider'

const ROOT_ALL = 'all-tracks'
const ROOT_ARTISTS = 'artists'
const ROOT_ALBUMS = 'albums'
const ARTIST_PREFIX = 'artist:'
const ALBUM_PREFIX = 'album:'

/**
 * Универсальный LibraryProvider поверх любого MusicSourceAdapter.
 * Строит Artists / Albums / All Tracks — без знания Spotify/Yandex и т.д.
 */
export class AdapterLibraryProvider implements LibraryProvider {
  readonly id: string
  readonly label: string
  readonly capabilities = ['tree', 'search', 'refresh'] as const

  private cache: Track[] | null = null
  private readonly adapter: MusicSourceAdapter

  constructor(adapter: MusicSourceAdapter) {
    this.adapter = adapter
    this.id = adapter.id
    this.label = adapter.label
  }

  async refresh(): Promise<void> {
    this.cache = null
    await this.loadTracks()
  }

  private async loadTracks(): Promise<Track[]> {
    if (this.cache) {
      return this.cache
    }

    try {
      const available = await this.adapter.isAvailable()
      if (!available) {
        this.cache = []
        return this.cache
      }
      const result = await this.adapter.fetchTracks()
      this.cache = result.tracks
    } catch {
      this.cache = []
    }

    return this.cache
  }

  async getRoot(): Promise<LibraryNode[]> {
    const tracks = await this.loadTracks()
    const artists = new Set(tracks.map((track) => track.artist))
    const albums = new Set(
      tracks.map((track) => track.album?.trim() || 'Unknown Album'),
    )

    return [
      {
        id: ROOT_ALL,
        title: 'All Tracks',
        type: 'collection',
        count: tracks.length,
        sourceId: this.id,
      },
      {
        id: ROOT_ARTISTS,
        title: 'Artists',
        type: 'collection',
        count: artists.size,
        sourceId: this.id,
      },
      {
        id: ROOT_ALBUMS,
        title: 'Albums',
        type: 'collection',
        count: albums.size,
        sourceId: this.id,
      },
    ]
  }

  async getChildren(nodeId: string): Promise<LibraryNode[]> {
    const tracks = await this.loadTracks()

    if (nodeId === ROOT_ARTISTS) {
      const counts = new Map<string, number>()
      for (const track of tracks) {
        counts.set(track.artist, (counts.get(track.artist) ?? 0) + 1)
      }
      return [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
        .map(([artist, count]) => ({
          id: `${ARTIST_PREFIX}${artist}`,
          parentId: ROOT_ARTISTS,
          title: artist,
          type: 'artist' as const,
          count,
          sourceId: this.id,
        }))
    }

    if (nodeId === ROOT_ALBUMS) {
      const counts = new Map<string, number>()
      for (const track of tracks) {
        const album = track.album?.trim() || 'Unknown Album'
        counts.set(album, (counts.get(album) ?? 0) + 1)
      }
      return [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
        .map(([album, count]) => ({
          id: `${ALBUM_PREFIX}${album}`,
          parentId: ROOT_ALBUMS,
          title: album,
          type: 'album' as const,
          count,
          sourceId: this.id,
        }))
    }

    return []
  }

  async getTracks(nodeId: string): Promise<Track[]> {
    const tracks = await this.loadTracks()

    if (nodeId === ROOT_ALL) {
      return tracks
    }
    if (nodeId.startsWith(ARTIST_PREFIX)) {
      const artist = nodeId.slice(ARTIST_PREFIX.length)
      return tracks.filter((track) => track.artist === artist)
    }
    if (nodeId.startsWith(ALBUM_PREFIX)) {
      const album = nodeId.slice(ALBUM_PREFIX.length)
      return tracks.filter(
        (track) => (track.album?.trim() || 'Unknown Album') === album,
      )
    }
    return []
  }

  async search(query: string): Promise<Track[]> {
    const q = query.trim().toLowerCase()
    if (!q) {
      return []
    }

    if (this.adapter.supportsSearch) {
      try {
        const result = await this.adapter.search(q)
        if (result.tracks.length > 0) {
          return result.tracks
        }
      } catch {
        // fallback below
      }
    }

    const tracks = await this.loadTracks()
    return tracks.filter((track) => {
      const haystack = [track.title, track.artist, track.album ?? '']
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }
}
