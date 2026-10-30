import assert from 'node:assert/strict'
import test from 'node:test'
import { settlePlayGeneration } from './stalePlaySettlement.ts'

test('stale after-await abandons without touching adapter', () => {
  assert.equal(
    settlePlayGeneration({
      attemptGeneration: 1,
      currentPlayGeneration: 2,
      phase: 'after-await',
    }),
    'abandon-silent',
  )
})

test('current after-await proceeds to commit/play', () => {
  assert.equal(
    settlePlayGeneration({
      attemptGeneration: 3,
      currentPlayGeneration: 3,
      phase: 'after-await',
    }),
    'proceed',
  )
})

test('stale on-error abandons even without abort flag', () => {
  assert.equal(
    settlePlayGeneration({
      attemptGeneration: 1,
      currentPlayGeneration: 4,
      phase: 'on-error',
      isAbortError: false,
    }),
    'abandon-silent',
  )
})

test('current abort on-error abandons silently (pause already done by newer intent)', () => {
  assert.equal(
    settlePlayGeneration({
      attemptGeneration: 5,
      currentPlayGeneration: 5,
      phase: 'on-error',
      isAbortError: true,
    }),
    'abandon-silent',
  )
})

test('current non-abort on-error proceeds to error handling / pause', () => {
  assert.equal(
    settlePlayGeneration({
      attemptGeneration: 5,
      currentPlayGeneration: 5,
      phase: 'on-error',
      isAbortError: false,
    }),
    'proceed',
  )
})
