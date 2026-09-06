import type { Category } from '../../types/category'
import type {
  CollectionActionLog,
  CollectionTrackData,
} from '../../types/collectionUser'
import type { SourceConfig } from '../../types/source'

export type AppExportPayload = {
  version: 1
  exportedAt: string
  collection: CollectionTrackData[]
  categories: Category[]
  likes: Array<{ trackId: string; createdAt?: string }>
  history: CollectionActionLog[]
  settings: Record<string, unknown>
  sources: SourceConfig[]
}

/**
 * Экспорт пользовательских данных в JSON.
 * Не знает о React — принимает готовый snapshot.
 */
export class ExportService {
  buildPayload(input: Omit<AppExportPayload, 'version' | 'exportedAt'>): AppExportPayload {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      collection: input.collection,
      categories: input.categories,
      likes: input.likes,
      history: input.history,
      settings: input.settings,
      sources: input.sources,
    }
  }

  toJson(payload: AppExportPayload, pretty = true): string {
    return JSON.stringify(payload, null, pretty ? 2 : undefined)
  }

  exportJson(input: Omit<AppExportPayload, 'version' | 'exportedAt'>): string {
    return this.toJson(this.buildPayload(input))
  }
}

export const exportService = new ExportService()
