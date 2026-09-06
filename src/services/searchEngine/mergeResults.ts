import type { Track } from '../../types/track'

export type RankedTrack = {
  track: Track
  sourcePriority: number
  sourceOrder: number
  resultIndex: number
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Ключ дедупликации: externalId или title+artist. */
export function trackDedupeKey(track: Track): string {
  if (track.externalId.trim()) {
    return `ext:${normalizeText(track.externalId)}`
  }
  return `meta:${normalizeText(track.title)}::${normalizeText(track.artist)}`
}

/**
 * Дедуп + сортировка:
 * 1) priority источника (меньше = выше)
 * 2) порядок источника в ответе
 * 3) порядок трека внутри ответа источника
 *
 * При дубле оставляем запись из источника с более высоким priority.
 */
export function mergeAndDedupeSearchResults(items: RankedTrack[]): Track[] {
  const byKey = new Map<string, RankedTrack>()

  for (const item of items) {
    const key = trackDedupeKey(item.track)
    const existing = byKey.get(key)

    if (!existing) {
      byKey.set(key, item)
      continue
    }

    const betterPriority = item.sourcePriority < existing.sourcePriority
    const samePriorityEarlier =
      item.sourcePriority === existing.sourcePriority &&
      (item.sourceOrder < existing.sourceOrder ||
        (item.sourceOrder === existing.sourceOrder &&
          item.resultIndex < existing.resultIndex))

    if (betterPriority || samePriorityEarlier) {
      byKey.set(key, item)
    }
  }

  return [...byKey.values()]
    .sort((a, b) => {
      if (a.sourcePriority !== b.sourcePriority) {
        return a.sourcePriority - b.sourcePriority
      }
      if (a.sourceOrder !== b.sourceOrder) {
        return a.sourceOrder - b.sourceOrder
      }
      return a.resultIndex - b.resultIndex
    })
    .map((item) => item.track)
}
