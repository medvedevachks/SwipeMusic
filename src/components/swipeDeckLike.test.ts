import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test, { after, before, describe } from 'node:test'
import reactPlugin from '@vitejs/plugin-react'
import { Window } from 'happy-dom'
import { createServer, type ViteDevServer } from 'vite'
import type { Track } from '../types/track.ts'

const NOW = '2024-06-01T00:00:00.000Z'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

type Direction = 'left' | 'right' | 'up' | 'down'
type DeckModule = { default: (props: Record<string, unknown>) => unknown }
type PlayerModule = {
  usePlayerStore: {
    getState: () => {
      currentTrack: Track | null
      pendingTrack: Track | null
      currentTime: number
      queueIndex: number
      playing: boolean
      paused: boolean
    }
    setState: (partial: Record<string, unknown>) => void
    (selector: (state: PlayerSnapshot) => unknown): unknown
  }
}
type PlayerSnapshot = {
  currentTrack: Track | null
  pendingTrack: Track | null
  currentTime: number
  queueIndex: number
  playing: boolean
  paused: boolean
}
type AudioModule = {
  getAudioPlayer: () => {
    setQueue: (tracks: Track[], startIndex?: number, context?: { type: 'swipe' }) => void
    playTrack: (track: Track) => Promise<void>
    next: () => Promise<void>
    previous: () => Promise<void>
  }
}
type QueueModule = {
  getPlaybackQueue: () => {
    getSnapshot: () => { items: Track[]; currentIndex: number }
  }
}
type IntentModule = {
  getPlaybackIntent: () => {
    playFromSwipe: (input: {
      tracks: Track[]
      startIndex: number
      explicitUserPlay: boolean
    }) => Promise<void>
  }
}
type ReactModule = {
  createElement: (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => unknown
  act: (callback: () => Promise<void> | void) => Promise<void>
  useState: <T>(initial: T) => [T, (next: T) => void]
}
type ReactDomModule = {
  createRoot: (container: unknown) => {
    render: (node: unknown) => void
    unmount: () => void
  }
}
type OrganizationModule = {
  clearCanonicalIdentityFlights: () => void
  setCanonicalRemote: (remote: unknown) => void
}
type CanonicalStoreModule = {
  useCanonicalLibraryStore: {
    getState: () => {
      clear: () => void
      replaceForUser: (
        userId: string,
        items: Array<{
          canonicalTrack: { id: string; title: string }
          state: { liked: boolean }
          copies: Array<{ sourceTrackKey: string }>
        }>,
      ) => void
      itemsById: Record<
        string,
        {
          canonicalTrack: { id: string; title: string }
          state: { liked: boolean }
          copies: Array<{ sourceTrackKey: string; title: string; artist: string; sourceId: string; externalId: string }>
          catalogIds: string[]
        }
      >
    }
  }
}
type CollectionStoreModule = {
  useCollectionStore: {
    getState: () => {
      clearUserLibrary: () => void
      history: Array<{ action: string; track: { id: string } }>
    }
  }
}
type PersistenceModule = {
  useLibraryPersistenceStore: {
    setState: (partial: { armed: boolean; status: string; message: null }) => void
  }
}

const played: string[] = []
const navigated: string[] = []
const categorized: string[] = []
let deckKey = 0
let likePatches = 0
let likeShouldFail = false
let likeDelayMs = 0

let dom: Window
let server: ViteDevServer
let react: ReactModule
let reactDom: ReactDomModule
let SwipeDeck: DeckModule['default']
let usePlayerStore: PlayerModule['usePlayerStore']
let audio: ReturnType<AudioModule['getAudioPlayer']>
let getPlaybackQueue: QueueModule['getPlaybackQueue']
let organization: OrganizationModule
let canonicalStore: CanonicalStoreModule['useCanonicalLibraryStore']
let collectionStore: CollectionStoreModule['useCollectionStore']
let persistence: PersistenceModule['useLibraryPersistenceStore']
let root: ReturnType<ReactDomModule['createRoot']> | null = null

function installGlobal(name: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  if (descriptor && descriptor.configurable === false) {
    return
  }
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  })
}

