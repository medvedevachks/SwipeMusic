import type { Track } from '../types/track'
import { hasCapability, listMusicSources } from '../sources'

export function matchesTrackQuery(track: Pick<Track, 'title' | 'artist'>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return false
  }
  return track.title.toLowerCase().includes(needle) || track.artist.toLowerCase().includes(needle)
}

export async function searchMusic(
  query: string,
  localTracks: Track[] = [],
): Promise<Track[]> {
  const needle = query.trim()
  if (!needle) {
    return []
  }

  const seen = new Set<string>()
  const results: Track[] = []

  for (const track of localTracks) {
    if (matchesTrackQuery(track, needle) && !seen.has(track.id)) {
      seen.add(track.id)
      results.push(track)
    }
  }

  for (const source of listMusicSources()) {
    if (!hasCapability(source.capabilities, 'search') || !source.search) {
      continue
    }
    const available = await source.isAvailable()
    if (!available) {
      continue
    }
    const { tracks } = await source.search(needle)
    for (const track of tracks) {
      if (!seen.has(track.id)) {
        seen.add(track.id)
        results.push(track)
      }
    }
  }

  return results
}
