import assert from 'node:assert/strict'
import test from 'node:test'
import { getDirectionFromMovement } from './gestureConfig.ts'

test('направление свайпа выбирает доминирующую ось', () => {
  assert.equal(getDirectionFromMovement(0, 0, 28), null)
  assert.equal(getDirectionFromMovement(12, -8, 28), null)
  assert.equal(getDirectionFromMovement(100, 0, 28), 'right')
  assert.equal(getDirectionFromMovement(-100, 0, 28), 'left')
  assert.equal(getDirectionFromMovement(0, -100, 28), 'up')
  assert.equal(getDirectionFromMovement(0, 100, 28), 'down')
  assert.equal(getDirectionFromMovement(80, -30, 28), 'right')
  assert.equal(getDirectionFromMovement(-80, 30, 28), 'left')
  assert.equal(getDirectionFromMovement(30, -80, 28), 'up')
  assert.equal(getDirectionFromMovement(-30, 80, 28), 'down')
  assert.equal(getDirectionFromMovement(90, -90, 28), 'right')
  assert.equal(getDirectionFromMovement(-90, 90, 28), 'left')
})
