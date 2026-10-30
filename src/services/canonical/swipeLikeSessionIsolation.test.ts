import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  CanonicalLibraryItem,
  SourceCopySnapshot,
  TrackIdentity,
} from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import {
  bindAuthSessionEpoch,
  resetAuthSessionEpochForTests,
} from '../auth/sessionEpoch.ts'
import {
  SAVE_FAILED_MESSAGE,
  useLibraryPersistenceStore,
} from '../libraryPersistence/statusStore.ts'
import { classifySwipeTrack } from '../swipeClassification/classifySwipeTrack.ts'
import {
  hasPendingSwipeLike,
  resetPendingSwipeLikesForTests,
} from '../swipeClassification/pendingSwipeLike.ts'
import { commitSwipeLikeWithInbox } from './swipeInbox.ts'
import {
  clearCanonicalIdentityFlights,
  setCanonicalRemote,
} from './userOrganization.ts'

const NOW = '2026-10-30T00:00:00.000Z'

function trackA(): Track {
  return {
    id: 'yandex-music:iso-a',
    sourceId: 'yandex-music',
    externalId: 'iso-a',
    title: 'Iso A',
    artist: 'Artist',
  }
}

function identityFor(track: Track, canonicalId: string): TrackIdentity {
  return {
    canonicalTrack: {
      id: canonicalId,
      title: track.title,
      artist: track.artist,
      album: null,
      durationMs: null,
      artworkUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies: [
      {
        sourceTrackKey: track.id,
        canonicalTrackId: canonicalId,
        sourceId: track.sourceId,
        externalId: track.externalId,
        title: track.title,
        artist: track.artist,
        album: null,
        durationMs: null,
        artworkUrl: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  }
}

function likedItem(track: Track, canonicalId: string): CanonicalLibraryItem {
  const identity = identityFor(track, canonicalId)
  return {
    canonicalTrack: identity.canonicalTrack,
    copies: identity.copies,
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

function emptyItem(id: string, title: string): CanonicalLibraryItem {
  return {
    canonicalTrack: {
      id,
      title,
      artist: 'B',
      album: null,
      durationMs: null,
      artworkUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies: [],
    state: {
      addedAt: NOW,
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
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function reset(): void {
  resetPendingSwipeLikesForTests()
  clearCanonicalIdentityFlights()
  setCanonicalRemote(null)
  resetAuthSessionEpochForTests()
  useCanonicalLibraryStore.getState().clear()
  useCollectionStore.getState().clearUserLibrary()
  useLibraryPersistenceStore.setState({
    armed: false,
    status: 'idle',
    message: null,
  })
}

test('LEFT pending → logout A → login B: stale like does not write B store or SAVE_FAILED', async () => {
  reset()
  const track = trackA()
  bindAuthSessionEpoch('user-a')
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [])

  const patchGate = deferred<{ item: CanonicalLibraryItem }>()
  let releasePatchStarted!: () => void
  const patchStarted = new Promise<void>((resolve) => {
    releasePatchStarted = resolve
  })
  let patchCalls = 0
  setCanonicalRemote({
    ensureIdentity: async (_snapshot: SourceCopySnapshot) =>
      identityFor(track, 'can_iso_a'),
    patchCanonicalLiked: async () => {
      patchCalls += 1
      releasePatchStarted()
      return patchGate.promise
    },
    assignCanonical: async () => {
      throw new Error('assign should not run after stale like')
    },
    unassignCanonical: async () => undefined,
  })

  const like = classifySwipeTrack(track, 'like')
  assert.equal(hasPendingSwipeLike(track.id), true)
  await patchStarted
  assert.equal(patchCalls, 1)

  clearCanonicalIdentityFlights()
  useCanonicalLibraryStore.getState().clear()
  useCollectionStore.getState().clearUserLibrary()
  useLibraryPersistenceStore.setState({
    armed: false,
    status: 'idle',
    message: null,
  })
  bindAuthSessionEpoch(null)
  assert.equal(hasPendingSwipeLike(track.id), false)

  bindAuthSessionEpoch('user-b')
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })
  useCanonicalLibraryStore
    .getState()
    .replaceForUser('user-b', [emptyItem('can_b_only', 'B only')])

  patchGate.resolve({ item: likedItem(track, 'can_iso_a') })
  assert.equal(await like.saved, false)
  assert.equal(patchCalls, 1)

  const store = useCanonicalLibraryStore.getState()
  assert.equal(store.userId, 'user-b')
  assert.equal(store.itemsById.can_iso_a, undefined)
  assert.ok(store.itemsById.can_b_only)
  assert.equal(useLibraryPersistenceStore.getState().message, null)
  assert.notEqual(
    useLibraryPersistenceStore.getState().message,
    SAVE_FAILED_MESSAGE,
  )
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'like'),
    false,
  )

  const up = classifySwipeTrack(track, 'skip')
  assert.equal(up.kind, 'applied')
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'skip'),
    true,
  )
  reset()
})

test('commitSwipeLikeWithInbox rejects after session switch before store write', async () => {
  reset()
  const track = trackA()
  bindAuthSessionEpoch('user-a')
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })

  const patchGate = deferred<{ item: CanonicalLibraryItem }>()
  setCanonicalRemote({
    ensureIdentity: async () => identityFor(track, 'can_iso_a'),
    patchCanonicalLiked: async () => patchGate.promise,
    assignCanonical: async () => {
      throw new Error('should not assign for stale session')
    },
    unassignCanonical: async () => undefined,
  })

  const pending = commitSwipeLikeWithInbox(track)
  clearCanonicalIdentityFlights()
  bindAuthSessionEpoch('user-b')
  useCanonicalLibraryStore.getState().replaceForUser('user-b', [])
  useLibraryPersistenceStore.setState({
    armed: true,
    status: 'ready',
    message: null,
  })

  patchGate.resolve({ item: likedItem(track, 'can_iso_a') })
  assert.equal(await pending, false)
  assert.equal(useCanonicalLibraryStore.getState().itemsById.can_iso_a, undefined)
  assert.equal(useLibraryPersistenceStore.getState().message, null)
  reset()
})
