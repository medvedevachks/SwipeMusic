import { assertZaycevPageUrl } from './zaycevUrl.ts'
import { assertYandexMusicPageUrl } from './yandexMusicUrl.ts'

export function assertSourcePageUrl(sourceId: string, pageUrl: string): void {
  if (sourceId === 'zaycev') {
    assertZaycevPageUrl(pageUrl)
    return
  }
  if (sourceId === 'yandex-music') {
    assertYandexMusicPageUrl(pageUrl)
  }
}
