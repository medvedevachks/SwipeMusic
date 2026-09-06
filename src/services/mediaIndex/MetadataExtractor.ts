import type { MediaFile, TrackMetadata } from './types'

/**
 * Извлекает метаданные из MediaFile.
 * Сейчас — filename/path heuristics; позже MusicBrainz / Discogs / tags.
 */
export class MetadataExtractor {
  async extract(file: MediaFile): Promise<TrackMetadata> {
    const fileName = file.fileName ?? file.externalId.split(/[/\\]/).at(-1) ?? 'Unknown'
    const base = fileName.replace(/\.[^.]+$/, '')

    let artist = 'Unknown Artist'
    let title = base

    const dash = base.split(' - ')
    if (dash.length >= 2) {
      artist = dash[0]!.trim() || artist
      title = dash.slice(1).join(' - ').trim() || title
    }

    const folderParts = (file.path ?? file.externalId)
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
    const album =
      folderParts.length >= 2 ? folderParts[folderParts.length - 2] : undefined

    const ext = fileName.includes('.')
      ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
      : undefined

    return {
      title,
      artist,
      album,
      durationMs: undefined,
      size: file.size,
      codec: ext,
      artworkKey: null,
      lyrics: null,
      isrc: null,
      musicBrainzId: null,
      tags: [],
    }
  }
}

export const metadataExtractor = new MetadataExtractor()
