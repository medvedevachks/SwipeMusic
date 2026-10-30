import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types/track.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionEngineStore } from '../../store/collectionEngineStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { classifySwipeTrack } from './classifySwipeTrack.ts'
import {
  hasPendingSwipeLike,
  resetPendingSwipeLikesForTests,
} from './pendingSwipeLike.ts'

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
  resetPendingSwipeLikesForTests()
  useCanonicalLibraryStore.getState().clear()
  useCollectionStore.getState().clearUserLibrary()
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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

test('LEFT→UP while like Promise pending: no skip; intent cleared after success', async () => {
  reset()
  const a = track('20')
  const gate = deferred<boolean>()
  let commitCalls = 0
  const skipsBefore = useCollectionEngineStore.getState().stats.totalSkips

  const like = classifySwipeTrack(a, 'like', {
    commitLike: async () => {
      commitCalls += 1
      return gate.promise
    },
  })
  assert.equal(like.kind, 'applied')
  assert.equal(hasPendingSwipeLike(a.id), true)

  const up = classifySwipeTrack(a, 'skip')
  assert.equal(up.kind, 'applied')
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'skip'),
    false,
  )
  assert.equal(useCollectionEngineStore.getState().stats.totalSkips, skipsBefore)

  // UP не ждёт сервер — pending ещё жив.
  assert.equal(hasPendingSwipeLike(a.id), true)
  gate.resolve(true)
  assert.equal(await like.saved, true)
  assert.equal(hasPendingSwipeLike(a.id), false)
  assert.equal(commitCalls, 1)
})

test('LEFT→UP while like pending then failure: no skip; no fake liked; retry LEFT allowed', async () => {
  reset()
  const a = track('21')
  const gate = deferred<boolean>()
  let commitCalls = 0

  const like = classifySwipeTrack(a, 'like', {
    commitLike: async () => {
      commitCalls += 1
      return gate.promise
    },
  })
  classifySwipeTrack(a, 'skip')
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'skip'),
    false,
  )

  gate.resolve(false)
  assert.equal(await like.saved, false)
  assert.equal(hasPendingSwipeLike(a.id), false)
  assert.equal(useCanonicalLibraryStore.getState().itemsById.can_a, undefined)

  // После ошибки UP без нового like — обычный skip.
  const laterSkip = classifySwipeTrack(a, 'skip')
  assert.equal(laterSkip.kind, 'applied')
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'skip'),
    true,
  )

  // Повтор LEFT снова регистрирует intent (без фиктивного success).
  const gate2 = deferred<boolean>()
  const retry = classifySwipeTrack(a, 'like', {
    commitLike: async () => {
      commitCalls += 1
      return gate2.promise
    },
  })
  assert.equal(hasPendingSwipeLike(a.id), true)
  gate2.resolve(true)
  assert.equal(await retry.saved, true)
  assert.equal(commitCalls, 2)
})

test('rapid double LEFT shares one pending intent and one commitLike call path', async () => {
  reset()
  const a = track('22')
  const gate = deferred<boolean>()
  let commitCalls = 0
  const commitLike = async () => {
    commitCalls += 1
    return gate.promise
  }

  const first = classifySwipeTrack(a, 'like', { commitLike })
  const second = classifySwipeTrack(a, 'like', { commitLike })
  assert.equal(hasPendingSwipeLike(a.id), true)
  classifySwipeTrack(a, 'skip')
  assert.equal(
    useCollectionStore.getState().history.filter((entry) => entry.action === 'skip')
      .length,
    0,
  )

  gate.resolve(true)
  assert.equal(await first.saved, true)
  assert.equal(await second.saved, true)
  // Два вызова classify с подменой = два вызова commitLike (дедуп — в commitSwipeLike).
  // Здесь проверяем, что skip не записан и intent снят после settle обоих.
  assert.equal(commitCalls, 2)
  assert.equal(hasPendingSwipeLike(a.id), false)
})

test('rejected like Promise clears pending and does not invent success', async () => {
  reset()
  const a = track('23')
  const gate = deferred<boolean>()
  const like = classifySwipeTrack(a, 'like', {
    commitLike: () => gate.promise,
  })
  assert.equal(hasPendingSwipeLike(a.id), true)
  gate.reject(new Error('network'))
  await assert.rejects(async () => await like.saved)
  assert.equal(hasPendingSwipeLike(a.id), false)
  assert.equal(
    useCollectionStore.getState().history.some((entry) => entry.action === 'like'),
    false,
  )
})
