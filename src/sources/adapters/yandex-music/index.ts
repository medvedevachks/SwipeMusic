import { ApiMusicAdapter } from '../ApiMusicAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/** Заготовка Яндекс Музыки. */
export class YandexMusicAdapter extends ApiMusicAdapter {
  readonly id = 'yandex-music'
  readonly label = 'Яндекс Музыка'
}

export function createYandexMusicAdapter(): MusicSourceAdapter {
  return new YandexMusicAdapter()
}
