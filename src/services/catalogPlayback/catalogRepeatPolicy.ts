import type { PlaybackContext } from '../../types/playbackContext.ts'
import {
  getPlaybackQueue,
  type RepeatMode,
} from '../playbackQueue/PlaybackQueue.ts'

type ForcedCatalogRepeat = {
  catalogId: string
  /** Repeat на момент явного старта сессии (OFF / ONE / ALL). */
  previous: RepeatMode
  /**
   * true — эта сессия держит принудительный цикл ALL.
   * false — пользователь явно сменил Repeat в этой сессии.
   */
  enforceLoop: boolean
  /** Отличает новую сессию Play от late expand старой. */
  sessionId: number
}

let forced: ForcedCatalogRepeat | null = null
let watching = false
let sessionSeq = 0
/** Игнорировать смену Repeat, вызванную apply/sync политики. */
let suppressUserRepeatNote = false

function withProgrammaticRepeatWrite(write: () => void): void {
  suppressUserRepeatNote = true
  try {
    write()
  } finally {
    suppressUserRepeatNote = false
  }
}

function writeLoopAll(): void {
  const queue = getPlaybackQueue()
  if (queue.getRepeatMode() === 'ALL') {
    return
  }
  withProgrammaticRepeatWrite(() => {
    queue.setRepeatMode('ALL')
  })
}

/**
 * Явный новый запуск каталога (ранний Play).
 * Всегда открывает новую сессию: снова включает ALL даже после ручного
 * ONE/OFF в предыдущей сессии того же catalogId.
 */
export function beginCatalogLoopSession(catalogId: string): void {
  ensureCatalogRepeatPolicyWatcher()
  const queue = getPlaybackQueue()
  forced = {
    catalogId,
    previous: queue.getRepeatMode(),
    enforceLoop: true,
    sessionId: ++sessionSeq,
  }
  writeLoopAll()
}

/**
 * Поддержание цикла внутри уже открытой сессии (без сброса user override).
 * Для нового Play используйте beginCatalogLoopSession.
 */
export function applyCatalogLoopRepeat(catalogId: string): void {
  ensureCatalogRepeatPolicyWatcher()
  if (forced?.catalogId === catalogId && !forced.enforceLoop) {
    return
  }
  const queue = getPlaybackQueue()
  if (!forced || forced.catalogId !== catalogId) {
    forced = {
      catalogId,
      previous: queue.getRepeatMode(),
      enforceLoop: true,
      sessionId: ++sessionSeq,
    }
  }
  if (forced.enforceLoop) {
    writeLoopAll()
  }
}

/**
 * Поздний apply после async-подготовки той же сессии:
 * только при том же playlist-владельце и если пользователь не сменил Repeat.
 */
export function applyCatalogLoopRepeatIfOwned(catalogId: string): boolean {
  if (forced?.catalogId === catalogId && !forced.enforceLoop) {
    return false
  }
  const context = getPlaybackQueue().getPlaybackContext()
  if (context.type !== 'playlist' || context.id !== catalogId) {
    return false
  }
  applyCatalogLoopRepeat(catalogId)
  return forced?.enforceLoop === true
}

/**
 * Явная пользовательская смена Repeat (BottomPlayer / Queue).
 * Отключает принудительный цикл текущей сессии.
 */
export function noteUserRepeatModeChange(mode: RepeatMode): void {
  void mode
  if (suppressUserRepeatNote || !forced) {
    return
  }
  forced = { ...forced, enforceLoop: false }
}

export function syncCatalogRepeatPolicy(context: PlaybackContext): void {
  if (!forced) {
    return
  }
  if (context.type === 'playlist' && context.id === forced.catalogId) {
    return
  }
  const previous = forced.previous
  const shouldRestore = forced.enforceLoop
  forced = null
  if (!shouldRestore) {
    return
  }
  const queue = getPlaybackQueue()
  withProgrammaticRepeatWrite(() => {
    queue.setRepeatMode(previous)
  })
}

export function ensureCatalogRepeatPolicyWatcher(): void {
  if (watching) {
    return
  }
  watching = true
  getPlaybackQueue().subscribe((snapshot) => {
    if (
      forced?.enforceLoop &&
      !suppressUserRepeatNote &&
      snapshot.repeatMode !== 'ALL'
    ) {
      forced = { ...forced, enforceLoop: false }
    }
    syncCatalogRepeatPolicy(snapshot.context)
  })
}

/** Сброс для unit-тестов. */
export function resetCatalogRepeatPolicyForTests(): void {
  forced = null
  suppressUserRepeatNote = false
  sessionSeq = 0
}
