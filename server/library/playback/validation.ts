const EVENT_TYPES = new Set([
  'playback_started',
  'playback_progress',
  'playback_completed',
  'playback_skipped',
  'playback_paused',
  'playback_resumed',
  'playback_failed',
])

const REASONS = new Set([
  'next',
  'previous',
  'replaced',
  'stop',
  'load-failed',
  'playback-failed',
])

export type PlaybackEventRecord = {
  eventId: string
  sessionId: string
  eventType: string
  sourceId: string
  externalId: string
  canonicalTrackId: string | null
  positionMs: number
  listenedMs: number
  durationMs: number | null
  reason: string | null
  createdAt: string
}
const MAX_MS = 48 * 60 * 60 * 1000
const SECRET = /:\/\/|access_token|authorization|bearer\s/i

export type PlaybackBatch =
  | { ok: true; events: PlaybackEventRecord[] }
  | { ok: false; fields: Record<string, string> }

export function validatePlaybackBatch(body: unknown): PlaybackBatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, fields: { body: 'Ожидается объект' } }
  }
  const events = (body as { events?: unknown }).events
  if (!Array.isArray(events) || events.length === 0 || events.length > 40) {
    return { ok: false, fields: { events: 'От 1 до 40 событий' } }
  }
  const parsed: PlaybackEventRecord[] = []
  for (const item of events) {
    const event = validateEvent(item)
    if (!event) {
      return { ok: false, fields: { events: 'Некорректное событие' } }
    }
    parsed.push(event)
  }
  return { ok: true, events: parsed }
}

function validateEvent(value: unknown): PlaybackEventRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const eventId = text(record.eventId, 96)
  const sessionId = text(record.sessionId, 80)
  const eventType = typeof record.eventType === 'string' && EVENT_TYPES.has(record.eventType)
    ? record.eventType
    : null
  const sourceId = text(record.sourceId, 80)
  const externalId = text(record.externalId, 500)
  const canonicalTrackId = optionalText(record.canonicalTrackId, 80)
  const positionMs = millis(record.positionMs)
  const listenedMs = millis(record.listenedMs)
  if (positionMs == null || listenedMs == null) {
    return null
  }
  let durationMs: number | null = null
  if (record.durationMs != null) {
    const parsedDuration = millis(record.durationMs)
    if (parsedDuration == null) {
      return null
    }
    durationMs = parsedDuration
  }
  const reason = record.reason == null
    ? null
    : typeof record.reason === 'string' && REASONS.has(record.reason)
      ? record.reason
      : undefined
  const createdAt = timestamp(record.createdAt)
  if (
    !eventId || !sessionId || !eventType || !sourceId || !externalId
    || canonicalTrackId === undefined
    || reason === undefined || !createdAt
  ) {
    return null
  }
  const secrets = [eventId, sessionId, sourceId, externalId, canonicalTrackId ?? '', reason ?? '']
  if (secrets.some((field) => SECRET.test(field))) {
    return null
  }
  return {
    eventId,
    sessionId,
    eventType,
    sourceId,
    externalId,
    canonicalTrackId,
    positionMs,
    listenedMs,
    durationMs,
    reason,
    createdAt,
  }
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value == null) {
    return null
  }
  return text(value, max) ?? undefined
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max || hasControl(trimmed)) {
    return null
  }
  return trimmed
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) {
      return true
    }
  }
  return false
}

function millis(value: unknown): number | null | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_MS) {
    return null
  }
  return value
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) {
    return null
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return new Date(parsed).toISOString()
}
