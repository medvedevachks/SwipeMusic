import type { DatabaseSync } from 'node:sqlite'

export type ProviderConnectionRow = {
  user_id: string
  provider_id: string
  encrypted_session: string
  created_at: string
  updated_at: string
}

export function createProviderConnectionRepository(db: DatabaseSync) {
  const getStmt = db.prepare(`
    SELECT user_id, provider_id, encrypted_session, created_at, updated_at
    FROM user_provider_connections
    WHERE user_id = ? AND provider_id = ?
  `)
  const saveStmt = db.prepare(`
    INSERT INTO user_provider_connections (
      user_id, provider_id, encrypted_session, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, provider_id) DO UPDATE SET
      encrypted_session = excluded.encrypted_session,
      updated_at = excluded.updated_at
  `)
  const deleteStmt = db.prepare(`
    DELETE FROM user_provider_connections
    WHERE user_id = ? AND provider_id = ?
  `)

  return {
    get(userId: string, providerId: string): ProviderConnectionRow | null {
      const row = getStmt.get(userId, providerId) as ProviderConnectionRow | undefined
      return row ?? null
    },

    save(
      userId: string,
      providerId: string,
      encryptedSession: string,
      now: string,
    ): void {
      const existing = getStmt.get(userId, providerId) as ProviderConnectionRow | undefined
      saveStmt.run(
        userId,
        providerId,
        encryptedSession,
        existing?.created_at ?? now,
        now,
      )
    },

    delete(userId: string, providerId: string): void {
      deleteStmt.run(userId, providerId)
    },
  }
}
