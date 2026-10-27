import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { UserTasteProfile } from '../taste/types.ts'
import type { ContinuationCandidate, ContinuationProvider, ContinuationSignal } from './types.ts'

export type ContinuationReason = 'library-like' | 'taste-positive' | 'same-artist' | 'known-rest'

export type ContinuationLibraryTrack = {
  id: string
  sourceId: string
  externalId: string
  title: string
  artist: string
  artistId: string | null
  liked: boolean
  disliked: boolean
  hidden: boolean
  score: number
  lastPlayed: string | null
}

export type ContinuationSeed = {
  id: string
  sourceId: string
  title: string
  artist: string
  artistId: string | null
}

export type ContinuationPick = {
  track: ContinuationLibraryTrack
  reason: ContinuationReason
}

const TIER: Record<ContinuationReason, number> = {
  'library-like': 0,
  'taste-positive': 1,
  'same-artist': 2,
  'known-rest': 3,
}

export function normalizeArtistName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function titleIdentity(artist: string, title: string): string {
  return `${normalizeArtistName(artist)}|${title.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

function artistKey(sourceId: string, artist: string): string {
  return `${sourceId}\0${normalizeArtistName(artist)}`
}

/** Одинаковое имя с разными id источника — неоднозначность, совпадение по имени запрещено. */
export function sameVerifiedArtist(
  left: { sourceId: string; artist: string; artistId: string | null },
  right: { sourceId: string; artist: string; artistId: string | null },
  idsByName: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const name = normalizeArtistName(left.artist)
  if (!name || name !== normalizeArtistName(right.artist)) {
    return false
  }
  if (left.artistId && right.artistId) {
    return left.sourceId === right.sourceId && left.artistId === right.artistId
  }
  const ids = idsByName.get(artistKey(right.sourceId, right.artist))
  if (ids && ids.size > 1) {
    return false
  }
  if (left.artistId && ids && ids.size === 1 && !ids.has(left.artistId)) {
    return false
  }
  if (right.artistId && left.artistId && right.artistId !== left.artistId) {
    return false
  }
  return true
}

function collectArtistIds(
  library: readonly ContinuationLibraryTrack[],
): Map<string, Set<string>> {
  const ids = new Map<string, Set<string>>()
  for (const item of library) {
    if (!item.artistId) {
      continue
    }
    const key = artistKey(item.sourceId, item.artist)
    const bucket = ids.get(key) ?? new Set<string>()
    bucket.add(item.artistId)
    ids.set(key, bucket)
  }
  return ids
}

function reasonFor(
  item: ContinuationLibraryTrack,
  seed: ContinuationSeed,
  idsByName: ReadonlyMap<string, ReadonlySet<string>>,
): ContinuationReason | null {
  if (item.disliked || item.hidden || item.score < 0 || isDemoSourceId(item.sourceId) || !item.externalId) {
    return null
  }
  if (item.liked) {
    return 'library-like'
  }
  if (item.score > 0) {
    return 'taste-positive'
  }
  if (sameVerifiedArtist(seed, item, idsByName)) {
    return 'same-artist'
  }
  if (item.lastPlayed) {
    return 'known-rest'
  }
  return null
}

/**
 * Следующий трек только из уже известной библиотеки.
 * Текстовая выдача поиска сюда не передаётся и не читается.
 */
export function rankSearchContinuations(input: {
  seed: ContinuationSeed
  library: readonly ContinuationLibraryTrack[]
  queueIds: readonly string[]
  played?: readonly { title: string; artist: string }[]
}): ContinuationPick[] {
  const blockedIds = new Set([input.seed.id, ...input.queueIds])
  const blockedTitles = new Set([
    titleIdentity(input.seed.artist, input.seed.title),
    ...(input.played ?? []).map((track) => titleIdentity(track.artist, track.title)),
  ])
  const idsByName = collectArtistIds(input.library)
  const eligible: Array<ContinuationPick & { tier: number; penalty: number }> = []

  for (const item of input.library) {
    if (blockedIds.has(item.id) || blockedTitles.has(titleIdentity(item.artist, item.title))) {
      continue
    }
    const reason = reasonFor(item, input.seed, idsByName)
    if (!reason) {
      continue
    }
    eligible.push({ track: item, reason, tier: TIER[reason], penalty: 0 })
  }

  const hasOtherArtist = new Map<number, boolean>()
  for (const item of eligible) {
    if (!sameVerifiedArtist(input.seed, item.track, idsByName)) {
      hasOtherArtist.set(item.tier, true)
    }
  }
  for (const item of eligible) {
    item.penalty =
      hasOtherArtist.get(item.tier) && sameVerifiedArtist(input.seed, item.track, idsByName) ? 1 : 0
  }

  eligible.sort((left, right) => {
    if (left.tier !== right.tier) {
      return left.tier - right.tier
    }
    if (left.penalty !== right.penalty) {
      return left.penalty - right.penalty
    }
    const played = (left.track.lastPlayed ?? '').localeCompare(right.track.lastPlayed ?? '')
    if (played !== 0) {
      return played
    }
    if (right.track.score !== left.track.score) {
      return right.track.score - left.track.score
    }
    return left.track.id.localeCompare(right.track.id)
  })

  return eligible.map((item) => ({ track: item.track, reason: item.reason }))
}

export function selectSearchContinuation(input: {
  seed: ContinuationSeed
  library: readonly ContinuationLibraryTrack[]
  queueIds: readonly string[]
  played?: readonly { title: string; artist: string }[]
}): ContinuationPick | null {
  return rankSearchContinuations(input)[0] ?? null
}

export function selectSearchContinuationQueue(input: {
  seed: ContinuationSeed
  library: readonly ContinuationLibraryTrack[]
  queueIds: readonly string[]
  limit?: number
}): ContinuationPick[] {
  const picks: ContinuationPick[] = []
  const queueIds = [...input.queueIds]
  const played = [{ title: input.seed.title, artist: input.seed.artist }]
  let seed = input.seed
  const limit = input.limit ?? 8
  while (picks.length < limit) {
    const next = selectSearchContinuation({
      seed,
      library: input.library,
      queueIds,
      played,
    })
    if (!next) {
      break
    }
    picks.push(next)
    queueIds.push(next.track.id)
    played.push({ title: next.track.title, artist: next.track.artist })
    seed = {
      id: next.track.id,
      sourceId: next.track.sourceId,
      title: next.track.title,
      artist: next.track.artist,
      artistId: next.track.artistId,
    }
  }
  return picks
}

function toTrack(item: ContinuationLibraryTrack): Track {
  return {
    id: item.id,
    sourceId: item.sourceId,
    externalId: item.externalId,
    title: item.title,
    artist: item.artist,
  }
}

export function mapCanonicalContinuationLibrary(
  items: readonly CanonicalLibraryItem[],
  profile: UserTasteProfile | null,
): ContinuationLibraryTrack[] {
  const byCanonical = new Map<string, { score: number; lastPlayed: string | null }>()
  for (const track of profile?.tracks ?? []) {
    if (track.key.kind !== 'canonical') {
      continue
    }
    byCanonical.set(track.key.canonicalTrackId, {
      score: track.score,
      lastPlayed: track.lastPlayed,
    })
  }

  const result: ContinuationLibraryTrack[] = []
  for (const item of items) {
    const copy = item.copies.find((candidate) => candidate.externalId && !isDemoSourceId(candidate.sourceId))
    if (!copy) {
      continue
    }
    const taste = byCanonical.get(item.canonicalTrack.id)
    result.push({
      id: `${copy.sourceId}:${copy.externalId}`,
      sourceId: copy.sourceId,
      externalId: copy.externalId,
      title: copy.title || item.canonicalTrack.title,
      artist: copy.artist || item.canonicalTrack.artist,
      artistId: null,
      liked: item.state.liked,
      disliked: item.state.disliked,
      hidden: item.state.hidden,
      score: taste?.score ?? 0,
      lastPlayed: item.state.lastPlayed ?? taste?.lastPlayed ?? null,
    })
  }
  return result
}

export type LibraryContinuationDeps = {
  loadProfile: () => Promise<UserTasteProfile | null>
  loadLibrary: (profile: UserTasteProfile | null) => Promise<readonly ContinuationLibraryTrack[]>
  isPlayable: (track: Track, signal: AbortSignal) => Promise<boolean>
  excludedTracks?: () => readonly { id: string; title: string; artist: string }[]
}

export function createLibraryContinuationProvider(deps: LibraryContinuationDeps): ContinuationProvider {
  return {
    async prepareContinuation(current, _context, signal): Promise<ContinuationCandidate | null> {
      if (signal.aborted) {
        return null
      }
      try {
        const profile = await deps.loadProfile()
        if (signal.aborted) {
          return null
        }
        const library = await deps.loadLibrary(profile)
        if (signal.aborted) {
          return null
        }
        const queued = deps.excludedTracks?.() ?? [
          { id: current.id, title: current.title, artist: current.artist },
        ]
        const ranked = rankSearchContinuations({
          seed: {
            id: current.id,
            sourceId: current.sourceId,
            title: current.title,
            artist: current.artist,
            artistId: null,
          },
          library,
          queueIds: queued.map((track) => track.id),
          played: queued,
        }).slice(0, 8)
        for (const pick of ranked) {
          if (signal.aborted) {
            return null
          }
          const track = toTrack(pick.track)
          let playable = false
          try {
            playable = await deps.isPlayable(track, abortFrom(signal))
          } catch {
            playable = false
          }
          if (playable) {
            return { track }
          }
        }
        return null
      } catch {
        return null
      }
    },
  }
}

function abortFrom(signal: ContinuationSignal): AbortSignal {
  const controller = new AbortController()
  if (signal.aborted) {
    controller.abort()
  }
  return controller.signal
}
