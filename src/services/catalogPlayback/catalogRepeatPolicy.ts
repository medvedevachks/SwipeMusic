import type { PlaybackContext } from '../../types/playbackContext.ts'
import {
  getPlaybackQueue,
  type RepeatMode,
} from '../playbackQueue/PlaybackQueue.ts'

type ForcedCatalogRepeat = {
  catalogId: string
  /** Repeat до программного ALL (OFF / ONE / ALL). */
  previous: RepeatMode
  /**
   * true — каталог держит принудительный цикл ALL.
   * false — пользователь явно сменил Repeat; не восстанавливаем и не навязываем ALL снова.
   */
  enforceLoop: boolean
}

let forced: ForcedCatalogRepeat | null = null
let watching = false
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

/**
 * Цикл каталога = Repeat ALL на общей PlaybackQueue.
 * Не трогает shuffle; при уходе с playlist этого каталога восстанавливает previous.
 */
export function applyCatalogLoopRepeat(catalogId: string): void {
  ensureCatalogRepeatPolicyWatcher()
  const queue = getPlaybackQueue()
  if (forced?.catalogId === catalogId && !forced.enforceLoop) {
    // Пользователь уже переопределил Repeat в этой сессии каталога.
    return
  }
  if (!forced || forced.catalogId !== catalogId) {
    forced = {
      catalogId,
      previous: queue.getRepeatMode(),
      enforceLoop: true,
    }
  }
  if (forced.enforceLoop && queue.getRepeatMode() !== 'ALL') {
    withProgrammaticRepeatWrite(() => {
      queue.setRepeatMode('ALL')
    })
  }
}

/**
 * Поздний apply после async-подготовки: только если очередь всё ещё
 * принадлежит этому каталогу и пользователь не переопределил Repeat.
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
 * Отключает принудительный цикл без угадывания по значению.
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
    // Пользователь (или UI) ушёл с программного ALL, пока каталог ещё играет.
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
}
