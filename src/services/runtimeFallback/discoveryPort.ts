import type { SourceCopy } from '../../types/canonical.ts'
import {
  SOURCE_DISCOVERY_STATUS,
  type DiscoverCopiesInput,
  type SourceDiscoveryResult,
} from '../../types/runtimeFallback.ts'

/**
 * Optional discovery. Production-реестр пустой.
 * Orchestrator сам discovery не вызывает.
 */
export type AlternateSourceDiscoveryProvider = {
  sourceId: string
  canDiscover(sourceId: string): boolean
  discoverCopies(input: DiscoverCopiesInput): Promise<SourceDiscoveryResult>
}

export class SourceDiscoveryRegistry {
  private readonly providers: AlternateSourceDiscoveryProvider[] = []

  register(provider: AlternateSourceDiscoveryProvider): void {
    this.providers.push(provider)
  }

  list(): readonly AlternateSourceDiscoveryProvider[] {
    return this.providers
  }

  canDiscover(sourceId: string): boolean {
    return this.providers.some((provider) => provider.canDiscover(sourceId))
  }
}

/** В MVP-06A нет утверждённых discovery-реализаций. */
export function createProductionDiscoveryRegistry(): SourceDiscoveryRegistry {
  return new SourceDiscoveryRegistry()
}

/**
 * SourceCopy появляется только из подтверждённого FOUND.
 * AMBIGUOUS, ошибка и неподтверждённый кандидат копию не создают.
 */
export function sourceCopiesFromDiscovery(
  canonicalTrackId: string,
  result: SourceDiscoveryResult,
  now = new Date().toISOString(),
): SourceCopy[] {
  if (result.status !== SOURCE_DISCOVERY_STATUS.FOUND) {
    return []
  }
  return result.candidates
    .filter((candidate) => candidate.verified)
    .map((candidate) => ({
      sourceTrackKey: `${candidate.sourceId}:${candidate.externalId}`,
      canonicalTrackId,
      sourceId: candidate.sourceId,
      externalId: candidate.externalId,
      title: candidate.title,
      artist: candidate.artist,
      album: null,
      durationMs: null,
      artworkUrl: null,
      createdAt: now,
      updatedAt: now,
    }))
}

export type AlternateSourceDiscoveryShape = AlternateSourceDiscoveryProvider
