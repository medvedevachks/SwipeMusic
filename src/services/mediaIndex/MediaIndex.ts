import type { Track } from '../../types/track'
import { platformEventBus } from '../../sdk/EventBus'
import { computeDedupeKey, mergeRecords } from './dedupe'
import { artworkCache } from './ArtworkCache'
import type { MediaIndexStorage } from './storage/MediaIndexStorage'
import { MemoryMediaIndexStorage } from './storage/MemoryMediaIndexStorage'
import { IndexedDbMediaIndexStorage } from './storage/IndexedDbMediaIndexStorage'
import type {
  MediaIndexQuery,
  MediaIndexStats,
  TrackMetadata,
  TrackRecord,
} from './types'

function folderOf(track: Track, path?: string): string {
  const raw = (path ?? track.externalId).replace(/\\/g, '/')
  const slash = raw.lastIndexOf('/')
  if (slash <= 0) {
    return '/'
  }
  return raw.slice(0, slash)
}

function stripPreview(track: Track): Track {
  return { ...track, previewUrl: null }
}

function metadataFromTrack(track: Track): TrackMetadata {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    year: track.year,
    durationMs: track.durationMs,
    artworkKey: track.coverUrl ?? null,
    lyrics: null,
    isrc: null,
    musicBrainzId: null,
    tags: track.tags ? [...track.tags] : [],
  }
}

/**
 * Единая база библиотеки. UI / Search / Library / Swipe читают только отсюда.
 * Не хранит ObjectURL / DOM / React.
 */
export class MediaIndex {
  private readonly byId = new Map<string, TrackRecord>()
  private readonly dedupeToId = new Map<string, string>()
  private ready: Promise<void>
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private readonly memory: MediaIndexStorage
  private readonly durable: MediaIndexStorage

  constructor(
    memory: MediaIndexStorage = new MemoryMediaIndexStorage(),
    durable: MediaIndexStorage = new IndexedDbMediaIndexStorage(),
  ) {
    this.memory = memory
    this.durable = durable
    this.ready = this.hydrate()
  }

  async whenReady(): Promise<void> {
    await this.ready
  }

