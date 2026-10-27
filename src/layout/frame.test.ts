import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHECK_VIEWPORTS,
  PLAY_CONTROL,
  playControlFrame,
  mainEndsAboveDock,
  stageInnerWidth,
} from './frame.ts'

test('the play control stays centered inside the cover', () => {
  for (const width of [180, 240, 320, 420]) {
    for (const height of [140, 220, 360]) {
      const frame = playControlFrame({ width, height })
      assert.equal(frame.fits, true)
      assert.equal(frame.centered, true)
      assert.equal(frame.targetOk, true)
      assert.equal(frame.left, (width - PLAY_CONTROL.size) / 2)
      assert.equal(frame.top, (height - PLAY_CONTROL.size) / 2)
      assert.equal(frame.width, PLAY_CONTROL.size)
    }
  }
})

test('the deck fits the required viewports without a horizontal overflow', () => {
  for (const viewport of CHECK_VIEWPORTS) {
    const inner = stageInnerWidth(viewport.width)
    assert.ok(inner >= 160, viewport.name)
    assert.ok(inner + 32 <= viewport.width, viewport.name)
  }
  assert.equal(stageInnerWidth(1920 / 1.25), stageInnerWidth(1536))
  assert.ok(stageInnerWidth(1366 / 1.5) >= 160)
})

test('in-flow dock keeps page content above the player', () => {
  for (const viewport of CHECK_VIEWPORTS) {
    const dock = viewport.height <= 700 ? 132 : 168
    const mainBottom = viewport.height - dock
    assert.equal(mainEndsAboveDock(viewport.height, dock, mainBottom), true)
    assert.equal(mainEndsAboveDock(viewport.height, dock, viewport.height - 4), false)
  }
})
