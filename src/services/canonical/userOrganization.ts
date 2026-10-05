import { useCollectionStore } from '../../store/collectionStore.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { Category } from '../../types/category.ts'
import type { CanonicalLibraryItem, CanonicalMembership, SourceCopySnapshot, TrackIdentity } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import { libraryClient } from '../libraryPersistence/client.ts'
import { runLibraryMutation } from '../libraryPersistence/mutations.ts'
import { sourceTrackKeyOf, snapshotFromTrack } from './mapCanonical.ts'

/**
 * Удалённые операции канонической организации.
 * Не пишет user_category_tracks и не считает user_collection_tracks.liked истиной.
 */
export type CanonicalRemote = {
  ensureIdentity: (snapshot: SourceCopySnapshot) => Promise<TrackIdentity>
  patchCanonicalLiked: (
    canonicalTrackId: string,
    liked: boolean,
  ) => Promise<{ item: CanonicalLibraryItem }>
  assignCanonical: (
    catalogId: string,
    canonicalTrackId: string,
  ) => Promise<{ membership: CanonicalMembership }>
  unassignCanonical: (catalogId: string, canonicalTrackId: string) => Promise<void>
}

const defaultRemote: CanonicalRemote = {
  ensureIdentity: (snapshot) => libraryClient.ensureIdentity(snapshot),
  patchCanonicalLiked: (canonicalTrackId, liked) =>
    libraryClient.patchCanonicalLiked(canonicalTrackId, liked),
  assignCanonical: (catalogId, canonicalTrackId) =>
    libraryClient.assignCanonical(catalogId, canonicalTrackId),
  unassignCanonical: (catalogId, canonicalTrackId) =>
    libraryClient.unassignCanonical(catalogId, canonicalTrackId),
}

let remote: CanonicalRemote = defaultRemote
const identityFlights = new Map<string, Promise<CanonicalLibraryItem>>()

export function setCanonicalRemote(next: CanonicalRemote | null): void {
  remote = next ?? defaultRemote
}

export function clearCanonicalIdentityFlights(): void {
  identityFlights.clear()
}

export async function ensureCanonicalForTrack(track: Track): Promise<CanonicalLibraryItem> {
  const key = sourceTrackKeyOf(track)
  const store = useCanonicalLibraryStore.getState()
  const cachedId = store.sourceKeyToCanonicalId[key]
  const cached = cachedId ? store.itemsById[cachedId] : null
  if (cached) {
    return cached
  }

  const flight = identityFlights.get(key)
  if (flight) {
    return flight
  }

  const pending = remote
    .ensureIdentity(snapshotFromTrack(track))
    .then((identity) => useCanonicalLibraryStore.getState().absorbIdentity(identity))
    .finally(() => {
      identityFlights.delete(key)
    })
  identityFlights.set(key, pending)
  return pending
}

export async function likeSourceTrack(
  track: Track,
  liked: boolean,
): Promise<CanonicalLibraryItem | null> {
  return runLibraryMutation(async () => {
    const current = await ensureCanonicalForTrack(track)
    const response = await remote.patchCanonicalLiked(current.canonicalTrack.id, liked)
    useCanonicalLibraryStore.getState().upsertItem(response.item)
    return response.item
  })
}

/** Лайк результата поиска. Поиск не склеивается: мутация идёт по одному source Track. */
export function likeSearchResult(track: Track): Promise<CanonicalLibraryItem | null> {
  return likeSourceTrack(track, true)
}

export async function assignSourceToCatalog(
  track: Track,
  catalogId: string,
): Promise<boolean> {
  const saved = await runLibraryMutation(async () => {
    const current = await ensureCanonicalForTrack(track)
    const response = await remote.assignCanonical(catalogId, current.canonicalTrack.id)
    useCanonicalLibraryStore
      .getState()
      .addCatalog(current.canonicalTrack.id, response.membership.catalogId)
    return true
  })
  return saved === true
}

export async function removeCanonicalFromCatalog(
  canonicalTrackId: string,
  catalogId: string,
): Promise<boolean> {
  const saved = await runLibraryMutation(async () => {
    await remote.unassignCanonical(catalogId, canonicalTrackId)
    useCanonicalLibraryStore.getState().removeCatalog(canonicalTrackId, catalogId)
    return true
  })
  return saved === true
}

export async function commitSwipeLike(track: Track): Promise<boolean> {
  const item = await likeSourceTrack(track, true)
  if (!item) {
    return false
  }
  useCollectionStore.getState().recordHistory({ track, action: 'like' })
  return true
}

export async function commitCatalogChoice(
  track: Track,
  catalogId: string,
  category?: Category,
): Promise<boolean> {
  const saved = await assignSourceToCatalog(track, catalogId)
  if (!saved) {
    return false
  }
  useCollectionStore.getState().recordHistory({
    track,
    action: 'categorize',
    category,
  })
  return true
}
