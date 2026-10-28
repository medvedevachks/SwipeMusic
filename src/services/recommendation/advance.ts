import type { PlaybackContext } from '../../types/playbackContext.ts'
import { isSearchSeedContext } from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'
import type { ContinuationSession } from '../continuation/ContinuationSession.ts'
import { noteSearchFlowEvent } from '../continuation/searchFlowDiag.ts'
import { noteSearchPlaybackEvent } from '../continuation/searchPlaybackDebug.ts'
import { isContinuationCandidateAvailable } from '../continuation/types.ts'
import type { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import type { RecommendationMode } from './types.ts'
import { getActiveRecommendationMode } from './sessionState.ts'

/** Контексты, где Next/ended/жест идут через Recommendation Engine. */
export function isRecommendationAdvanceContext(context: PlaybackContext): boolean {
  if (isSearchSeedContext(context)) {
    return true
  }
  const mode = getActiveRecommendationMode()
  if (context.type === 'radio' && context.id === 'my-wave' && mode === 'wave') {
    return true
  }
  if (context.type === 'swipe' && mode === 'swipe') {
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
  await session.flush()
  let track = consumeRecommendationAdvance(queue, session, options)
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
  return consumeRecommendationAdvance(queue, session, options)
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
