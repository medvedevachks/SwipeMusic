import { ApiMusicAdapter } from '../ApiMusicAdapter.ts'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/** Заготовка VK Музыки. */
export class VKMusicAdapter extends ApiMusicAdapter {
  readonly id = 'vk-music'
  readonly label = 'VK Музыка'
}

export function createVKMusicAdapter(): MusicSourceAdapter {
  return new VKMusicAdapter()
}
