import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { filterQueueToLiveCatalogMembership } from './liveCatalogQueue.ts'
import type { CatalogQueueEntry } from './buildCatalogPlaybackQueue.ts'

const NOW = '2024-06-01T00:00:00.000Z'

function item(
  id: string,
  catalogIds: string[],
): CanonicalLibraryItem {
  return {
    canonicalTrack: {
      id,
      title: id,
      artist: 'A',
      album: null,
      durationMs: 1000,
      artworkUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies: [
      {
        sourceTrackKey: `yandex-music:${id}`,
        canonicalTrackId: id,
        sourceId: 'yandex-music',
        externalId: id,
        title: id,
        artist: 'A',
        album: null,
        durationMs: 1000,
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
    catalogIds,
  }
}

function entry(id: string): CatalogQueueEntry {
  return {
    canonicalTrackId: id,
    track: {
      id: `yandex-music:${id}`,
      sourceId: 'yandex-music',
      externalId: id,
      title: id,
      artist: 'A',
    },
    selection: {
      canonicalTrackId: id,
      selectedCopy: null,
      selectedTrack: null,
      availability: {
        canonicalTrackId: id,
        status: 'PLAYABLE',
        copies: [],
        checkedAt: NOW,
      },
      reason: 'SELECTED',
    },
  } as CatalogQueueEntry
}

test('stale expand queue drops tracks that left sys_swipes', () => {
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item('can_a', ['sys_swipes']),
    item('can_b', ['cat_party']),
    item('can_c', ['sys_swipes']),
  ])
  const live = filterQueueToLiveCatalogMembership('sys_swipes', [
    entry('can_a'),
    entry('can_b'),
    entry('can_c'),
  ])
  assert.deepEqual(
    live.map((row) => row.canonicalTrackId),
    ['can_a', 'can_c'],
  )
  useCanonicalLibraryStore.getState().clear()
})
