import type { SourceCopy } from '../../types/canonical.ts'
import {
  PLAYBACK_AVAILABILITY_STATUS,
  type CanonicalPlaybackAvailability,
} from '../../types/playbackAvailability.ts'
import {
  PLAYABLE_SOURCE_SELECTION_REASON,
  type PlayableSourceSelection,
  type PlayableSourceSelectionReason,
} from '../../types/playableSourceSelection.ts'

export type SelectPlayableSourceCopyInput = {
  canonicalTrackId: string
  copies: readonly SourceCopy[]
  availability: CanonicalPlaybackAvailability
  /**
   * Source Track, который пользователь выбрал явно.
   * Для поиска и свайпа это Track.id. Не продуктовый приоритет провайдера.
   */
  preferredSourceTrackKey?: string | null
}

/**
 * Чистый выбор одной PLAYABLE SourceCopy.
 * Не запускает плеер, не меняет очередь и не подключает провайдера.
 * Замена preferred copy возможна только до playback и только на уже PLAYABLE copy.
 */
export function selectPlayableSourceCopy(
  input: SelectPlayableSourceCopyInput,
): PlayableSourceSelection {
  const playable = playableCopies(input.copies, input.availability, input.canonicalTrackId)
  const preferred = findPreferred(input.copies, input.preferredSourceTrackKey)
  const preferredIsPlayable = Boolean(
    preferred && playable.some((copy) => copy.sourceTrackKey === preferred.sourceTrackKey),
  )

  if (preferred && preferredIsPlayable) {
    return selection(input, preferred, PLAYABLE_SOURCE_SELECTION_REASON.PREFERRED_SOURCE)
  }

  if (playable.length === 0) {
    return selection(input, null, PLAYABLE_SOURCE_SELECTION_REASON.NO_PLAYABLE_COPY)
  }

  const ordered = [...playable].sort(bySourceTrackKey)
  const selected = ordered[0]!
  const reason: PlayableSourceSelectionReason = preferred
    ? PLAYABLE_SOURCE_SELECTION_REASON.PRE_PLAY_ALTERNATIVE
    : playable.length > 1
      ? PLAYABLE_SOURCE_SELECTION_REASON.DETERMINISTIC_TIE_BREAK
      : PLAYABLE_SOURCE_SELECTION_REASON.SELECTED

  return selection(input, selected, reason)
}

function playableCopies(
  copies: readonly SourceCopy[],
  availability: CanonicalPlaybackAvailability,
  canonicalTrackId: string,
): SourceCopy[] {
  const playableKeys = new Set(
    availability.copies
      .filter(
        (copy) =>
          copy.canonicalTrackId === canonicalTrackId &&
          copy.status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
      )
      .map((copy) => copy.sourceTrackKey),
  )
  return copies.filter(
    (copy) =>
      copy.canonicalTrackId === canonicalTrackId && playableKeys.has(copy.sourceTrackKey),
  )
}

function findPreferred(
  copies: readonly SourceCopy[],
  preferredSourceTrackKey: string | null | undefined,
): SourceCopy | null {
  if (!preferredSourceTrackKey) {
    return null
  }
  return copies.find((copy) => copy.sourceTrackKey === preferredSourceTrackKey) ?? null
}

function bySourceTrackKey(left: SourceCopy, right: SourceCopy): number {
  if (left.sourceTrackKey < right.sourceTrackKey) {
    return -1
  }
  if (left.sourceTrackKey > right.sourceTrackKey) {
    return 1
  }
  return 0
}

function selection(
  input: SelectPlayableSourceCopyInput,
  selectedCopy: SourceCopy | null,
  reason: PlayableSourceSelectionReason,
): PlayableSourceSelection {
  return {
    canonicalTrackId: input.canonicalTrackId,
    selectedCopy,
    selectedTrack: null,
    availability: input.availability,
    reason,
  }
}
