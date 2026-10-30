/**
 * Совместимость CATALOG (session-switch) ↔ legacy PlaybackIntent (DEV-06).
 *
 * Пока SEARCH/WAVE/SWIPES/ALBUM на legacy: перед мутацией live-очереди
 * legacy intent обязан «освободить» CATALOG-сессию — сохранить слот и
 * снять activeSessionId. Иначе setQueue незаметно испортит session state.
 */
import { isSessionSwitchIntegrationEnabled } from '../featureFlag.ts'
import { playbackExportToSessionQueue } from '../queueSnapshotBridge.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export type LegacyIntentKind =
  | 'search'
  | 'swipe'
  | 'wave'
  | 'album'
  | 'library'
  | 'other'

/**
 * Если активна CATALOG-сессия — сохранить durable-снимок и отдать live queue legacy.
 * No-op при flag OFF / нет runtime / active !== catalog.
 */
export function releaseCatalogSessionForLegacyIntent(
  _kind: LegacyIntentKind = 'other',
): {
  released: boolean
  savedCatalog: boolean
} {
  if (!isSessionSwitchIntegrationEnabled()) {
    return { released: false, savedCatalog: false }
  }
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime) {
    return { released: false, savedCatalog: false }
  }
  if (runtime.store.getActiveSessionId() !== 'catalog') {
    return { released: false, savedCatalog: false }
  }

  runtime.coordinator.invalidatePending('user_rebind')

  let savedCatalog = false
  const userId = runtime.store.getUserId()
  try {
    const queue = runtime.queue
    const positionSeconds = runtime.player.getPositionSeconds()
    const playingTrackId = runtime.player.getCurrentTrackId()
    const exported = queue.exportSessionState()
    const pending = queue.getPendingRemovalIds()
    const snap = playbackExportToSessionQueue(exported, {
      positionSeconds,
      playingTrackId,
      pendingRemovalIds: pending,
      phase: 'user_paused',
      updatedAt: new Date().toISOString(),
    })
    const prevMeta = runtime.store.getSlot('catalog').meta
    runtime.store.replaceSlot('catalog', {
      meta:
        prevMeta.kind === 'catalog'
          ? prevMeta
          : { kind: 'catalog', catalogId: null, title: null },
      queue: snap,
    })
    if (userId) {
      try {
        runtime.persistence.saveSlot(
          userId,
          runtime.deviceId,
          runtime.store.getSlot('catalog'),
        )
        runtime.persistence.saveMeta(userId, runtime.deviceId, {
          activeSessionId: null,
          switchEpoch: runtime.store.getSwitchEpoch(),
          playRequestId: runtime.store.getPlayRequestId(),
        })
      } catch {
        // best-effort persist
      }
    }
    savedCatalog = true
  } catch {
    savedCatalog = false
  }

  runtime.store.setActiveSessionId(null)
  return { released: true, savedCatalog }
}
