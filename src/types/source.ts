/**
 * Пользовательская / менеджерская модель источника.
 * Отделена от MusicSourceAdapter (доступ к данным).
 */
export type SourceType =
  | 'api'
  | 'html-parser'
  | 'rss'
  | 'local-folder'
  | 'custom'

export type SourceSettings = Record<string, unknown>

export type SourceConfig = {
  id: string
  name: string
  type: SourceType
  enabled: boolean
  /** Меньше число — выше приоритет при слиянии ленты. */
  priority: number
  settings: SourceSettings
}

export type CreateSourceInput = {
  name: string
  type: SourceType
  enabled?: boolean
  priority?: number
  settings?: SourceSettings
  id?: string
}
