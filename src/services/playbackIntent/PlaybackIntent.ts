import type { Track } from '../../types/track'
import {
  isQueueLockedContext,
  type PlaybackContext,
} from '../../types/playbackContext'
import { commitSearchSeedQueue, getContinuationSession } from '../continuation/index.ts'
import { noteSearchFlowEvent } from '../continuation/searchFlowDiag.ts'
import { ensureSearchRecommendation } from '../continuation/searchContinuationRuntime.ts'
import { getAudioPlayer } from '../audioPlayer'
import { getPlaybackQueue } from '../playbackQueue'
import type {
  ExitAlbumModeInput,
  PlayAlbumInput,
  PlayFromLibraryInput,
  PlayFromQueueInput,
  PlayFromSwipeInput,
  PlayRadioInput,
  PlaySearchTrackInput,
} from './types'

function clampIndex(length: number, startIndex: number): number {
  if (length <= 0) {
    return -1
  }
  return Math.min(Math.max(0, startIndex), length - 1)
}

/**
 * Тонкий оркестратор: queue + context + play.
 * Не хранит собственный state — только PlaybackQueue / AudioPlayer.
 */
export class PlaybackIntent {
  async playAlbum(input: PlayAlbumInput): Promise<void> {
    const { tracks, album } = input
    const startIndex = clampIndex(tracks.length, input.startIndex)
    if (startIndex < 0) {
      return
    }

    const track = tracks[startIndex]!
    const player = getAudioPlayer()
    player.setQueue(tracks, startIndex, {
      type: 'album',
      id: album.id,
      title: album.title,
      ...(album.artist ? { artist: album.artist } : {}),
    })
    await player.playTrack(track)
  }

  /**
   * Swipe deck → queue + play.
   * Без explicitUserPlay: album/playlist lock → no-op (gesture/auto не перехватывают).
   * С explicitUserPlay: разрешена смена locked context на swipe.
   */
  async playFromSwipe(input: PlayFromSwipeInput): Promise<void> {
    if (
      !input.explicitUserPlay &&
      isQueueLockedContext(getPlaybackQueue().getPlaybackContext())
    ) {
      return
    }

    const { tracks } = input
    const startIndex = clampIndex(tracks.length, input.startIndex)
    if (startIndex < 0) {
      return
    }

    const track = tracks[startIndex]!
    const player = getAudioPlayer()
    const before = getPlaybackQueue().getSnapshot()
    noteSearchFlowEvent({
      source: 'PlaybackIntent.playFromSwipe',
      contextBefore: before.context.type,
      queueLengthBefore: before.items.length,
      currentIndex: before.currentIndex,
      trackId: track.id,
      nextSource: 'search-result',
      detail: `explicit=${Boolean(input.explicitUserPlay)};list=${tracks.length}`,
    })
    player.setQueue(tracks, startIndex, { type: 'swipe' })

    if (
      !input.explicitUserPlay &&
      player.getState().currentTrack?.id === track.id
    ) {
      return
    }

    // Явный Play: всегда playTrack (resume/switch), даже если id совпал.
    await player.playTrack(track)
  }

  async playFromLibrary(input: PlayFromLibraryInput): Promise<void> {
    const { tracks } = input
    const startIndex = clampIndex(tracks.length, input.startIndex)
    if (startIndex < 0) {
      return
    }

    const track = tracks[startIndex]!
    const context = input.context ?? { type: 'library' as const }
    const player = getAudioPlayer()
    player.setQueue(tracks, startIndex, context)
    await player.playTrack(track)
  }

  /**
   * Поиск → один трек. Не копирует выдачу и не создаёт второй плеер.
   * Альбом, плейлист и «Моя волна» этим методом не ходят.
   */
  async playSearchTrack(input: PlaySearchTrackInput): Promise<void> {
    if (!input.track.id) {
      return
    }
    const player = getAudioPlayer()
    const before = getPlaybackQueue().getSnapshot()
    noteSearchFlowEvent({
      source: 'PlaybackIntent.playSearchTrack',
      contextBefore: before.context.type,
      queueLengthBefore: before.items.length,
      currentIndex: before.currentIndex,
      trackId: input.track.id,
      nextSource: 'continuation',
      detail: 'commit-search-seed',
    })
    ensureSearchRecommendation()
    commitSearchSeedQueue(getPlaybackQueue(), getContinuationSession(), {
      track: input.track,
      query: input.query,
      searchHits: input.searchHits,
    })
    await player.playTrack(input.track)
  }

  /**
   * Клик по существующей глобальной queue: focus + play, context не меняется.
   */
  async playFromQueue(input: PlayFromQueueInput): Promise<void> {
    await getAudioPlayer().playTrack(input.track)
  }

  /** Очередь «Моей волны». Не создаёт второй плеер. */
  async playRadio(input: PlayRadioInput): Promise<void> {
    const startIndex = clampIndex(input.tracks.length, input.startIndex)
    if (startIndex < 0) {
      return
    }
    const track = input.tracks[startIndex]!
    const player = getAudioPlayer()
    player.setQueue(input.tracks, startIndex, {
      type: 'radio',
      id: 'my-wave',
      title: 'Моя волна',
      origin: input.origin,
    })
    await player.playTrack(track)
  }

  /**
   * Выход из Album Mode без stop/playTrack/reload.
   * Anchor: если current нет в deck — [current, ...deck].
   */
  exitAlbumMode(input: ExitAlbumModeInput): void {
    const { swipeTracks, currentTrack: playing } = input
    const player = getAudioPlayer()
    const queue = getPlaybackQueue()

    if (swipeTracks.length === 0) {
      if (playing) {
        player.setQueue([playing], 0, { type: 'swipe' })
      } else {
        queue.setPlaybackContext({ type: 'swipe' })
      }
      return
    }

    const existingIndex = playing
      ? swipeTracks.findIndex((item) => item.id === playing.id)
      : -1

    if (existingIndex >= 0) {
      player.setQueue(swipeTracks, existingIndex, { type: 'swipe' })
      return
    }

    if (playing) {
      player.setQueue([playing, ...swipeTracks], 0, { type: 'swipe' })
      return
    }

    player.setQueue(swipeTracks, 0, { type: 'swipe' })
  }
}

let singleton: PlaybackIntent | null = null

export function getPlaybackIntent(): PlaybackIntent {
  if (!singleton) {
    singleton = new PlaybackIntent()
  }
  return singleton
}

/**
 * Маршрутизация play из Library по уже вычисленному PlaybackContext.
 * album → playAlbum; иначе → playFromLibrary (library / playlist / search).
 */
export async function playLibrarySelection(options: {
  tracks: Track[]
  startIndex: number
  context: PlaybackContext
}): Promise<void> {
  const intent = getPlaybackIntent()
  const { tracks, startIndex, context } = options

  if (context.type === 'album') {
    await intent.playAlbum({
      tracks,
      startIndex,
      album: {
        id: context.id,
        title: context.title,
        ...(context.artist ? { artist: context.artist } : {}),
      },
    })
    return
  }

  if (context.type === 'playlist') {
    await intent.playFromLibrary({
      tracks,
      startIndex,
      context: { type: 'playlist', id: context.id, title: context.title },
    })
    return
  }

  if (context.type === 'search') {
    await intent.playFromLibrary({
      tracks,
      startIndex,
      context: { type: 'search', query: context.query },
    })
    return
  }

  await intent.playFromLibrary({
    tracks,
    startIndex,
    context: { type: 'library' },
  })
}
