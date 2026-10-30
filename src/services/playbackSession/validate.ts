import { parsePlaybackContext } from '../../types/playbackContext.ts'
import {
  sessionTrackHasForbiddenFields,
  toSessionTrack,
} from './sanitizeTrack.ts'
import {
  PLAYBACK_SESSION_IDS,
  PLAYBACK_SESSION_SCHEMA_VERSION,
  type PlaybackSessionId,
  type PlaybackSessionSlot,
  type SessionPlaybackPhase,
  type SessionQueueSnapshot,
  type SessionSlotMeta,
  type SessionTrack,
} from './types.ts'

const PHASES = new Set<SessionPlaybackPhase>([
  'idle',
  'ready',
  'playing',
  'user_paused',
  'network_interrupted',
  'user_gesture_required',
  'unavailable',
])

const REPEAT = new Set(['OFF', 'ONE', 'ALL'])
const SHUFFLE = new Set(['OFF', 'ON'])

export type ValidationIssue = {
  path: string
  message: string
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] }

function issue(path: string, message: string): ValidationIssue {
  return { path, message }
}

function isPlaybackSessionId(value: unknown): value is PlaybackSessionId {
  return (
    typeof value === 'string' &&
    (PLAYBACK_SESSION_IDS as readonly string[]).includes(value)
  )
}

function validateStringIdArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string[] {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'expected string[]'))
    return []
  }
  const out: string[] = []
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i]
    if (typeof item !== 'string' || !item) {
      issues.push(issue(`${path}[${i}]`, 'expected non-empty string'))
      continue
    }
    out.push(item)
  }
  return out
}

function validateIndexArray(
  value: unknown,
  path: string,
  itemCount: number,
  issues: ValidationIssue[],
): number[] {
  if (!Array.isArray(value)) {
    issues.push(issue(path, 'expected number[]'))
    return []
  }
  const out: number[] = []
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i]
    if (typeof item !== 'number' || !Number.isInteger(item)) {
      issues.push(issue(`${path}[${i}]`, 'expected integer'))
      continue
    }
    if (item < 0 || item >= itemCount) {
      issues.push(issue(`${path}[${i}]`, `index out of range 0..${itemCount - 1}`))
      continue
    }
    out.push(item)
  }
  return out
}

function validateSessionTrack(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): SessionTrack | null {
  if (!value || typeof value !== 'object') {
    issues.push(issue(path, 'expected object'))
    return null
  }
  if (sessionTrackHasForbiddenFields(value)) {
    issues.push(issue(path, 'forbidden secret/stream fields present'))
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) {
    issues.push(issue(`${path}.id`, 'required non-empty string'))
    return null
  }
  if (typeof record.sourceId !== 'string') {
    issues.push(issue(`${path}.sourceId`, 'required string'))
    return null
  }
  if (typeof record.externalId !== 'string') {
    issues.push(issue(`${path}.externalId`, 'required string'))
    return null
  }
  if (typeof record.title !== 'string') {
    issues.push(issue(`${path}.title`, 'required string'))
    return null
  }
  if (typeof record.artist !== 'string') {
    issues.push(issue(`${path}.artist`, 'required string'))
    return null
  }
  // toSessionTrack strips secrets / sanitizes cover
  return toSessionTrack(record)
}

