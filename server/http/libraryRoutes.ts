import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import type { AppConfig } from '../config/env.ts'
import { createLibraryRepository, type LibraryResult } from '../library/repository.ts'
import { createIdentityRepository } from '../library/identity/repository.ts'
import {
  validateLinkBody,
  validateSourceSnapshot,
  validateUnlinkBody,
} from '../library/identity/validation.ts'
import {
  isClientId,
  parseHistoryLimit,
  splitTrackId,
  validateCategoryCreate,
  validateCategoryPatch,
  validateHistoryWrite,
  validateSettingsPatch,
  validateTrackWrite,
} from '../library/validation.ts'
import { readJsonBody, requireUserId, sendJson } from './currentUser.ts'

type LibraryContext = {
  db: DatabaseSync
  config: AppConfig
}

function sendFailure<T>(res: ServerResponse, result: LibraryResult<T>): void {
  if (result.ok) {
    return
  }
  sendJson(res, result.status, {
    error: result.error,
    ...(result.fields ? { fields: result.fields } : {}),
  })
}

export async function handleLibraryRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: LibraryContext,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  const method = req.method ?? 'GET'
  const userId = requireUserId(req, res, context)
  if (!userId) {
    return
  }

  const library = createLibraryRepository(context.db)
  const identity = createIdentityRepository(context.db)
  const limit = parseHistoryLimit(url.searchParams.get('limit'))

  if (method === 'GET' && path === '/api/me/library-state') {
    if (!limit.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: limit.fields })
      return
    }
    sendJson(res, 200, library.libraryState(userId, limit.value))
    return
  }

  if (path === '/api/me/categories') {
    if (method === 'GET') {
      sendJson(res, 200, { categories: library.listCategories(userId) })
      return
    }
    if (method === 'POST') {
      const body = await readBody(req, res)
      if (body === undefined) return
      const parsed = validateCategoryCreate(body, new Date().toISOString())
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
        return
      }
      const created = library.createCategory(userId, parsed.value)
      if (!created.ok) {
        sendFailure(res, created)
        return
      }
      sendJson(res, 201, { category: created.value })
      return
    }
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }

  const categoryMatch = path.match(/^\/api\/me\/categories\/([^/]+)$/)
  if (categoryMatch) {
    const categoryId = categoryMatch[1]
    if (!isClientId(categoryId)) {
      sendJson(res, 404, { error: 'NOT_FOUND' })
      return
    }
    if (method === 'PATCH') {
      const body = await readBody(req, res)
      if (body === undefined) return
      const parsed = validateCategoryPatch(body)
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
        return
      }
      const updated = library.updateCategory(userId, categoryId, parsed.value)
      if (!updated.ok) {
        sendFailure(res, updated)
        return
      }
      sendJson(res, 200, { category: updated.value })
      return
    }
    if (method === 'DELETE') {
      const removed = library.deleteCategory(userId, categoryId)
      if (!removed.ok) {
        sendFailure(res, removed)
        return
      }
      sendJson(res, 200, removed.value)
      return
    }
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }

  if (method === 'GET' && path === '/api/me/collection') {
    sendJson(res, 200, { tracks: library.listTracks(userId) })
    return
  }

  const assignMatch = path.match(/^\/api\/me\/collection\/tracks\/(.+)\/categories\/([^/]+)$/)
  if (assignMatch) {
    const trackId = safeDecode(assignMatch[1])
    const categoryId = safeDecode(assignMatch[2])
    if (!splitTrackId(trackId) || !isClientId(categoryId)) {
      sendJson(res, 404, { error: 'NOT_FOUND' })
      return
    }
    if (method === 'PUT') {
      const body = await readBody(req, res)
      if (body === undefined) return
      const assignmentId = readAssignmentId(body)
      if (assignmentId === false) {
        sendJson(res, 400, { error: 'VALIDATION', fields: { id: 'Некорректный id' } })
        return
      }
      const assigned = library.assign(userId, trackId, categoryId, assignmentId)
      if (!assigned.ok) {
        sendFailure(res, assigned)
        return
      }
      sendJson(res, 200, { assignment: assigned.value })
      return
    }
    if (method === 'DELETE') {
      const removed = library.unassign(userId, trackId, categoryId)
      if (!removed.ok) {
        sendFailure(res, removed)
        return
      }
      sendJson(res, 200, removed.value)
      return
    }
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }

  const trackMatch = path.match(/^\/api\/me\/collection\/tracks\/(.+)$/)
  if (trackMatch) {
    const trackId = safeDecode(trackMatch[1])
    if (!splitTrackId(trackId)) {
      sendJson(res, 404, { error: 'NOT_FOUND' })
      return
    }
    if (method === 'PUT') {
      const body = await readBody(req, res)
      if (body === undefined) return
      const parsed = validateTrackWrite(trackId, body)
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
        return
      }
      const saved = library.upsertTrack(userId, trackId, parsed.value)
      if (!saved.ok) {
        sendFailure(res, saved)
        return
      }
      sendJson(res, 200, { track: saved.value })
      return
    }
    if (method === 'DELETE') {
      const removed = library.deleteTrack(userId, trackId)
      if (!removed.ok) {
        sendFailure(res, removed)
        return
      }
      sendJson(res, 200, removed.value)
      return
    }
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }

  if (path === '/api/me/history') {
    if (!limit.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: limit.fields })
      return
    }
    if (method === 'GET') {
      sendJson(res, 200, { history: library.listHistory(userId, limit.value) })
      return
    }
    if (method === 'POST') {
      const body = await readBody(req, res)
      if (body === undefined) return
      const parsed = validateHistoryWrite(body)
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
        return
      }
      const created = library.appendHistory(userId, parsed.value)
      if (!created.ok) {
        sendFailure(res, created)
        return
      }
      sendJson(res, 201, { entry: created.value })
      return
    }
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }

  if (path === '/api/me/settings') {
    if (method === 'GET') {
      sendJson(res, 200, { settings: library.readSettings(userId) })
      return
    }
    if (method === 'PATCH') {
      const body = await readBody(req, res)
      if (body === undefined) return
      const parsed = validateSettingsPatch(body)
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
        return
      }
      sendJson(res, 200, { settings: library.updateSettings(userId, parsed.value) })
      return
    }
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }

  if (method === 'POST' && path === '/api/me/tracks/identity') {
    const body = await readBody(req, res)
    if (body === undefined) return
    const parsed = validateSourceSnapshot(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
      return
    }
    const ensured = identity.ensureSourceCopy(userId, parsed.value)
    if (!ensured.ok) {
      sendFailure(res, ensured)
      return
    }
    sendJson(res, 200, ensured.value)
    return
  }

  if (method === 'POST' && path === '/api/me/tracks/link') {
    const body = await readBody(req, res)
    if (body === undefined) return
    const parsed = validateLinkBody(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
      return
    }
    const linked = identity.linkSourceCopies(
      userId,
      parsed.value.sourceTrackKeyA,
      parsed.value.sourceTrackKeyB,
    )
    if (!linked.ok) {
      sendFailure(res, linked)
      return
    }
    sendJson(res, 200, linked.value)
    return
  }

  if (method === 'POST' && path === '/api/me/tracks/unlink') {
    const body = await readBody(req, res)
    if (body === undefined) return
    const parsed = validateUnlinkBody(body)
    if (!parsed.ok) {
      sendJson(res, 400, { error: 'VALIDATION', fields: parsed.fields })
      return
    }
    const detached = identity.unlinkSourceCopy(userId, parsed.value.sourceTrackKey)
    if (!detached.ok) {
      sendFailure(res, detached)
      return
    }
    sendJson(res, 200, detached.value)
    return
  }

  const identityMatch = path.match(/^\/api\/me\/tracks\/(.+)\/identity$/)
  if (identityMatch && method === 'GET') {
    const key = safeDecode(identityMatch[1])
    if (!splitTrackId(key)) {
      sendJson(res, 404, { error: 'NOT_FOUND' })
      return
    }
    const found = identity.readOrBackfill(userId, key)
    if (!found.ok) {
      sendFailure(res, found)
      return
    }
    sendJson(res, 200, found.value)
    return
  }

  sendJson(res, 404, { error: 'NOT_FOUND' })
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function readAssignmentId(body: unknown): string | null | false {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false
  }
  const record = body as Record<string, unknown>
  if (!('id' in record) || record.id == null) {
    return null
  }
  if (typeof record.id !== 'string' || !isClientId(record.id)) {
    return false
  }
  return record.id
}

async function readBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  try {
    return await readJsonBody(req)
  } catch {
    sendJson(res, 400, { error: 'VALIDATION', fields: { body: 'Некорректный JSON' } })
    return undefined
  }
}
