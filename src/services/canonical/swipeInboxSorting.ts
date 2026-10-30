/**
 * UX-10: Play из папки «Свайпы» → главная (вкладка Свайпы) + единая очередь.
 * Контекст playlist/sys_swipes: UP = queue.next по неразобранным, без Recommendation Engine.
 */
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { clearRecommendationSession } from '../recommendation/sessionRuntime.ts'
import {
  canonicalTracksInCatalog,
  listCanonicalItems,
  preferredTrackFromCanonical,
} from './selectors.ts'

export const SWIPE_INBOX_EMPTY_MESSAGE =
  'Все композиции разобраны. Отмечайте понравившиеся свайпом влево — они появятся здесь.'

export const SWIPE_INBOX_UNAVAILABLE_MESSAGE =
  'Не удалось начать разбор: нет доступной копии для воспроизведения.'

export type StartSwipeInboxSortingInput = {
  startCanonicalTrackId?: string | null
  /** Для тестов: подставить items вместо store. */
  items?: readonly CanonicalLibraryItem[]
  playTrack?: (track: Track) => Promise<void>
  /** Сброс leftover search mode колоды; по умолчанию swipeDeckSessionStore. */
  resetDeckSession?: () => void | Promise<void>
}

/**
 * `played` — очередь inbox принята и play intent запущен (arm/pending).
 * Не ждёт resolve/audible; ошибка источника видна в PlayerStore на главной.
 * `error` — устаревший запуск или сбой до принятия intent (не сеть провайдера).
 */
export type StartSwipeInboxSortingResult =
  | { status: 'played'; tracks: Track[]; startIndex: number }
  | { status: 'empty'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

/** Отмена устаревшего inbox Play после нового пользовательского запуска. */
let inboxPlayGeneration = 0

export function resetSwipeInboxPlayGenerationForTests(): void {
  inboxPlayGeneration = 0
}

export function buildSwipeInboxPlaybackTracks(
  items: readonly CanonicalLibraryItem[],
): { tracks: Track[]; canonicalIds: string[] } {
  const inbox = canonicalTracksInCatalog(listCanonicalItems([...items]), SYS_SWIPES_ID)
  const tracks: Track[] = []
  const canonicalIds: string[] = []
  for (const item of inbox) {
    const track = preferredTrackFromCanonical(item)
    if (!track) {
      continue
    }
    tracks.push(track)
    canonicalIds.push(item.canonicalTrack.id)
  }
  return { tracks, canonicalIds }
}

/**
 * Ставит очередь sys_swipes и запускает выбранный (или первый) трек.
 * Не создаёт второй плеер / очередь. Recommendation session сбрасывается,
 * чтобы UP шёл по неразобранным через PlaybackQueue.next.
 */
export async function startSwipeInboxSorting(
  input: StartSwipeInboxSortingInput = {},
): Promise<StartSwipeInboxSortingResult> {
  const generation = ++inboxPlayGeneration
  try {
    const sourceItems =
      input.items ??
      Object.values(useCanonicalLibraryStore.getState().itemsById)
    const { tracks, canonicalIds } = buildSwipeInboxPlaybackTracks(sourceItems)
    if (tracks.length === 0) {
      return { status: 'empty', message: SWIPE_INBOX_EMPTY_MESSAGE }
    }

    let startIndex = 0
    const preferredId = input.startCanonicalTrackId ?? null
    if (preferredId) {
      const index = canonicalIds.indexOf(preferredId)
      if (index < 0) {
        return { status: 'unavailable', message: SWIPE_INBOX_UNAVAILABLE_MESSAGE }
      }
      startIndex = index
    }

    const startTrack = tracks[startIndex]
    if (!startTrack) {
      return { status: 'unavailable', message: SWIPE_INBOX_UNAVAILABLE_MESSAGE }
    }

    // Очередь — до любых await, чтобы поздний import не гонялся с Wave/Catalog.
    clearRecommendationSession()
    if (generation !== inboxPlayGeneration) {
      return { status: 'error', message: 'Не удалось начать воспроизведение.' }
    }
    getPlaybackQueue().setQueue(tracks, startIndex, {
      type: 'playlist',
      id: SYS_SWIPES_ID,
      title: 'Свайпы',
    })

    try {
      if (input.resetDeckSession) {
        await input.resetDeckSession()
      } else {
        const { useSwipeDeckSessionStore } = await import(
          '../../store/swipeDeckSessionStore.ts'
        )
        useSwipeDeckSessionStore.getState().resetToCatalog()
      }
    } catch {
      // Unit env без browser module graph — очередь уже выставлена.
    }
    if (generation !== inboxPlayGeneration) {
      return { status: 'error', message: 'Не удалось начать воспроизведение.' }
    }

    if (generation !== inboxPlayGeneration) {
      return { status: 'error', message: 'Не удалось начать воспроизведение.' }
    }

    const play =
      input.playTrack ??
      (async (track: Track) => {
        const { getAudioPlayer } = await import('../audioPlayer/AudioPlayer.ts')
        await getAudioPlayer().playTrack(track)
      })

    // Не блокируем navigate ожиданием провайдера/dynamic import.
    // Очередь уже выставлена — Home берёт focus из queueIndex; arm/error — в PlayerStore.
    void Promise.resolve()
      .then(() => play(startTrack))
      .catch(() => undefined)

    return { status: 'played', tracks, startIndex }
  } catch {
    return { status: 'error', message: 'Не удалось начать воспроизведение.' }
  }
}