export function validateSessionQueueSnapshot(
  value: unknown,
  path = 'queue',
): ValidationResult<SessionQueueSnapshot> {
  const issues: ValidationIssue[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: [issue(path, 'expected object')] }
  }
  const raw = value as Record<string, unknown>

  if (!Array.isArray(raw.items)) {
    issues.push(issue(`${path}.items`, 'expected array'))
  }
  const items: SessionTrack[] = []
  if (Array.isArray(raw.items)) {
    for (let i = 0; i < raw.items.length; i += 1) {
      const track = validateSessionTrack(raw.items[i], `${path}.items[${i}]`, issues)
      if (track) {
        items.push(track)
      }
    }
  }

  const itemCount = items.length
  let currentIndex =
    typeof raw.currentIndex === 'number' && Number.isInteger(raw.currentIndex)
      ? raw.currentIndex
      : NaN
  if (!Number.isInteger(currentIndex)) {
    issues.push(issue(`${path}.currentIndex`, 'expected integer'))
    currentIndex = -1
  } else if (itemCount === 0) {
    if (currentIndex !== -1) {
      issues.push(issue(`${path}.currentIndex`, 'must be -1 when items empty'))
      currentIndex = -1
    }
  } else if (currentIndex < -1 || currentIndex >= itemCount) {
    issues.push(
      issue(`${path}.currentIndex`, `out of range -1..${itemCount - 1}`),
    )
    currentIndex = -1
  }

  const playOrder = validateIndexArray(
    raw.playOrder,
    `${path}.playOrder`,
    itemCount === 0 ? 0 : itemCount,
    issues,
  )
  // empty items → playOrder must be empty; validateIndexArray with itemCount 0
  // treats any index >= 0 as out of range — good.

  let playOrderIndex =
    typeof raw.playOrderIndex === 'number' && Number.isInteger(raw.playOrderIndex)
      ? raw.playOrderIndex
      : NaN
  if (!Number.isInteger(playOrderIndex)) {
    issues.push(issue(`${path}.playOrderIndex`, 'expected integer'))
    playOrderIndex = -1
  } else if (playOrder.length === 0) {
    if (playOrderIndex !== -1) {
      issues.push(issue(`${path}.playOrderIndex`, 'must be -1 when playOrder empty'))
      playOrderIndex = -1
    }
  } else if (playOrderIndex < -1 || playOrderIndex >= playOrder.length) {
    issues.push(
      issue(
        `${path}.playOrderIndex`,
        `out of range -1..${playOrder.length - 1}`,
      ),
    )
    playOrderIndex = -1
  }

  if (typeof raw.repeatMode !== 'string' || !REPEAT.has(raw.repeatMode)) {
    issues.push(issue(`${path}.repeatMode`, 'invalid'))
  }
  if (typeof raw.shuffleMode !== 'string' || !SHUFFLE.has(raw.shuffleMode)) {
    issues.push(issue(`${path}.shuffleMode`, 'invalid'))
  }

  const history = validateStringIdArray(raw.history, `${path}.history`, issues)
  const historyRanks: number[] = []
  for (let i = 0; i < history.length; i += 1) {
    const rawRank = Array.isArray(raw.historyRanks)
      ? raw.historyRanks[i]
      : undefined
    historyRanks.push(
      typeof rawRank === 'number' &&
        Number.isInteger(rawRank) &&
        rawRank >= 0
        ? rawRank
        : 0,
    )
  }
  let historyIndex =
    typeof raw.historyIndex === 'number' && Number.isInteger(raw.historyIndex)
      ? raw.historyIndex
      : NaN
  if (!Number.isInteger(historyIndex)) {
    issues.push(issue(`${path}.historyIndex`, 'expected integer'))
    historyIndex = -1
  } else if (history.length === 0) {
    if (historyIndex !== -1) {
      issues.push(issue(`${path}.historyIndex`, 'must be -1 when history empty'))
      historyIndex = -1
    }
  } else if (historyIndex < -1 || historyIndex >= history.length) {
    issues.push(
      issue(`${path}.historyIndex`, `out of range -1..${history.length - 1}`),
    )
    historyIndex = -1
  }

  const context = parsePlaybackContext(raw.context)
  const sessionTailIds = validateStringIdArray(
    raw.sessionTailIds,
    `${path}.sessionTailIds`,
    issues,
  )

  let positionSeconds =
    typeof raw.positionSeconds === 'number' && Number.isFinite(raw.positionSeconds)
      ? raw.positionSeconds
      : NaN
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    issues.push(issue(`${path}.positionSeconds`, 'expected finite number >= 0'))
    positionSeconds = 0
  }

  if (typeof raw.phase !== 'string' || !PHASES.has(raw.phase as SessionPlaybackPhase)) {
    issues.push(issue(`${path}.phase`, 'invalid phase'))
  }
  if (typeof raw.updatedAt !== 'string' || !raw.updatedAt) {
    issues.push(issue(`${path}.updatedAt`, 'expected non-empty string'))
  }

  // pendingRemovalIds must not appear in durable snapshots
  if (Object.prototype.hasOwnProperty.call(raw, 'pendingRemovalIds')) {
    issues.push(issue(`${path}.pendingRemovalIds`, 'not allowed in session snapshot'))
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  return {
    ok: true,
    value: {
      items,
      currentIndex,
      playOrder,
      playOrderIndex,
      repeatMode: raw.repeatMode as SessionQueueSnapshot['repeatMode'],
      shuffleMode: raw.shuffleMode as SessionQueueSnapshot['shuffleMode'],
      history,
      historyRanks,
      historyIndex,
      context,
      sessionTailIds,
      positionSeconds,
      phase: raw.phase as SessionPlaybackPhase,
      updatedAt: raw.updatedAt as string,
    },
  }
}

