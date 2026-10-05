import type { SourceCopy } from './canonical.ts'
import type { CanonicalPlaybackAvailability } from './playbackAvailability.ts'
import type { Track } from './track.ts'

/**
 * Выбор одной SourceCopy до playback.
 * Это не очередь, не currentTrack и не runtime fallback после ошибки плеера.
 */
export const PLAYABLE_SOURCE_SELECTION_REASON = {
  /** Единственная PLAYABLE copy, явного предпочтения не было. */
  SELECTED: 'SELECTED',
  /** Пользователь выбрал source Track, и эта copy уже PLAYABLE. */
  PREFERRED_SOURCE: 'PREFERRED_SOURCE',
  /** Несколько PLAYABLE copies без предпочтения: стабильный sourceTrackKey. */
  DETERMINISTIC_TIE_BREAK: 'DETERMINISTIC_TIE_BREAK',
  /**
   * Предпочтительная copy уже не PLAYABLE до старта.
   * Другая PLAYABLE copy выбрана заранее. Это не повтор после ошибки playback.
   */
  PRE_PLAY_ALTERNATIVE: 'PRE_PLAY_ALTERNATIVE',
  NO_PLAYABLE_COPY: 'NO_PLAYABLE_COPY',
  TRACK_SNAPSHOT_MISSING: 'TRACK_SNAPSHOT_MISSING',
} as const

export type PlayableSourceSelectionReason =
  (typeof PLAYABLE_SOURCE_SELECTION_REASON)[keyof typeof PLAYABLE_SOURCE_SELECTION_REASON]

export type PlayableSourceSelection = {
  canonicalTrackId: string
  selectedCopy: SourceCopy | null
  selectedTrack: Track | null
  availability: CanonicalPlaybackAvailability
  reason: PlayableSourceSelectionReason
}

const HANDOFF_REASONS = new Set<PlayableSourceSelectionReason>([
  PLAYABLE_SOURCE_SELECTION_REASON.SELECTED,
  PLAYABLE_SOURCE_SELECTION_REASON.PREFERRED_SOURCE,
  PLAYABLE_SOURCE_SELECTION_REASON.DETERMINISTIC_TIE_BREAK,
  PLAYABLE_SOURCE_SELECTION_REASON.PRE_PLAY_ALTERNATIVE,
])

/** Track можно передать в существующий PlaybackResolver только при готовой передаче. */
export function isPlaybackHandoffReady(selection: PlayableSourceSelection): boolean {
  return selection.selectedTrack !== null && HANDOFF_REASONS.has(selection.reason)
}
