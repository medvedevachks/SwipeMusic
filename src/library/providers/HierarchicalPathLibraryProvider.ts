import { getMediaIndex } from '../../services/mediaIndex'
import { syncAdapterToMediaIndex } from '../../services/mediaIndex'
import type { MusicSourceAdapter } from '../../sources/MusicSourceAdapter'
import type { Track } from '../../types/track'
import type { LibraryNode, LibraryProvider } from '../../types/libraryProvider'

const ROOT = 'root'
const FOLDER_PREFIX = 'folder:'

function folderOf(track: Track): string {
  const path = track.externalId.replace(/\\/g, '/')
  const slash = path.lastIndexOf('/')
  if (slash <= 0) {
    return '/'
  }
  return path.slice(0, slash)
}

function childFolders(parentPath: string, allFolders: string[]): string[] {
  const prefix = parentPath === '/' ? '' : parentPath
  const children = new Set<string>()

  for (const folder of allFolders) {
    if (parentPath === '/') {
      const top = folder.split('/').filter(Boolean)[0]
      if (top) {
        children.add(top)
      }
      continue
    }

    if (!folder.startsWith(`${prefix}/`)) {
      continue
    }
    const rest = folder.slice(prefix.length + 1)
    const next = rest.split('/')[0]
    if (next) {
      children.add(`${prefix}/${next}`)
    }
  }

  return [...children].sort((a, b) => a.localeCompare(b, 'ru'))
}

/**
 * Дерево папок из MediaIndex (без прямого чтения Provider при каждом открытии).
 */
export class HierarchicalPathLibraryProvider implements LibraryProvider {
  readonly id: string
  readonly label: string
  readonly capabilities = ['tree', 'search', 'refresh'] as const

  private readonly adapter: MusicSourceAdapter

  constructor(adapter: MusicSourceAdapter) {
    this.adapter = adapter
    this.id = adapter.id
    this.label = adapter.label
  }

  async refresh(): Promise<void> {
    await syncAdapterToMediaIndex(this.adapter)
  }

  private async loadTracks(): Promise<Track[]> {
    const index = getMediaIndex()
    await index.whenReady()
    let tracks = index.listTracks(this.id)
    if (tracks.length === 0) {
      await syncAdapterToMediaIndex(this.adapter)
      tracks = index.listTracks(this.id)
    }
    return tracks
  }

  async getRoot(): Promise<LibraryNode[]> {
    const tracks = await this.loadTracks()
    return [
      {
        id: ROOT,
        title: this.label,
        type: 'root',
        count: tracks.length,
        sourceId: this.id,
      },
    ]
  }

  async getChildren(nodeId: string): Promise<LibraryNode[]> {
    const tracks = await this.loadTracks()
    const folders = [...new Set(tracks.map((track) => folderOf(track)))]

    const parentPath =
      nodeId === ROOT
        ? '/'
        : nodeId.startsWith(FOLDER_PREFIX)
          ? nodeId.slice(FOLDER_PREFIX.length)
          : null

    if (parentPath == null) {
      return []
    }

    return childFolders(parentPath, folders).map((folderPath) => {
      const title =
        folderPath === '/'
          ? this.label
          : (folderPath.split('/').filter(Boolean).at(-1) ?? folderPath)
      const count = tracks.filter((track) => {
        const folder = folderOf(track)
        return folder === folderPath || folder.startsWith(`${folderPath}/`)
      }).length

      return {
        id: `${FOLDER_PREFIX}${folderPath}`,
        parentId: nodeId,
        title,
        type: 'folder' as const,
        count,
        sourceId: this.id,
      }
    })
  }

  async getTracks(nodeId: string): Promise<Track[]> {
    const tracks = await this.loadTracks()

    if (nodeId === ROOT) {
      return tracks
    }

    if (!nodeId.startsWith(FOLDER_PREFIX)) {
      return []
    }

    const folderPath = nodeId.slice(FOLDER_PREFIX.length)
    return tracks.filter((track) => folderOf(track) === folderPath)
  }

  async search(query: string): Promise<Track[]> {
    const index = getMediaIndex()
    await index.whenReady()
    return index.search(query, [this.id]).map((record) => record.track)
  }
}
