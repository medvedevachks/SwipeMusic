import type { SourceCopyAvailability } from '../../types/playbackAvailability.ts'

const DEFAULT_TTL_MS = 30_000

type CacheEntry = {
  value: SourceCopyAvailability
  readiness: string
  expiresAt: number
}

const entries = new Map<string, CacheEntry>()

export function availabilityCacheKey(
  canonicalTrackId: string,
  sourceTrackKey: string,
): string {
  return `${canonicalTrackId}\n${sourceTrackKey}`
}

export function readAvailabilityCache(
  key: string,
  readiness: string,
  now: number,
): SourceCopyAvailability | null {
  const entry = entries.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt <= now || entry.readiness !== readiness) {
    entries.delete(key)
    return null
  }
  return entry.value
}

export function writeAvailabilityCache(
  key: string,
  value: SourceCopyAvailability,
  readiness: string,
  now: number,
  ttlMs = DEFAULT_TTL_MS,
): void {
  entries.set(key, {
    value,
    readiness,
    expiresAt: now + ttlMs,
  })
}

export function invalidatePlaybackAvailabilityBySource(sourceId: string): void {
  for (const [key, entry] of entries) {
    if (entry.value.sourceId === sourceId) {
      entries.delete(key)
    }
  }
}

export function clearPlaybackAvailabilityCache(): void {
  entries.clear()
}
