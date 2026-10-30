/**
 * Auth lifecycle ↔ PlaybackSessionStore (PLAYBACK-DEV-06).
 * Только при feature flag ON. Идемпотентно для того же userId+deviceId.
 *
 * Тяжёлые AudioPlayer/Resolver — dynamic import внутри bind (authStore не
 * тянет их статически в node:test).
 */
import {
  createPlaybackSessionStore,
  type PlaybackSessionStore,
} from '../../playbackSession/PlaybackSessionStore.ts'
import { getOrCreateStableDeviceId } from '../../playbackSession/deviceId.ts'
import {
  createPlaybackSessionPersistence,
  type PlaybackSessionPersistence,
} from '../../playbackSession/persistence.ts'
import type { PlaybackSessionId } from '../../playbackSession/types.ts'
import { createSessionSwitchCoordinator } from '../SessionSwitchCoordinator.ts'
import { isSessionSwitchIntegrationEnabled } from '../featureFlag.ts'
import { wrapQueuePort } from '../liveQueuePort.ts'
import {
  bumpSessionSwitchBootstrapGeneration,
  getSessionSwitchAppRuntime,
  getSessionSwitchBootstrapGeneration,
  resetSessionSwitchAppRuntimeForTests,
  setSessionSwitchAppRuntime,
  type SessionSwitchAppRuntime,
} from './sessionSwitchAppRuntime.ts'

export type BindPlaybackSessionsResult = {
  bound: boolean
  skipped: boolean
  reason?: 'flag_off' | 'same_user' | 'no_storage' | 'ok' | 'load_failed'
  userId: string | null
  deviceId: string | null
  audioAutoplay: false
}

export type TeardownPlaybackSessionsOptions = {
  preserveFlagCheck?: boolean
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null
    }
    return localStorage
  } catch {
    return null
  }
}

function buildPersistPort(runtime: {
  store: PlaybackSessionStore
  persistence: PlaybackSessionPersistence
}) {
  return {
    writesLegacyV1: false as const,
    persistAfterCommit(input: {
      userId: string
      deviceId: string
      activeSessionId: PlaybackSessionId
      sourceSessionId: PlaybackSessionId | null
    }) {
      try {
        runtime.persistence.saveSlot(
          input.userId,
          input.deviceId,
          runtime.store.getSlot(input.activeSessionId),
        )
        if (input.sourceSessionId) {
          runtime.persistence.saveSlot(
            input.userId,
            input.deviceId,
            runtime.store.getSlot(input.sourceSessionId),
          )
        }
        runtime.persistence.saveMeta(input.userId, input.deviceId, {
          activeSessionId: runtime.store.getActiveSessionId(),
          switchEpoch: runtime.store.getSwitchEpoch(),
          playRequestId: runtime.store.getPlayRequestId(),
        })
      } catch {
        // best-effort
      }
    },
  }
}

/**
 * После login / register / restore: SessionStore + handoff queue + runtime.
 * Не запускает autoplay. Не импортирует legacy v1 в session slots.
 */
