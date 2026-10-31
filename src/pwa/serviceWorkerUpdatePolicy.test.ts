import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  handleServiceWorkerNeedReload,
  isAudibleHtmlAudioPlaying,
  shouldReloadForServiceWorkerUpdate,
} from './serviceWorkerUpdatePolicy.ts'

test('reload after SW update is skipped while music is playing', () => {
  assert.equal(shouldReloadForServiceWorkerUpdate(true), false)
  assert.equal(shouldReloadForServiceWorkerUpdate(false), true)
})

test('handleServiceWorkerNeedReload does not call reload while playing', () => {
  let reloads = 0
  handleServiceWorkerNeedReload({
    isPlaying: () => true,
    reload: () => {
      reloads += 1
    },
  })
  assert.equal(reloads, 0)

  handleServiceWorkerNeedReload({
    isPlaying: () => false,
    reload: () => {
      reloads += 1
    },
  })
  assert.equal(reloads, 1)
})

test('isAudibleHtmlAudioPlaying inspects audio paused flag', () => {
  const doc = {
    querySelectorAll(_sel: string) {
      const items = [
        { tagName: 'AUDIO', paused: true, ended: false },
        { tagName: 'AUDIO', paused: false, ended: false },
      ]
      return {
        length: items.length,
        item(i: number) {
          return items[i] ?? null
        },
      }
    },
  }
  assert.equal(isAudibleHtmlAudioPlaying(doc), true)

  const silent = {
    querySelectorAll(_sel: string) {
      const items = [{ tagName: 'AUDIO', paused: true, ended: false }]
      return {
        length: items.length,
        item(i: number) {
          return items[i] ?? null
        },
      }
    },
  }
  assert.equal(isAudibleHtmlAudioPlaying(silent), false)
})

test('vite workbox enables skipWaiting and clientsClaim despite injectRegister false', () => {
  const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
  assert.match(vite, /injectRegister:\s*false/)
  assert.match(vite, /registerType:\s*'autoUpdate'/)
  assert.match(vite, /skipWaiting:\s*true/)
  assert.match(vite, /clientsClaim:\s*true/)
  assert.match(vite, /cleanupOutdatedCaches:\s*true/)
  assert.match(vite, /handler:\s*'NetworkFirst'/)
  assert.match(vite, /request\.mode\s*===\s*'navigate'/)
  assert.match(vite, /navigateFallback:\s*''/)
})

test('main registers app SW with music-aware reload policy', () => {
  const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
  assert.match(main, /registerAppServiceWorker/)
  assert.equal(main.includes("from 'virtual:pwa-register'"), false)

  const reg = readFileSync(new URL('./registerAppServiceWorker.ts', import.meta.url), 'utf8')
  assert.match(reg, /onNeedReload/)
  assert.match(reg, /handleServiceWorkerNeedReload/)
  assert.match(reg, /isAudibleHtmlAudioPlaying/)
  assert.match(reg, /registration\.update/)
  // Не чистим пользовательские данные при обновлении.
  assert.equal(reg.includes('localStorage.clear'), false)
  assert.equal(reg.includes('sessionStorage.clear'), false)
  assert.equal(reg.includes('indexedDB.deleteDatabase'), false)
})
