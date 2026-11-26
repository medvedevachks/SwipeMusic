import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanonicalLibraryItem } from '../types/canonical.ts'
import { useCanonicalLibraryStore } from './canonicalLibraryStore.ts'

function item(id: string, copies: number): CanonicalLibraryItem {
  return {
    canonicalTrack: {
      id,
      title: id,
      artist: 'A',
      album: null,
      durationMs: 1,
      artworkUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    copies: Array.from({ length: copies }, (_, index) => ({
      sourceTrackKey: `yandex-music:${id}-${index}`,
      canonicalTrackId: id,
      sourceId: 'yandex-music',
      externalId: `${id}-${index}`,
      title: id,
      artist: 'A',
      album: null,
      durationMs: 1,
      artworkUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
    state: {
      addedAt: '2026-01-01T00:00:00.000Z',
      lastPlayed: null,
      playCount: 0,
      liked: false,
      likedAt: null,
      disliked: false,
      skipped: 0,
      notes: '',
      favorite: false,
      hidden: false,
      customMetadata: {},
    },
    catalogIds: [],
    sourceFavoriteSourceIds: ['yandex-music'],
  }
}

test('replaceForUser indexes 10k compositions without quadratic blow-up', () => {
  const items = Array.from({ length: 10_000 }, (_, index) => item(`can_${index}`, 1))
  const started = Date.now()
  useCanonicalLibraryStore.getState().replaceForUser('user-load', items)
  const elapsed = Date.now() - started
  const state = useCanonicalLibraryStore.getState()
  assert.equal(Object.keys(state.itemsById).length, 10_000)
  assert.equal(Object.keys(state.sourceKeyToCanonicalId).length, 10_000)
  assert.equal(state.sourceKeyToCanonicalId['yandex-music:can_9999-0'], 'can_9999')
  // Линейный проход должен укладываться с большим запасом на CI.
  assert.ok(elapsed < 5_000, `replaceForUser took ${elapsed}ms`)
  useCanonicalLibraryStore.getState().clear()
})
