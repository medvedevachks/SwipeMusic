/**
 * Контракт рекомендательного продолжения после последней песни альбома.
 *
 * DEV-07: только контракт + no-op default. Живое CME-продолжение —
 * зависимость PLAYBACK-DEV-08 (не рефакторить CME здесь).
 */
import type { AlbumSessionMeta } from '../../playbackSession/types.ts'
import type { Track } from '../../../types/track.ts'

export type AlbumContinuationDecision =
  | { action: 'stop' }
  | { action: 'noop' }
  | {
      action: 'related'
      /** Треки related-хвоста; подключение в DEV-08. */
      tracks: Track[]
    }

export type AlbumContinuationPort = {
  /**
   * Вызывается, когда ALBUM-очередь исчерпана (repeat OFF, нет next).
   * Не должен мутировать CME / Recommendation Engine в DEV-07.
   */
  onAlbumExhausted(input: {
    meta: AlbumSessionMeta
    lastTrack: Track | null
  }): Promise<AlbumContinuationDecision>
}

const defaultPort: AlbumContinuationPort = {
  async onAlbumExhausted() {
    return { action: 'stop' }
  },
}

let port: AlbumContinuationPort = defaultPort

export function getAlbumContinuationPort(): AlbumContinuationPort {
  return port
}

/** Только тесты / будущий DEV-08 wiring. */
export function setAlbumContinuationPortForTests(
  next: AlbumContinuationPort | null,
): void {
  port = next ?? defaultPort
}

/**
 * DEV-07 hook point: вызвать перед stop() на конце альбома.
 * Сейчас всегда stop — без CME. DEV-08 подключит related.
 */
export async function resolveAlbumExhaustedContinuation(input: {
  meta: AlbumSessionMeta
  lastTrack: Track | null
}): Promise<AlbumContinuationDecision> {
  try {
    return await getAlbumContinuationPort().onAlbumExhausted(input)
  } catch {
    return { action: 'stop' }
  }
}
