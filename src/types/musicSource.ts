/**
 * Доменная сущность источника музыки (метаданные).
 * Отделена от MusicSourceAdapter — адаптер реализует доступ к данным.
 */
import type { SourceType } from './source'

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
  /** Канонический тип источника для UI / SourceManager. */
  type: SourceType
  kind: MusicSourceKind
  capabilities: readonly MusicSourceCapability[]
}
