import { useCollectionStore } from '../../store/collectionStore.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import type { Category } from '../../types/category.ts'
import type { CanonicalLibraryItem, CanonicalMembership, SourceCopySnapshot, TrackIdentity } from '../../types/canonical.ts'
import type { Track } from '../../types/track.ts'
import {
  captureAuthSession,
  isAuthSessionCurrent,
  StaleLibrarySessionError,
} from '../auth/sessionEpoch.ts'
import { SYS_SWIPES_ID } from '../catalogs/systemFolders.ts'
import { libraryClient } from '../libraryPersistence/client.ts'
import { runLibraryMutation } from '../libraryPersistence/mutations.ts'
import { sourceTrackKeyOf, snapshotFromTrack } from './mapCanonical.ts'
import { isSourceCopyLiked } from './selectors.ts'
import { clearPendingSwipeLikes } from '../swipeClassification/pendingSwipeLike.ts'

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
const likeFlights = new Map<string, Promise<boolean>>()

export function setCanonicalRemote(next: CanonicalRemote | null): void {
  remote = next ?? defaultRemote
}

export function clearCanonicalIdentityFlights(): void {
  identityFlights.clear()
  likeFlights.clear()
  // UX-10B: pending LEFT intent не переживает logout / смену аккаунта.
  clearPendingSwipeLikes()
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

  const session = captureAuthSession()
  const pending = remote
    .ensureIdentity(snapshotFromTrack(track))
    .then((identity) => {
      if (!isAuthSessionCurrent(session)) {
        throw new StaleLibrarySessionError()
      }
      return useCanonicalLibraryStore.getState().absorbIdentity(identity)
    })
    .finally(() => {
      // Не сносить flight B после clear + ensure того же sourceTrackKey.
      if (identityFlights.get(key) === pending) {
        identityFlights.delete(key)
      }
    })
  identityFlights.set(key, pending)
  return pending
}

export async function likeSourceTrack(
  track: Track,
  liked: boolean,
): Promise<CanonicalLibraryItem | null> {
  const session = captureAuthSession()
  return runLibraryMutation(async () => {
    const current = await ensureCanonicalForTrack(track)
    if (!isAuthSessionCurrent(session)) {
      throw new StaleLibrarySessionError()
    }
    const response = await remote.patchCanonicalLiked(current.canonicalTrack.id, liked)
    if (!isAuthSessionCurrent(session)) {
      throw new StaleLibrarySessionError()
    }
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
  const session = captureAuthSession()
  const saved = await runLibraryMutation(async () => {
    const current = await ensureCanonicalForTrack(track)
    if (!isAuthSessionCurrent(session)) {
      throw new StaleLibrarySessionError()
    }
    const response = await remote.assignCanonical(catalogId, current.canonicalTrack.id)
    if (!isAuthSessionCurrent(session)) {
      throw new StaleLibrarySessionError()
    }
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
  const session = captureAuthSession()
  const saved = await runLibraryMutation(async () => {
    await remote.unassignCanonical(catalogId, canonicalTrackId)
    if (!isAuthSessionCurrent(session)) {
      throw new StaleLibrarySessionError()
    }
    useCanonicalLibraryStore.getState().removeCatalog(canonicalTrackId, catalogId)
    return true
  })
  return saved === true
}

async function persistSwipeLike(track: Track): Promise<boolean> {
  const session = captureAuthSession()
  const item = await likeSourceTrack(track, true)
  if (!item) {
    return false
  }
  if (!isAuthSessionCurrent(session)) {
    return false
  }
  useCollectionStore.getState().recordHistory({ track, action: 'like' })
  return true
}

/** Лайк свайпа идемпотентен: повтор жеста не пишет вторую запись и не шлёт второй patch. */
export function commitSwipeLike(track: Track): Promise<boolean> {
  const key = sourceTrackKeyOf(track)
  if (isSourceCopyLiked(useCanonicalLibraryStore.getState(), key)) {
    return Promise.resolve(true)
  }
  const current = likeFlights.get(key)
  if (current) {
    return current
  }
  const pending = persistSwipeLike(track).finally(() => {
    if (likeFlights.get(key) === pending) {
      likeFlights.delete(key)
    }
  })
  likeFlights.set(key, pending)
  return pending
}

export type CatalogChoiceResult =
  | { status: 'ok'; canonicalTrackId: string | null }
  | { status: 'failed' }
  | {
      status: 'partial'
      reason: 'inbox_unassign_failed'
      canonicalTrackId: string
    }

/**
 * Сохранить в пользовательский каталог и снять с sys_swipes.
 * Успешный assign не откатывается при ошибке unassign (partial).
 */
export async function commitCatalogChoice(
  track: Track,
  catalogId: string,
  category?: Category,
): Promise<CatalogChoiceResult> {
  if (catalogId === SYS_SWIPES_ID) {
    // Inbox только через like, не через picker «Каталог».
    return { status: 'failed' }
  }

  const session = captureAuthSession()
  const key = sourceTrackKeyOf(track)
  const before = useCanonicalLibraryStore.getState()
  const priorId = before.sourceKeyToCanonicalId[key]
  const priorItem = priorId ? before.itemsById[priorId] : null
  const alreadyInTarget = priorItem?.catalogIds.includes(catalogId) ?? false

  if (!alreadyInTarget) {
    const saved = await assignSourceToCatalog(track, catalogId)
    if (!saved || !isAuthSessionCurrent(session)) {
      return { status: 'failed' }
    }
  }

  if (!isAuthSessionCurrent(session)) {
    return { status: 'failed' }
  }

  const after = useCanonicalLibraryStore.getState()
  const canonicalId = priorId ?? after.sourceKeyToCanonicalId[key] ?? null
  const item = canonicalId ? after.itemsById[canonicalId] : null
  const stillInInbox = Boolean(
    canonicalId && item?.catalogIds.includes(SYS_SWIPES_ID),
  )

  if (stillInInbox && canonicalId) {
    // liked не трогаем. Не откатываем assign при ошибке unassign.
    const removed = await removeCanonicalFromCatalog(canonicalId, SYS_SWIPES_ID)
    if (!isAuthSessionCurrent(session)) {
      return { status: 'failed' }
    }
    if (!removed) {
      if (!alreadyInTarget) {
        useCollectionStore.getState().recordHistory({
          track,
          action: 'categorize',
          category,
        })
      }
      return {
        status: 'partial',
        reason: 'inbox_unassign_failed',
        canonicalTrackId: canonicalId,
      }
    }
  }

  if (!isAuthSessionCurrent(session)) {
    return { status: 'failed' }
  }

  if (!alreadyInTarget) {
    useCollectionStore.getState().recordHistory({
      track,
      action: 'categorize',
      category,
    })
  }
  return { status: 'ok', canonicalTrackId: canonicalId }
}
