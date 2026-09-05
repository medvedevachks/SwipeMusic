/**
 * Доменная сущность источника музыки (метаданные).
 * Отделена от MusicSourceAdapter — адаптер реализует доступ к данным.
 */
export type MusicSourceKind =
  | 'mock'
  | 'official-api'
  | 'local-folder'
  | 'web'

export type MusicSourceCapability =
  | 'browse'
  | 'search'
  | 'library'
  | 'recommendations'
  | 'preview'
  | 'auth'

export type MusicSource = {
  id: string
  label: string
  kind: MusicSourceKind
  capabilities: readonly MusicSourceCapability[]
}
