import type { AppExportPayload } from '../export/ExportService'
import { getCollectionEngine } from '../collectionEngine'

/**
 * Импорт коллекции — пока только архитектура.
 * Позже: валидация schema → merge/replace → CollectionStorage.
 */
export class ImportService {
  parse(json: string): AppExportPayload {
    const data = JSON.parse(json) as AppExportPayload
    if (!data || data.version !== 1 || !Array.isArray(data.collection)) {
      throw new Error('Invalid export payload')
    }
    return data
  }

  validate(json: string): boolean {
    try {
      this.parse(json)
      return true
    } catch {
      return false
    }
  }

  /**
   * Не реализовано: стратегия merge/replace и маппинг категорий.
   */
  async importJson(_json: string): Promise<void> {
    void getCollectionEngine
    throw new Error('ImportService.importJson is not implemented yet')
  }
}

export const importService = new ImportService()
