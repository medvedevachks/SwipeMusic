import type { SourceCopy } from '../../types/canonical.ts'
import {
  PLAYBACK_AVAILABILITY_STATUS,
  type CanonicalPlaybackAvailability,
  type PlaybackAvailabilityStatus,
} from '../../types/playbackAvailability.ts'
import type { ActionableKnownAlternatives } from '../../types/runtimeFallback.ts'

const PLAYABLE = PLAYBACK_AVAILABILITY_STATUS.PLAYABLE

export function orderPlayableCopies(input: {
  canonicalTrackId: string
  copies: readonly SourceCopy[]
  availability: CanonicalPlaybackAvailability
  preferredSourceTrackKey?: string | null
  attemptedSourceTrackKeys?: readonly string[]
}): SourceCopy[] {
  const attempted = new Set(input.attemptedSourceTrackKeys ?? [])
  const playableKeys = new Set(
    input.availability.copies
      .filter(
        (copy) =>
          copy.canonicalTrackId === input.canonicalTrackId &&
          copy.status === PLAYABLE &&
          !attempted.has(copy.sourceTrackKey),
      )
      .map((copy) => copy.sourceTrackKey),
  )
  const playable = input.copies.filter(
    (copy) =>
      copy.canonicalTrackId === input.canonicalTrackId &&
      playableKeys.has(copy.sourceTrackKey),
  )
  const preferredKey = input.preferredSourceTrackKey ?? null
  const preferred = preferredKey
    ? playable.find((copy) => copy.sourceTrackKey === preferredKey) ?? null
    : null
  const rest = playable
    .filter((copy) => copy.sourceTrackKey !== preferred?.sourceTrackKey)
    .sort(bySourceTrackKey)
  return preferred ? [preferred, ...rest] : rest
}

export function groupKnownAlternatives(input: {
  canonicalTrackId: string
  copies: readonly SourceCopy[]
  availability: CanonicalPlaybackAvailability
}): ActionableKnownAlternatives {
  const byKey = new Map(input.copies.map((copy) => [copy.sourceTrackKey, copy]))
  const groups: ActionableKnownAlternatives = {
    subscriptionRequiredCopies: [],
    notConnectedCopies: [],
    authRequiredCopies: [],
    unavailableCopies: [],
    unknownCopies: [],
    unsupportedCopies: [],
  }
  for (const entry of input.availability.copies) {
    if (entry.canonicalTrackId !== input.canonicalTrackId) {
      continue
    }
    if (entry.status === PLAYABLE) {
      continue
    }
    const copy = byKey.get(entry.sourceTrackKey)
    if (!copy || copy.canonicalTrackId !== input.canonicalTrackId) {
      continue
    }
    pushGroup(groups, entry.status, copy)
  }
  return groups
}

function pushGroup(
  groups: ActionableKnownAlternatives,
  status: PlaybackAvailabilityStatus,
  copy: SourceCopy,
): void {
  switch (status) {
    case PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED:
      groups.subscriptionRequiredCopies.push(copy)
      break
    case PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED:
      groups.notConnectedCopies.push(copy)
      break
    case PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED:
      groups.authRequiredCopies.push(copy)
      break
    case PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE:
      groups.unavailableCopies.push(copy)
      break
    case PLAYBACK_AVAILABILITY_STATUS.UNKNOWN:
      groups.unknownCopies.push(copy)
      break
    case PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED:
      groups.unsupportedCopies.push(copy)
      break
    default:
      break
  }
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
