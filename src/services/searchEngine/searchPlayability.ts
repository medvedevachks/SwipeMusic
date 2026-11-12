import type { Track } from '../../types/track.ts'

/** Теги, которыми адаптер помечает достоверно известную доступность. */
export const SEARCH_PLAYABILITY_TAG = {
  PLAYABLE: 'search-playability:playable',
  UNAVAILABLE: 'search-playability:unavailable',
} as const

export type SearchTrackPlayability = 'playable' | 'unavailable' | 'unknown'

/**
 * Только явные теги. Не угадываем по previewUrl / источнику —
 * иначе UI показывал бы «доступно» без проверки стрима.
 */
export function resolveSearchTrackPlayability(
  track: Pick<Track, 'tags'>,
): SearchTrackPlayability {
  const tags = track.tags ?? []
  if (tags.includes(SEARCH_PLAYABILITY_TAG.UNAVAILABLE)) {
    return 'unavailable'
  }
  if (tags.includes(SEARCH_PLAYABILITY_TAG.PLAYABLE)) {
    return 'playable'
  }
  return 'unknown'
}

export function searchPlayabilityLabel(
  status: SearchTrackPlayability,
): string | null {
  if (status === 'playable') {
    return 'Доступно'
  }
  if (status === 'unavailable') {
    return 'Недоступно'
  }
  return null
}

/** Добавляет/заменяет playability-тег только при булевом флаге провайдера. */
export function withSearchPlayabilityTags(
  tags: string[] | undefined,
  available: boolean | null | undefined,
): string[] | undefined {
  if (available !== true && available !== false) {
    return tags
  }
  const cleaned = (tags ?? []).filter(
    (tag) =>
      tag !== SEARCH_PLAYABILITY_TAG.PLAYABLE &&
      tag !== SEARCH_PLAYABILITY_TAG.UNAVAILABLE,
  )
  cleaned.push(
    available
      ? SEARCH_PLAYABILITY_TAG.PLAYABLE
      : SEARCH_PLAYABILITY_TAG.UNAVAILABLE,
  )
  return cleaned
}

export function mergeProviderWarnings(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of [...existing, ...incoming]) {
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}