function installDom(window: Window): void {
  const source = window as unknown as Record<string, unknown>
  installGlobal('window', window)
  installGlobal('document', window.document)
  installGlobal('navigator', window.navigator)
  for (const name of [
    'HTMLElement',
    'Element',
    'Node',
    'DocumentFragment',
    'SVGElement',
    'Event',
    'CustomEvent',
    'PointerEvent',
    'MouseEvent',
    'KeyboardEvent',
    'MutationObserver',
    'Document',
    'Audio',
    'Image',
  ]) {
    if (source[name] != null) {
      installGlobal(name, source[name])
    }
  }
  installGlobal('localStorage', window.localStorage)
  installGlobal('sessionStorage', window.sessionStorage)
  installGlobal('getComputedStyle', window.getComputedStyle.bind(window))
  installGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window))
  installGlobal('cancelAnimationFrame', window.cancelAnimationFrame.bind(window))
  const element = window.Element.prototype as unknown as {
    setPointerCapture?: (pointerId: number) => void
    releasePointerCapture?: (pointerId: number) => void
    hasPointerCapture?: (pointerId: number) => boolean
  }
  element.setPointerCapture ??= () => undefined
  element.releasePointerCapture ??= () => undefined
  element.hasPointerCapture ??= () => false
  installGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  if (!('ontouchstart' in window)) {
    Object.defineProperty(window, 'ontouchstart', { value: null, configurable: true })
  }
}

function track(externalId: string, title: string): Track {
  return {
    id: `yandex-music:${externalId}`,
    sourceId: 'yandex-music',
    externalId,
    title,
    artist: 'Север',
    album: 'Альбом',
    durationMs: 180_000,
    coverUrl: 'https://example.test/cover.jpg',
  }
}

const tracks = [track('101', 'Город'), track('102', 'Река'), track('103', 'Море')]

function identityFor(item: Track) {
  return {
    canonicalTrack: {
      id: 'can_x',
      title: item.title,
      artist: item.artist,
      album: item.album ?? null,
      durationMs: item.durationMs ?? null,
      artworkUrl: item.coverUrl ?? null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    copies: [
      {
        sourceTrackKey: item.id,
        canonicalTrackId: 'can_x',
        sourceId: item.sourceId,
        externalId: item.externalId,
        title: item.title,
        artist: item.artist,
        album: item.album ?? null,
        durationMs: item.durationMs ?? null,
        artworkUrl: item.coverUrl ?? null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  }
}

function installRemote(): void {
  organization.setCanonicalRemote({
    async ensureIdentity(snapshot: { sourceId: string; externalId: string; title: string }) {
      const known = tracks.find(
        (item) => item.sourceId === snapshot.sourceId && item.externalId === snapshot.externalId,
      )
      return identityFor(known ?? tracks[0]!)
    },
    async patchCanonicalLiked(id: string, liked: boolean) {
      likePatches += 1
      if (likeDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, likeDelayMs))
      }
      if (likeShouldFail) {
        throw new Error('like failed')
      }
      const current = canonicalStore.getState().itemsById[id]
      if (!current) {
        throw new Error(`missing canonical ${id}`)
      }
      return {
        item: {
          ...current,
          state: { ...current.state, liked, likedAt: liked ? NOW : null },
        },
      }
    },
    async assignCanonical() {
      return { membership: { catalogId: 'cat', canonicalTrackId: 'can_x', createdAt: NOW } }
    },
    async unassignCanonical() {
      return undefined
    },
  })
  persistence.setState({ armed: true, status: 'ready', message: null })
}

function resetLibrary(): void {
  if (!organization || !canonicalStore || !collectionStore || !persistence) {
    return
  }
  organization.clearCanonicalIdentityFlights()
  organization.setCanonicalRemote(null)
  canonicalStore.getState().clear()
  collectionStore.getState().clearUserLibrary()
  persistence.setState({ armed: false, status: 'idle', message: null })
  played.length = 0
  navigated.length = 0
  categorized.length = 0
  likePatches = 0
  likeShouldFail = false
  likeDelayMs = 0
}

function noticeText(): string {
  return dom.document.querySelector('[role="status"]')?.textContent?.trim() ?? ''
}

function cardMotion(): string {
  return dom.document.querySelector('[data-card-motion]')?.getAttribute('data-card-motion') ?? ''
}

async function seedPlayback(index: number, currentTime: number, playing: boolean): Promise<void> {
  const current = tracks[index]!
  await react.act(async () => {
    audio.setQueue(tracks, index, { type: 'swipe' })
    usePlayerStore.setState({
      currentTrack: current,
      pendingTrack: null,
      currentTime,
      duration: 180,
      playing,
      paused: !playing,
      queue: tracks,
      queueIndex: index,
      error: null,
      loading: false,
      buffering: false,
    })
  })
}

function playerState() {
  return usePlayerStore.getState()
}

function frontTitle(): string {
  const node = dom.document.querySelector('article.cursor-grab h2')
  return node?.textContent?.trim() ?? ''
}

function pointer(
  type: string,
  x: number,
  y: number,
  buttons: number,
  pointerType: 'mouse' | 'touch',
): Event {
  return new dom.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType,
    button: 0,
    buttons,
    isPrimary: true,
  })
}

