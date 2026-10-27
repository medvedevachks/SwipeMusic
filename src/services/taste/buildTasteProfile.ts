import { classifyPlaybackSignal } from '../playbackAnalytics/classifySignal.ts'
import { PLAYBACK_ANALYTICS_LIMITS, PLAYBACK_EVENT, PLAYBACK_REASON } from '../playbackAnalytics/types.ts'
import { TASTE_LIMITS, TASTE_WEIGHTS } from './weights.ts'
import type {
  TasteActivity,
  TasteCatalogMembership,
  TasteInput,
  TastePlaybackEvent,
  TastePlaybackStat,
  TasteSignal,
  TasteSourceCopy,
  TasteTrackKey,
  TasteTrackProfile,
  UserTasteProfile,
} from './types.ts'

type Bucket = {
  key: TasteTrackKey
  label: { title: string; artist: string } | null
  copies: Map<string, TasteSourceCopy>
  signals: TasteSignal[]
  liked: boolean
  disliked: boolean
  hidden: boolean
  librarySkipped: number
  historySkipped: number
  libraryPlayCount: number
  lastPlayed: string | null
  confirmedListens: number
  completions: number
  earlySkips: number
  sawEvents: boolean
}

export function emptyTasteProfile(userId: string, builtAt: string): UserTasteProfile {
  return {
    schemaVersion: 1,
    userId,
    builtAt,
    empty: true,
    tracks: [],
    catalogs: [],
    recentActivity: [],
  }
}

/** Ошибка расчёта не должна всплывать в плеер. */
export function readUserTasteProfile(
  userId: string,
  input: TasteInput,
  builtAt: string,
): UserTasteProfile {
  try {
    return buildUserTasteProfile(userId, input, builtAt)
  } catch {
    return emptyTasteProfile(userId, builtAt)
  }
}

export function buildUserTasteProfile(
  userId: string,
  input: TasteInput,
  builtAt: string,
): UserTasteProfile {
  const source = normalizeInput(input)
  const claims = collectClaims(source)
  const buckets = new Map<string, Bucket>()
  const activity: TasteActivity[] = []
  const catalogTracks = new Map<string, Set<string>>()

  for (const item of source.library) {
    if (!item.canonicalTrackId) {
      continue
    }
    const bucket = takeBucket(buckets, { kind: 'canonical', canonicalTrackId: item.canonicalTrackId })
    bucket.label = { title: item.title, artist: item.artist }
    bucket.liked = bucket.liked || item.liked
    bucket.disliked = bucket.disliked || item.disliked
    bucket.hidden = bucket.hidden || item.hidden
    bucket.librarySkipped += Math.max(0, item.skipped)
    bucket.libraryPlayCount += Math.max(0, item.playCount)
    bucket.lastPlayed = later(bucket.lastPlayed, item.lastPlayed)
    if (item.lastPlayed) {
      activity.push({
        key: bucket.key,
        at: item.lastPlayed,
        origin: 'library-last-played',
      })
    }
    for (const copy of item.copies) {
      if (resolvedCanonical(claims, copy.sourceId, copy.externalId) === item.canonicalTrackId) {
        rememberCopy(bucket, copy)
      }
    }
    for (const catalogId of item.catalogIds) {
      const keys = catalogTracks.get(catalogId) ?? new Set<string>()
      keys.add(keyId(bucket.key))
      catalogTracks.set(catalogId, keys)
    }
  }

  for (const events of groupEvents(source.events).values()) {
    const sample = events[0]
    if (!sample) {
      continue
    }
    const bucket = bucketForCopy(buckets, claims, sample.sourceId, sample.externalId, sample.canonicalTrackId)
    bucket.sawEvents = true
    for (const session of sessionsOf(events)) {
      if (session.failed && !session.completed && session.listenedMs < PLAYBACK_ANALYTICS_LIMITS.heardMs) {
        continue
      }
      const signal = classifyPlaybackSignal({
        durationMs: session.durationMs,
        listenedMs: session.listenedMs,
        completed: session.completed,
        skipped: session.skipped,
        failed: false,
      })
      if (signal === 'listened' || signal === 'completed') {
        bucket.confirmedListens += 1
      }
      if (signal === 'completed') {
        bucket.completions += 1
      }
      if (signal === 'early-skip') {
        bucket.earlySkips += 1
      }
      if (session.startedAt) {
        activity.push({ key: bucket.key, at: session.startedAt, origin: 'playback-started' })
      }
      if (session.completedAt) {
        activity.push({ key: bucket.key, at: session.completedAt, origin: 'playback-completed' })
        bucket.lastPlayed = later(bucket.lastPlayed, session.completedAt)
      }
    }
  }

  for (const stat of source.stats) {
    const bucket = bucketForCopy(buckets, claims, stat.sourceId, stat.externalId, stat.canonicalTrackId)
    if (bucket.sawEvents || statRowIsEmpty(stat)) {
      continue
    }
    applyStats(bucket, stat)
  }

  for (const entry of source.history) {
    if (!entry.sourceId || !entry.externalId) {
      continue
    }
    const bucket = bucketForCopy(
      buckets,
      claims,
      entry.sourceId,
      entry.externalId,
      entry.canonicalTrackId,
    )
    if (entry.action === 'like' && !bucket.liked) {
      bucket.signals.push(signal('history-like', 'explicit', TASTE_WEIGHTS.explicitLike, 'лайк из истории'))
      bucket.liked = true
    } else if (entry.action === 'skip') {
      bucket.historySkipped += 1
    }
    if (entry.catalogId) {
      const keys = catalogTracks.get(entry.catalogId) ?? new Set<string>()
      keys.add(keyId(bucket.key))
      catalogTracks.set(entry.catalogId, keys)
    }
    if (entry.action === 'like' || entry.action === 'skip' || entry.action === 'categorize') {
      activity.push({ key: bucket.key, at: entry.createdAt, origin: 'history' })
    }
  }

  const tracks = [...buckets.values()]
    .map(finishBucket)
    .filter((track) => track.signals.length > 0)
    .sort((left, right) => keyId(left.key).localeCompare(keyId(right.key)))

  const names = new Map(source.catalogs.map((catalog) => [catalog.id, catalog.name]))
  const catalogs = [...catalogTracks.entries()]
    .map(([catalogId, keys]): TasteCatalogMembership => ({
      catalogId,
      name: names.get(catalogId) ?? '',
      trackKeys: [...keys].sort().map(parseKeyId),
    }))
    .sort((left, right) => left.catalogId.localeCompare(right.catalogId))

  const recentActivity = activity
    .filter((item) => item.at)
    .sort((left, right) => {
      const time = right.at.localeCompare(left.at)
      return time === 0 ? keyId(left.key).localeCompare(keyId(right.key)) : time
    })
    .slice(0, TASTE_LIMITS.recentActivity)

  return {
    schemaVersion: 1,
    userId,
    builtAt,
    empty: tracks.length === 0 && catalogs.length === 0 && recentActivity.length === 0,
    tracks,
    catalogs,
    recentActivity,
  }
}

