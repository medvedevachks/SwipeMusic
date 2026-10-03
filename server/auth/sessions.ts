import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export const SESSION_COOKIE = 'sm_session'

type SessionRow = {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  created_at: string
  last_used_at: string
}

export type SessionRecord = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  createdAt: string
  lastUsedAt: string
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
}

export function createSessionRepository(db: DatabaseSync, ttlMs: number) {
  const insert = db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const byHash = db.prepare(`
    SELECT id, user_id, token_hash, expires_at, created_at, last_used_at
    FROM sessions WHERE token_hash = ?
  `)
  const touch = db.prepare(`UPDATE sessions SET last_used_at = ? WHERE id = ?`)
  const remove = db.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
  const removeUser = db.prepare(`DELETE FROM sessions WHERE user_id = ?`)

  return {
    create(userId: string): { token: string; session: SessionRecord } {
      const now = new Date()
      const token = randomBytes(32).toString('base64url')
      const session: SessionRecord = {
        id: randomUUID(),
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        createdAt: now.toISOString(),
        lastUsedAt: now.toISOString(),
      }
      insert.run(
        session.id,
        session.userId,
        session.tokenHash,
        session.expiresAt,
        session.createdAt,
        session.lastUsedAt,
      )
      return { token, session }
    },

    findByToken(token: string): SessionRecord | null {
      const row = byHash.get(hashToken(token)) as SessionRow | undefined
      return row ? toRecord(row) : null
    },

    touch(sessionId: string): void {
      touch.run(new Date().toISOString(), sessionId)
    },

    deleteByToken(token: string): void {
      remove.run(hashToken(token))
    },

    deleteAllForUser(userId: string): void {
      removeUser.run(userId)
    },

    isExpired(session: SessionRecord, now = Date.now()): boolean {
      return Date.parse(session.expiresAt) <= now
    },
  }
}
