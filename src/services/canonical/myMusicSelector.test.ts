/**
 * LIB-04A — семантика «Моя музыка» (вариант A).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import type { CanonicalLibraryItem } from '../../types/canonical.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import { filterQueueToLiveCatalogMembership } from '../catalogPlayback/liveCatalogQueue.ts'
import type { CatalogQueueEntry } from '../catalogPlayback/buildCatalogPlaybackQueue.ts'
import {
  isInMyMusic,
  likedCanonicalItems,
  myMusicCanonicalItems,
} from './selectors.ts'

const NOW = '2024-06-01T00:00:00.000Z'
const here = dirname(fileURLToPath(import.meta.url))

function item(input: {
  id: string
  liked?: boolean
  catalogIds?: string[]
  copies?: number
  title?: string
}): CanonicalLibraryItem {
  const copies = Array.from({ length: input.copies ?? 1 }, (_, index) => {
    const externalId = `${input.id}-${index}`
    return {
      sourceTrackKey: `yandex-music:${externalId}`,
      canonicalTrackId: input.id,
      sourceId: 'yandex-music',
      externalId,
      title: input.title ?? input.id,
      artist: 'A',
      album: null,
      durationMs: 1000,
      artworkUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    }
  })
  return {
    canonicalTrack: {
      id: input.id,
      title: input.title ?? input.id,
      artist: 'A',
      album: null,
      durationMs: 1000,
      artworkUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies,
    state: {
      addedAt: NOW,
      lastPlayed: null,
      playCount: 0,
      liked: input.liked ?? false,
      likedAt: input.liked ? NOW : null,
      disliked: false,
      skipped: 0,
      notes: '',
      favorite: false,
      hidden: false,
      customMetadata: {},
    },
    catalogIds: input.catalogIds ?? [],
  }
}

function entry(id: string): CatalogQueueEntry {
  return {
    canonicalTrackId: id,
    track: {
      id: `yandex-music:${id}-0`,
      sourceId: 'yandex-music',
      externalId: `${id}-0`,
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

test('only technical identity is not in my-music', () => {
  const row = item({ id: 'can_orphan' })
  assert.equal(isInMyMusic(row), false)
  assert.deepEqual(myMusicCanonicalItems([row]), [])
})

test('like alone is in my-music', () => {
  const row = item({ id: 'can_liked', liked: true })
  assert.equal(isInMyMusic(row), true)
  assert.deepEqual(
    myMusicCanonicalItems([row]).map((row) => row.canonicalTrack.id),
    ['can_liked'],
  )
})

test('sys_swipes membership without like is not in my-music', () => {
  const row = item({ id: 'can_inbox', catalogIds: [SYS_SWIPES_ID] })
  assert.equal(isInMyMusic(row), false)
})

test('like + sys_swipes is in my-music', () => {
  const row = item({
    id: 'can_swipe',
    liked: true,
    catalogIds: [SYS_SWIPES_ID],
  })
  assert.equal(isInMyMusic(row), true)
})

test('user-catalog without like is in my-music', () => {
  const row = item({ id: 'can_saved', catalogIds: ['cat_car'] })
  assert.equal(isInMyMusic(row), true)
})

test('like + user-catalog is in my-music', () => {
  const row = item({
    id: 'can_both',
    liked: true,
    catalogIds: ['cat_car'],
  })
  assert.equal(isInMyMusic(row), true)
})

test('unlike keeps my-music when user-catalog remains', () => {
  const liked = item({
    id: 'can_keep',
    liked: true,
    catalogIds: ['cat_car'],
  })
  const unliked = item({
    id: 'can_keep',
    liked: false,
    catalogIds: ['cat_car'],
  })
  assert.equal(isInMyMusic(liked), true)
  assert.equal(isInMyMusic(unliked), true)
})

test('unlike without user-catalog removes from my-music', () => {
  const before = item({
    id: 'can_drop',
    liked: true,
    catalogIds: [SYS_SWIPES_ID],
  })
  const after = item({
    id: 'can_drop',
    liked: false,
    catalogIds: [SYS_SWIPES_ID],
  })
  assert.equal(isInMyMusic(before), true)
  assert.equal(isInMyMusic(after), false)
})

test('removing last user-catalog membership at liked=false removes from my-music', () => {
  const withCatalog = item({ id: 'can_last', catalogIds: ['cat_car'] })
  const empty = item({ id: 'can_last', catalogIds: [] })
  assert.equal(isInMyMusic(withCatalog), true)
  assert.equal(isInMyMusic(empty), false)
})

test('multiple user catalogs still one my-music row', () => {
  const row = item({
    id: 'can_multi',
    catalogIds: ['cat_a', 'cat_b', SYS_SWIPES_ID],
  })
  assert.equal(isInMyMusic(row), true)
  assert.equal(myMusicCanonicalItems([row]).length, 1)
})

test('multiple SourceCopies stay one composition in my-music', () => {
  const row = item({
    id: 'can_copies',
    liked: true,
    copies: 3,
  })
  assert.equal(myMusicCanonicalItems([row]).length, 1)
  assert.equal(myMusicCanonicalItems([row])[0]?.copies.length, 3)
})

test('favorites and swipes selectors are unchanged', () => {
  const orphan = item({ id: 'o' })
  const liked = item({ id: 'l', liked: true, catalogIds: [SYS_SWIPES_ID] })
  const catalogOnly = item({ id: 'c', catalogIds: ['cat_car'] })
  const all = [orphan, liked, catalogOnly]
  assert.deepEqual(
    likedCanonicalItems(all).map((row) => row.canonicalTrack.id),
    ['l'],
  )
  assert.deepEqual(
    myMusicCanonicalItems(all).map((row) => row.canonicalTrack.id).sort(),
    ['c', 'l'],
  )
})

test('reload/hydrate: my-music uses same predicate on replaced store items', () => {
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item({ id: 'can_orphan' }),
    item({ id: 'can_liked', liked: true }),
    item({ id: 'can_catalog', catalogIds: ['cat_party'] }),
  ])
  const items = Object.values(useCanonicalLibraryStore.getState().itemsById)
  assert.deepEqual(
    myMusicCanonicalItems(items)
      .map((row) => row.canonicalTrack.id)
      .sort(),
    ['can_catalog', 'can_liked'],
  )
  useCanonicalLibraryStore.getState().clear()
})

test('live queue sys_my_music drops tracks that leave my-music', () => {
  useCanonicalLibraryStore.getState().replaceForUser('user-a', [
    item({ id: 'can_keep', liked: true }),
    item({ id: 'can_drop', catalogIds: [] }),
    item({ id: 'can_catalog', catalogIds: ['cat_car'] }),
  ])
  const live = filterQueueToLiveCatalogMembership('sys_my_music', [
    entry('can_keep'),
    entry('can_drop'),
    entry('can_catalog'),
  ])
  assert.deepEqual(
    live.map((row) => row.canonicalTrackId),
    ['can_keep', 'can_catalog'],
  )
  useCanonicalLibraryStore.getState().clear()
})

test('LibraryFolder and CanonicalOrganizedList use myMusicCanonicalItems', () => {
  const folder = readFileSync(join(here, '../../pages/LibraryFolder.tsx'), 'utf8')
  const list = readFileSync(
    join(here, '../../components/catalog/CanonicalOrganizedList.tsx'),
    'utf8',
  )
  const folders = readFileSync(
    join(here, '../../components/catalog/LibrarySystemFolders.tsx'),
    'utf8',
  )
  assert.match(folder, /myMusicCanonicalItems/)
  assert.match(list, /myMusicCanonicalItems/)
  assert.match(folders, /myMusicCanonicalItems/)
  assert.equal(folder.includes("case 'my-music':\n        return items"), false)
})
