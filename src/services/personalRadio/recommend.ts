import type { Track } from '../../types/track.ts'
import { isDemoSourceId } from '../../sources/demoSource.ts'
import type { UserTasteProfile } from '../taste/types.ts'

export const MY_WAVE_ID = 'my-wave'
export const MY_WAVE_TITLE = 'Моя волна'

export const RADIO_LIMITS = {
  maxArtists: 6,
  maxPerSearch: 8,
  maxTracks: 20,
  searchTimeoutMs: 4_000,
  heavySkip: 3,
} as const

export type RadioOrigin = 'recommendations' | 'favorites'

export type RadioBuildStatus =
  | 'ready'
  | 'favorites'
  | 'no-likes'
  | 'no-source'
  | 'unavailable'
  | 'error'

export type RadioLibraryCopy = {
  sourceId: string
  externalId: string
  title: string
  artist: string
}

export type RadioLibraryItem = {
  canonicalId: string
  title: string
  artist: string
  liked: boolean
  disliked: boolean
  hidden: boolean
  playCount: number
  skipped: number
  lastPlayed: string | null
  copies: RadioLibraryCopy[]
}

export type RadioSelection = 'library' | 'taste'

export type RadioSearchPort = {
  sources: readonly { id: string }[]
  search: (sourceId: string, query: string, signal: AbortSignal) => Promise<Track[]>
  isPlayable: (track: Track, signal: AbortSignal) => Promise<boolean>
  /** Browse/library лента для continuous-random-v1 (опционально). */
  fetchFeed?: (sourceId: string, signal: AbortSignal) => Promise<Track[]>
}

export type RadioPlan = {
  status: RadioBuildStatus
  origin: RadioOrigin | null
  tracks: Track[]
  startIndex: number
  message: string
}

export type RadioTransportState = {
  radioActive: boolean
  playing: boolean
  paused: boolean
  queueLength: number
}

export type RadioTransportDecision = 'pause' | 'resume' | 'build'

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function titleKey(track: { title: string; artist: string }): string {
  return `${normalize(track.artist)}|${normalize(track.title)}`
}

function copyKey(track: { sourceId: string; externalId: string }): string {
  return `${track.sourceId}:${track.externalId}`
}

function toTrack(item: RadioLibraryItem, copy: RadioLibraryCopy): Track {
  return {
    id: copyKey(copy),
    sourceId: copy.sourceId,
    externalId: copy.externalId,
    title: copy.title || item.title,
    artist: copy.artist || item.artist,
  }
}

function realCopies(item: RadioLibraryItem): RadioLibraryCopy[] {
  return item.copies.filter((copy) => !isDemoSourceId(copy.sourceId) && copy.externalId)
}

export function likedSeeds(items: readonly RadioLibraryItem[]): RadioLibraryItem[] {
  return items
    .filter(
      (item) =>
        item.liked &&
        !item.disliked &&
        !item.hidden &&
        item.skipped < RADIO_LIMITS.heavySkip &&
        realCopies(item).length > 0,
    )
    .sort((left, right) => {
      if (right.playCount !== left.playCount) {
        return right.playCount - left.playCount
      }
      return (right.lastPlayed ?? '').localeCompare(left.lastPlayed ?? '')
    })
}

function exclusionKeys(items: readonly RadioLibraryItem[], seeds: readonly RadioLibraryItem[]) {
  const blockedCopies = new Set<string>()
  const blockedTitles = new Set<string>()
  for (const item of items) {
    const blocked = item.disliked || item.hidden || item.skipped >= RADIO_LIMITS.heavySkip
    if (!blocked) {
      continue
    }
    blockedTitles.add(titleKey(item))
    for (const copy of item.copies) {
      blockedCopies.add(copyKey(copy))
    }
  }
  const seedCopies = new Set<string>()
  const seedTitles = new Set<string>()
  for (const seed of seeds) {
    seedTitles.add(titleKey(seed))
    for (const copy of realCopies(seed)) {
      seedCopies.add(copyKey(copy))
    }
  }
  return { blockedCopies, blockedTitles, seedCopies, seedTitles }
}

function interleave(groups: Track[][], limit: number): Track[] {
  const pending = groups.map((group) => [...group])
  const ordered: Track[] = []
  while (ordered.length < limit && pending.some((group) => group.length > 0)) {
    for (const group of pending) {
      const next = group.shift()
      if (!next) {
        continue
      }
      ordered.push(next)
      if (ordered.length >= limit) {
        break
      }
    }
  }
  return ordered
}

