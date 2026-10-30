/**
 * Регрессия P0: устаревшее поколение play не вызывает adapter.pause()
 * на shared backend (иначе глушит уже актуальный трек B).
 *
 * Полный AudioPlayer/PlayerManager в node test не грузятся (Vite extensionless imports);
 * контракт веток проверяем по исходникам + inbox/session — поведенческими тестами.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))

test('AudioPlayer stale generation branches must not call adapter.pause', () => {
  const src = readFileSync(join(here, 'AudioPlayer.ts'), 'utf8')

  const staleThenPause =
    /if\s*\(\s*generation\s*!==\s*this\.playGeneration\s*\)\s*\{[^}]*this\.adapter\.pause\s*\(/g
  assert.equal(
    [...src.matchAll(staleThenPause)].length,
    0,
    'stale playGeneration must return without adapter.pause()',
  )

  assert.equal(
    src.includes('isAbortError(error) || generation !== this.playGeneration'),
    false,
    'abort/stale catch must not share a pause path',
  )

  // Актуальная ошибка текущего поколения по-прежнему может pause.
  assert.match(src, /this\.adapter\.pause\(\)/)
})

test('PlayerManager invalidates in-flight load on pause/stop', () => {
  const src = readFileSync(join(here, 'PlayerManager.ts'), 'utf8')
  assert.match(src, /private loadGeneration = 0/)
  assert.match(
    src,
    /async pause\(\): Promise<void> \{\s*this\.loadGeneration \+= 1/s,
  )
  assert.match(src, /stop\(\): void \{\s*this\.loadGeneration \+= 1/s)
  assert.match(src, /error\.name = 'AbortError'/)
  assert.match(src, /pauseBackends/)
})

test('HtmlAudioAdapter checks loadGeneration before assigning src', () => {
  const src = readFileSync(join(here, 'HtmlAudioPlayerAdapter.ts'), 'utf8')
  const beforeSrc = src.indexOf('if (generation !== this.loadGeneration)')
  const assignSrc = src.indexOf('this.audio.src = url')
  assert.ok(beforeSrc >= 0 && assignSrc >= 0 && beforeSrc < assignSrc)
})
