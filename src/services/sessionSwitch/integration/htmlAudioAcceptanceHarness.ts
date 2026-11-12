/**
 * PLAYBACK-TEST-01: приёмка CATALOG на реальном HTMLAudioElement.
 * Только DEV + VITE_SESSION_SWITCH_GATE=true.
 * Использует локальные WAV /dev-acceptance/* (не ControllableAdapter).
 *
 * Resolve — тот же PlaybackResolver, что production session path
 * (previewUrl в SessionTrack намеренно отсутствует).
 */
import { AudioPlayer } from '../../audioPlayer/AudioPlayer.ts'
import { LocalPlayerAdapter } from '../../audioPlayer/LocalPlayerAdapter.ts'
import { getPlaybackQueue } from '../../playbackQueue/PlaybackQueue.ts'
import {
  createPlaybackSessionStore,
} from '../../playbackSession/PlaybackSessionStore.ts'
import { createPlaybackSessionPersistence } from '../../playbackSession/persistence.ts'
import {
  SESSION_SWITCH_INTEGRATION_STORAGE_KEY,
  setSessionSwitchIntegrationEnabledForTests,
} from '../featureFlag.ts'
import { createSessionSwitchRuntime } from './createSessionSwitchRuntime.ts'
import { releaseCatalogSessionForLegacyIntent } from './legacyQueueClaim.ts'
import {
  playCatalogViaSessionSwitch,
} from './playCatalogSession.ts'
import { createResolverResolveFn } from './productionResolve.ts'
import {
  setSessionSwitchAppRuntime,
} from './sessionSwitchAppRuntime.ts'

export type HtmlAudioProbe = {
  tagName: string | null
  paused: boolean | null
  currentSrc: string
  currentTime: number
  readyState: number | null
  error: string | null
  ended: boolean | null
}

export type AcceptanceScenarioResult = {
  id: string
  ok: boolean
  detail?: string
  probe?: HtmlAudioProbe
}

function resolveWav(file: string): string {
  return new URL(`/dev-acceptance/${file}`, window.location.origin).href
}

function probeHtmlAudio(adapter: LocalPlayerAdapter): HtmlAudioProbe {
  // TypeScript private — в runtime поле доступно на инстансе.
  const audio = (adapter as unknown as { audio?: HTMLAudioElement }).audio
  if (!audio || typeof audio.play !== 'function') {
    return {
      tagName: null,
      paused: null,
      currentSrc: '',
      currentTime: 0,
      readyState: null,
      error: 'no HTMLAudioElement on LocalPlayerAdapter',
      ended: null,
    }
  }
  return {
    tagName: audio.tagName,
    paused: audio.paused,
    currentSrc: audio.currentSrc || audio.src || '',
    currentTime: audio.currentTime,
    readyState: audio.readyState,
    error: audio.error ? `code=${audio.error.code}` : null,
    ended: audio.ended,
  }
}

function track(id: string, file: string, externalId: string) {
  return {
    id: `dev-acceptance:${externalId}`,
    sourceId: 'dev-acceptance',
    externalId,
    title: id,
    artist: 'Acceptance',
    previewUrl: resolveWav(file),
  }
}

async function waitMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function runOne(
  id: string,
  fn: () => void | Promise<void>,
  probe?: () => HtmlAudioProbe,
): Promise<AcceptanceScenarioResult> {
  try {
    await fn()
    return { id, ok: true, probe: probe?.() }
  } catch (error) {
    return {
      id,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      probe: probe?.(),
    }
  }
}

/**
 * Полный прогон HTMLAudio CATALOG path.
 * audibleHeard всегда false здесь — агент не может подтвердить ухо.
 */