async function searchArtist(
  port: RadioSearchPort,
  artist: string,
  parent: AbortSignal,
  timeoutMs: number,
): Promise<{ tracks: Track[]; failed: boolean }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onParent = () => controller.abort()
  parent.addEventListener('abort', onParent)
  const tracks: Track[] = []
  let failed = false
  try {
    if (parent.aborted) {
      return { tracks, failed: true }
    }
    for (const source of port.sources) {
      if (controller.signal.aborted) {
        failed = true
        break
      }
      try {
        const found = await port.search(source.id, artist, controller.signal)
        tracks.push(...found.slice(0, RADIO_LIMITS.maxPerSearch))
      } catch {
        failed = true
      }
    }
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', onParent)
  }
  return { tracks, failed }
}

export async function buildPersonalRadio(
  items: readonly RadioLibraryItem[],
  port: RadioSearchPort,
  options?: {
    rotation?: number
    signal?: AbortSignal
    timeoutMs?: number
    selection?: RadioSelection
    taste?: UserTasteProfile
  },
): Promise<RadioPlan> {
  if (options?.selection === 'taste' && options.taste) {
    return buildTasteAwareRadio(items, port, { ...options, taste: options.taste })
  }
  const seeds = likedSeeds(items)
  if (seeds.length === 0) {
    return {
      status: 'no-likes',
      origin: null,
      tracks: [],
      startIndex: 0,
      message: 'Добавьте понравившиеся песни в «Избранное».',
    }
  }
  if (port.sources.length === 0) {
    return {
      status: 'no-source',
      origin: null,
      tracks: [],
      startIndex: 0,
      message: 'Подключите источник музыки, чтобы собрать волну.',
    }
  }

  const parent = options?.signal ?? new AbortController().signal
  const timeoutMs = options?.timeoutMs ?? RADIO_LIMITS.searchTimeoutMs
  const excluded = exclusionKeys(items, seeds)
  const artists: string[] = []
  const seenArtists = new Set<string>()
  for (const seed of seeds) {
    const artist = seed.artist.trim()
    const key = normalize(artist)
    if (!artist || seenArtists.has(key)) {
      continue
    }
    seenArtists.add(key)
    artists.push(artist)
    if (artists.length >= RADIO_LIMITS.maxArtists) {
      break
    }
  }

  const byArtist = new Map<string, Track[]>()
  const seenCopies = new Set<string>([...excluded.blockedCopies, ...excluded.seedCopies])
  const seenTitles = new Set<string>([...excluded.blockedTitles, ...excluded.seedTitles])
  let searches = 0
  let failures = 0

  for (const artist of artists) {
    if (parent.aborted) {
      break
    }
    searches += 1
    const result = await searchArtist(port, artist, parent, timeoutMs)
    if (result.failed && result.tracks.length === 0) {
      failures += 1
    }
    for (const track of result.tracks) {
      if (isDemoSourceId(track.sourceId) || !track.externalId) {
        continue
      }
      const copy = copyKey(track)
      const title = titleKey(track)
      if (seenCopies.has(copy) || seenTitles.has(title)) {
        continue
      }
      let playable = false
      try {
        playable = await port.isPlayable(track, parent)
      } catch {
        playable = false
      }
      if (!playable) {
        continue
      }
      seenCopies.add(copy)
      seenTitles.add(title)
      const group = byArtist.get(normalize(track.artist)) ?? []
      group.push(track)
      byArtist.set(normalize(track.artist), group)
    }
  }

  const fresh = interleave([...byArtist.values()], RADIO_LIMITS.maxTracks)
  if (fresh.length > 0) {
    const startIndex = fresh.length === 1 ? 0 : (options?.rotation ?? 0) % fresh.length
    return {
      status: 'ready',
      origin: 'recommendations',
      tracks: fresh,
      startIndex,
      message: 'Музыка на основе вашего избранного',
    }
  }

  if (searches > 0 && failures === searches) {
    return {
      status: 'error',
      origin: null,
      tracks: [],
      startIndex: 0,
      message: 'Не удалось найти композиции. Воспроизведение не запущено.',
    }
  }

  const favorites: Track[] = []
  for (const seed of seeds) {
    for (const copy of realCopies(seed)) {
      const track = toTrack(seed, copy)
      if (excluded.blockedCopies.has(copyKey(track)) || excluded.blockedTitles.has(titleKey(track))) {
        continue
      }
      let playable = false
      try {
        playable = await port.isPlayable(track, parent)
      } catch {
        playable = false
      }
      if (!playable || favorites.some((item) => titleKey(item) === titleKey(track))) {
        continue
      }
      favorites.push(track)
      if (favorites.length >= RADIO_LIMITS.maxTracks) {
        break
      }
    }
  }

  if (favorites.length > 0) {
    const startIndex =
      favorites.length === 1 ? 0 : (options?.rotation ?? 0) % favorites.length
    return {
      status: 'favorites',
      origin: 'favorites',
      tracks: favorites,
      startIndex,
      message: 'Новых композиций нет. Играет сохранённое избранное, это не подборка рекомендаций.',
    }
  }

  return {
    status: 'unavailable',
    origin: null,
    tracks: [],
    startIndex: 0,
    message: 'Подходящих композиций для воспроизведения нет.',
  }
}

