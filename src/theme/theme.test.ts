import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyTheme,
  commitTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  THEME_TOKENS,
} from './theme.ts'
import {
  beginSwitchDrag,
  moveSwitchDrag,
  ratioFromClientX,
  themeForSwitchRelease,
  themeFromRatio,
} from './switchGesture.ts'

const storage = new Map<string, string>()

function installDom(prefersDark: boolean): void {
  const root = {
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  }
  const meta = { content: '', setAttribute(_name: string, value: string) { this.content = value } }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: root,
      querySelector: () => meta,
    },
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
    },
  })
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: prefersDark }),
  })
}

test('theme follows the stored choice over the system preference', () => {
  storage.clear()
  installDom(true)
  assert.equal(resolveTheme(), 'dark')
  commitTheme('light')
  assert.equal(readStoredTheme(), 'light')
  assert.equal(document.documentElement.dataset.theme, 'light')
  assert.equal(resolveTheme(), 'light')
  commitTheme('dark')
  assert.equal(readStoredTheme(), 'dark')
  assert.equal(document.documentElement.dataset.theme, 'dark')
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), 'dark')
})

test('a stored theme is restored on the next open', () => {
  storage.clear()
  installDom(false)
  commitTheme('dark')
  document.documentElement.dataset.theme = 'light'
  applyTheme(resolveTheme())
  assert.equal(document.documentElement.dataset.theme, 'dark')
  assert.equal(THEME_TOKENS.dark.surface, '#1b242c')
})

test('switch click toggles and a drag commits the side under the pointer', () => {
  const click = beginSwitchDrag(1, 30, 20)
  assert.equal(themeForSwitchRelease(click, 'light', 0, 280), 'dark')

  let drag = beginSwitchDrag(1, 40, 24)
  drag = moveSwitchDrag(drag, 210, 26)
  assert.equal(drag.dragging, true)
  assert.equal(themeFromRatio(ratioFromClientX(210, 0, 280)), 'dark')
  assert.equal(themeForSwitchRelease(drag, 'light', 0, 280), 'dark')

  let stay = beginSwitchDrag(1, 40, 24)
  stay = moveSwitchDrag(stay, 90, 24)
  assert.equal(themeForSwitchRelease(stay, 'light', 0, 280), 'light')

  let touch = beginSwitchDrag(2, 240, 30)
  touch = moveSwitchDrag(touch, 50, 34)
  assert.equal(themeForSwitchRelease(touch, 'dark', 0, 280), 'light')
})
