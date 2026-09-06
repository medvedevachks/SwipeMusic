/**
 * Канонические типы источников музыки.
 * UI и бизнес-логика работают только с ними.
 */
export type SourceType = 'api' | 'scraper' | 'filesystem'

/**
 * Устаревшие значения конфигов — мапятся на SourceType при отображении.
 * @deprecated Используйте SourceType.
 */
export type LegacySourceType =
  | 'html-parser'
  | 'rss'
  | 'local-folder'
  | 'custom'

/** Допустимое значение в SourceConfig (канон + legacy для совместимости). */
export type SourceTypeInput = SourceType | LegacySourceType

export type SourceSettings = Record<string, unknown>

export type SourceConfig = {
  id: string
  name: string
  type: SourceTypeInput
  enabled: boolean
  /** Меньше число — выше приоритет при слиянии ленты. */
  priority: number
  settings: SourceSettings
}

export type CreateSourceInput = {
  name: string
  type: SourceTypeInput
  enabled?: boolean
  priority?: number
  settings?: SourceSettings
  id?: string
}

/** Приводит legacy-типы к каноническим api | scraper | filesystem. */
export function normalizeSourceType(type: SourceTypeInput): SourceType {
  switch (type) {
    case 'api':
      return 'api'
    case 'scraper':
    case 'html-parser':
    case 'rss':
    case 'custom':
      return 'scraper'
    case 'filesystem':
    case 'local-folder':
      return 'filesystem'
  }
}

export function sourceTypeLabel(type: SourceTypeInput): string {
  switch (normalizeSourceType(type)) {
    case 'api':
      return 'API'
    case 'scraper':
      return 'Scraper'
    case 'filesystem':
      return 'Local Files'
  }
}
