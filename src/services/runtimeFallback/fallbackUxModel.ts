import type { SourceCopy } from '../../types/canonical.ts'
import {
  PLAYBACK_AVAILABILITY_STATUS,
  type CanonicalPlaybackAvailability,
  type PlaybackAvailabilityStatus,
} from '../../types/playbackAvailability.ts'
import {
  RUNTIME_FALLBACK_STATUS,
  type RuntimeFallbackResult,
} from '../../types/runtimeFallback.ts'

export type ProviderLabelLookup = (sourceId: string) => string

export type FallbackUxAction =
  | { type: 'dismiss' }
  | { type: 'confirm-play'; sourceTrackKey: string; providerLabel: string }
  | { type: 'play'; sourceTrackKey: string; providerLabel: string }
  | { type: 'sources' }
  | { type: 'recheck'; sourceId: string; sourceTrackKey: string }
  | { type: 'retry-playback' }

export type FallbackUxRow = {
  sourceTrackKey: string
  sourceId: string
  providerLabel: string
  statusText: string
  detail: string
  tone: 'ok' | 'failed' | 'neutral'
  actions: FallbackUxAction[]
}

export type FallbackUxModel = {
  kind: 'idle' | 'notice' | 'confirmation' | 'terminal'
  blocking: boolean
  ownsPlayerError: boolean
  noticeText: string | null
  title: string | null
  body: string | null
  rows: FallbackUxRow[]
  primaryActions: FallbackUxAction[]
  sessionId: string | null
  generation: number | null
  canonicalTrackId: string | null
}

const SOURCES_PATH = '/sources'

export function sourcesPath(): string {
  return SOURCES_PATH
}

export function emptyFallbackUx(): FallbackUxModel {
  return {
    kind: 'idle',
    blocking: false,
    ownsPlayerError: false,
    noticeText: null,
    title: null,
    body: null,
    rows: [],
    primaryActions: [],
    sessionId: null,
    generation: null,
    canonicalTrackId: null,
  }
}

/** Ошибка без canonical fallback остаётся у существующего плеера. */
export function playbackErrorOwner(fallbackHandled: boolean): 'fallback' | 'player' {
  return fallbackHandled ? 'fallback' : 'player'
}

/** Сырой текст провайдера в интерфейс не попадает. */
export function playbackFailureLabel(raw?: unknown): string {
  void raw
  return 'Ошибка воспроизведения'
}

export function statusLabel(status: PlaybackAvailabilityStatus): string {
  switch (status) {
    case PLAYBACK_AVAILABILITY_STATUS.PLAYABLE:
      return 'Доступно'
    case PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED:
      return 'Нужна подписка'
    case PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED:
      return 'Источник не подключён'
    case PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED:
      return 'Нужно переподключить источник'
    case PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE:
      return 'Сейчас недоступно'
    case PLAYBACK_AVAILABILITY_STATUS.UNKNOWN:
      return 'Не удалось проверить доступность'
    case PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED:
      return 'Воспроизведение пока не поддерживается'
    default:
      return 'Сейчас недоступно'
  }
}

export function decideConfirmation(input: {
  expectedGeneration: number | null
  currentGeneration: number
  action: 'confirm' | 'cancel'
}): 'attempt' | 'dismiss' | 'ignore' {
  if (input.expectedGeneration == null || input.expectedGeneration !== input.currentGeneration) {
    return 'ignore'
  }
  return input.action === 'confirm' ? 'attempt' : 'dismiss'
}

