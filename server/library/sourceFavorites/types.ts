import type { IsoTimestamp } from '../types.ts'
import type { SourceCopySnapshot } from '../identity/types.ts'

/** Пакет синхронизации внешнего избранного одного sourceId. */
export type SourceFavoritesSyncBody = {
  snapshots: SourceCopySnapshot[]
  /** Момент старта клиентской синхронизации; на finalize удаляются более старые. */
  seenAt: IsoTimestamp
  /** true только после успешной загрузки полного набора чанков. */
  finalize: boolean
}

export type SourceFavoritesSyncResult = {
  sourceId: string
  upserted: number
  pruned: number
}