async function swipe(
  direction: Direction,
  options?: { pointerType?: 'mouse' | 'touch'; distance?: number },
): Promise<void> {
  const card = dom.document.querySelector('article.cursor-grab')
  if (!card) {
    throw new Error(`нет карточки, экран: ${dom.document.body.textContent}`)
  }
  const distance = options?.distance ?? 180
  const pointerType = options?.pointerType ?? 'mouse'
  const delta: Record<Direction, [number, number]> = {
    left: [-distance, 0],
    right: [distance, 0],
    up: [0, -distance],
    down: [0, distance],
  }
  const [dx, dy] = delta[direction]
  await react.act(async () => {
    card.dispatchEvent(pointer('pointerdown', 220, 220, 1, pointerType))
    card.dispatchEvent(pointer('pointermove', 220 + dx, 220 + dy, 1, pointerType))
    card.dispatchEvent(pointer('pointerup', 220 + dx, 220 + dy, 0, pointerType))
    await new Promise((resolve) => setTimeout(resolve, 280))
  })
}

function heartPhase(): string {
  return dom.document.querySelector('[data-heart]')?.getAttribute('data-heart') ?? ''
}

function cardVisualShift(): number {
  const card = dom.document.querySelector('article.cursor-grab')
  if (!card) {
    return Number.NaN
  }
  const raw = (card as HTMLElement).style.transform || dom.getComputedStyle(card).transform || ''
  const matrix = /matrix\(([^)]+)\)/.exec(raw)
  if (matrix) {
    const parts = matrix[1].split(',').map((part) => Number(part.trim()))
    const tx = parts.length >= 6 ? parts[4] : Number.NaN
    const ty = parts.length >= 6 ? parts[5] : Number.NaN
    return Math.hypot(tx ?? 0, ty ?? 0)
  }
  const translate = /translate3d\(\s*([-\d.]+)px,\s*([-\d.]+)(?:px)?/.exec(raw)
  if (translate) {
    return Math.hypot(Number(translate[1]), Number(translate[2]))
  }
  return raw === '' || raw === 'none' ? 0 : Number.NaN
}

function heartSize(): string {
  return dom.document.querySelector('[data-heart]')?.getAttribute('data-heart-size') ?? ''
}

async function slowLeft(distance: number): Promise<void> {
  const card = dom.document.querySelector('article.cursor-grab')
  if (!card) {
    throw new Error(`нет карточки, экран: ${dom.document.body.textContent}`)
  }
  const steps = 4
  await react.act(async () => {
    card.dispatchEvent(pointer('pointerdown', 220, 220, 1, 'touch'))
    for (let step = 1; step <= steps; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 45))
      const x = 220 - (distance * step) / steps
      card.dispatchEvent(pointer('pointermove', x, 220, 1, 'touch'))
    }
    await new Promise((resolve) => setTimeout(resolve, 45))
    card.dispatchEvent(pointer('pointerup', 220 - distance, 220, 0, 'touch'))
    await new Promise((resolve) => setTimeout(resolve, 280))
  })
}

