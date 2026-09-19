import { describe, expect, it } from 'vitest'
import { assertZaycevPageUrl, validateZaycevPageUrl } from './zaycevUrl.ts'

describe('zaycev url policy', () => {
  it('accepts allowed hosts', () => {
    expect(validateZaycevPageUrl('https://www.zaycev.net/song/1').ok).toBe(true)
    expect(validateZaycevPageUrl('https://ru.zaycev.net/song/1').ok).toBe(true)
  })

  it('rejects dangerous and foreign urls', () => {
    expect(() => assertZaycevPageUrl('javascript:alert(1)')).toThrow()
    expect(() => assertZaycevPageUrl('https://example.com/x')).toThrow()
  })
})
