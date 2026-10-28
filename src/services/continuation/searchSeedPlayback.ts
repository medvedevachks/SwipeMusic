import { PlaybackQueue } from '../playbackQueue/PlaybackQueue.ts'
import {
  isSearchSeedContext,
  type SearchSeedPlaybackContext,
} from '../../types/playbackContext.ts'
import type { Track } from '../../types/track.ts'
import { ContinuationSession } from './ContinuationSession.ts'
import { isContinuationCandidateAvailable } from './types.ts'

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
 */
export function commitSearchSeedQueue(
  queue: PlaybackQueue,
  session: ContinuationSession,
  input: { track: Track; query: string },
): SearchSeedPlaybackContext {
  const context: SearchSeedPlaybackContext = {
    type: 'search-seed',
    query: input.query,
    seedTrackId: input.track.id,
  }
  queue.setQueue([input.track], 0, context)
  session.prepare(input.track, context, { force: true })
  return context
}

/**
 * Next/ended для search-seed.
 * Чужой контекст не двигает: альбом, плейлист и волна остаются на своём next().
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

  const fromEnded = options.fromEnded
  const repeatMode = queue.getSnapshot().repeatMode
  if (fromEnded && repeatMode === 'ONE') {
    return queue.next({ fromEnded: true })
  }

  if (queue.peekNext()) {
    return queue.next(fromEnded ? { fromEnded: true } : undefined)
  }

  const prepared = session.peekPrepared()
  if (prepared) {
    const currentId = queue.current()?.id ?? context.seedTrackId
    if (isContinuationCandidateAvailable(prepared, currentId, queue.getItems())) {
      session.takePrepared()
      queue.insertNext(prepared)
      return queue.next(fromEnded ? { fromEnded: true } : undefined)
    }
    session.takePrepared()
  }

  if (repeatMode === 'ALL') {
    return queue.next(fromEnded ? { fromEnded: true } : undefined)
  }

  return null
}
