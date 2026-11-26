import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  bindAuthSessionEpoch,
  resetAuthSessionEpochForTests,
} from '../auth/sessionEpoch.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import {
  SOURCE_FAVORITES_CHUNK,
  syncSourceFavorites,
  syncSourceFavoritesFromTracks,
} from './syncSourceFavorites.ts'

const here = dirname(fileURLToPath(import.meta.url))

test('source favorites sync uses server syncId lifecycle', () => {
  assert.ok(SOURCE_FAVORITES_CHUNK >= 20)
  assert.ok(SOURCE_FAVORITES_CHUNK <= 100)
  const source = readFileSync(join(here, 'syncSourceFavorites.ts'), 'utf8')
  assert.match(source, /startSourceFavoritesSync/)
  assert.match(source, /upsertSourceFavoritesChunk/)
  assert.match(source, /completeSourceFavoritesSync/)
  assert.match(source, /captureAuthSession/)
  assert.match(source, /isAuthSessionCurrent/)
  assert.equal(source.includes('seenAt'), false)
  assert.equal(source.includes('finalize:'), false)
})

test('Yandex syncLibrary streams liked refs without full pre-buffer', () => {
  const adapter = readFileSync(
    join(here, '../../sources/adapters/yandex-music/YandexMusicAdapter.ts'),
    'utf8',
  )
  const api = readFileSync(
    join(here, '../../sources/adapters/yandex-music/api.ts'),
    'utf8',
  )
  assert.match(adapter, /getLikedTrackRefs/)
  assert.match(adapter, /listComplete: likedRefsComplete/)
  assert.match(adapter, /iterateTracksByIds/)
  assert.match(api, /async \*iterateTracksByIds/)
  assert.match(api, /getLikedTrackRefs/)
})

test('API routes encode start/chunk/complete syncId flow', () => {
  const routes = readFileSync(
    join(here, '../../../server/http/libraryRoutes.ts'),
    'utf8',
  )
  const schema = readFileSync(join(here, '../../../server/db/database.ts'), 'utf8')
  assert.match(routes, /favorites\\\/sync\\\/start/)
  assert.match(routes, /favorites\\\/sync\\\/complete/)
  assert.match(routes, /sourceFavorites\.start\(/)
  assert.match(routes, /sourceFavorites\.upsertChunk\(/)
  assert.match(routes, /sourceFavorites\.complete\(/)
  assert.ok(schema.includes('user_source_favorite_syncs'))
  assert.ok(schema.includes('sync_id'))
})

test('auth session change aborts import before store write', async () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-a')
  useCanonicalLibraryStore.getState().clear()

  const calls: string[] = []
  const original = await import('../libraryPersistence/client.ts')
  const client = original.libraryClient
  const prevStart = client.startSourceFavoritesSync
  const prevUpsert = client.upsertSourceFavoritesChunk
  const prevComplete = client.completeSourceFavoritesSync
  const prevLoad = client.loadCanonicalLibrary

  client.startSourceFavoritesSync = async () => {
    calls.push('start')
    return {
      sourceId: 'yandex-music',
      syncId: 'sync_test',
      startedAt: '2026-11-26T00:00:00.000Z',
    }
  }
  client.upsertSourceFavoritesChunk = async () => {
    calls.push('upsert')
    // Смена аккаунта mid-flight.
    bindAuthSessionEpoch('user-b')
    return { sourceId: 'yandex-music', syncId: 'sync_test', upserted: 1 }
  }
  client.completeSourceFavoritesSync = async () => {
    calls.push('complete')
    return { sourceId: 'yandex-music', syncId: 'sync_test', pruned: 0 }
  }
  client.loadCanonicalLibrary = async () => {
    calls.push('load')
    return { items: [] }
  }

  try {
    const result = await syncSourceFavoritesFromTracks({
      sourceId: 'yandex-music',
      tracks: [
        {
          id: 'yandex-music:1',
          sourceId: 'yandex-music',
          externalId: '1',
          title: 'T',
          artist: 'A',
        },
      ],
    })
    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.message, 'auth-session-changed')
    }
    assert.ok(calls.includes('start'))
    assert.ok(calls.includes('upsert'))
    assert.equal(calls.includes('complete'), false)
    assert.equal(calls.includes('load'), false)
    assert.equal(useCanonicalLibraryStore.getState().userId, null)
  } finally {
    client.startSourceFavoritesSync = prevStart
    client.upsertSourceFavoritesChunk = prevUpsert
    client.completeSourceFavoritesSync = prevComplete
    client.loadCanonicalLibrary = prevLoad
    resetAuthSessionEpochForTests()
    useCanonicalLibraryStore.getState().clear()
  }
})

