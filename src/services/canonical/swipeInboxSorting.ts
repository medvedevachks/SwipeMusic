/**
 * UX-10: Play из папки «Свайпы» → главная (вкладка Свайпы) + единая очередь.
 * Контекст playlist/sys_swipes: UP = queue.next по неразобранным, без Recommendation Engine.
 */
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import { clearRecommendationSession } from '../recommendation/sessionRuntime.ts'
import {
  canonicalTracksInCatalog,
  listCanonicalItems,
  preferredTrackFromCanonical,
} from './selectors.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'

export const SWIPE_INBOX_EMPTY_MESSAGE =
  'Все композиции разобраны. Отмечайте понравившиеся свайпом влево — они появятся здесь.'

export const SWIPE_INBOX_UNAVAILABLE_MESSAGE =
  'Не удалось начать разбор: нет доступной копии для воспроизведения.'

export type StartSwipeInboxSortingInput = {
  startCanonicalTrackId?: string | null
  /** Для тестов: подставить items вместо store. */
  items?: readonly CanonicalLibraryItem[]
  playTrack?: (track: Track) => Promise<void>
}

export type StartSwipeInboxSortingResult =
  | { status: 'played'; tracks: Track[]; startIndex: number }
  | { status: 'empty'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

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

    clearRecommendationSession()
    const queue = getPlaybackQueue()
    queue.setQueue(tracks, startIndex, {
      type: 'playlist',
      id: SYS_SWIPES_ID,
      title: 'Свайпы',
    })

    const startTrack = tracks[startIndex]
    if (!startTrack) {
      return { status: 'unavailable', message: SWIPE_INBOX_UNAVAILABLE_MESSAGE }
    }

    const play =
      input.playTrack ??
      (async (track: Track) => {
        const { getAudioPlayer } = await import('../audioPlayer/AudioPlayer.ts')
        await getAudioPlayer().playTrack(track)
      })
    try {
      await play(startTrack)
    } catch (error) {
      // Autoplay block: очередь уже выставлена — пользователь нажмёт Play в доке.
      if (
        error instanceof Error &&
        (error.name === 'NotAllowedError' ||
          /user did not interact|notallowed|autoplay/i.test(error.message))
      ) {
        return { status: 'played', tracks, startIndex }
      }
      return { status: 'error', message: 'Не удалось начать воспроизведение.' }
    }

    return { status: 'played', tracks, startIndex }
  } catch {
    return { status: 'error', message: 'Не удалось начать воспроизведение.' }
  }
}
