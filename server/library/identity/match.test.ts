import assert from 'node:assert/strict'
import test from 'node:test'
import { matchSourceCopies } from './match.ts'

const base = {
  title: 'Город',
  artist: 'Север',
  durationMs: 180_000,
}

test('same normalized artist and title with close duration can match', () => {
  assert.equal(
    matchSourceCopies(base, {
      title: '  город ',
      artist: 'Север',
      durationMs: 181_500,
    }),
    'MATCH',
  )
})

test('different artist does not match', () => {
  assert.equal(
    matchSourceCopies(base, { ...base, artist: 'Другой' }),
    'NO_MATCH',
  )
})

test('large duration difference does not match', () => {
  assert.equal(
    matchSourceCopies(base, { ...base, durationMs: 240_000 }),
    'NO_MATCH',
  )
})

test('remix or live marker is ambiguous instead of a merge', () => {
  assert.equal(
    matchSourceCopies(base, { ...base, title: 'Город (Remix)' }),
    'AMBIGUOUS',
  )
  assert.equal(
    matchSourceCopies(base, { ...base, title: 'Город Live' }),
    'AMBIGUOUS',
  )
})

test('missing metadata does not auto-merge', () => {
  assert.equal(
    matchSourceCopies(base, { title: 'Город', artist: 'Север' }),
    'NO_MATCH',
  )
  assert.equal(
    matchSourceCopies(
      { title: ' ', artist: 'Север', durationMs: 180_000 },
      base,
    ),
    'NO_MATCH',
  )
})
