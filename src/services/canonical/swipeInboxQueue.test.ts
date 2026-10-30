import assert from 'node:assert/strict'
import test from 'node:test'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { CanonicalLibraryItem, SourceCopy } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { getPlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  findQueueTrackIdForCanonical,
  removeSortedCanonicalFromSwipesQueue,
} from './swipeInboxQueue.ts'

const NOW = '2024-06-01T00:00:00.000Z'

function installMemoryLocalStorage(): void {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
    },
  })
}

function copy(
  sourceId: string,
  externalId: string,
  canonicalId: string,
): SourceCopy {
  return {
    sourceTrackKey: `${sourceId}:${externalId}`,
    canonicalTrackId: canonicalId,
    sourceId,
    externalId,
    title: 'Город',
    artist: 'Север',
    album: null,
    durationMs: 180_000,
    artworkUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function item(): CanonicalLibraryItem {
  return {
    canonicalTrack: {
      id: 'can_x',
      title: 'Город',
      artist: 'Север',
      album: null,
      durationMs: 180_000,
      artworkUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies: [
      copy('spotify', 'sp-1', 'can_x'),
      copy('yandex-music', 'ya-1', 'can_x'),
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
    catalogIds: ['sys_swipes'],
  }
}

function yandexPlaying(): Track {
  return {
    id: 'yandex-music:ya-1',
    sourceId: 'yandex-music',
    externalId: 'ya-1',
    title: 'Город',
    artist: 'Север',
  }
}

test('queue removal matches playing SourceCopy, not preferred list copy', () => {
  installMemoryLocalStorage()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [item()])
  const queue = getPlaybackQueue()
  queue.setQueue([yandexPlaying()], 0, {
    type: 'playlist',
    id: 'sys_swipes',
    title: 'Свайпы',
  })

  assert.equal(findQueueTrackIdForCanonical('can_x'), 'yandex-music:ya-1')
  removeSortedCanonicalFromSwipesQueue('can_x')
  assert.deepEqual(queue.getPendingRemovalIds(), ['yandex-music:ya-1'])
  assert.equal(queue.current()?.id, 'yandex-music:ya-1')

  // Spotify preferred id must not be required.
  assert.equal(
    queue.getSnapshot().items.some((row) => row.id === 'spotify:sp-1'),
    false,
  )
  useCanonicalLibraryStore.getState().clear()
  queue.clear()
})

test('foreign context is not modified', () => {
  installMemoryLocalStorage()
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [item()])
  const queue = getPlaybackQueue()
  queue.setQueue([yandexPlaying()], 0, {
    type: 'search-seed',
    query: 'x',
    seedTrackId: 'yandex-music:ya-1',
  })
  removeSortedCanonicalFromSwipesQueue('can_x')
  assert.deepEqual(queue.getPendingRemovalIds(), [])
  assert.equal(queue.current()?.id, 'yandex-music:ya-1')
  useCanonicalLibraryStore.getState().clear()
  queue.clear()
})
