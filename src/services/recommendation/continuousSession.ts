/**
 * Состояние discovery / candidate pool continuous-random-v1.
 * Не сбрасывается на каждый UP; не является PlaybackQueue.
 */
import type { Track } from '../../types/track.ts'
import { captureAuthSession, type AuthSessionSnapshot } from '../auth/sessionEpoch.ts'
import { noteContinuousDiag } from './continuousDiag.ts'
import { CONTINUOUS_LIMITS } from './continuousLimits.ts'
import { copyIdentity, titleIdentity } from './identity.ts'
import type { RecommendationMode } from './types.ts'

export type DiscoveryLaneKind = 'feed' | 'search'

export type DiscoveryLane = {
  sourceId: string
  kind: DiscoveryLaneKind
  query: string | null
  cursor: string | null
  exhausted: boolean
  emptyStreak: number
}

export type ContinuousDiscoverySnapshot = {
  mode: RecommendationMode | null
  auth: AuthSessionSnapshot
  lanes: DiscoveryLane[]
  queryIndex: number
  poolSize: number
  recentSize: number
  rateLimitedUntil: number
  pagesFetched: number
}

type PoolEntry = {
  track: Track
  keys: string[]
}

let mode: RecommendationMode | null = null
let auth: AuthSessionSnapshot = captureAuthSession()
/** Владение discovery-операцией: bump при logout/mode/reset. */
let discoveryGeneration = 0
let lanes: DiscoveryLane[] = []
let queryOrder: string[] = []
let queryIndex = 0
let pool: PoolEntry[] = []
/** Идентичности, уже лежащие в pool или недавно ingest — без дублей страниц. */
let poolKeys = new Set<string>()
/** Скользящее окно недавно отданных в playback. */
let recentKeys: string[] = []
let recentSet = new Set<string>()
let rateLimitedUntil = 0
let pagesFetchedSession = 0
let lastSeed: Track | null = null
let sourceSemaphores = new Map<string, number>()

export function getContinuousDiscoveryGeneration(): number {
  return discoveryGeneration
}

export type ContinuousDiscoveryOperationToken = {
  generation: number
  mode: RecommendationMode | null
  auth: AuthSessionSnapshot
}

export function beginContinuousDiscoveryOperation(): ContinuousDiscoveryOperationToken {
  return {
    generation: discoveryGeneration,
    mode,
    auth: { ...auth },
  }
}

export function isContinuousDiscoveryOperationCurrent(
  token: ContinuousDiscoveryOperationToken,
): boolean {
  if (token.generation !== discoveryGeneration) {
    return false
  }
  if (token.mode !== mode) {
    return false
  }
  const live = captureAuthSession()
  if (
    live.generation !== token.auth.generation ||
    live.userId !== token.auth.userId ||
    live.generation !== auth.generation ||
    live.userId !== auth.userId
  ) {
    return false
  }
  return true
}

function bumpDiscoveryGeneration(): void {
  discoveryGeneration += 1
}

function trackKeys(track: Track): string[] {
  return [track.id, copyIdentity(track), titleIdentity(track.artist, track.title)]
}

function rebuildRecentSet(): void {
  recentSet = new Set(recentKeys)
}

export function getContinuousDiscoverySnapshot(): ContinuousDiscoverySnapshot {
  return {
    mode,
    auth,
    lanes: lanes.map((lane) => ({ ...lane })),
    queryIndex,
    poolSize: pool.length,
    recentSize: recentKeys.length,
    rateLimitedUntil,
    pagesFetched: pagesFetchedSession,
  }
}

export function ensureContinuousDiscoverySession(
  nextMode: RecommendationMode,
  options?: { resetLanes?: boolean },
): void {
  const live = captureAuthSession()
  const authChanged =
    live.generation !== auth.generation || live.userId !== auth.userId
  const modeChanged = mode !== null && mode !== nextMode
  if (authChanged) {
    clearContinuousDiscoveryRuntime('auth-changed')
    mode = nextMode
    auth = live
    return
  }
  mode = nextMode
  if (modeChanged || options?.resetLanes) {
    bumpDiscoveryGeneration()
    lanes = []
    queryOrder = []
    queryIndex = 0
    clearCandidatePool()
    noteContinuousDiag({
      mode: nextMode,
      phase: 'discovery-start',
      reason: modeChanged ? 'mode-switch' : 'reset-lanes',
    })
  }
}