async function drag(
  dx: number,
  dy: number,
  pointerType: 'mouse' | 'touch',
): Promise<void> {
  const card = dom.document.querySelector('article.cursor-grab')
  if (!card) {
    throw new Error(`нет карточки, экран: ${dom.document.body.textContent}`)
  }
  await react.act(async () => {
    card.dispatchEvent(pointer('pointerdown', 220, 220, 1, pointerType))
    if (dx !== 0 || dy !== 0) {
      card.dispatchEvent(pointer('pointermove', 220 + dx, 220 + dy, 1, pointerType))
    }
    card.dispatchEvent(pointer('pointerup', 220 + dx, 220 + dy, 0, pointerType))
    await new Promise((resolve) => setTimeout(resolve, 280))
  })
}

function Harness(props: {
  tracks: Track[]
  deckKey: number
  categoryCancelKey?: number
  categoryResolveKey?: number
}) {
  const currentTrack = usePlayerStore((state) => state.currentTrack) as Track | null
  const pendingTrack = usePlayerStore((state) => state.pendingTrack) as Track | null
  return react.createElement(SwipeDeck, {
    key: props.deckKey,
    tracks: props.tracks,
    playerTrackId: (pendingTrack ?? currentTrack)?.id ?? null,
    categoryCancelKey: props.categoryCancelKey ?? 0,
    categoryResolveKey: props.categoryResolveKey ?? 0,
    onCategorize: (item: Track) => {
      categorized.push(item.id)
    },
    syncWithPlayer: true,
    advanceAtEnd: true,
    onDeckNavigate: (item: Track, direction: 'next' | 'previous') => {
      // Как Home: жест → AudioPlayer.next/previous, не playFromSwipe(current).
      const beforeId = usePlayerStore.getState().currentTrack?.id ?? item.id
      const run =
        direction === 'previous' ? audio.previous() : audio.next()
      return Promise.resolve(run).then(() => {
        const afterId = usePlayerStore.getState().currentTrack?.id ?? null
        if (afterId && afterId !== beforeId) {
          navigated.push(afterId)
        }
      })
    },
  })
}

async function renderDeck(
  props: {
    tracks: Track[]
    categoryCancelKey?: number
    categoryResolveKey?: number
  },
  options?: { remount?: boolean },
): Promise<void> {
  if (options?.remount) {
    deckKey += 1
  }
  await react.act(async () => {
    root?.render(react.createElement(Harness, { ...props, deckKey }))
  })
}

before(async () => {
  dom = new Window({ url: 'http://127.0.0.1:5173/' })
  installDom(dom)
  server = await createServer({
    configFile: false,
    root: ROOT,
    plugins: [reactPlugin()],
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    resolve: { external: true },
    ssr: { external: true },
  })
  react = (await import('react')) as unknown as ReactModule
  reactDom = (await import('react-dom/client')) as unknown as ReactDomModule
  SwipeDeck = ((await server.ssrLoadModule('/src/components/SwipeDeck.tsx')) as DeckModule).default
  const playerMod = (await server.ssrLoadModule('/src/store/playerStore.ts')) as PlayerModule
  usePlayerStore = playerMod.usePlayerStore
  const audioMod = (await server.ssrLoadModule('/src/services/audioPlayer/AudioPlayer.ts')) as AudioModule
  audio = audioMod.getAudioPlayer()
  getPlaybackQueue = (
    (await server.ssrLoadModule('/src/services/playbackQueue/PlaybackQueue.ts')) as QueueModule
  ).getPlaybackQueue
  audio.playTrack = async (item) => {
    played.push(item.id)
    const snap = getPlaybackQueue().getSnapshot()
    await react.act(async () => {
      usePlayerStore.setState({
        currentTrack: item,
        pendingTrack: null,
        currentTime: 0,
        playing: true,
        paused: false,
        loading: false,
        buffering: false,
        error: null,
        queue: snap.items,
        queueIndex: snap.currentIndex,
      })
    })
  }
  void ((await server.ssrLoadModule('/src/services/playbackIntent/index.ts')) as IntentModule)
  organization = (await server.ssrLoadModule(
    '/src/services/canonical/userOrganization.ts',
  )) as OrganizationModule
  canonicalStore = (
    (await server.ssrLoadModule('/src/store/canonicalLibraryStore.ts')) as CanonicalStoreModule
  ).useCanonicalLibraryStore
  collectionStore = (
    (await server.ssrLoadModule('/src/store/collectionStore.ts')) as CollectionStoreModule
  ).useCollectionStore
  persistence = (
    (await server.ssrLoadModule(
      '/src/services/libraryPersistence/statusStore.ts',
    )) as PersistenceModule
  ).useLibraryPersistenceStore
  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  root = reactDom.createRoot(container)
})

