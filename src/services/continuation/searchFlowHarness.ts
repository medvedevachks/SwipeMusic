/**
 * Контролируемый SEARCH-FLOW браузерный harness (только VITE_SEARCH_FLOW_HARNESS=true).
 * Не пишет в пользовательскую библиотеку и не трогает Yandex flow.
 */
import { createTrack } from '../../sources/normalizeTrack.ts'
import { getSearchEngine } from '../searchEngine'
import { getAudioPlayer } from '../audioPlayer'
import { getPlaybackQueue } from '../playbackQueue'
import { DEMO_PREVIEW_URLS } from '../mockTracks.ts'
import { getContinuationSession } from './ContinuationSession.ts'
import { isSearchFlowHarnessEnabled } from './searchFlowHarnessFlag.ts'
import type { ContinuationProvider } from './types.ts'
import type { Track } from '../../types/track.ts'

export { isSearchFlowHarnessEnabled } from './searchFlowHarnessFlag.ts'

const QUERY = 'Сплин'

export type SearchFlowHarnessSnapshot = {
  contextType: string
  queueLength: number
  currentTrackId: string | null
  currentTitle: string | null
  currentArtist: string | null
  playing: boolean
  inSearchResults: boolean
  searchResultIds: string[]
  continuationIds: string[]
  playerCurrentId: string | null
}

function preview(index: number): string {
  return DEMO_PREVIEW_URLS[index % DEMO_PREVIEW_URLS.length]!
}

/** 20 hits; [0] = ATL. rec* сюда не входят. */
export function buildHarnessSearchHits(): Track[] {
  return Array.from({ length: 20 }, (_, index) =>
    createTrack({
      sourceId: 'mock',
      externalId: `splin-hit-${index}`,
      title: index === 0 ? 'ATL' : `Hit ${index}`,
      artist: index === 0 ? 'Сплин' : `Artist ${index}`,
      coverColor: '#334155',
      previewUrl: preview(index),
      durationMs: 120_000 + index * 500,
    }),
  )
}

export function buildHarnessContinuations(): Track[] {
  return [
    createTrack({
      sourceId: 'mock',
      externalId: 'splin-rec-1',
      title: 'Мой друг',
      artist: 'Сплин',
      coverColor: '#0f766e',
      previewUrl: preview(1),
      durationMs: 181_000,
    }),
    createTrack({
      sourceId: 'mock',
      externalId: 'splin-rec-2',
      title: 'Выхода нет',
      artist: 'Сплин',
      coverColor: '#b45309',
      previewUrl: preview(2),
      durationMs: 182_000,
    }),
    createTrack({
      sourceId: 'mock',
      externalId: 'splin-rec-3',
      title: 'Романс',
      artist: 'Сплин',
      coverColor: '#1e3a5f',
      previewUrl: preview(3),
      durationMs: 183_000,
    }),
  ]
}

function createHarnessContinuationProvider(library: readonly Track[]): ContinuationProvider {
  return {
    async prepareContinuation(current) {
      const order = library.map((track) => track.id)
      const at = order.indexOf(current.id)
      const next = at >= 0 ? library[at + 1] : library[0]
      if (!next || next.id === current.id) {
        return null
      }
      // После seed (не из library) отдаём первую рекомендацию.
      if (!order.includes(current.id)) {
        return { track: library[0]! }
      }
      return { track: next }
    },
  }
}

let harnessHits: Track[] = []
let harnessRecs: Track[] = []
let installed = false

/**
 * Ставит continuation provider + выдачу «Сплин» в Search UI.
 * Вызывать до клика по ATL.
 */
export function installSearchFlowHarness(): {
  hits: Track[]
  continuations: Track[]
  query: string
} {
  harnessHits = buildHarnessSearchHits()
  harnessRecs = buildHarnessContinuations()
  getContinuationSession().setProvider(createHarnessContinuationProvider(harnessRecs))
  getSearchEngine().replaceResultsForHarness(QUERY, harnessHits)
  installed = true
  return { hits: harnessHits, continuations: harnessRecs, query: QUERY }
}

export function getSearchFlowHarnessSnapshot(): SearchFlowHarnessSnapshot {
  const queue = getPlaybackQueue().getSnapshot()
  const current = getPlaybackQueue().current()
  const player = getAudioPlayer().getState()
  const hitIds = new Set(harnessHits.map((track) => track.id))
  return {
    contextType: queue.context.type,
    queueLength: queue.items.length,
    currentTrackId: current?.id ?? null,
    currentTitle: current?.title ?? null,
    currentArtist: current?.artist ?? null,
    playing: player.playing,
    inSearchResults: current ? hitIds.has(current.id) : false,
    searchResultIds: harnessHits.map((track) => track.id),
    continuationIds: harnessRecs.map((track) => track.id),
    playerCurrentId: player.currentTrack?.id ?? null,
  }
}

/** Вставить ровно один чужой search-hit после current (для проверки trim provenance). */
export function injectSingleForeignSearchHit(): string | null {
  const queue = getPlaybackQueue()
  const current = queue.current()
  if (!current || queue.getPlaybackContext().type !== 'search-seed') {
    return null
  }
  const foreign =
    harnessHits.find((track) => track.id !== current.id) ??
    createTrack({
      sourceId: 'mock',
      externalId: 'foreign-hit',
      title: 'Чужой hit',
      artist: 'X',
      previewUrl: preview(4),
    })
  // setQueue сбрасывает sessionTail — имитируем «остался hit» без insertNext.
  const items = queue.getItems()
  const index = items.findIndex((track) => track.id === current.id)
  const nextItems = [
    ...items.slice(0, index + 1),
    foreign,
    ...items.slice(index + 1).filter((track) => track.id !== foreign.id),
  ]
  const context = queue.getPlaybackContext()
  queue.setQueue(nextItems, index < 0 ? 0 : index, context)
  return foreign.id
}

type HarnessWindow = Window & {
  __swipeSearchFlowHarness?: {
    install: () => ReturnType<typeof installSearchFlowHarness>
    snapshot: () => SearchFlowHarnessSnapshot
    injectForeignHit: () => string | null
    ready: boolean
  }
}

export function installSearchFlowHarnessBridge(): void {
  if (typeof window === 'undefined' || !isSearchFlowHarnessEnabled()) {
    return
  }
  const target = window as HarnessWindow
  target.__swipeSearchFlowHarness = {
    ready: true,
    install: () => installSearchFlowHarness(),
    snapshot: () => getSearchFlowHarnessSnapshot(),
    injectForeignHit: () => injectSingleForeignSearchHit(),
  }
  void installed
}
