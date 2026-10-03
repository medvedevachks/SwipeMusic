import assert from 'node:assert/strict'
import test from 'node:test'
import { getCollectionEngine } from '../collectionEngine/index.ts'
import { useCollectionEngineStore } from '../../store/collectionEngineStore.ts'
import { useCollectionStore } from '../../store/collectionStore.ts'
import type { Catalog } from '../../types/category.ts'
import type { Track } from '../../types/track.ts'
import {
  canDeleteCatalog,
  formatCatalogTrackCount,
  getCatalogById,
  getCatalogTrackCount,
  getTracksForCatalog,
  listCatalogs,
} from './selectCatalogs.ts'

function catalog(partial: Partial<Catalog> & Pick<Catalog, 'id' | 'name' | 'sortOrder'>): Catalog {
  return {
    icon: 'music',
    color: '#2563eb',
    description: '',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    favorite: false,
    system: false,
    ...partial,
  }
}

function track(sourceId: string, externalId: string, title: string): Track {
  return {
    id: `${sourceId}:${externalId}`,
    sourceId,
    externalId,
    title,
    artist: sourceId,
  }
}

function resetLibrary(): void {
  useCollectionStore.getState().clearUserLibrary()
  getCollectionEngine().replaceStorageData({ tracks: [], actions: [] })
  useCollectionEngineStore.getState().refresh()
}

test('catalog list keeps sort order and does not invent a provider owner', () => {
  const catalogs = [
    catalog({ id: 'cat_b', name: 'Ночное', sortOrder: 2 }),
    catalog({ id: 'cat_a', name: 'В машину', sortOrder: 1, favorite: true }),
  ]
  const listed = listCatalogs(catalogs)
  assert.deepEqual(
    listed.map((item) => item.id),
    ['cat_a', 'cat_b'],
  )
  assert.equal('providerId' in listed[0], false)
  assert.equal('sourceId' in listed[0], false)
  assert.equal(getCatalogById(listed, 'missing'), null)
  assert.equal(getCatalogById(listed, 'cat_b')?.name, 'Ночное')
})

test('catalog detail lists assigned tracks and counts memberships', () => {
  const yandex = track('yandex-music', '1', 'Город')
  const spotify = track('spotify', '3', 'Night')
  const records = [
    {
      trackId: yandex.id,
      sourceId: yandex.sourceId,
      track: yandex,
      addedAt: '2024-01-01T00:00:00.000Z',
      lastPlayed: null,
      playCount: 0,
      liked: true,
      disliked: false,
      skipped: 0,
      categories: ['cat_car', 'cat_night'],
      notes: '',
      favorite: false,
      hidden: false,
      customMetadata: {},
    },
    {
      trackId: spotify.id,
      sourceId: spotify.sourceId,
      track: spotify,
      addedAt: '2024-01-01T00:00:00.000Z',
      lastPlayed: null,
      playCount: 0,
      liked: false,
      disliked: false,
      skipped: 0,
      categories: ['cat_car'],
      notes: '',
      favorite: false,
      hidden: false,
      customMetadata: {},
    },
  ]
  const assignments = [
    {
      id: 'asg_1',
      trackId: yandex.id,
      categoryId: 'cat_car',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'asg_2',
      trackId: spotify.id,
      categoryId: 'cat_car',
      createdAt: '2024-01-03T00:00:00.000Z',
    },
    {
      id: 'asg_3',
      trackId: yandex.id,
      categoryId: 'cat_night',
      createdAt: '2024-01-04T00:00:00.000Z',
    },
  ]
  const inCar = getTracksForCatalog('cat_car', assignments, records)
  assert.deepEqual(
    inCar.map((item) => item.track?.id),
    ['yandex-music:1', 'spotify:3'],
  )
  assert.deepEqual(
    inCar.map((item) => item.sourceId),
    ['yandex-music', 'spotify'],
  )
  assert.equal(getCatalogTrackCount(assignments, 'cat_car'), 2)
  assert.equal(getCatalogTrackCount(assignments, 'cat_night'), 1)
  assert.equal(inCar[0]?.liked, true)
  assert.equal(formatCatalogTrackCount(1), '1 трек')
  assert.equal(formatCatalogTrackCount(2), '2 трека')
  assert.equal(formatCatalogTrackCount(5), '5 треков')
})

test('rename, delete and unassign keep the collection track and other memberships', () => {
  resetLibrary()
  const store = useCollectionStore.getState()
  const engine = useCollectionEngineStore.getState()
  const car = store.createCategory({
    name: 'В машину',
    color: '#2563eb',
    icon: 'car',
  })
  const night = store.createCategory({
    name: 'Ночное',
    color: '#7c3aed',
    icon: 'moon',
  })
  const yandex = track('yandex-music', '1', 'Город')
  const local = track('local-folder', '2', 'Демо')
  engine.assignCategory(yandex.id, car.id, yandex)
  engine.assignCategory(yandex.id, night.id, yandex)
  engine.assignCategory(local.id, car.id, local)
  engine.setLiked(yandex.id, true, yandex)
  useCollectionStore.getState().recordHistory({
    track: yandex,
    action: 'categorize',
    category: car,
  })

  useCollectionStore.getState().updateCategory(car.id, { name: 'Дорога' })
  assert.equal(
    getCatalogById(useCollectionStore.getState().categories, car.id)?.name,
    'Дорога',
  )

  useCollectionEngineStore.getState().removeCategory(yandex.id, car.id)
  const afterUnassign = useCollectionStore.getState()
  assert.equal(getCollectionEngine().getTrack(yandex.id)?.liked, true)
  assert.equal(
    afterUnassign.assignments.some(
      (item) => item.trackId === yandex.id && item.categoryId === night.id,
    ),
    true,
  )
  assert.equal(
    afterUnassign.assignments.some(
      (item) => item.trackId === yandex.id && item.categoryId === car.id,
    ),
    false,
  )
  assert.equal(afterUnassign.history.length, 1)
  assert.equal(getCatalogTrackCount(afterUnassign.assignments, car.id), 1)

  const system = catalog({
    id: 'cat_system',
    name: 'Любимое',
    sortOrder: 0,
    system: true,
  })
  useCollectionStore.setState({
    categories: [...useCollectionStore.getState().categories, system],
  })
  assert.equal(canDeleteCatalog(system), false)
  useCollectionStore.getState().deleteCategory(system.id)
  assert.equal(
    getCatalogById(useCollectionStore.getState().categories, system.id)?.name,
    'Любимое',
  )

  useCollectionStore.getState().deleteCategory(car.id)
  const afterDelete = useCollectionStore.getState()
  assert.equal(getCatalogById(afterDelete.categories, car.id), null)
  assert.equal(getCollectionEngine().getTrack(local.id)?.track.title, 'Демо')
  assert.equal(getCollectionEngine().getTrack(yandex.id)?.liked, true)
  assert.equal(
    afterDelete.assignments.some((item) => item.categoryId === car.id),
    false,
  )
  assert.equal(
    afterDelete.assignments.some(
      (item) => item.trackId === yandex.id && item.categoryId === night.id,
    ),
    true,
  )
  assert.equal(afterDelete.history[0]?.category?.id, car.id)
  assert.equal(
    getCollectionEngine().getTrack(local.id)?.categories.includes(car.id),
    false,
  )

  resetLibrary()
})