const TASTE_RADIO_MESSAGE = 'Подборка по исполнителям из профиля. Это не модель похожих треков.'

function buildTasteAwareRadio(
  libraryItems: readonly RadioLibraryItem[],
  port: RadioSearchPort,
  options: {
    rotation?: number
    signal?: AbortSignal
    timeoutMs?: number
    taste: UserTasteProfile
  },
): Promise<RadioPlan> {
  const profileTracks = tracksFromProfile(options.taste)
  const positive = profileTracks
    .filter((entry) => entry.score > 0 && !entry.item.disliked && !entry.item.hidden)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      const artist = left.item.artist.localeCompare(right.item.artist)
      return artist === 0 ? left.item.canonicalId.localeCompare(right.item.canonicalId) : artist
    })
  if (positive.length === 0) {
    return Promise.resolve({
      status: 'no-likes',
      origin: null,
      tracks: [],
      startIndex: 0,
      message: 'Добавьте понравившиеся песни в «Избранное».',
    })
  }
  if (port.sources.length === 0) {
    return Promise.resolve({
      status: 'no-source',
      origin: null,
      tracks: [],
      startIndex: 0,
      message: 'Подключите источник музыки, чтобы собрать волну.',
    })
  }

  const searchSeeds = diversifyByArtist(positive)
  const known = positive.map((entry) => entry.item)
  const blocked = [...libraryItems, ...profileTracks.map((entry) => entry.item)]
  const excluded = exclusionKeys(blocked, known)
  const heard = new Set<string>()
  for (const entry of positive) {
    if (!entry.heard) {
      continue
    }
    heard.add(titleKey(entry.item))
    for (const copy of entry.item.copies) {
      heard.add(copyKey(copy))
    }
  }

  const parent = options.signal ?? new AbortController().signal
  const timeoutMs = options.timeoutMs ?? RADIO_LIMITS.searchTimeoutMs
  const byArtist: Track[][] = []
  let searches = 0
  let failures = 0
  const seenCopies = new Set<string>([...excluded.blockedCopies, ...excluded.seedCopies])
  const seenTitles = new Set<string>([...excluded.blockedTitles, ...excluded.seedTitles])

  return (async () => {
    for (const seed of searchSeeds) {
      if (parent.aborted) {
        break
      }
      searches += 1
      const result = await searchArtist(port, seed.item.artist, parent, timeoutMs)
      if (result.failed && result.tracks.length === 0) {
        failures += 1
      }
      const fresh: Track[] = []
      for (const track of result.tracks) {
        if (isDemoSourceId(track.sourceId) || !track.externalId || parent.aborted) {
          continue
        }
        const copy = copyKey(track)
        const title = titleKey(track)
        if (seenCopies.has(copy) || seenTitles.has(title)) {
          continue
        }
        let playable = false
        try {
          playable = await port.isPlayable(track, parent)
        } catch {
          playable = false
        }
        if (!playable) {
          continue
        }
        seenCopies.add(copy)
        seenTitles.add(title)
        fresh.push(track)
      }
      fresh.sort((left, right) => {
        const penalty = Number(heard.has(copyKey(left)) || heard.has(titleKey(left)))
          - Number(heard.has(copyKey(right)) || heard.has(titleKey(right)))
        return penalty === 0 ? left.externalId.localeCompare(right.externalId) : penalty
      })
      if (fresh.length > 0) {
        byArtist.push(fresh)
      }
    }

    if (parent.aborted) {
      return {
        status: 'error' as const,
        origin: null,
        tracks: [],
        startIndex: 0,
        message: 'Подбор отменён.',
      }
    }

    const ordered = interleave(byArtist, RADIO_LIMITS.maxTracks)
    if (ordered.length > 0) {
      const startIndex = ordered.length === 1 ? 0 : (options.rotation ?? 0) % ordered.length
      return {
        status: 'ready' as const,
        origin: 'recommendations' as const,
        tracks: ordered,
        startIndex,
        message: TASTE_RADIO_MESSAGE,
      }
    }

    if (searches > 0 && failures === searches) {
      return {
        status: 'error' as const,
        origin: null,
        tracks: [],
        startIndex: 0,
        message: 'Не удалось найти композиции. Воспроизведение не запущено.',
      }
    }

    const favorites: Track[] = []
    for (const entry of positive) {
      for (const copy of realCopies(entry.item)) {
        const track = toTrack(entry.item, copy)
        if (excluded.blockedCopies.has(copyKey(track)) || excluded.blockedTitles.has(titleKey(track))) {
          continue
        }
        let playable = false
        try {
          playable = await port.isPlayable(track, parent)
        } catch {
          playable = false
        }
        if (!playable || favorites.some((item) => titleKey(item) === titleKey(track))) {
          continue
        }
        favorites.push(track)
        if (favorites.length >= RADIO_LIMITS.maxTracks) {
          break
        }
      }
      if (favorites.length >= RADIO_LIMITS.maxTracks) {
        break
      }
    }
    if (favorites.length > 0) {
      const startIndex = favorites.length === 1 ? 0 : (options.rotation ?? 0) % favorites.length
      return {
        status: 'favorites' as const,
        origin: 'favorites' as const,
        tracks: favorites,
        startIndex,
        message: 'Новых композиций нет. Играет сохранённое избранное, это не подборка рекомендаций.',
      }
    }
    return {
      status: 'unavailable' as const,
      origin: null,
      tracks: [],
      startIndex: 0,
      message: 'Подходящих композиций для воспроизведения нет.',
    }
  })()
}

