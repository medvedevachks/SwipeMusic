/**
 * HOME-CARD-SYNC: колода Home vs рекомендательное воспроизведение.
 * Browse feed (поиск/каталог) ≠ активная карточка сессии плеера.
 */
import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { PlaybackContext } from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { isSearchFlowHarnessEnabled } from '../continuation/searchFlowHarnessFlag.ts'

export type HomeDeckStage = 'sorting' | 'wave'
export type HomeDeckSource = 'browse' | 'playback'

export type HomeDeckResolution = {
  tracks: Track[]
  source: HomeDeckSource
  syncWithPlayer: boolean
  /** Колода следует жесту Next за пределы последнего индекса (recommendation advance). */
  advanceAtEnd: boolean
  emptyReason: 'none' | 'browse-empty' | 'playback-empty' | 'playback-exhausted'
}

function acceptTrack(track: Track): boolean {
  return isSearchFlowHarnessEnabled() || !isDemoSourceId(track.sourceId)
}

/**
 * Когда карточка берётся из реального плеера / очереди, а не из ленты выбора.
 */
export function isRecommendationHomeDeckContext(input: {
  stage: HomeDeckStage
  sessionMode: 'catalog' | 'search'
  context: PlaybackContext
}): boolean {
  const { stage, sessionMode, context } = input
  // Поиск без seed: пользователь выбирает hit — лента выдачи.
  if (sessionMode === 'search' && context.type !== 'search-seed') {
    return false
  }
  if (stage === 'sorting' && context.type === 'search-seed') {
    return true
  }
  if (stage === 'sorting' && context.type === 'swipe' && sessionMode === 'catalog') {
    return true
  }
  // Разбор папки «Свайпы»: колода = очередь inbox, sync с плеером.
  if (
    stage === 'sorting' &&
    context.type === 'playlist' &&
    context.id === SYS_SWIPES_ID
  ) {
    return true
  }
  if (
    stage === 'wave' &&
    context.type === 'radio' &&
    context.id === 'my-wave'
  ) {
    return true
  }
  return false
}

/**
 * Собирает треки колоды для playback-режима: очередь + focus, без search dump.
 */
export function buildPlaybackDeckTracks(input: {
  queue: readonly Track[]
  currentTrack: Track | null
  pendingTrack: Track | null
  queueIndex: number
}): Track[] {
  const seen = new Set<string>()
  const out: Track[] = []
  const push = (track: Track | null | undefined) => {
    if (!track || !acceptTrack(track) || seen.has(track.id)) {
      return
    }
    seen.add(track.id)
    out.push(track)
  }

  for (const track of input.queue) {
    push(track)
  }

  const index =
    input.queueIndex >= 0 && input.queueIndex < input.queue.length
      ? input.queueIndex
      : -1
  const queuedCurrent = index >= 0 ? input.queue[index] : null
  // Focus: pending (загрузка) важнее audible current; иначе текущий из очереди.
  push(input.pendingTrack)
  push(input.currentTrack)
  push(queuedCurrent)

  return out
}

/**
 * Разделяет browse-ленту и активную рекомендательную карточку.
 * Не пишет рекомендации в search results и не подменяет PlaybackQueue.
 */
export function resolveHomeDeckTracks(input: {
  stage: HomeDeckStage
  sessionMode: 'catalog' | 'search'
  browseFeed: readonly Track[]
  queue: readonly Track[]
  queueIndex: number
  currentTrack: Track | null
  pendingTrack: Track | null
  context: PlaybackContext
  /** Сессия исчерпана: не откатываться к browse hits. */
  recommendationExhausted?: boolean
}): HomeDeckResolution {
  if (isRecommendationHomeDeckContext(input)) {
    const tracks = buildPlaybackDeckTracks({
      queue: input.queue,
      currentTrack: input.currentTrack,
      pendingTrack: input.pendingTrack,
      queueIndex: input.queueIndex,
    })
    if (tracks.length === 0) {
      return {
        tracks: [],
        source: 'playback',
        syncWithPlayer: true,
        advanceAtEnd: false,
        emptyReason: 'playback-empty',
      }
    }
    const exhausted = Boolean(input.recommendationExhausted)
    return {
      // При exhausted показываем только focus (последняя рекомендация), не всю историю как «ленту поиска».
      tracks: exhausted
        ? (() => {
            const focusId =
              input.pendingTrack?.id ??
              input.currentTrack?.id ??
              input.queue[input.queueIndex]?.id ??
              tracks[tracks.length - 1]?.id
            const focus = tracks.find((track) => track.id === focusId) ?? tracks[tracks.length - 1]!
            return [focus]
          })()
        : tracks,
      source: 'playback',
      syncWithPlayer: true,
      advanceAtEnd: !exhausted,
      emptyReason: exhausted ? 'playback-exhausted' : 'none',
    }
  }

  const browse = input.browseFeed.filter(acceptTrack)
  return {
    tracks: browse,
    source: 'browse',
    // Album/playlist/library на sorting: не тащим каталог за чужим плеером.
    syncWithPlayer:
      input.context.type === 'swipe' || input.context.type === 'none',
    advanceAtEnd: false,
    emptyReason: browse.length === 0 ? 'browse-empty' : 'none',
  }
}

/** Focus id для sync колоды: pending → current → queue[index]. */
export function resolveHomeDeckFocusId(input: {
  pendingTrack: Track | null
  currentTrack: Track | null
  queue: readonly Track[]
  queueIndex: number
  deckSource: HomeDeckSource
}): string | null {
  if (input.pendingTrack) {
    return input.pendingTrack.id
  }
  if (input.currentTrack) {
    return input.currentTrack.id
  }
  if (input.deckSource === 'playback') {
    const at = input.queue[input.queueIndex]
    if (at) {
      return at.id
    }
    return input.queue[0]?.id ?? null
  }
  return null
}
