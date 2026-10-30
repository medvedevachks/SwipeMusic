import type { Category, TrackAssignment } from '../../types/category'
import type { CollectionTrackData } from '../../types/collectionUser'
import type { GestureConfig } from '../../types/gesture'
import type { HistoryEntry } from '../../types/history'
import type { Track } from '../../types/track'
import { useAuthStore } from '../../store/authStore.ts'
import {
  captureAuthSession,
  isAuthSessionCurrent,
  StaleLibrarySessionError,
  type AuthSessionSnapshot,
} from '../auth/sessionEpoch.ts'
import { libraryClient, LibraryHttpError } from './client.ts'
import {
  toTrackUpsertBody,
  trackFromDomain,
} from './mapLibraryState.ts'
import {
  isLibraryPersistenceArmed,
  LOAD_FAILED_MESSAGE,
  SAVE_FAILED_MESSAGE,
  useLibraryPersistenceStore,
} from './statusStore.ts'

let chain: Promise<void> = Promise.resolve()
let pending = 0

function noteIdleAfterSave(): void {
  const { status } = useLibraryPersistenceStore.getState()
  if (status === 'saving') {
    useLibraryPersistenceStore.getState().setStatus('ready', null)
  }
}

function applyFailureIfCurrent(
  session: AuthSessionSnapshot,
  error: unknown,
  kind: 'load' | 'save',
): void {
  if (!isAuthSessionCurrent(session)) {
    return
  }
  handleLibraryFailure(error, kind)
}

export function handleLibraryFailure(error: unknown, kind: 'load' | 'save'): void {
  if (error instanceof LibraryHttpError && error.status === 401) {
    useLibraryPersistenceStore.getState().setArmed(false)
    useLibraryPersistenceStore.getState().setStatus('idle', null)
    useAuthStore.setState({ user: null, status: 'anonymous' })
    return
  }
  useLibraryPersistenceStore.getState().setStatus(
    'error',
    kind === 'load' ? LOAD_FAILED_MESSAGE : SAVE_FAILED_MESSAGE,
  )
}

export async function runLibraryMutation<T>(task: () => Promise<T>): Promise<T | null> {
  if (!isLibraryPersistenceArmed()) {
    return null
  }
  const session = captureAuthSession()
  pending += 1
  if (useLibraryPersistenceStore.getState().status !== 'loading') {
    useLibraryPersistenceStore.getState().setStatus('saving', null)
  }
  try {
    if (!isLibraryPersistenceArmed() || !isAuthSessionCurrent(session)) {
      return null
    }
    const result = await task()
    if (!isAuthSessionCurrent(session)) {
      return null
    }
    return result
  } catch (error) {
    // Смена аккаунта / logout mid-flight — не SAVE_FAILED / не logout для B.
    if (error instanceof StaleLibrarySessionError) {
      return null
    }
    applyFailureIfCurrent(session, error, 'save')
    return null
  } finally {
    pending -= 1
    // Старый finally A не сбрасывает saving/ready пользователя B.
    if (pending === 0 && isAuthSessionCurrent(session)) {
      noteIdleAfterSave()
    }
  }
}

function enqueue(task: () => Promise<void>): void {
  if (!isLibraryPersistenceArmed()) {
    return
  }
  const session = captureAuthSession()
  pending += 1
  if (useLibraryPersistenceStore.getState().status !== 'loading') {
    useLibraryPersistenceStore.getState().setStatus('saving', null)
  }
  const run = async () => {
    try {
      if (!isLibraryPersistenceArmed() || !isAuthSessionCurrent(session)) {
        return
      }
      await task()
    } catch (error) {
      if (!(error instanceof StaleLibrarySessionError)) {
        applyFailureIfCurrent(session, error, 'save')
      }
    } finally {
      pending -= 1
      if (pending === 0 && isAuthSessionCurrent(session)) {
        noteIdleAfterSave()
      }
    }
  }
  chain = chain.then(run, run)
}

export function persistCategory(category: Category, mode: 'create' | 'update'): void {
  enqueue(() =>
    mode === 'create'
      ? libraryClient.createCategory(category)
      : libraryClient.updateCategory(category),
  )
}

export function persistCategoryDelete(id: string): void {
  enqueue(() => libraryClient.deleteCategory(id))
}

export function persistTrackRecord(record: CollectionTrackData, likedAt: string | null): void {
  enqueue(() =>
    libraryClient.upsertTrack(
      record.trackId,
      toTrackUpsertBody(record, likedAt, { includeUserFields: true }),
    ),
  )
}

export function persistTrackDelete(trackId: string): void {
  enqueue(() => libraryClient.deleteTrack(trackId))
}

export function persistAssignment(track: Track, assignment: TrackAssignment): void {
  enqueue(async () => {
    await libraryClient.upsertTrack(
      track.id,
      toTrackUpsertBody(trackFromDomain(track), null, { includeUserFields: false }),
    )
    await libraryClient.assign(track.id, assignment)
  })
}

export function persistUnassign(trackId: string, categoryId: string): void {
  enqueue(() => libraryClient.unassign(trackId, categoryId))
}

export function persistHistory(entry: HistoryEntry): void {
  enqueue(async () => {
    await libraryClient.upsertTrack(
      entry.track.id,
      toTrackUpsertBody(trackFromDomain(entry.track), null, { includeUserFields: false }),
    )
    await libraryClient.appendHistory(entry)
  })
}

export function persistGesture(config: GestureConfig): void {
  enqueue(() => libraryClient.updateGesture(config))
}