export async function runHtmlAudioCatalogAcceptance(): Promise<{
  results: AcceptanceScenarioResult[]
  passed: number
  failed: number
  audibleHeard: false
  note: string
  flagOffBlocked: boolean
  durableNextViaRelease: boolean
}> {
  localStorage.setItem(SESSION_SWITCH_INTEGRATION_STORAGE_KEY, '1')
  setSessionSwitchIntegrationEnabledForTests(true)

  const adapter = new LocalPlayerAdapter()
  const player = new AudioPlayer(adapter)
  const queue = getPlaybackQueue()
  queue.detachLegacyPersistence()
  queue.clear()

  const store = createPlaybackSessionStore({
    userId: 'acceptance-user',
    deviceId: 'device-acceptance-1',
  })
  const persistence = createPlaybackSessionPersistence({
    storage: localStorage,
  })
  const runtime = createSessionSwitchRuntime({
    store,
    liveQueue: queue,
    audioPlayer: player,
    forceEnable: true,
    // Production-path resolve: SessionTrack без previewUrl.
    resolve: createResolverResolveFn(),
  })
  if (!runtime) {
    throw new Error('runtime null')
  }
  setSessionSwitchAppRuntime({
    ...runtime,
    store,
    persistence,
    userId: 'acceptance-user',
    deviceId: 'device-acceptance-1',
    bootstrapGeneration: 1,
  })

  const results: AcceptanceScenarioResult[] = []
  const push = async (
    id: string,
    fn: () => void | Promise<void>,
  ) => {
    results.push(await runOne(id, fn, () => probeHtmlAudio(adapter)))
  }

  // externalId из DEV-acceptance каталога (PlaybackResolver → WAV).
  const a = track('seed', 'seed.wav', 'seed')
  const b = track('atl', 'atl.wav', 'atl')
  const c = track('kino', 'kino1.wav', 'kino-blood')

  let flagOffBlocked = false
  let durableNextViaRelease = false

  await push('catalog-play-html-audio', async () => {
    const result = await playCatalogViaSessionSwitch({
      tracks: [a, b, c],
      startIndex: 0,
      catalogId: 'acc-cat-a',
      catalogTitle: 'Acceptance A',
    })
    if (!result.ok) {
      throw new Error(result.reason)
    }
    await waitMs(400)
    const probe = probeHtmlAudio(adapter)
    if (probe.tagName !== 'AUDIO') {
      throw new Error(`expected AUDIO, got ${probe.tagName}`)
    }
    if (!probe.currentSrc.includes('seed.wav')) {
      throw new Error(`unexpected src ${probe.currentSrc}`)
    }
    if (probe.paused) {
      throw new Error('audio paused after play (gesture/autoplay?)')
    }
    if (probe.error) {
      throw new Error(probe.error)
    }
  })

  await push('pause-resume-html-audio', async () => {
    player.pause()
    await waitMs(100)
    if (!probeHtmlAudio(adapter).paused) {
      throw new Error('expected paused')
    }
    await player.resume()
    await waitMs(300)
    if (probeHtmlAudio(adapter).paused) {
      throw new Error('expected playing after resume')
    }
  })

  await push('next-previous-html-audio', async () => {
    await player.next()
    await waitMs(400)
    if (player.getState().currentTrack?.id !== b.id) {
      throw new Error(`expected ${b.id}, got ${player.getState().currentTrack?.id}`)
    }
    if (!probeHtmlAudio(adapter).currentSrc.includes('atl.wav')) {
      throw new Error('next src not atl.wav')
    }
    // Live session обновлена; durable слот пока может отставать — это граница release/switch.
    if (queue.getSnapshot().currentIndex !== 1) {
      throw new Error('live queue index not advanced')
    }
    await player.previous()
    await waitMs(400)
    if (player.getState().currentTrack?.id !== a.id) {
      throw new Error('previous did not restore a')
    }
    if (!probeHtmlAudio(adapter).currentSrc.includes('seed.wav')) {
      throw new Error('previous src not seed.wav')
    }
  })

  await push('shuffle-repeat-live-and-release', async () => {
    queue.setShuffleMode('ON')
    queue.setRepeatMode('ALL')
    if (queue.getShuffleMode() !== 'ON' || queue.getRepeatMode() !== 'ALL') {
      throw new Error('shuffle/repeat not applied on live queue')
    }
    await player.next()
    await waitMs(350)
    const released = releaseCatalogSessionForLegacyIntent('search')
    if (!released.released || !released.savedCatalog) {
      throw new Error('release did not save catalog')
    }
    const durable = store.getSlot('catalog').queue
    if (durable.shuffleMode !== 'ON') {
      throw new Error('shuffle not in durable catalog slot after release')
    }
    if (durable.repeatMode !== 'ALL') {
      throw new Error('repeat not in durable catalog slot after release')
    }
    if (durable.history.length < 2) {
      throw new Error('next history not saved to durable on release')
    }
    durableNextViaRelease = true
  })

  await push('catalog-a-to-b', async () => {
    // Снова активируем A, затем B — физический src должен смениться.
    const back = await playCatalogViaSessionSwitch({
      tracks: [a, b, c],
      startIndex: 0,
      catalogId: 'acc-cat-a',
      catalogTitle: 'Acceptance A',
    })
    if (!back.ok) {
      throw new Error(`reopen A: ${back.reason}`)
    }
    await waitMs(300)
    const result = await playCatalogViaSessionSwitch({
      tracks: [c, b],
      startIndex: 0,
      catalogId: 'acc-cat-b',
      catalogTitle: 'Acceptance B',
    })
    if (!result.ok) {
      throw new Error(result.reason)
    }
    await waitMs(400)
    const meta = store.getSlot('catalog').meta
    if (meta.kind !== 'catalog' || meta.catalogId !== 'acc-cat-b') {
      throw new Error('catalog B meta missing')
    }
    if (player.getState().currentTrack?.id !== c.id) {
      throw new Error('catalog B track not sounding')
    }
    const probe = probeHtmlAudio(adapter)
    if (!probe.currentSrc.includes('kino1.wav')) {
      throw new Error(
        `A→B physical src not kino1.wav: ${probe.currentSrc}`,
      )
    }
    if (probe.paused) {
      throw new Error('A→B audio paused')
    }
  })

  await push('catalog-to-legacy-search-release', async () => {
    await playCatalogViaSessionSwitch({
      tracks: [a, b, c],
      startIndex: 0,
      catalogId: 'acc-cat-a',
      catalogTitle: 'Acceptance A',
    })
    await waitMs(200)
    await player.next()
    await waitMs(300)
    const released = releaseCatalogSessionForLegacyIntent('search')
    if (!released.released) {
      throw new Error('release failed')
    }
    if (store.getActiveSessionId() !== null) {
      throw new Error('active should be null after legacy release')
    }
    if (store.getSlot('catalog').queue.history.length < 1) {
      throw new Error('catalog history not saved')
    }
  })

  await push('legacy-back-to-catalog-keeps-history', async () => {
    const historyBefore = [...store.getSlot('catalog').queue.history]
    const result = await playCatalogViaSessionSwitch({
      tracks: [a, b, c],
      startIndex: 0,
      catalogId: 'acc-cat-a',
      catalogTitle: 'Acceptance A',
    })
    if (!result.ok) {
      throw new Error(result.reason)
    }
    if (
      JSON.stringify(store.getSlot('catalog').queue.history) !==
      JSON.stringify(historyBefore)
    ) {
      throw new Error('history lost on return to catalog')
    }
  })

  await push('logout-stops-physical', async () => {
    player.clearPlaybackIdentity()
    await waitMs(100)
    const probe = probeHtmlAudio(adapter)
    if (player.getState().currentTrack !== null) {
      throw new Error('currentTrack not cleared')
    }
    if (player.getState().playing) {
      throw new Error('playing after clearPlaybackIdentity')
    }
    if (!probe.paused) {
      throw new Error('HTMLAudioElement still playing after logout clear')
    }
  })

  await push('no-autoplay-on-restore-slot', async () => {
    store.setActiveSessionId(null)
    await waitMs(200)
    if (player.getState().playing) {
      throw new Error('autoplay after restore-like idle')
    }
    if (!probeHtmlAudio(adapter).paused) {
      throw new Error('audio not paused after restore-like idle')
    }
  })

  await push('feature-flag-off-blocks-session-path', async () => {
    setSessionSwitchIntegrationEnabledForTests(false)
    localStorage.removeItem(SESSION_SWITCH_INTEGRATION_STORAGE_KEY)
    const blocked = await playCatalogViaSessionSwitch({
      tracks: [a],
      startIndex: 0,
      catalogId: 'flag-off',
      catalogTitle: 'Off',
    })
    if (blocked.ok || blocked.reason !== 'flag_off') {
      throw new Error(`expected flag_off, got ${JSON.stringify(blocked)}`)
    }
    flagOffBlocked = true
    // Вернуть ON для идемпотентности повторных прогонов.
    localStorage.setItem(SESSION_SWITCH_INTEGRATION_STORAGE_KEY, '1')
    setSessionSwitchIntegrationEnabledForTests(true)
  })

  const failed = results.filter((r) => !r.ok).length
  return {
    results,
    passed: results.length - failed,
    failed,
    audibleHeard: false,
    flagOffBlocked,
    durableNextViaRelease,
    note:
      'Media element state verified (src/paused/readyState). Human-audible confirmation is NOT TESTED by automation. Durable next/shuffle persist at legacy release / session switch boundary (not continuous while active).',
  }
}

export function installHtmlAudioAcceptanceHarness(): void {
  if (typeof window === 'undefined') {
    return
  }
  ;(
    window as unknown as {
      __SWIPE_HTML_AUDIO_ACCEPTANCE__?: {
        run: typeof runHtmlAudioCatalogAcceptance
        enableFlag: () => void
        disableFlag: () => void
      }
    }
  ).__SWIPE_HTML_AUDIO_ACCEPTANCE__ = {
    run: runHtmlAudioCatalogAcceptance,
    enableFlag: () => {
      localStorage.setItem(SESSION_SWITCH_INTEGRATION_STORAGE_KEY, '1')
      setSessionSwitchIntegrationEnabledForTests(true)
    },
    disableFlag: () => {
      localStorage.removeItem(SESSION_SWITCH_INTEGRATION_STORAGE_KEY)
      setSessionSwitchIntegrationEnabledForTests(false)
    },
  }
  console.info(
    '[html-audio-acceptance] ready: window.__SWIPE_HTML_AUDIO_ACCEPTANCE__.run()',
  )
}