function validateMeta(
  value: unknown,
  sessionId: PlaybackSessionId,
  path: string,
  issues: ValidationIssue[],
): SessionSlotMeta | null {
  if (!value || typeof value !== 'object') {
    issues.push(issue(path, 'expected object'))
    return null
  }
  const raw = value as Record<string, unknown>
  if (raw.kind !== sessionId) {
    issues.push(issue(`${path}.kind`, `must equal session id "${sessionId}"`))
    return null
  }
  switch (sessionId) {
    case 'swipes':
      return { kind: 'swipes' }
    case 'wave':
      return { kind: 'wave' }
    case 'search':
      return {
        kind: 'search',
        query: typeof raw.query === 'string' || raw.query === null ? (raw.query as string | null) : null,
        seedTrackId:
          typeof raw.seedTrackId === 'string' || raw.seedTrackId === null
            ? (raw.seedTrackId as string | null)
            : null,
      }
    case 'catalog':
      return {
        kind: 'catalog',
        catalogId:
          typeof raw.catalogId === 'string' || raw.catalogId === null
            ? (raw.catalogId as string | null)
            : null,
        title:
          typeof raw.title === 'string' || raw.title === null
            ? (raw.title as string | null)
            : null,
      }
    case 'album': {
      const phase = raw.phase === 'related' ? 'related' : 'album'
      return {
        kind: 'album',
        albumId:
          typeof raw.albumId === 'string' || raw.albumId === null
            ? (raw.albumId as string | null)
            : null,
        title:
          typeof raw.title === 'string' || raw.title === null
            ? (raw.title as string | null)
            : null,
        ...(typeof raw.artist === 'string' ? { artist: raw.artist } : {}),
        phase,
      }
    }
    default: {
      const _exhaustive: never = sessionId
      issues.push(issue(path, `unknown session ${_exhaustive}`))
      return null
    }
  }
}

export function validatePlaybackSessionSlot(
  value: unknown,
  expectedId?: PlaybackSessionId,
  path = 'slot',
): ValidationResult<PlaybackSessionSlot> {
  const issues: ValidationIssue[] = []
  if (!value || typeof value !== 'object') {
    return { ok: false, issues: [issue(path, 'expected object')] }
  }
  const raw = value as Record<string, unknown>
  if (!isPlaybackSessionId(raw.id)) {
    return { ok: false, issues: [issue(`${path}.id`, 'invalid session id')] }
  }
  if (expectedId && raw.id !== expectedId) {
    return {
      ok: false,
      issues: [issue(`${path}.id`, `expected "${expectedId}"`)],
    }
  }
  const meta = validateMeta(raw.meta, raw.id, `${path}.meta`, issues)
  const queueResult = validateSessionQueueSnapshot(raw.queue, `${path}.queue`)
  if (!queueResult.ok) {
    issues.push(...queueResult.issues)
  }
  if (
    typeof raw.slotGeneration !== 'number' ||
    !Number.isInteger(raw.slotGeneration) ||
    raw.slotGeneration < 0
  ) {
    issues.push(issue(`${path}.slotGeneration`, 'expected integer >= 0'))
  }

  if (issues.length > 0 || !queueResult.ok || !meta) {
    return { ok: false, issues }
  }

  return {
    ok: true,
    value: {
      id: raw.id,
      meta,
      queue: queueResult.value,
      slotGeneration: raw.slotGeneration as number,
    },
  }
}

export function assertSchemaVersion(
  value: unknown,
  path = 'schemaVersion',
): ValidationIssue | null {
  if (value !== PLAYBACK_SESSION_SCHEMA_VERSION) {
    return issue(
      path,
      `expected schemaVersion ${PLAYBACK_SESSION_SCHEMA_VERSION}, got ${String(value)}`,
    )
  }
  return null
}
