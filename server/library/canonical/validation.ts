type Parsed<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateLikedPatch(body: unknown): Parsed<{ liked: boolean }> {
  if (!isRecord(body)) {
    return { ok: false, fields: { body: 'Ожидается объект' } }
  }
  if ('userId' in body || 'user_id' in body) {
    return { ok: false, fields: { userId: 'Поле запрещено' } }
  }
  if (typeof body.liked !== 'boolean') {
    return { ok: false, fields: { liked: 'Ожидается boolean' } }
  }
  return { ok: true, value: { liked: body.liked } }
}