after(async () => {
  resetLibrary()
  root?.unmount()
  await server?.close()
  await dom?.happyDOM.close()
})

describe('SwipeDeck playback', { concurrency: false }, () => {
test('LIKE сохраняет трек, возвращает карточку и не трогает воспроизведение', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })
  assert.equal(frontTitle(), 'Город')

  await swipe('left')

  assert.equal(frontTitle(), 'Город')
  assert.equal(cardMotion(), 'return')
  assert.equal(noticeText(), 'В избранном')
  assert.equal(heartPhase(), 'fly')
  assert.equal(heartSize(), '152')
  assert.ok(dom.document.querySelector('.swipe-heart'))
  assert.equal(likePatches, 1)
  assert.deepEqual(navigated, [])
  assert.deepEqual(played, [])
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().queueIndex, 0)
  assert.equal(playerState().currentTime, 37.5)
  assert.equal(playerState().playing, true)

  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(canonicalStore.getState().itemsById.can_x?.state.liked, true)
  assert.equal(collectionStore.getState().history[0]?.action, 'like')
  assert.equal(collectionStore.getState().history[0]?.track.id, 'yandex-music:101')

  await renderDeck({ tracks: tracks.map((item) => ({ ...item })) })
  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(navigated, [])
  assert.deepEqual(played, [])
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().queueIndex, 0)
  assert.equal(playerState().currentTime, 37.5)
  assert.equal(collectionStore.getState().history.length, 1)

  const saved = canonicalStore.getState().itemsById.can_x
  assert.equal(saved?.state.liked, true)
  canonicalStore.getState().clear()
  canonicalStore.getState().replaceForUser('user-1', [saved!])
  const selectors = (await server.ssrLoadModule(
    '/src/services/canonical/selectors.ts',
  )) as {
    likedCanonicalItems: (items: unknown[]) => Array<{ canonicalTrack: { title: string } }>
  }
  const liked = selectors.likedCanonicalItems(
    Object.values(canonicalStore.getState().itemsById),
  )
  assert.equal(liked.length, 1)
  assert.equal(liked[0]?.canonicalTrack.title, 'Город')
  const library = (await server.ssrLoadModule(
    '/src/library/providers/SmartLibraryProvider.ts',
  )) as { SmartLibraryProvider: new () => { getTracks: (id: string) => Promise<Array<{ id: string }>> } }
  const favorites = await new library.SmartLibraryProvider().getTracks('favorites')
  assert.equal(favorites.some((item) => item.id === 'yandex-music:101'), true)
})

test('сердце улетает только после успешного ответа', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  likeDelayMs = 400
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  await swipe('left', { pointerType: 'touch', distance: 56 })

  assert.equal(frontTitle(), 'Город')
  assert.equal(heartPhase(), '')
  assert.equal(noticeText(), '')
  assert.equal(likePatches, 1)
  assert.equal(playerState().currentTime, 37.5)
  assert.deepEqual(navigated, [])

  await react.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
  })

  assert.equal(frontTitle(), 'Город')
  assert.equal(heartPhase(), 'fly')
  assert.equal(noticeText(), 'В избранном')
  assert.equal(canonicalStore.getState().itemsById.can_x?.state.liked, true)
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().queueIndex, 0)
  assert.equal(playerState().currentTime, 37.5)
})

test('LIKE на паузе не запускает музыку', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 12, false)
  await renderDeck({ tracks }, { remount: true })

  await swipe('left')

  assert.equal(frontTitle(), 'Город')
  assert.equal(noticeText(), 'В избранном')
  assert.deepEqual(played, [])
  assert.equal(playerState().playing, false)
  assert.equal(playerState().paused, true)
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().currentTime, 12)
  assert.equal(playerState().queueIndex, 0)
})

