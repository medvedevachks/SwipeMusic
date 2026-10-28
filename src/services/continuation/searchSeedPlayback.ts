import { isDemoSourceId } from '../../sources/demoSource.ts'
import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  isSearchSeedContext,
  type SearchSeedPlaybackContext,
} from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'
import { consumeRecommendationAdvance } from '../recommendation/advance.ts'
import { invalidateRecommendationAdvance } from '../recommendation/advanceEpoch.ts'
import type { RecommendationExcludedTrack } from '../recommendation/types.ts'
import { ContinuationSession } from './ContinuationSession.ts'
import { noteSearchPlaybackEvent } from './searchPlaybackDebug.ts'

export type SearchHitExclusion = {
  id: string
  title: string
  artist: string
  sourceId?: string
  externalId?: string
}

/** Идентичности всей поисковой выдачи → hard exclusions Recommendation Engine. */
export function buildSearchHitExclusions(
  hits: readonly Track[],
): SearchHitExclusion[] {
  const out: SearchHitExclusion[] = []
  const seen = new Set<string>()
  for (const track of hits) {
    if (!track.id) {
      continue
    }
    const key = [
      track.id,
      track.sourceId,
      track.externalId ?? '',
      track.artist.trim().toLowerCase(),
      track.title.trim().toLowerCase(),
    ].join('\0')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push({
      id: track.id,
      title: track.title,
      artist: track.artist,
      sourceId: track.sourceId,
      externalId: track.externalId,
    })
  }
  return out
}

export function searchHitExclusionsAsRecommendationExcluded(
  hits: readonly SearchHitExclusion[],
): RecommendationExcludedTrack[] {
  return hits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    artist: hit.artist,
    sourceId: hit.sourceId,
    externalId: hit.externalId,
  }))
}

let searchSeedPlaybackEnabled = false

/**
 * Признак окружения подставляет Vite на этапе сборки.
 * В Node-тестах `import.meta.env` нет: это не DEV-сборка.
 */
function readViteDevDefault(): boolean {
  try {
    return import.meta.env.DEV === true && import.meta.env.PROD !== true
  } catch {
    return false
  }
}

function isProductionBuild(): boolean {
  try {
    return import.meta.env.PROD === true
  } catch {
    return false
  }
}