export function buildFallbackUx(
  result: RuntimeFallbackResult,
  labelOf: ProviderLabelLookup,
  generation: number | null = null,
  rawErrors?: Readonly<Record<string, string>>,
): FallbackUxModel {
  void rawErrors
  const base = emptyFallbackUx()
  base.sessionId = result.session.sessionId
  base.generation = generation
  base.canonicalTrackId = result.session.canonicalTrackId
  const label = (sourceId: string) => readableLabel(sourceId, labelOf)

  if (result.status === RUNTIME_FALLBACK_STATUS.FALLBACK_SUCCEEDED) {
    const event = result.events[result.events.length - 1]
    if (!event) {
      return base
    }
    const fromLabel = label(sourceIdOf(result, event.fromSourceTrackKey))
    const toLabel = label(sourceIdOf(result, event.toSourceTrackKey))
    return {
      ...base,
      kind: 'notice',
      blocking: false,
      ownsPlayerError: true,
      noticeText: `Источник переключён: ${fromLabel} → ${toLabel}`,
    }
  }

  if (result.status === RUNTIME_FALLBACK_STATUS.CONFIRMATION_REQUIRED && result.nextPlayableCopy) {
    const failed = result.failedCopies[result.failedCopies.length - 1]?.copy
    const fromLabel = failed ? label(failed.sourceId) : 'текущего источника'
    const toLabel = label(result.nextPlayableCopy.sourceId)
    return {
      ...base,
      kind: 'confirmation',
      blocking: true,
      ownsPlayerError: true,
      title: 'Не удалось воспроизвести',
      body: `Не удалось воспроизвести из ${fromLabel}. Доступна копия в ${toLabel}.`,
      primaryActions: [
        {
          type: 'confirm-play',
          sourceTrackKey: result.nextPlayableCopy.sourceTrackKey,
          providerLabel: toLabel,
        },
        { type: 'dismiss' },
      ],
    }
  }

  if (isTerminalStatus(result.status)) {
    const rows = terminalRows(result, label)
    const primaryActions: FallbackUxAction[] =
      result.status === RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED
        ? [{ type: 'retry-playback' }, { type: 'dismiss' }]
        : [{ type: 'dismiss' }]
    return {
      ...base,
      kind: 'terminal',
      blocking: true,
      ownsPlayerError: true,
      title: terminalTitle(result),
      body: terminalBody(result, label),
      rows,
      primaryActions,
    }
  }

  return base
}

export function buildManualAlternatives(input: {
  canonicalTrackId: string
  copies: readonly SourceCopy[]
  availability: CanonicalPlaybackAvailability
  labelOf: ProviderLabelLookup
}): FallbackUxModel {
  const label = (sourceId: string) => readableLabel(sourceId, input.labelOf)
  const rows = input.copies
    .filter((copy) => copy.canonicalTrackId === input.canonicalTrackId)
    .map((copy) => rowForStatus(copy, statusFor(input.availability, copy.sourceTrackKey), label))
    .filter((row): row is FallbackUxRow => row != null)
  return {
    ...emptyFallbackUx(),
    kind: rows.length > 0 ? 'terminal' : 'idle',
    blocking: rows.length > 0,
    ownsPlayerError: false,
    title: 'Источники композиции',
    canonicalTrackId: input.canonicalTrackId,
    rows,
    primaryActions: [{ type: 'dismiss' }],
  }
}

export function withRecheckedStatus(
  model: FallbackUxModel,
  sourceTrackKey: string,
  status: PlaybackAvailabilityStatus,
  labelOf: ProviderLabelLookup,
): FallbackUxModel {
  const label = (sourceId: string) => readableLabel(sourceId, labelOf)
  return {
    ...model,
    rows: model.rows.map((row) => {
      if (row.sourceTrackKey !== sourceTrackKey) {
        return row
      }
      const copy: SourceCopy = {
        sourceTrackKey: row.sourceTrackKey,
        canonicalTrackId: model.canonicalTrackId ?? '',
        sourceId: row.sourceId,
        externalId: row.sourceTrackKey,
        title: '',
        artist: '',
        album: null,
        durationMs: null,
        artworkUrl: null,
        createdAt: '',
        updatedAt: '',
      }
      return rowForStatus(copy, status, label) ?? row
    }),
  }
}

