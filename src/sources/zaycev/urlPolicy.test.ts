import { describe, expect, it } from 'vitest'
import { validateZaycevPageUrl, zaycevExternalId } from './urlPolicy'

describe('validateZaycevPageUrl', () => {
  it('accepts an https page on zaycev.net', () => {
    const result = validateZaycevPageUrl('https://zaycev.net/pages/12345.html')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.href).toBe('https://zaycev.net/pages/12345.html')
    }
  })

  it('rejects a different domain', () => {
    const result = validateZaycevPageUrl('https://example.com/pages/12345.html')
    expect(result.ok).toBe(false)
  })

  it('rejects lookalike hosts', () => {
    expect(validateZaycevPageUrl('https://zaycev.net.evil.com/track').ok).toBe(false)
    expect(validateZaycevPageUrl('https://notzaycev.net/track').ok).toBe(false)
    expect(validateZaycevPageUrl('https://cdndl.zaycev.net/file.mp3').ok).toBe(false)
  })

  it('rejects dangerous schemes', () => {
    expect(validateZaycevPageUrl('javascript:alert(1)').ok).toBe(false)
    expect(validateZaycevPageUrl('data:text/html,hi').ok).toBe(false)
    expect(validateZaycevPageUrl('http://zaycev.net/pages/1.html').ok).toBe(false)
  })

  it('rejects direct audio links on an allowed host', () => {
    expect(validateZaycevPageUrl('https://zaycev.net/files/song.mp3').ok).toBe(false)
  })

  it('builds a stable external id', () => {
    expect(zaycevExternalId('https://zaycev.net/pages/12345.html')).toBe('12345')
  })
})
