import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultCategories } from '../defaultCategories.ts'
import { getCollectionEngine } from '../collectionEngine/index.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import { createBootstrapGate, executeLibraryBootstrap } from './bootstrapCore.ts'
import {
  mapLibraryState,
  stripSecrets,
  toTrackUpsertBody,
  type LibraryStateDto,
} from './mapLibraryState.ts'
import { applyLibrarySnapshot } from './session.ts'
import type { Category } from '../../types/category.ts'
import type { CollectionTrackData } from '../../types/collectionUser.ts'

const categoryA: Category = {
  id: 'cat_a',
  name: 'A',
  icon: 'star',
  color: '#112233',
  description: '',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  sortOrder: 0,
  favorite: false,
  system: true,
}

function emptyState(categories: Category[] = []): LibraryStateDto {
  return {
    categories,
    tracks: [],
    categoryAssignments: [],
    history: [],
    settings: {
      gestureConfig: {
        left: 'like',
        right: 'categorize',
        up: 'skip',
        down: 'previous',
      },
    },
  }
}

test('library-state maps likes, assignments, history and gesture config', () => {
  const dto: LibraryStateDto = {
    categories: [categoryA],
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
        addedAt: '2024-02-01T00:00:00.000Z',
        lastPlayed: null,
        playCount: 1,
        liked: true,
        likedAt: '2024-02-02T00:00:00.000Z',
        disliked: false,
        skipped: 0,
        categories: ['cat_a'],
        notes: '',
        favorite: false,
        hidden: false,
        customMetadata: { mood: 'night', accessToken: 'hidden' },
      },
    ],
    categoryAssignments: [
      {
        id: 'asg_a',
        trackId: 'spotify:track-x',
        categoryId: 'cat_a',
        createdAt: '2024-02-03T00:00:00.000Z',
      },
    ],
    history: [
      {
        id: 'hist_a',
        track: {
          id: 'spotify:track-x',
          sourceId: 'spotify',
          externalId: 'track-x',
          title: 'Песня',
          artist: 'Исполнитель',
        },
        action: 'like',
        createdAt: '2024-02-02T00:00:00.000Z',
        sourceId: 'spotify',
      },
    ],
    settings: {
      gestureConfig: {
        left: 'skip',
        right: 'categorize',
        up: 'like',
        down: 'previous',
      },
    },
  }

  const hydrated = mapLibraryState(dto)
  assert.equal(hydrated.categories[0]?.id, 'cat_a')
  assert.equal(hydrated.likedTracks[0]?.trackId, 'spotify:track-x')
  assert.equal(hydrated.likedTracks[0]?.createdAt, '2024-02-02T00:00:00.000Z')
  assert.equal(hydrated.assignments[0]?.id, 'asg_a')
  assert.equal(hydrated.history[0]?.id, 'hist_a')
  assert.equal(hydrated.gestureConfig.left, 'skip')
  assert.equal(hydrated.tracks[0]?.liked, true)
  assert.equal(hydrated.tracks[0]?.customMetadata.accessToken, undefined)
  assert.equal(hydrated.tracks[0]?.customMetadata.mood, 'night')
  assert.equal(hydrated.tracks[0]?.track.id, 'spotify:track-x')
})

test('track upsert body drops provider secrets', () => {
  const record: CollectionTrackData = {
    trackId: 'spotify:track-x',
    sourceId: 'spotify',
    track: {
      id: 'spotify:track-x',
      sourceId: 'spotify',
      externalId: 'track-x',
      title: 'Песня',
      artist: 'Исполнитель',
    },
    addedAt: '2024-02-01T00:00:00.000Z',
    lastPlayed: null,
    playCount: 0,
    liked: true,
    disliked: false,
    skipped: 0,
    categories: [],
    notes: '',
    favorite: false,
    hidden: false,
    customMetadata: {
      accessToken: 'ya-token',
      refreshToken: 'refresh',
      password: 'secret',
      comment: 'ok',
    },
  }
  const body = toTrackUpsertBody(record, '2024-02-02T00:00:00.000Z', {
    includeUserFields: true,
  })
  const raw = JSON.stringify(body)
  assert.equal(raw.includes('ya-token'), false)
  assert.equal(raw.includes('refresh'), false)
  assert.equal(raw.includes('playbackUrl'), false)
  assert.equal((body.customMetadata as { comment?: string }).comment, 'ok')
  assert.deepEqual(stripSecrets({ oauth: 'x', nested: { session: 'y', title: 'z' } }), {
    nested: { title: 'z' },
  })
})

