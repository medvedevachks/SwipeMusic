import type { IsoTimestamp } from '../types.ts'
import type { SourceCopySnapshot } from '../identity/types.ts'

/** Старт серверного прогона синхронизации. */
export type SourceFavoritesSyncStartResult = {
  sourceId: string
  syncId: string
  startedAt: IsoTimestamp
}

/** Пакет upsert внутри активного syncId. */
export type SourceFavoritesSyncChunkBody = {
  syncId: string
  snapshots: SourceCopySnapshot[]
}

export type SourceFavoritesSyncChunkResult = {
  sourceId: string
  syncId: string
  upserted: number
}

/** Завершение прогона: prune только если syncId ещё open. */
export type SourceFavoritesSyncCompleteBody = {
  syncId: string
}

export type SourceFavoritesSyncCompleteResult = {
  sourceId: string
  syncId: string
  pruned: number
}
