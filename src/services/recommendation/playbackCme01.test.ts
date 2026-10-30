/**
 * PLAYBACK-CME-01 — idle seed, buffer 10/5, swipe 70/30, hidden exclusions.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CONTINUOUS_LIMITS } from './continuousLimits.ts'
import {
  CONTINUOUS_BUFFER_LOW_WATERMARK,
  CONTINUOUS_BUFFER_TARGET,
} from './continuousBuffer.ts'
import {
  applySwipeMixBias,
  buildHiddenExclusionIds,
  classifySwipeMixLibraryItem,
  planSwipeMixSlots,
} from './swipeMixBias.ts'
import type { ContinuationLibraryTrack } from '../continuation/libraryContinuation.ts'
import type { Track } from '../../types/track.ts'

function lib(
  partial: Partial<ContinuationLibraryTrack> &
    Pick<ContinuationLibraryTrack, 'id' | 'externalId' | 'title'>,
): ContinuationLibraryTrack {
  return {
    sourceId: 'local',
    artist: 'Art',
    artistId: null,
    liked: false,
    disliked: false,
    hidden: false,
    favorite: false,
    inCatalog: false,
    score: 0,
    lastPlayed: null,
    ...partial,
  }
}

function tr(id: string, title = id): Track {
  return {
    id: `local:${id}`,
    sourceId: 'local',
    externalId: id,
    title,
    artist: 'Art',
  }
}

describe('PLAYBACK-CME-01 continuous contracts', () => {
  it('buffer target 10 and low-watermark 5', () => {
    assert.equal(CONTINUOUS_LIMITS.bufferTarget, 10)
    assert.equal(CONTINUOUS_LIMITS.bufferLowWatermark, 5)
    assert.equal(CONTINUOUS_BUFFER_TARGET, 10)
    assert.equal(CONTINUOUS_BUFFER_LOW_WATERMARK, 5)
    assert.equal(CONTINUOUS_LIMITS.batchPlayableTarget, 10)
  })

  it('planSwipeMixSlots ~30% familiar', () => {
    const plan = planSwipeMixSlots(10)
    assert.equal(plan.familiarSlots, 3)
    assert.equal(plan.newSlots, 7)
  })

  it('classify familiar vs new vs excluded', () => {
    assert.equal(
      classifySwipeMixLibraryItem(lib({ id: 'a', externalId: 'a', title: 'A', liked: true })),
      'familiar',
    )
    assert.equal(
      classifySwipeMixLibraryItem(
        lib({ id: 'b', externalId: 'b', title: 'B', favorite: true }),
      ),
      'familiar',
    )
    assert.equal(
      classifySwipeMixLibraryItem(
        lib({ id: 'c', externalId: 'c', title: 'C', inCatalog: true }),
      ),
      'familiar',
    )
    assert.equal(
      classifySwipeMixLibraryItem(lib({ id: 'd', externalId: 'd', title: 'D' })),
      'new',
    )
    assert.equal(
      classifySwipeMixLibraryItem(
        lib({ id: 'e', externalId: 'e', title: 'E', hidden: true }),
      ),
      'excluded',
    )
  })

  it('applySwipeMixBias prefers ~70/30 then fallback fills', () => {
    const library = [
      lib({ id: 'local:f1', externalId: 'f1', title: 'f1', liked: true }),
      lib({ id: 'local:f2', externalId: 'f2', title: 'f2', liked: true }),
      lib({ id: 'local:f3', externalId: 'f3', title: 'f3', inCatalog: true }),
    ]
    const selected = [
      tr('n1'),
      tr('n2'),
      tr('f1'),
      tr('n3'),
      tr('f2'),
      tr('n4'),
      tr('n5'),
      tr('n6'),
      tr('n7'),
      tr('f3'),
    ]
    const biased = applySwipeMixBias({ selected, library, limit: 10 })
    assert.equal(biased.length, 10)
    const familiarCount = biased.filter((t) =>
      ['local:f1', 'local:f2', 'local:f3'].includes(t.id),
    ).length
    assert.ok(familiarCount >= 2)
    assert.ok(familiarCount <= 4)
  })

  it('applySwipeMixBias fallback when few new', () => {
    const library = [
      lib({ id: 'local:f1', externalId: 'f1', title: 'f1', liked: true }),
      lib({ id: 'local:f2', externalId: 'f2', title: 'f2', liked: true }),
      lib({ id: 'local:f3', externalId: 'f3', title: 'f3', liked: true }),
      lib({ id: 'local:f4', externalId: 'f4', title: 'f4', liked: true }),
    ]
    const selected = [tr('n1'), tr('f1'), tr('f2'), tr('f3'), tr('f4')]
    const biased = applySwipeMixBias({ selected, library, limit: 5 })
    assert.equal(biased.length, 5)
    assert.equal(biased[0]?.id, 'local:n1')
  })

  it('buildHiddenExclusionIds covers copy and title keys', () => {
    const ids = buildHiddenExclusionIds([
      lib({
        id: 'local:h1',
        externalId: 'h1',
        title: 'Hidden Song',
        artist: 'Band',
        hidden: true,
      }),
    ])
    assert.ok(ids.has('local:h1'))
    assert.ok(ids.size >= 2)
  })
})