function readReleaseFlag(): string | undefined {
  try {
    const value = import.meta.env.VITE_SEARCH_SEED_PLAYBACK
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * DEV включён сам. Production включается только строкой `true` во флаге сборки.
 * Хранилище браузера и модульный override production не включают.
 */
export function resolveSearchSeedPlaybackEnabled(input: {
  production: boolean
  dev: boolean
  releaseFlag: string | undefined
  runtimeOverride: boolean
}): boolean {
  if (input.releaseFlag === 'true') {
    return true
  }
  if (input.production) {
    return false
  }
  return input.runtimeOverride || input.dev
}

export function isSearchSeedPlaybackEnabled(): boolean {
  return resolveSearchSeedPlaybackEnabled({
    production: isProductionBuild(),
    dev: readViteDevDefault(),
    releaseFlag: readReleaseFlag(),
    runtimeOverride: searchSeedPlaybackEnabled,
  })
}

export function setSearchSeedPlaybackEnabled(enabled: boolean): void {
  searchSeedPlaybackEnabled = enabled
}

export type SearchPlaybackPlan =
  | { mode: 'result-list'; tracks: readonly Track[] }
  | { mode: 'single-track'; track: Track; query: string }

/**
 * Кандидаты для seed/legacy playback из выдачи Search.
 * В обычном режиме demo не стартуют playback (колода уже без них).
 * Harness (`allowDemo`) оставляет mock-hits для DEV-приёмки.
 */
export function selectSearchPlaybackTracks(input: {
  tracks: readonly Track[]
  allowDemo: boolean
}): Track[] {
  if (input.allowDemo) {
    return [...input.tracks]
  }
  return input.tracks.filter((track) => !isDemoSourceId(track.sourceId))
}

/**
 * Выключенный флаг оставляет выдачу очередью, как сейчас.
 * Включённый флаг играет только выбранный трек. Список выдачи сюда не копируется.
 */
export function planSearchPlayback(input: {
  enabled: boolean
  tracks: readonly Track[]
  selectedTrackId?: string
  query: string
}): SearchPlaybackPlan {
  if (!input.enabled) {
    return { mode: 'result-list', tracks: input.tracks }
  }
  const selected =
    input.tracks.find((track) => track.id === input.selectedTrackId) ?? input.tracks[0]
  if (!selected) {
    return { mode: 'result-list', tracks: [] }
  }
  return { mode: 'single-track', track: selected, query: input.query }
}

/** Колода поиска при включённом флаге не становится очередью. Каталог и волна — нет. */
export function searchDeckUsesSeedPlayback(input: {
  enabled: boolean
  stage: 'sorting' | 'wave'
  sessionMode: 'catalog' | 'search'
}): boolean {
  return input.enabled && input.stage === 'sorting' && input.sessionMode === 'search'
}

/** Колода свайпов не прыгает за продолжением, которого в выдаче может не быть. */
export function sortingDeckFollowsPlayer(input: {
  radioActive: boolean
  contextType: string
}): boolean {
  return !input.radioActive && input.contextType !== 'search-seed'
}

/**
 * Подпись над колонкой поиска, когда GlobalPlayer уже играет не эту карточку.
 * Сама карточка остаётся результатом выдачи и не показывает прогресс чужого трека.
 */
export function continuationPlaybackCaption(input: {
  contextType: string
  cardTrackId: string | null
  playerTrack: { id: string; title: string; artist: string } | null
}): string | null {
  if (input.contextType !== 'search-seed' || !input.playerTrack) {
    return null
  }
  if (input.cardTrackId && input.cardTrackId === input.playerTrack.id) {
    return null
  }
  const title = input.playerTrack.title.trim()
  if (!title) {
    return null
  }
  const artist = input.playerTrack.artist.trim()
  return artist ? `Сейчас играет: ${title} — ${artist}` : `Сейчас играет: ${title}`
}

/**
 * Очередь = выбранный трек. Сессия поиска и выдача не изменяются.
 * Предыдущее продолжение отменяется.
 * searchHits фиксируются как hard exclusions для всей recommendation-сессии.
 */
export function commitSearchSeedQueue(
  queue: PlaybackQueue,
  session: ContinuationSession,
  input: { track: Track; query: string; searchHits?: readonly Track[] },
): SearchSeedPlaybackContext {
  const hits =
    input.searchHits && input.searchHits.length > 0 ? input.searchHits : [input.track]
  const hardExcludeHits = buildSearchHitExclusions(hits)
  const context: SearchSeedPlaybackContext = {
    type: 'search-seed',
    query: input.query,
    seedTrackId: input.track.id,
    hardExcludeHits,
  }
  queue.setQueue([input.track], 0, context)
  // Новый seed: не дать догнать устаревший Next предыдущей сессии.
  invalidateRecommendationAdvance()
  session.prepare(input.track, context, { force: true })
  noteSearchPlaybackEvent('commit-search-seed', {
    contextType: context.type,
    queueLength: 1,
    trackId: input.track.id,
    source: 'playSearchTrack',
    seedEnabled: true,
    reason: `hardExcludeHits=${hardExcludeHits.length}`,
  })
  return context
}

/**
 * Next/ended для search-seed — общий путь персонального продолжения.
 * Чужой контекст не двигает: альбом, плейлист и волна остаются на своём next().
 * Хвост из поисковой выдачи отбрасывается: результаты поиска не плейлист.
 * Без кандидата индекс не сдвигается и выдача не подставляется.
 */
export function consumeSearchSeedAdvance(
  queue: PlaybackQueue,
  session: ContinuationSession,
  options: { fromEnded: boolean },
): Track | null {
  const context = queue.getPlaybackContext()
  if (!isSearchSeedContext(context)) {
    return null
  }
  // Единый advance (search-seed ⊂ recommendation contexts).
  return consumeRecommendationAdvance(queue, session, options)
}