export function visibleFallbackText(model: FallbackUxModel): string {
  const parts = [
    model.noticeText,
    model.title,
    model.body,
    ...model.rows.flatMap((row) => [row.providerLabel, row.statusText, row.detail]),
    ...model.primaryActions.map((action) => action.type),
  ]
  return parts.filter((part): part is string => Boolean(part)).join('\n')
}

export async function recheckUnknownCopy(deps: {
  sourceId: string
  invalidate: (sourceId: string) => void
  resolve: () => Promise<CanonicalPlaybackAvailability>
  attemptPlayback?: (sourceTrackKey: string) => void
}): Promise<CanonicalPlaybackAvailability> {
  deps.invalidate(deps.sourceId)
  return deps.resolve()
}

export async function switchToPlayableCopy(deps: {
  sourceTrackKey: string
  cancel: () => void
  findTrack: (sourceTrackKey: string) => { id: string } | null
  play: (track: { id: string }, options: { preserveQueue: true }) => Promise<void>
}): Promise<boolean> {
  deps.cancel()
  const track = deps.findTrack(deps.sourceTrackKey)
  if (!track) {
    return false
  }
  await deps.play(track, { preserveQueue: true })
  return true
}

function isTerminalStatus(status: RuntimeFallbackResult['status']): boolean {
  return (
    status === RUNTIME_FALLBACK_STATUS.NO_PLAYABLE_COPY ||
    status === RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED ||
    status === RUNTIME_FALLBACK_STATUS.STOPPED_BY_POLICY ||
    status === RUNTIME_FALLBACK_STATUS.TRACK_SNAPSHOT_MISSING
  )
}

function terminalTitle(result: RuntimeFallbackResult): string {
  if (result.status === RUNTIME_FALLBACK_STATUS.ALL_PLAYABLE_COPIES_FAILED) {
    return 'Не удалось воспроизвести композицию из доступных источников.'
  }
  if (result.status === RUNTIME_FALLBACK_STATUS.TRACK_SNAPSHOT_MISSING) {
    return 'Не удалось начать воспроизведение.'
  }
  return 'Варианты воспроизведения'
}

function terminalBody(
  result: RuntimeFallbackResult,
  label: (sourceId: string) => string,
): string | null {
  if (result.failedCopies.length > 0) {
    return null
  }
  const alternatives = knownAlternativeCopies(result)
  if (alternatives.length !== 1) {
    return null
  }
  const copy = alternatives[0]!
  const status = statusFor(result.knownAvailability, copy.sourceTrackKey)
  if (!status) {
    return null
  }
  return sentenceFor(status, label(copy.sourceId))
}

function terminalRows(
  result: RuntimeFallbackResult,
  label: (sourceId: string) => string,
): FallbackUxRow[] {
  const rows: FallbackUxRow[] = []
  const seen = new Set<string>()
  for (const failed of result.failedCopies) {
    if (failed.copy.canonicalTrackId !== result.session.canonicalTrackId) {
      continue
    }
    seen.add(failed.copy.sourceTrackKey)
    rows.push({
      sourceTrackKey: failed.copy.sourceTrackKey,
      sourceId: failed.copy.sourceId,
      providerLabel: label(failed.copy.sourceId),
      statusText: playbackFailureLabel(),
      detail: playbackFailureLabel(),
      tone: 'failed',
      actions: [],
    })
  }
  if (result.nextPlayableCopy && !seen.has(result.nextPlayableCopy.sourceTrackKey)) {
    const playable = rowForStatus(
      result.nextPlayableCopy,
      PLAYBACK_AVAILABILITY_STATUS.PLAYABLE,
      label,
    )
    if (playable) {
      rows.push(playable)
      seen.add(result.nextPlayableCopy.sourceTrackKey)
    }
  }
  for (const copy of knownAlternativeCopies(result)) {
    if (seen.has(copy.sourceTrackKey) || copy.canonicalTrackId !== result.session.canonicalTrackId) {
      continue
    }
    const status = statusFor(result.knownAvailability, copy.sourceTrackKey)
    if (!status || status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE) {
      continue
    }
    const row = rowForStatus(copy, status, label)
    if (row) {
      rows.push(row)
    }
  }
  return rows
}

