import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PLAY_CONTROL } from './frame.ts'

test('swipe card play control is compact (64–72) without losing min touch target', () => {
  assert.ok(PLAY_CONTROL.size >= 64 && PLAY_CONTROL.size <= 72)
  assert.ok(PLAY_CONTROL.size >= PLAY_CONTROL.minTarget)
})

test('shell CSS encodes compact dock/header and 68px deck-orb', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  assert.match(css, /\.deck-key\.deck-orb[\s\S]*?width:\s*68px/)
  assert.match(css, /orientation:\s*landscape\)\s*and\s*\(max-height:\s*700px\)/)
  assert.match(css, /\.app-header-inner/)
  assert.match(css, /\.bottom-player-shell/)
  assert.match(css, /\.player-expanded-only/)
  assert.match(css, /@container dock \(min-width:\s*880px\)/)
  // Short landscape forces compact even when dock is wide (car 1024×600).
  assert.match(
    css,
    /max-height:\s*700px\)[\s\S]*?\.player-expanded-only[\s\S]*?display:\s*none\s*!important/,
  )
})

test('FullscreenPlayer hierarchy drops duplicate session subtitle and times', () => {
  const source = readFileSync(
    new URL('../components/player/FullscreenPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.equal(source.includes('Сейчас играет'), false)
  assert.match(source, /fullscreen-player-art/)
  assert.match(source, /fullscreen-player-meta/)
  assert.match(source, /fullscreen-player-progress/)
  assert.match(source, /fullscreen-player-transport/)
  assert.match(source, /fullscreen-player-like/)
  assert.match(source, /PlayerVolumeControl/)
  // Один прогресс-бар несёт время; отдельный дубль timestamps не нужен.
  assert.equal((source.match(/formatPlaybackTime/g) ?? []).length, 0)
})

test('BottomPlayer keeps one store-driven presentation with compact/expanded extras', () => {
  const source = readFileSync(
    new URL('../components/player/BottomPlayer.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /player-expanded-only/)
  assert.match(source, /player-compact-menu/)
  assert.match(source, /mini-player-open-fullscreen/)
  assert.equal(source.includes('new AudioPlayer'), false)
  assert.equal(source.includes('switchTo('), false)
})
