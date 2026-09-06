import { getCollectionEngine } from '../collectionEngine'
import { bootstrapMusicSources, sourceManager } from '../../sources'
import type { LibraryEntry } from '../../types/trackMeta'
import {
  defaultTrackMeta,
  trackMetaFromCollection,
} from '../../types/trackMeta'
import type { Track } from '../../types/track'

/**
 * Единый каталог: Track из источников + TrackMeta из CollectionEngine.
 * Не знает Spotify/Zaycev — только SourceManager + Collection.
 */
export async function buildLibraryCatalog(): Promise<LibraryEntry[]> {
  bootstrapMusicSources()
  const engine = getCollectionEngine()

  let sourceTracks: Track[] = []
  try {
    const merged = await sourceManager.fetchMergedTracks()
    sourceTracks = merged.tracks
  } catch {
    sourceTracks = []
  }

  for (const track of sourceTracks) {
    engine.addTrack(track)
  }

  return engine
    .listTracks({ includeHidden: false })
    .map((item) => ({
      track: item.track,
      meta: trackMetaFromCollection(item),
    }))
}

export function buildLibraryCatalogFromCollection(): LibraryEntry[] {
  return getCollectionEngine()
    .listTracks({ includeHidden: false })
    .map((item) => ({
      track: item.track,
      meta: trackMetaFromCollection(item),
    }))
}

export function ensureLibraryEntry(track: Track): LibraryEntry {
  const data = getCollectionEngine().addTrack(track)
  return {
    track: data.track,
    meta: trackMetaFromCollection(data),
  }
}

export function libraryEntryOrDefault(track: Track): LibraryEntry {
  const existing = getCollectionEngine().listTracks({ includeHidden: true }).find(
    (item) => item.trackId === track.id,
  )
  if (existing) {
    return {
      track: existing.track,
      meta: trackMetaFromCollection(existing),
    }
  }
  return {
    track,
    meta: defaultTrackMeta(track),
  }
}