test('incomplete list does not start sync or prune', async () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-a')
  const calls: string[] = []
  const { libraryClient } = await import('../libraryPersistence/client.ts')
  const prevStart = libraryClient.startSourceFavoritesSync
  libraryClient.startSourceFavoritesSync = async () => {
    calls.push('start')
    return {
      sourceId: 'yandex-music',
      syncId: 'sync_x',
      startedAt: '2026-11-26T00:00:00.000Z',
    }
  }
  try {
    const result = await syncSourceFavorites({
      sourceId: 'yandex-music',
      source: {
        listComplete: false,
        batches: (async function* () {
          yield [
            {
              id: 'yandex-music:1',
              sourceId: 'yandex-music',
              externalId: '1',
              title: 'T',
              artist: 'A',
            },
          ]
        })(),
      },
    })
    assert.deepEqual(result, { status: 'skipped', reason: 'list-incomplete' })
    assert.deepEqual(calls, [])
  } finally {
    libraryClient.startSourceFavoritesSync = prevStart
    resetAuthSessionEpochForTests()
  }
})

test('confirmed empty collection still completes and may prune', async () => {
  resetAuthSessionEpochForTests()
  bindAuthSessionEpoch('user-a')
  const calls: string[] = []
  const { libraryClient, LibraryHttpError } = await import(
    '../libraryPersistence/client.ts'
  )
  const prevStart = libraryClient.startSourceFavoritesSync
  const prevUpsert = libraryClient.upsertSourceFavoritesChunk
  const prevComplete = libraryClient.completeSourceFavoritesSync
  const prevLoad = libraryClient.loadCanonicalLibrary

  libraryClient.startSourceFavoritesSync = async () => {
    calls.push('start')
    return {
      sourceId: 'yandex-music',
      syncId: 'sync_empty',
      startedAt: '2026-11-26T00:00:00.000Z',
    }
  }
  libraryClient.upsertSourceFavoritesChunk = async () => {
    calls.push('upsert')
    return { sourceId: 'yandex-music', syncId: 'sync_empty', upserted: 0 }
  }
  libraryClient.completeSourceFavoritesSync = async () => {
    calls.push('complete')
    return { sourceId: 'yandex-music', syncId: 'sync_empty', pruned: 3 }
  }
  libraryClient.loadCanonicalLibrary = async () => {
    calls.push('load')
    return { items: [] }
  }

  try {
    const result = await syncSourceFavoritesFromTracks({
      sourceId: 'yandex-music',
      tracks: [],
      listComplete: true,
    })
    assert.equal(result.status, 'synced')
    if (result.status === 'synced') {
      assert.equal(result.upserted, 0)
      assert.equal(result.pruned, 3)
    }
    assert.deepEqual(calls, ['start', 'complete', 'load'])
  } finally {
    libraryClient.startSourceFavoritesSync = prevStart
    libraryClient.upsertSourceFavoritesChunk = prevUpsert
    libraryClient.completeSourceFavoritesSync = prevComplete
    libraryClient.loadCanonicalLibrary = prevLoad
    resetAuthSessionEpochForTests()
  }

  // API error surface: stale syncId → 409 mapped without prune/load.
  bindAuthSessionEpoch('user-a')
  const staleCalls: string[] = []
  libraryClient.startSourceFavoritesSync = async () => {
    staleCalls.push('start')
    return {
      sourceId: 'yandex-music',
      syncId: 'sync_stale',
      startedAt: '2026-11-26T00:00:00.000Z',
    }
  }
  libraryClient.upsertSourceFavoritesChunk = async () => {
    staleCalls.push('upsert')
    throw new LibraryHttpError(409)
  }
  libraryClient.completeSourceFavoritesSync = async () => {
    staleCalls.push('complete')
    return { sourceId: 'yandex-music', syncId: 'sync_stale', pruned: 0 }
  }
  libraryClient.loadCanonicalLibrary = async () => {
    staleCalls.push('load')
    return { items: [] }
  }
  try {
    const result = await syncSourceFavoritesFromTracks({
      sourceId: 'yandex-music',
      tracks: [
        {
          id: 'yandex-music:9',
          sourceId: 'yandex-music',
          externalId: '9',
          title: 'T',
          artist: 'A',
        },
      ],
    })
    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.message, 'stale-sync')
    }
    assert.deepEqual(staleCalls, ['start', 'upsert'])
  } finally {
    libraryClient.startSourceFavoritesSync = prevStart
    libraryClient.upsertSourceFavoritesChunk = prevUpsert
    libraryClient.completeSourceFavoritesSync = prevComplete
    libraryClient.loadCanonicalLibrary = prevLoad
    resetAuthSessionEpochForTests()
  }
})

test('replaceForUser builds source index in linear time over copies', () => {
  const storeSource = readFileSync(
    join(here, '../../store/canonicalLibraryStore.ts'),
    'utf8',
  )
  const implStart = storeSource.indexOf('replaceForUser: (userId, items) =>')
  assert.ok(implStart >= 0)
  const fn = storeSource.slice(implStart, storeSource.indexOf('clear:', implStart))
  assert.match(fn, /for \(const copy of item\.copies\)/)
  assert.equal(fn.includes('indexItem('), false)
})
