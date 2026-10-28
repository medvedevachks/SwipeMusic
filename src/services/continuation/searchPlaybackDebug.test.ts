import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  getSearchPlaybackDebugEvents,
  isSearchPlaybackDebugEnabled,
  noteSearchPlaybackEvent,
} from './searchPlaybackDebug.ts'

test('debug events stay silent when the diagnostic flag is off', () => {
  assert.equal(isSearchPlaybackDebugEnabled(), false)
  const before = getSearchPlaybackDebugEvents().length
  noteSearchPlaybackEvent('commit-search-seed', {
    trackId: 'yandex-music:secret',
    contextType: 'search-seed',
  })
  assert.equal(getSearchPlaybackDebugEvents().length, before)
})

test('debug module and main bootstrap never log secrets or library payloads', () => {
  const debugSource = readFileSync(new URL('./searchPlaybackDebug.ts', import.meta.url), 'utf8')
  const mainSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8')
  // События несут только метаданные сессии; полей секретов/метаданных трека нет.
  assert.equal(/\bpassword\b/i.test(debugSource), false)
  assert.equal(/\bAuthorization\b/.test(debugSource), false)
  assert.equal(/\bcookie\b/i.test(debugSource), false)
  assert.equal(/libraryItems|accessToken|refreshToken/.test(debugSource), false)
  assert.equal(/\btitle\s*[?:]/.test(debugSource), false)
  assert.equal(/\bartist\s*[?:]/.test(debugSource), false)
  assert.match(
    mainSource,
    /if \(import\.meta\.env\.DEV\) \{\s*installSearchPlaybackDebugBridge\(/,
  )
  void fileURLToPath
})
