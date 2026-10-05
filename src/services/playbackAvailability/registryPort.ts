import { sourceManager, sourceRegistry } from '../../sources/index.ts'
import type { AvailabilityPort } from './resolveCanonicalPlaybackAvailability.ts'

/**
 * Боевой порт: включённость из SourceManager, адаптер из registry.
 * Сетевой roundtrip сюда не добавляется.
 */
export function createSourceRegistryAvailabilityPort(): AvailabilityPort {
  return {
    isSourceEnabled(sourceId) {
      try {
        return sourceManager.getSource(sourceId).enabled
      } catch {
        return false
      }
    },
    findAdapter(sourceId) {
      if (!sourceRegistry.has(sourceId)) {
        return null
      }
      return sourceRegistry.get(sourceId)
    },
  }
}
