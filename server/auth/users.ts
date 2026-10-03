import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { RegisterInput } from './validation.ts'

export type PublicUser = {
  id: string
  firstName: string
  lastName: string
  email: string
  createdAt: string
}

type UserRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  password_hash: string
  created_at: string
  updated_at: string
}

export type UserRecord = PublicUser & {
  passwordHash: string
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
  }
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    createdAt: user.createdAt,
  }
}

export function createUserRepository(db: DatabaseSync) {
  const insert = db.prepare(`
    INSERT INTO users (id, first_name, last_name, email, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const byEmail = db.prepare(`
    SELECT id, first_name, last_name, email, password_hash, created_at, updated_at
    FROM users WHERE email = ?
  `)
  const byId = db.prepare(`
    SELECT id, first_name, last_name, email, password_hash, created_at, updated_at
    FROM users WHERE id = ?
  `)

  return {
    create(input: RegisterInput, passwordHash: string): UserRecord {
      const now = new Date().toISOString()
      const id = randomUUID()
      insert.run(
        id,
        input.firstName,
        input.lastName,
        input.email,
        passwordHash,
        now,
        now,
      )
      return {
        id,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        createdAt: now,
        passwordHash,
      }
    },

    findByEmail(email: string): UserRecord | null {
      const row = byEmail.get(email) as UserRow | undefined
      return row ? toRecord(row) : null
    },

    findById(id: string): UserRecord | null {
      const row = byId.get(id) as UserRow | undefined
      return row ? toRecord(row) : null
    },
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const code = (error as { errcode?: number }).errcode
  return code === 19 || /UNIQUE constraint failed/i.test(error.message)
}