export async function bindPlaybackSessionsForAuth(
  userId: string,
): Promise<BindPlaybackSessionsResult> {
  if (!isSessionSwitchIntegrationEnabled()) {
    return {
      bound: false,
      skipped: true,
      reason: 'flag_off',
      userId,
      deviceId: null,
      audioAutoplay: false,
    }
  }

  const storage = getLocalStorage()
  if (!storage) {
    return {
      bound: false,
      skipped: true,
      reason: 'no_storage',
      userId,
      deviceId: null,
      audioAutoplay: false,
    }
  }

  const deviceId = getOrCreateStableDeviceId(storage)
  const existing = getSessionSwitchAppRuntime()
  if (
    existing &&
    existing.userId === userId &&
    existing.deviceId === deviceId
  ) {
    return {
      bound: true,
      skipped: true,
      reason: 'same_user',
      userId,
      deviceId,
      audioAutoplay: false,
    }
  }

  const previousUserId = existing?.userId ?? null
  if (existing) {
    await teardownPlaybackSessionsForAuth({ preserveFlagCheck: true })
  }

  const gen = bumpSessionSwitchBootstrapGeneration()

  try {
    const [
      { getAudioPlayer },
      { getPlaybackQueue },
      { handoffLiveQueueAfterAuth },
      { createSessionSwitchRuntime },
      { createAudioPlayerResolveFn },
    ] = await Promise.all([
      import('../../audioPlayer/AudioPlayer.ts'),
      import('../../playbackQueue/PlaybackQueue.ts'),
      import('./bootstrapSessionPlayback.ts'),
      import('./createSessionSwitchRuntime.ts'),
      import('./productionResolve.ts'),
    ])

    const persistence = createPlaybackSessionPersistence({ storage })
    persistence.refuseLegacyImport()

    const store = createPlaybackSessionStore({ userId, deviceId })
    const load = persistence.load(userId, deviceId)
    store.hydrateFromLoadResult(load)

    const player = getAudioPlayer()
    const queue = getPlaybackQueue()
    const hydratedActive = store.getActiveSessionId()

    handoffLiveQueueAfterAuth({
      userId,
      deviceId,
      previousUserId,
      liveQueue: queue,
      player,
    })

    // Пока не восстановили — не держим active на пустой/чужой live queue.
    store.setActiveSessionId(null)

    const resolve = createAudioPlayerResolveFn(player)
    const baseRuntime = createSessionSwitchRuntime({
      store,
      liveQueue: queue,
      resolve,
      audioPlayer: player,
      forceEnable: true,
    })
    if (!baseRuntime) {
      return {
        bound: false,
        skipped: true,
        reason: 'flag_off',
        userId,
        deviceId,
        audioAutoplay: false,
      }
    }

    const coordinator = createSessionSwitchCoordinator({
      store,
      queue: wrapQueuePort(queue),
      player: baseRuntime.player,
      prepare: baseRuntime.prepare,
      persist: buildPersistPort({ store, persistence }),
    })

    if (gen !== getSessionSwitchBootstrapGeneration()) {
      return {
        bound: false,
        skipped: true,
        reason: 'ok',
        userId,
        deviceId,
        audioAutoplay: false,
      }
    }

    const appRuntime: SessionSwitchAppRuntime = {
      ...baseRuntime,
      coordinator,
      store,
      persistence,
      userId,
      deviceId,
      bootstrapGeneration: gen,
    }
    setSessionSwitchAppRuntime(appRuntime)

    const { restoreActiveSessionWithoutAutoplay } = await import(
      './restoreActiveSession.ts'
    )
    restoreActiveSessionWithoutAutoplay({
      store,
      queue,
      player,
      hydratedActiveSessionId: hydratedActive,
    })

    const { startActiveSessionDurableSync } = await import(
      './activeSessionDurableSync.ts'
    )
    startActiveSessionDurableSync({ queue, player })

    return {
      bound: true,
      skipped: false,
      reason: 'ok',
      userId,
      deviceId,
      audioAutoplay: false,
    }
  } catch {
    return {
      bound: false,
      skipped: true,
      reason: 'load_failed',
      userId,
      deviceId,
      audioAutoplay: false,
    }
  }
}

/**
 * Logout / anonymous: отменить pending, очистить queue + player identity.
 */
export async function teardownPlaybackSessionsForAuth(
  options: TeardownPlaybackSessionsOptions = {},
): Promise<void> {
  if (!options.preserveFlagCheck && !isSessionSwitchIntegrationEnabled()) {
    if (!getSessionSwitchAppRuntime()) {
      return
    }
  }

  bumpSessionSwitchBootstrapGeneration()
  const runtime = getSessionSwitchAppRuntime()

  try {
    const { stopActiveSessionDurableSync } = await import(
      './activeSessionDurableSync.ts'
    )
    stopActiveSessionDurableSync()
  } catch {
    // partial graph
  }

  try {
    const { clearCmeSessionOwnership } = await import(
      './cmeSessionOwnership.ts'
    )
    clearCmeSessionOwnership()
  } catch {
    // partial graph
  }

  if (runtime) {
    runtime.coordinator.invalidatePending('logout')
    runtime.store.clearForLogout()
  }

  try {
    const [
      { getAudioPlayer },
      { getPlaybackQueue },
      { teardownLiveQueueOnLogout },
    ] = await Promise.all([
      import('../../audioPlayer/AudioPlayer.ts'),
      import('../../playbackQueue/PlaybackQueue.ts'),
      import('./bootstrapSessionPlayback.ts'),
    ])
    teardownLiveQueueOnLogout(getPlaybackQueue(), getAudioPlayer())
  } catch {
    // node:test / partial graph
  }

  setSessionSwitchAppRuntime(null)
}

/** Тесты. */
export function resetPlaybackSessionBootstrapForTests(): void {
  resetSessionSwitchAppRuntimeForTests()
}
