import type { SourceCopy } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import {
  PLAYBACK_AVAILABILITY_REASON,
  PLAYBACK_AVAILABILITY_STATUS,
  type CanonicalPlaybackAvailability,
  type PlaybackAvailabilityReason,
  type PlaybackAvailabilityStatus,
  type SourceCopyAvailability,
  type TrackAvailabilityProbe,
} from '../../types/playbackAvailability.ts'
import {
  availabilityCacheKey,
  readAvailabilityCache,
  writeAvailabilityCache,
} from './cache.ts'
import { mapAvailabilityError } from './mapAvailabilityError.ts'
import { usePlaybackAvailabilityStore } from '../../store/playbackAvailabilityStore.ts'

const DEFAULT_TTL_MS = 30_000

/**
 * Узкий вид адаптера. Resolver не знает имён Spotify или Yandex.
 * getPlaybackCandidates здесь только как признак, что playback probe существует.
 * Сам метод не вызывается: он принадлежит текущему PlaybackResolver и может готовить URL.
 */
export type AvailabilityAdapter = {
  id: string
  type?: string
  kind?: string
  capabilities: readonly string[]
  supportsStreaming: boolean
  isAvailable: () => boolean | Promise<boolean>
  checkTrackAvailability?: (track: Track) => Promise<TrackAvailabilityProbe>
  getPlaybackCandidates?: (track: Track) => Promise<unknown>
}

export type AvailabilityPort = {
  findAdapter: (sourceId: string) => AvailabilityAdapter | null
  isSourceEnabled: (sourceId: string) => boolean
}

export type ResolveCanonicalPlaybackAvailabilityInput = {
  canonicalTrackId: string
  copies: readonly SourceCopy[]
}

export type ResolveCanonicalPlaybackAvailabilityOptions = {
  port: AvailabilityPort
  now?: number
  ttlMs?: number
}

function checkedAtFrom(now: number): string {
  return new Date(now).toISOString()
}

function resultOf(
  copy: Pick<SourceCopy, 'sourceTrackKey' | 'sourceId'>,
  canonicalTrackId: string,
  status: PlaybackAvailabilityStatus,
  reason: PlaybackAvailabilityReason | undefined,
  now: number,
): SourceCopyAvailability {
  return {
    sourceTrackKey: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    canonicalTrackId,
    status,
    reason,
    checkedAt: checkedAtFrom(now),
  }
}

function supportsPlayback(adapter: AvailabilityAdapter): boolean {
  return adapter.supportsStreaming || adapter.capabilities.includes('preview')
}

function hasPlaybackProbe(adapter: AvailabilityAdapter): boolean {
  return (
    typeof adapter.checkTrackAvailability === 'function' ||
    typeof adapter.getPlaybackCandidates === 'function'
  )
}

function isLocalAdapter(adapter: AvailabilityAdapter): boolean {
  return adapter.kind === 'local-folder' || adapter.type === 'filesystem'
}

function trackFromCopy(copy: SourceCopy): Track {
  return {
    id: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    externalId: copy.externalId,
    title: copy.title,
    artist: copy.artist,
    album: copy.album ?? undefined,
    durationMs: copy.durationMs ?? undefined,
    coverUrl: copy.artworkUrl,
  }
}

function remember(
  value: SourceCopyAvailability,
  readiness: string,
  now: number,
  ttlMs: number,
): SourceCopyAvailability {
  writeAvailabilityCache(
    availabilityCacheKey(value.canonicalTrackId, value.sourceTrackKey),
    value,
    readiness,
    now,
    ttlMs,
  )
  return value
}

