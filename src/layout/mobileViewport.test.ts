import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('mobile viewport limits page zoom without global touchmove locks', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

  assert.match(html, /name="viewport"/)
  assert.match(html, /viewport-fit=cover/)
  assert.equal(/maximum-scale\s*=/i.test(html), false)
  assert.equal(/user-scalable\s*=\s*no/i.test(html), false)

  assert.match(css, /touch-action:\s*pan-x\s+pan-y/)
  assert.match(css, /\.swipe-stage\s*\{[^}]*touch-action:\s*none/)
  assert.equal(/addEventListener\(\s*['"]touchmove['"]/.test(css), false)
  assert.equal(/text-size-adjust\s*:\s*none/i.test(css), false)
  assert.match(css, /html :is\(input, textarea, select\)/)
})
