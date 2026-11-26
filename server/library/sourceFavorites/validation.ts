import type { FieldErrors, Parsed } from '../validation.ts'
import { validateSourceSnapshot } from '../identity/validation.ts'
import type { SourceCopySnapshot } from '../identity/types.ts'
import type {
  SourceFavoritesSyncChunkBody,
  SourceFavoritesSyncCompleteBody,
} from './types.ts'

const MAX_BATCH = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asSyncId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 80) {
    return null
  }
  return trimmed
}

export function validateSourceFavoritesSyncChunkBody(
  body: unknown,
): Parsed<SourceFavoritesSyncChunkBody> {
  if (!isRecord(body)) {
    return { ok: false, fields: { body: 'Ожидается объект' } }
  }
  const fields: FieldErrors = {}
  const syncId = asSyncId(body.syncId)
  if (!syncId) {
    fields.syncId = 'Нужен syncId'
  }
  if (!Array.isArray(body.snapshots)) {
    fields.snapshots = 'Ожидается массив'
  }
  if (Object.keys(fields).length > 0) {
    return { ok: false, fields }
  }
  const rawSnapshots = body.snapshots as unknown[]
  if (rawSnapshots.length > MAX_BATCH) {
    return { ok: false, fields: { snapshots: `Не больше ${MAX_BATCH} за запрос` } }
  }
  const snapshots: SourceCopySnapshot[] = []
  for (let index = 0; index < rawSnapshots.length; index += 1) {
    const parsed = validateSourceSnapshot(rawSnapshots[index])
    if (!parsed.ok) {
      fields[`snapshots[${index}]`] = 'Некорректный снимок трека'
      return { ok: false, fields }
    }
    snapshots.push(parsed.value)
  }
  return {
    ok: true,
    value: {
      syncId: syncId!,
      snapshots,
    },
  }
}

export function validateSourceFavoritesSyncCompleteBody(
  body: unknown,
): Parsed<SourceFavoritesSyncCompleteBody> {
  if (!isRecord(body)) {
    return { ok: false, fields: { body: 'Ожидается объект' } }
  }
  const syncId = asSyncId(body.syncId)
  if (!syncId) {
    return { ok: false, fields: { syncId: 'Нужен syncId' } }
  }
  return { ok: true, value: { syncId } }
}

export const SOURCE_FAVORITES_MAX_BATCH = MAX_BATCH
