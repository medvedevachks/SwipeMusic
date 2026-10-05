import assert from 'node:assert/strict'
import test from 'node:test'
import { getCollectionEngine } from '../collectionEngine/index.ts'
import { classifySwipeTrack } from '../swipeClassification/classifySwipeTrack.ts'
import { useAuthStore } from '../../store/authStore.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { LibraryHttpError } from '../libraryPersistence/client.ts'
import {
  applyCanonicalSnapshot,
  applyLibrarySnapshot,
  resetLibrarySession,
} from '../libraryPersistence/session.ts'
import type { LibraryStateDto } from '../libraryPersistence/mapLibraryState.ts'
import { useLibraryPersistenceStore } from '../libraryPersistence/statusStore.ts'
import { SAVE_FAILED_MESSAGE } from '../libraryPersistence/statusStore.ts'
import type {
  CanonicalLibraryItem,
  CanonicalMembership,
  SourceCopy,
  SourceCopySnapshot,
  TrackIdentity,
} from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { defaultTrackMeta } from '../../types/trackMeta.ts'
import { mapCanonicalItem } from './mapCanonical.ts'
import {
  canonicalCatalogCount,
  canonicalItemForTrack,
  canonicalTracksInCatalog,
  isSourceCopyLiked,
  likedSourceKeys,
  listCanonicalItems,
  projectCanonicalMeta,
} from './selectors.ts'
import {
  assignSourceToCatalog,
  clearCanonicalIdentityFlights,
  commitCatalogChoice,
  commitSwipeLike,
  ensureCanonicalForTrack,
  likeSearchResult,
  likeSourceTrack,
  removeCanonicalFromCatalog,
  setCanonicalRemote,
  type CanonicalRemote,
} from './userOrganization.ts'

const NOW = '2024-06-01T00:00:00.000Z'

type Calls = {
  identity: SourceCopySnapshot[]
  liked: Array<{ id: string; liked: boolean }>
  assign: Array<{ catalogId: string; canonicalTrackId: string }>
  unassign: Array<{ catalogId: string; canonicalTrackId: string }>
}

function sourceTrack(sourceId: string, externalId: string, title: string): Track {
  return {
    id: `${sourceId}:${externalId}`,
    sourceId,
    externalId,
    title,
    artist: 'Север',
    album: 'Альбом',
    durationMs: 180_000,
    coverUrl: 'https://example.test/cover.jpg',
  }
}

