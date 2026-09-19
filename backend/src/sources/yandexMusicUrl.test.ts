import { describe, expect, it } from 'vitest'
import { assertYandexMusicPageUrl, validateYandexMusicPageUrl } from './yandexMusicUrl.ts'

describe('yandex music url policy', () => {
  it('accepts music.yandex.ru track urls', () => {
    expect(validateYandexMusicPageUrl('https://music.yandex.ru/album/10/track/20').ok).toBe(
      true,
    )
  })

  it('rejects other hosts', () => {
    expect(() => assertYandexMusicPageUrl('https://yandex.ru/search/?text=music')).toThrow()
  })
})
