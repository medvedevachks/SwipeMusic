import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('swipe direction hints own grid rows instead of sitting under the card', () => {
  const hints = readFileSync(new URL('./SwipeDirectionHints.tsx', import.meta.url), 'utf8')
  const deck = readFileSync(new URL('./SwipeDeck.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

  assert.match(css, /\.swipe-deck\s*\{[^}]*display:\s*grid/s)
  assert.match(css, /grid-area:\s*up/)
  assert.match(css, /grid-area:\s*down/)
  assert.match(css, /grid-area:\s*left/)
  assert.match(css, /grid-area:\s*right/)
  assert.match(css, /grid-area:\s*stage/)
  assert.match(css, /\.swipe-hint-up\s*\{[^}]*min-height:\s*2\.1rem/s)
  assert.match(css, /\.swipe-hint-down\s*\{[^}]*min-height:\s*2\.1rem/s)

  assert.match(hints, /swipe-hint-up/)
  assert.match(hints, /swipe-hint-down/)
  assert.equal(hints.includes('absolute inset-0'), false)
  assert.equal(hints.includes('top-0'), false)
  assert.equal(hints.includes('bottom-0'), false)

  assert.match(deck, /swipe-stage-slot/)
  assert.equal(deck.includes('relative z-[1]'), false)
})
