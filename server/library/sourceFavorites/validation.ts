import type { FieldErrors, Parsed } from '../validation.ts'
import { validateSourceSnapshot } from '../identity/validation.ts'
import type { SourceCopySnapshot } from '../identity/types.ts'
import type { SourceFavoritesSyncBody } from './types.ts'

const MAX_BATCH = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateSourceFavoritesSyncBody(
  body: unknown,
): Parsed<SourceFavoritesSyncBody> {
  if (!isRecord(body)) {
    return { ok: false, fields: { body: 'Ожидается объект' } }
  }
  const fields: FieldErrors = {}
  if (!Array.isArray(body.snapshots)) {
    fields.snapshots = 'Ожидается массив'
  }
  const seenAt =
    typeof body.seenAt === 'string' && body.seenAt.trim() && !Number.isNaN(Date.parse(body.seenAt))
      ? body.seenAt.trim()
      : null
  if (!seenAt) {
    fields.seenAt = 'Нужен ISO timestamp'
  }
  if (typeof body.finalize !== 'boolean') {
    fields.finalize = 'Ожидается boolean'
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
      snapshots,
      seenAt: seenAt!,
      finalize: body.finalize as boolean,
    },
  }
}

export const SOURCE_FAVORITES_MAX_BATCH = MAX_BATCH