  private async hydrate(): Promise<void> {
    const durable = await this.durable.load()
    const seed = durable.length > 0 ? durable : await this.memory.load()
    this.byId.clear()
    this.dedupeToId.clear()
    for (const record of seed) {
      this.byId.set(record.id, record)
      const key = computeDedupeKey(record.track, record.metadata, record.hash)
      this.dedupeToId.set(key, record.id)
    }
    await this.memory.save([...this.byId.values()])
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }
    this.persistTimer = setTimeout(() => {
      void this.flush()
    }, 300)
  }

  async flush(): Promise<void> {
    const snapshot = [...this.byId.values()]
    await this.memory.save(snapshot)
    await this.durable.save(snapshot)
  }

  async transaction<T>(fn: (index: MediaIndex) => Promise<T> | T): Promise<T> {
    await this.whenReady()
    const result = await fn(this)
    await this.flush()
    return result
  }

  upsert(track: Track, extras?: {
    metadata?: Partial<TrackMetadata>
    path?: string
    hash?: string
    providerId?: string
  }): TrackRecord {
    const now = new Date().toISOString()
    const metadata: TrackMetadata = {
      ...metadataFromTrack(track),
      ...extras?.metadata,
    }
    const providerId = extras?.providerId ?? track.sourceId
    const hash = extras?.hash
    const path = extras?.path ?? track.externalId

    const incoming: TrackRecord = {
      id: track.id,
      track: stripPreview(track),
      metadata,
      sourceId: track.sourceId,
      providerId,
      path,
      hash,
      indexedAt: now,
      modifiedAt: now,
      lastSynced: now,
      copies: [
        {
          sourceId: track.sourceId,
          providerId,
          externalId: track.externalId,
          path,
          hash,
          available: true,
          lastSynced: now,
        },
      ],
      unavailable: false,
    }

    const dedupeKey = computeDedupeKey(incoming.track, metadata, hash)
    const existingId = this.dedupeToId.get(dedupeKey)
    const existing = existingId ? this.byId.get(existingId) : this.byId.get(track.id)

    let stored: TrackRecord
    if (existing) {
      stored = mergeRecords(existing, {
        ...incoming,
        indexedAt: existing.indexedAt,
      })
      this.byId.delete(existing.id)
      // Сохраняем стабильный id первой записи.
      stored = { ...stored, id: existing.id, track: { ...stored.track, id: existing.id } }
      this.byId.set(stored.id, stored)
      this.dedupeToId.set(dedupeKey, stored.id)
    } else {
      stored = incoming
      this.byId.set(stored.id, stored)
      this.dedupeToId.set(dedupeKey, stored.id)
    }

    if (metadata.artworkKey) {
      artworkCache.set(stored.id, metadata.artworkKey)
    }

    this.schedulePersist()
    return stored
  }

  /** Полная замена треков источника (sync). */
  replaceSource(
    sourceId: string,
    tracks: Track[],
    mapExtras?: (track: Track) => {
      metadata?: Partial<TrackMetadata>
      path?: string
      hash?: string
    },
  ): void {
    const incomingExternalIds = new Set(tracks.map((track) => track.externalId))

    for (const [id, record] of [...this.byId.entries()]) {
      const copiesFromSource = record.copies.filter(
        (copy) => copy.sourceId === sourceId,
      )
      if (copiesFromSource.length === 0 && record.sourceId !== sourceId) {
        continue
      }

      const stillPresent = copiesFromSource.some((copy) =>
        incomingExternalIds.has(copy.externalId),
      ) || (record.sourceId === sourceId && incomingExternalIds.has(record.track.externalId))

      if (stillPresent) {
        continue
      }

      const remaining = record.copies.filter((copy) => copy.sourceId !== sourceId)
      if (remaining.length === 0) {
        this.byId.delete(id)
        for (const [key, mappedId] of [...this.dedupeToId.entries()]) {
          if (mappedId === id) {
            this.dedupeToId.delete(key)
          }
        }
      } else {
        this.byId.set(id, {
          ...record,
          copies: remaining,
          sourceId: remaining[0]!.sourceId,
          unavailable: remaining.every((copy) => !copy.available),
        })
      }
    }

    for (const track of tracks) {
      this.upsert(track, {
        providerId: sourceId,
        ...mapExtras?.(track),
      })
    }

    platformEventBus.emit('LibraryUpdated', { sourceId })
    this.schedulePersist()
  }

  remove(trackId: string): void {
    const record = this.byId.get(trackId)
    if (!record) {
      return
    }
    this.byId.delete(trackId)
    for (const [key, id] of [...this.dedupeToId.entries()]) {
      if (id === trackId) {
        this.dedupeToId.delete(key)
      }
    }
    artworkCache.remove(trackId)
    platformEventBus.emit('LibraryUpdated', { sourceId: record.sourceId })
    this.schedulePersist()
  }

  get(trackId: string): TrackRecord | null {
    return this.byId.get(trackId) ?? null
  }

  list(options?: { includeUnavailable?: boolean }): TrackRecord[] {
    const rows = [...this.byId.values()]
    if (options?.includeUnavailable) {
      return rows
    }
    return rows.filter((record) => !record.unavailable)
  }

  all(): TrackRecord[] {
    return this.list()
  }

  search(query: string, sourceIds?: string[]): TrackRecord[] {
    const q = query.trim().toLowerCase()
    if (!q) {
      return []
    }
    return this.list().filter((record) => {
      if (sourceIds && !sourceIds.includes(record.sourceId)) {
        return false
      }
      const haystack = [
        record.metadata.title,
        record.metadata.artist,
        record.metadata.album ?? '',
        record.track.title,
        record.track.artist,
        record.track.album ?? '',
        record.path ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }

  query(filters: MediaIndexQuery): TrackRecord[] {
    let rows = this.list({ includeUnavailable: filters.includeUnavailable })
    if (filters.sourceId) {
      rows = rows.filter((record) => record.sourceId === filters.sourceId)
    }
    if (filters.artist) {
      const artist = filters.artist.toLowerCase()
      rows = rows.filter(
        (record) => record.metadata.artist.toLowerCase() === artist,
      )
    }
    if (filters.album) {
      const album = filters.album.toLowerCase()
      rows = rows.filter(
        (record) => (record.metadata.album ?? '').toLowerCase() === album,
      )
    }
    if (filters.folder) {
      rows = rows.filter(
        (record) => folderOf(record.track, record.path) === filters.folder,
      )
    }
    if (filters.q) {
      rows = this.search(filters.q).filter((record) =>
        rows.some((row) => row.id === record.id),
      )
    }
    return rows
  }

  byArtist(artist: string): TrackRecord[] {
    return this.query({ artist })
  }

  byAlbum(album: string): TrackRecord[] {
    return this.query({ album })
  }

  byFolder(folder: string): TrackRecord[] {
    return this.query({ folder })
  }

  bySource(sourceId: string): TrackRecord[] {
    return this.query({ sourceId })
  }

  byCategory(_categoryId: string): TrackRecord[] {
    // Категории живут в CollectionEngine; связка по trackId — на следующем этапе.
    return []
  }

  stats(): MediaIndexStats {
    const rows = this.list()
    const sourceCounts: Record<string, number> = {}
    const artists = new Set<string>()
    const albums = new Set<string>()
    let lastSyncedAt: string | null = null

    for (const record of rows) {
      sourceCounts[record.sourceId] = (sourceCounts[record.sourceId] ?? 0) + 1
      artists.add(record.metadata.artist)
      if (record.metadata.album) {
        albums.add(record.metadata.album)
      }
      if (!lastSyncedAt || record.lastSynced > lastSyncedAt) {
        lastSyncedAt = record.lastSynced
      }
    }

    return {
      trackCount: rows.length,
      sourceCounts,
      artistCount: artists.size,
      albumCount: albums.size,
      lastSyncedAt,
    }
  }

  /** Track[] для Swipe / Queue / Search UI. */
  listTracks(sourceId?: string): Track[] {
    const rows = sourceId ? this.bySource(sourceId) : this.list()
    return rows.map((record) => record.track)
  }
}

let singleton: MediaIndex | null = null

export function getMediaIndex(): MediaIndex {
  if (!singleton) {
    singleton = new MediaIndex()
  }
  return singleton
}
