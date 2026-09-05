import {
  fetchTracksFromActiveSource,
  getActiveMusicSource,
  listMusicSources,
  registerMusicSource,
  setActiveMusicSource,
  type MusicSourceAdapter,
} from '../sources'

/** @deprecated Используйте MusicSourceAdapter из `src/sources`. */
export type MusicSource = MusicSourceAdapter

export {
  fetchTracksFromActiveSource,
  getActiveMusicSource,
  listMusicSources,
  registerMusicSource,
  setActiveMusicSource,
}

export async function fetchSwipeFeed() {
  const result = await fetchTracksFromActiveSource()
  return result.tracks
}

export function getMusicSource(): MusicSourceAdapter {
  return getActiveMusicSource()
}

export function setMusicSource(source: MusicSourceAdapter) {
  registerMusicSource(source)
  setActiveMusicSource(source.id)
}
