import type { Track } from './track'

export type LibraryNodeType =
  | 'root'
  | 'folder'
  | 'playlist'
  | 'album'
  | 'artist'
  | 'genre'
  | 'category'
  | 'collection'

export type LibraryNode = {
  id: string
  parentId?: string
  title: string
  type: LibraryNodeType
  icon?: string
  count?: number
  sourceId: string
}

export type LibraryProviderCapability =
  | 'tree'
  | 'search'
  | 'delete'
  | 'refresh'
  | 'reveal'

/**
 * Контракт дерева/каталога для любого источника.
 * UI и LibraryService работают только с этим интерфейсом.
 */
export interface LibraryProvider {
  readonly id: string
  readonly label: string
  readonly capabilities: readonly LibraryProviderCapability[]

  getRoot(): Promise<LibraryNode[]>
  getChildren(nodeId: string): Promise<LibraryNode[]>
  getTracks(nodeId: string): Promise<Track[]>
  search(query: string): Promise<Track[]>
  refresh(): Promise<void>
}

export type LibraryProviderFactory = () => LibraryProvider
