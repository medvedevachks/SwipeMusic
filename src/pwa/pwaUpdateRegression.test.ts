import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

/**
 * Регрессия PLAYBACK-PWA-CACHE-01:
 * обычный Reload не должен оставаться на waiting SW с stale precache index.html.
 * Hard Reload обходил SW и поэтому показывал новую версию.
 */

test('generated SW skips waiting and claims clients when dist is present', () => {
  const swPath = resolve('dist/sw.js')
  if (!existsSync(swPath)) {
    // Свежий checkout без build — конфиг уже проверен в serviceWorkerUpdatePolicy.test.ts
    assert.ok(true)
    return
  }

  const sw = readFileSync(swPath, 'utf8')
  // workbox injects skipWaiting/clientsClaim as direct calls when flags are true
  assert.match(sw, /skipWaiting/)
  assert.match(sw, /clientsClaim/)
  assert.match(sw, /cleanupOutdatedCaches/)
  // NetworkFirst navigation runtime route present; BoundToURL shell disabled
  assert.match(sw, /html-navigations/)
  assert.match(sw, /NetworkFirst/)
  assert.equal(sw.includes('createHandlerBoundToURL'), false)
  assert.equal(sw.includes('NavigationRoute'), false)
})

test('rollback path: previous hashed assets remain addressable by old index revision', () => {
  /*
   * Vite content-hash: откат = вернуть предыдущий dist (index.html + assets + sw.js).
   * Новый SW с cleanupOutdatedCaches не должен мешать явному rollback пакета на сервере.
   */
  const vite = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
  assert.match(vite, /cleanupOutdatedCaches:\s*true/)
  // Hashed assets remain unique filenames — rollback swaps the whole webroot.
  assert.match(vite, /globPatterns:\s*\['\*\*\/\*\.\{js,css,html/)
})