function sourceCopy(
  sourceId: string,
  externalId: string,
  canonicalId: string,
  title: string,
): SourceCopy {
  return {
    sourceTrackKey: `${sourceId}:${externalId}`,
    canonicalTrackId: canonicalId,
    sourceId,
    externalId,
    title,
    artist: 'Север',
    album: 'Альбом',
    durationMs: 180_000,
    artworkUrl: 'https://example.test/cover.jpg',
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function canonicalItem(
  id: string,
  title: string,
  copies: SourceCopy[],
  liked: boolean,
  catalogIds: string[],
): CanonicalLibraryItem {
  return {
    canonicalTrack: {
      id,
      title,
      artist: 'Север',
      album: 'Альбом',
      durationMs: 180_000,
      artworkUrl: 'https://example.test/cover.jpg',
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies,
    state: {
      addedAt: NOW,
      lastPlayed: null,
      playCount: 0,
      liked,
      likedAt: liked ? NOW : null,
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

function identityFrom(id: string, tracks: Track[]): TrackIdentity {
  const first = tracks[0]
  return {
    canonicalTrack: {
      id,
      title: first?.title ?? '',
      artist: first?.artist ?? '',
      album: first?.album ?? null,
      durationMs: first?.durationMs ?? null,
      artworkUrl: first?.coverUrl ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies: tracks.map((track) =>
      sourceCopy(track.sourceId, track.externalId, id, track.title),
    ),
  }
}

function installRemote(identities: Record<string, TrackIdentity>): Calls {
  const calls: Calls = { identity: [], liked: [], assign: [], unassign: [] }
  const remote: CanonicalRemote = {
    async ensureIdentity(snapshot) {
      calls.identity.push(snapshot)
      const key = `${snapshot.sourceId}:${snapshot.externalId}`
      const known = identities[key]
      if (known) {
        return known
      }
      return identityFrom(`can_${key}`, [
        {
          id: key,
          sourceId: snapshot.sourceId,
          externalId: snapshot.externalId,
          title: snapshot.title,
          artist: snapshot.artist,
          album: snapshot.album ?? undefined,
          durationMs: snapshot.durationMs ?? undefined,
          coverUrl: snapshot.artworkUrl,
        },
      ])
    },
    async patchCanonicalLiked(id, liked) {
      calls.liked.push({ id, liked })
      const current = useCanonicalLibraryStore.getState().itemsById[id]
      if (!current) {
        throw new LibraryHttpError(404)
      }
      return {
        item: {
          ...current,
          state: {
            ...current.state,
            liked,
            likedAt: liked ? NOW : null,
            disliked: liked ? false : current.state.disliked,
          },
        },
      }
    },
    async assignCanonical(catalogId, canonicalTrackId) {
      calls.assign.push({ catalogId, canonicalTrackId })
      const membership: CanonicalMembership = {
        catalogId,
        canonicalTrackId,
        createdAt: NOW,
      }
      return { membership }
    },
    async unassignCanonical(catalogId, canonicalTrackId) {
      calls.unassign.push({ catalogId, canonicalTrackId })
    },
  }
  setCanonicalRemote(remote)
  return calls
}

function arm(): void {
  useLibraryPersistenceStore.setState({ armed: true, status: 'ready', message: null })
}

function resetRuntime(): void {
  clearCanonicalIdentityFlights()
  setCanonicalRemote(null)
  useCanonicalLibraryStore.getState().clear()
  useCollectionStore.getState().clearUserLibrary()
  getCollectionEngine().replaceStorageData({ tracks: [], actions: [] })
  useLibraryPersistenceStore.setState({ armed: false, status: 'idle', message: null })
  useAuthStore.setState({ user: null, status: 'loading' })
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

test('canonical API DTO maps to one frontend item', () => {
  const raw = canonicalItem(
    'can_x',
    'Город',
    [
      sourceCopy('yandex-music', '101', 'can_x', 'Город'),
      sourceCopy('spotify', '202', 'can_x', 'Город'),
    ],
    true,
    ['cat_car'],
  )
  raw.state.customMetadata = { mood: 'night', accessToken: 'hidden' }
  const mapped = mapCanonicalItem(raw)
  assert.equal(mapped.canonicalTrack.id, 'can_x')
  assert.equal(mapped.canonicalTrack.title, 'Город')
  assert.equal(mapped.copies.length, 2)
  assert.equal(mapped.state.liked, true)
  assert.deepEqual(mapped.catalogIds, ['cat_car'])
  assert.equal(mapped.state.customMetadata.mood, 'night')
  assert.equal('accessToken' in mapped.state.customMetadata, false)
  assert.equal(listCanonicalItems([mapped]).length, 1)
})

test('two source copies are one canonical library row and one catalog row', () => {
  const item = canonicalItem(
    'can_x',
    'Город',
    [
      sourceCopy('yandex-music', '101', 'can_x', 'Город'),
      sourceCopy('spotify', '202', 'can_x', 'Город'),
      sourceCopy('local-folder', '303', 'can_x', 'Город'),
    ],
    true,
    ['cat_car'],
  )
  assert.equal(listCanonicalItems([item]).length, 1)
  assert.equal(canonicalTracksInCatalog([item], 'cat_car').length, 1)
  assert.equal(canonicalCatalogCount([item], 'cat_car'), 1)
  assert.equal(item.copies.length, 3)
  assert.deepEqual(likedSourceKeys(item), [
    'yandex-music:101',
    'spotify:202',
    'local-folder:303',
  ])
})

test('canonical liked state is projected onto every source copy', () => {
  const item = canonicalItem(
    'can_x',
    'Город',
    [
      sourceCopy('yandex-music', '101', 'can_x', 'Город'),
      sourceCopy('spotify', '202', 'can_x', 'Город'),
    ],
    true,
    [],
  )
  const lookup = {
    itemsById: { can_x: item },
    sourceKeyToCanonicalId: {
      'yandex-music:101': 'can_x',
      'spotify:202': 'can_x',
    },
  }
  assert.equal(isSourceCopyLiked(lookup, 'yandex-music:101'), true)
  assert.equal(isSourceCopyLiked(lookup, 'spotify:202'), true)
  const yandex = projectCanonicalMeta(defaultTrackMeta(sourceTrack('yandex-music', '101', 'Город')), item)
  const spotify = projectCanonicalMeta(defaultTrackMeta(sourceTrack('spotify', '202', 'Город')), item)
  assert.equal(yandex.liked, true)
  assert.equal(spotify.liked, true)
  assert.equal(canonicalItemForTrack(lookup, sourceTrack('spotify', '202', 'Город'))?.canonicalTrack.id, 'can_x')
})

test('ensureCanonicalForTrack is idempotent for the same source copy', async () => {
  resetRuntime()
  arm()
  const track = sourceTrack('yandex-music', '101', 'Город')
  const calls = installRemote({
    'yandex-music:101': identityFrom('can_x', [track]),
  })
  const first = await ensureCanonicalForTrack(track)
  const second = await ensureCanonicalForTrack(track)
  assert.equal(first.canonicalTrack.id, 'can_x')
  assert.equal(second.canonicalTrack.id, 'can_x')
  assert.equal(calls.identity.length, 1)
  resetRuntime()
})

test('new source track after migration gets its own identity call', async () => {
  resetRuntime()
  arm()
  const migrated = canonicalItem(
    'can_old',
    'Старая',
    [sourceCopy('yandex-music', '101', 'can_old', 'Старая')],
    false,
    [],
  )
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [migrated])
  const fresh = sourceTrack('spotify', '909', 'Новая')
  const calls = installRemote({})
  const created = await ensureCanonicalForTrack(fresh)
  assert.equal(calls.identity.length, 1)
  assert.equal(calls.identity[0]?.externalId, '909')
  assert.notEqual(created.canonicalTrack.id, 'can_old')
  const state = useCanonicalLibraryStore.getState()
  assert.equal(state.itemsById.can_old?.copies.length, 1)
  assert.equal(Object.keys(state.itemsById).length, 2)
  resetRuntime()
})

test('swipe like writes canonical state and source history, not a second like', async () => {
  resetRuntime()
  arm()
  const track = sourceTrack('yandex-music', '101', 'Город')
  const calls = installRemote({
    'yandex-music:101': identityFrom('can_x', [track]),
  })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch
  try {
    const result = classifySwipeTrack(track, 'like')
    assert.equal(result.kind, 'applied')
    assert.equal(getCollectionEngine().getTrack(track.id)?.liked ?? false, false)
    await flush()
    assert.equal(calls.liked.length, 1)
    assert.equal(calls.liked[0]?.liked, true)
    assert.equal(useCanonicalLibraryStore.getState().itemsById.can_x?.state.liked, true)
    assert.equal(getCollectionEngine().getTrack(track.id)?.liked ?? false, false)
    assert.equal(useCollectionStore.getState().likedTracks.length, 0)
    const history = useCollectionStore.getState().history
    assert.equal(history.length, 1)
    assert.equal(history[0]?.action, 'like')
    assert.equal(history[0]?.track.id, 'yandex-music:101')
    assert.equal(history[0]?.sourceId, 'yandex-music')
    const unliked = await likeSourceTrack(track, false)
    assert.equal(unliked?.state.liked, false)
    assert.equal(calls.liked[1]?.liked, false)
    assert.equal(useCollectionStore.getState().history.length, 1)
  } finally {
    globalThis.fetch = originalFetch
    resetRuntime()
  }
})

test('swipe catalog assignment writes canonical membership', async () => {
  resetRuntime()
  arm()
  const track = sourceTrack('yandex-music', '101', 'Город')
  const calls = installRemote({
    'yandex-music:101': identityFrom('can_x', [track]),
  })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch
  try {
    const saved = await commitCatalogChoice(track, 'cat_car', {
      id: 'cat_car',
      name: 'В машину',
      icon: 'car',
      color: '#2563eb',
      description: '',
      createdAt: NOW,
      updatedAt: NOW,
      sortOrder: 0,
      favorite: false,
      system: false,
    })
    assert.equal(saved, true)
    assert.deepEqual(calls.assign, [{ catalogId: 'cat_car', canonicalTrackId: 'can_x' }])
    assert.deepEqual(useCanonicalLibraryStore.getState().itemsById.can_x?.catalogIds, ['cat_car'])
    assert.equal(useCollectionStore.getState().assignments.length, 0)
    assert.equal(useCollectionStore.getState().history[0]?.track.id, 'yandex-music:101')
    assert.equal(useCollectionStore.getState().history[0]?.action, 'categorize')
    const again = await assignSourceToCatalog(track, 'cat_car')
    assert.equal(again, true)
    assert.deepEqual(useCanonicalLibraryStore.getState().itemsById.can_x?.catalogIds, ['cat_car'])
  } finally {
    globalThis.fetch = originalFetch
    resetRuntime()
  }
})

test('search-result like uses canonical mutation and does not merge another result', async () => {
  resetRuntime()
  arm()
  const yandex = sourceTrack('yandex-music', '101', 'Город')
  const spotify = sourceTrack('spotify', '202', 'Город')
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    canonicalItem('can_yandex', 'Город', [sourceCopy('yandex-music', '101', 'can_yandex', 'Город')], false, []),
  ])
  const calls = installRemote({
    'spotify:202': identityFrom('can_spotify', [spotify]),
  })
  const liked = await likeSearchResult(spotify)
  assert.equal(liked?.canonicalTrack.id, 'can_spotify')
  assert.equal(liked?.state.liked, true)
  assert.equal(calls.identity.length, 1)
  assert.equal(calls.identity[0]?.sourceId, 'spotify')
  assert.equal(useCanonicalLibraryStore.getState().itemsById.can_yandex?.state.liked, false)
  assert.equal(useCanonicalLibraryStore.getState().itemsById.can_yandex?.copies.length, 1)
  assert.equal(yandex.id, 'yandex-music:101')
  assert.equal(Object.keys(useCanonicalLibraryStore.getState().itemsById).length, 2)
  resetRuntime()
})

test('track action add-to-catalog uses canonical membership only', async () => {
  resetRuntime()
  arm()
  const track = sourceTrack('local-folder', '303', 'Демо')
  const calls = installRemote({
    'local-folder:303': identityFrom('can_local', [track]),
  })
  const saved = await assignSourceToCatalog(track, 'cat_car')
  assert.equal(saved, true)
  assert.equal(calls.assign.length, 1)
  assert.deepEqual(useCanonicalLibraryStore.getState().itemsById.can_local?.catalogIds, ['cat_car'])
  assert.equal(useCollectionStore.getState().assignments.length, 0)
  assert.equal(useCollectionStore.getState().history.length, 0)
  resetRuntime()
})

test('remove from catalog drops membership and keeps canonical like', async () => {
  resetRuntime()
  arm()
  const item = canonicalItem(
    'can_x',
    'Город',
    [
      sourceCopy('yandex-music', '101', 'can_x', 'Город'),
      sourceCopy('spotify', '202', 'can_x', 'Город'),
    ],
    true,
    ['cat_car', 'cat_night'],
  )
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [item])
  const calls = installRemote({})
  const removed = await removeCanonicalFromCatalog('can_x', 'cat_car')
  assert.equal(removed, true)
  assert.deepEqual(calls.unassign, [{ catalogId: 'cat_car', canonicalTrackId: 'can_x' }])
  const stored = useCanonicalLibraryStore.getState().itemsById.can_x
  assert.deepEqual(stored?.catalogIds, ['cat_night'])
  assert.equal(stored?.state.liked, true)
  assert.equal(stored?.copies.length, 2)
  assert.equal(canonicalTracksInCatalog([stored as CanonicalLibraryItem], 'cat_car').length, 0)
  resetRuntime()
})

test('failed like does not record history or mark the composition liked', async () => {
  resetRuntime()
  arm()
  const track = sourceTrack('yandex-music', '101', 'Город')
  installRemote({
    'yandex-music:101': identityFrom('can_x', [track]),
  })
  setCanonicalRemote({
    ensureIdentity: async () => identityFrom('can_x', [track]),
    patchCanonicalLiked: async () => {
      throw new LibraryHttpError(500)
    },
    assignCanonical: async () => {
      throw new LibraryHttpError(500)
    },
    unassignCanonical: async () => {
      throw new LibraryHttpError(500)
    },
  })
  const saved = await commitSwipeLike(track)
  assert.equal(saved, false)
  assert.equal(useCanonicalLibraryStore.getState().itemsById.can_x?.state.liked, false)
  assert.equal(useCollectionStore.getState().history.length, 0)
  assert.equal(useLibraryPersistenceStore.getState().message, SAVE_FAILED_MESSAGE)
  resetRuntime()
})

test('logout clears canonical frontend state and the next user does not see it', () => {
  const own = canonicalItem(
    'can_a',
    'Только А',
    [sourceCopy('yandex-music', '101', 'can_a', 'Только А')],
    true,
    ['cat_car'],
  )
  const other = canonicalItem(
    'can_b',
    'Только Б',
    [sourceCopy('spotify', '202', 'can_b', 'Только Б')],
    false,
    [],
  )
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [own])
  resetLibrarySession()
  const cleared = useCanonicalLibraryStore.getState()
  assert.equal(cleared.userId, null)
  assert.equal(Object.keys(cleared.itemsById).length, 0)
  assert.equal(Object.keys(cleared.sourceKeyToCanonicalId).length, 0)
  useCanonicalLibraryStore.getState().replaceForUser('user-b', [other])
  const next = useCanonicalLibraryStore.getState()
  assert.equal(next.userId, 'user-b')
  assert.equal(next.itemsById.can_a, undefined)
  assert.equal(next.sourceKeyToCanonicalId['yandex-music:101'], undefined)
  assert.equal(next.itemsById.can_b?.canonicalTrack.title, 'Только Б')
  resetRuntime()
})

test('legacy library-state still hydrates source compatibility state', () => {
  resetRuntime()
  const dto: LibraryStateDto = {
    categories: [
      {
        id: 'cat_a',
        name: 'A',
        icon: 'star',
        color: '#112233',
        description: '',
        createdAt: NOW,
        updatedAt: NOW,
        sortOrder: 0,
        favorite: false,
        system: true,
      },
    ],
    tracks: [
      {
        trackId: 'spotify:track-x',
        sourceId: 'spotify',
        track: {
          id: 'spotify:track-x',
          sourceId: 'spotify',
          externalId: 'track-x',
          title: 'Песня',
          artist: 'Исполнитель',
        },
        addedAt: NOW,
        lastPlayed: null,
        playCount: 1,
        liked: true,
        likedAt: NOW,
        disliked: false,
        skipped: 0,
        categories: ['cat_a'],
        notes: '',
        favorite: false,
        hidden: false,
        customMetadata: {},
      },
    ],
    categoryAssignments: [],
    history: [
      {
        id: 'hist_1',
        track: {
          id: 'spotify:track-x',
          sourceId: 'spotify',
          externalId: 'track-x',
          title: 'Песня',
          artist: 'Исполнитель',
        },
        action: 'like',
        createdAt: NOW,
        sourceId: 'spotify',
      },
    ],
    settings: {
      gestureConfig: {
        left: 'like',
        right: 'categorize',
        up: 'skip',
        down: 'previous',
      },
    },
  }
  applyLibrarySnapshot(dto)
  applyCanonicalSnapshot('user-a', [])
  assert.equal(useCollectionStore.getState().categories[0]?.id, 'cat_a')
  assert.equal(getCollectionEngine().getTrack('spotify:track-x')?.track.title, 'Песня')
  assert.equal(useCollectionStore.getState().history[0]?.track.id, 'spotify:track-x')
  assert.equal(Object.keys(useCanonicalLibraryStore.getState().itemsById).length, 0)
  resetRuntime()
})

test('unauthorized canonical save uses the existing auth failure path', async () => {
  resetRuntime()
  arm()
  useAuthStore.setState({
    user: {
      id: 'user-a',
      email: 'a@example.com',
      firstName: 'A',
      lastName: 'A',
      createdAt: NOW,
    },
    status: 'authenticated',
  })
  setCanonicalRemote({
    ensureIdentity: async () => {
      throw new LibraryHttpError(401)
    },
    patchCanonicalLiked: async () => {
      throw new LibraryHttpError(401)
    },
    assignCanonical: async () => {
      throw new LibraryHttpError(401)
    },
    unassignCanonical: async () => {
      throw new LibraryHttpError(401)
    },
  })
  const saved = await likeSourceTrack(sourceTrack('spotify', '1', 'Песня'), true)
  assert.equal(saved, null)
  assert.equal(useAuthStore.getState().status, 'anonymous')
  assert.equal(useAuthStore.getState().user, null)
  assert.equal(useLibraryPersistenceStore.getState().armed, false)
  resetRuntime()
})
