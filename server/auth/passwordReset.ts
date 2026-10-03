import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

const RESET_TTL_MS = 30 * 60 * 1000

type ResetRow = {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  created_at: string
  used_at: string | null
}

export type PasswordResetRecord = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: string
  createdAt: string
  usedAt: string | null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toRecord(row: ResetRow): PasswordResetRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    usedAt: row.used_at,
  }
}

export function createPasswordResetRepository(db: DatabaseSync) {
  const invalidate = db.prepare(`
    UPDATE password_reset_tokens
    SET used_at = ?
    WHERE user_id = ? AND used_at IS NULL
  `)
  const insert = db.prepare(`
    INSERT INTO password_reset_tokens
      (id, user_id, token_hash, expires_at, created_at, used_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `)
  const byHash = db.prepare(`
    SELECT id, user_id, token_hash, expires_at, created_at, used_at
    FROM password_reset_tokens
    WHERE token_hash = ?
  `)
  const markUsed = db.prepare(`
    UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL
  `)

  return {
    issue(userId: string, now = new Date()): { token: string; record: PasswordResetRecord } {
      const createdAt = now.toISOString()
      invalidate.run(createdAt, userId)
      const token = randomBytes(32).toString('base64url')
      const record: PasswordResetRecord = {
        id: randomUUID(),
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + RESET_TTL_MS).toISOString(),
        createdAt,
        usedAt: null,
      }
      insert.run(
        record.id,
        record.userId,
        record.tokenHash,
        record.expiresAt,
        record.createdAt,
      )
      return { token, record }
    },

    findByToken(token: string): PasswordResetRecord | null {
      const row = byHash.get(hashToken(token)) as ResetRow | undefined
      return row ? toRecord(row) : null
    },

    isUsable(record: PasswordResetRecord, now = Date.now()): boolean {
      return record.usedAt == null && Date.parse(record.expiresAt) > now
    },

    markUsed(id: string, now = new Date()): boolean {
      const result = markUsed.run(now.toISOString(), id)
      return Number(result.changes) > 0
    },
  }
}
