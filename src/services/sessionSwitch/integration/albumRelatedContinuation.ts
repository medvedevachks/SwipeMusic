/**
 * ALBUM related continuation wiring (PLAYBACK-CME-01).
 * Same-artist library — не выдаём случайный CME за «похожее».
 */
import type { Track } from '../../../types/track.ts'
import { toSessionTrack } from '../../playbackSession/sanitizeTrack.ts'
import { getPlaybackQueue } from '../../playbackQueue/PlaybackQueue.ts'
import {
  setAlbumContinuationPortForTests,
  type AlbumContinuationDecision,
  type AlbumContinuationPort,
} from './albumContinuationContract.ts'
import { buildAlbumRelatedTracks } from './albumRelatedTracks.ts'
import { getSessionSwitchAppRuntime } from './sessionSwitchAppRuntime.ts'

export { buildAlbumRelatedTracks } from './albumRelatedTracks.ts'

const productionPort: AlbumContinuationPort = {
  async onAlbumExhausted(input) {
    const runtime = getSessionSwitchAppRuntime()
    const queue = getPlaybackQueue()
    const exclude = new Set(queue.getItems().map((t) => t.id))
    if (input.lastTrack?.id) {
      exclude.add(input.lastTrack.id)
    }
    if (runtime) {
      for (const item of runtime.store.getSlot('album').queue.items) {
        exclude.add(item.id)
      }
    }
    const tracks = buildAlbumRelatedTracks({
      meta: input.meta,
      lastTrack: input.lastTrack,
      excludeIds: exclude,
    })
    if (tracks.length === 0) {
      return { action: 'stop' }
    }
    return { action: 'related', tracks }
  },
}

let installed = false

export function ensureAlbumRelatedContinuationPort(): void {
  if (installed) {
    return
  }
  installed = true
  setAlbumContinuationPortForTests(productionPort)
}

export async function applyAlbumRelatedContinuation(
  decision: Extract<AlbumContinuationDecision, { action: 'related' }>,
): Promise<boolean> {
  if (decision.tracks.length === 0) {
    return false
  }
  const queue = getPlaybackQueue()
  const ctx = queue.getPlaybackContext()
  if (ctx.type !== 'album') {
    return false
  }
  const existing = queue.getItems()
  const merged = [...existing, ...decision.tracks]
  const startIndex = existing.length
  queue.setQueue(merged, startIndex, ctx)

  const runtime = getSessionSwitchAppRuntime()
  if (runtime && runtime.store.getActiveSessionId() === 'album') {
    const prev = runtime.store.getSlot('album')
    if (prev.meta.kind === 'album') {
      runtime.store.replaceSlot('album', {
        meta: { ...prev.meta, phase: 'related' },
        queue: {
          ...prev.queue,
          items: merged.map((t) => toSessionTrack(t)),
          currentIndex: startIndex,
          playOrder: merged.map((_, i) => i),
          playOrderIndex: startIndex,
          phase: 'playing',
          updatedAt: new Date().toISOString(),
        },
      })
    }
  }

  const { getAudioPlayer } = await import('../../audioPlayer/AudioPlayer.ts')
  const first: Track = decision.tracks[0]!
  await getAudioPlayer().playTrack(first)
  return true
}

export function resetAlbumRelatedContinuationForTests(): void {
  installed = false
  setAlbumContinuationPortForTests(null)
}
