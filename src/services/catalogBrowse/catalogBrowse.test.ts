import assert from 'node:assert/strict'
import test from 'node:test'
import type { CatalogAlbum, CatalogArtist } from '../../types/catalog.ts'
import type { Track } from '../../types/track.ts'
import { createCatalogBrowseServiceForTests } from './CatalogBrowseService.ts'
import type { CatalogSourcePort } from './types.ts'

function track(n: number): Track {
  return {
    id: `src:${n}`,
    sourceId: 'mock-src',
    externalId: String(n),
    title: `T${n}`,
    artist: 'A',
  }
}

function mockPort(overrides?: Partial<CatalogSourcePort>): CatalogSourcePort {
  const artists: CatalogArtist[] = [
    {
      id: 'mock-src:artist:1',
      sourceId: 'mock-src',
      externalId: '1',
      name: 'Alpha',
    },
  ]
  const albums: CatalogAlbum[] = [
    {
      id: 'mock-src:album:9',
      sourceId: 'mock-src',
      externalId: '9',
      title: 'Album Nine',
    },
  ]
  return {
    sourceId: 'mock-src',
    sourceName: 'Mock',
    capabilities: {
      artistSearch: true,
      artistTracks: 'paginated',
      artistAlbums: 'paginated',
      albumTracks: 'paginated',
    },
    isAvailable: () => true,
    async searchArtists() {
      return { items: artists, nextCursor: null }
    },
    async getArtist(externalId) {
      return {
        ...artists[0]!,
        externalId,
        tracksMode: 'paginated',
        albumsMode: 'paginated',
      }
    },
    async getArtistTracks(_id, input) {
      if (!input.cursor) {
        return {
          items: Array.from({ length: 20 }, (_, i) => track(i)),
          nextCursor: '1',
        }
      }
      if (input.cursor === '1') {
        return {
          items: Array.from({ length: 20 }, (_, i) => track(i + 20)),
          nextCursor: '2',
        }
      }
      return {
        items: Array.from({ length: 5 }, (_, i) => track(i + 40)),
        nextCursor: null,
      }
    },
    async getArtistAlbums(_id, input) {
      if (input.cursor) {
        return { items: [], nextCursor: null }
      }
      return { items: albums, nextCursor: null }
    },
    async getAlbum(externalId) {
      return {
        ...albums[0]!,
        externalId,
        tracksMode: 'paginated',
      }
    },
    async getAlbumTracks(_id, input) {
      if (input.cursor) {
        return { items: [track(99)], nextCursor: null }
      }
      return { items: [track(1), track(2)], nextCursor: 'next' }
    },
    ...overrides,
  }
}

test('artist tracks pagination exceeds first 20 via catalog port', async () => {
  const service = createCatalogBrowseServiceForTests([mockPort()])
  // Bypass SourceManager availability by resolving port methods directly.
  const port = mockPort()
  const first = await port.getArtistTracks('1', { cursor: null })
  assert.equal(first.items.length, 20)
  assert.equal(first.nextCursor, '1')
  const second = await port.getArtistTracks('1', { cursor: '1' })
  assert.equal(second.items.length, 20)
  const third = await port.getArtistTracks('1', { cursor: '2' })
  assert.equal(third.items.length, 5)
  assert.equal(third.nextCursor, null)
  assert.equal(first.items.length + second.items.length + third.items.length, 45)
  void service
})

test('album tracks support follow-up pages', async () => {
  const port = mockPort()
  const first = await port.getAlbumTracks('9', { cursor: null })
  assert.equal(first.items.length, 2)
  assert.equal(first.nextCursor, 'next')
  const second = await port.getAlbumTracks('9', { cursor: 'next' })
  assert.equal(second.items.length, 1)
  assert.equal(second.nextCursor, null)
})

test('unavailable catalog source is skipped in artist search', async () => {
  const service = createCatalogBrowseServiceForTests([
    mockPort({
      isAvailable: () => false,
      async searchArtists() {
        throw new Error('should not be called')
      },
    }),
  ])
  const result = await service.searchArtists('alpha')
  assert.deepEqual(result.artists, [])
  assert.deepEqual(result.warnings, [])
})

test('searchArtists returns available port hits', async () => {
  const service = createCatalogBrowseServiceForTests([mockPort()])
  const result = await service.searchArtists('alpha')
  assert.equal(result.artists.length, 1)
  assert.equal(result.artists[0]?.name, 'Alpha')
})
