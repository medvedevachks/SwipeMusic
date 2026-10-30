/**
 * Фабрика runtime SessionSwitch при включённом feature flag.
 * По умолчанию flag OFF → null (production PlaybackIntent без изменений).
 */
import type { PlaybackQueue } from '../../playbackQueue/PlaybackQueue.ts'
import { getPlaybackQueue } from '../../playbackQueue/PlaybackQueue.ts'
import type { PlaybackSessionStore } from '../../playbackSession/PlaybackSessionStore.ts'
import { isSessionSwitchIntegrationEnabled } from '../featureFlag.ts'
import {
  createSessionSwitchCoordinator,
  type SessionSwitchCoordinator,
} from '../SessionSwitchCoordinator.ts'
import { wrapQueuePort } from '../liveQueuePort.ts'
import type { PhysicalPlayerPort, TrackPreparePort } from '../ports.ts'
import { PreparedTrackCache } from './preparedTrackCache.ts'
import {
  createResolverTrackPreparePort,
  type ResolvePlaybackFn,
} from './ResolverTrackPreparePort.ts'
import {
  createAdapterPhysicalPort,
  createAudioPlayerPhysicalPort,
  type AdapterPhysicalPort,
  type AudioPlayerSessionApi,
} from './createPhysicalPlayerPort.ts'
import type { PlayerAdapter } from '../../audioPlayer/PlayerAdapter.ts'

export type SessionSwitchRuntime = {
  coordinator: SessionSwitchCoordinator
  cache: PreparedTrackCache
  prepare: TrackPreparePort
  player: PhysicalPlayerPort
  queue: PlaybackQueue
}

export type CreateSessionSwitchRuntimeOptions = {
  store: PlaybackSessionStore
  /** По умолчанию getPlaybackQueue() — запрещено подставлять второй live instance. */
  liveQueue?: PlaybackQueue
  resolve: ResolvePlaybackFn
  /**
   * Production: AudioPlayer session API.
   * Тесты: либо audioPlayer, либо adapter (не оба обязательны).
   */
  audioPlayer?: AudioPlayerSessionApi
  /** Тестовый / контролируемый адаптер, если audioPlayer не передан. */
  adapter?: PlayerAdapter
  /** Игнорировать feature flag (только тесты). */
  forceEnable?: boolean
}

/**
 * Создать runtime. Возвращает null если flag выключен (и forceEnable не задан).
 * Не создаёт второй PlaybackQueue / AudioPlayer singleton.
 */
export function createSessionSwitchRuntime(
  options: CreateSessionSwitchRuntimeOptions,
): SessionSwitchRuntime | null {
  if (!options.forceEnable && !isSessionSwitchIntegrationEnabled()) {
    return null
  }

  const queue = options.liveQueue ?? getPlaybackQueue()
  const cache = new PreparedTrackCache()
  const prepare = createResolverTrackPreparePort({
    cache,
    resolve: options.resolve,
  })

  let player: PhysicalPlayerPort
  let adapterPort: AdapterPhysicalPort | null = null

  if (options.audioPlayer) {
    player = createAudioPlayerPhysicalPort(options.audioPlayer, cache)
  } else if (options.adapter) {
    adapterPort = createAdapterPhysicalPort({
      adapter: options.adapter,
      cache,
      resolveTrackById: (id) => {
        const item = queue.getItems().find((t) => t.id === id)
        return item ?? null
      },
    })
    player = adapterPort
  } else {
    throw new Error(
      'createSessionSwitchRuntime: audioPlayer or adapter required',
    )
  }

  const coordinator = createSessionSwitchCoordinator({
    store: options.store,
    queue: wrapQueuePort(queue),
    player,
    prepare,
  })

  return {
    coordinator,
    cache,
    prepare,
    player,
    queue,
  }
}
