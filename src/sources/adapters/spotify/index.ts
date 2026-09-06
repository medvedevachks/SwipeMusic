import { ApiMusicAdapter } from '../ApiMusicAdapter'
import type { MusicSourceAdapter } from '../../MusicSourceAdapter'

/** Заготовка Spotify Web API / Playback. */
export class SpotifyAdapter extends ApiMusicAdapter {
  readonly id = 'spotify'
  readonly label = 'Spotify'
}

export function createSpotifyAdapter(): MusicSourceAdapter {
  return new SpotifyAdapter()
}
