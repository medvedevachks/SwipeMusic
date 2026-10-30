import type { Track } from '../../types/track.ts'
import { useCanonicalLibraryStore } from '../../store/canonicalLibraryStore.ts'
import {
  itemHasUserCatalogMembership,
  itemInSwipeInbox,
  SYS_SWIPES_ID,
} from '../catalogs/systemFolders.ts'
import { isDemoSourceId } from '../../sources/demoSource.ts'
import {
  assignSourceToCatalog,
  commitSwipeLike,
  ensureCanonicalForTrack,
  removeCanonicalFromCatalog,
} from './userOrganization.ts'
import { sourceTrackKeyOf } from './mapCanonical.ts'
import { isSourceCopyLiked } from './selectors.ts'

/**
 * LIKE в режиме свайпов: один liked=true + membership sys_swipes при необходимости.
 * Не трогает skipped. Demo не кладём в inbox.
 */
export async function commitSwipeLikeWithInbox(track: Track): Promise<boolean> {
  if (isDemoSourceId(track.sourceId)) {
    return false
  }

  const likedOk = await commitSwipeLike(track)
  if (!likedOk) {
    return false
  }

  const store = useCanonicalLibraryStore.getState()
  const key = sourceTrackKeyOf(track)
  const canonicalId = store.sourceKeyToCanonicalId[key]
  const item = canonicalId ? store.itemsById[canonicalId] : null
  // liked уже мог сохраниться; полный success только если inbox тоже ок.
  // Повторный like дозапишет membership без второго history/taste like.
  if (!item) {
    const ensured = await ensureCanonicalForTrack(track)
    return addToSwipeInboxIfNeeded(ensured.canonicalTrack.id)
  }

  return addToSwipeInboxIfNeeded(item.canonicalTrack.id)
}

export async function addToSwipeInboxIfNeeded(
  canonicalTrackId: string,
): Promise<boolean> {
  const item = useCanonicalLibraryStore.getState().itemsById[canonicalTrackId]
  if (!item) {
    return false
  }
  if (itemHasUserCatalogMembership(item)) {
    return true
  }
  if (itemInSwipeInbox(item)) {
    return true
  }
  // assignSourceToCatalog ожидает Track — берём первую не-demo copy.
  const copy =
    item.copies.find((row) => !isDemoSourceId(row.sourceId)) ?? item.copies[0]
  if (!copy) {
    return false
  }
  const track: Track = {
    id: copy.sourceTrackKey,
    sourceId: copy.sourceId,
    externalId: copy.externalId,
    title: copy.title,
    artist: copy.artist,
    album: copy.album ?? undefined,
    durationMs: copy.durationMs ?? undefined,
    coverUrl: copy.artworkUrl ?? undefined,
  }
  return assignSourceToCatalog(track, SYS_SWIPES_ID)
}

export async function removeFromSwipeInbox(
  canonicalTrackId: string,
): Promise<boolean> {
  const item = useCanonicalLibraryStore.getState().itemsById[canonicalTrackId]
  if (!item || !itemInSwipeInbox(item)) {
    return true
  }
  return removeCanonicalFromCatalog(canonicalTrackId, SYS_SWIPES_ID)
}

export function swipeInboxAlreadyLiked(track: Track): boolean {
  return isSourceCopyLiked(
    useCanonicalLibraryStore.getState(),
    sourceTrackKeyOf(track),
  )
}
