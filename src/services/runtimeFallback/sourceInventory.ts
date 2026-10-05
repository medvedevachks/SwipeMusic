import type { SourceCopy } from '../../types/canonical.ts'
import type {
  CanonicalSourceInventory,
  RegisteredSourceDescriptor,
} from '../../types/runtimeFallback.ts'

/**
 * Известные SourceCopy этой композиции и отдельно список зарегистрированных источников.
 * Регистрация адаптера не создаёт SourceCopy.
 */
export function buildCanonicalSourceInventory(input: {
  canonicalTrackId: string
  knownCopies: readonly SourceCopy[]
  registeredSources?: readonly RegisteredSourceDescriptor[]
}): CanonicalSourceInventory {
  const knownCopies = input.knownCopies.filter(
    (copy) => copy.canonicalTrackId === input.canonicalTrackId,
  )
  const knownSourceIds = new Set(knownCopies.map((copy) => copy.sourceId))
  const registeredSources = [...(input.registeredSources ?? [])]
  return {
    canonicalTrackId: input.canonicalTrackId,
    knownCopies,
    registeredSources,
    registeredSourcesWithoutCopy: registeredSources.filter(
      (source) => !knownSourceIds.has(source.sourceId),
    ),
  }
}