export function clearContinuousDiscoveryRuntime(reason = 'clear'): void {
  bumpDiscoveryGeneration()
  lanes = []
  queryOrder = []
  queryIndex = 0
  clearCandidatePool()
  recentKeys = []
  rebuildRecentSet()
  rateLimitedUntil = 0
  pagesFetchedSession = 0
  lastSeed = null
  sourceSemaphores = new Map()
  mode = null
  auth = captureAuthSession()
  noteContinuousDiag({
    mode: 'swipe',
    phase: 'hard-miss',
    reason: `discovery-reset:${reason}`,
  })
}

export function clearCandidatePool(): void {
  pool = []
  poolKeys = new Set()
}

export function getContinuousPoolSize(): number {
  return pool.length
}

export function getContinuousRecentSize(): number {
  return recentKeys.length
}

export function getContinuousPagesFetched(): number {
  return pagesFetchedSession
}

export function noteContinuousSeed(track: Track): void {
  lastSeed = track
  noteContinuousRecent(track)
}

export function getContinuousSeed(): Track | null {
  return lastSeed
}

export function noteContinuousRecent(track: Track): void {
  for (const key of trackKeys(track)) {
    if (recentSet.has(key)) {
      recentKeys = recentKeys.filter((item) => item !== key)
    }
    recentKeys.push(key)
  }
  while (recentKeys.length > CONTINUOUS_LIMITS.recentWindow) {
    recentKeys.shift()
  }
  rebuildRecentSet()
}

export function isContinuousRecentOrCurrent(
  track: Track,
  extraExclude?: ReadonlySet<string>,
): boolean {
  for (const key of trackKeys(track)) {
    if (recentSet.has(key)) {
      return true
    }
    if (extraExclude?.has(key) || extraExclude?.has(track.id)) {
      return true
    }
  }
  return false
}

export function pushCandidatesToPool(tracks: readonly Track[]): number {
  let added = 0
  for (const track of tracks) {
    if (pool.length >= CONTINUOUS_LIMITS.maxPoolSize) {
      break
    }
    const keys = trackKeys(track)
    if (keys.some((key) => poolKeys.has(key) || recentSet.has(key))) {
      continue
    }
    for (const key of keys) {
      poolKeys.add(key)
    }
    pool.push({ track, keys })
    added += 1
  }
  return added
}

/** Забрать metadata из pool без playability (для последующей проверки). */
export function takeFromCandidatePool(
  count: number,
  exclude?: ReadonlySet<string>,
): Track[] {
  const out: Track[] = []
  const kept: PoolEntry[] = []
  for (const entry of pool) {
    if (out.length >= count) {
      kept.push(entry)
      continue
    }
    if (isContinuousRecentOrCurrent(entry.track, exclude)) {
      // Устаревший относительно recent — выкидываем из pool.
      for (const key of entry.keys) {
        poolKeys.delete(key)
      }
      continue
    }
    out.push(entry.track)
    for (const key of entry.keys) {
      poolKeys.delete(key)
    }
  }
  pool = kept
  return out
}

export function peekCandidatePoolIds(): string[] {
  return pool.map((entry) => entry.track.id)
}

export function setDiscoveryQueryOrder(
  queries: readonly string[],
  options?: { force?: boolean },
): void {
  if (queryOrder.length > 0 && !options?.force) {
    return
  }
  queryOrder = [...queries]
  queryIndex = 0
}

export function getDiscoveryQueryOrder(): readonly string[] {
  return queryOrder
}

export function getDiscoveryLanes(): readonly DiscoveryLane[] {
  return lanes
}

