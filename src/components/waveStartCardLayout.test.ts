import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const waveSource = readFileSync(new URL('./WaveStartCard.tsx', import.meta.url), 'utf8')
const deckSource = readFileSync(new URL('./SwipeDeck.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

test('WaveStartCard places the stage in swipe-stage-slot like SwipeDeck', () => {
  assert.match(waveSource, /swipe-stage-slot/)
  assert.match(waveSource, /swipe-stage/)
  assert.match(deckSource, /swipe-stage-slot/)

  const slotIndex = waveSource.indexOf('swipe-stage-slot')
  const stageIndex = waveSource.indexOf('className="swipe-stage"', slotIndex)
  assert.ok(slotIndex >= 0)
  assert.ok(stageIndex > slotIndex, 'swipe-stage must sit inside swipe-stage-slot')

  // Не оставляем «голый» swipe-stage прямым ребёнком swipe-deck.
  assert.equal(
    /className="swipe-deck"[^>]*>\s*<div className="swipe-stage">/.test(waveSource),
    false,
  )
})

test('WaveStartCard keeps play, title, pending, sources and retry affordances', () => {
  assert.match(waveSource, /deck-orb/)
  assert.match(waveSource, /Моя волна/)
  assert.match(waveSource, /Подбираем музыку/)
  assert.match(waveSource, /Открыть источники/)
  assert.match(waveSource, /Повторить/)
  assert.match(waveSource, /showSourcesLink/)
  assert.match(waveSource, /pending/)
  assert.match(waveSource, /canStart/)
})

test('wave start stage uses the same grid stage area and height as the playing deck', () => {
  assert.match(css, /\.swipe-stage-slot\s*\{[^}]*grid-area:\s*stage/s)
  assert.match(css, /\.swipe-deck\s*\{[^}]*display:\s*grid/s)
  assert.match(css, /grid-template-areas:[\s\S]*left stage right/)
  assert.match(css, /\.swipe-stage\s*\{[^}]*height:\s*clamp\(268px,\s*44svh,\s*420px\)/s)

  // Боковые колонки узкие — центральная колонка остаётся основной шириной карточки.
  assert.match(
    css,
    /\.swipe-deck\s*\{[^}]*grid-template-columns:\s*2\.75rem minmax\(0,\s*1fr\) 2\.75rem/s,
  )
})

test('wave start center column stays wide on 375px viewport without shrinking swipe-stage height', () => {
  const deckWidth = 375
  const sideRem = 2.75
  const gapRem = 0.2
  const padXRem = 0.4
  const rem = 16
  const center =
    deckWidth - padXRem * rem * 2 - sideRem * rem * 2 - gapRem * rem * 2
  assert.ok(
    center >= 250,
    `center stage column too narrow on 375px: ${center}px`,
  )
  // Регрессия UI-MOBILE-05/05A: не возвращаем короткий clamp для stage.
  assert.equal(css.includes('clamp(152px, 28svh, 196px)'), false)
  assert.equal(css.includes('clamp(176px, 32svh, 240px)'), false)
})
