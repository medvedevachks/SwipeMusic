import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DECK_GUTTER, DECK_MAX } from '../layout/frame.ts'

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
  assert.match(css, /\.swipe-stage-slot[\s,>{][^}]*grid-area:\s*stage/s)
  assert.match(css, /\.swipe-deck\s*\{[^}]*display:\s*grid/s)
  assert.match(css, /grid-template-areas:[\s\S]*left stage right/)
  assert.match(css, /\.swipe-stage\s*\{[^}]*height:\s*clamp\(268px,\s*44svh,\s*420px\)/s)

  // Боковые колонки узкие — центральная колонка остаётся основной шириной карточки.
  assert.match(
    css,
    /\.swipe-deck\s*\{[^}]*grid-template-columns:\s*2\.75rem minmax\(0,\s*1fr\) 2\.75rem/s,
  )

  // CSS-защита: голый .swipe-stage тоже занимает stage, не первую колонку 2.75rem.
  assert.match(css, /\.swipe-deck > \.swipe-stage[\s,{][^}]*grid-area:\s*stage/s)
})

/**
 * Геометрия до Play = после Play: одна сетка .swipe-deck, центр stage.
 * happy-dom не считает CSS Grid getBoundingClientRect — считаем треки как браузер.
 */
function measureDeckStageWidth(viewportWidth: number): {
  deck: number
  stage: number
  sideColumn: number
} {
  const rem = 16
  const sideColumn = 2.75 * rem
  const gap = 0.2 * rem
  const padX = 0.4 * rem
  const deck = Math.min(viewportWidth, DECK_MAX)
  const stage = deck - padX * 2 - sideColumn * 2 - gap * 2
  return { deck, stage, sideColumn }
}

test('wave start stage width before Play matches playing deck on 375/768/1280', () => {
  for (const viewport of [375, 768, 1280]) {
    const { deck, stage, sideColumn } = measureDeckStageWidth(viewport)

    assert.ok(deck <= DECK_MAX, `deck exceeds max at ${viewport}`)
    assert.ok(
      stage > sideColumn * 2,
      `stage too narrow at ${viewport}px: ${stage}px (side ${sideColumn}px)`,
    )
    assert.ok(
      stage >= 250,
      `stage below readable width at ${viewport}px: ${stage}px`,
    )
    // Не «полоска» шириной боковой колонки жестов.
    assert.notEqual(Math.round(stage), DECK_GUTTER)
    // До и после Play один и тот же расчёт центральной колонки.
    assert.equal(stage, measureDeckStageWidth(viewport).stage)
  }

  // Регрессия UI-MOBILE-05/05A: не возвращаем короткий clamp для stage.
  assert.equal(css.includes('clamp(152px, 28svh, 196px)'), false)
  assert.equal(css.includes('clamp(176px, 32svh, 240px)'), false)
})