function knownAlternativeCopies(result: RuntimeFallbackResult): SourceCopy[] {
  const groups = result.alternatives
  return [
    ...groups.subscriptionRequiredCopies,
    ...groups.notConnectedCopies,
    ...groups.authRequiredCopies,
    ...groups.unavailableCopies,
    ...groups.unknownCopies,
    ...groups.unsupportedCopies,
  ]
}

function rowForStatus(
  copy: SourceCopy,
  status: PlaybackAvailabilityStatus | null,
  label: (sourceId: string) => string,
): FallbackUxRow | null {
  if (!status) {
    return null
  }
  const providerLabel = label(copy.sourceId)
  return {
    sourceTrackKey: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    providerLabel,
    statusText: statusLabel(status),
    detail: sentenceFor(status, providerLabel),
    tone: status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE ? 'ok' : 'neutral',
    actions: actionsFor(copy, status, providerLabel),
  }
}

function actionsFor(
  copy: SourceCopy,
  status: PlaybackAvailabilityStatus,
  providerLabel: string,
): FallbackUxAction[] {
  switch (status) {
    case PLAYBACK_AVAILABILITY_STATUS.PLAYABLE:
      return [{ type: 'play', sourceTrackKey: copy.sourceTrackKey, providerLabel }]
    case PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED:
    case PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED:
    case PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED:
      return [{ type: 'sources' }]
    case PLAYBACK_AVAILABILITY_STATUS.UNKNOWN:
      return [{ type: 'recheck', sourceId: copy.sourceId, sourceTrackKey: copy.sourceTrackKey }]
    case PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE:
    case PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED:
      return []
    default:
      return []
  }
}

function sentenceFor(status: PlaybackAvailabilityStatus, providerLabel: string): string {
  switch (status) {
    case PLAYBACK_AVAILABILITY_STATUS.SUBSCRIPTION_REQUIRED:
      return `Композиция найдена в ${providerLabel}, но для воспроизведения требуется подписка.`
    case PLAYBACK_AVAILABILITY_STATUS.NOT_CONNECTED:
      return `Композиция есть в ${providerLabel}, но источник не подключён.`
    case PLAYBACK_AVAILABILITY_STATUS.AUTH_REQUIRED:
      return `Нужно повторно подключить ${providerLabel}.`
    case PLAYBACK_AVAILABILITY_STATUS.UNAVAILABLE:
      return 'Эта копия сейчас недоступна.'
    case PLAYBACK_AVAILABILITY_STATUS.UNKNOWN:
      return `Не удалось проверить доступность ${providerLabel}.`
    case PLAYBACK_AVAILABILITY_STATUS.UNSUPPORTED:
      return `Воспроизведение из ${providerLabel} пока не поддерживается.`
    case PLAYBACK_AVAILABILITY_STATUS.PLAYABLE:
      return `${providerLabel}: доступно.`
    default:
      return 'Эта копия сейчас недоступна.'
  }
}

function statusFor(
  availability: CanonicalPlaybackAvailability,
  sourceTrackKey: string,
): PlaybackAvailabilityStatus | null {
  return availability.copies.find((copy) => copy.sourceTrackKey === sourceTrackKey)?.status ?? null
}

function sourceIdOf(result: RuntimeFallbackResult, sourceTrackKey: string): string {
  const copies = [
    ...result.attemptedCopies,
    ...result.failedCopies.map((failed) => failed.copy),
    result.currentCopy,
    result.nextPlayableCopy,
    ...knownAlternativeCopies(result),
  ]
  return copies.find((copy) => copy?.sourceTrackKey === sourceTrackKey)?.sourceId ?? sourceTrackKey
}

function readableLabel(sourceId: string, labelOf: ProviderLabelLookup): string {
  const label = labelOf(sourceId).trim()
  return label || sourceId
}