async function resolveCopy(
  copy: SourceCopy,
  canonicalTrackId: string,
  port: AvailabilityPort,
  now: number,
  ttlMs: number,
): Promise<SourceCopyAvailability> {
  if (!copy.sourceTrackKey || !copy.sourceId || !copy.externalId) {
    return resultOf(
      copy,
      canonicalTrackId,
      PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
      PLAYBACK_AVAILABILITY_REASON.SOURCE_COPY_MISSING,
      now,
    )
  }

  const enabled = port.isSourceEnabled(copy.sourceId)
  const adapter = enabled ? port.findAdapter(copy.sourceId) : null
  let available = false
  if (adapter) {
    try {
      available = Boolean(await adapter.isAvailable())
    } catch (error) {
      const mapped = mapAvailabilityError(error)
      return remember(
        resultOf(copy, canonicalTrackId, mapped.status, mapped.reason, now),
        `${enabled}:error`,
        now,
        ttlMs,
      )
    }
  }

  const readiness = `${enabled}:${adapter?.id ?? 'none'}:${available}`
  const cached = readAvailabilityCache(
    availabilityCacheKey(canonicalTrackId, copy.sourceTrackKey),
    readiness,
    now,
  )
  if (cached) {
    return cached
  }

  if (!enabled) {
    return remember(
      resultOf(
        copy,
        canonicalTrackId,
        PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED,
        PLAYBACK_AVAILABILITY_REASON.SOURCE_DISABLED,
        now,
      ),
      readiness,
      now,
      ttlMs,
    )
  }

  if (!adapter) {
    return remember(
      resultOf(
        copy,
        canonicalTrackId,
        PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED,
        PLAYBACK_AVAILABILITY_REASON.ADAPTER_MISSING,
        now,
      ),
      readiness,
      now,
      ttlMs,
    )
  }

  if (!supportsPlayback(adapter)) {
    return remember(
      resultOf(
        copy,
        canonicalTrackId,
        PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED,
        PLAYBACK_AVAILABILITY_REASON.PLAYBACK_UNSUPPORTED,
        now,
      ),
      readiness,
      now,
      ttlMs,
    )
  }

  if (!available && adapter.capabilities.includes('auth') && hasPlaybackProbe(adapter)) {
    return remember(
      resultOf(
        copy,
        canonicalTrackId,
        PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED,
        PLAYBACK_AVAILABILITY_REASON.AUTH_REQUIRED,
        now,
      ),
      readiness,
      now,
      ttlMs,
    )
  }

  if (!available && !hasPlaybackProbe(adapter)) {
    return remember(
      resultOf(
        copy,
        canonicalTrackId,
        PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED,
        PLAYBACK_AVAILABILITY_REASON.PLAYBACK_UNSUPPORTED,
        now,
      ),
      readiness,
      now,
      ttlMs,
    )
  }

  if (!available && isLocalAdapter(adapter) && !adapter.checkTrackAvailability) {
    return remember(
      resultOf(
        copy,
        canonicalTrackId,
        PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE,
        PLAYBACK_AVAILABILITY_REASON.LOCAL_HANDLE_MISSING,
        now,
      ),
      readiness,
      now,
      ttlMs,
    )
  }

  if (!available && !adapter.checkTrackAvailability) {
    return remember(
      resultOf(
        copy,
        canonicalTrackId,
        PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED,
        PLAYBACK_AVAILABILITY_REASON.NOT_CONNECTED,
        now,
      ),
      readiness,
      now,
      ttlMs,
    )
  }

  if (!adapter.checkTrackAvailability) {
    return remember(
      resultOf(
        copy,
        canonicalTrackId,
        PLAYBACK_AVAILABILITY_STATUS.UNKNOWN,
        PLAYBACK_AVAILABILITY_REASON.NOT_CHECKED,
        now,
      ),
      readiness,
      now,
      ttlMs,
    )
  }

  try {
    const probe = await adapter.checkTrackAvailability(trackFromCopy(copy))
    return remember(
      resultOf(copy, canonicalTrackId, probe.status, probe.reason, now),
      readiness,
      now,
      ttlMs,
    )
  } catch (error) {
    const mapped = mapAvailabilityError(error)
    return remember(
      resultOf(copy, canonicalTrackId, mapped.status, mapped.reason, now),
      readiness,
      now,
      ttlMs,
    )
  }
}

/**
 * Считает availability каждой SourceCopy.
 * Не выбирает источник, не ставит очередь и не запускает плеер.
 */
export async function resolveCanonicalPlaybackAvailability(
  input: ResolveCanonicalPlaybackAvailabilityInput,
  options: ResolveCanonicalPlaybackAvailabilityOptions,
): Promise<CanonicalPlaybackAvailability> {
  const now = options.now ?? Date.now()
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const copies: SourceCopyAvailability[] = []
  for (const copy of input.copies) {
    copies.push(
      await resolveCopy(copy, input.canonicalTrackId, options.port, now, ttlMs),
    )
  }
  const playableCopies = copies.filter(
    (copy) => copy.status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
  )
  const result: CanonicalPlaybackAvailability = {
    canonicalTrackId: input.canonicalTrackId,
    copies,
    playableCopies,
    hasPlayableCopy: playableCopies.length > 0,
  }
  usePlaybackAvailabilityStore.getState().replace(result)
  return result
}
