import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  readSessionSwitchEnabled,
  resolveSessionSwitchEnabled,
} from './runtimeConfig.ts'

test('session switch defaults OFF when file and env are absent', () => {
  assert.equal(
    resolveSessionSwitchEnabled({
      fileText: null,
      fileError: false,
      envValue: undefined,
    }),
    false,
  )
})

test('env 1 enables only when the flag file is absent', () => {
  assert.equal(
    resolveSessionSwitchEnabled({
      fileText: null,
      fileError: false,
      envValue: '1',
    }),
    true,
  )
  assert.equal(
    resolveSessionSwitchEnabled({
      fileText: '0',
      fileError: false,
      envValue: '1',
    }),
    false,
  )
})

test('file read error fails closed even if env is 1', () => {
  assert.equal(
    resolveSessionSwitchEnabled({
      fileText: null,
      fileError: true,
      envValue: '1',
    }),
    false,
  )
})

test('only exact file text 1 enables; whitespace and BOM are accepted', () => {
  assert.equal(
    resolveSessionSwitchEnabled({
      fileText: '\uFEFF1\n',
      fileError: false,
      envValue: undefined,
    }),
    true,
  )
  assert.equal(
    resolveSessionSwitchEnabled({
      fileText: 'true',
      fileError: false,
      envValue: '1',
    }),
    false,
  )
})

test('readSessionSwitchEnabled uses the flag file on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'swipe-flag-'))
  const flagPath = join(dir, 'session-switch.flag')
  try {
    assert.equal(
      readSessionSwitchEnabled({ SWIPE_SESSION_SWITCH: '1' }, flagPath),
      true,
    )
    writeFileSync(flagPath, '0', 'utf8')
    assert.equal(
      readSessionSwitchEnabled({ SWIPE_SESSION_SWITCH: '1' }, flagPath),
      false,
    )
    writeFileSync(flagPath, '1', 'utf8')
    assert.equal(
      readSessionSwitchEnabled({}, flagPath),
      true,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
