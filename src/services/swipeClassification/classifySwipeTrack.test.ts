import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionEngineStore } from '../../store/collectionEngineStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { classifySwipeTrack } from './classifySwipeTrack.ts'

const NOW = '2026-10-30T00:00:00.000Z'

function track(id: string): Track {
  return {
    id: `yandex-music:${id}`,
    sourceId: 'yandex-music',
    externalId: id,
    title: `T${id}`,
    artist: 'Artist',
  }
}

function seedLiked(item: Track): void {
  useCanonicalLibraryStore.getState().replaceForUser('u1', [
    {
      canonicalTrack: {
        id: 'can_a',
        title: item.title,
        artist: item.artist,
        album: null,
        durationMs: null,
        artworkUrl: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      copies: [
        {
          sourceTrackKey: item.id,
          canonicalTrackId: 'can_a',
          sourceId: item.sourceId,
          externalId: item.externalId,
          title: item.title,
          artist: item.artist,
          album: null,
          durationMs: null,
          artworkUrl: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      state: {
        addedAt: NOW,
        lastPlayed: null,
        playCount: 0,
        liked: true,
        likedAt: NOW,
        disliked: false,
        skipped: 0,
        notes: '',
        favorite: false,
        hidden: false,
        customMetadata: {},
      },
      catalogIds: [SYS_SWIPES_ID],
    },
  ])
}

function reset(): void {
  useCanonicalLibraryStore.getState().clear()
  useCollectionStore.getState().clearUserLibrary()
}

test('UP skip without like records skip signal', () => {
  reset()
  const a = track('10')
  const skipsBefore = useCollectionEngineStore.getState().stats.totalSkips
  const result = classifySwipeTrack(a, 'skip')
  assert.equal(result.kind, 'applied')
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'skip'),
    true,
  )
  assert.ok(useCollectionEngineStore.getState().stats.totalSkips > skipsBefore)
})

test('UP after like does not markSkipped or history-skip', () => {
  reset()
  const a = track('11')
  seedLiked(a)
  const before = useCanonicalLibraryStore.getState().itemsById.can_a
  assert.equal(before?.state.liked, true)
  assert.deepEqual(before?.catalogIds, [SYS_SWIPES_ID])
  const skipsBefore = useCollectionEngineStore.getState().stats.totalSkips

  const result = classifySwipeTrack(a, 'skip')
  assert.equal(result.kind, 'applied')
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'skip'),
    false,
  )
  assert.equal(useCollectionEngineStore.getState().stats.totalSkips, skipsBefore)
  const after = useCanonicalLibraryStore.getState().itemsById.can_a
  assert.equal(after?.state.liked, true)
  assert.deepEqual(after?.catalogIds, [SYS_SWIPES_ID])
})

test('LEFT then immediate UP while liked: no skip signal (pending-save race)', () => {
  reset()
  const a = track('12')
  // Лайк уже в store (успешный ответ или идемпотентный commit) до завершения анимации.
  seedLiked(a)
  const like = classifySwipeTrack(a, 'like')
  assert.equal(like.kind, 'applied')
  const up = classifySwipeTrack(a, 'skip')
  assert.equal(up.kind, 'applied')
  assert.equal(
    useCollectionStore.getState().history.filter((entry) => entry.action === 'skip').length,
    0,
  )
  assert.equal(useCanonicalLibraryStore.getState().itemsById.can_a?.state.liked, true)
})
