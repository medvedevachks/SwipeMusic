import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beginCatalogExpandGate,
  cancelCatalogExpandGate,
  completeCatalogExpandGate,
  flushDeferredCatalogNav,
  getDeferredCatalogNav,
  getDeferredCatalogNavBinding,
  isCatalogExpandGateActive,
  resetCatalogExpandNavigationForTests,
  tryDeferCatalogNav,
} from './catalogExpandNavigation.ts'
import { prepareCatalogNeighborWindow } from './prepareCatalogNeighborWindow.ts'
import type { CanonicalLibraryItem, SourceCopy } from '../../types/canonical.ts'
import {
  PLAYBACK_AVAILABILITY_STATUS,
} from '../../types/playbackAvailability.ts'
import type { AvailabilityPort } from '../playbackAvailability/resolveCanonicalPlaybackAvailability.ts'
import { resetPlaybackAvailability } from '../playbackAvailability/resetPlaybackAvailability.ts'

function copyOf(
  canonicalTrackId: string,
  sourceId: string,
  externalId: string,
  title: string,
): SourceCopy {
  return {
    sourceTrackKey: `${sourceId}:${externalId}`,
    sourceId,
    externalId,
    canonicalTrackId,
    title,
    artist: 'A',
    album: null,
    durationMs: 1000,
    artworkUrl: null,
    isrc: null,
    explicit: false,
  }
}

function itemOf(
  canonicalTrackId: string,
  copies: SourceCopy[],
  title: string,
): CanonicalLibraryItem {
  return {
    canonicalTrack: {
      id: canonicalTrackId,
      title,
      artist: 'A',
      album: null,
      durationMs: 1000,
      artworkUrl: null,
      isrc: null,
      year: null,
      genres: [],
    },
    copies,
    state: { liked: false, disliked: false, rating: 0 },
    catalogIds: [],
    sourceFavoriteSourceIds: [],
  }
}

function portAllPlayable(): AvailabilityPort {
  const adapter = {
    id: 'local-folder',
    capabilities: ['stream'],
    supportsStreaming: true,
    isAvailable: () => true,
    async checkTrackAvailability() {
      return { status: PLAYBACK_AVAILABILITY_STATUS.PLAYABLE }
    },
  }
  return {
    isSourceEnabled: () => true,
    findAdapter(sourceId: string) {
      return sourceId === 'local-folder' ? adapter : null
    },
  } as unknown as AvailabilityPort
}

test('deferred Next is flushed only for matching catalog generation', async () => {
  resetCatalogExpandNavigationForTests()
  beginCatalogExpandGate({ generation: 7, catalogId: 'sys_favorites' })
  assert.equal(tryDeferCatalogNav('next'), true)
  assert.equal(getDeferredCatalogNav(), 'next')
  assert.equal(tryDeferCatalogNav('previous'), true)
  assert.equal(getDeferredCatalogNav(), 'previous')

  const calls: string[] = []
  const flushed = await completeCatalogExpandGate(7, {
    getContext: () => ({
      type: 'playlist',
      id: 'sys_favorites',
      title: 'Избранное',
    }),
    runNext: async () => {
      calls.push('next')
    },
    runPrevious: async () => {
      calls.push('previous')
    },
  })
  assert.equal(flushed, 'previous')
  assert.deepEqual(calls, ['previous'])
  assert.equal(isCatalogExpandGateActive(), false)
})

test('deferred nav is dropped after session/catalog change', async () => {
  resetCatalogExpandNavigationForTests()
  beginCatalogExpandGate({ generation: 3, catalogId: 'sys_favorites' })
  assert.equal(tryDeferCatalogNav('next'), true)
  const flushed = await completeCatalogExpandGate(3, {
    getContext: () => ({ type: 'search-seed', query: 'q', seedTrackId: 'x' }),
    runNext: async () => {
      throw new Error('must not run')
    },
    runPrevious: async () => {
      throw new Error('must not run')
    },
  })
  assert.equal(flushed, null)
})

test('cancel clears pending without playback', () => {
  resetCatalogExpandNavigationForTests()
  beginCatalogExpandGate({ generation: 1, catalogId: 'cat_a' })
  tryDeferCatalogNav('next')
  cancelCatalogExpandGate()
  assert.equal(getDeferredCatalogNav(), null)
  assert.equal(tryDeferCatalogNav('next'), false)
})

test('flushDeferredCatalogNav runs pending and keeps gate for late expand', async () => {
  resetCatalogExpandNavigationForTests()
  beginCatalogExpandGate({ generation: 9, catalogId: 'sys_favorites' })
  assert.equal(tryDeferCatalogNav('next'), true)
  const binding = getDeferredCatalogNavBinding()
  assert.deepEqual(binding, {
    command: 'next',
    generation: 9,
    catalogId: 'sys_favorites',
  })
  const calls: string[] = []
  const flushed = await flushDeferredCatalogNav({
    getContext: () => ({
      type: 'playlist',
      id: 'sys_favorites',
      title: 'Избранное',
    }),
    expectedGeneration: 9,
    expectedCatalogId: 'sys_favorites',
    runNext: async () => {
      calls.push('next')
    },
    runPrevious: async () => {
      calls.push('previous')
    },
  })
  assert.equal(flushed, 'next')
  assert.deepEqual(calls, ['next'])
  assert.equal(isCatalogExpandGateActive(), true)
  assert.equal(getDeferredCatalogNav(), null)
})

