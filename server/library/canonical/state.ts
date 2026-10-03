import type { CanonicalUserState } from './types.ts'

const CONFLICTS_KEY = '_mergeConflicts'

const SECRET_KEY = /token|secret|password|credential|oauth/i

export function neutralCanonicalState(now: string): CanonicalUserState {
  return {
    addedAt: now,
    lastPlayed: null,
    playCount: 0,
    liked: false,
    likedAt: null,
    disliked: false,
    skipped: 0,
    notes: '',
    favorite: false,
    hidden: false,
    customMetadata: {},
  }
}

/**
 * Слияние двух состояний одной композиции.
 * Целевая сторона сохраняет конфликтующие значения, вторая не теряется:
 * текст заметок склеивается, metadata кладётся в `_mergeConflicts`.
 * `liked` побеждает `disliked`. `hidden` остаётся только если скрыты обе стороны.
 */
export function mergeCanonicalUserState(
  target: CanonicalUserState,
  incoming: CanonicalUserState,
): CanonicalUserState {
  const liked = target.liked || incoming.liked
  return {
    addedAt: earlier(target.addedAt, incoming.addedAt),
    lastPlayed: latest(target.lastPlayed, incoming.lastPlayed),
    playCount: target.playCount + incoming.playCount,
    liked,
    likedAt: liked ? earliestLikedAt(target, incoming) : null,
    disliked: liked ? false : target.disliked || incoming.disliked,
    skipped: target.skipped + incoming.skipped,
    notes: mergeNotes(target.notes, incoming.notes),
    favorite: target.favorite || incoming.favorite,
    hidden: target.hidden && incoming.hidden,
    customMetadata: mergeMetadata(target.customMetadata, incoming.customMetadata),
  }
}

export function stripCanonicalMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      continue
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      result[key] = stripCanonicalMetadata(entry as Record<string, unknown>)
    } else {
      result[key] = entry
    }
  }
  return result
}

function earlier(left: string, right: string): string {
  return left <= right ? left : right
}

function latest(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return left >= right ? left : right
}

function earliestLikedAt(left: CanonicalUserState, right: CanonicalUserState): string | null {
  const stamps = [left, right]
    .filter((state) => state.liked && state.likedAt)
    .map((state) => state.likedAt as string)
  if (stamps.length === 0) {
    return null
  }
  return stamps.sort()[0] ?? null
}

function mergeNotes(left: string, right: string): string {
  const target = left.trim()
  const incoming = right.trim()
  if (!target) return incoming
  if (!incoming || target === incoming) return target
  return `${target}\n---\n${incoming}`
}

function mergeMetadata(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...incoming, ...target }
  const conflicts: Array<{ key: string; value: unknown }> = []
  for (const key of Object.keys(incoming)) {
    if (key === CONFLICTS_KEY) continue
    if (
      Object.prototype.hasOwnProperty.call(target, key) &&
      JSON.stringify(target[key]) !== JSON.stringify(incoming[key])
    ) {
      conflicts.push({ key, value: incoming[key] })
    }
  }
  const previous = readConflicts(target[CONFLICTS_KEY])
  const incomingConflicts = readConflicts(incoming[CONFLICTS_KEY])
  const merged = [...previous, ...incomingConflicts, ...conflicts]
  if (merged.length > 0) {
    result[CONFLICTS_KEY] = merged
  } else {
    delete result[CONFLICTS_KEY]
  }
  return result
}

function readConflicts(value: unknown): Array<{ key: string; value: unknown }> {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(
    (entry): entry is { key: string; value: unknown } =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      typeof (entry as { key?: unknown }).key === 'string',
  )
}
