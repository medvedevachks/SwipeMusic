import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { PlaybackTrackLookup } from '../playbackAvailability/playbackTrackForSourceCopy.ts'
import type { AvailabilityPort } from '../playbackAvailability/resolveCanonicalPlaybackAvailability.ts'
import type { ResolveMissingPlaybackTrack } from '../playbackAvailability/prepareCanonicalPlayback.ts'
import {
  resolveCatalogItemPlayback,
  type CatalogItemResolution,
  type CatalogQueueEntry,
} from './buildCatalogPlaybackQueue.ts'

export type PrepareCatalogNeighborWindowInput = {
  items: readonly CanonicalLibraryItem[]
  startCanonicalTrackId: string
  port: AvailabilityPort
  findTrack?: PlaybackTrackLookup
  resolveMissingTrack?: ResolveMissingPlaybackTrack
  now?: number
  allowDemo?: boolean
  isCancelled?: () => boolean
  preResolved?: ReadonlyMap<string, CatalogItemResolution>
  /** Сколько готовых соседей искать в каждую сторону (по умолчанию 1). */
  readyPerSide?: number
  /** Максимум кандидатов сканировать в сторону (пропуск unavailable). */
  maxScanPerSide?: number
}

export type PrepareCatalogNeighborWindowResult = {
  /** Обновлённый кэш резолюций (включая соседей). */
  preResolved: Map<string, CatalogItemResolution>
  /** Готовые entry в порядке каталога (start + найденные соседи). */
  partialQueue: CatalogQueueEntry[]
  startIndex: number
}

/**
 * После early-start добирает ближайших доступных соседей, не готовя весь каталог.
 * Порядок очереди = порядок каталога среди уже ready.
 */
export async function prepareCatalogNeighborWindow(
  input: PrepareCatalogNeighborWindowInput,
): Promise<PrepareCatalogNeighborWindowResult> {
  const readyPerSide = Math.max(1, input.readyPerSide ?? 1)
  const maxScanPerSide = Math.max(readyPerSide, input.maxScanPerSide ?? 8)
  const preResolved = new Map<string, CatalogItemResolution>(
    input.preResolved ?? [],
  )
  const startIndex = input.items.findIndex(
    (item) => item.canonicalTrack.id === input.startCanonicalTrackId,
  )
  if (startIndex < 0) {
    return { preResolved, partialQueue: [], startIndex: 0 }
  }

  const resolveOpts = {
    port: input.port,
    findTrack: input.findTrack,
    resolveMissingTrack: input.resolveMissingTrack,
    now: input.now,
    allowDemo: input.allowDemo,
  }

  const ensureResolved = async (index: number): Promise<CatalogItemResolution> => {
    const item = input.items[index]!
    const cached = preResolved.get(item.canonicalTrack.id)
    if (cached) {
      return cached
    }
    const resolved = await resolveCatalogItemPlayback(item, resolveOpts)
    preResolved.set(item.canonicalTrack.id, resolved)
    return resolved
  }

  // Start должен уже быть ready в preResolved после early play.
  if (!preResolved.has(input.startCanonicalTrackId)) {
    await ensureResolved(startIndex)
  }

  let forwardReady = 0
  for (
    let offset = 1;
    offset <= maxScanPerSide && forwardReady < readyPerSide;
    offset += 1
  ) {
    if (input.isCancelled?.()) {
      break
    }
    const index = startIndex + offset
    if (index >= input.items.length) {
      break
    }
    const resolved = await ensureResolved(index)
    if (resolved.status === 'ready') {
      forwardReady += 1
    }
  }

  let backwardReady = 0
  for (
    let offset = 1;
    offset <= maxScanPerSide && backwardReady < readyPerSide;
    offset += 1
  ) {
    if (input.isCancelled?.()) {
      break
    }
    const index = startIndex - offset
    if (index < 0) {
      break
    }
    const resolved = await ensureResolved(index)
    if (resolved.status === 'ready') {
      backwardReady += 1
    }
  }

  const partialQueue: CatalogQueueEntry[] = []
  for (const item of input.items) {
    const resolved = preResolved.get(item.canonicalTrack.id)
    if (resolved?.status === 'ready') {
      partialQueue.push(resolved.entry)
    }
  }
  const liveStart = partialQueue.findIndex(
    (entry) => entry.canonicalTrackId === input.startCanonicalTrackId,
  )

  return {
    preResolved,
    partialQueue,
    startIndex: liveStart >= 0 ? liveStart : 0,
  }
}
