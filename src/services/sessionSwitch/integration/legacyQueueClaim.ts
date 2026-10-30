/**
 * Совместимость session-switch ↔ legacy PlaybackIntent (SWIPES/WAVE).
 *
 * Перед мутацией live-очереди legacy intent освобождает активную
 * мигрированную сессию (catalog | search | album): flush durable + active=null.
 */
import type { PlaybackSessionId } from '../../playbackSession/types.ts'
import { isSessionSwitchIntegrationEnabled } from '../featureFlag.ts'
import {
  bumpFlushRevision,
  flushActiveSessionToStore,
} from './flushActiveSession.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export type LegacyIntentKind =
  | 'search'
  | 'swipe'
  | 'wave'
  | 'album'
  | 'library'
  | 'other'

const MIGRATED_SESSIONS: ReadonlySet<PlaybackSessionId> = new Set([
  'catalog',
  'search',
  'album',
])

/**
 * Если активна мигрированная сессия — сохранить durable-снимок и отдать live queue legacy.
 * No-op при flag OFF / нет runtime / active не catalog|search|album.
 */
export function releaseCatalogSessionForLegacyIntent(
  _kind: LegacyIntentKind = 'other',
): {
  released: boolean
  savedCatalog: boolean
  savedSessionId: PlaybackSessionId | null
} {
  if (!isSessionSwitchIntegrationEnabled()) {
    return { released: false, savedCatalog: false, savedSessionId: null }
  }
  const runtime = getSessionSwitchAppRuntime()
  if (!runtime) {
    return { released: false, savedCatalog: false, savedSessionId: null }
  }
  const active = runtime.store.getActiveSessionId()
  if (!active || !MIGRATED_SESSIONS.has(active)) {
    return { released: false, savedCatalog: false, savedSessionId: null }
  }

  runtime.coordinator.invalidatePending('user_rebind')
  bumpFlushRevision()
  const flushed = flushActiveSessionToStore({
    reason: 'release',
    sessionId: active,
    clearActiveAfter: true,
    playing: false,
  })

  return {
    released: true,
    savedCatalog: flushed.flushed && active === 'catalog',
    savedSessionId: flushed.flushed ? active : null,
  }
}

/** Alias: освободить любую мигрированную active-сессию для legacy SWIPES/WAVE. */
export const releaseActiveSessionForLegacyIntent =
  releaseCatalogSessionForLegacyIntent
