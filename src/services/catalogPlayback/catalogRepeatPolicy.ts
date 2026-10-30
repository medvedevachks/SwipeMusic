import type { PlaybackContext } from '../../types/playbackContext.ts'
import {
  getPlaybackQueue,
  type RepeatMode,
} from '../playbackQueue/PlaybackQueue.ts'

type ForcedCatalogRepeat = {
  catalogId: string
  previous: RepeatMode
}

let forced: ForcedCatalogRepeat | null = null
let watching = false

/**
 * Цикл каталога = Repeat ALL на общей PlaybackQueue.
 * Не трогает shuffle; при уходе с playlist этого каталога снимает принудительный ALL.
 */
export function applyCatalogLoopRepeat(catalogId: string): void {
  ensureCatalogRepeatPolicyWatcher()
  const queue = getPlaybackQueue()
  if (!forced || forced.catalogId !== catalogId) {
    forced = {
      catalogId,
      previous: queue.getRepeatMode(),
    }
  }
  if (queue.getRepeatMode() !== 'ALL') {
    queue.setRepeatMode('ALL')
  }
}

/**
 * Поздний apply после async-подготовки: только если очередь всё ещё
 * принадлежит этому каталогу (не search / wave / другой playlist).
 */
export function applyCatalogLoopRepeatIfOwned(catalogId: string): boolean {
  const context = getPlaybackQueue().getPlaybackContext()
  if (context.type !== 'playlist' || context.id !== catalogId) {
    return false
  }
  applyCatalogLoopRepeat(catalogId)
  return true
}

export function syncCatalogRepeatPolicy(context: PlaybackContext): void {
  if (!forced) {
    return
  }
  if (context.type === 'playlist' && context.id === forced.catalogId) {
    return
  }
  const queue = getPlaybackQueue()
  const previous = forced.previous
  forced = null
  // Пользователь мог сменить Repeat вручную — не перетираем чужой режим.
  if (queue.getRepeatMode() === 'ALL') {
    queue.setRepeatMode(previous === 'ALL' ? 'OFF' : previous)
  }
}

export function ensureCatalogRepeatPolicyWatcher(): void {
  if (watching) {
    return
  }
  watching = true
  getPlaybackQueue().subscribe((snapshot) => {
    syncCatalogRepeatPolicy(snapshot.context)
  })
}

/** Сброс для unit-тестов. */
export function resetCatalogRepeatPolicyForTests(): void {
  forced = null
}