export function ensureDiscoveryLanes(sourceIds: readonly string[]): void {
  if (lanes.length > 0) {
    return
  }
  for (const sourceId of sourceIds) {
    lanes.push({
      sourceId,
      kind: 'feed',
      query: null,
      cursor: null,
      exhausted: false,
      emptyStreak: 0,
    })
  }
  for (const query of queryOrder) {
    for (const sourceId of sourceIds) {
      lanes.push({
        sourceId,
        kind: 'search',
        query,
        cursor: null,
        exhausted: false,
        emptyStreak: 0,
      })
    }
  }
}

export function pickNextDiscoveryLane(): DiscoveryLane | null {
  const active = lanes.find((lane) => !lane.exhausted)
  return active ?? null
}

/**
 * Продвижение lane после страницы провайдера.
 * - Пустая страница провайдера (0 tracks) увеличивает emptyStreak.
 * - Страница только из excluded/recent при наличии nextCursor — cursor двигается, lane НЕ exhausted.
 * - acceptedTracks не влияет на cursor.
 */
export function markLanePageResult(
  lane: DiscoveryLane,
  input: {
    providerTracks: number
    acceptedTracks: number
    nextCursor: string | null
  },
): void {
  pagesFetchedSession += 1

  if (input.nextCursor) {
    lane.cursor = input.nextCursor
    if (input.providerTracks === 0) {
      lane.emptyStreak += 1
      if (lane.emptyStreak >= CONTINUOUS_LIMITS.maxEmptyLaneStreak) {
        lane.exhausted = true
        lane.cursor = null
      }
    } else {
      // Провайдер отдал треки (даже все excluded) — это не empty miss.
      lane.emptyStreak = 0
    }
    return
  }

  // Конец пагинации этой lane.
  lane.cursor = null
  if (input.providerTracks === 0) {
    lane.emptyStreak += 1
    if (lane.emptyStreak >= CONTINUOUS_LIMITS.maxEmptyLaneStreak) {
      lane.exhausted = true
    }
    return
  }
  lane.emptyStreak = 0
  lane.exhausted = true
}

export function markLaneError(lane: DiscoveryLane, isRateLimit: boolean): void {
  if (isRateLimit) {
    const delay = Math.min(
      CONTINUOUS_LIMITS.backoffMaxMs,
      CONTINUOUS_LIMITS.backoffBaseMs * 2 ** Math.min(4, lane.emptyStreak + 1),
    )
    rateLimitedUntil = Date.now() + delay
    lane.emptyStreak += 1
    noteContinuousDiag({
      mode: mode ?? 'swipe',
      phase: 'soft-miss',
      source: lane.sourceId,
      reason: 'rate-limit',
    })
    return
  }
  lane.emptyStreak += 1
  if (lane.emptyStreak >= CONTINUOUS_LIMITS.maxEmptyLaneStreak) {
    lane.exhausted = true
  }
}

export function isDiscoveryRateLimited(): boolean {
  return Date.now() < rateLimitedUntil
}

export function getDiscoveryRateLimitedRemainingMs(): number {
  return Math.max(0, rateLimitedUntil - Date.now())
}

export async function withSourceConcurrency<T>(
  sourceId: string,
  run: () => Promise<T>,
): Promise<T> {
  const max = CONTINUOUS_LIMITS.maxConcurrentSourceRequests
  while ((sourceSemaphores.get(sourceId) ?? 0) >= max) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  sourceSemaphores.set(sourceId, (sourceSemaphores.get(sourceId) ?? 0) + 1)
  try {
    return await run()
  } finally {
    sourceSemaphores.set(
      sourceId,
      Math.max(0, (sourceSemaphores.get(sourceId) ?? 1) - 1),
    )
  }
}

export function allDiscoveryLanesExhausted(): boolean {
  return lanes.length > 0 && lanes.every((lane) => lane.exhausted)
}

export function resetContinuousDiscoveryForTests(): void {
  clearContinuousDiscoveryRuntime('test-reset')
}
