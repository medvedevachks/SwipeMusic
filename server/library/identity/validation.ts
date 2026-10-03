import { splitTrackId } from '../validation.ts'
import type { SourceCopySnapshot } from './types.ts'

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalText(value: unknown): string | null | undefined {
  if (value == null) {
    return null
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed.length > 500) {
    return undefined
  }
  return trimmed.length > 0 ? trimmed : null
}

export function validateSourceSnapshot(body: unknown): Parsed<SourceCopySnapshot> {
  if (!isRecord(body)) {
    return { ok: false, fields: { body: 'Ожидается объект' } }
  }
  const fields: Record<string, string> = {}
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId : ''
  const externalId = typeof body.externalId === 'string' ? body.externalId : ''
  if (!splitTrackId(`${sourceId}:${externalId}`)) {
    fields.sourceId = 'Некорректный источник или externalId'
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const artist = typeof body.artist === 'string' ? body.artist.trim() : ''
  if (!title || title.length > 500) {
    fields.title = 'Нужно название'
  }
  if (!artist || artist.length > 500) {
    fields.artist = 'Нужен исполнитель'
  }
  const album = optionalText(body.album)
  if (album === undefined) {
    fields.album = 'Некорректный альбом'
  }
  let durationMs: number | null = null
  if (body.durationMs != null) {
    if (typeof body.durationMs !== 'number' || !Number.isFinite(body.durationMs) || body.durationMs < 0) {
      fields.durationMs = 'Некорректная длительность'
    } else {
      durationMs = Math.round(body.durationMs)
    }
  }
  const artworkUrl = optionalText(body.artworkUrl ?? body.coverUrl)
  if (artworkUrl === undefined) {
    fields.artworkUrl = 'Некорректная обложка'
  }
  if (Object.keys(fields).length > 0 || album === undefined || artworkUrl === undefined) {
    return { ok: false, fields }
  }
  return {
    ok: true,
    value: {
      sourceId,
      externalId,
      title,
      artist,
      album,
      durationMs,
      artworkUrl,
    },
  }
}

export function validateLinkBody(
  body: unknown,
): Parsed<{ sourceTrackKeyA: string; sourceTrackKeyB: string }> {
  if (!isRecord(body)) {
    return { ok: false, fields: { body: 'Ожидается объект' } }
  }
  const sourceTrackKeyA = typeof body.sourceTrackKeyA === 'string' ? body.sourceTrackKeyA : ''
  const sourceTrackKeyB = typeof body.sourceTrackKeyB === 'string' ? body.sourceTrackKeyB : ''
  const fields: Record<string, string> = {}
  if (!splitTrackId(sourceTrackKeyA)) {
    fields.sourceTrackKeyA = 'Некорректный ключ копии'
  }
  if (!splitTrackId(sourceTrackKeyB)) {
    fields.sourceTrackKeyB = 'Некорректный ключ копии'
  }
  if (Object.keys(fields).length > 0) {
    return { ok: false, fields }
  }
  return { ok: true, value: { sourceTrackKeyA, sourceTrackKeyB } }
}

export function validateUnlinkBody(body: unknown): Parsed<{ sourceTrackKey: string }> {
  if (!isRecord(body)) {
    return { ok: false, fields: { body: 'Ожидается объект' } }
  }
  const sourceTrackKey = typeof body.sourceTrackKey === 'string' ? body.sourceTrackKey : ''
  if (!splitTrackId(sourceTrackKey)) {
    return { ok: false, fields: { sourceTrackKey: 'Некорректный ключ копии' } }
  }
  return { ok: true, value: { sourceTrackKey } }
}
