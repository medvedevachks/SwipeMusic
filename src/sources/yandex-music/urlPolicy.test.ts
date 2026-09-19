import { describe, expect, it } from 'vitest'
import { validateYandexMusicPageUrl, yandexMusicExternalId } from './urlPolicy'

describe('validateYandexMusicPageUrl', () => {
  it('accepts a track page', () => {
    const result = validateYandexMusicPageUrl(
      'https://music.yandex.ru/album/12345/track/67890',
    )
    expect(result.ok).toBe(true)
    expect(yandexMusicExternalId('https://music.yandex.ru/album/12345/track/67890')).toBe(
      '67890',
    )
  })

  it('rejects a foreign domain', () => {
    expect(validateYandexMusicPageUrl('https://example.com/album/1/track/2').ok).toBe(false)
  })

  it('rejects lookalike hosts', () => {
    expect(
      validateYandexMusicPageUrl('https://music.yandex.ru.evil.com/album/1/track/2').ok,
    ).toBe(false)
  })

  it('rejects dangerous schemes and http', () => {
    expect(validateYandexMusicPageUrl('javascript:alert(1)').ok).toBe(false)
    expect(validateYandexMusicPageUrl('http://music.yandex.ru/album/1/track/2').ok).toBe(false)
  })
})