test('deferred nav binds to generation/catalogId and drops on foreign session', async () => {
  resetCatalogExpandNavigationForTests()
  beginCatalogExpandGate({ generation: 4, catalogId: 'sys_favorites' })
  assert.equal(
    tryDeferCatalogNav('next', {
      getContext: () => ({
        type: 'playlist',
        id: 'sys_favorites',
        title: 'Избранное',
      }),
    }),
    true,
  )

  // Чужой context при defer → cancel gate, команда не копится.
  beginCatalogExpandGate({ generation: 4, catalogId: 'sys_favorites' })
  assert.equal(
    tryDeferCatalogNav('previous', {
      getContext: () => ({ type: 'search-seed', query: 'q', seedTrackId: 'x' }),
    }),
    false,
  )
  assert.equal(isCatalogExpandGateActive(), false)
  assert.equal(getDeferredCatalogNav(), null)

  // Устаревшая generation не flush'ится в чужую сессию.
  beginCatalogExpandGate({ generation: 5, catalogId: 'sys_favorites' })
  assert.equal(tryDeferCatalogNav('next'), true)
  const stale = await flushDeferredCatalogNav({
    getContext: () => ({
      type: 'playlist',
      id: 'sys_favorites',
      title: 'Избранное',
    }),
    expectedGeneration: 4,
    expectedCatalogId: 'sys_favorites',
    runNext: async () => {
      throw new Error('stale generation must not run')
    },
    runPrevious: async () => {
      throw new Error('stale generation must not run')
    },
  })
  assert.equal(stale, null)
  assert.equal(getDeferredCatalogNav(), 'next')

  beginCatalogExpandGate({ generation: 6, catalogId: 'cat_a' })
  assert.equal(tryDeferCatalogNav('next'), true)
  const wrongCatalog = await completeCatalogExpandGate(6, {
    getContext: () => ({
      type: 'playlist',
      id: 'cat_b',
      title: 'Other',
    }),
    runNext: async () => {
      throw new Error('foreign catalog must not run')
    },
    runPrevious: async () => {
      throw new Error('foreign catalog must not run')
    },
  })
  assert.equal(wrongCatalog, null)
})

test('neighbor window prepares adjacent ready tracks before full catalog', async () => {
  resetPlaybackAvailability()
  const items = Array.from({ length: 20 }, (_, index) => {
    const id = `can_${index}`
    return itemOf(id, [copyOf(id, 'local-folder', `t${index}.mp3`, `T${index}`)], `T${index}`)
  })
  const start = items[10]!
  const startResolution = {
    status: 'ready' as const,
    entry: {
      canonicalTrackId: start.canonicalTrack.id,
      track: {
        id: start.copies[0]!.sourceTrackKey,
        sourceId: 'local-folder',
        externalId: 't10.mp3',
        title: 'T10',
        artist: 'A',
      },
      selection: {
        canonicalTrackId: start.canonicalTrack.id,
        selectedCopy: start.copies[0]!,
        selectedTrack: {
          id: start.copies[0]!.sourceTrackKey,
          sourceId: 'local-folder',
          externalId: 't10.mp3',
          title: 'T10',
          artist: 'A',
        },
        availability: {
          canonicalTrackId: start.canonicalTrack.id,
          copies: [],
          playableCopies: [],
          hasPlayableCopy: true,
        },
        reason: 'SELECTED' as const,
      },
    },
  }

  const trackByKey = new Map(
    items.flatMap((item) =>
      item.copies.map((copy) => [
        copy.sourceTrackKey,
        {
          id: copy.sourceTrackKey,
          sourceId: copy.sourceId,
          externalId: copy.externalId,
          title: copy.title,
          artist: copy.artist ?? 'A',
        },
      ]),
    ),
  )
  const result = await prepareCatalogNeighborWindow({
    items,
    startCanonicalTrackId: 'can_10',
    port: portAllPlayable(),
    findTrack: (key) => trackByKey.get(key) ?? null,
    preResolved: new Map([['can_10', startResolution]]),
    readyPerSide: 1,
    maxScanPerSide: 3,
  })

  assert.ok(result.partialQueue.length >= 3)
  assert.equal(
    result.partialQueue[result.startIndex]?.canonicalTrackId,
    'can_10',
  )
  assert.ok(
    result.partialQueue.some((entry) => entry.canonicalTrackId === 'can_9'),
  )
  assert.ok(
    result.partialQueue.some((entry) => entry.canonicalTrackId === 'can_11'),
  )
})