test('empty server seeds defaults once', async () => {
  const created: string[] = []
  let stored: Category[] = []
  const client = {
    async load() {
      return emptyState(stored)
    },
    async createCategory(category: Category) {
      created.push(category.id)
      stored = [...stored, category]
    },
  }
  const gate = createBootstrapGate()
  const run = () =>
    gate.run('user-a', (isCurrent) =>
      executeLibraryBootstrap({
        isCurrent,
        client,
        createDefaults: createDefaultCategories,
        apply: () => undefined,
      }),
    )
  await Promise.all([run(), run()])
  assert.equal(created.length, 6)
  assert.equal(new Set(created).size, 6)
})

test('non-empty server does not recreate defaults', async () => {
  let created = 0
  const result = await executeLibraryBootstrap({
    isCurrent: () => true,
    createDefaults: () => {
      throw new Error('defaults must not be created')
    },
    apply: (state) => {
      assert.equal(state.categories[0]?.id, 'cat_a')
    },
    client: {
      async load() {
        return emptyState([categoryA])
      },
      async createCategory() {
        created += 1
      },
    },
  })
  assert.equal(result, 'hydrated')
  assert.equal(created, 0)
})

test('logout clears user-scoped state and the next user does not see it', () => {
  applyLibrarySnapshot({
    ...emptyState([categoryA]),
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
        addedAt: '2024-02-01T00:00:00.000Z',
        lastPlayed: null,
        playCount: 0,
        liked: true,
        likedAt: '2024-02-02T00:00:00.000Z',
        disliked: false,
        skipped: 0,
        categories: ['cat_a'],
        notes: '',
        favorite: false,
        hidden: false,
        customMetadata: {},
      },
    ],
    settings: {
      gestureConfig: {
        left: 'skip',
        right: 'like',
        up: 'categorize',
        down: 'previous',
      },
    },
  })
  assert.equal(useCollectionStore.getState().categories[0]?.name, 'A')
  assert.equal(useCollectionStore.getState().likedTracks[0]?.trackId, 'spotify:track-x')
  assert.equal(useCollectionStore.getState().gestureConfig.left, 'skip')
  assert.equal(getCollectionEngine().getTrack('spotify:track-x')?.liked, true)

  useCollectionStore.getState().clearUserLibrary()
  getCollectionEngine().replaceStorageData({ tracks: [], actions: [] })

  const categoryB: Category = { ...categoryA, id: 'cat_b', name: 'B' }
  applyLibrarySnapshot(emptyState([categoryB]))
  const state = useCollectionStore.getState()
  assert.equal(state.categories.length, 1)
  assert.equal(state.categories[0]?.name, 'B')
  assert.equal(state.likedTracks.length, 0)
  assert.equal(state.history.length, 0)
  assert.equal(state.viewedTrackIds.length, 0)
  assert.equal(getCollectionEngine().getTrack('spotify:track-x'), null)
})

test('stale bootstrap does not overwrite the next user', async () => {
  const gate = createBootstrapGate()
  const applied: string[] = []
  let releaseFirst: () => void = () => undefined
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const first = gate.run('user-a', async (isCurrent) => {
    await firstGate
    if (isCurrent()) {
      applied.push('A')
    }
  })
  gate.invalidate()
  const second = gate.run('user-b', async (isCurrent) => {
    if (isCurrent()) {
      applied.push('B')
    }
  })
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(applied, ['B'])
})
