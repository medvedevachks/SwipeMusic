import { sourceManager } from '../../sources/SourceManager.ts'
import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { MusicSourceAdapter } from '../../sources/MusicSourceAdapter.ts'
import type { Track } from '../../types/track.ts'
import { PLAYBACK_AVAILABILITY_STATUS } from '../../types/playbackAvailability.ts'
import { RADIO_LIMITS, type RadioSearchPort } from './recommend.ts'

async function findByArtist(
  adapter: MusicSourceAdapter,
  artist: string,
  signal: AbortSignal,
): Promise<Track[]> {
  const canSearch = adapter.supportsSearch || adapter.capabilities.includes('search')
  if (canSearch) {
    const page = await adapter.search(artist, { limit: RADIO_LIMITS.maxPerSearch, signal })
    return page.tracks
  }
  const canBrowse =
    adapter.capabilities.includes('library') || adapter.capabilities.includes('browse')
  if (!canBrowse) {
    return []
  }
  const page = await adapter.fetchTracks({ limit: 50, signal })
  const needle = artist.trim().toLowerCase()
  return page.tracks.filter((track) => track.artist.toLowerCase().includes(needle))
}

export async function probeTrackPlayable(track: Track, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || isDemoSourceId(track.sourceId)) {
    return false
  }
  const adapter = sourceManager.getAdapter(track.sourceId)
  const available = await adapter.isAvailable()
  if (!available) {
    return false
  }
  if (adapter.checkTrackAvailability) {
    const probe = await adapter.checkTrackAvailability(track)
    return probe.status === PLAYBACK_AVAILABILITY_STATUS.PLAYABLE
  }
  if (!adapter.getPlaybackCandidates) {
    return false
  }
  const candidates = await adapter.getPlaybackCandidates(track)
  return candidates.some((candidate) => candidate.available && Boolean(candidate.url))
}

export async function createLiveRadioPort(): Promise<RadioSearchPort> {
  const sources: MusicSourceAdapter[] = []
  for (const config of sourceManager.listEnabledSources()) {
    if (isDemoSourceId(config.id)) {
      continue
    }
    const adapter = sourceManager.getAdapter(config.id)
    const canQuery =
      adapter.supportsSearch ||
      adapter.capabilities.includes('search') ||
      adapter.capabilities.includes('library') ||
      adapter.capabilities.includes('browse')
    if (!canQuery) {
      continue
    }
    try {
      if (await adapter.isAvailable()) {
        sources.push(adapter)
      }
    } catch {
      // Недоступный источник не участвует в волне.
    }
  }

  return {
    sources: sources.map((adapter) => ({ id: adapter.id })),
    search: (sourceId, query, signal) => {
      const adapter = sources.find((item) => item.id === sourceId)
      if (!adapter) {
        return Promise.resolve([])
      }
      return findByArtist(adapter, query, signal)
    },
    isPlayable: probeTrackPlayable,
  }
}
