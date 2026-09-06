import { metadataExtractor } from './MetadataExtractor'
import type { MediaFile, TrackMetadata } from './types'
import type { Track } from '../../types/track'
import type { MusicSourceAdapter } from '../../sources/MusicSourceAdapter'
import { getMediaIndex } from './MediaIndex'

/**
 * Синхронизация адаптера → MediaIndex.
 * Provider отвечает только за sync; остальное читает индекс.
 */
export async function syncAdapterToMediaIndex(
  adapter: MusicSourceAdapter,
  options?: { signal?: AbortSignal },
): Promise<number> {
  const available = await adapter.isAvailable()
  if (!available) {
    getMediaIndex().replaceSource(adapter.id, [])
    return 0
  }

  if (options?.signal?.aborted) {
    return 0
  }

  const result = await adapter.fetchTracks()
  if (options?.signal?.aborted) {
    return 0
  }

  await indexTracksForSource(adapter.id, result.tracks)
  return result.tracks.length
}

export async function indexTracksForSource(
  sourceId: string,
  tracks: Track[],
  files?: MediaFile[],
): Promise<void> {
  const index = getMediaIndex()
  await index.whenReady()

  const fileByExternal = new Map(
    (files ?? []).map((file) => [file.externalId, file]),
  )

  const enriched: Array<{
    track: Track
    extras: {
      metadata?: Partial<TrackMetadata>
      path?: string
      hash?: string
    }
  }> = []

  for (const track of tracks) {
    const file = fileByExternal.get(track.externalId)
    let metadata: Partial<TrackMetadata> = {
      title: track.title,
      artist: track.artist,
      album: track.album,
      genre: track.genre,
      year: track.year,
      durationMs: track.durationMs,
      size: file?.size,
      codec: file?.mimeType,
    }

    if (file) {
      const extracted = await metadataExtractor.extract(file)
      metadata = {
        ...extracted,
        title:
          track.artist === 'Unknown Artist' ? extracted.title : track.title,
        artist:
          track.artist === 'Unknown Artist' ? extracted.artist : track.artist,
        album: track.album ?? extracted.album,
        durationMs: track.durationMs ?? extracted.durationMs,
        size: file.size ?? extracted.size,
      }
    }

    enriched.push({
      track: {
        ...track,
        title: metadata.title ?? track.title,
        artist: metadata.artist ?? track.artist,
        album: metadata.album ?? track.album,
        previewUrl: null,
      },
      extras: {
        path: file?.path ?? track.externalId,
        hash:
          file?.modifiedAt && file.size != null
            ? `${file.size}:${file.modifiedAt}`
            : undefined,
        metadata,
      },
    })
  }

  index.replaceSource(
    sourceId,
    enriched.map((item) => item.track),
    (track) =>
      enriched.find((item) => item.track.id === track.id)?.extras ?? {},
  )
}

/** Индексация MediaFile[] через MetadataExtractor. */
export async function indexMediaFiles(
  sourceId: string,
  files: MediaFile[],
  toTrack: (file: MediaFile, metadata: Awaited<ReturnType<typeof metadataExtractor.extract>>) => Track,
): Promise<void> {
  const tracks: Track[] = []
  for (const file of files) {
    const metadata = await metadataExtractor.extract(file)
    tracks.push(toTrack(file, metadata))
  }
  await indexTracksForSource(sourceId, tracks, files)
}
