import { describe, expect, it } from 'vitest'
import {
  hasUserCollectionData,
  mergeSnapshots,
  operationsFromSnapshot,
  snapshotIsEmpty,
} from './merge'
import type { CollectionSnapshot } from '../../types/sync'

const empty: CollectionSnapshot = {
  categories: [],
  items: [],
  decisions: [],
  settings: null,
}

describe('mergeSnapshots', () => {
  it('does not let empty local wipe remote items', () => {
    const remote: CollectionSnapshot = {
      categories: [],
      items: [
        {
          id: 'like1',
          kind: 'like',
          trackId: 'mock:1',
          sourceId: 'mock',
          externalId: '1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      decisions: [],
      settings: null,
    }
    const merged = mergeSnapshots(empty, remote)
    expect(snapshotIsEmpty(merged)).toBe(false)
    expect(merged.items).toHaveLength(1)
  })

  it('keeps newer updated_at', () => {
    const local: CollectionSnapshot = {
      ...empty,
      categories: [
        {
          id: 'c1',
          name: 'local',
          color: '#000',
          icon: 'heart',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    }
    const remote: CollectionSnapshot = {
      ...empty,
      categories: [
        {
          id: 'c1',
          name: 'remote',
          color: '#fff',
          icon: 'heart',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-15T00:00:00.000Z',
        },
      ],
    }
    expect(mergeSnapshots(local, remote).categories[0]?.name).toBe('local')
  })

  it('detects user activity', () => {
    expect(hasUserCollectionData(empty)).toBe(false)
    expect(
      hasUserCollectionData({
        ...empty,
        decisions: [
          {
            id: 'd1',
            trackId: 'mock:1',
            sourceId: 'mock',
            externalId: '1',
            action: 'skip',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ).toBe(true)
  })

  it('uses stable operation ids so retries stay idempotent', () => {
    const snapshot: CollectionSnapshot = {
      ...empty,
      items: [
        {
          id: 'like1',
          kind: 'like',
          trackId: 'mock:1',
          sourceId: 'mock',
          externalId: '1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }
    const first = operationsFromSnapshot(snapshot)
    const second = operationsFromSnapshot(snapshot)
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id))
  })
})
