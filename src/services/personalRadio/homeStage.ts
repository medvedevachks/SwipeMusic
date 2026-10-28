import { isSearchFlowHarnessEnabled } from '../continuation/searchFlowHarnessFlag.ts'
import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { Track } from '../../types/track.ts'

export type HomeStage = 'sorting' | 'wave'

export type CardPlaybackPlan = 'pause' | 'resume' | 'play-swipe' | 'play-radio'

export type CardPlayCommand = CardPlaybackPlan | 'build-wave' | 'ignore'

export type CardPlayIntent = 'toggle' | 'advance'

export function homeCardTracks(input: {
  stage: HomeStage
  feed: readonly Track[]
  radioQueue: readonly Track[]
  radioActive: boolean
}): Track[] {
  const keepDemo = isSearchFlowHarnessEnabled()
  const accept = (track: Track) => keepDemo || !isDemoSourceId(track.sourceId)
  if (input.stage === 'wave' && input.radioActive) {
    return input.radioQueue.filter(accept)
  }
  return input.feed.filter(accept)
}

export function cardPlaybackPlan(input: {
  stage: HomeStage
  cardId: string | null
  playerId: string | null
  playing: boolean
}): CardPlaybackPlan {
  if (input.cardId && input.playerId && input.cardId === input.playerId) {
    return input.playing ? 'pause' : 'resume'
  }
  if (input.stage === 'wave') {
    return 'play-radio'
  }
  return 'play-swipe'
}

/**
 * Контракт кнопки карточки и смены трека жестом.
 * Сравнение только с зафиксированным currentTrack: pending чужого трека не считается «этой» песней.
 * Повторный Play той же карточки, пока она уже грузится, не запускает второй запрос.
 */
export function resolveCardPlay(input: {
  stage: HomeStage
  intent?: CardPlayIntent
  cardId: string | null
  currentId: string | null
  pendingId: string | null
  playing: boolean
  radioReady: boolean
}): CardPlayCommand {
  const intent = input.intent ?? 'toggle'
  if (intent === 'advance') {
    if (input.stage === 'wave') {
      return input.radioReady ? 'play-radio' : 'ignore'
    }
    return 'play-swipe'
  }
  if (!input.cardId) {
    return input.stage === 'wave' && !input.radioReady ? 'build-wave' : 'ignore'
  }
  if (input.pendingId === input.cardId) {
    return 'ignore'
  }
  if (input.currentId === input.cardId) {
    return input.playing ? 'pause' : 'resume'
  }
  if (input.stage === 'wave' && !input.radioReady) {
    return 'build-wave'
  }
  if (input.stage === 'wave') {
    return 'play-radio'
  }
  return 'play-swipe'
}

export type CardPlayDeps = {
  pause: () => void
  resume: () => Promise<void>
  playSwipe: () => Promise<void>
  playRadio: () => Promise<void>
  buildWave: () => Promise<void>
}

export type CardPlayResult = 'paused' | 'resumed' | 'played' | 'built' | 'ignored' | 'failed'

let cardPlayLockId: string | null = null

/**
 * Один запуск на карточку. Ошибка проигрывания не вызывает resume предыдущей очереди.
 */
export async function runCardPlay(
  input: Parameters<typeof resolveCardPlay>[0],
  deps: CardPlayDeps,
): Promise<CardPlayResult> {
  const command = resolveCardPlay(input)
  if (command === 'ignore') {
    return 'ignored'
  }
  if (command === 'pause') {
    deps.pause()
    return 'paused'
  }
  if (command === 'resume') {
    try {
      await deps.resume()
      return 'resumed'
    } catch {
      return 'failed'
    }
  }
  const lockId = input.cardId ?? `${input.stage}:build`
  if (cardPlayLockId === lockId) {
    return 'ignored'
  }
  cardPlayLockId = lockId
  try {
    if (command === 'build-wave') {
      await deps.buildWave()
      return 'built'
    }
    if (command === 'play-radio') {
      await deps.playRadio()
      return 'played'
    }
    await deps.playSwipe()
    return 'played'
  } catch {
    return 'failed'
  } finally {
    if (cardPlayLockId === lockId) {
      cardPlayLockId = null
    }
  }
}

/** Жест колоды в радио не подменяет очередь лентой сортировки. */
export function deckKeepsRadioQueue(stage: HomeStage, radioActive: boolean): boolean {
  return stage === 'wave' && radioActive
}

/** Что показать в режиме волны, пока очередь радио не готова. */
export type WaveHomeView = 'deck' | 'needs-likes' | 'needs-source' | 'start'

export function waveHomeView(input: {
  radioActive: boolean
  radioQueueLength: number
  likedCount: number
  hasRealSource: boolean
}): WaveHomeView {
  if (input.radioActive && input.radioQueueLength > 0) {
    return 'deck'
  }
  if (input.likedCount === 0) {
    return 'needs-likes'
  }
  if (!input.hasRealSource) {
    return 'needs-source'
  }
  return 'start'
}