test('повторный LIKE не создаёт второй canonical patch', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  await swipe('left')
  await swipe('left')

  assert.equal(frontTitle(), 'Город')
  assert.equal(likePatches, 1)
  assert.equal(collectionStore.getState().history.length, 1)
  assert.equal(noticeText(), 'В избранном')
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().currentTime, 37.5)
  assert.equal(playerState().queueIndex, 0)
  assert.deepEqual(navigated, [])
})

test('ошибка сохранения LIKE не сообщает об успехе', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  likeShouldFail = true
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  await swipe('left')

  assert.equal(frontTitle(), 'Город')
  assert.equal(cardMotion(), 'return')
  assert.equal(noticeText(), 'Не удалось сохранить изменения.')
  assert.equal(heartPhase(), '')
  assert.equal(canonicalStore.getState().itemsById.can_x?.state.liked ?? false, false)
  assert.equal(collectionStore.getState().history.length, 0)
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().currentTime, 37.5)
  assert.equal(playerState().playing, true)
  assert.deepEqual(navigated, [])
  assert.deepEqual(played, [])
})

test('LEFT на 55 px почти не двигает карточку и сохраняет лайк', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  const card = dom.document.querySelector('article.cursor-grab')
  assert.ok(card)
  await react.act(async () => {
    card.dispatchEvent(pointer('pointerdown', 220, 220, 1, 'mouse'))
    card.dispatchEvent(pointer('pointermove', 165, 220, 1, 'mouse'))
    await new Promise((resolve) => setTimeout(resolve, 30))
  })

  const shift = cardVisualShift()
  assert.ok(shift > 0, `карточка не сдвинулась, transform: ${(card as HTMLElement).style.transform}`)
  assert.ok(shift <= 12, `визуальный сдвиг ${shift} px`)

  await react.act(async () => {
    card.dispatchEvent(pointer('pointerup', 165, 220, 0, 'mouse'))
    await new Promise((resolve) => setTimeout(resolve, 280))
  })

  assert.equal(frontTitle(), 'Город')
  assert.equal(likePatches, 1)
  assert.equal(noticeText(), 'В избранном')
  assert.equal(heartPhase(), 'fly')
  assert.equal(heartSize(), '152')
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().queueIndex, 0)
  assert.equal(playerState().currentTime, 37.5)
  assert.deepEqual(navigated, [])
  assert.deepEqual(played, [])
})

test('медленный короткий LEFT доходит до сохранения, слишком короткий нет', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  await slowLeft(36)
  assert.equal(frontTitle(), 'Город')
  assert.equal(likePatches, 0)
  assert.equal(noticeText(), '')
  assert.equal(heartPhase(), '')
  assert.equal(playerState().currentTime, 37.5)
  assert.deepEqual(navigated, [])

  await slowLeft(56)
  assert.equal(frontTitle(), 'Город')
  assert.equal(likePatches, 1)
  assert.equal(noticeText(), 'В избранном')
  assert.equal(heartPhase(), 'fly')
  assert.equal(heartSize(), '152')
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().queueIndex, 0)
  assert.equal(playerState().currentTime, 37.5)
  assert.deepEqual(navigated, [])
  assert.deepEqual(played, [])
})

test('короткий UP и DOWN переключают карточку один раз', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  await swipe('up', { distance: 56, pointerType: 'touch' })
  assert.equal(frontTitle(), 'Река')
  assert.deepEqual(navigated, ['yandex-music:102'])
  assert.deepEqual(played, ['yandex-music:102'])
  assert.equal(playerState().queueIndex, 1)

  await swipe('down', { distance: 56, pointerType: 'touch' })
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(navigated, ['yandex-music:102', 'yandex-music:101'])
  assert.deepEqual(played, ['yandex-music:102', 'yandex-music:101'])
  assert.equal(playerState().queueIndex, 0)

  await swipe('down', { distance: 56, pointerType: 'touch' })
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(navigated, ['yandex-music:102', 'yandex-music:101'])
  assert.equal(playerState().currentTime, 0)
})

test('SKIP по-прежнему переключает воспроизведение', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  await swipe('up')

  assert.equal(frontTitle(), 'Река')
  assert.deepEqual(navigated, ['yandex-music:102'])
  assert.deepEqual(played, ['yandex-music:102'])
  assert.equal(playerState().currentTrack?.id, 'yandex-music:102')
  assert.equal(playerState().queueIndex, 1)
  assert.equal(playerState().currentTime, 0)
  assert.equal(playerState().playing, true)
  assert.equal(playerState().paused, false)
})