function normalizeInput(input: TasteInput): TasteInput {
  const events = [...(input.events ?? [])]
    .filter((event) => event.sourceId && event.externalId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.sessionId.localeCompare(right.sessionId))
  const history = [...(input.history ?? [])]
    .filter((entry) => entry.createdAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return {
    library: input.library ?? [],
    catalogs: input.catalogs ?? [],
    stats: (input.stats ?? []).filter((stat) => stat.sourceId && stat.externalId),
    events: events.slice(-TASTE_LIMITS.maxEvents),
    history: history.slice(0, TASTE_LIMITS.maxHistory),
  }
}

function collectClaims(input: TasteInput): Map<string, Set<string>> {
  const claims = new Map<string, Set<string>>()
  const claim = (sourceId: string, externalId: string, canonicalTrackId: string | null) => {
    if (!sourceId || !externalId || !canonicalTrackId) {
      return
    }
    const id = copyId(sourceId, externalId)
    const set = claims.get(id) ?? new Set<string>()
    set.add(canonicalTrackId)
    claims.set(id, set)
  }
  for (const item of input.library) {
    for (const copy of item.copies) {
      claim(copy.sourceId, copy.externalId, copy.canonicalTrackId || item.canonicalTrackId)
    }
  }
  for (const stat of input.stats) {
    claim(stat.sourceId, stat.externalId, stat.canonicalTrackId)
  }
  for (const event of input.events) {
    claim(event.sourceId, event.externalId, event.canonicalTrackId)
  }
  for (const entry of input.history) {
    claim(entry.sourceId, entry.externalId, entry.canonicalTrackId)
  }
  return claims
}

function resolvedCanonical(
  claims: Map<string, Set<string>>,
  sourceId: string,
  externalId: string,
): string | null {
  const set = claims.get(copyId(sourceId, externalId))
  if (!set || set.size !== 1) {
    return null
  }
  return [...set][0] ?? null
}

function bucketForCopy(
  buckets: Map<string, Bucket>,
  claims: Map<string, Set<string>>,
  sourceId: string,
  externalId: string,
  hintedCanonicalId: string | null,
): Bucket {
  const canonicalTrackId = resolvedCanonical(claims, sourceId, externalId)
  const key: TasteTrackKey = canonicalTrackId
    ? { kind: 'canonical', canonicalTrackId }
    : { kind: 'source', sourceId, externalId }
  const bucket = takeBucket(buckets, key)
  if (canonicalTrackId && canonicalTrackId === hintedCanonicalId) {
    rememberCopy(bucket, { sourceId, externalId, canonicalTrackId })
  } else if (!canonicalTrackId) {
    rememberCopy(bucket, { sourceId, externalId, canonicalTrackId: null })
  }
  return bucket
}

function takeBucket(buckets: Map<string, Bucket>, key: TasteTrackKey): Bucket {
  const id = keyId(key)
  const existing = buckets.get(id)
  if (existing) {
    return existing
  }
  const created: Bucket = {
    key,
    label: null,
    copies: new Map(),
    signals: [],
    liked: false,
    disliked: false,
    hidden: false,
    librarySkipped: 0,
    historySkipped: 0,
    libraryPlayCount: 0,
    lastPlayed: null,
    confirmedListens: 0,
    completions: 0,
    earlySkips: 0,
    sawEvents: false,
  }
  buckets.set(id, created)
  return created
}

function finishBucket(bucket: Bucket): TasteTrackProfile {
  if (bucket.liked && !bucket.signals.some((item) => item.origin === 'canonical-like' || item.origin === 'history-like')) {
    bucket.signals.push(signal('canonical-like', 'explicit', TASTE_WEIGHTS.explicitLike, 'явный лайк'))
  }
  if (bucket.disliked) {
    bucket.signals.push(signal('canonical-dislike', 'explicit', TASTE_WEIGHTS.explicitDislike, 'явный дизлайк'))
  }
  if (bucket.hidden) {
    bucket.signals.push(signal('canonical-hidden', 'explicit', TASTE_WEIGHTS.explicitHidden, 'композиция скрыта'))
  }
  if (!bucket.sawEvents && bucket.libraryPlayCount > 0 && bucket.confirmedListens === 0) {
    bucket.signals.push(signal(
      'library-play-count',
      'weak',
      TASTE_WEIGHTS.confirmedListen,
      'счётчик библиотеки без отдельного подтверждения',
    ))
  }
  if (bucket.confirmedListens > 0) {
    bucket.signals.push(signal(
      'playback-listen',
      'observed',
      cappedPositive(bucket.confirmedListens * TASTE_WEIGHTS.confirmedListen, TASTE_WEIGHTS.maxListenContribution),
      'подтверждённое прослушивание',
    ))
  }
  if (bucket.completions > 0) {
    bucket.signals.push(signal(
      'playback-completion',
      'observed',
      cappedPositive(bucket.completions * TASTE_WEIGHTS.completion, TASTE_WEIGHTS.maxCompletionContribution),
      'дослушивание',
    ))
  }
  if (bucket.earlySkips > 0) {
    bucket.signals.push(signal(
      'playback-early-skip',
      'weak',
      cappedNegative(bucket.earlySkips * TASTE_WEIGHTS.earlySkip, TASTE_WEIGHTS.maxEarlySkipPenalty),
      'ранний пропуск',
    ))
  }
  if (bucket.librarySkipped > 0) {
    bucket.signals.push(signal(
      'canonical-skip-count',
      'weak',
      cappedNegative(bucket.librarySkipped * TASTE_WEIGHTS.weakSkip, TASTE_WEIGHTS.maxWeakSkipPenalty),
      'пропуски в библиотеке, это не дизлайк',
    ))
  }
  if (bucket.historySkipped > 0) {
    bucket.signals.push(signal(
      'history-skip',
      'weak',
      cappedNegative(bucket.historySkipped * TASTE_WEIGHTS.weakSkip, TASTE_WEIGHTS.maxWeakSkipPenalty),
      'пропуск из истории, это не дизлайк',
    ))
  }
  bucket.signals.sort((left, right) => left.origin.localeCompare(right.origin) || left.weight - right.weight)
  const score = bucket.signals.reduce((sum, item) => sum + item.weight, 0)
  return {
    key: bucket.key,
    label: bucket.label,
    copies: [...bucket.copies.values()].sort((left, right) => copyId(left.sourceId, left.externalId).localeCompare(copyId(right.sourceId, right.externalId))),
    score,
    signals: bucket.signals,
    lastPlayed: bucket.lastPlayed,
  }
}

function applyStats(bucket: Bucket, stat: TastePlaybackStat): void {
  const heard = stat.listenedMs >= PLAYBACK_ANALYTICS_LIMITS.heardMs || stat.completedCount > 0
  if (!heard) {
    return
  }
  const confirmed = stat.completedCount > 0
    ? stat.completedCount
    : Math.min(Math.max(stat.playCount, 1), Math.max(1, Math.floor(stat.listenedMs / PLAYBACK_ANALYTICS_LIMITS.heardMs)))
  bucket.confirmedListens += confirmed
  bucket.completions += Math.max(0, stat.completedCount)
}

function groupEvents(events: readonly TastePlaybackEvent[]): Map<string, TastePlaybackEvent[]> {
  const grouped = new Map<string, TastePlaybackEvent[]>()
  for (const event of events) {
    const id = copyId(event.sourceId, event.externalId)
    const list = grouped.get(id) ?? []
    list.push(event)
    grouped.set(id, list)
  }
  return grouped
}

type SessionFacts = {
  listenedMs: number
  durationMs: number | null
  completed: boolean
  skipped: boolean
  failed: boolean
  startedAt: string | null
  completedAt: string | null
}

function sessionsOf(events: readonly TastePlaybackEvent[]): SessionFacts[] {
  const sessions = new Map<string, SessionFacts>()
  for (const event of events) {
    const session = sessions.get(event.sessionId) ?? {
      listenedMs: 0,
      durationMs: null,
      completed: false,
      skipped: false,
      failed: false,
      startedAt: null,
      completedAt: null,
    }
    session.listenedMs = Math.max(session.listenedMs, Math.max(0, event.listenedMs))
    if (event.durationMs && event.durationMs > 0) {
      session.durationMs = event.durationMs
    }
    if (event.eventType === PLAYBACK_EVENT.STARTED) {
      session.startedAt = session.startedAt ?? event.createdAt
    } else if (event.eventType === PLAYBACK_EVENT.COMPLETED) {
      session.completed = true
      session.completedAt = event.createdAt
    } else if (event.eventType === PLAYBACK_EVENT.SKIPPED) {
      session.skipped = true
    } else if (isTechnicalFailure(event)) {
      session.failed = true
    }
    sessions.set(event.sessionId, session)
  }
  return [...sessions.values()]
}

function isTechnicalFailure(event: TastePlaybackEvent): boolean {
  return event.eventType === PLAYBACK_EVENT.FAILED
    || event.reason === PLAYBACK_REASON.LOAD_FAILED
    || event.reason === PLAYBACK_REASON.PLAYBACK_FAILED
}

function statRowIsEmpty(stat: TastePlaybackStat): boolean {
  return stat.playCount <= 0 && stat.completedCount <= 0 && stat.skippedCount <= 0 && stat.listenedMs <= 0
}

function rememberCopy(bucket: Bucket, copy: TasteSourceCopy): void {
  if (!copy.sourceId || !copy.externalId) {
    return
  }
  bucket.copies.set(copyId(copy.sourceId, copy.externalId), {
    sourceId: copy.sourceId,
    externalId: copy.externalId,
    canonicalTrackId: copy.canonicalTrackId,
  })
}

function signal(
  origin: TasteSignal['origin'],
  confidence: TasteSignal['confidence'],
  weight: number,
  note: string,
): TasteSignal {
  return { origin, confidence, weight, note }
}

function cappedPositive(value: number, max: number): number {
  return Math.min(Math.max(0, value), max)
}

function cappedNegative(value: number, min: number): number {
  return Math.max(Math.min(0, value), min)
}

function later(current: string | null, next: string | null): string | null {
  if (!next) {
    return current
  }
  if (!current || next > current) {
    return next
  }
  return current
}

export function keyId(key: TasteTrackKey): string {
  return key.kind === 'canonical'
    ? `canonical:${key.canonicalTrackId}`
    : `source:${key.sourceId}\u0000${key.externalId}`
}

function parseKeyId(value: string): TasteTrackKey {
  if (value.startsWith('canonical:')) {
    return { kind: 'canonical', canonicalTrackId: value.slice('canonical:'.length) }
  }
  const body = value.slice('source:'.length)
  const split = body.indexOf('\u0000')
  return {
    kind: 'source',
    sourceId: body.slice(0, split),
    externalId: body.slice(split + 1),
  }
}

function copyId(sourceId: string, externalId: string): string {
  return `${sourceId}\u0000${externalId}`
}
