import { authApi } from '../../api/auth'
import { ApiError } from '../../api/http'
import {
  backupLocalCollection,
  loadLocalCollection,
  saveLocalCollection,
  type LocalCollectionRecord,
} from '../../storage/collectionDb'
import { useCollectionStore } from '../../store/collectionStore'
import { useSessionStore } from '../../store/sessionStore'
import type { CollectionItemDto, CollectionSnapshot, SyncOperation, TrackDecisionDto } from '../../types/sync'
import { createId } from '../../utils/id'
import {
  hasUserCollectionData,
  mergeSnapshots,
  operationsFromSnapshot,
  snapshotFromStore,
  snapshotIsEmpty,
  storeFromSnapshot,
} from './merge'

function currentSnapshot(): CollectionSnapshot {
  const state = useCollectionStore.getState()
  return snapshotFromStore(state)
}

function applySnapshotToStore(snapshot: CollectionSnapshot) {
  const mapped = storeFromSnapshot(snapshot)
  useCollectionStore.getState().hydrate(mapped)
}

async function persist(pending: SyncOperation[], status = useSessionStore.getState().syncStatus) {
  const record: LocalCollectionRecord = {
    snapshot: currentSnapshot(),
    pending,
    status,
    lastError: useSessionStore.getState().syncError ?? undefined,
    ownerUserId: useSessionStore.getState().user?.id ?? null,
  }
  await saveLocalCollection(record)
}

export async function enqueueOperation(operation: SyncOperation) {
  const local = (await loadLocalCollection()) ?? {
    snapshot: currentSnapshot(),
    pending: [],
    status: 'local' as const,
  }
  const pending = [...local.pending, operation]
  useSessionStore.getState().setSyncStatus('local')
  await persist(pending, 'local')
  void flushPending()
}

export async function flushPending() {
  const user = useSessionStore.getState().user
  if (!user) {
    return
  }
  if (!navigator.onLine) {
    useSessionStore.getState().setSyncStatus('local')
    return
  }

  const local = await loadLocalCollection()
  const pending = local?.pending ?? []
  if (pending.length === 0) {
    return
  }

  useSessionStore.getState().setSyncStatus('syncing')
  try {
    await authApi.pushOperations(pending)
    useSessionStore.getState().setSyncStatus('cloud')
    useSessionStore.getState().setConnectionError(null)
    await persist([], 'cloud')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка синхронизации'
    useSessionStore.getState().setSyncStatus('error', message)
    useSessionStore.getState().setConnectionError(message)
    await persist(pending, 'error')
  }
}

let bound = false

function bindStore() {
  if (bound) {
    return
  }
  bound = true
  const store = useCollectionStore.getState()

  useCollectionStore.setState({
    createCategory: (input) => {
      const category = store.createCategory(input)
      void enqueueOperation({
        id: createId('op'),
        type: 'upsert_category',
        payload: { ...category, updatedAt: category.createdAt },
        clientCreatedAt: new Date().toISOString(),
      })
      return category
    },
    updateCategory: (id, input) => {
      store.updateCategory(id, input)
      const category = useCollectionStore.getState().categories.find((item) => item.id === id)
      if (category) {
        void enqueueOperation({
          id: createId('op'),
          type: 'upsert_category',
          payload: { ...category, updatedAt: new Date().toISOString() },
          clientCreatedAt: new Date().toISOString(),
        })
      }
    },
    deleteCategory: (id) => {
      store.deleteCategory(id)
      void enqueueOperation({
        id: createId('op'),
        type: 'delete_category',
        payload: { id, updatedAt: new Date().toISOString() },
        clientCreatedAt: new Date().toISOString(),
      })
    },
    assignTrackToCategory: (trackId, categoryId) => {
      store.assignTrackToCategory(trackId, categoryId)
      const assignment = useCollectionStore
        .getState()
        .assignments.find((item) => item.trackId === trackId && item.categoryId === categoryId)
      if (assignment) {
        const snapshot = snapshotFromStore(useCollectionStore.getState())
        const item = snapshot.items.find((row: CollectionItemDto) => row.id === assignment.id)
        if (item) {
          void enqueueOperation({
            id: createId('op'),
            type: 'upsert_item',
            payload: item,
            clientCreatedAt: new Date().toISOString(),
          })
        }
      }
    },
    likeTrack: (trackId) => {
      store.likeTrack(trackId)
      const liked = useCollectionStore.getState().likedTracks.find((item) => item.trackId === trackId)
      if (liked) {
        const snapshot = snapshotFromStore(useCollectionStore.getState())
        const item = snapshot.items.find((row: CollectionItemDto) => row.id === liked.id)
        if (item) {
          void enqueueOperation({
            id: createId('op'),
            type: 'upsert_item',
            payload: item,
            clientCreatedAt: new Date().toISOString(),
          })
        }
      }
    },
    unlikeTrack: (trackId) => {
      const liked = useCollectionStore.getState().likedTracks.find((item) => item.trackId === trackId)
      store.unlikeTrack(trackId)
      if (liked) {
        void enqueueOperation({
          id: createId('op'),
          type: 'delete_item',
          payload: { id: liked.id, updatedAt: new Date().toISOString() },
          clientCreatedAt: new Date().toISOString(),
        })
      }
    },
    recordDecision: (trackId, action) => {
      store.recordDecision(trackId, action)
      const decision = useCollectionStore.getState().decisions.at(-1)
      if (decision) {
        const snapshot = snapshotFromStore(useCollectionStore.getState())
        const dto = snapshot.decisions.find((row: TrackDecisionDto) => row.id === decision.id)
        if (dto) {
          void enqueueOperation({
            id: createId('op'),
            type: 'append_decision',
            payload: dto,
            clientCreatedAt: new Date().toISOString(),
          })
        }
      }
    },
    setGestureConfig: (config) => {
      store.setGestureConfig(config)
      void enqueueOperation({
        id: createId('op'),
        type: 'upsert_settings',
        payload: {
          gestureConfig: config,
          viewedTrackIds: useCollectionStore.getState().viewedTrackIds,
          updatedAt: new Date().toISOString(),
        },
        clientCreatedAt: new Date().toISOString(),
      })
    },
    upsertSourceTrack: (track) => {
      const saved = store.upsertSourceTrack(track)
      const snapshot = snapshotFromStore(useCollectionStore.getState())
      const item = snapshot.items.find(
        (row: CollectionItemDto) => row.kind === 'source_track' && row.trackId === saved.id,
      )
      if (item) {
        void enqueueOperation({
          id: createId('op'),
          type: 'upsert_item',
          payload: item,
          clientCreatedAt: new Date().toISOString(),
        })
      }
      return saved
    },
    updateSourceTrack: (trackId, input) => {
      store.updateSourceTrack(trackId, input)
      const snapshot = snapshotFromStore(useCollectionStore.getState())
      const item = snapshot.items.find(
        (row: CollectionItemDto) => row.kind === 'source_track' && row.trackId === trackId,
      )
      if (item) {
        void enqueueOperation({
          id: createId('op'),
          type: 'upsert_item',
          payload: { ...item, updatedAt: new Date().toISOString() },
          clientCreatedAt: new Date().toISOString(),
        })
      }
    },
    removeSourceTrack: (trackId) => {
      const assignments = useCollectionStore
        .getState()
        .assignments.filter((item) => item.trackId === trackId)
      store.removeSourceTrack(trackId)
      const now = new Date().toISOString()
      void enqueueOperation({
        id: createId('op'),
        type: 'delete_item',
        payload: { id: `src_${trackId}`, updatedAt: now },
        clientCreatedAt: now,
      })
      for (const assignment of assignments) {
        void enqueueOperation({
          id: createId('op'),
          type: 'delete_item',
          payload: { id: assignment.id, updatedAt: now },
          clientCreatedAt: now,
        })
      }
    },
  })
}

