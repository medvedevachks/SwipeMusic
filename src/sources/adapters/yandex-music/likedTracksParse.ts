import type { YandexTrack } from './types.ts'

export type LikedTrackRefsParseFailureReason =
  | 'missing-library'
  | 'missing-tracks'
  | 'invalid-tracks'
  | 'invalid-item'

export type LikedTrackRefsParseResult =
  | { ok: true; refs: string[] }
  | { ok: false; reason: LikedTrackRefsParseFailureReason }

export type LikedTracksHydrationFailureReason =
  | 'invalid-response'
  | 'empty-response'
  | 'no-matches'
  | 'invalid-track'

export type LikedTracksHydrationResult =
  | { ok: true; tracks: YandexTrack[] }
  | { ok: false; reason: LikedTracksHydrationFailureReason }

/** id из ref вида `trackId` или `trackId:albumId`. */
export function likedRefTrackId(ref: string): string {
  const colon = ref.indexOf(':')
  return colon >= 0 ? ref.slice(0, colon) : ref
}

/**
 * Строгая схема likes/tracks: отсутствие library/tracks ≠ пустое избранное.
 * Пустой массив tracks — единственный подтверждённый empty.
 */
export function parseLikedTrackRefsPayload(
  payload: unknown,
): LikedTrackRefsParseResult {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'missing-library' }
  }

  const root = payload as Record<string, unknown>
  if (
    !('library' in root) ||
    root.library == null ||
    typeof root.library !== 'object' ||
    Array.isArray(root.library)
  ) {
    return { ok: false, reason: 'missing-library' }
  }

  const library = root.library as Record<string, unknown>
  if (!('tracks' in library)) {
    return { ok: false, reason: 'missing-tracks' }
  }
  if (!Array.isArray(library.tracks)) {
    return { ok: false, reason: 'invalid-tracks' }
  }

  const refs: string[] = []
  for (const item of library.tracks) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: 'invalid-item' }
    }
    const row = item as Record<string, unknown>
    if (row.id == null || (typeof row.id !== 'string' && typeof row.id !== 'number')) {
      return { ok: false, reason: 'invalid-item' }
    }
    if (row.albumId != null && String(row.albumId).length > 0) {
      refs.push(`${row.id}:${row.albumId}`)
    } else {
      refs.push(String(row.id))
    }
  }

  return { ok: true, refs }
}

/**
 * Сопоставляет ответ /tracks с запрошенными refs.
 * Полностью пустой/невалидный ответ — incomplete (не prune).
 * Частично отсутствующие id (unavailable/deleted в каталоге) → stub, sync может завершиться.
 */
export function resolveHydratedTracksForBatch(
  requestedRefs: readonly string[],
  response: unknown,
): LikedTracksHydrationResult {
  if (requestedRefs.length === 0) {
    return { ok: true, tracks: [] }
  }
  if (!Array.isArray(response)) {
    return { ok: false, reason: 'invalid-response' }
  }
  if (response.length === 0) {
    return { ok: false, reason: 'empty-response' }
  }

  const byId = new Map<string, YandexTrack>()
  for (const item of response) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: 'invalid-track' }
    }
    const track = item as YandexTrack
    if (track.id == null || (typeof track.id !== 'string' && typeof track.id !== 'number')) {
      return { ok: false, reason: 'invalid-track' }
    }
    byId.set(String(track.id), track)
  }

  let matched = 0
  const tracks: YandexTrack[] = []
  for (const ref of requestedRefs) {
    const id = likedRefTrackId(ref)
    const found = byId.get(id)
    if (found) {
      matched += 1
      tracks.push(found)
    } else {
      tracks.push({
        id,
        title: 'Unavailable track',
        available: false,
      })
    }
  }

  if (matched === 0) {
    return { ok: false, reason: 'no-matches' }
  }

  return { ok: true, tracks }
}
