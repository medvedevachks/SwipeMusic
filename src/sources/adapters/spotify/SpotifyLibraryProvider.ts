import { getMediaIndex } from '../../../services/mediaIndex'
import type { Track } from '../../../types/track'
import type { LibraryNode, LibraryProvider } from '../../../types/libraryProvider'
import { getSpotifyAdapter, type SpotifyAdapter } from './SpotifyAdapter'

const ROOT_ALL = 'all-tracks'
const ROOT_ARTISTS = 'artists'
const ROOT_ALBUMS = 'albums'
const ROOT_PLAYLISTS = 'playlists'
const ROOT_FAVORITES = 'favorites'
const ARTIST_PREFIX = 'artist:'
const ALBUM_PREFIX = 'album:'
const PLAYLIST_PREFIX = 'playlist:'

/**
 * Library для Spotify: All / Artists / Albums / Playlists / Favorites.
 * Данные только из MediaIndex (+ метаданные плейлистов из адаптера).
 */
export class SpotifyLibraryProvider implements LibraryProvider {
  readonly id: string
  readonly label: string
  readonly capabilities = ['tree', 'search', 'refresh'] as const

  private readonly adapter: SpotifyAdapter

  constructor(adapter: SpotifyAdapter = getSpotifyAdapter()) {
    this.adapter = adapter
    this.id = adapter.id
    this.label = adapter.label
  }

  async refresh(): Promise<void> {
    if (this.adapter.isAvailable()) {
      await this.adapter.syncLibrary()
      return
    }
    await getMediaIndex().whenReady()
  }

  private async loadTracks(): Promise<Track[]> {
    const index = getMediaIndex()
    await index.whenReady()
    let tracks = index.listTracks(this.id)
    if (tracks.length === 0 && this.adapter.isAvailable()) {
      await this.adapter.syncLibrary()
      tracks = index.listTracks(this.id)
    }
    return tracks
  }

  async getRoot(): Promise<LibraryNode[]> {
    const tracks = await this.loadTracks()
    const artists = new Set(tracks.map((track) => track.artist))
    const albums = new Set(
      tracks.map((track) => track.album?.trim() || 'Unknown Album'),
    )
    const favorites = tracks.filter((track) =>
      track.tags?.includes('favorite'),
    )
    const playlists = this.adapter.getPlaylists()

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
      {
        id: ROOT_PLAYLISTS,
        title: 'Playlists',
        type: 'collection',
        count: playlists.length,
        sourceId: this.id,
      },
      {
        id: ROOT_FAVORITES,
        title: 'Favorites',
        type: 'collection',
        count: favorites.length,
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

    if (nodeId === ROOT_PLAYLISTS) {
      return this.adapter.getPlaylists().map((playlist) => ({
        id: `${PLAYLIST_PREFIX}${playlist.id}`,
        parentId: ROOT_PLAYLISTS,
        title: playlist.name,
        type: 'playlist' as const,
        count: playlist.trackIds.length,
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
    if (nodeId === ROOT_FAVORITES) {
      return tracks.filter((track) => track.tags?.includes('favorite'))
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
    if (nodeId.startsWith(PLAYLIST_PREFIX)) {
      const playlistId = nodeId.slice(PLAYLIST_PREFIX.length)
      const playlist = this.adapter
        .getPlaylists()
        .find((item) => item.id === playlistId)
      if (!playlist) {
        return []
      }
      const idSet = new Set(playlist.trackIds)
      return tracks.filter(
        (track) =>
          idSet.has(track.externalId) ||
          track.tags?.includes(`playlist:${playlistId}`),
      )
    }
    return []
  }

  async search(query: string): Promise<Track[]> {
    const index = getMediaIndex()
    await index.whenReady()
    return index.search(query, [this.id]).map((record) => record.track)
  }
}

export function createSpotifyLibraryProvider(): LibraryProvider {
  return new SpotifyLibraryProvider()
}
