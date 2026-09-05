import {
  activateMusicSource,
  deactivateMusicSource,
  fetchTracksFromActiveSource,
  fetchTracksFromActiveSources,
  getActiveMusicSource,
  listActiveMusicSources,
  listMusicSources,
  registerMusicSource,
  setActiveMusicSource,
  type MusicSourceAdapter,
} from '../sources'

/** @deprecated Адаптер — не путать с доменной сущностью MusicSource. */
export type MusicSource = MusicSourceAdapter

export {
  activateMusicSource,
  deactivateMusicSource,
  fetchTracksFromActiveSource,
  fetchTracksFromActiveSources,
  getActiveMusicSource,
  listActiveMusicSources,
  listMusicSources,
  registerMusicSource,
  setActiveMusicSource,
}

/** Лента свайпов строится из всех активных источников. */
export async function fetchSwipeFeed() {
  const result = await fetchTracksFromActiveSources()
  return result.tracks
}

export function getMusicSource(): MusicSourceAdapter {
  return getActiveMusicSource()
}

export function setMusicSource(source: MusicSourceAdapter) {
  registerMusicSource(source)
  setActiveMusicSource(source.id)
}
