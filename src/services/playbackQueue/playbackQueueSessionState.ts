/**
 * Полный durable-снимок PlaybackQueue для SessionStore (PLAYBACK-DEV-03).
 * Без pendingRemovalIds (runtime-only) и без stream/preview URL.
 */
import type { Track } from '../../types/track.ts'
import {
  NONE_PLAYBACK_CONTEXT,
  parsePlaybackContext,
  type PlaybackContext,
} from '../../types/playbackContext.ts'

/** Локальные алиасы — без импорта из PlaybackQueue (избегаем cycle). */
type RepeatMode = 'OFF' | 'ONE' | 'ALL'
type ShuffleMode = 'OFF' | 'ON'

export type PlaybackQueueSessionState = {
  items: Track[]
  currentIndex: number
  playOrder: number[]
  playOrderIndex: number
  repeatMode: RepeatMode
  shuffleMode: ShuffleMode
  history: string[]
  /**
   * Occurrence rank parallel to history (PLAYBACK-BUG-01).
   * Legacy snapshots without the field normalize to zeros.
   */
  historyRanks: number[]
  historyIndex: number
  context: PlaybackContext
  /** Provenance insertNext / continuation. Обязательное поле (не legacy-optional). */
  sessionTailIds: string[]
}

/** Выровнять ranks по длине history; legacy → нули. */
export function normalizeHistoryRanks(
  history: readonly string[],
  ranks: readonly number[] | undefined,
): number[] {
  const out: number[] = []
  for (let i = 0; i < history.length; i += 1) {
    const raw = ranks?.[i]
    out.push(
      typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0,
    )
  }
  return out
}

export type SessionStateIssue = {
  path: string
  message: string
}

export type SessionStateValidationResult =
  | { ok: true; value: PlaybackQueueSessionState }
  | { ok: false; issues: SessionStateIssue[] }

const REPEAT = new Set<RepeatMode>(['OFF', 'ONE', 'ALL'])
const SHUFFLE = new Set<ShuffleMode>(['OFF', 'ON'])

function issue(path: string, message: string): SessionStateIssue {
  return { path, message }
}

function stripPreview(track: Track): Track {
  return { ...track, previewUrl: null }
}

function isTrackLike(value: unknown): value is Track {
  if (!value || typeof value !== 'object') {
    return false
  }
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof row.title === 'string' &&
    typeof row.artist === 'string' &&
    (typeof row.sourceId === 'string' || typeof row.externalId === 'string')
  )
}

/**
 * Валидация до мутации очереди.
 * Ошибочный снимок не должен частично применяться.
 */
