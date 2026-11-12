import type { PlaybackContext } from '../../types/playbackContext.ts'
import { isSearchSeedContext } from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'
import type { ContinuationSession } from '../continuation/ContinuationSession.ts'
import { noteSearchFlowEvent } from '../continuation/searchFlowDiag.ts'
import { noteSearchPlaybackEvent } from '../continuation/searchPlaybackDebug.ts'
import { isContinuationCandidateAvailable } from '../continuation/types.ts'
import type { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import type { RecommendationMode } from './types.ts'
import {
  peekContinuousBuffer,
  requestContinuousBufferRefill,
  takeContinuousBufferedTrack,
} from './continuousBuffer.ts'
import { noteContinuousDiag } from './continuousDiag.ts'
import { noteContinuousSeed } from './continuousSession.ts'
import {
  getActiveRecommendationMode,
  noteRecommendationMiss,
  peekRecommendationMiss,
} from './sessionState.ts'
import { isCmeLiveMutationAllowed } from '../sessionSwitch/integration/cmeSessionOwnership.ts'

function guardLiveInsert(source: string): boolean {
  if (isCmeLiveMutationAllowed()) {
    return true
  }
  noteRecommendationMiss(
    'error',
    'Продолжение потока временно недоступно. Нажмите Next ещё раз.',
  )
  noteSearchFlowEvent({
    source: 'consumeRecommendationAdvance',
    detail: `cme-ownership-block:${source}`,
  })
  noteContinuousDiag({
    mode: getActiveRecommendationMode() ?? 'swipe',
    phase: 'playback-miss',
    reason: `cme-ownership-block:${source}`,
  })
  return false
}

function peekBufferedCandidate(
  excludeIds: ReadonlySet<string>,
): Track | null {
  for (const track of peekContinuousBuffer()) {
    if (!excludeIds.has(track.id)) {
      return track
    }
  }
  return null
}

/** Контексты, где Next/ended/жест идут через Recommendation Engine. */
export function isRecommendationAdvanceContext(context: PlaybackContext): boolean {
  if (isSearchSeedContext(context)) {
    return true
  }
  const mode = getActiveRecommendationMode()
  if (context.type === 'radio' && context.id === 'my-wave' && mode === 'wave') {
    return true
  }
  /*
   * Swipe + mode swipe|search: continuation через Recommendation Engine.
   * Mode 'search' бывает после ensureSearchRecommendation при живой swipe-очереди —
   * иначе UP падает в queue.next() по одному seed и чистит карточку.
   * mode === null: обычный queue.next (многотрековая колода / тесты).
   */
  if (context.type === 'swipe' && (mode === 'swipe' || mode === 'search')) {
    return true
  }
  return false
}

function syntheticPrepareContext(
  current: Track,
  queueContext: PlaybackContext,
): Extract<PlaybackContext, { type: 'search-seed' }> {
  if (isSearchSeedContext(queueContext)) {
    return queueContext
  }
  const mode = getActiveRecommendationMode()
  return {
    type: 'search-seed',
    query: mode === 'wave' ? 'my-wave' : mode === 'swipe' ? 'swipe' : 'recommendation',
    seedTrackId: current.id,
  }
}

/**
 * Синхронный шаг: очередь / prepared. Не ждёт inflight.
 * Search dump срезается trimUnplayedTail; album/playlist сюда не попадают.
 */
export function consumeRecommendationAdvance(
  queue: PlaybackQueue,
  session: ContinuationSession,
  options: { fromEnded: boolean },
): Track | null {
  const context = queue.getPlaybackContext()
  if (!isRecommendationAdvanceContext(context)) {
    return null
  }

  const fromEnded = options.fromEnded
  const repeatMode = queue.getSnapshot().repeatMode
  if (fromEnded && repeatMode === 'ONE') {
    return queue.next({ fromEnded: true })
  }

  const lengthBefore = queue.getItems().length
  queue.trimUnplayedTail()
  if (queue.getItems().length < lengthBefore) {
    noteSearchPlaybackEvent('advance-trim', {
      contextType: context.type,
      queueLength: queue.getItems().length,
      reason: fromEnded ? 'ended' : 'next',
    })
  }

  if (queue.peekNext()) {
    // История впереди: не берём prefetch и не зовём engine.
    session.cancel()
    const track = queue.next(fromEnded ? { fromEnded: true } : undefined)
    noteSearchFlowEvent({
      source: 'consumeRecommendationAdvance',
      contextBefore: context.type,
      contextAfter: queue.getPlaybackContext().type,
      queueLengthAfter: queue.getItems().length,
      currentIndex: queue.getSnapshot().currentIndex,
      trackId: track?.id ?? null,
      nextSource: 'queue',
      detail: fromEnded ? 'advance-history:ended' : 'advance-history:next',
    })
    return track
  }

  const prepared = session.peekPrepared()
  if (prepared) {
    const currentId = queue.current()?.id ?? prepared.id
    if (isContinuationCandidateAvailable(prepared, currentId, queue.getItems())) {
      if (!guardLiveInsert('prepared')) {
        return null
      }
      session.takePrepared()
      queue.insertNext(prepared)
      const track = queue.next(fromEnded ? { fromEnded: true } : undefined)
      noteSearchFlowEvent({
        source: 'consumeRecommendationAdvance',
        contextBefore: context.type,
        contextAfter: queue.getPlaybackContext().type,
        queueLengthAfter: queue.getItems().length,
        currentIndex: queue.getSnapshot().currentIndex,
        trackId: track?.id ?? null,
        nextSource: 'continuation',
        detail: fromEnded ? 'advance-continuation:ended' : 'advance-continuation:next',
      })
      return track
    }
    session.takePrepared()
  }

  // Prefetch buffer: ownership ДО take — иначе кандидат теряется при block.
  const currentId = queue.current()?.id ?? null
  const excludeIds = new Set(
    [
      currentId,
      ...queue.getItems().map((item) => item.id),
    ].filter((id): id is string => Boolean(id)),
  )
  const bufferedPeek = peekBufferedCandidate(excludeIds)
  if (
    bufferedPeek &&
    currentId &&
    isContinuationCandidateAvailable(bufferedPeek, currentId, queue.getItems())
  ) {
    if (!guardLiveInsert('buffer')) {
      return null
    }
    const buffered = takeContinuousBufferedTrack(excludeIds)
    if (
      !buffered ||
      !isContinuationCandidateAvailable(buffered, currentId, queue.getItems())
    ) {
      return null
    }
    noteContinuousSeed(buffered)
    queue.insertNext(buffered)
    const track = queue.next(fromEnded ? { fromEnded: true } : undefined)
    requestContinuousBufferRefill(buffered)
    noteSearchFlowEvent({
      source: 'consumeRecommendationAdvance',
      contextBefore: context.type,
      contextAfter: queue.getPlaybackContext().type,
      queueLengthAfter: queue.getItems().length,
      currentIndex: queue.getSnapshot().currentIndex,
      trackId: track?.id ?? null,
      nextSource: 'continuation',
      detail: fromEnded ? 'advance-buffer:ended' : 'advance-buffer:next',
    })
    return track
  }

  if (repeatMode === 'ALL') {
    return queue.next(fromEnded ? { fromEnded: true } : undefined)
  }

  noteSearchFlowEvent({
    source: 'consumeRecommendationAdvance',
    contextBefore: context.type,
    contextAfter: context.type,
    queueLengthAfter: queue.getItems().length,
    currentIndex: queue.getSnapshot().currentIndex,
    trackId: queue.current()?.id ?? null,
    detail: fromEnded ? 'advance-stop:ended' : 'advance-stop:next',
  })
  return null
}

/**
 * Асинхронный advance: ждёт inflight prepare, при необходимости запускает один новый prepare.
 * Не крутит бесконечный цикл при реальном miss.
 */
export async function resolveRecommendationAdvance(
  queue: PlaybackQueue,
  session: ContinuationSession,
  options: { fromEnded: boolean },
): Promise<Track | null> {
  // Готовый buffer/queue — без ожидания session.flush() / медленного discovery.
  let track = consumeRecommendationAdvance(queue, session, options)
  if (track) {
    return track
  }

  await session.flush()
  track = consumeRecommendationAdvance(queue, session, options)
  if (track) {
    return track
  }

  if (session.isBusy()) {
    await session.flush()
    track = consumeRecommendationAdvance(queue, session, options)
    if (track) {
      return track
    }
  }

  const current = queue.current()
  const context = queue.getPlaybackContext()
  if (!current || !isRecommendationAdvanceContext(context)) {
    return null
  }

  session.prepare(current, syntheticPrepareContext(current, context), { force: true })
  await session.flush()
  track = consumeRecommendationAdvance(queue, session, options)
  if (track) {
    return track
  }

  // Не оставляем AudioPlayer без miss → ложный permanent exhausted.
  if (!peekRecommendationMiss()) {
    noteRecommendationMiss(
      'no-candidates',
      'Пока нет подходящих композиций. Можно повторить подбор.',
    )
    noteContinuousDiag({
      mode: getActiveRecommendationMode() ?? 'swipe',
      phase: 'playback-miss',
      reason: 'advance-empty-no-miss',
      trackId: current.id,
    })
  }
  return null
}

export function prepareRecommendationFollowUp(
  session: ContinuationSession,
  track: Track,
  queueContext: PlaybackContext,
): void {
  if (!isRecommendationAdvanceContext(queueContext)) {
    return
  }
  session.prepare(track, syntheticPrepareContext(track, queueContext))
}

export type { RecommendationMode }