test('PREVIOUS и CATEGORIZE сохраняют прежнюю навигацию', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 18, true)
  await renderDeck({ tracks }, { remount: true })

  await swipe('down')
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(navigated, [])
  assert.equal(playerState().currentTime, 18)
  assert.equal(playerState().queueIndex, 0)

  await swipe('right')
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(categorized, ['yandex-music:101'])
  assert.deepEqual(navigated, [])
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().currentTime, 18)

  await renderDeck({ tracks, categoryCancelKey: 1 })
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(navigated, [])

  await seedPlayback(1, 22, true)
  await renderDeck({ tracks, categoryCancelKey: 1 })
  assert.equal(frontTitle(), 'Река')

  await swipe('down')
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(navigated, ['yandex-music:101'])
  assert.deepEqual(played, ['yandex-music:101'])
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().queueIndex, 0)
})

test('кнопка плеера после LIKE по-прежнему приводит карточку', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })
  await swipe('left')
  assert.equal(frontTitle(), 'Город')
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')

  await react.act(async () => {
    usePlayerStore.setState({
      currentTrack: tracks[2],
      pendingTrack: null,
      queueIndex: 2,
      currentTime: 9,
      playing: true,
      paused: false,
    })
  })

  assert.equal(frontTitle(), 'Море')
  assert.deepEqual(played, [])
  assert.equal(playerState().currentTime, 9)
})

test('сенсорный UP переключает трек один раз', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  await swipe('up', { pointerType: 'touch' })

  assert.equal(frontTitle(), 'Река')
  assert.deepEqual(navigated, ['yandex-music:102'])
  assert.deepEqual(played, ['yandex-music:102'])
  assert.equal(playerState().currentTrack?.id, 'yandex-music:102')
  assert.equal(playerState().queueIndex, 1)
})

test('сенсорный DOWN возвращает предыдущую карточку и не срабатывает на первой', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 18, true)
  await renderDeck({ tracks }, { remount: true })

  await swipe('down', { pointerType: 'touch' })
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(navigated, [])
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().currentTime, 18)

  await seedPlayback(1, 22, true)
  await renderDeck({ tracks })
  assert.equal(frontTitle(), 'Река')

  await swipe('down', { pointerType: 'touch' })
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(navigated, ['yandex-music:101'])
  assert.deepEqual(played, ['yandex-music:101'])
  assert.equal(playerState().queueIndex, 0)
})

test('сенсорные LEFT и RIGHT не ломают лайк и каталог', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  await swipe('left', { pointerType: 'touch' })
  assert.equal(frontTitle(), 'Город')
  assert.equal(cardMotion(), 'return')
  assert.equal(noticeText(), 'В избранном')
  assert.deepEqual(navigated, [])
  assert.deepEqual(played, [])
  assert.equal(playerState().currentTrack?.id, 'yandex-music:101')
  assert.equal(playerState().currentTime, 37.5)

  await renderDeck({ tracks }, { remount: true })
  await seedPlayback(0, 37.5, true)
  await swipe('right', { pointerType: 'touch' })
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(categorized, ['yandex-music:101'])
  assert.deepEqual(navigated, [])
  assert.equal(playerState().currentTime, 37.5)
})

test('короткое касание и диагональ не дают ложный или двойной свайп', { timeout: 20_000 }, async () => {
  resetLibrary()
  installRemote()
  await seedPlayback(0, 37.5, true)
  await renderDeck({ tracks }, { remount: true })

  await drag(8, -6, 'touch')
  assert.equal(frontTitle(), 'Город')
  assert.deepEqual(navigated, [])
  assert.deepEqual(played, [])

  await drag(36, -160, 'touch')
  assert.equal(frontTitle(), 'Река')
  assert.deepEqual(navigated, ['yandex-music:102'])
  assert.deepEqual(played, ['yandex-music:102'])

  const card = dom.document.querySelector('article.cursor-grab')
  assert.ok(card)
  assert.equal(dom.getComputedStyle(card).touchAction, 'none')
  assert.notEqual(dom.getComputedStyle(dom.document.body).touchAction, 'none')
})
})
