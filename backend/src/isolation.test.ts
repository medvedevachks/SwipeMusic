import { describe, expect, it } from 'vitest'
import { createDb } from './db/client.ts'
import { user } from './db/schema.ts'
import { applyOperations, loadSnapshot, parseTrackIdentity } from './sync/engine.ts'

describe('parseTrackIdentity', () => {
  it('splits source and external id', () => {
    expect(parseTrackIdentity('mock:abc')).toEqual({
      sourceId: 'mock',
      externalId: 'abc',
    })
  })

  it('rejects ids without a source prefix', () => {
    expect(() => parseTrackIdentity('nocolon')).toThrow()
    expect(() => parseTrackIdentity(':only')).toThrow()
    expect(() => parseTrackIdentity('source:')).toThrow()
  })
})

const databaseUrl = process.env.DATABASE_URL
const runDbTests = process.env.RUN_DB_TESTS === 'true' && Boolean(databaseUrl)

describe.skipIf(!runDbTests)('user isolation and sync replay', () => {
  it('keeps collections isolated and ignores replayed operations', async () => {
    const { db, sql } = createDb(databaseUrl as string)
    const suffix = crypto.randomUUID()
    const userA = `a-${suffix}`
    const userB = `b-${suffix}`
    const now = new Date().toISOString()

    try {
      await db.insert(user).values([
        {
          id: userA,
          name: 'Anna Alpha',
          email: `a-${suffix}@example.com`,
          firstName: 'Anna',
          lastName: 'Alpha',
        },
        {
          id: userB,
          name: 'Boris Beta',
          email: `b-${suffix}@example.com`,
          firstName: 'Boris',
          lastName: 'Beta',
        },
      ])

      const operation = {
        id: `op-${suffix}`,
        type: 'upsert_category' as const,
        payload: {
          id: `cat-${suffix}`,
          name: 'Secret',
          color: '#111111',
          icon: 'heart',
          createdAt: now,
          updatedAt: now,
        },
        clientCreatedAt: now,
      }

      const first = await applyOperations(db, userA, [operation])
      const replay = await applyOperations(db, userA, [operation])
      expect(first.accepted).toContain(operation.id)
      expect(replay.duplicates).toContain(operation.id)

      const snapshotA = await loadSnapshot(db, userA)
      const snapshotB = await loadSnapshot(db, userB)
      expect(snapshotA.categories.some((item) => item.name === 'Secret')).toBe(true)
      expect(snapshotB.categories.some((item) => item.name === 'Secret')).toBe(false)
    } finally {
      await sql.end({ timeout: 5 })
    }
  })
})