export async function restoreSession() {
  bindStore()
  const local = await loadLocalCollection()
  if (local) {
    applySnapshotToStore(local.snapshot)
    useSessionStore.getState().setSyncStatus(local.status, local.lastError ?? null)
  } else {
    useCollectionStore.setState({ hydrated: true })
    await persist([], 'local')
  }

  try {
    const { user } = await authApi.me()
    useSessionStore.getState().setUser(user)
    useSessionStore.getState().setConnectionError(null)
    if (user) {
      const localAfter = (await loadLocalCollection()) ?? {
        snapshot: currentSnapshot(),
        pending: [],
        status: 'local' as const,
      }
      if (localAfter.ownerUserId && localAfter.ownerUserId !== user.id) {
        await backupLocalCollection(localAfter)
        applySnapshotToStore({
          categories: [],
          items: [],
          decisions: [],
          settings: null,
        })
        await persist([], 'local')
        await pullRemote()
      } else if (hasUserCollectionData(localAfter.snapshot)) {
        useSessionStore.getState().setImportPrompt(true)
      } else {
        await pullRemote()
      }
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      useSessionStore.getState().setUser(null)
    } else {
      useSessionStore
        .getState()
        .setConnectionError('Нет связи с сервером. Коллекция доступна локально.')
    }
  } finally {
    useSessionStore.getState().setLoading(false)
  }

  window.addEventListener('online', () => {
    void flushPending()
  })
}

export async function pullRemote() {
  const snapshot = await authApi.snapshot()
  applySnapshotToStore(snapshot)
  await persist([], snapshotIsEmpty(snapshot) ? 'local' : 'cloud')
  useSessionStore.getState().setSyncStatus(snapshotIsEmpty(snapshot) ? 'local' : 'cloud')
}

export async function importLocalCollection() {
  const local = await loadLocalCollection()
  if (!local) {
    useSessionStore.getState().setImportPrompt(false)
    return
  }
  await backupLocalCollection(local)
  const remote = await authApi.snapshot()
  if (snapshotIsEmpty(local.snapshot) && !snapshotIsEmpty(remote)) {
    applySnapshotToStore(remote)
    useSessionStore.getState().setImportPrompt(false)
    useSessionStore.getState().setSyncStatus('cloud')
    await persist([], 'cloud')
    return
  }
  const merged = mergeSnapshots(local.snapshot, remote)
  applySnapshotToStore(merged)
  const operations = operationsFromSnapshot(merged)
  useSessionStore.getState().setSyncStatus('syncing')
  await authApi.pushOperations(operations)
  useSessionStore.getState().setSyncStatus('cloud')
  useSessionStore.getState().setImportPrompt(false)
  await persist([], 'cloud')
}

export async function skipImport() {
  const local = await loadLocalCollection()
  if (local) {
    await backupLocalCollection(local)
  }
  await pullRemote()
  useSessionStore.getState().setImportPrompt(false)
}
