import type { Track } from '../../types/track.ts'
import type {
  CanonicalLibraryItem,
  CanonicalTrack,
  CanonicalUserState,
  SourceCopy,
  SourceCopySnapshot,
  TrackIdentity,
} from '../../types/canonical.ts'
import { stripSecrets } from '../libraryPersistence/mapLibraryState.ts'

export function sourceTrackKeyOf(track: Pick<Track, 'id' | 'sourceId' | 'externalId'>): string {
  if (track.sourceId && track.externalId) {
    return `${track.sourceId}:${track.externalId}`
  }
  return track.id
}

export function snapshotFromTrack(track: Track): SourceCopySnapshot {
  return {
    sourceId: track.sourceId,
    externalId: track.externalId,
    title: track.title,
    artist: track.artist,
    album: track.album ?? null,
    durationMs: track.durationMs ?? null,
    artworkUrl: track.coverUrl ?? null,
  }
}

export function neutralCanonicalState(now: string): CanonicalUserState {
  return {
    addedAt: now,
    lastPlayed: null,
    playCount: 0,
    liked: false,
    likedAt: null,
    disliked: false,
    skipped: 0,
    notes: '',
    favorite: false,
    hidden: false,
    customMetadata: {},
  }
}

export function mapCanonicalLibrary(items: readonly CanonicalLibraryItem[]): CanonicalLibraryItem[] {
  return items.map(mapCanonicalItem)
}

export function mapCanonicalItem(item: CanonicalLibraryItem): CanonicalLibraryItem {
  return {
    canonicalTrack: mapCanonicalTrack(item.canonicalTrack),
    copies: item.copies.map(mapSourceCopy),
    state: mapUserState(item.state),
    catalogIds: [...item.catalogIds],
  }
}

export function itemFromIdentity(identity: TrackIdentity): CanonicalLibraryItem {
  const canonicalTrack = mapCanonicalTrack(identity.canonicalTrack)
  return {
    canonicalTrack,
    copies: identity.copies.map(mapSourceCopy),
    state: neutralCanonicalState(canonicalTrack.createdAt),
    catalogIds: [],
  }
}

export function mergeIdentityIntoItem(
  existing: CanonicalLibraryItem | null,
  identity: TrackIdentity,
): CanonicalLibraryItem {
  const incoming = itemFromIdentity(identity)
  if (!existing) {
    return incoming
  }
  const byKey = new Map<string, SourceCopy>()
  for (const copy of existing.copies) {
    byKey.set(copy.sourceTrackKey, copy)
  }
  for (const copy of incoming.copies) {
    byKey.set(copy.sourceTrackKey, copy)
  }
  return {
    canonicalTrack: incoming.canonicalTrack,
    copies: [...byKey.values()],
    state: existing.state,
    catalogIds: [...existing.catalogIds],
  }
}

function mapCanonicalTrack(track: CanonicalTrack): CanonicalTrack {
  return { ...track }
}

function mapSourceCopy(copy: SourceCopy): SourceCopy {
  return { ...copy }
}

function mapUserState(state: CanonicalUserState): CanonicalUserState {
  return {
    ...state,
    customMetadata: stripSecrets(state.customMetadata ?? {}),
  }
}
