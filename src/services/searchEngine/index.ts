import {
  SearchEngine,
  createSearchEngineForTests,
  getSearchEngine,
  registerSearchEnginePortsFactory,
  resetSearchEngineForTests,
} from './SearchEngine.ts'
import { createDefaultSearchEnginePorts } from './searchEnginePorts.ts'

registerSearchEnginePortsFactory(createDefaultSearchEnginePorts)

export {
  SearchEngine,
  createSearchEngineForTests,
  getSearchEngine,
  resetSearchEngineForTests,
}
export type { SearchEnginePorts, SearchSourceConfig } from './SearchEngine.ts'
export {
  beginDevSearchSession,
  clearDevSearchLog,
  getDevSearchLog,
  pushDevSearchLog,
  subscribeDevSearchLog,
} from './devSearchLog.ts'
export type { DevSearchLogEntry, DevSearchLogStage } from './devSearchLog.ts'
export {
  mergeAndDedupeSearchResults,
  trackDedupeKey,
  type RankedTrack,
} from './mergeResults.ts'