function tracksFromProfile(profile: UserTasteProfile): { item: RadioLibraryItem; score: number; heard: boolean }[] {
  const result: { item: RadioLibraryItem; score: number; heard: boolean }[] = []
  for (const track of profile.tracks) {
    const artist = track.label?.artist.trim() ?? ''
    const title = track.label?.title.trim() ?? ''
    const copies = track.copies.filter((copy) => copy.externalId && !isDemoSourceId(copy.sourceId))
    if (!artist || copies.length === 0) {
      continue
    }
    const canonicalId = track.key.kind === 'canonical'
      ? track.key.canonicalTrackId
      : `source:${copies[0]?.sourceId ?? ''}:${copies[0]?.externalId ?? ''}`
    const disliked = track.signals.some((signal) => signal.origin === 'canonical-dislike' && signal.weight < 0)
    const hidden = track.signals.some((signal) => signal.origin === 'canonical-hidden' && signal.weight < 0)
    const heard = track.signals.some((signal) =>
      (signal.origin === 'playback-listen' || signal.origin === 'library-play-count') && signal.weight > 0)
    result.push({
      score: track.score,
      heard,
      item: {
        canonicalId,
        title: title || canonicalId,
        artist,
        liked: track.signals.some((signal) =>
          (signal.origin === 'canonical-like' || signal.origin === 'history-like') && signal.weight > 0),
        disliked,
        hidden,
        playCount: 0,
        skipped: 0,
        lastPlayed: track.lastPlayed,
        copies: copies.map((copy) => ({
          sourceId: copy.sourceId,
          externalId: copy.externalId,
          title: title || canonicalId,
          artist,
        })),
      },
    })
  }
  return result
}

function diversifyByArtist(
  entries: readonly { item: RadioLibraryItem; score: number }[],
): { item: RadioLibraryItem; score: number }[] {
  const picked: { item: RadioLibraryItem; score: number }[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const artist = normalize(entry.item.artist)
    if (seen.has(artist)) {
      continue
    }
    seen.add(artist)
    picked.push(entry)
    if (picked.length >= RADIO_LIMITS.maxArtists) {
      break
    }
  }
  return picked
}

export function decideRadioToggle(state: RadioTransportState): RadioTransportDecision {
  if (state.radioActive && state.queueLength > 0 && (state.playing || state.paused)) {
    return state.playing ? 'pause' : 'resume'
  }
  return 'build'
}

const HOME_FEED_PROTECTED_CONTEXT = new Set([
  'search-seed',
  'album',
  'playlist',
  'radio',
])

export function shouldReplaceHomeQueueWithSwipeFeed(input: {
  queueLocked: boolean
  feedLength: number
  queueLength: number
  /** Живой context очереди. Не полагаться только на React-снимок после playSearchTrack. */
  contextType?: string
  /**
   * false — лента только для карточек (search results при search-seed).
   * true/undefined — каталожный swipe может инициализировать пустую очередь.
   */
  allowFeedAsQueue?: boolean
}): boolean {
  if (input.allowFeedAsQueue === false) {
    return false
  }
  if (input.contextType && HOME_FEED_PROTECTED_CONTEXT.has(input.contextType)) {
    return false
  }
  if (input.queueLocked || input.feedLength === 0 || input.queueLength > 0) {
    return false
  }
  return true
}
