/**
 * Мягкая пропорция SWIPES 70% new / 30% familiar (PLAYBACK-CME-01).
 * Familiar = уже обработан в Swipe Music (liked / favorite / в каталоге).
 * New = не familiar (в т.ч. discovery без canonical match).
 * При дефиците new допускается больше familiar — без голодания буфера.
 */
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'
import type { Track } from '../../types/track.ts'
import { CONTINUOUS_LIMITS } from './continuousLimits.ts'
import { copyIdentity, titleIdentity } from './identity.ts'

export type SwipeMixClass = 'new' | 'familiar' | 'excluded'

export function classifySwipeMixLibraryItem(
  item: ContinuationLibraryTrack,
): SwipeMixClass {
  if (item.disliked || item.hidden || !item.externalId) {
    return 'excluded'
  }
  if (item.liked || item.favorite || item.inCatalog) {
    return 'familiar'
  }
  return 'new'
}

export function isFamiliarSwipeTrack(
  track: Track,
  library: readonly ContinuationLibraryTrack[],
): boolean {
  const copy = copyIdentity(track)
  const title = titleIdentity(track.artist, track.title)
  for (const item of library) {
    if (classifySwipeMixLibraryItem(item) !== 'familiar') {
      continue
    }
    const id = `${item.sourceId}:${item.externalId}`
    if (
      track.id === id ||
      copy === copyIdentity({
        sourceId: item.sourceId,
        externalId: item.externalId,
      }) ||
      title === titleIdentity(item.artist, item.title)
    ) {
      return true
    }
  }
  return false
}

export function planSwipeMixSlots(limit: number): {
  familiarSlots: number
  newSlots: number
} {
  const ratio = CONTINUOUS_LIMITS.swipeFamiliarTargetRatio
  const familiarSlots = Math.min(
    limit,
    Math.max(0, Math.round(limit * ratio)),
  )
  return {
    familiarSlots,
    newSlots: Math.max(0, limit - familiarSlots),
  }
}

/**
 * Переупорядочить playable batch: сначала добираем new/familiar к целевым слотам,
 * остаток — чем есть (fallback без паузы).
 */
export function applySwipeMixBias(options: {
  selected: readonly Track[]
  library: readonly ContinuationLibraryTrack[]
  limit: number
}): Track[] {
  if (options.selected.length === 0 || options.limit <= 0) {
    return []
  }
  const { familiarSlots, newSlots } = planSwipeMixSlots(options.limit)
  const familiar: Track[] = []
  const fresh: Track[] = []
  for (const track of options.selected) {
    if (isFamiliarSwipeTrack(track, options.library)) {
      familiar.push(track)
    } else {
      fresh.push(track)
    }
  }

  const out: Track[] = []
  const take = (bucket: Track[], n: number) => {
    while (n > 0 && bucket.length > 0 && out.length < options.limit) {
      out.push(bucket.shift()!)
      n -= 1
    }
  }
  take(fresh, newSlots)
  take(familiar, familiarSlots)
  // Fallback: не голодаем — добираем чем осталось.
  take(fresh, fresh.length)
  take(familiar, familiar.length)
  return out.slice(0, options.limit)
}

export function buildHiddenExclusionIds(
  library: readonly ContinuationLibraryTrack[],
): Set<string> {
  const ids = new Set<string>()
  for (const item of library) {
    if (!item.hidden || !item.externalId) {
      continue
    }
    const id = `${item.sourceId}:${item.externalId}`
    ids.add(id)
    ids.add(
      copyIdentity({
        sourceId: item.sourceId,
        externalId: item.externalId,
      }),
    )
    ids.add(titleIdentity(item.artist, item.title))
  }
  return ids
}
