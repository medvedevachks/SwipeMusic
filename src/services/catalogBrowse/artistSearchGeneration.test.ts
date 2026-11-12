import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bumpArtistSearchGeneration,
  getArtistSearchGeneration,
  isCurrentArtistSearchGeneration,
  resetArtistSearchGenerationForTests,
} from './artistSearchGeneration.ts'

test('artist search generation rejects stale responses after bump/clear', () => {
  resetArtistSearchGenerationForTests()
  const first = bumpArtistSearchGeneration()
  assert.equal(first, 1)
  assert.equal(isCurrentArtistSearchGeneration(first), true)

  const second = bumpArtistSearchGeneration()
  assert.equal(second, 2)
  assert.equal(isCurrentArtistSearchGeneration(first), false)
  assert.equal(isCurrentArtistSearchGeneration(second), true)
  assert.equal(getArtistSearchGeneration(), 2)
})