export function validatePlaybackQueueSessionState(
  value: unknown,
): SessionStateValidationResult {
  const issues: SessionStateIssue[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [issue('$', 'expected object')] }
  }
  const raw = value as Record<string, unknown>

  if (Object.prototype.hasOwnProperty.call(raw, 'pendingRemovalIds')) {
    issues.push(
      issue(
        'pendingRemovalIds',
        'runtime-only; must not appear in durable session state',
      ),
    )
  }

  if (!Array.isArray(raw.items)) {
    issues.push(issue('items', 'expected array'))
  }
  const items: Track[] = []
  if (Array.isArray(raw.items)) {
    for (let i = 0; i < raw.items.length; i += 1) {
      const row = raw.items[i]
      if (!isTrackLike(row)) {
        issues.push(issue(`items[${i}]`, 'invalid track'))
        continue
      }
      if (
        typeof (row as Track).previewUrl === 'string' &&
        (row as Track).previewUrl
      ) {
        // допускаем на входе, но нормализуем в strip; секрет не оставляем
      }
      items.push(stripPreview(row))
    }
  }

  const n = items.length
  let currentIndex =
    typeof raw.currentIndex === 'number' && Number.isInteger(raw.currentIndex)
      ? raw.currentIndex
      : NaN
  if (!Number.isInteger(currentIndex)) {
    issues.push(issue('currentIndex', 'expected integer'))
    currentIndex = -1
  } else if (n === 0) {
    if (currentIndex !== -1) {
      issues.push(issue('currentIndex', 'must be -1 when items empty'))
      currentIndex = -1
    }
  } else if (currentIndex < -1 || currentIndex >= n) {
    issues.push(issue('currentIndex', `out of range -1..${n - 1}`))
  }

  if (!Array.isArray(raw.playOrder)) {
    issues.push(issue('playOrder', 'expected number[]'))
  }
  const playOrder: number[] = []
  if (Array.isArray(raw.playOrder)) {
    if (n === 0) {
      if (raw.playOrder.length !== 0) {
        issues.push(issue('playOrder', 'must be empty when items empty'))
      }
    } else if (raw.playOrder.length !== n) {
      issues.push(
        issue('playOrder', `expected permutation length ${n}`),
      )
    } else {
      const seen = new Set<number>()
      for (let i = 0; i < raw.playOrder.length; i += 1) {
        const idx = raw.playOrder[i]
        if (typeof idx !== 'number' || !Number.isInteger(idx)) {
          issues.push(issue(`playOrder[${i}]`, 'expected integer'))
          continue
        }
        if (idx < 0 || idx >= n || seen.has(idx)) {
          issues.push(issue(`playOrder[${i}]`, 'invalid permutation index'))
          continue
        }
        seen.add(idx)
        playOrder.push(idx)
      }
      if (playOrder.length === n && seen.size !== n) {
        issues.push(issue('playOrder', 'not a permutation'))
      }
    }
  }

  let playOrderIndex =
    typeof raw.playOrderIndex === 'number' && Number.isInteger(raw.playOrderIndex)
      ? raw.playOrderIndex
      : NaN
  if (!Number.isInteger(playOrderIndex)) {
    issues.push(issue('playOrderIndex', 'expected integer'))
    playOrderIndex = -1
  } else if (playOrder.length === 0) {
    if (playOrderIndex !== -1) {
      issues.push(issue('playOrderIndex', 'must be -1 when playOrder empty'))
      playOrderIndex = -1
    }
  } else if (playOrderIndex < -1 || playOrderIndex >= playOrder.length) {
    issues.push(
      issue('playOrderIndex', `out of range -1..${playOrder.length - 1}`),
    )
  } else if (
    currentIndex >= 0 &&
    playOrderIndex >= 0 &&
    playOrder[playOrderIndex] !== currentIndex
  ) {
    issues.push(
      issue(
        'playOrderIndex',
        'playOrder[playOrderIndex] must equal currentIndex',
      ),
    )
  }

  if (typeof raw.repeatMode !== 'string' || !REPEAT.has(raw.repeatMode as RepeatMode)) {
    issues.push(issue('repeatMode', 'invalid'))
  }
  if (
    typeof raw.shuffleMode !== 'string' ||
    !SHUFFLE.has(raw.shuffleMode as ShuffleMode)
  ) {
    issues.push(issue('shuffleMode', 'invalid'))
  }

  if (!Array.isArray(raw.history)) {
    issues.push(issue('history', 'expected string[]'))
  }
  const history: string[] = []
  if (Array.isArray(raw.history)) {
    for (let i = 0; i < raw.history.length; i += 1) {
      const id = raw.history[i]
      if (typeof id !== 'string' || !id) {
        issues.push(issue(`history[${i}]`, 'expected non-empty string'))
        continue
      }
      history.push(id)
    }
  }

  // Optional legacy field — нормализуем без hard-fail.
  const historyRanks = normalizeHistoryRanks(
    history,
    Array.isArray(raw.historyRanks)
      ? (raw.historyRanks as number[])
      : undefined,
  )

  let historyIndex =
    typeof raw.historyIndex === 'number' && Number.isInteger(raw.historyIndex)
      ? raw.historyIndex
      : NaN
  if (!Number.isInteger(historyIndex)) {
    issues.push(issue('historyIndex', 'expected integer'))
    historyIndex = -1
  } else if (history.length === 0) {
    if (historyIndex !== -1) {
      issues.push(issue('historyIndex', 'must be -1 when history empty'))
      historyIndex = -1
    }
  } else if (historyIndex < -1 || historyIndex >= history.length) {
    issues.push(
      issue('historyIndex', `out of range -1..${history.length - 1}`),
    )
  }

  if (!Object.prototype.hasOwnProperty.call(raw, 'sessionTailIds')) {
    issues.push(issue('sessionTailIds', 'required field'))
  }
  const sessionTailIds: string[] = []
  if (Array.isArray(raw.sessionTailIds)) {
    const known = new Set(items.map((t) => t.id))
    for (let i = 0; i < raw.sessionTailIds.length; i += 1) {
      const id = raw.sessionTailIds[i]
      if (typeof id !== 'string' || !id) {
        issues.push(issue(`sessionTailIds[${i}]`, 'expected non-empty string'))
        continue
      }
      if (!known.has(id)) {
        issues.push(issue(`sessionTailIds[${i}]`, 'id not in items'))
        continue
      }
      sessionTailIds.push(id)
    }
  } else if (Object.prototype.hasOwnProperty.call(raw, 'sessionTailIds')) {
    issues.push(issue('sessionTailIds', 'expected string[]'))
  }

  const context = parsePlaybackContext(raw.context)
  // parsePlaybackContext soft-falls to none; require explicit object if provided badly
  if (raw.context !== undefined && raw.context !== null) {
    if (typeof raw.context !== 'object' || Array.isArray(raw.context)) {
      issues.push(issue('context', 'invalid'))
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  return {
    ok: true,
    value: {
      items,
      currentIndex,
      playOrder: n === 0 ? [] : playOrder,
      playOrderIndex,
      repeatMode: raw.repeatMode as RepeatMode,
      shuffleMode: raw.shuffleMode as ShuffleMode,
      history,
      historyRanks,
      historyIndex,
      context: context ?? NONE_PLAYBACK_CONTEXT,
      sessionTailIds,
    },
  }
}

/**
 * Строит durable-снимок из live-состояния с учётом pendingRemovalIds.
 * Не мутирует исходные структуры вызывающего (работает на копиях).
 *
 * Правило pending: удалённые из каталога, но ещё звучащие треки
 * не попадают в durable session state — иначе после restore они
 * вернулись бы в будущую очередь. Mid-play якорь остаётся заботой
 * AudioPlayer / live Queue до Next, не SessionStore.
 */
export function buildDurableSessionState(input: {
  items: readonly Track[]
  currentIndex: number
  playOrder: readonly number[]
  playOrderIndex: number
  repeatMode: RepeatMode
  shuffleMode: ShuffleMode
  history: readonly string[]
  historyRanks?: readonly number[]
  historyIndex: number
  context: PlaybackContext
  sessionTailIds: ReadonlySet<string> | readonly string[]
  pendingRemovalIds: ReadonlySet<string> | readonly string[]
}): PlaybackQueueSessionState {
  const pending = new Set(
    [...input.pendingRemovalIds].filter((id) => typeof id === 'string' && id),
  )
  const tailSource = [...input.sessionTailIds]
  const ranks = normalizeHistoryRanks(input.history, input.historyRanks)

  if (pending.size === 0) {
    const items = input.items.map(stripPreview)
    const known = new Set(items.map((t) => t.id))
    return {
      items,
      currentIndex: input.currentIndex,
      playOrder: [...input.playOrder],
      playOrderIndex: input.playOrderIndex,
      repeatMode: input.repeatMode,
      shuffleMode: input.shuffleMode,
      history: [...input.history],
      historyRanks: ranks,
      historyIndex: input.historyIndex,
      context: input.context,
      sessionTailIds: tailSource.filter((id) => known.has(id)),
    }
  }

  const oldToNew = new Map<number, number>()
  const items: Track[] = []
  for (let i = 0; i < input.items.length; i += 1) {
    const track = input.items[i]!
    if (pending.has(track.id)) {
      continue
    }
    oldToNew.set(i, items.length)
    items.push(stripPreview(track))
  }

  if (items.length === 0) {
    return {
      items: [],
      currentIndex: -1,
      playOrder: [],
      playOrderIndex: -1,
      repeatMode: input.repeatMode,
      shuffleMode: input.shuffleMode,
      history: [],
      historyRanks: [],
      historyIndex: -1,
      context: input.context,
      sessionTailIds: [],
    }
  }

  // Сохраняем относительный shuffle-порядок оставшихся индексов.
  const playOrder: number[] = []
  const seen = new Set<number>()
  for (const idx of input.playOrder) {
    const mapped = oldToNew.get(idx)
    if (mapped === undefined || seen.has(mapped)) {
      continue
    }
    seen.add(mapped)
    playOrder.push(mapped)
  }
  for (let i = 0; i < items.length; i += 1) {
    if (!seen.has(i)) {
      playOrder.push(i)
    }
  }

  const currentId =
    input.currentIndex >= 0 && input.currentIndex < input.items.length
      ? input.items[input.currentIndex]?.id
      : null
  const currentPending = currentId != null && pending.has(currentId)

  let currentIndex = -1
  if (!currentPending && input.currentIndex >= 0) {
    currentIndex = oldToNew.get(input.currentIndex) ?? -1
  } else {
    for (let pos = input.playOrderIndex + 1; pos < input.playOrder.length; pos += 1) {
      const mapped = oldToNew.get(input.playOrder[pos]!)
      if (mapped !== undefined) {
        currentIndex = mapped
        break
      }
    }
    if (currentIndex < 0) {
      for (const idx of input.playOrder) {
        const mapped = oldToNew.get(idx)
        if (mapped !== undefined) {
          currentIndex = mapped
          break
        }
      }
    }
  }
  if (currentIndex < 0) {
    currentIndex = 0
  }

  let playOrderIndex = playOrder.indexOf(currentIndex)
  if (playOrderIndex < 0) {
    playOrderIndex = 0
    currentIndex = playOrder[0] ?? 0
  }

  const history: string[] = []
  const historyRanks: number[] = []
  for (let i = 0; i < input.history.length; i += 1) {
    const id = input.history[i]!
    if (!pending.has(id) && items.some((t) => t.id === id)) {
      history.push(id)
      historyRanks.push(ranks[i] ?? 0)
    }
  }
  let historyIndex = input.historyIndex
  if (history.length === 0) {
    historyIndex = -1
  } else {
    // Сжимаем курсор: сколько элементов history до старого курсора сохранилось.
    let keptBefore = 0
    for (let i = 0; i < Math.max(0, input.historyIndex + 1); i += 1) {
      const id = input.history[i]!
      if (!pending.has(id) && items.some((t) => t.id === id)) {
        keptBefore += 1
      }
    }
    historyIndex = Math.max(-1, keptBefore - 1)
    if (historyIndex >= history.length) {
      historyIndex = history.length - 1
    }
  }

  const known = new Set(items.map((t) => t.id))
  return {
    items,
    currentIndex,
    playOrder,
    playOrderIndex,
    repeatMode: input.repeatMode,
    shuffleMode: input.shuffleMode,
    history,
    historyRanks,
    historyIndex,
    context: input.context,
    sessionTailIds: tailSource.filter((id) => known.has(id) && !pending.has(id)),
  }
}
